package workflow

import (
	"context"
	"encoding/json"
	"errors"
	"sync"
	"testing"
)

type stageB2FakeExecutor struct {
	mu     sync.Mutex
	calls  []string
	result func(DispatchIntent) ExecutionResult
	err    error
}

func (f *stageB2FakeExecutor) Execute(_ context.Context, intent DispatchIntent) (ExecutionResult, error) {
	f.mu.Lock()
	f.calls = append(f.calls, intent.StepID)
	f.mu.Unlock()
	if f.err != nil {
		return ExecutionResult{}, f.err
	}
	return f.result(intent), nil
}

func (f *stageB2FakeExecutor) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.calls)
}

func b2Definition(t *testing.T, repo *SQLiteRepository, graph WorkflowGraph, id string) WorkflowDefinition {
	t.Helper()
	definition, err := repo.CreateDefinition("owner-a", CreateDefinitionRequest{ID: id, Name: id, Graph: graph})
	if err != nil {
		t.Fatal(err)
	}
	return definition
}

func b2Success(intent DispatchIntent) ExecutionResult {
	return ExecutionResult{AgentRunID: intent.AgentRunID, Status: RunSucceeded, Output: json.RawMessage(`{"ok":true}`)}
}

func TestStageB2SingleStepSuccess(t *testing.T) {
	repo, db := workflowFixture(t)
	definition := b2Definition(t, repo, WorkflowGraph{Steps: []Step{{ID: "only", StepType: StepTypeAgentPromptV1, Input: []byte(`{"prompt":"hello"}`)}}}, "b2-single")
	run, err := repo.CreateRun("owner-a", CreateRunRequest{ID: "b2-single-run", DefinitionID: definition.ID})
	if err != nil {
		t.Fatal(err)
	}
	fake := &stageB2FakeExecutor{result: b2Success}
	orchestrator := NewOrchestrator(repo, fake)
	first, err := orchestrator.RunNext(context.Background(), "owner-a", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if first.Status != RunSucceeded || first.Steps[0].Status != StepSucceeded {
		t.Fatalf("completion: %+v", first)
	}
	if fake.callCount() != 1 {
		t.Fatalf("executor calls: %d", fake.callCount())
	}
	var workflowStatus string
	if err = db.QueryRow(`SELECT status FROM task_runs WHERE id=?`, run.ID).Scan(&workflowStatus); err != nil {
		t.Fatal(err)
	}
	if workflowStatus != string(RunSucceeded) {
		t.Fatalf("canonical workflow status: %s", workflowStatus)
	}
}

func TestStageB2LinearAndMultiDependencyOrdering(t *testing.T) {
	repo, _ := workflowFixture(t)
	graph := WorkflowGraph{Steps: []Step{
		{ID: "c", StepType: StepTypeAgentPromptV1, Dependencies: []string{"a", "b"}, Input: []byte(`{"prompt":"c"}`)},
		{ID: "b", StepType: StepTypeAgentPromptV1, Dependencies: []string{"a"}, Input: []byte(`{"prompt":"b"}`)},
		{ID: "a", StepType: StepTypeAgentPromptV1, Input: []byte(`{"prompt":"a"}`)},
	}}
	definition := b2Definition(t, repo, graph, "b2-deps")
	run, err := repo.CreateRun("owner-a", CreateRunRequest{ID: "b2-deps-run", DefinitionID: definition.ID})
	if err != nil {
		t.Fatal(err)
	}
	fake := &stageB2FakeExecutor{result: b2Success}
	orchestrator := NewOrchestrator(repo, fake)
	first, err := orchestrator.RunNext(context.Background(), "owner-a", run.ID)
	if err != nil || first.Status != RunRunning {
		t.Fatalf("first dependency step prematurely completed run: %+v %v", first, err)
	}
	completed, err := orchestrator.Run(context.Background(), "owner-a", run.ID)
	if err != nil || completed.Status != RunSucceeded {
		t.Fatalf("dependency run: %+v %v", completed, err)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	want := []string{"a", "b", "c"}
	if len(fake.calls) != len(want) {
		t.Fatalf("calls: %v", fake.calls)
	}
	for i := range want {
		if fake.calls[i] != want[i] {
			t.Fatalf("execution order: %v, want %v", fake.calls, want)
		}
	}
}

func TestStageB2FailurePolicyAndInvalidStepsDoNotDispatch(t *testing.T) {
	repo, _ := workflowFixture(t)
	definition := b2Definition(t, repo, WorkflowGraph{Steps: []Step{
		{ID: "downstream", StepType: StepTypeAgentPromptV1, Dependencies: []string{"failed"}, Input: []byte(`{"prompt":"downstream"}`)},
		{ID: "failed", StepType: StepTypeAgentPromptV1, Input: []byte(`{"prompt":"failed"}`)},
	}}, "b2-failure")
	run, err := repo.CreateRun("owner-a", CreateRunRequest{ID: "b2-failure-run", DefinitionID: definition.ID})
	if err != nil {
		t.Fatal(err)
	}
	fake := &stageB2FakeExecutor{result: func(intent DispatchIntent) ExecutionResult {
		return ExecutionResult{AgentRunID: intent.AgentRunID, Status: RunFailed, ErrorCode: "worker_failed", ErrorSummary: "worker failed"}
	}}
	failed, err := NewOrchestrator(repo, fake).Run(context.Background(), "owner-a", run.ID)
	if err != nil || failed.Status != RunFailed || fake.callCount() != 1 {
		t.Fatalf("failed workflow: %+v calls=%d err=%v", failed, fake.callCount(), err)
	}
	if _, err = repo.GetDispatchIntent("owner-a", run.ID, "downstream"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("failed dependency was dispatched: %v", err)
	}

	badDefinition := b2Definition(t, repo, WorkflowGraph{Steps: []Step{{ID: "bad", StepType: "unknown.v1", Input: []byte(`{"prompt":"x"}`)}}}, "b2-invalid")
	badRun, err := repo.CreateRun("owner-a", CreateRunRequest{ID: "b2-invalid-run", DefinitionID: badDefinition.ID})
	if err != nil {
		t.Fatal(err)
	}
	badFake := &stageB2FakeExecutor{result: b2Success}
	if _, err = NewOrchestrator(repo, badFake).RunNext(context.Background(), "owner-a", badRun.ID); !errors.Is(err, ErrNotExecutable) || badFake.callCount() != 0 {
		t.Fatalf("unsupported step: err=%v calls=%d", err, badFake.callCount())
	}

	policyDefinition := b2Definition(t, repo, WorkflowGraph{Steps: []Step{{ID: "policy", StepType: StepTypeAgentPromptV1, Input: []byte(`{"prompt":"policy"}`)}}}, "b2-policy")
	policyRun, err := repo.CreateRun("owner-a", CreateRunRequest{ID: "b2-policy-run", DefinitionID: policyDefinition.ID})
	if err != nil {
		t.Fatal(err)
	}
	policyFake := &stageB2FakeExecutor{result: func(intent DispatchIntent) ExecutionResult {
		return ExecutionResult{AgentRunID: intent.AgentRunID, Status: RunBlockedPolicy, ErrorCode: "policy_denied", ErrorSummary: "policy denied"}
	}}
	blocked, err := NewOrchestrator(repo, policyFake).Run(context.Background(), "owner-a", policyRun.ID)
	if err != nil || blocked.Status != RunBlockedPolicy || policyFake.callCount() != 1 {
		t.Fatalf("policy block: %+v calls=%d err=%v", blocked, policyFake.callCount(), err)
	}
	if _, err = NewOrchestrator(repo, policyFake).RunNext(context.Background(), "owner-a", policyRun.ID); err != nil || policyFake.callCount() != 1 {
		t.Fatalf("policy duplicate executed: err=%v calls=%d", err, policyFake.callCount())
	}

	promptDefinition := b2Definition(t, repo, WorkflowGraph{Steps: []Step{{ID: "prompt", StepType: StepTypeAgentPromptV1, Input: []byte(`{"prompt":" "}`)}}}, "b2-prompt")
	promptRun, err := repo.CreateRun("owner-a", CreateRunRequest{ID: "b2-prompt-run", DefinitionID: promptDefinition.ID})
	if err != nil {
		t.Fatal(err)
	}
	promptFake := &stageB2FakeExecutor{result: b2Success}
	if _, err = NewOrchestrator(repo, promptFake).RunNext(context.Background(), "owner-a", promptRun.ID); !errors.Is(err, ErrValidation) || promptFake.callCount() != 0 {
		t.Fatalf("invalid prompt dispatched: err=%v calls=%d", err, promptFake.callCount())
	}
}

func TestStageB2MismatchedResultAndDuplicateConcurrentCalls(t *testing.T) {
	repo, _ := workflowFixture(t)
	definition := b2Definition(t, repo, WorkflowGraph{Steps: []Step{{ID: "only", StepType: StepTypeAgentPromptV1, Input: []byte(`{"prompt":"hello"}`)}}}, "b2-id")
	run, err := repo.CreateRun("owner-a", CreateRunRequest{ID: "b2-id-run", DefinitionID: definition.ID})
	if err != nil {
		t.Fatal(err)
	}
	fake := &stageB2FakeExecutor{result: func(intent DispatchIntent) ExecutionResult {
		return ExecutionResult{AgentRunID: "wrong-agent", Status: RunSucceeded, Output: []byte(`{"ok":true}`)}
	}}
	orchestrator := NewOrchestrator(repo, fake)
	if _, err = orchestrator.Run(context.Background(), "owner-a", run.ID); err == nil {
		t.Fatal("mismatched agent ID accepted")
	}
	failed, getErr := repo.GetRun("owner-a", run.ID)
	if getErr != nil || failed.Status != RunFailed || fake.callCount() != 1 {
		t.Fatalf("mismatch was not terminally recorded: %+v %v calls=%d", failed, getErr, fake.callCount())
	}

	secondRun, err := repo.CreateRun("owner-a", CreateRunRequest{ID: "b2-concurrent-run", DefinitionID: definition.ID})
	if err != nil {
		t.Fatal(err)
	}
	concurrentFake := &stageB2FakeExecutor{result: b2Success}
	concurrent := NewOrchestrator(repo, concurrentFake)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _ = concurrent.RunNext(context.Background(), "owner-a", secondRun.ID)
		}()
	}
	wg.Wait()
	if concurrentFake.callCount() != 1 {
		t.Fatalf("concurrent executor calls: %d", concurrentFake.callCount())
	}
}

func TestStageB2RepositoryCompletionRollbackAndIdentityGuards(t *testing.T) {
	repo, db := workflowFixture(t)
	definition := b2Definition(t, repo, WorkflowGraph{Steps: []Step{{ID: "only", StepType: StepTypeAgentPromptV1, Input: []byte(`{"prompt":"hello"}`)}}}, "b2-repository")
	run, err := repo.CreateRun("owner-a", CreateRunRequest{ID: "b2-repository-run", DefinitionID: definition.ID})
	if err != nil {
		t.Fatal(err)
	}
	intent, err := repo.ClaimAndPrepareDispatchIntent("owner-a", DispatchIntentRequest{RunID: run.ID, StepID: "only", ExpectedWorkflowRevision: 1, ExpectedStepRevision: 1, Input: []byte(`{"prompt":"hello"}`)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`CREATE TRIGGER reject_b2_complete BEFORE INSERT ON workflow_events WHEN NEW.event_type='step.succeeded' BEGIN SELECT RAISE(ABORT,'rollback'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.CompleteStep("owner-a", run.ID, "only", 2, 2, intent.AgentRunID, []byte(`{"ok":true}`)); err == nil {
		t.Fatal("trigger failure did not roll back completion")
	}
	var status string
	if err = db.QueryRow(`SELECT status FROM workflow_steps WHERE run_id=? AND step_id=?`, run.ID, "only").Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != string(StepRunning) {
		t.Fatalf("rollback changed step: %s", status)
	}
	if _, err = db.Exec(`DROP TRIGGER reject_b2_complete`); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.CompleteStep("owner-a", run.ID, "only", 2, 2, "wrong", []byte(`{"ok":true}`)); !errors.Is(err, ErrConflict) {
		t.Fatalf("mismatched ID: %v", err)
	}
	if _, err = repo.CompleteStep("owner-a", run.ID, "only", 2, 2, intent.AgentRunID, []byte(`{"ok":true}`)); err != nil {
		t.Fatal(err)
	}
	if _, err = repo.CompleteStep("owner-a", run.ID, "only", 2, 2, intent.AgentRunID, []byte(`{"ok":true}`)); !errors.Is(err, ErrTerminal) && !errors.Is(err, ErrConflict) {
		t.Fatalf("duplicate completion: %v", err)
	}
}
