package persistence

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDefaultDataDirectoryAndOverride(t *testing.T) {
	t.Setenv("AI_SERVER_DATA_DIR", "")
	config, err := os.UserConfigDir()
	if err != nil {
		t.Fatal(err)
	}
	dir, err := DataDir()
	if err != nil || dir != filepath.Join(config, "AI Server Studio", "data") {
		t.Fatalf("default directory: %q %v", dir, err)
	}
	want := t.TempDir()
	t.Setenv("AI_SERVER_DATA_DIR", want)
	dir, err = DataDir()
	if err != nil || dir != want {
		t.Fatalf("override: %q %v", dir, err)
	}
}

func TestSQLiteMigrationRollbackAndIntegrity(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "studio.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	err = ApplyMigration(db, "broken/1", `CREATE TABLE rollback_test(id TEXT PRIMARY KEY)`, `INSERT INTO missing_table VALUES(1)`)
	if err == nil {
		t.Fatal("invalid migration succeeded")
	}
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE name IN ('rollback_test','persistence_migrations')`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("migration did not roll back: %d %v", count, err)
	}
	statements := []string{`CREATE TABLE parent(id TEXT PRIMARY KEY)`, `CREATE TABLE child(id TEXT PRIMARY KEY,parent_id TEXT REFERENCES parent(id))`}
	if err = ApplyMigration(db, "fixture/1", statements...); err != nil {
		t.Fatal(err)
	}
	if err = ApplyMigration(db, "fixture/1", statements...); err != nil {
		t.Fatal("migration not idempotent:", err)
	}
	if err = ApplyMigration(db, "fixture/1", `CREATE TABLE other(id TEXT)`); err == nil {
		t.Fatal("changed migration silently accepted")
	}
	if _, err = db.Exec(`INSERT INTO child VALUES('c','absent')`); err == nil {
		t.Fatal("foreign keys disabled")
	}
	if err = IntegrityCheck(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	// Replacement connections must retain FK enforcement, not just the first one.
	db.SetMaxIdleConns(0)
	if _, err = db.Exec(`INSERT INTO child VALUES('c','absent')`); err == nil {
		t.Fatal("replacement connection lost foreign keys")
	}
}

func TestConsistentBackupSafeDestinationAndRestart(t *testing.T) {
	dir := t.TempDir()
	db, err := Open(filepath.Join(dir, "studio.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err = db.Exec(`CREATE TABLE records(id TEXT PRIMARY KEY); INSERT INTO records VALUES('retained')`); err != nil {
		t.Fatal(err)
	}
	backupDir := filepath.Join(dir, "backups")
	for _, name := range []string{"../escape.sqlite", `..\escape.sqlite`, "", ".", "..", "snapshot.sqlite:stream", "snapshot.sqlite.", "bad?name.sqlite"} {
		if _, err = Backup(context.Background(), db, backupDir, name); err == nil {
			t.Fatalf("unsafe backup accepted: %q", name)
		}
	}
	backup, err := Backup(context.Background(), db, backupDir, "snapshot.sqlite")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(backup, backupDir+string(filepath.Separator)) {
		t.Fatal("backup escaped directory")
	}
	if _, err = Backup(context.Background(), db, backupDir, "snapshot.sqlite"); err == nil {
		t.Fatal("backup overwrote existing destination")
	}
	if _, err = db.Exec(`INSERT INTO records VALUES('later')`); err != nil {
		t.Fatal(err)
	}
	copy, err := Open(backup)
	if err != nil {
		t.Fatal(err)
	}
	defer copy.Close()
	var count int
	if err = copy.QueryRow(`SELECT COUNT(*) FROM records`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("backup not an independent snapshot: %d %v", count, err)
	}
	if err = IntegrityCheck(context.Background(), copy); err != nil {
		t.Fatal(err)
	}
}
