package workflow

import (
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ai-server-studio-backend/agentrun"
	"ai-server-studio-backend/persistence"
)

func workflowFixture(t *testing.T) (*SQLiteRepository, *sql.DB) {
	t.Helper()
	db, err := persistence.Open(filepath.Join(t.TempDir(), "workflow.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err = db.Exec(`CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES('owner-a'),('owner-b')`); err != nil {
		t.Fatal(err)
	}
	if _, err = agentrun.NewSQLiteRepository(db); err != nil {
		t.Fatal(err)
	}
	repo, err := NewSQLiteRepository(db)
	if err != nil {
		t.Fatal(err)
	}
	return repo, db
}

func graphWithInput(input string) WorkflowGraph {
	return WorkflowGraph{Steps: []Step{
		{ID: "finish", Dependencies: []string{"start"}, Input: []byte(input)},
		{ID: "start", Input: []byte(`{"prompt":"hello"}`)},
	}}
}

func TestGraphValidationRejectsInvalidGraphs(t *testing.T) {
	cases := []WorkflowGraph{
		{Steps: []Step{{ID: ""}}},
		{Steps: []Step{{ID: "a"}, {ID: "a"}}},
		{Steps: []Step{{ID: "a", Dependencies: []string{"missing"}}}},
		{Steps: []Step{{ID: "a", Dependencies: []string{"a"}}}},
		{Steps: []Step{{ID: "a", Dependencies: []string{"b"}}, {ID: "b", Dependencies: []string{"a"}}}},
		{Steps: []Step{{ID: "a", Input: []byte(`{bad}`)}}},
	}
	for i, graph := range cases {
		if err := graph.Validate(); !errors.Is(err, ErrValidation) {
			t.Errorf("case %d: got %v, want validation error", i, err)
		}
	}
	long := make([]byte, MaxJSONInputBytes+1)
	for i := range long {
		long[i] = 'x'
	}
	if err := (WorkflowGraph{Steps: []Step{{ID: "a", Input: append([]byte(`"`), append(long, '"')...)}}}).Validate(); !errors.Is(err, ErrValidation) {
		t.Fatalf("oversized input accepted: %v", err)
	}
}

func TestDefinitionVersionsAreImmutableAndMonotonic(t *testing.T) {
	repo, _ := workflowFixture(t)
	definition, err := repo.CreateDefinition("owner-a", CreateDefinitionRequest{Name: "demo", Graph: graphWithInput(`{"n":1}`)})
	if err != nil {
		t.Fatal(err)
	}
	first, err := repo.GetVersion("owner-a", definition.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	version, err := repo.CreateVersion("owner-a", definition.ID, graphWithInput(`{"n":2}`))
	if err != nil || version.Version != 2 {
		t.Fatalf("version: %+v %v", version, err)
	}
	third, err := repo.CreateVersion("owner-a", definition.ID, graphWithInput(`{"n":3}`))
	if err != nil || third.Version != 3 {
		t.Fatalf("third version: %+v %v", third, err)
	}
	loaded, err := repo.GetVersion("owner-a", definition.ID, 1)
	if err != nil || loaded.Checksum != first.Checksum || string(loaded.Graph.Steps[0].Input) == string(version.Graph.Steps[0].Input) {
		t.Fatalf("version one changed: %+v %v", loaded, err)
	}
	if _, err = repo.GetDefinition("owner-b", definition.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("owner isolation failure: %v", err)
	}
}

func TestCreateRunRejectsTamperedVersionChecksum(t *testing.T) {
	repo, db := workflowFixture(t)
	definition, err := repo.CreateDefinition("owner-a", CreateDefinitionRequest{
		ID:    "definition-checksum",
		Name:  "checksum",
		Graph: WorkflowGraph{Steps: []Step{{ID: "only", Input: []byte(`{"value":1}`)}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE workflow_versions SET checksum=? WHERE definition_id=? AND version=1`, strings.Repeat("0", 64), definition.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.CreateRun("owner-a", CreateRunRequest{DefinitionID: definition.ID}); !errors.Is(err, ErrValidation) {
		t.Fatalf("tampered version accepted: %v", err)
	}
}

func TestMigrationIdempotenceOwnerIsolationRunEventsAndRevision(t *testing.T) {
	repo, db := workflowFixture(t)
	if _, err := NewSQLiteRepository(db); err != nil {
		t.Fatal("second migration: ", err)
	}
	definition, err := repo.CreateDefinition("owner-a", CreateDefinitionRequest{ID: "definition-a", Name: "demo", Graph: graphWithInput(`{"n":1}`)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = repo.CreateRun("owner-b", CreateRunRequest{DefinitionID: definition.ID}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-owner run accepted: %v", err)
	}
	run, err := repo.CreateRun("owner-a", CreateRunRequest{ID: "run-a", DefinitionID: definition.ID, Input: []byte(`{"request":true}`)})
	if err != nil {
		t.Fatal(err)
	}
	if run.Revision != 1 || len(run.Steps) != 2 {
		t.Fatalf("initial run: %+v", run)
	}
	events, err := repo.ListEvents("owner-a", run.ID, 0, 100)
	if err != nil || len(events) != 1 || events[0].Sequence != 1 {
		t.Fatalf("initial events: %+v %v", events, err)
	}
	var next uint64
	if err = db.QueryRow(`SELECT next_sequence FROM workflow_event_cursors WHERE run_id=?`, run.ID).Scan(&next); err != nil || next != 2 {
		t.Fatalf("event cursor: %d %v", next, err)
	}
	if _, err = repo.TransitionRun("owner-a", run.ID, 99, TransitionRequest{To: RunValidating}); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale transition accepted: %v", err)
	}
	updated, err := repo.TransitionRun("owner-a", run.ID, 1, TransitionRequest{To: RunValidating})
	if err != nil || updated.Revision != 2 {
		t.Fatalf("transition: %+v %v", updated, err)
	}
	events, err = repo.ListEvents("owner-a", run.ID, 1, 100)
	if err != nil || len(events) != 1 || events[0].Sequence != 2 {
		t.Fatalf("transition events: %+v %v", events, err)
	}
	runs, err := repo.ListRuns("owner-a")
	if err != nil || len(runs) != 1 || len(runs[0].Steps) != 2 {
		t.Fatalf("list runs: %+v %v", runs, err)
	}
	if _, err = repo.GetRun("owner-b", run.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-owner read accepted: %v", err)
	}
}

func TestMigrationRequiresCanonicalTaskRuns(t *testing.T) {
	path := filepath.Join(t.TempDir(), "empty.sqlite")
	db, err := persistence.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err = NewSQLiteRepository(db); err == nil {
		t.Fatal("workflow repository initialized without canonical task_runs")
	}
	if _, err = os.Stat(path); err != nil {
		t.Fatal(err)
	}
}

func TestWorkflowStepStatePersistsDependenciesAttemptAndRevision(t *testing.T) {
	repo, db := workflowFixture(t)
	definition, err := repo.CreateDefinition("owner-a", CreateDefinitionRequest{
		ID:   "definition-step-state",
		Name: "step state",
		Graph: WorkflowGraph{Steps: []Step{
			{ID: "finish", Dependencies: []string{"start"}, Input: []byte(`{"kind":"finish"}`)},
			{ID: "start", Input: []byte(`{"kind":"start"}`)},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	run, err := repo.CreateRun("owner-a", CreateRunRequest{ID: "run-step-state", DefinitionID: definition.ID})
	if err != nil {
		t.Fatal(err)
	}
	if len(run.Steps) != 2 {
		t.Fatalf("steps: %+v", run.Steps)
	}
	for _, step := range run.Steps {
		if step.Attempt != 0 || step.Revision != 1 {
			t.Fatalf("step defaults: %+v", step)
		}
		if step.ID == "finish" && len(step.Dependencies) != 1 || step.ID == "finish" && step.Dependencies[0] != "start" {
			t.Fatalf("finish dependencies: %+v", step.Dependencies)
		}
		if step.ID == "start" && step.Dependencies == nil {
			t.Fatal("empty dependencies were not normalized to an array")
		}
	}
	var dependencies string
	var attempt, revision int
	if err = db.QueryRow(`SELECT dependencies_json,attempt,revision FROM workflow_steps WHERE run_id=? AND step_id=?`, run.ID, "finish").Scan(&dependencies, &attempt, &revision); err != nil {
		t.Fatal(err)
	}
	if dependencies != `["start"]` || attempt != 0 || revision != 1 {
		t.Fatalf("persisted step state: dependencies=%s attempt=%d revision=%d", dependencies, attempt, revision)
	}
	reloaded, err := repo.GetRun("owner-a", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(reloaded.Steps) != 2 || reloaded.Steps[0].Revision != 1 || reloaded.Steps[1].Attempt != 0 {
		t.Fatalf("reloaded step state: %+v", reloaded.Steps)
	}
}

func transitionWorkflowRunToRunning(t *testing.T, repo *SQLiteRepository, runID string) WorkflowRun {
	t.Helper()
	if _, err := repo.TransitionRun("owner-a", runID, 1, TransitionRequest{To: RunValidating}); err != nil {
		t.Fatal(err)
	}
	run, err := repo.TransitionRun("owner-a", runID, 2, TransitionRequest{To: RunRunning})
	if err != nil {
		t.Fatal(err)
	}
	return run
}

func TestTransitionRunCompletionRequiresEveryStepSucceeded(t *testing.T) {
	repo, db := workflowFixture(t)
	definition, err := repo.CreateDefinition("owner-a", CreateDefinitionRequest{ID: "definition-completion", Name: "completion", Graph: graphWithInput(`{"n":1}`)})
	if err != nil {
		t.Fatal(err)
	}
	statuses := []StepStatus{StepQueued, StepRunning, StepWaiting, StepFailed, StepCancelled, StepSkipped}
	for i, status := range statuses {
		runID := "run-incomplete-" + string(rune('a'+i))
		if _, err = repo.CreateRun("owner-a", CreateRunRequest{ID: runID, DefinitionID: definition.ID}); err != nil {
			t.Fatal(err)
		}
		run := transitionWorkflowRunToRunning(t, repo, runID)
		if _, err = db.Exec(`UPDATE workflow_steps SET status=? WHERE run_id=? AND step_id=?`, status, runID, "start"); err != nil {
			t.Fatal(err)
		}
		beforeEvents, err := repo.ListEvents("owner-a", runID, 0, 100)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = repo.TransitionRun("owner-a", runID, run.Revision, TransitionRequest{To: RunSucceeded}); !errors.Is(err, ErrIncompleteSteps) {
			t.Fatalf("status %s completion error: %v", status, err)
		}
		after, err := repo.GetRun("owner-a", runID)
		if err != nil {
			t.Fatal(err)
		}
		afterEvents, err := repo.ListEvents("owner-a", runID, 0, 100)
		if err != nil {
			t.Fatal(err)
		}
		if after.Status != RunRunning || after.Revision != run.Revision || after.UpdatedAt != run.UpdatedAt || len(afterEvents) != len(beforeEvents) {
			t.Fatalf("rejected completion mutated run: before=%+v after=%+v events=%d/%d", run, after, len(beforeEvents), len(afterEvents))
		}
	}
	if _, err = repo.CreateRun("owner-a", CreateRunRequest{ID: "run-complete", DefinitionID: definition.ID}); err != nil {
		t.Fatal(err)
	}
	run := transitionWorkflowRunToRunning(t, repo, "run-complete")
	if _, err = db.Exec(`UPDATE workflow_steps SET status=? WHERE run_id=?`, StepSucceeded, "run-complete"); err != nil {
		t.Fatal(err)
	}
	completed, err := repo.TransitionRun("owner-a", "run-complete", run.Revision, TransitionRequest{To: RunSucceeded})
	if err != nil || completed.Status != RunSucceeded || completed.Revision != run.Revision+1 {
		t.Fatalf("successful completion: %+v %v", completed, err)
	}
}

func TestTransitionRunCompletionRejectsStaleRevision(t *testing.T) {
	repo, db := workflowFixture(t)
	definition, err := repo.CreateDefinition("owner-a", CreateDefinitionRequest{Name: "stale completion", Graph: graphWithInput(`{"n":1}`)})
	if err != nil {
		t.Fatal(err)
	}
	run, err := repo.CreateRun("owner-a", CreateRunRequest{DefinitionID: definition.ID})
	if err != nil {
		t.Fatal(err)
	}
	run = transitionWorkflowRunToRunning(t, repo, run.ID)
	if _, err = db.Exec(`UPDATE workflow_steps SET status=? WHERE run_id=?`, StepSucceeded, run.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.TransitionRun("owner-a", run.ID, run.Revision-1, TransitionRequest{To: RunSucceeded}); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale completion accepted: %v", err)
	}
	current, err := repo.GetRun("owner-a", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	events, err := repo.ListEvents("owner-a", run.ID, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	if current.Status != RunRunning || current.Revision != run.Revision || len(events) != 3 {
		t.Fatalf("stale completion mutated run: %+v events=%d", current, len(events))
	}
}

func TestVerifyWorkflowSchemaDetectsTamperingAndIncompleteSchema(t *testing.T) {
	repo, db := workflowFixture(t)
	if repo == nil {
		t.Fatal("workflow repository unavailable")
	}
	if _, err := db.Exec(`DROP INDEX workflow_steps_status`); err != nil {
		t.Fatal(err)
	}
	if err := VerifyWorkflowSchema(db); err == nil {
		t.Fatal("schema verifier accepted a missing index")
	}
	if _, err := NewSQLiteRepository(db); err == nil {
		t.Fatal("repository accepted a tampered schema")
	}
	if _, err := db.Exec(`CREATE INDEX workflow_steps_status ON workflow_steps(status, run_id, step_id)`); err != nil {
		t.Fatal(err)
	}
	if err := VerifyWorkflowSchema(db); err != nil {
		t.Fatal("restored schema rejected: ", err)
	}

	db2, err := persistence.Open(filepath.Join(t.TempDir(), "incomplete.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db2.Close()
	if _, err = db2.Exec(`CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES('owner-a')`); err != nil {
		t.Fatal(err)
	}
	if _, err = agentrun.NewSQLiteRepository(db2); err != nil {
		t.Fatal(err)
	}
	if err = VerifyWorkflowSchema(db2); err == nil {
		t.Fatal("schema verifier accepted an incomplete workflow schema")
	}
}
