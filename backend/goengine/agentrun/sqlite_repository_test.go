package agentrun

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"

	"ai-server-studio-backend/persistence"
)

func sqliteFixture(t *testing.T) (*SQLiteRepository, *sql.DB, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "fixture.sqlite")
	db, err := persistence.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if _, err = db.Exec(`CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES('owner')`); err != nil {
		t.Fatal(err)
	}
	repo, err := NewSQLiteRepository(db)
	if err != nil {
		t.Fatal(err)
	}
	return repo, db, path
}

func ownedFixture() Run { run := testRun(); run.OwnerID = "owner"; run.Revision = 1; return run }

func TestSQLiteRunEventsCheckpointTransactionRollbackAndRestart(t *testing.T) {
	repo, db, path := sqliteFixture(t)
	run := ownedFixture()
	if err := repo.Save(run); err != nil {
		t.Fatal(err)
	}
	if report, err := repo.CheckConsistency(); err != nil || report != (ConsistencyReport{}) {
		t.Fatalf("fresh consistency check: %+v %v", report, err)
	}
	if _, err := db.Exec(`CREATE TRIGGER reject_checkpoint BEFORE INSERT ON run_checkpoints BEGIN SELECT RAISE(ABORT,'synthetic checkpoint failure'); END`); err != nil {
		t.Fatal(err)
	}
	next := ownedFixture()
	next.Revision++
	next.UpdatedAt = 2
	next.Events = append(next.Events, RunEvent{Sequence: 2, Type: "observation", Timestamp: 2})
	next.Checkpoint = &RunCheckpoint{Boundary: "tool_pending", EventSequence: 2, UpdatedAt: 2}
	if err := repo.Save(next); err == nil {
		t.Fatal("checkpoint failure did not abort save")
	}
	runs, err := repo.List()
	if err != nil || len(runs) != 1 || !reflect.DeepEqual(runs[0], run) {
		t.Fatalf("partial commit: %+v %v", runs, err)
	}
	if _, err = db.Exec(`DROP TRIGGER reject_checkpoint`); err != nil {
		t.Fatal(err)
	}
	if err = repo.Save(next); err != nil {
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := persistence.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	reloaded, err := NewSQLiteRepository(reopened)
	if err != nil {
		t.Fatal(err)
	}
	runs, err = reloaded.List()
	if err != nil || len(runs) != 1 || !reflect.DeepEqual(runs[0], next) {
		t.Fatalf("restart changed history/checkpoint: %+v %v", runs, err)
	}
	if err = persistence.IntegrityCheck(context.Background(), reopened); err != nil {
		t.Fatal(err)
	}
}

func TestTaskRunsAreCanonicalAndMigrationIsIdempotent(t *testing.T) {
	repo, db, path := sqliteFixture(t)
	run := ownedFixture()
	if err := repo.Save(run); err != nil {
		t.Fatal(err)
	}
	var canonical, mirror string
	if err := db.QueryRow(`SELECT status FROM task_runs WHERE id=?`, run.ID).Scan(&canonical); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT status FROM agent_runs WHERE id=?`, run.ID).Scan(&mirror); err != nil {
		t.Fatal(err)
	}
	if canonical != "running" || mirror != string(StatusRunning) {
		t.Fatalf("unexpected status projection: canonical=%s mirror=%s", canonical, mirror)
	}
	next := run
	next.Revision = 2
	next.Status = StatusDone
	next.CompletedAt = 20
	next.UpdatedAt = 20
	next.Events = append(next.Events, RunEvent{Sequence: 2, Type: "agent_done", Timestamp: 20})
	if err := repo.Save(next); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT status,finished_at FROM task_runs WHERE id=?`, run.ID).Scan(&canonical, new(int64)); err != nil {
		t.Fatal(err)
	}
	if canonical != "succeeded" {
		t.Fatalf("task_runs is not canonical: %s", canonical)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := persistence.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if _, err = NewSQLiteRepository(reopened); err != nil {
		t.Fatal(err)
	}
	var migrations int
	if err = reopened.QueryRow(`SELECT COUNT(*) FROM persistence_migrations WHERE name='agentrun/2-task-runs'`).Scan(&migrations); err != nil || migrations != 1 {
		t.Fatalf("migration marker: %d %v", migrations, err)
	}
}

func TestTaskRunMigrationVerifierRollsBackMarkerOnInconsistentExistingData(t *testing.T) {
	_, db, _ := sqliteFixture(t)
	run := ownedFixture()
	state, err := json.Marshal(run)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO agent_runs VALUES(?,?,?,?,?,?,?)`, run.ID, run.OwnerID, run.Status, run.Revision, string(state), run.CreatedAt, run.UpdatedAt); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO users(id) VALUES('not-the-owner')`); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`INSERT INTO task_runs(id,owner_id,kind,status,attempt,resource_class,created_at,updated_at,metadata_json,state_json,revision) VALUES(?,?, 'agent','running',0,'default',?,?, '{}',?,?)`, run.ID, "not-the-owner", run.CreatedAt, run.UpdatedAt, string(state), run.Revision); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`DELETE FROM persistence_migrations WHERE name='agentrun/2-task-runs'`); err != nil {
		t.Fatal(err)
	}
	if _, err = NewSQLiteRepository(db); err == nil {
		t.Fatal("inconsistent task-run migration was accepted")
	}
	var markers int
	if err = db.QueryRow(`SELECT COUNT(*) FROM persistence_migrations WHERE name='agentrun/2-task-runs'`).Scan(&markers); err != nil {
		t.Fatal(err)
	}
	if markers != 0 {
		t.Fatal("failed migration left a completion marker")
	}
	var oldRows int
	if err = db.QueryRow(`SELECT COUNT(*) FROM agent_runs WHERE id=?`, run.ID).Scan(&oldRows); err != nil || oldRows != 1 {
		t.Fatalf("legacy row was not retained: %d %v", oldRows, err)
	}
}

func TestSQLiteForeignKeysAndAppendOnlyOptimisticUpdates(t *testing.T) {
	repo, db, _ := sqliteFixture(t)
	run := ownedFixture()
	run.OwnerID = "unknown"
	if err := repo.Save(run); err == nil {
		t.Fatal("unknown owner accepted")
	}
	run.OwnerID = ""
	if err := repo.Save(run); err == nil {
		t.Fatal("unowned run accepted")
	}
	run = ownedFixture()
	if err := repo.Save(run); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO run_events VALUES('run-absent',1,'x',1,'{}')`); err == nil {
		t.Fatal("orphan event accepted")
	}
	if _, err := db.Exec(`INSERT INTO run_checkpoints VALUES('run-absent',0,1,'{}')`); err == nil {
		t.Fatal("orphan checkpoint accepted")
	}
	if _, err := db.Exec(`INSERT INTO run_events VALUES('run-test',1,'x',1,'{}')`); err == nil {
		t.Fatal("duplicate event sequence accepted")
	}
	if err := repo.Save(run); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale update accepted: %v", err)
	}
	run.Revision++
	run.Events[0].Type = "rewritten"
	if err := repo.Save(run); !errors.Is(err, ErrConflict) {
		t.Fatalf("rewritten event accepted: %v", err)
	}
	run.Events[0].Type = "plan_created"
	run.OwnerID = "other"
	if err := repo.Save(run); !errors.Is(err, ErrConflict) {
		t.Fatalf("owner reassignment accepted: %v", err)
	}
}

func TestSQLiteTerminalSingleWinnerAcrossConnectionPools(t *testing.T) {
	repo, _, path := sqliteFixture(t)
	run := ownedFixture()
	if err := repo.Save(run); err != nil {
		t.Fatal(err)
	}
	secondDB, err := persistence.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer secondDB.Close()
	second, err := NewSQLiteRepository(secondDB)
	if err != nil {
		t.Fatal(err)
	}
	var winners atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 24; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			candidate := ownedFixture()
			candidate.Revision = 2
			candidate.Status = []Status{StatusDone, StatusError, StatusCanceled}[i%3]
			candidate.CompletedAt = 2
			candidate.Events = append(candidate.Events, RunEvent{Sequence: 2, Type: "agent_done", Timestamp: 2})
			target := []*SQLiteRepository{repo, second}[i%2]
			err := target.Save(candidate)
			if err == nil {
				winners.Add(1)
			} else if !errors.Is(err, ErrTerminal) {
				t.Error(err)
			}
		}(i)
	}
	wg.Wait()
	runs, err := repo.List()
	if err != nil || winners.Load() != 1 || len(runs) != 1 || !runs[0].Status.Terminal() || len(runs[0].Events) != 2 {
		t.Fatalf("terminal race: winners=%d runs=%+v err=%v", winners.Load(), runs, err)
	}
}

func writeImportFixture(t *testing.T, dir string, run Run) []byte {
	t.Helper()
	raw, err := json.Marshal(runFile{SchemaVersion: SchemaVersion, Run: run})
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(dir, run.ID+".json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestSQLiteJSONImportExplicitOwnershipBackupsAndIdempotency(t *testing.T) {
	repo, db, _ := sqliteFixture(t)
	source, backup := t.TempDir(), filepath.Join(t.TempDir(), "backups")
	first := testRun()
	second := testRun()
	second.ID = "run-second"
	original := writeImportFixture(t, source, first)
	writeImportFixture(t, source, second)
	report, err := repo.ImportJSON(source, backup, map[string]string{first.ID: "owner"})
	if !errors.Is(err, ErrOwnershipMapping) || len(report.Blocked) != 1 {
		t.Fatalf("ownership guessed: %+v %v", report, err)
	}
	runs, _ := repo.List()
	if len(runs) != 0 {
		t.Fatal("blocked import partially committed")
	}
	owners := map[string]string{first.ID: "owner", second.ID: "owner"}
	report, err = repo.ImportJSON(source, backup, owners)
	if err != nil || report.Imported != 2 {
		t.Fatalf("import: %+v %v", report, err)
	}
	report, err = repo.ImportJSON(source, backup, owners)
	if err != nil || report.Imported != 0 || report.Skipped != 2 {
		t.Fatalf("idempotency: %+v %v", report, err)
	}
	report, err = repo.ImportJSON(source, backup, nil)
	if err != nil || report.Imported != 0 || report.Skipped != 2 {
		t.Fatalf("completed migration required ownership mapping again: %+v %v", report, err)
	}
	if _, err = repo.ImportJSON(source, backup, map[string]string{first.ID: "another-owner"}); !errors.Is(err, ErrOwnershipMapping) {
		t.Fatalf("changed ownership map accepted: %v", err)
	}
	entries, err := os.ReadDir(backup)
	if err != nil || len(entries) != 2 {
		t.Fatalf("backups: %v %v", entries, err)
	}
	retained, err := os.ReadFile(filepath.Join(source, first.ID+".json"))
	if err != nil || string(retained) != string(original) {
		t.Fatal("legacy original modified")
	}
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM agent_run_imports`).Scan(&count); err != nil || count != 2 {
		t.Fatalf("missing hash/version markers: %d %v", count, err)
	}
	first.Goal = "changed source"
	writeImportFixture(t, source, first)
	if _, err = repo.ImportJSON(source, backup, owners); err == nil {
		t.Fatal("changed import source silently accepted")
	}
	runs, err = repo.List()
	if err != nil || len(runs) != 2 || runs[0].Goal != "durable" {
		t.Fatalf("changed source overwrote run: %+v %v", runs, err)
	}
}

func TestSQLiteJSONImportRollsBackWholeBatchOnConflict(t *testing.T) {
	repo, db, _ := sqliteFixture(t)
	source := t.TempDir()
	first := testRun()
	first.ID = "run-a"
	second := ownedFixture()
	second.ID = "run-b"
	if err := repo.Save(second); err != nil {
		t.Fatal(err)
	}
	writeImportFixture(t, source, first)
	writeImportFixture(t, source, second)
	if _, err := repo.ImportJSON(source, t.TempDir(), map[string]string{first.ID: "owner", second.ID: "owner"}); err == nil {
		t.Fatal("conflicting identity imported")
	}
	runs, err := repo.List()
	if err != nil || len(runs) != 1 || runs[0].ID != second.ID {
		t.Fatalf("batch partially committed: %+v %v", runs, err)
	}
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM agent_run_imports`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("rolled-back import left markers: %d %v", count, err)
	}
}
