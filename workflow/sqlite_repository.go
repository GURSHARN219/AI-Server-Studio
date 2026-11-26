package workflow

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"ai-server-studio-backend/persistence"
)

// SQLiteRepository is the persistence boundary for workflow definitions and
// state. It never executes a step or performs an external side effect.
type SQLiteRepository struct {
	db *sql.DB
}

var workflowMigrationStatements = []string{
	`CREATE TABLE IF NOT EXISTS workflow_definitions (
		id TEXT PRIMARY KEY,
		owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE CHECK(length(trim(owner_id))>0),
		name TEXT NOT NULL CHECK(length(trim(name))>0 AND length(name)<=200),
		current_version INTEGER NOT NULL CHECK(current_version>0),
		created_at INTEGER NOT NULL
	)`,
	`CREATE TABLE IF NOT EXISTS workflow_versions (
		definition_id TEXT NOT NULL REFERENCES workflow_definitions(id) ON DELETE CASCADE,
		version INTEGER NOT NULL CHECK(version>0),
		graph_json TEXT NOT NULL CHECK(json_valid(graph_json)),
		checksum TEXT NOT NULL CHECK(length(checksum)=64),
		created_at INTEGER NOT NULL,
		PRIMARY KEY(definition_id, version)
	)`,
	`CREATE INDEX IF NOT EXISTS workflow_definitions_owner ON workflow_definitions(owner_id, created_at, id)`,
	`CREATE INDEX IF NOT EXISTS workflow_versions_definition ON workflow_versions(definition_id, version)`,
	`CREATE TABLE IF NOT EXISTS workflow_runs (
		run_id TEXT PRIMARY KEY REFERENCES task_runs(id) ON DELETE CASCADE,
		owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE CHECK(length(trim(owner_id))>0),
		definition_id TEXT NOT NULL,
		version INTEGER NOT NULL CHECK(version>0),
		input_json TEXT NOT NULL CHECK(json_valid(input_json)),
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL,
		FOREIGN KEY(definition_id, version) REFERENCES workflow_versions(definition_id, version) ON DELETE RESTRICT
	)`,
	`CREATE INDEX IF NOT EXISTS workflow_runs_owner_created ON workflow_runs(owner_id, created_at, run_id)`,
	`CREATE TABLE IF NOT EXISTS workflow_steps (
		run_id TEXT NOT NULL REFERENCES workflow_runs(run_id) ON DELETE CASCADE,
		step_id TEXT NOT NULL,
		status TEXT NOT NULL CHECK(status IN ('queued','running','waiting','succeeded','failed','cancelled','skipped')),
		input_json TEXT NOT NULL CHECK(json_valid(input_json)),
		output_json TEXT CHECK(output_json IS NULL OR json_valid(output_json)),
		error_summary TEXT,
		started_at INTEGER,
		finished_at INTEGER,
		PRIMARY KEY(run_id, step_id)
	)`,
	`CREATE TABLE IF NOT EXISTS workflow_events (
		run_id TEXT NOT NULL REFERENCES workflow_runs(run_id) ON DELETE CASCADE,
		sequence INTEGER NOT NULL CHECK(sequence>0),
		event_type TEXT NOT NULL CHECK(length(trim(event_type))>0 AND length(event_type)<=128),
		timestamp INTEGER NOT NULL,
		event_json TEXT NOT NULL CHECK(json_valid(event_json)),
		PRIMARY KEY(run_id, sequence)
	)`,
	`CREATE INDEX IF NOT EXISTS workflow_events_run_sequence ON workflow_events(run_id, sequence)`,
	`CREATE TABLE IF NOT EXISTS workflow_event_cursors (
		run_id TEXT PRIMARY KEY REFERENCES workflow_runs(run_id) ON DELETE CASCADE,
		next_sequence INTEGER NOT NULL CHECK(next_sequence>0),
		updated_at INTEGER NOT NULL
	)`,
}

// workflowMigration2Statements is additive. Keep workflowMigrationStatements
// unchanged: its checksum is part of the durable migration contract.
var workflowMigration2Statements = []string{
	`ALTER TABLE workflow_steps ADD COLUMN dependencies_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(dependencies_json) AND json_type(dependencies_json)='array')`,
	`ALTER TABLE workflow_steps ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt>=0)`,
	`ALTER TABLE workflow_steps ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0)`,
	`CREATE INDEX IF NOT EXISTS workflow_steps_status ON workflow_steps(status, run_id, step_id)`,
	`CREATE INDEX IF NOT EXISTS workflow_steps_revision ON workflow_steps(run_id, revision)`,
	// The graph in workflow_versions is immutable. json_each reads the stored
	// graph directly and only updates rows whose step still exists in that graph.
	`UPDATE workflow_steps
	 SET dependencies_json=json(COALESCE((
		 SELECT json_extract(graph_step.value, '$.dependencies')
		 FROM workflow_runs wr
		 JOIN workflow_versions wv ON wv.definition_id=wr.definition_id AND wv.version=wr.version
		 JOIN json_each(wv.graph_json, '$.steps') AS graph_step
		 WHERE wr.run_id=workflow_steps.run_id
		   AND json_extract(graph_step.value, '$.id')=workflow_steps.step_id
	 ), '[]'))
	 WHERE EXISTS (
		 SELECT 1
		 FROM workflow_runs wr
		 JOIN workflow_versions wv ON wv.definition_id=wr.definition_id AND wv.version=wr.version
		 JOIN json_each(wv.graph_json, '$.steps') AS graph_step
		 WHERE wr.run_id=workflow_steps.run_id
		   AND json_extract(graph_step.value, '$.id')=workflow_steps.step_id
	 )`,
}

// workflowMigration3Statements adds execution metadata without changing the
// workflow/1 or workflow/2 statement lists (their checksums are durable API).
var workflowMigration3Statements = []string{
	`ALTER TABLE workflow_steps ADD COLUMN step_type TEXT NOT NULL DEFAULT '' CHECK(length(step_type)<=128)`,
	`CREATE TABLE IF NOT EXISTS workflow_dispatches (
		dispatch_id TEXT PRIMARY KEY,
		run_id TEXT NOT NULL REFERENCES workflow_runs(run_id) ON DELETE CASCADE,
		step_id TEXT NOT NULL,
		agent_run_id TEXT NOT NULL REFERENCES task_runs(id) ON DELETE CASCADE,
		state TEXT NOT NULL CHECK(state IN ('prepared','started','succeeded','failed','cancelled')),
		execution_mode TEXT NOT NULL CHECK(execution_mode IN ('offline','online')),
		attempt INTEGER NOT NULL CHECK(attempt>0),
		revision INTEGER NOT NULL CHECK(revision>0),
		input_json TEXT NOT NULL CHECK(json_valid(input_json)),
		output_json TEXT CHECK(output_json IS NULL OR json_valid(output_json)),
		metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
		created_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL,
		UNIQUE(run_id, step_id),
		FOREIGN KEY(run_id, step_id) REFERENCES workflow_steps(run_id, step_id) ON DELETE CASCADE
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS workflow_dispatches_run_step ON workflow_dispatches(run_id, step_id)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS workflow_dispatches_agent_run ON workflow_dispatches(agent_run_id)`,
	`CREATE INDEX IF NOT EXISTS workflow_dispatches_state ON workflow_dispatches(state, created_at, dispatch_id)`,
	`CREATE INDEX IF NOT EXISTS workflow_dispatches_run ON workflow_dispatches(run_id, created_at, dispatch_id)`,
}

// NewSQLiteRepository applies the additive, checksum-verified workflow
// migration. task_runs is deliberately owned by agentrun and must already be
// present; this package only adds workflow tables and writes kind='workflow'.
func NewSQLiteRepository(db *sql.DB) (*SQLiteRepository, error) {
	if db == nil {
		return nil, errors.New("database unavailable")
	}
	var taskRuns int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='task_runs'`).Scan(&taskRuns); err != nil {
		return nil, err
	}
	if taskRuns != 1 {
		return nil, errors.New("task_runs table unavailable; initialize agentrun first")
	}
	if err := persistence.ApplyMigrationWithVerifier(db, "workflow/1", verifyWorkflowMigration, workflowMigrationStatements...); err != nil {
		return nil, err
	}
	if err := persistence.ApplyMigrationWithVerifier(db, "workflow/2", verifyWorkflowSchemaTx, workflowMigration2Statements...); err != nil {
		return nil, err
	}
	if err := persistence.ApplyMigrationWithVerifier(db, "workflow/3", verifyWorkflowSchemaTxStageB1, workflowMigration3Statements...); err != nil {
		return nil, err
	}
	if err := VerifyWorkflowSchema(db); err != nil {
		return nil, err
	}
	return &SQLiteRepository{db: db}, nil
}

func verifyWorkflowMigration(tx *sql.Tx) error {
	return verifyWorkflowSchemaTxMode(tx, false)
}

type expectedWorkflowColumn struct {
	columnType   string
	notNull      int
	defaultValue string
	primaryKey   int
}

var expectedWorkflowColumns = map[string]map[string]expectedWorkflowColumn{
	"workflow_definitions": {
		"id": {columnType: "TEXT", primaryKey: 1}, "owner_id": {columnType: "TEXT", notNull: 1}, "name": {columnType: "TEXT", notNull: 1},
		"current_version": {columnType: "INTEGER", notNull: 1}, "created_at": {columnType: "INTEGER", notNull: 1},
	},
	"workflow_versions": {
		"definition_id": {columnType: "TEXT", notNull: 1, primaryKey: 1}, "version": {columnType: "INTEGER", notNull: 1, primaryKey: 2}, "graph_json": {columnType: "TEXT", notNull: 1},
		"checksum": {columnType: "TEXT", notNull: 1}, "created_at": {columnType: "INTEGER", notNull: 1},
	},
	"workflow_runs": {
		"run_id": {columnType: "TEXT", primaryKey: 1}, "owner_id": {columnType: "TEXT", notNull: 1},
		"definition_id": {columnType: "TEXT", notNull: 1}, "version": {columnType: "INTEGER", notNull: 1}, "input_json": {columnType: "TEXT", notNull: 1},
		"created_at": {columnType: "INTEGER", notNull: 1}, "updated_at": {columnType: "INTEGER", notNull: 1},
	},
	"workflow_steps": {
		"run_id": {columnType: "TEXT", notNull: 1, primaryKey: 1}, "step_id": {columnType: "TEXT", notNull: 1, primaryKey: 2}, "status": {columnType: "TEXT", notNull: 1},
		"input_json": {columnType: "TEXT", notNull: 1}, "output_json": {columnType: "TEXT"}, "error_summary": {columnType: "TEXT"},
		"started_at": {columnType: "INTEGER"}, "finished_at": {columnType: "INTEGER"},
		"dependencies_json": {columnType: "TEXT", notNull: 1, defaultValue: "'[]'"},
		"attempt":           {columnType: "INTEGER", notNull: 1, defaultValue: "0"}, "revision": {columnType: "INTEGER", notNull: 1, defaultValue: "1"},
		"step_type": {columnType: "TEXT", notNull: 1, defaultValue: "''"},
	},
	"workflow_events": {
		"run_id": {columnType: "TEXT", notNull: 1, primaryKey: 1}, "sequence": {columnType: "INTEGER", notNull: 1, primaryKey: 2}, "event_type": {columnType: "TEXT", notNull: 1},
		"timestamp": {columnType: "INTEGER", notNull: 1}, "event_json": {columnType: "TEXT", notNull: 1},
	},
	"workflow_event_cursors": {
		"run_id": {columnType: "TEXT", primaryKey: 1}, "next_sequence": {columnType: "INTEGER", notNull: 1}, "updated_at": {columnType: "INTEGER", notNull: 1},
	},
	"workflow_dispatches": {
		"dispatch_id": {columnType: "TEXT", primaryKey: 1}, "run_id": {columnType: "TEXT", notNull: 1}, "step_id": {columnType: "TEXT", notNull: 1},
		"agent_run_id": {columnType: "TEXT", notNull: 1}, "state": {columnType: "TEXT", notNull: 1}, "execution_mode": {columnType: "TEXT", notNull: 1},
		"attempt": {columnType: "INTEGER", notNull: 1}, "revision": {columnType: "INTEGER", notNull: 1}, "input_json": {columnType: "TEXT", notNull: 1},
		"output_json": {columnType: "TEXT"}, "metadata_json": {columnType: "TEXT", notNull: 1, defaultValue: "'{}'"},
		"created_at": {columnType: "INTEGER", notNull: 1}, "updated_at": {columnType: "INTEGER", notNull: 1},
	},
}

type expectedWorkflowIndex struct {
	table   string
	columns []string
	unique  bool
}

var expectedWorkflowIndexes = map[string]expectedWorkflowIndex{
	"workflow_definitions_owner":    {table: "workflow_definitions", columns: []string{"owner_id", "created_at", "id"}},
	"workflow_versions_definition":  {table: "workflow_versions", columns: []string{"definition_id", "version"}},
	"workflow_runs_owner_created":   {table: "workflow_runs", columns: []string{"owner_id", "created_at", "run_id"}},
	"workflow_steps_status":         {table: "workflow_steps", columns: []string{"status", "run_id", "step_id"}},
	"workflow_steps_revision":       {table: "workflow_steps", columns: []string{"run_id", "revision"}},
	"workflow_events_run_sequence":  {table: "workflow_events", columns: []string{"run_id", "sequence"}},
	"workflow_dispatches_run_step":  {table: "workflow_dispatches", columns: []string{"run_id", "step_id"}, unique: true},
	"workflow_dispatches_agent_run": {table: "workflow_dispatches", columns: []string{"agent_run_id"}, unique: true},
	"workflow_dispatches_state":     {table: "workflow_dispatches", columns: []string{"state", "created_at", "dispatch_id"}},
	"workflow_dispatches_run":       {table: "workflow_dispatches", columns: []string{"run_id", "created_at", "dispatch_id"}},
}

type expectedWorkflowForeignKey struct {
	table, from, to, onDelete string
}

var expectedWorkflowForeignKeys = []expectedWorkflowForeignKey{
	{table: "workflow_definitions", from: "owner_id", to: "id", onDelete: "CASCADE"},
	{table: "workflow_versions", from: "definition_id", to: "id", onDelete: "CASCADE"},
	{table: "workflow_runs", from: "run_id", to: "id", onDelete: "CASCADE"},
	{table: "workflow_runs", from: "owner_id", to: "id", onDelete: "CASCADE"},
	{table: "workflow_steps", from: "run_id", to: "run_id", onDelete: "CASCADE"},
	{table: "workflow_events", from: "run_id", to: "run_id", onDelete: "CASCADE"},
	{table: "workflow_event_cursors", from: "run_id", to: "run_id", onDelete: "CASCADE"},
	{table: "workflow_dispatches", from: "run_id", to: "run_id", onDelete: "CASCADE"},
	{table: "workflow_dispatches", from: "agent_run_id", to: "id", onDelete: "CASCADE"},
}

// VerifyWorkflowSchema checks the durable workflow schema rather than merely
// checking migration markers. It is exported so tests and startup health checks
// can detect post-migration tampering.
func VerifyWorkflowSchema(db *sql.DB) error {
	if db == nil {
		return errors.New("database unavailable")
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = verifyWorkflowSchemaTxStageB1(tx); err != nil {
		return err
	}
	return tx.Commit()
}

func verifyWorkflowSchemaTx(tx *sql.Tx) error {
	return verifyWorkflowSchemaTxMode(tx, true)
}

func verifyWorkflowSchemaTxMode(tx *sql.Tx, includeStepStateColumns bool) error {
	return verifyWorkflowSchemaTxModeStageB1(tx, includeStepStateColumns, false)
}

func verifyWorkflowSchemaTxStageB1(tx *sql.Tx) error {
	return verifyWorkflowSchemaTxModeStageB1(tx, true, true)
}

func verifyWorkflowSchemaTxModeStageB1(tx *sql.Tx, includeStepStateColumns, includeStageB1 bool) error {
	columnsByTable := expectedWorkflowColumns
	if !includeStepStateColumns || !includeStageB1 {
		columnsByTable = make(map[string]map[string]expectedWorkflowColumn, len(expectedWorkflowColumns))
		for table, columns := range expectedWorkflowColumns {
			copyColumns := make(map[string]expectedWorkflowColumn, len(columns))
			for name, column := range columns {
				if table == "workflow_steps" && ((!includeStepStateColumns && (name == "dependencies_json" || name == "attempt" || name == "revision")) || (!includeStageB1 && name == "step_type")) {
					continue
				}
				if table == "workflow_dispatches" && !includeStageB1 {
					continue
				}
				copyColumns[name] = column
			}
			columnsByTable[table] = copyColumns
		}
	}
	for table, columns := range columnsByTable {
		if err := verifyWorkflowTableColumns(tx, table, columns); err != nil {
			return err
		}
	}
	for name, expected := range expectedWorkflowIndexes {
		if !includeStageB1 && strings.HasPrefix(name, "workflow_dispatches_") {
			continue
		}
		if !includeStepStateColumns && (name == "workflow_steps_status" || name == "workflow_steps_revision") {
			continue
		}
		if err := verifyWorkflowIndex(tx, name, expected); err != nil {
			return err
		}
	}
	for _, expected := range expectedWorkflowForeignKeys {
		if !includeStageB1 && expected.table == "workflow_dispatches" {
			continue
		}
		if err := verifyWorkflowForeignKey(tx, expected); err != nil {
			return err
		}
	}
	if err := verifyWorkflowVersionForeignKey(tx); err != nil {
		return err
	}
	checks := map[string][]string{
		"workflow_definitions":   {"length(trim(owner_id))>0", "length(trim(name))>0", "length(name)<=200", "current_version>0"},
		"workflow_versions":      {"version>0", "json_valid(graph_json)", "length(checksum)=64"},
		"workflow_runs":          {"length(trim(owner_id))>0", "version>0", "json_valid(input_json)"},
		"workflow_steps":         {"status IN ('queued','running','waiting','succeeded','failed','cancelled','skipped')", "json_valid(input_json)", "output_json IS NULL OR json_valid(output_json)"},
		"workflow_events":        {"sequence>0", "length(trim(event_type))>0", "length(event_type)<=128", "json_valid(event_json)"},
		"workflow_event_cursors": {"next_sequence>0"},
	}
	if includeStageB1 {
		checks["workflow_steps"] = append(checks["workflow_steps"], "length(step_type)<=128")
		checks["workflow_dispatches"] = []string{
			"state IN ('prepared','started','succeeded','failed','cancelled')",
			"execution_mode IN ('offline','online')", "attempt>0", "revision>0",
			"json_valid(input_json)", "output_json IS NULL OR json_valid(output_json)", "json_valid(metadata_json)",
		}
	}
	if includeStepStateColumns {
		checks["workflow_steps"] = append(checks["workflow_steps"], "json_valid(dependencies_json)", "json_type(dependencies_json)='array'", "attempt>=0", "revision>0")
	}
	for table, fragments := range checks {
		var sqlText string
		if err := tx.QueryRow(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`, table).Scan(&sqlText); err != nil {
			return fmt.Errorf("workflow schema table %s unavailable: %w", table, err)
		}
		normalized := normalizeSchemaSQL(sqlText)
		for _, fragment := range fragments {
			if !strings.Contains(normalized, normalizeSchemaSQL(fragment)) {
				return fmt.Errorf("workflow schema table %s is missing constraint %q", table, fragment)
			}
		}
	}
	if includeStageB1 {
		if err := verifyWorkflowCompositeForeignKey(tx, "workflow_dispatches", "workflow_steps", []string{"run_id", "step_id"}, []string{"run_id", "step_id"}, "CASCADE"); err != nil {
			return err
		}
	}
	return nil
}

func verifyWorkflowTableColumns(tx *sql.Tx, table string, expected map[string]expectedWorkflowColumn) error {
	rows, err := tx.Query(`PRAGMA table_info(` + quoteSQLiteIdentifier(table) + `)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	actual := make(map[string]expectedWorkflowColumn, len(expected))
	for rows.Next() {
		var cid int
		var name, columnType string
		var notNull, primaryKey int
		var defaultValue sql.NullString
		if err = rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			return err
		}
		value := ""
		if defaultValue.Valid {
			value = defaultValue.String
		}
		actual[name] = expectedWorkflowColumn{columnType: columnType, notNull: notNull, defaultValue: value, primaryKey: primaryKey}
	}
	if err = rows.Err(); err != nil {
		return err
	}
	if len(actual) != len(expected) {
		return fmt.Errorf("workflow schema table %s has %d columns, want %d", table, len(actual), len(expected))
	}
	for name, want := range expected {
		got, ok := actual[name]
		if !ok {
			return fmt.Errorf("workflow schema table %s is missing column %s", table, name)
		}
		if !strings.EqualFold(got.columnType, want.columnType) || got.notNull != want.notNull || got.primaryKey != want.primaryKey {
			return fmt.Errorf("workflow schema column %s.%s has unexpected type, nullability, or primary key", table, name)
		}
		if want.defaultValue != "" && normalizeSchemaSQL(got.defaultValue) != normalizeSchemaSQL(want.defaultValue) {
			return fmt.Errorf("workflow schema column %s.%s has default %q, want %q", table, name, got.defaultValue, want.defaultValue)
		}
	}
	return nil
}

func verifyWorkflowIndex(tx *sql.Tx, name string, expected expectedWorkflowIndex) error {
	var unique, partial int
	var origin string
	if err := tx.QueryRow(`SELECT "unique", origin, partial FROM pragma_index_list(?) WHERE name=?`, expected.table, name).Scan(&unique, &origin, &partial); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("workflow schema index %s is missing", name)
		}
		return err
	}
	if (unique != 0) != expected.unique || partial != 0 || origin != "c" {
		return fmt.Errorf("workflow schema index %s has unexpected uniqueness or origin", name)
	}
	rows, err := tx.Query(`SELECT name FROM pragma_index_info(?) ORDER BY seqno`, name)
	if err != nil {
		return err
	}
	defer rows.Close()
	columns := make([]string, 0, len(expected.columns))
	for rows.Next() {
		var column string
		if err = rows.Scan(&column); err != nil {
			return err
		}
		columns = append(columns, column)
	}
	if err = rows.Err(); err != nil {
		return err
	}
	if !equalStrings(columns, expected.columns) {
		return fmt.Errorf("workflow schema index %s has columns %v, want %v", name, columns, expected.columns)
	}
	return nil
}

func verifyWorkflowCompositeForeignKey(tx *sql.Tx, table, referencedTable string, from, to []string, onDelete string) error {
	rows, err := tx.Query(`PRAGMA foreign_key_list(` + quoteSQLiteIdentifier(table) + `)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	type part struct{ from, to, onDelete string }
	groups := make(map[int][]part)
	for rows.Next() {
		var id, sequence int
		var target, source, destination, onUpdate, deletion, match string
		if err = rows.Scan(&id, &sequence, &target, &source, &destination, &onUpdate, &deletion, &match); err != nil {
			return err
		}
		if target == referencedTable {
			groups[id] = append(groups[id], part{source, destination, deletion})
		}
	}
	if err = rows.Err(); err != nil {
		return err
	}
	for _, group := range groups {
		if len(group) != len(from) {
			continue
		}
		matched := make([]bool, len(from))
		ok := true
		for _, item := range group {
			found := false
			for i := range from {
				if !matched[i] && item.from == from[i] && item.to == to[i] && item.onDelete == onDelete {
					matched[i], found = true, true
					break
				}
			}
			if !found {
				ok = false
				break
			}
		}
		if ok {
			return nil
		}
	}
	return fmt.Errorf("workflow schema table %s is missing composite foreign key to %s", table, referencedTable)
}

func verifyWorkflowForeignKey(tx *sql.Tx, expected expectedWorkflowForeignKey) error {
	rows, err := tx.Query(`PRAGMA foreign_key_list(` + quoteSQLiteIdentifier(expected.table) + `)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id, sequence int
		var table, from, to, onUpdate, onDelete, match string
		if err = rows.Scan(&id, &sequence, &table, &from, &to, &onUpdate, &onDelete, &match); err != nil {
			return err
		}
		if from == expected.from && to == expected.to && onDelete == expected.onDelete {
			return nil
		}
	}
	if err = rows.Err(); err != nil {
		return err
	}
	return fmt.Errorf("workflow schema table %s is missing foreign key %s -> %s", expected.table, expected.from, expected.to)
}

func verifyWorkflowVersionForeignKey(tx *sql.Tx) error {
	rows, err := tx.Query(`PRAGMA foreign_key_list("workflow_runs")`)
	if err != nil {
		return err
	}
	defer rows.Close()
	type keyPart struct {
		from, to, onDelete string
	}
	groups := make(map[int][]keyPart)
	for rows.Next() {
		var id, sequence int
		var table, from, to, onUpdate, onDelete, match string
		if err = rows.Scan(&id, &sequence, &table, &from, &to, &onUpdate, &onDelete, &match); err != nil {
			return err
		}
		if table == "workflow_versions" {
			groups[id] = append(groups[id], keyPart{from: from, to: to, onDelete: onDelete})
		}
	}
	if err = rows.Err(); err != nil {
		return err
	}
	for _, parts := range groups {
		if len(parts) != 2 || parts[0].onDelete != "RESTRICT" || parts[1].onDelete != "RESTRICT" {
			continue
		}
		foundDefinition, foundVersion := false, false
		for _, part := range parts {
			if part.from == "definition_id" && part.to == "definition_id" {
				foundDefinition = true
			}
			if part.from == "version" && part.to == "version" {
				foundVersion = true
			}
		}
		if foundDefinition && foundVersion {
			return nil
		}
	}
	return errors.New("workflow schema is missing the workflow version composite foreign key")
}

func quoteSQLiteIdentifier(identifier string) string {
	return `"` + strings.ReplaceAll(identifier, `"`, `""`) + `"`
}

func normalizeSchemaSQL(value string) string {
	return strings.Join(strings.Fields(strings.ToLower(value)), "")
}

func equalStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func (r *SQLiteRepository) CreateDefinition(ownerID string, request CreateDefinitionRequest) (WorkflowDefinition, error) {
	if err := validOwner(ownerID); err != nil {
		return WorkflowDefinition{}, err
	}
	name := strings.TrimSpace(request.Name)
	if name == "" || len(name) > 200 {
		return WorkflowDefinition{}, fmt.Errorf("%w: name is required and must be at most 200 bytes", ErrValidation)
	}
	graph, err := request.Graph.Normalize()
	if err != nil {
		return WorkflowDefinition{}, err
	}
	id := request.ID
	if id == "" {
		id, err = newID("wf_")
		if err != nil {
			return WorkflowDefinition{}, err
		}
	}
	if err = validResourceID(id, "definition"); err != nil {
		return WorkflowDefinition{}, err
	}
	graphJSON, err := json.Marshal(graph)
	if err != nil {
		return WorkflowDefinition{}, err
	}
	checksum := checksum(graphJSON)
	now := nowMillis()
	tx, err := r.db.Begin()
	if err != nil {
		return WorkflowDefinition{}, err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`INSERT INTO workflow_definitions(id,owner_id,name,current_version,created_at) VALUES(?,?,?,1,?)`, id, ownerID, name, now); err != nil {
		return WorkflowDefinition{}, err
	}
	if _, err = tx.Exec(`INSERT INTO workflow_versions(definition_id,version,graph_json,checksum,created_at) VALUES(?,1,?,?,?)`, id, string(graphJSON), checksum, now); err != nil {
		return WorkflowDefinition{}, err
	}
	if err = tx.Commit(); err != nil {
		return WorkflowDefinition{}, err
	}
	return WorkflowDefinition{ID: id, OwnerID: ownerID, Name: name, CurrentVersion: 1, CreatedAt: now}, nil
}

func (r *SQLiteRepository) ListDefinitions(ownerID string) ([]WorkflowDefinition, error) {
	if err := validOwner(ownerID); err != nil {
		return nil, err
	}
	rows, err := r.db.Query(`SELECT id,owner_id,name,current_version,created_at FROM workflow_definitions WHERE owner_id=? ORDER BY created_at,id`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	definitions := make([]WorkflowDefinition, 0)
	for rows.Next() {
		var definition WorkflowDefinition
		if err = rows.Scan(&definition.ID, &definition.OwnerID, &definition.Name, &definition.CurrentVersion, &definition.CreatedAt); err != nil {
			return nil, err
		}
		definitions = append(definitions, definition)
	}
	return definitions, rows.Err()
}

func (r *SQLiteRepository) GetDefinition(ownerID, definitionID string) (WorkflowDefinition, error) {
	if err := validOwner(ownerID); err != nil {
		return WorkflowDefinition{}, err
	}
	var definition WorkflowDefinition
	err := r.db.QueryRow(`SELECT id,owner_id,name,current_version,created_at FROM workflow_definitions WHERE owner_id=? AND id=?`, ownerID, definitionID).Scan(&definition.ID, &definition.OwnerID, &definition.Name, &definition.CurrentVersion, &definition.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return WorkflowDefinition{}, ErrNotFound
	}
	return definition, err
}

func (r *SQLiteRepository) CreateVersion(ownerID, definitionID string, graph WorkflowGraph) (WorkflowVersion, error) {
	if err := validOwner(ownerID); err != nil {
		return WorkflowVersion{}, err
	}
	normalized, err := graph.Normalize()
	if err != nil {
		return WorkflowVersion{}, err
	}
	raw, err := json.Marshal(normalized)
	if err != nil {
		return WorkflowVersion{}, err
	}
	now := nowMillis()
	tx, err := r.db.Begin()
	if err != nil {
		return WorkflowVersion{}, err
	}
	defer tx.Rollback()
	var current uint64
	if err = tx.QueryRow(`SELECT current_version FROM workflow_definitions WHERE owner_id=? AND id=?`, ownerID, definitionID).Scan(&current); errors.Is(err, sql.ErrNoRows) {
		return WorkflowVersion{}, ErrNotFound
	} else if err != nil {
		return WorkflowVersion{}, err
	}
	next := current + 1
	if _, err = tx.Exec(`INSERT INTO workflow_versions(definition_id,version,graph_json,checksum,created_at) VALUES(?,?,?,?,?)`, definitionID, next, string(raw), checksum(raw), now); err != nil {
		return WorkflowVersion{}, err
	}
	if _, err = tx.Exec(`UPDATE workflow_definitions SET current_version=? WHERE owner_id=? AND id=? AND current_version=?`, next, ownerID, definitionID, current); err != nil {
		return WorkflowVersion{}, err
	}
	if err = tx.Commit(); err != nil {
		return WorkflowVersion{}, err
	}
	return WorkflowVersion{DefinitionID: definitionID, OwnerID: ownerID, Version: next, Graph: normalized, Checksum: checksum(raw), CreatedAt: now}, nil
}

func (r *SQLiteRepository) GetVersion(ownerID, definitionID string, version uint64) (WorkflowVersion, error) {
	if err := validOwner(ownerID); err != nil {
		return WorkflowVersion{}, err
	}
	var raw string
	var result WorkflowVersion
	err := r.db.QueryRow(`SELECT d.owner_id,v.version,v.graph_json,v.checksum,v.created_at FROM workflow_versions v JOIN workflow_definitions d ON d.id=v.definition_id WHERE d.owner_id=? AND v.definition_id=? AND v.version=?`, ownerID, definitionID, version).Scan(&result.OwnerID, &result.Version, &raw, &result.Checksum, &result.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return WorkflowVersion{}, ErrNotFound
	}
	if err != nil {
		return WorkflowVersion{}, err
	}
	if checksum([]byte(raw)) != result.Checksum {
		return WorkflowVersion{}, fmt.Errorf("%w: workflow version checksum mismatch", ErrValidation)
	}
	result.DefinitionID = definitionID
	if err = json.Unmarshal([]byte(raw), &result.Graph); err != nil {
		return WorkflowVersion{}, fmt.Errorf("decode workflow version: %w", err)
	}
	if result.Graph, err = result.Graph.Normalize(); err != nil {
		return WorkflowVersion{}, err
	}
	return result, nil
}

func (r *SQLiteRepository) CreateRun(ownerID string, request CreateRunRequest) (WorkflowRun, error) {
	if err := validOwner(ownerID); err != nil {
		return WorkflowRun{}, err
	}
	if err := validResourceID(request.DefinitionID, "definition"); err != nil {
		return WorkflowRun{}, err
	}
	runID := request.ID
	if runID == "" {
		var err error
		runID, err = newID("wr_")
		if err != nil {
			return WorkflowRun{}, err
		}
	}
	if err := validResourceID(runID, "run"); err != nil {
		return WorkflowRun{}, err
	}
	input, err := canonicalJSON(request.Input)
	if err != nil {
		return WorkflowRun{}, fmt.Errorf("%w: run input: %v", ErrValidation, err)
	}
	metadata := json.RawMessage(`{}`)
	if request.Metadata != nil {
		metadataRaw, marshalErr := json.Marshal(request.Metadata)
		if marshalErr != nil {
			return WorkflowRun{}, fmt.Errorf("%w: metadata: %v", ErrValidation, marshalErr)
		}
		metadata, err = canonicalJSON(metadataRaw)
		if err != nil {
			return WorkflowRun{}, fmt.Errorf("%w: metadata: %v", ErrValidation, err)
		}
	}
	now := nowMillis()
	tx, err := r.db.Begin()
	if err != nil {
		return WorkflowRun{}, err
	}
	defer tx.Rollback()
	var version uint64
	var graphRaw, graphChecksum string
	if request.Version == 0 {
		err = tx.QueryRow(`SELECT current_version FROM workflow_definitions WHERE owner_id=? AND id=?`, ownerID, request.DefinitionID).Scan(&version)
	} else {
		version = request.Version
		err = tx.QueryRow(`SELECT v.version FROM workflow_versions v JOIN workflow_definitions d ON d.id=v.definition_id WHERE d.owner_id=? AND v.definition_id=? AND v.version=?`, ownerID, request.DefinitionID, version).Scan(&version)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return WorkflowRun{}, ErrNotFound
	}
	if err != nil {
		return WorkflowRun{}, err
	}
	if err = tx.QueryRow(`SELECT graph_json,checksum FROM workflow_versions WHERE definition_id=? AND version=?`, request.DefinitionID, version).Scan(&graphRaw, &graphChecksum); err != nil {
		return WorkflowRun{}, err
	}
	if checksum([]byte(graphRaw)) != graphChecksum {
		return WorkflowRun{}, fmt.Errorf("%w: workflow version checksum mismatch", ErrValidation)
	}
	var graph WorkflowGraph
	if err = json.Unmarshal([]byte(graphRaw), &graph); err != nil {
		return WorkflowRun{}, fmt.Errorf("decode workflow graph: %w", err)
	}
	if graph, err = graph.Normalize(); err != nil {
		return WorkflowRun{}, err
	}
	state := map[string]interface{}{"definitionId": request.DefinitionID, "version": version, "status": RunQueued, "revision": uint64(1)}
	stateRaw, err := json.Marshal(state)
	if err != nil {
		return WorkflowRun{}, err
	}
	if _, err = tx.Exec(`INSERT INTO task_runs(id,owner_id,kind,status,attempt,resource_class,created_at,updated_at,metadata_json,state_json,revision) VALUES(?,?, 'workflow','queued',0,'default',?,?,?,?,1)`, runID, ownerID, now, now, string(metadata), string(stateRaw)); err != nil {
		return WorkflowRun{}, err
	}
	if _, err = tx.Exec(`INSERT INTO workflow_runs(run_id,owner_id,definition_id,version,input_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`, runID, ownerID, request.DefinitionID, version, string(input), now, now); err != nil {
		return WorkflowRun{}, err
	}
	steps := make([]WorkflowStep, len(graph.Steps))
	for i, step := range graph.Steps {
		dependencies := make([]string, len(step.Dependencies))
		copy(dependencies, step.Dependencies)
		dependenciesRaw, marshalErr := json.Marshal(dependencies)
		if marshalErr != nil {
			return WorkflowRun{}, marshalErr
		}
		steps[i] = WorkflowStep{ID: step.ID, StepType: step.StepType, Status: StepQueued, Dependencies: dependencies, Attempt: 0, Revision: 1, Input: append(json.RawMessage(nil), step.Input...)}
		if _, err = tx.Exec(`INSERT INTO workflow_steps(run_id,step_id,status,input_json,dependencies_json,attempt,revision,step_type) VALUES(?,?,?,?,?,0,1,?)`, runID, step.ID, StepQueued, string(step.Input), string(dependenciesRaw), step.StepType); err != nil {
			return WorkflowRun{}, err
		}
	}
	if _, err = tx.Exec(`INSERT INTO workflow_event_cursors(run_id,next_sequence,updated_at) VALUES(?,?,?)`, runID, 2, now); err != nil {
		return WorkflowRun{}, err
	}
	eventData, err := json.Marshal(map[string]interface{}{"definitionId": request.DefinitionID, "version": version})
	if err != nil {
		return WorkflowRun{}, err
	}
	if _, err = tx.Exec(`INSERT INTO workflow_events(run_id,sequence,event_type,timestamp,event_json) VALUES(?,?,?,?,?)`, runID, 1, "run.created", now, string(eventData)); err != nil {
		return WorkflowRun{}, err
	}
	if err = tx.Commit(); err != nil {
		return WorkflowRun{}, err
	}
	return WorkflowRun{ID: runID, OwnerID: ownerID, DefinitionID: request.DefinitionID, Version: version, Status: RunQueued, Revision: 1, Input: input, CreatedAt: now, UpdatedAt: now, Steps: steps}, nil
}

func (r *SQLiteRepository) ListRuns(ownerID string) ([]WorkflowRun, error) {
	if err := validOwner(ownerID); err != nil {
		return nil, err
	}
	rows, err := r.db.Query(runSelect+` WHERE wr.owner_id=? ORDER BY wr.created_at,wr.run_id`, ownerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]WorkflowRun, 0)
	for rows.Next() {
		run, err := scanRun(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, *run)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	// persistence.Open intentionally uses one SQLite connection. Close the run
	// cursor before loading child rows or a nested query would wait forever.
	if err = rows.Close(); err != nil {
		return nil, err
	}
	for i := range result {
		if err = r.loadSteps(&result[i]); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func (r *SQLiteRepository) GetRun(ownerID, runID string) (WorkflowRun, error) {
	if err := validOwner(ownerID); err != nil {
		return WorkflowRun{}, err
	}
	run, err := r.getRun(ownerID, runID)
	if err != nil {
		return WorkflowRun{}, err
	}
	if err = r.loadSteps(run); err != nil {
		return WorkflowRun{}, err
	}
	return *run, nil
}

const runSelect = `SELECT wr.run_id,wr.owner_id,wr.definition_id,wr.version,t.status,t.revision,wr.input_json,wr.created_at,wr.updated_at,COALESCE(t.started_at,0),COALESCE(t.finished_at,0),COALESCE(t.error_code,''),COALESCE(t.error_summary,'') FROM workflow_runs wr JOIN task_runs t ON t.id=wr.run_id AND t.kind='workflow'`

type rowScanner interface{ Scan(...interface{}) error }

func scanRun(row rowScanner) (*WorkflowRun, error) {
	var run WorkflowRun
	var input string
	if err := row.Scan(&run.ID, &run.OwnerID, &run.DefinitionID, &run.Version, &run.Status, &run.Revision, &input, &run.CreatedAt, &run.UpdatedAt, &run.StartedAt, &run.FinishedAt, &run.ErrorCode, &run.ErrorSummary); err != nil {
		return nil, err
	}
	if !run.Status.Valid() {
		return nil, fmt.Errorf("%w: invalid run status", ErrValidation)
	}
	if run.Revision == 0 {
		return nil, fmt.Errorf("%w: invalid run revision", ErrValidation)
	}
	run.Input = json.RawMessage(input)
	run.Steps = make([]WorkflowStep, 0)
	return &run, nil
}

func (r *SQLiteRepository) getRun(ownerID, runID string) (*WorkflowRun, error) {
	row := r.db.QueryRow(runSelect+` WHERE wr.owner_id=? AND wr.run_id=?`, ownerID, runID)
	run, err := scanRun(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return run, err
}

func (r *SQLiteRepository) loadSteps(run *WorkflowRun) error {
	rows, err := r.db.Query(`SELECT step_id,step_type,status,dependencies_json,attempt,revision,input_json,COALESCE(output_json,''),COALESCE(error_summary,''),COALESCE(started_at,0),COALESCE(finished_at,0) FROM workflow_steps WHERE run_id=? ORDER BY step_id`, run.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var step WorkflowStep
		var dependencies, input, output string
		if err = rows.Scan(&step.ID, &step.StepType, &step.Status, &dependencies, &step.Attempt, &step.Revision, &input, &output, &step.ErrorSummary, &step.StartedAt, &step.FinishedAt); err != nil {
			return err
		}
		if err = json.Unmarshal([]byte(dependencies), &step.Dependencies); err != nil {
			return fmt.Errorf("decode workflow step dependencies: %w", err)
		}
		step.Input = json.RawMessage(input)
		if output != "" {
			step.Output = json.RawMessage(output)
		}
		run.Steps = append(run.Steps, step)
	}
	return rows.Err()
}

func (r *SQLiteRepository) TransitionRun(ownerID, runID string, expectedRevision uint64, request TransitionRequest) (WorkflowRun, error) {
	if err := validOwner(ownerID); err != nil {
		return WorkflowRun{}, err
	}
	if !request.To.Valid() {
		return WorkflowRun{}, fmt.Errorf("%w: unknown target status %q", ErrValidation, request.To)
	}
	if request.EventType == "" {
		request.EventType = "run.transition"
	}
	request.EventType = strings.TrimSpace(request.EventType)
	if len(request.EventType) > 128 || strings.TrimSpace(request.EventType) == "" {
		return WorkflowRun{}, fmt.Errorf("%w: invalid event type", ErrValidation)
	}
	if len(request.ErrorCode) > 128 || len(request.ErrorSummary) > 2048 {
		return WorkflowRun{}, fmt.Errorf("%w: transition error metadata is too long", ErrValidation)
	}
	data, err := canonicalJSON(request.Data)
	if err != nil {
		return WorkflowRun{}, fmt.Errorf("%w: event data: %v", ErrValidation, err)
	}
	tx, err := r.db.Begin()
	if err != nil {
		return WorkflowRun{}, err
	}
	defer tx.Rollback()
	var current RunStatus
	var currentRevision uint64
	var definitionID string
	var version uint64
	var input string
	var createdAt, updatedAt, startedAt, finishedAt int64
	var errorCode, errorSummary string
	err = tx.QueryRow(`SELECT wr.definition_id,wr.version,wr.input_json,wr.created_at,wr.updated_at,t.status,t.revision,COALESCE(t.started_at,0),COALESCE(t.finished_at,0),COALESCE(t.error_code,''),COALESCE(t.error_summary,'') FROM workflow_runs wr JOIN task_runs t ON t.id=wr.run_id AND t.kind='workflow' WHERE wr.owner_id=? AND wr.run_id=?`, ownerID, runID).Scan(&definitionID, &version, &input, &createdAt, &updatedAt, &current, &currentRevision, &startedAt, &finishedAt, &errorCode, &errorSummary)
	if errors.Is(err, sql.ErrNoRows) {
		return WorkflowRun{}, ErrNotFound
	}
	if err != nil {
		return WorkflowRun{}, err
	}
	if currentRevision != expectedRevision {
		return WorkflowRun{}, ErrConflict
	}
	if current.Terminal() {
		return WorkflowRun{}, ErrTerminal
	}
	if !canTransition(current, request.To) {
		return WorkflowRun{}, fmt.Errorf("%w: %s -> %s", ErrInvalidTransition, current, request.To)
	}
	if request.To == RunSucceeded {
		var stepCount, incompleteSteps int
		if err = tx.QueryRow(`SELECT COUNT(*),COALESCE(SUM(CASE WHEN status<>? THEN 1 ELSE 0 END),0) FROM workflow_steps WHERE run_id=?`, StepSucceeded, runID).Scan(&stepCount, &incompleteSteps); err != nil {
			return WorkflowRun{}, err
		}
		if stepCount == 0 || incompleteSteps != 0 {
			return WorkflowRun{}, ErrIncompleteSteps
		}
	}
	now := nowMillis()
	if request.To == RunRunning && startedAt == 0 {
		startedAt = now
	}
	if request.To.Terminal() {
		finishedAt = now
	}
	state, err := json.Marshal(map[string]interface{}{"definitionId": definitionID, "version": version, "status": request.To, "revision": currentRevision + 1})
	if err != nil {
		return WorkflowRun{}, err
	}
	result, err := tx.Exec(`UPDATE task_runs SET status=?,revision=?,state_json=?,updated_at=?,started_at=?,finished_at=?,error_code=?,error_summary=? WHERE id=? AND owner_id=? AND kind='workflow' AND revision=?`, request.To, currentRevision+1, string(state), now, nullableTime(startedAt), nullableTime(finishedAt), nullableString(request.ErrorCode), nullableString(request.ErrorSummary), runID, ownerID, expectedRevision)
	if err != nil {
		return WorkflowRun{}, err
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return WorkflowRun{}, ErrConflict
	}
	if _, err = tx.Exec(`UPDATE workflow_runs SET updated_at=? WHERE run_id=? AND owner_id=?`, now, runID, ownerID); err != nil {
		return WorkflowRun{}, err
	}
	var sequence uint64
	if err = tx.QueryRow(`SELECT next_sequence FROM workflow_event_cursors WHERE run_id=?`, runID).Scan(&sequence); err != nil {
		return WorkflowRun{}, err
	}
	eventData := data
	if string(data) == "{}" {
		eventData, err = json.Marshal(map[string]interface{}{"from": current, "to": request.To})
		if err != nil {
			return WorkflowRun{}, err
		}
	}
	if _, err = tx.Exec(`INSERT INTO workflow_events(run_id,sequence,event_type,timestamp,event_json) VALUES(?,?,?,?,?)`, runID, sequence, request.EventType, now, string(eventData)); err != nil {
		return WorkflowRun{}, err
	}
	if _, err = tx.Exec(`UPDATE workflow_event_cursors SET next_sequence=?,updated_at=? WHERE run_id=?`, sequence+1, now, runID); err != nil {
		return WorkflowRun{}, err
	}
	if err = tx.Commit(); err != nil {
		return WorkflowRun{}, err
	}
	run := WorkflowRun{ID: runID, OwnerID: ownerID, DefinitionID: definitionID, Version: version, Status: request.To, Revision: currentRevision + 1, Input: json.RawMessage(input), CreatedAt: createdAt, UpdatedAt: now, StartedAt: startedAt, FinishedAt: finishedAt, ErrorCode: request.ErrorCode, ErrorSummary: request.ErrorSummary}
	if err = r.loadSteps(&run); err != nil {
		return WorkflowRun{}, err
	}
	return run, nil
}

func (r *SQLiteRepository) ListEvents(ownerID, runID string, afterSequence uint64, limit int) ([]WorkflowEvent, error) {
	if err := validOwner(ownerID); err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 1000
	}
	if limit > MaxEventLimit {
		limit = MaxEventLimit
	}
	var exists int
	if err := r.db.QueryRow(`SELECT COUNT(*) FROM workflow_runs WHERE owner_id=? AND run_id=?`, ownerID, runID).Scan(&exists); err != nil {
		return nil, err
	}
	if exists == 0 {
		return nil, ErrNotFound
	}
	rows, err := r.db.Query(`SELECT sequence,event_type,timestamp,event_json FROM workflow_events WHERE run_id=? AND sequence>? ORDER BY sequence LIMIT ?`, runID, afterSequence, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := make([]WorkflowEvent, 0)
	for rows.Next() {
		var event WorkflowEvent
		var raw string
		if err = rows.Scan(&event.Sequence, &event.Type, &event.Timestamp, &raw); err != nil {
			return nil, err
		}
		event.RunID, event.OwnerID, event.Data = runID, ownerID, json.RawMessage(raw)
		events = append(events, event)
	}
	return events, rows.Err()
}

func checksum(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func nowMillis() int64 { return time.Now().UTC().UnixMilli() }

func nullableTime(value int64) interface{} {
	if value == 0 {
		return nil
	}
	return value
}

func nullableString(value string) interface{} {
	if value == "" {
		return nil
	}
	return value
}
