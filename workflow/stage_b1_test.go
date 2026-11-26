package workflow

import (
	"errors"
	"sync"
	"testing"
)

func typedGraph() WorkflowGraph {
	return WorkflowGraph{Steps: []Step{{ID: "finish", StepType: StepTypeAgentPromptV1, Dependencies: []string{"start"}, Input: []byte(`{"prompt":"finish"}`)}, {ID: "start", StepType: StepTypeAgentPromptV1, Input: []byte(`{"prompt":"start"}`)}}}
}

func TestStageB1MigrationIsAdditiveAndSchemaIsVerifiable(t *testing.T) {
	repo, db := workflowFixture(t)
	if repo == nil {
		t.Fatal("repository unavailable")
	}
	var first, second, third string
	if err := db.QueryRow(`SELECT sha256 FROM persistence_migrations WHERE name='workflow/1'`).Scan(&first); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT sha256 FROM persistence_migrations WHERE name='workflow/2'`).Scan(&second); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT sha256 FROM persistence_migrations WHERE name='workflow/3'`).Scan(&third); err != nil || third == "" {
		t.Fatalf("workflow/3 marker: %q %v", third, err)
	}
	if _, err := NewSQLiteRepository(db); err != nil {
		t.Fatal(err)
	}
	var firstAgain, secondAgain string
	if err := db.QueryRow(`SELECT sha256 FROM persistence_migrations WHERE name='workflow/1'`).Scan(&firstAgain); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT sha256 FROM persistence_migrations WHERE name='workflow/2'`).Scan(&secondAgain); err != nil {
		t.Fatal(err)
	}
	if first != firstAgain || second != secondAgain {
		t.Fatalf("legacy migration checksums changed: %s/%s -> %s/%s", first, second, firstAgain, secondAgain)
	}
	if err := VerifyWorkflowSchema(db); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`DROP INDEX workflow_dispatches_agent_run`); err != nil {
		t.Fatal(err)
	}
	if err := VerifyWorkflowSchema(db); err == nil {
		t.Fatal("schema verifier accepted a missing Stage B1 index")
	}
}

func TestUntypedLegacyStepsRemainReadableButCannotBeClaimed(t *testing.T) {
	repo, _ := workflowFixture(t)
	definition, err := repo.CreateDefinition("owner-a", CreateDefinitionRequest{ID: "legacy-untyped", Name: "legacy", Graph: graphWithInput(`{"legacy":true}`)})
	if err != nil {
		t.Fatal(err)
	}
	run, err := repo.CreateRun("owner-a", CreateRunRequest{ID: "legacy-run", DefinitionID: definition.ID})
	if err != nil {
		t.Fatal(err)
	}
	if run.Steps[0].StepType != "" {
		t.Fatal("legacy step unexpectedly typed")
	}
	_, err = repo.ClaimStep("owner-a", ClaimStepRequest{RunID: run.ID, StepID: "start", ExpectedWorkflowRevision: 1, ExpectedStepRevision: 1})
	if !errors.Is(err, ErrNotExecutable) {
		t.Fatalf("untyped step claim error: %v", err)
	}
}

func TestUnsupportedStepTypesCannotBeClaimed(t *testing.T) {
	if err := ValidateExecutableStep(Step{ID: "step", StepType: "tool"}); !errors.Is(err, ErrNotExecutable) {
		t.Fatalf("unsupported step type accepted: %v", err)
	}
}

func TestClaimStepChecksDependenciesRevisionsAndAllowsOneConcurrentWinner(t *testing.T) {
	repo, _ := workflowFixture(t)
	definition, err := repo.CreateDefinition("owner-a", CreateDefinitionRequest{ID: "typed-claim", Name: "typed", Graph: typedGraph()})
	if err != nil {
		t.Fatal(err)
	}
	run, err := repo.CreateRun("owner-a", CreateRunRequest{ID: "typed-run", DefinitionID: definition.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = repo.ClaimStep("owner-a", ClaimStepRequest{RunID: run.ID, StepID: "finish", ExpectedWorkflowRevision: 1, ExpectedStepRevision: 1}); !errors.Is(err, ErrConflict) {
		t.Fatalf("dependent step claimed before dependency: %v", err)
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, callErr := repo.ClaimStep("owner-a", ClaimStepRequest{RunID: run.ID, StepID: "start", ExpectedWorkflowRevision: 1, ExpectedStepRevision: 1})
			results <- callErr
		}()
	}
	wg.Wait()
	close(results)
	wins := 0
	for callErr := range results {
		if callErr == nil {
			wins++
		} else if !errors.Is(callErr, ErrConflict) {
			t.Fatalf("unexpected concurrent claim error: %v", callErr)
		}
	}
	if wins != 1 {
		t.Fatalf("claim winners: %d", wins)
	}
	if _, err = repo.ClaimStep("owner-a", ClaimStepRequest{RunID: run.ID, StepID: "start", ExpectedWorkflowRevision: 1, ExpectedStepRevision: 1}); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale claim accepted: %v", err)
	}
}

func TestDispatchIntentIsStableIdempotentAndRollbackSafe(t *testing.T) {
	repo, db := workflowFixture(t)
	definition, err := repo.CreateDefinition("owner-a", CreateDefinitionRequest{ID: "typed-dispatch", Name: "typed", Graph: typedGraph()})
	if err != nil {
		t.Fatal(err)
	}
	run, err := repo.CreateRun("owner-a", CreateRunRequest{ID: "dispatch-run", DefinitionID: definition.ID})
	if err != nil {
		t.Fatal(err)
	}
	claimed, err := repo.ClaimStep("owner-a", ClaimStepRequest{RunID: run.ID, StepID: "start", ExpectedWorkflowRevision: 1, ExpectedStepRevision: 1})
	if err != nil {
		t.Fatal(err)
	}
	claimedRun, err := repo.GetRun("owner-a", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if claimedRun.Status != RunRunning || claimedRun.Revision != claimed.WorkflowRevision {
		t.Fatalf("claim did not advance canonical run state: %+v", claimedRun)
	}
	request := DispatchIntentRequest{RunID: run.ID, StepID: "start", ExpectedWorkflowRevision: claimed.WorkflowRevision, ExpectedStepRevision: claimed.Step.Revision, AgentRunID: "stable-agent-run", ExecutionMode: "", Input: []byte(`{"request":1}`), Metadata: map[string]interface{}{"source": "test"}}
	intent, err := repo.PrepareDispatchIntent("owner-a", request)
	if err != nil {
		t.Fatal(err)
	}
	if intent.ExecutionMode != ExecutionModeOffline || intent.State != DispatchStatePrepared {
		t.Fatalf("intent: %+v", intent)
	}
	request.DispatchID = intent.DispatchID
	same, err := repo.PrepareDispatchIntent("owner-a", request)
	if err != nil || same.AgentRunID != intent.AgentRunID {
		t.Fatalf("idempotent intent: %+v %v", same, err)
	}
	request.Input = []byte(`{"request":2}`)
	if _, err = repo.PrepareDispatchIntent("owner-a", request); !errors.Is(err, ErrConflict) {
		t.Fatalf("conflicting intent accepted: %v", err)
	}
	if _, err = db.Exec(`CREATE TRIGGER reject_dispatch_event BEFORE INSERT ON workflow_events WHEN NEW.event_type='step.dispatch_prepared' BEGIN SELECT RAISE(ABORT,'rollback'); END`); err != nil {
		t.Fatal(err)
	}
	secondRun, err := repo.CreateRun("owner-a", CreateRunRequest{ID: "rollback-run", DefinitionID: definition.ID})
	if err != nil {
		t.Fatal(err)
	}
	secondClaim, err := repo.ClaimStep("owner-a", ClaimStepRequest{RunID: secondRun.ID, StepID: "start", ExpectedWorkflowRevision: 1, ExpectedStepRevision: 1})
	if err != nil {
		t.Fatal(err)
	}
	_, err = repo.PrepareDispatchIntent("owner-a", DispatchIntentRequest{RunID: secondRun.ID, StepID: "start", ExpectedWorkflowRevision: secondClaim.WorkflowRevision, ExpectedStepRevision: secondClaim.Step.Revision, AgentRunID: "rollback-agent", Input: []byte(`{}`)})
	if err == nil {
		t.Fatal("trigger failure did not roll back")
	}
	var dispatches, agents int
	if err = db.QueryRow(`SELECT COUNT(*) FROM workflow_dispatches WHERE run_id=?`, secondRun.ID).Scan(&dispatches); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT COUNT(*) FROM task_runs WHERE id='rollback-agent'`).Scan(&agents); err != nil {
		t.Fatal(err)
	}
	if dispatches != 0 || agents != 0 {
		t.Fatalf("rollback left rows: dispatches=%d agents=%d", dispatches, agents)
	}
	if _, err = db.Exec(`DROP TRIGGER reject_dispatch_event`); err != nil {
		t.Fatal(err)
	}
	events, err := repo.ListEvents("owner-a", run.ID, 0, 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 4 || events[1].Type != RunStartedEvent || events[2].Type != DispatchStartedEvent || events[3].Type != DispatchPreparedEvent {
		t.Fatalf("event sequence: %+v", events)
	}
	var agentProjection int
	if err = db.QueryRow(`SELECT COUNT(*) FROM agent_runs WHERE id=?`, intent.AgentRunID).Scan(&agentProjection); err != nil {
		t.Fatal(err)
	}
	if agentProjection != 1 {
		t.Fatalf("missing agent compatibility projection: %d", agentProjection)
	}
}

func TestNormalizeExecutionMode(t *testing.T) {
	for _, input := range []string{"", " ", "offline"} {
		mode, err := NormalizeExecutionMode(input)
		if err != nil || mode != ExecutionModeOffline {
			t.Fatalf("offline normalization %q: %q %v", input, mode, err)
		}
	}
	if mode, err := NormalizeExecutionMode("online"); err != nil || mode != ExecutionModeOnline {
		t.Fatalf("online normalization: %q %v", mode, err)
	}
	if _, err := NormalizeExecutionMode("sandbox"); !errors.Is(err, ErrValidation) {
		t.Fatalf("invalid mode: %v", err)
	}
}

func TestClaimAndPrepareDispatchIsOneRollbackSafeTransaction(t *testing.T) {
	repo, db := workflowFixture(t)
	definition, err := repo.CreateDefinition("owner-a", CreateDefinitionRequest{ID: "atomic-dispatch", Name: "atomic", Graph: typedGraph()})
	if err != nil {
		t.Fatal(err)
	}
	run, err := repo.CreateRun("owner-a", CreateRunRequest{ID: "atomic-run", DefinitionID: definition.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`CREATE TRIGGER reject_atomic_dispatch BEFORE INSERT ON workflow_events WHEN NEW.event_type='step.dispatch_prepared' BEGIN SELECT RAISE(ABORT,'rollback'); END`); err != nil {
		t.Fatal(err)
	}
	request := DispatchIntentRequest{RunID: run.ID, StepID: "start", ExpectedWorkflowRevision: 1, ExpectedStepRevision: 1, AgentRunID: "run-atomic-agent", Input: []byte(`{"prompt":"start"}`)}
	if _, err = repo.ClaimAndPrepareDispatchIntent("owner-a", request); err == nil {
		t.Fatal("atomic dispatch unexpectedly succeeded")
	}
	var stepStatus StepStatus
	var stepRevision, runRevision int
	if err = db.QueryRow(`SELECT status,revision FROM workflow_steps WHERE run_id=? AND step_id=?`, run.ID, "start").Scan(&stepStatus, &stepRevision); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT revision FROM task_runs WHERE id=?`, run.ID).Scan(&runRevision); err != nil {
		t.Fatal(err)
	}
	if stepStatus != StepQueued || stepRevision != 1 || runRevision != 1 {
		t.Fatalf("atomic rollback left claim state: step=%s/%d run=%d", stepStatus, stepRevision, runRevision)
	}
	var count int
	if err = db.QueryRow(`SELECT COUNT(*) FROM workflow_dispatches WHERE run_id=?`, run.ID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("atomic rollback left dispatch intent: %d", count)
	}
	if _, err = db.Exec(`DROP TRIGGER reject_atomic_dispatch`); err != nil {
		t.Fatal(err)
	}
	intent, err := repo.ClaimAndPrepareDispatchIntent("owner-a", request)
	if err != nil || intent.AgentRunID != request.AgentRunID {
		t.Fatalf("atomic dispatch: %+v %v", intent, err)
	}
	if _, err = repo.ClaimAndPrepareDispatchIntent("owner-a", request); err != nil {
		t.Fatalf("atomic idempotent retry: %v", err)
	}
}
