package toolcalls

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ai-server-studio-backend/persistence"
)

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := persistence.Open(filepath.Join(t.TempDir(), "studio.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	// The tool-call table is intentionally independent of the user schema so
	// repository tests can exercise the durable lifecycle in isolation.
	if _, err := db.Exec(`CREATE TABLE users (id TEXT PRIMARY KEY)`); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestSQLiteRepositoryPersistsRedactedLifecycle(t *testing.T) {
	db := openTestDB(t)
	defer db.Close()
	repo, err := NewSQLiteRepository(db, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	record, err := repo.Start(context.Background(), Record{
		CallID: "call-1", OwnerID: "owner-1", ToolName: "mcp.secret", Attempt: 2,
		Arguments: `{"query":"ok","api_key":"do-not-store","nested":{"token":"also-secret"}}`,
	})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(record.Arguments, "do-not-store") || strings.Contains(record.Arguments, "also-secret") {
		t.Fatalf("secrets were not redacted: %s", record.Arguments)
	}
	if err := repo.Finish(context.Background(), record.ID, StatusSucceeded, `{"value":"done"}`, nil); err != nil {
		t.Fatal(err)
	}
	loaded, err := repo.Get(context.Background(), "owner-1", record.ID)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Status != StatusSucceeded || loaded.FinishedAt == 0 || loaded.Result != `{"value":"done"}` {
		t.Fatalf("unexpected durable record: %+v", loaded)
	}
	history, err := os.ReadFile(filepath.Join(filepath.Dir(repo.resultsDir), "history", record.ID+".jsonl"))
	if err != nil || !strings.Contains(string(history), `"event":"started"`) || !strings.Contains(string(history), `"event":"finished"`) {
		t.Fatalf("tool-call history was not recorded: %s (%v)", history, err)
	}
	if _, err := repo.Get(context.Background(), "other-owner", record.ID); err != ErrNotFound {
		t.Fatalf("owner isolation failed: %v", err)
	}
}

func TestSQLiteRepositoryWritesBoundedArtifacts(t *testing.T) {
	db := openTestDB(t)
	defer db.Close()
	repo, err := NewSQLiteRepository(db, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	record, err := repo.Start(context.Background(), Record{OwnerID: "owner-1", ToolName: "local.artifact", Arguments: `{}`})
	if err != nil {
		t.Fatal(err)
	}
	path, err := repo.WriteArtifact(record.ID, "output.txt", []byte("offline result"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(path, filepath.Join("artifacts", record.ID)) {
		t.Fatalf("artifact escaped toolcalls root: %s", path)
	}
	if got, err := os.ReadFile(path); err != nil || string(got) != "offline result" {
		t.Fatalf("artifact readback failed: %q %v", got, err)
	}
	if _, err := repo.WriteArtifact(record.ID, "..\\escape", []byte("bad")); err == nil {
		t.Fatal("accepted artifact traversal")
	}
}
