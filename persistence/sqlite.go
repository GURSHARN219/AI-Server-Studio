// Package persistence owns the application's single SQLite connection pool.
package persistence

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"ai-server-studio-backend/portable"
	_ "modernc.org/sqlite"
)

var backupNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*$`)

// DataDir returns the central portable data directory. It never falls back to
// a user profile directory; resolution errors are returned to the caller.
func DataDir() (string, error) {
	paths, err := portable.Resolve()
	if err != nil {
		return "", err
	}
	return paths.Data, nil
}

// DatabasePath returns data/db/studio.sqlite from the same resolver used by
// DataDir and the server startup path.
func DatabasePath() (string, error) {
	paths, err := portable.Resolve()
	if err != nil {
		return "", err
	}
	return paths.Database, nil
}

func Open(path string) (*sql.DB, error) {
	if strings.TrimSpace(path) == "" {
		var err error
		path, err = DatabasePath()
		if err != nil {
			return nil, err
		}
	}
	if path == ":memory:" {
		return nil, errors.New("a durable database file path is required")
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(filepath.Dir(abs), 0700); err != nil {
		return nil, err
	}
	// Create privately before the driver opens the file (SQLite defaults to 0666).
	f, err := os.OpenFile(abs, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = f.Close(); err != nil {
		return nil, err
	}
	u := url.URL{Scheme: "file", Path: filepath.ToSlash(abs)}
	if filepath.Separator == '\\' && !strings.HasPrefix(u.Path, "/") {
		u.Path = "/" + u.Path
	}
	q := url.Values{}
	q.Add("_pragma", "foreign_keys(1)")
	q.Add("_pragma", "busy_timeout(10000)")
	q.Add("_pragma", "journal_mode(WAL)")
	q.Add("_pragma", "synchronous(FULL)")
	q.Set("_txlock", "immediate")
	u.RawQuery = q.Encode()
	db, err := sql.Open("sqlite", u.String())
	if err != nil {
		return nil, err
	}
	// One connection serializes application writers; busy_timeout also coordinates
	// a second process/backup connection. DSN pragmas apply to replacement connections.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	if err = db.Ping(); err == nil {
		err = IntegrityCheck(context.Background(), db)
	}
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("open SQLite: %w", err)
	}
	return db, nil
}

// ApplyMigration rolls back both DDL and its marker on any failure. Migration
// names are namespaced by their caller and their contents cannot silently change.
func ApplyMigration(db *sql.DB, name string, statements ...string) error {
	return ApplyMigrationWithVerifier(db, name, nil, statements...)
}

// ApplyMigrationWithVerifier is ApplyMigration with an optional in-transaction
// verifier. The verifier runs before the migration marker is committed, so a
// failed copy/consistency check cannot leave a false completion record.
func ApplyMigrationWithVerifier(db *sql.DB, name string, verify func(*sql.Tx) error, statements ...string) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`CREATE TABLE IF NOT EXISTS persistence_migrations (
		name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, applied_at TEXT NOT NULL)`); err != nil {
		return err
	}
	sum := sha256.Sum256([]byte(strings.Join(statements, "\x00")))
	hash := hex.EncodeToString(sum[:])
	var prior string
	err = tx.QueryRow(`SELECT sha256 FROM persistence_migrations WHERE name=?`, name).Scan(&prior)
	if err == nil {
		if prior != hash {
			return fmt.Errorf("migration %s checksum changed", name)
		}
		return tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	for _, statement := range statements {
		if _, err = tx.Exec(statement); err != nil {
			return fmt.Errorf("migration %s: %w", name, err)
		}
	}
	if verify != nil {
		if err = verify(tx); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(`INSERT INTO persistence_migrations VALUES(?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`, name, hash); err != nil {
		return err
	}
	return tx.Commit()
}

func IntegrityCheck(ctx context.Context, db *sql.DB) error {
	rows, err := db.QueryContext(ctx, `PRAGMA integrity_check`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var result string
		if err = rows.Scan(&result); err != nil {
			rows.Close()
			return err
		}
		if result != "ok" {
			rows.Close()
			return errors.New("SQLite integrity check failed")
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	rows, err = db.QueryContext(ctx, `PRAGMA foreign_key_check`)
	if err != nil {
		return err
	}
	defer rows.Close()
	if rows.Next() {
		return errors.New("SQLite foreign key check failed")
	}
	return rows.Err()
}

// Backup creates a consistent SQLite snapshot in a private caller-selected
// backup directory, never overwriting a file. The filename cannot escape it.
func Backup(ctx context.Context, db *sql.DB, dir, filename string) (string, error) {
	if len(filename) > 200 || !backupNamePattern.MatchString(filename) || filepath.Base(filename) != filename || strings.HasSuffix(filename, ".") {
		return "", errors.New("invalid backup filename")
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return "", err
	}
	if err = os.MkdirAll(abs, 0700); err != nil {
		return "", err
	}
	path := filepath.Join(abs, filename)
	// Reserve the destination to prevent overwrites, including existing symlinks.
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", err
	}
	if err = f.Close(); err != nil {
		return "", err
	}
	if _, err = db.ExecContext(ctx, `VACUUM INTO ?`, path); err != nil {
		os.Remove(path)
		return "", err
	}
	return path, nil
}
