package server

import (
	"ai-server-studio-backend/security"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
)

const (
	demoAccountID       = "demo-user"
	demoAccountEmail    = "demo@aiserver.studio"
	demoAccountPassword = "demo123"
)

func (s *Server) initLocalSecurity() error {
	if s.db == nil {
		return errors.New("security database unavailable")
	}
	if _, err := security.NewSecretStore(s.resolveDataDir()); err != nil {
		return err
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`CREATE TABLE IF NOT EXISTS security_schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`); err != nil {
		return err
	}
	var version int
	if err = tx.QueryRow(`SELECT COALESCE(MAX(version),0) FROM security_schema_migrations`).Scan(&version); err != nil {
		return err
	}
	if version > 1 {
		return fmt.Errorf("unsupported security schema version %d", version)
	}
	if version == 1 {
		if err := ensureDemoAccount(tx); err != nil {
			return err
		}
		return tx.Commit()
	}
	statements := []string{
		`CREATE TABLE IF NOT EXISTS security_schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,display_name TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS security_sessions(token_hash TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,revoked INTEGER NOT NULL DEFAULT 0)`,
		`CREATE TABLE IF NOT EXISTS security_api_keys(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,token_hash TEXT NOT NULL UNIQUE,payload TEXT NOT NULL,expires_at INTEGER,active INTEGER NOT NULL DEFAULT 1)`,
		`CREATE TABLE IF NOT EXISTS security_resources(owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,secret BLOB,created_at TEXT NOT NULL,PRIMARY KEY(owner_id,kind,id))`,
		`CREATE TABLE IF NOT EXISTS security_rate_limits(scope TEXT NOT NULL,bucket INTEGER NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(scope,bucket))`,
		`CREATE TABLE IF NOT EXISTS security_imports(owner_id TEXT NOT NULL REFERENCES users(id),source_id TEXT NOT NULL,digest TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(owner_id,source_id))`,
		`INSERT OR IGNORE INTO security_schema_migrations(version,applied_at) VALUES(1,datetime('now'))`,
	}
	for _, stmt := range statements {
		if _, err = tx.Exec(stmt); err != nil {
			return fmt.Errorf("security migration: %w", err)
		}
	}
	if err := ensureDemoAccount(tx); err != nil {
		return err
	}
	return tx.Commit()
}

// ensureDemoAccount provides a local, fully authenticated account for the
// desktop demo flow. Its session is created through the normal sign-in route.
func ensureDemoAccount(tx *sql.Tx) error {
	var existing string
	err := tx.QueryRow(`SELECT id FROM users WHERE email=?`, demoAccountEmail).Scan(&existing)
	if err == nil {
		return nil
	}
	if err != sql.ErrNoRows {
		return err
	}
	hash, err := security.HashPassword(demoAccountPassword)
	if err != nil {
		return err
	}
	if _, err = tx.Exec(`INSERT INTO users(id,email,password_hash,display_name,created_at) VALUES(?,?,?,?,?)`, demoAccountID, demoAccountEmail, hash, "Demo User", nowRFC3339()); err != nil {
		return err
	}
	return nil
}

type resourceDB interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func putResource(ctx context.Context, db resourceDB, owner, kind, id string, v any, secret []byte) error {
	if owner == "" || kind == "" || id == "" {
		return errors.New("resource identity required")
	}
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	_, err = db.ExecContext(ctx, `INSERT INTO security_resources(owner_id,kind,id,payload,secret,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(owner_id,kind,id) DO UPDATE SET payload=excluded.payload,secret=excluded.secret`, owner, kind, id, string(b), secret, nowRFC3339())
	return err
}
func (s *Server) putResource(owner, kind, id string, v any, secret []byte) error {
	return putResource(context.Background(), s.db, owner, kind, id, v, secret)
}
func (s *Server) getResource(owner, kind, id string, v any) ([]byte, error) {
	if owner == "" {
		return nil, errors.New("owner required")
	}
	var b string
	var secret []byte
	err := s.db.QueryRow(`SELECT payload,secret FROM security_resources WHERE owner_id=? AND kind=? AND id=?`, owner, kind, id).Scan(&b, &secret)
	if err != nil {
		return nil, err
	}
	return secret, json.Unmarshal([]byte(b), v)
}
func resourceList[T any](s *Server, owner, kind string) ([]T, error) {
	out := []T{}
	if owner == "" {
		return nil, errors.New("owner required")
	}
	rows, err := s.db.Query(`SELECT payload FROM security_resources WHERE owner_id=? AND kind=? ORDER BY created_at DESC,id DESC`, owner, kind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var b string
		var v T
		if err = rows.Scan(&b); err != nil {
			return nil, err
		}
		if err = json.Unmarshal([]byte(b), &v); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}
func (s *Server) deleteResource(owner, kind, id string) error {
	res, err := s.db.Exec(`DELETE FROM security_resources WHERE owner_id=? AND kind=? AND id=?`, owner, kind, id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err == nil && n == 0 {
		return sql.ErrNoRows
	}
	return err
}
func (s *Server) protect(owner, purpose string, b []byte) ([]byte, error) {
	store, err := security.NewSecretStore(s.resolveDataDir())
	if err != nil {
		return nil, err
	}
	return store.Protect(owner, purpose, b)
}
func (s *Server) unprotect(owner, purpose string, b []byte) ([]byte, error) {
	if len(b) == 0 {
		return []byte{}, nil
	}
	store, err := security.NewSecretStore(s.resolveDataDir())
	if err != nil {
		return nil, err
	}
	return store.Unprotect(owner, purpose, b)
}
func (s *Server) requireOwner(w http.ResponseWriter, r *http.Request) string {
	u, err := s.currentUserFromRequest(r)
	if err != nil {
		writeError(w, 503, "identity store unavailable", "unavailable")
		return ""
	}
	if u == nil {
		writeError(w, 401, "not authenticated", "unauthorized")
		return ""
	}
	return u.ID
}
func resourceError(w http.ResponseWriter, err error) {
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, 404, "resource not found", "not_found")
	} else {
		writeError(w, 500, "resource operation failed", "internal_error")
	}
}
