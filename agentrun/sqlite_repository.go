package agentrun

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"ai-server-studio-backend/persistence"
)

var (
	ErrTerminal = errors.New("agent run is terminal")
)

type SQLiteRepository struct{ db *sql.DB }

func nullString(value string) interface{} {
	if value == "" {
		return nil
	}
	return value
}

func errorCode(value string) interface{} {
	if value == "" {
		return nil
	}
	return "agent_run_error"
}

func NewSQLiteRepository(db *sql.DB) (*SQLiteRepository, error) {
	if db == nil {
		return nil, errors.New("database unavailable")
	}
	if err := persistence.ApplyMigration(db, "agentrun/1",
		`CREATE TABLE agent_runs (
		 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE CHECK(length(trim(owner_id))>0),
		 status TEXT NOT NULL CHECK(status IN ('queued','running','awaiting_approval','done','error','canceled')),
		 revision INTEGER NOT NULL CHECK(revision>0), state_json TEXT NOT NULL CHECK(json_valid(state_json)),
		 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
		`CREATE INDEX agent_runs_owner ON agent_runs(owner_id, created_at)`,
		`CREATE TABLE run_events (
		 run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
		 sequence INTEGER NOT NULL CHECK(sequence>0), event_type TEXT NOT NULL,
		 timestamp INTEGER NOT NULL, event_json TEXT NOT NULL CHECK(json_valid(event_json)),
		 PRIMARY KEY(run_id, sequence))`,
		`CREATE TABLE run_checkpoints (
		 run_id TEXT PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,
		 event_sequence INTEGER NOT NULL CHECK(event_sequence>=0), updated_at INTEGER NOT NULL,
		 checkpoint_json TEXT NOT NULL CHECK(json_valid(checkpoint_json)))`,
		`CREATE TABLE agent_run_imports (
		 source TEXT PRIMARY KEY, sha256 TEXT NOT NULL, version INTEGER NOT NULL,
		 run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE, event_count INTEGER NOT NULL,
			 imported_at TEXT NOT NULL)`); err != nil {
		return nil, err
	}
	if err := persistence.ApplyMigrationWithVerifier(db, "agentrun/2-task-runs", verifyTaskRunMigrationTx,
		`CREATE TABLE IF NOT EXISTS task_runs (
			id TEXT PRIMARY KEY,
			owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE CHECK(length(trim(owner_id))>0),
			kind TEXT NOT NULL CHECK(kind IN ('single_action','agent','workflow')),
			status TEXT NOT NULL CHECK(status IN ('queued','validating','running','waiting','waiting_approval','blocked_policy','succeeded','failed','cancelled','interrupted')),
			attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt>=0),
			resource_class TEXT NOT NULL DEFAULT 'default',
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			started_at INTEGER,
			finished_at INTEGER,
			error_code TEXT,
			error_summary TEXT,
			parent_run_id TEXT REFERENCES task_runs(id) ON DELETE SET NULL,
			metadata_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata_json)),
			state_json TEXT NOT NULL CHECK(json_valid(state_json)),
			revision INTEGER NOT NULL CHECK(revision>0)
		)`,
		`CREATE INDEX IF NOT EXISTS task_runs_owner_created ON task_runs(owner_id, created_at, id)`,
		`INSERT OR IGNORE INTO task_runs(id,owner_id,kind,status,attempt,resource_class,created_at,updated_at,started_at,finished_at,error_code,error_summary,parent_run_id,metadata_json,state_json,revision)
		 SELECT id,owner_id,'agent',CASE status WHEN 'done' THEN 'succeeded' WHEN 'error' THEN 'failed' WHEN 'canceled' THEN 'cancelled' WHEN 'awaiting_approval' THEN 'waiting_approval' ELSE status END,0,'default',created_at,updated_at,
		 NULLIF(json_extract(state_json,'$.startedAt'),0),NULLIF(json_extract(state_json,'$.completedAt'),0),NULL,NULL,NULL,'{}',state_json,revision FROM agent_runs`,
	); err != nil {
		return nil, err
	}
	return &SQLiteRepository{db: db}, nil
}

func backfillTaskRuns(db *sql.DB) error {
	rows, err := db.Query(`SELECT id,owner_id,status,revision,state_json,created_at,updated_at FROM agent_runs`)
	if err != nil {
		return err
	}
	type legacy struct {
		id, owner, status, state   string
		revision, created, updated int64
	}
	legacyRows := make([]legacy, 0)
	for rows.Next() {
		var item legacy
		if err := rows.Scan(&item.id, &item.owner, &item.status, &item.revision, &item.state, &item.created, &item.updated); err != nil {
			rows.Close()
			return err
		}
		legacyRows = append(legacyRows, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, item := range legacyRows {
		var state struct {
			StartedAt   int64 `json:"startedAt"`
			CompletedAt int64 `json:"completedAt"`
		}
		if err := json.Unmarshal([]byte(item.state), &state); err != nil {
			return fmt.Errorf("decode legacy task run %s: %w", item.id, err)
		}
		if _, err := tx.Exec(`INSERT OR IGNORE INTO task_runs(id,owner_id,kind,status,attempt,resource_class,created_at,updated_at,started_at,finished_at,error_code,error_summary,parent_run_id,metadata_json,state_json,revision)
			VALUES(?,?, 'agent',?,0,'default',?,?,?,?,NULL,NULL,NULL,'{}',?,?)`,
			item.id, item.owner, taskStatus(Status(item.status)), item.created, item.updated,
			nullInt(state.StartedAt), nullInt(state.CompletedAt), item.state, item.revision); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func nullInt(value int64) interface{} {
	if value == 0 {
		return nil
	}
	return value
}

func verifyTaskRunMigrationTx(tx *sql.Tx) error {
	var missing int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM agent_runs a LEFT JOIN task_runs t ON t.id=a.id WHERE t.id IS NULL`).Scan(&missing); err != nil {
		return err
	}
	if missing != 0 {
		return fmt.Errorf("task-run migration lost %d agent runs", missing)
	}
	var mismatched int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM agent_runs a JOIN task_runs t ON t.id=a.id WHERE t.owner_id<>a.owner_id OR t.revision<>a.revision OR t.state_json<>a.state_json OR t.status<>CASE a.status WHEN 'done' THEN 'succeeded' WHEN 'error' THEN 'failed' WHEN 'canceled' THEN 'cancelled' WHEN 'awaiting_approval' THEN 'waiting_approval' ELSE a.status END`).Scan(&mismatched); err != nil {
		return err
	}
	if mismatched != 0 {
		return fmt.Errorf("task-run migration found %d inconsistent rows", mismatched)
	}
	return nil
}

func (r *SQLiteRepository) Save(run Run) error {
	tx, err := r.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err = saveSQLiteRun(tx, run); err != nil {
		return err
	}
	return tx.Commit()
}

// Create atomically performs caller-supplied-ID creation. A retry for an
// existing ID returns the committed durable state when immutable creation
// fields match; it never rewrites the existing row or appends its events.
func (r *SQLiteRepository) Create(run Run) (Run, error) {
	if err := validateRun(run); err != nil {
		return Run{}, err
	}
	tx, err := r.db.Begin()
	if err != nil {
		return Run{}, err
	}
	defer tx.Rollback()

	var existingID string
	err = tx.QueryRow(`SELECT id FROM task_runs WHERE id=?`, run.ID).Scan(&existingID)
	switch {
	case err == nil:
		existing, loadErr := loadSQLiteRunTx(tx, existingID)
		if loadErr != nil {
			return Run{}, loadErr
		}
		if conflictErr := creationConflict(existing, run); conflictErr != nil {
			return Run{}, conflictErr
		}
		if err = tx.Commit(); err != nil {
			return Run{}, err
		}
		return existing, nil
	case !errors.Is(err, sql.ErrNoRows):
		return Run{}, err
	}

	if err = saveSQLiteRunWithInitialRevision(tx, run, true); err != nil {
		return Run{}, err
	}
	if err = tx.Commit(); err != nil {
		return Run{}, err
	}
	return run, nil
}

func saveSQLiteRun(tx *sql.Tx, run Run) error {
	return saveSQLiteRunWithInitialRevision(tx, run, false)
}

func saveSQLiteRunWithInitialRevision(tx *sql.Tx, run Run, allowInitialRevision bool) error {
	if err := validateRun(run); err != nil {
		return err
	}
	if strings.TrimSpace(run.OwnerID) == "" || run.Revision == 0 {
		return fmt.Errorf("%w: owner and revision required", ErrCorrupt)
	}
	var priorTaskStatus string
	var priorOwner string
	var priorRevision uint64
	err := tx.QueryRow(`SELECT status,owner_id,revision FROM task_runs WHERE id=?`, run.ID).Scan(&priorTaskStatus, &priorOwner, &priorRevision)
	exists := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if exists {
		priorStatus, ok := agentStatus(priorTaskStatus)
		if !ok {
			return fmt.Errorf("%w: invalid canonical status %q", ErrCorrupt, priorTaskStatus)
		}
		if priorStatus.Terminal() {
			return ErrTerminal
		}
		if run.OwnerID != priorOwner || run.Revision != priorRevision+1 {
			return ErrConflict
		}
	} else if run.Revision != 1 && !allowInitialRevision {
		return ErrConflict
	}

	// The durable log is append-only. Reject stale prefixes or attempts to rewrite
	// history even when a caller guesses the next revision.
	rows, err := tx.Query(`SELECT event_json FROM run_events WHERE run_id=? ORDER BY sequence`, run.ID)
	if err != nil {
		return err
	}
	count := 0
	for rows.Next() {
		var raw []byte
		if err = rows.Scan(&raw); err != nil {
			rows.Close()
			return err
		}
		if count >= len(run.Events) {
			rows.Close()
			return ErrConflict
		}
		encoded, encodeErr := json.Marshal(run.Events[count])
		if encodeErr != nil {
			rows.Close()
			return encodeErr
		}
		if !bytes.Equal(raw, encoded) {
			rows.Close()
			return ErrConflict
		}
		count++
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	state := run
	state.Events = nil
	state.Checkpoint = nil
	raw, err := json.Marshal(state)
	if err != nil {
		return err
	}
	canonical := taskStatus(run.Status)
	finishedAt := interface{}(nil)
	if run.CompletedAt > 0 {
		finishedAt = run.CompletedAt
	}
	startedAt := interface{}(nil)
	if run.StartedAt > 0 {
		startedAt = run.StartedAt
	}
	if exists {
		_, err = tx.Exec(`UPDATE task_runs SET status=?,revision=?,state_json=?,updated_at=?,started_at=?,finished_at=?,error_code=?,error_summary=? WHERE id=?`, canonical, run.Revision, string(raw), run.UpdatedAt, startedAt, finishedAt, errorCode(run.Error), nullString(run.Error), run.ID)
		if err == nil {
			_, err = tx.Exec(`UPDATE agent_runs SET status=?,revision=?,state_json=?,updated_at=? WHERE id=?`, run.Status, run.Revision, string(raw), run.UpdatedAt, run.ID)
		}
	} else {
		_, err = tx.Exec(`INSERT INTO task_runs(id,owner_id,kind,status,attempt,resource_class,created_at,updated_at,started_at,finished_at,error_code,error_summary,parent_run_id,metadata_json,state_json,revision) VALUES(?,?, 'agent',?,0,'default',?,?,?,?,?,?,NULL,'{}',?,?)`, run.ID, run.OwnerID, canonical, run.CreatedAt, run.UpdatedAt, startedAt, finishedAt, errorCode(run.Error), nullString(run.Error), string(raw), run.Revision)
		if err == nil {
			_, err = tx.Exec(`INSERT INTO agent_runs VALUES(?,?,?,?,?,?,?)`, run.ID, run.OwnerID, run.Status, run.Revision, string(raw), run.CreatedAt, run.UpdatedAt)
		}
	}
	if err != nil {
		return err
	}
	for _, event := range run.Events[count:] {
		raw, err = json.Marshal(event)
		if err != nil {
			return err
		}
		if _, err = tx.Exec(`INSERT INTO run_events VALUES(?,?,?,?,?)`, run.ID, event.Sequence, event.Type, event.Timestamp, string(raw)); err != nil {
			return err
		}
	}
	if run.Checkpoint != nil {
		raw, err = json.Marshal(run.Checkpoint)
		if err != nil {
			return err
		}
		_, err = tx.Exec(`INSERT INTO run_checkpoints VALUES(?,?,?,?) ON CONFLICT(run_id) DO UPDATE SET event_sequence=excluded.event_sequence,updated_at=excluded.updated_at,checkpoint_json=excluded.checkpoint_json`,
			run.ID, run.Checkpoint.EventSequence, run.Checkpoint.UpdatedAt, string(raw))
	} else {
		_, err = tx.Exec(`DELETE FROM run_checkpoints WHERE run_id=?`, run.ID)
	}
	return err
}

func loadSQLiteRunTx(tx *sql.Tx, id string) (Run, error) {
	var raw []byte
	var run Run
	var owner string
	var canonical string
	var revision uint64
	err := tx.QueryRow(`SELECT state_json,owner_id,status,revision,created_at,updated_at,COALESCE(started_at,0),COALESCE(finished_at,0) FROM task_runs WHERE id=?`, id).
		Scan(&raw, &owner, &canonical, &revision, &run.CreatedAt, &run.UpdatedAt, &run.StartedAt, &run.CompletedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Run{}, fmt.Errorf("%w: run %q not found", ErrCorrupt, id)
		}
		return Run{}, err
	}
	if err = json.Unmarshal(raw, &run); err != nil {
		return Run{}, fmt.Errorf("%w: invalid state", ErrCorrupt)
	}
	status, ok := agentStatus(canonical)
	if !ok || run.ID != id || run.OwnerID != owner || run.Status != status || run.Revision != revision {
		return Run{}, ErrCorrupt
	}
	run.Events = make([]RunEvent, 0)
	rows, err := tx.Query(`SELECT event_json FROM run_events WHERE run_id=? ORDER BY sequence`, id)
	if err != nil {
		return Run{}, err
	}
	for rows.Next() {
		var eventRaw []byte
		var event RunEvent
		if err = rows.Scan(&eventRaw); err != nil {
			rows.Close()
			return Run{}, err
		}
		if err = json.Unmarshal(eventRaw, &event); err != nil {
			rows.Close()
			return Run{}, ErrCorrupt
		}
		run.Events = append(run.Events, event)
	}
	if err = rows.Err(); err != nil {
		rows.Close()
		return Run{}, err
	}
	rows.Close()

	var checkpoint []byte
	err = tx.QueryRow(`SELECT checkpoint_json FROM run_checkpoints WHERE run_id=?`, id).Scan(&checkpoint)
	if err == nil {
		if err = json.Unmarshal(checkpoint, &run.Checkpoint); err != nil {
			return Run{}, ErrCorrupt
		}
	} else if !errors.Is(err, sql.ErrNoRows) {
		return Run{}, err
	}
	if err = validateRun(run); err != nil {
		return Run{}, err
	}
	return run, nil
}

func (r *SQLiteRepository) List() ([]Run, error) {
	// A read transaction yields a consistent run/event/checkpoint snapshot.
	tx, err := r.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	rows, err := tx.Query(`SELECT state_json,owner_id,status,revision,created_at,updated_at,COALESCE(started_at,0),COALESCE(finished_at,0) FROM task_runs WHERE kind='agent' ORDER BY created_at,id`)
	if err != nil {
		return nil, err
	}
	runs := make([]Run, 0)
	for rows.Next() {
		var raw []byte
		var run Run
		var owner string
		var status Status
		var revision uint64
		var canonical string
		if err = rows.Scan(&raw, &owner, &canonical, &revision, &run.CreatedAt, &run.UpdatedAt, &run.StartedAt, &run.CompletedAt); err != nil {
			rows.Close()
			return nil, err
		}
		if err = json.Unmarshal(raw, &run); err != nil {
			rows.Close()
			return nil, fmt.Errorf("%w: invalid state", ErrCorrupt)
		}
		status, ok := agentStatus(canonical)
		if !ok || run.OwnerID != owner || run.Status != status || run.Revision != revision {
			rows.Close()
			return nil, ErrCorrupt
		}
		run.Events = make([]RunEvent, 0)
		runs = append(runs, run)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	for i := range runs {
		run := &runs[i]
		rows, err = tx.Query(`SELECT event_json FROM run_events WHERE run_id=? ORDER BY sequence`, run.ID)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var raw []byte
			var event RunEvent
			if err = rows.Scan(&raw); err != nil {
				rows.Close()
				return nil, err
			}
			if err = json.Unmarshal(raw, &event); err != nil {
				rows.Close()
				return nil, ErrCorrupt
			}
			run.Events = append(run.Events, event)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
		var checkpoint []byte
		err = tx.QueryRow(`SELECT checkpoint_json FROM run_checkpoints WHERE run_id=?`, run.ID).Scan(&checkpoint)
		if err == nil {
			if err = json.Unmarshal(checkpoint, &run.Checkpoint); err != nil {
				return nil, ErrCorrupt
			}
		} else if !errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		if err = validateRun(*run); err != nil {
			return nil, err
		}
	}
	if err = tx.Commit(); err != nil {
		return nil, err
	}
	return runs, nil
}
