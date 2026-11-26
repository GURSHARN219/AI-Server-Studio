package modelregistry

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
)

var (
	ErrDatabaseUnavailable = errors.New("model registry database unavailable")
	ErrInvalidPath         = errors.New("model registry path is required")
	ErrModelNotFound       = errors.New("model is not registered")
)

var migrationStatements = []string{
	`CREATE TABLE IF NOT EXISTS model_registry (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		canonical_path TEXT NOT NULL UNIQUE,
		filename TEXT NOT NULL,
		size INTEGER NOT NULL DEFAULT -1,
		source TEXT NOT NULL DEFAULT 'unknown',
		repository_id TEXT NOT NULL DEFAULT 'unknown',
		repository_revision TEXT NOT NULL DEFAULT 'unknown',
		architecture TEXT NOT NULL DEFAULT 'unknown',
		quantization TEXT NOT NULL DEFAULT 'unknown',
		tokenizer_metadata_json TEXT NOT NULL DEFAULT '{"model":"unknown","pre":"unknown","token_type":"unknown","token_count":-1}',
		compatibility_status TEXT NOT NULL DEFAULT 'unknown',
		load_status TEXT NOT NULL DEFAULT 'unknown',
		last_load_status TEXT NOT NULL DEFAULT 'unknown',
		last_load_error TEXT NOT NULL DEFAULT 'unknown',
		last_loaded_at TEXT NOT NULL DEFAULT 'unknown',
		registered_at INTEGER NOT NULL,
		updated_at INTEGER NOT NULL
	)`,
	`CREATE INDEX IF NOT EXISTS model_registry_source ON model_registry(source, filename)`,
}

func applyMigration(db *sql.DB) error {
	return persistence.ApplyMigration(db, "modelregistry/1", migrationStatements...)
}

func (r *Registry) Register(ctx context.Context, request RegisterRequest) (Model, error) {
	if r == nil || r.db == nil {
		return Model{}, ErrDatabaseUnavailable
	}
	path, err := canonicalPath(request.Path)
	if err != nil {
		return Model{}, err
	}
	if !strings.EqualFold(filepath.Ext(path), ".gguf") {
		return Model{}, fmt.Errorf("%w: only .gguf files may be registered", ErrInvalidPath)
	}
	info, statErr := os.Stat(path)
	size := UnknownSize
	exists := false
	if statErr == nil {
		if !info.Mode().IsRegular() {
			return Model{}, fmt.Errorf("%w: model path is not a regular file", ErrInvalidPath)
		}
		size, exists = info.Size(), true
	} else if !errors.Is(statErr, os.ErrNotExist) {
		return Model{}, statErr
	}
	metadata := UnknownGGUFMetadata()
	if exists {
		metadata, _ = ReadGGUFMetadata(path)
	}
	tokenizerJSON, err := json.Marshal(metadata.Tokenizer)
	if err != nil {
		return Model{}, err
	}
	source := knownOrUnknown(request.Source)
	repositoryID := knownOrUnknown(request.RepositoryID)
	repositoryRevision := knownOrUnknown(request.RepositoryRevision)
	now := time.Now().UTC().UnixMilli()
	_, err = r.db.ExecContext(ctx, `INSERT INTO model_registry(
		canonical_path,filename,size,source,repository_id,repository_revision,architecture,quantization,tokenizer_metadata_json,
		compatibility_status,load_status,last_load_status,last_load_error,last_loaded_at,registered_at,updated_at)
		VALUES(?,?,?,?,?,?,?,?,?,'unknown','unknown','unknown','unknown','unknown',?,?)
		ON CONFLICT(canonical_path) DO UPDATE SET
		filename=excluded.filename,size=excluded.size,source=excluded.source,
		repository_id=excluded.repository_id,repository_revision=excluded.repository_revision,
		architecture=CASE WHEN excluded.architecture<>? THEN excluded.architecture ELSE model_registry.architecture END,
		quantization=CASE WHEN excluded.quantization<>? THEN excluded.quantization ELSE model_registry.quantization END,
		tokenizer_metadata_json=CASE WHEN excluded.tokenizer_metadata_json<>? THEN excluded.tokenizer_metadata_json ELSE model_registry.tokenizer_metadata_json END,
		updated_at=excluded.updated_at`,
		path, filepath.Base(path), size, source, repositoryID, repositoryRevision,
		knownOrUnknown(metadata.Architecture), knownOrUnknown(metadata.Quantization), string(tokenizerJSON), now, now,
		Unknown, Unknown, string(mustJSON(UnknownTokenizerMetadata())))
	if err != nil {
		return Model{}, err
	}
	return r.getByCanonicalPath(ctx, path)
}

// Get returns a registered model by path and derives current filesystem state.
func (r *Registry) Get(ctx context.Context, path string) (Model, error) {
	canonical, err := canonicalPath(path)
	if err != nil {
		return Model{}, err
	}
	return r.getByCanonicalPath(ctx, canonical)
}

func (r *Registry) getByCanonicalPath(ctx context.Context, path string) (Model, error) {
	model, err := scanModel(r.db.QueryRowContext(ctx, modelSelect+` WHERE canonical_path=?`, path))
	if errors.Is(err, sql.ErrNoRows) {
		return Model{}, ErrModelNotFound
	}
	if err != nil {
		return Model{}, err
	}
	return withFilesystemState(model), nil
}

// List returns every model in deterministic path order, with current stale
// state computed from the filesystem.
func (r *Registry) List(ctx context.Context) ([]Model, error) {
	rows, err := r.db.QueryContext(ctx, modelSelect+` ORDER BY canonical_path`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	models := make([]Model, 0)
	for rows.Next() {
		model, scanErr := scanModel(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		models = append(models, withFilesystemState(model))
	}
	return models, rows.Err()
}

// ListStale returns entries whose file is missing or whose recorded size no
// longer matches the file. It does not remove or mutate anything.
func (r *Registry) ListStale(ctx context.Context) ([]Model, error) {
	models, err := r.List(ctx)
	if err != nil {
		return nil, err
	}
	stale := models[:0]
	for _, model := range models {
		if model.Stale {
			stale = append(stale, model)
		}
	}
	return stale, nil
}

// RecordLoad stores the outcome of the latest load attempt without changing
// the file or its registration identity.
func (r *Registry) RecordLoad(ctx context.Context, path string, result LoadResult) error {
	canonical, err := canonicalPath(path)
	if err != nil {
		return err
	}
	status := knownOrUnknown(result.Status)
	loadError := knownOrUnknown(result.Error)
	at := strings.TrimSpace(result.At)
	if at == "" {
		at = time.Now().UTC().Format(time.RFC3339Nano)
	}
	res, err := r.db.ExecContext(ctx, `UPDATE model_registry SET load_status=?,last_load_status=?,last_load_error=?,last_loaded_at=?,updated_at=? WHERE canonical_path=?`, status, status, loadError, at, time.Now().UTC().UnixMilli(), canonical)
	if err != nil {
		return err
	}
	if affected, _ := res.RowsAffected(); affected != 1 {
		return ErrModelNotFound
	}
	return nil
}

// UpdateCompatibility records a server compatibility decision. Empty values
// intentionally become Unknown rather than retaining an accidental guess.
func (r *Registry) UpdateCompatibility(ctx context.Context, path, status string) error {
	canonical, err := canonicalPath(path)
	if err != nil {
		return err
	}
	res, err := r.db.ExecContext(ctx, `UPDATE model_registry SET compatibility_status=?,updated_at=? WHERE canonical_path=?`, knownOrUnknown(status), time.Now().UTC().UnixMilli(), canonical)
	if err != nil {
		return err
	}
	if affected, _ := res.RowsAffected(); affected != 1 {
		return ErrModelNotFound
	}
	return nil
}

const modelSelect = `SELECT id,canonical_path,filename,size,source,repository_id,repository_revision,architecture,quantization,tokenizer_metadata_json,compatibility_status,load_status,last_load_status,last_load_error,last_loaded_at,registered_at,updated_at FROM model_registry`

type scanner interface{ Scan(...any) error }

func scanModel(row scanner) (Model, error) {
	var model Model
	var tokenizerJSON string
	if err := row.Scan(&model.ID, &model.Path, &model.Filename, &model.Size, &model.Source, &model.RepositoryID, &model.RepositoryRevision, &model.Architecture, &model.Quantization, &tokenizerJSON, &model.CompatibilityStatus, &model.LoadStatus, &model.LastLoad.Status, &model.LastLoad.Error, &model.LastLoad.At, &model.RegisteredAt, &model.UpdatedAt); err != nil {
		return Model{}, err
	}
	if err := json.Unmarshal([]byte(tokenizerJSON), &model.Tokenizer); err != nil {
		model.Tokenizer = UnknownTokenizerMetadata()
	}
	return model, nil
}

func withFilesystemState(model Model) Model {
	model.Exists = false
	model.Stale = true
	info, err := os.Stat(model.Path)
	if err == nil && info.Mode().IsRegular() {
		model.Exists = true
		model.Stale = model.Size != UnknownSize && model.Size != info.Size()
	}
	return model
}

func canonicalPath(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", ErrInvalidPath
	}
	absolute, err := filepath.Abs(raw)
	if err != nil {
		return "", err
	}
	absolute = filepath.Clean(absolute)
	if resolved, resolveErr := filepath.EvalSymlinks(absolute); resolveErr == nil {
		absolute = filepath.Clean(resolved)
	}
	return absolute, nil
}

func knownOrUnknown(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return Unknown
	}
	return value
}

func UnknownTokenizerMetadata() TokenizerMetadata {
	return TokenizerMetadata{Model: Unknown, Pre: Unknown, TokenType: Unknown, TokenCount: UnknownCount}
}

func mustJSON(value any) []byte {
	raw, _ := json.Marshal(value)
	return raw
}
