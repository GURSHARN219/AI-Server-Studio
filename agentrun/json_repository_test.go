package agentrun

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func testRun() Run {
	return Run{ID: "run-test", Goal: "durable", Status: StatusRunning, CreatedAt: 1, UpdatedAt: 1,
		Events:     []RunEvent{{Sequence: 1, Type: "plan_created", Timestamp: 1}},
		Checkpoint: &RunCheckpoint{Boundary: "planned", EventSequence: 1, UpdatedAt: 1}}
}

func TestJSONRepositoryReloadAndAtomicReplacement(t *testing.T) {
	dir := t.TempDir()
	repo, err := NewJSONRepository(dir)
	if err != nil {
		t.Fatal(err)
	}
	run := testRun()
	if err := repo.Save(run); err != nil {
		t.Fatal(err)
	}
	run.Status = StatusDone
	run.CompletedAt = 2
	run.Result = "finished"
	run.Events = append(run.Events, RunEvent{Sequence: 2, Type: "agent_done", Timestamp: 2})
	if err := repo.Save(run); err != nil {
		t.Fatal(err)
	}
	reloaded, err := NewJSONRepository(dir)
	if err != nil {
		t.Fatal(err)
	}
	runs, err := reloaded.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 1 || !reflect.DeepEqual(runs[0], run) {
		t.Fatalf("unexpected reload: %+v", runs)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("temporary files left behind: %v", entries)
	}
	// Failed serialization must not destroy the previous committed file.
	run.Events[0].Data = map[string]interface{}{"invalid": make(chan int)}
	if err := repo.Save(run); err == nil {
		t.Fatal("expected serialization error")
	}
	after, err := reloaded.List()
	if err != nil || !reflect.DeepEqual(after, runs) {
		t.Fatalf("failed save changed disk: %v", err)
	}
}

func TestJSONRepositoryRejectsCorruptionAndUnknownVersions(t *testing.T) {
	for _, tc := range []struct {
		name, content string
		want          error
	}{
		{"truncated", `{"schemaVersion":1,`, ErrCorrupt},
		{"unknown-version", `{"schemaVersion":2}`, ErrSchemaVersion},
		{"missing-version", `{}`, ErrSchemaVersion},
		{"invalid-status", `{"schemaVersion":1,"run":{"id":"run-test","status":"garbage","createdAt":1}}`, ErrCorrupt},
		{"bad-sequence", `{"schemaVersion":1,"run":{"id":"run-test","status":"running","createdAt":1,"events":[{"sequence":2,"type":"x","timestamp":1}]}}`, ErrCorrupt},
		{"terminal-without-time", `{"schemaVersion":1,"run":{"id":"run-test","status":"done","createdAt":1}}`, ErrCorrupt},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			if err := os.WriteFile(filepath.Join(dir, "run-test.json"), []byte(tc.content), 0600); err != nil {
				t.Fatal(err)
			}
			repo, err := NewJSONRepository(dir)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := repo.List(); !errors.Is(err, tc.want) {
				t.Fatalf("got %v, want %v", err, tc.want)
			}
		})
	}
}

func TestJSONRepositoryRejectsPathTraversal(t *testing.T) {
	repo, err := NewJSONRepository(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	run := testRun()
	run.ID = "../outside"
	if err := repo.Save(run); !errors.Is(err, ErrCorrupt) {
		t.Fatalf("got %v", err)
	}
}
