// Package toolcalls owns durable tool-execution state and file-backed outputs.
// SQLite is the source of truth; the portable toolcalls tree is reserved for
// large results and generated artifacts so it never becomes a second ledger.
package toolcalls

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ai-server-studio-backend/persistence"
	"github.com/google/uuid"
)

const (
	maxJSONBytes     = 1 << 20
	maxArtifactBytes = 16 << 20
)

var ErrNotFound = errors.New("tool call not found")

type Status string

const (
	StatusRunning   Status = "running"
	StatusSucceeded Status = "succeeded"
	StatusFailed    Status = "failed"
	StatusCanceled  Status = "canceled"
)

type Record struct {
	ID          string `json:"id"`
	CallID      string `json:"callId,omitempty"`
	ParentRunID string `json:"parentRunId,omitempty"`
	OwnerID     string `json:"ownerId"`
	ToolName    string `json:"toolName"`
	Attempt     int    `json:"attempt"`
	Status      Status `json:"status"`
	Arguments   string `json:"arguments"`
	Result      string `json:"result,omitempty"`
	Error       string `json:"error,omitempty"`
	Artifact    string `json:"artifact,omitempty"`
	StartedAt   int64  `json:"startedAt"`
	FinishedAt  int64  `json:"finishedAt,omitempty"`
}

type SQLiteRepository struct {
	db           *sql.DB
	historyDir   string
	resultsDir   string
	artifactsDir string
}

func NewSQLiteRepository(db *sql.DB, toolcallsRoot string) (*SQLiteRepository, error) {
	if db == nil {
		return nil, errors.New("database unavailable")
	}
	if err := persistence.ApplyMigration(db, "toolcalls/1",
		`CREATE TABLE IF NOT EXISTS tool_calls (
			id TEXT PRIMARY KEY,
			call_id TEXT,
			parent_run_id TEXT,
			owner_id TEXT NOT NULL CHECK(length(trim(owner_id))>0),
			tool_name TEXT NOT NULL CHECK(length(trim(tool_name))>0),
			attempt INTEGER NOT NULL CHECK(attempt>0),
			status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','canceled')),
			arguments_json TEXT NOT NULL CHECK(json_valid(arguments_json)),
			result_json TEXT,
			error_summary TEXT,
			artifact_path TEXT,
			started_at INTEGER NOT NULL,
			finished_at INTEGER,
			UNIQUE(call_id, attempt))`,
		`CREATE INDEX IF NOT EXISTS tool_calls_owner_started ON tool_calls(owner_id, started_at, id)`,
		`CREATE INDEX IF NOT EXISTS tool_calls_parent_run ON tool_calls(parent_run_id, started_at, id)`); err != nil {
		return nil, err
	}
	root, err := filepath.Abs(toolcallsRoot)
	if err != nil {
		return nil, err
	}
	historyDir := filepath.Join(root, "history")
	resultsDir := filepath.Join(root, "results")
	artifactsDir := filepath.Join(root, "artifacts")
	for _, dir := range []string{root, historyDir, resultsDir, artifactsDir} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return nil, fmt.Errorf("create toolcalls directory: %w", err)
		}
	}
	return &SQLiteRepository{db: db, historyDir: historyDir, resultsDir: resultsDir, artifactsDir: artifactsDir}, nil
}

func validateJSON(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		value = "{}"
	}
	if len(value) > maxJSONBytes {
		return "", errors.New("tool call JSON exceeds size limit")
	}
	var decoded interface{}
	if err := json.Unmarshal([]byte(value), &decoded); err != nil {
		return "", errors.New("tool call JSON is invalid")
	}
	redacted := redact(decoded)
	encoded, err := json.Marshal(redacted)
	if err != nil || len(encoded) > maxJSONBytes {
		return "", errors.New("tool call JSON is invalid or exceeds size limit")
	}
	return string(encoded), nil
}

func redact(value interface{}) interface{} {
	switch v := value.(type) {
	case []interface{}:
		out := make([]interface{}, len(v))
		for i := range v {
			out[i] = redact(v[i])
		}
		return out
	case map[string]interface{}:
		out := make(map[string]interface{}, len(v))
		for key, item := range v {
			normalized := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(key, "-", "_"), " ", "_"))
			if normalized == "password" || normalized == "secret" || normalized == "token" || normalized == "api_key" || normalized == "apikey" || normalized == "authorization" || strings.HasSuffix(normalized, "_secret") || strings.HasSuffix(normalized, "_token") {
				out[key] = "[REDACTED]"
				continue
			}
			out[key] = redact(item)
		}
		return out
	default:
		return value
	}
}

func (r *SQLiteRepository) Start(ctx context.Context, record Record) (Record, error) {
	if record.ID == "" {
		record.ID = uuid.NewString()
	}
	if record.OwnerID == "" || record.ToolName == "" {
		return Record{}, errors.New("tool call owner and name are required")
	}
	if record.Attempt < 1 {
		record.Attempt = 1
	}
	arguments, err := validateJSON(record.Arguments)
	if err != nil {
		return Record{}, err
	}
	record.Arguments = arguments
	record.Status = StatusRunning
	if record.StartedAt == 0 {
		record.StartedAt = time.Now().UnixMilli()
	}
	_, err = r.db.ExecContext(ctx, `INSERT INTO tool_calls
		(id,call_id,parent_run_id,owner_id,tool_name,attempt,status,arguments_json,started_at)
		VALUES(?,?,?,?,?,?,?,?,?)`, record.ID, nullString(record.CallID), nullString(record.ParentRunID), record.OwnerID,
		record.ToolName, record.Attempt, record.Status, record.Arguments, record.StartedAt)
	if err != nil {
		return Record{}, err
	}
	_ = r.appendHistory(record, "started")
	return record, nil
}

func (r *SQLiteRepository) Finish(ctx context.Context, id string, status Status, result string, callErr error) error {
	if status != StatusSucceeded && status != StatusFailed && status != StatusCanceled {
		return errors.New("invalid terminal tool call status")
	}
	if len(result) > maxJSONBytes {
		return errors.New("tool call result exceeds size limit")
	}
	resultJSON := ""
	var err error
	if strings.TrimSpace(result) != "" {
		resultJSON, err = validateJSON(result)
		if err != nil {
			return err
		}
	}
	artifactPath := ""
	if len(resultJSON) > 64*1024 {
		artifactPath, err = r.writeResultFile(id, resultJSON)
		if err != nil {
			return err
		}
		resultJSON = ""
	}
	errorSummary := ""
	if callErr != nil {
		errorSummary = callErr.Error()
		if len(errorSummary) > 2000 {
			errorSummary = errorSummary[:2000]
		}
	}
	res, err := r.db.ExecContext(ctx, `UPDATE tool_calls SET status=?,result_json=?,error_summary=?,artifact_path=?,finished_at=? WHERE id=? AND status='running'`,
		status, nullString(resultJSON), nullString(errorSummary), nullString(artifactPath), time.Now().UnixMilli(), id)
	if err != nil {
		if artifactPath != "" {
			_ = os.Remove(artifactPath)
		}
		return err
	}
	if count, _ := res.RowsAffected(); count != 1 {
		if artifactPath != "" {
			_ = os.Remove(artifactPath)
		}
		return ErrNotFound
	}
	_ = r.appendHistory(Record{ID: id, Status: status, Result: resultJSON, Error: errorSummary, Artifact: artifactPath}, "finished")
	return nil
}

func nullString(value string) interface{} {
	if value == "" {
		return nil
	}
	return value
}

func (r *SQLiteRepository) writeResultFile(id, result string) (string, error) {
	name := filepath.Base(id) + ".json"
	path := filepath.Join(r.resultsDir, name)
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return "", err
	}
	if _, err = f.WriteString(result); err != nil {
		_ = f.Close()
		_ = os.Remove(path)
		return "", err
	}
	if err = f.Close(); err != nil {
		return "", err
	}
	return path, nil
}

func (r *SQLiteRepository) appendHistory(record Record, event string) error {
	if record.ID == "" {
		return errors.New("tool call ID is required")
	}
	path := filepath.Join(r.historyDir, filepath.Base(record.ID)+".jsonl")
	line, err := json.Marshal(map[string]interface{}{
		"event": event, "record": record, "at": time.Now().UnixMilli(),
	})
	if err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_APPEND, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(append(line, '\n'))
	return err
}

func (r *SQLiteRepository) WriteArtifact(id, filename string, data []byte) (string, error) {
	// filepath.Base is platform-specific. Reject both separators explicitly so
	// a Windows-style traversal cannot pass validation when tests or callers run
	// on Unix, and vice versa.
	if id == "" || strings.ContainsAny(id, `/\\`) || filepath.Base(id) != id ||
		filename == "" || strings.ContainsAny(filename, `/\\`) || filepath.Base(filename) != filename ||
		filename == "." || filename == ".." {
		return "", errors.New("invalid tool-call artifact path")
	}
	if len(data) > maxArtifactBytes {
		return "", errors.New("tool-call artifact exceeds size limit")
	}
	dir := filepath.Join(r.artifactsDir, id)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	path := filepath.Join(dir, filename)
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return "", err
	}
	if _, err = f.Write(data); err != nil {
		_ = f.Close()
		_ = os.Remove(path)
		return "", err
	}
	if err = f.Close(); err != nil {
		return "", err
	}
	return path, nil
}

func (r *SQLiteRepository) Get(ctx context.Context, ownerID, id string) (Record, error) {
	var record Record
	var callID, parentRunID, resultJSON, errorSummary, artifactPath sql.NullString
	var finished sql.NullInt64
	err := r.db.QueryRowContext(ctx, `SELECT id,call_id,parent_run_id,owner_id,tool_name,attempt,status,arguments_json,result_json,error_summary,artifact_path,started_at,finished_at
		FROM tool_calls WHERE owner_id=? AND id=?`, ownerID, id).Scan(&record.ID, &callID, &parentRunID, &record.OwnerID, &record.ToolName, &record.Attempt,
		&record.Status, &record.Arguments, &resultJSON, &errorSummary, &artifactPath, &record.StartedAt, &finished)
	if errors.Is(err, sql.ErrNoRows) {
		return Record{}, ErrNotFound
	}
	if err != nil {
		return Record{}, err
	}
	record.CallID, record.ParentRunID = callID.String, parentRunID.String
	record.Result, record.Error, record.Artifact = resultJSON.String, errorSummary.String, artifactPath.String
	if finished.Valid {
		record.FinishedAt = finished.Int64
	}
	return record, nil
}
