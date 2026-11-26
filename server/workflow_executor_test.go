package server

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"ai-server-studio-backend/agentrun"
	"ai-server-studio-backend/workflow"
)

func createExecutableWorkflow(t *testing.T, s *Server, input string) workflow.WorkflowRun {
	t.Helper()
	definition, err := s.workflows.CreateDefinition("test-owner", workflow.CreateDefinitionRequest{
		ID:    "b3-definition",
		Name:  "b3-definition",
		Graph: workflow.WorkflowGraph{Steps: []workflow.Step{{ID: "only", StepType: workflow.StepTypeAgentPromptV1, Input: json.RawMessage(input)}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	run, err := s.workflows.CreateRun("test-owner", workflow.CreateRunRequest{ID: "b3-run", DefinitionID: definition.ID})
	if err != nil {
		t.Fatal(err)
	}
	return run
}

func TestWorkflowAgentExecutionUsesStableAgentRunAndIsIdempotent(t *testing.T) {
	s, eng := testAgentServer(t)
	run := createExecutableWorkflow(t, s, `{"prompt":"workflow goal"}`)
	completed, err := s.executeWorkflowRun(context.Background(), "test-owner", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if completed.Status != workflow.RunSucceeded || len(completed.Steps) != 1 || completed.Steps[0].Status != workflow.StepSucceeded {
		t.Fatalf("workflow completion: %+v", completed)
	}
	var workflowOutput string
	if err := json.Unmarshal(completed.Steps[0].Output, &workflowOutput); err != nil || workflowOutput == "" {
		t.Fatalf("workflow output: %s %v", completed.Steps[0].Output, err)
	}
	intent, err := s.workflows.GetDispatchIntent("test-owner", run.ID, "only")
	if err != nil {
		t.Fatal(err)
	}
	agent, ok := s.agentRuns.get(intent.AgentRunID)
	if !ok {
		t.Fatal("stable agent run was not loaded into the store")
	}
	state := agent.snapshot()
	if state.ID != intent.AgentRunID || state.Status != agentrun.StatusDone || state.Goal != "workflow goal" || state.Result == "" {
		t.Fatalf("agent state: %+v", state)
	}
	calls := eng.calls.Load()
	repeated, err := s.executeWorkflowRun(context.Background(), "test-owner", run.ID)
	if err != nil || repeated.Status != workflow.RunSucceeded {
		t.Fatalf("repeat execution: %+v %v", repeated, err)
	}
	if eng.calls.Load() != calls {
		t.Fatalf("repeat launched model call: before=%d after=%d", calls, eng.calls.Load())
	}
}

func TestWorkflowAgentPolicyDenialDoesNotCallEngine(t *testing.T) {
	s, eng := testAgentServer(t)
	run := createExecutableWorkflow(t, s, `{"prompt":"blocked","executionMode":"offline","tools":[{"type":"function","function":{"name":"web-search"}}]}`)
	completed, err := s.executeWorkflowRun(context.Background(), "test-owner", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if completed.Status != workflow.RunBlockedPolicy || eng.calls.Load() != 0 {
		t.Fatalf("policy result: status=%s calls=%d", completed.Status, eng.calls.Load())
	}
	intent, err := s.workflows.GetDispatchIntent("test-owner", run.ID, "only")
	if err != nil {
		t.Fatal(err)
	}
	agent, ok := s.agentRuns.get(intent.AgentRunID)
	if !ok || agent.snapshot().Status != agentrun.StatusError {
		t.Fatalf("policy agent state missing: ok=%t state=%+v", ok, agent.snapshot())
	}
}

func TestWorkflowAgentExistingTerminalRunIsNotReexecuted(t *testing.T) {
	s, eng := testAgentServer(t)
	run := createExecutableWorkflow(t, s, `{"prompt":"workflow goal"}`)
	first, err := s.executeWorkflowRun(context.Background(), "test-owner", run.ID)
	if err != nil || first.Status != workflow.RunSucceeded {
		t.Fatalf("first execution: %+v %v", first, err)
	}
	intent, err := s.workflows.GetDispatchIntent("test-owner", run.ID, "only")
	if err != nil {
		t.Fatal(err)
	}
	agent, ok := s.agentRuns.get(intent.AgentRunID)
	if !ok {
		t.Fatal("agent missing")
	}
	if _, err = agent.finish(agentrun.StatusDone, "", "original", 1); err != nil && !errors.Is(err, errRunTerminal) {
		t.Fatal(err)
	}
	calls := eng.calls.Load()
	result, err := (&workflowExecutionAdapter{server: s}).Execute(context.Background(), intent)
	if err != nil || result.Status != workflow.RunSucceeded || eng.calls.Load() != calls {
		t.Fatalf("terminal replay: %+v err=%v calls=%d", result, err, eng.calls.Load())
	}
}

func TestWorkflowAgentRestartInterruptedRunIsNotRedispatched(t *testing.T) {
	s, eng := testAgentServer(t)
	run := createExecutableWorkflow(t, s, `{"prompt":"workflow goal"}`)
	intent, err := s.workflows.ClaimAndPrepareDispatchIntent("test-owner", workflow.DispatchIntentRequest{
		RunID: run.ID, StepID: "only", ExpectedWorkflowRevision: 1, ExpectedStepRevision: 1,
		Input: json.RawMessage(`{"prompt":"workflow goal"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	restarted, err := newAgentRunStore(s.agentRuns.repo)
	if err != nil {
		t.Fatal(err)
	}
	s.agentRuns = restarted
	result, err := (&workflowExecutionAdapter{server: s}).Execute(context.Background(), intent)
	if err != nil || result.Status != workflow.RunInterrupted || eng.calls.Load() != 0 {
		t.Fatalf("restart outcome: %+v err=%v calls=%d", result, err, eng.calls.Load())
	}
}

func TestWorkflowAgentValidationAndProviderPolicyRejectBeforeModel(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  workflow.RunStatus
	}{
		{"invalid mode", `{"prompt":"x","executionMode":"sideways"}`, workflow.RunFailed},
		{"invalid input type", `{"type":"other.v1","prompt":"x"}`, workflow.RunFailed},
		{"mismatched local model", `{"prompt":"x","modelName":"other-model"}`, workflow.RunBlockedPolicy},
		{"unowned online provider", `{"prompt":"x","executionMode":"online","providerId":"missing"}`, workflow.RunBlockedPolicy},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			s, eng := testAgentServer(t)
			run := createExecutableWorkflow(t, s, tc.input)
			completed, err := s.executeWorkflowRun(context.Background(), "test-owner", run.ID)
			if err != nil {
				t.Fatal(err)
			}
			if completed.Status != tc.want || eng.calls.Load() != 0 {
				t.Fatalf("policy result: status=%s calls=%d", completed.Status, eng.calls.Load())
			}
		})
	}
}

func TestWorkflowAgentDisabledOnlineProviderIsRejectedBeforeModel(t *testing.T) {
	s, eng := testAgentServer(t)
	if err := s.saveProvider("test-owner", providerRecord{
		ID: "disabled-provider", Name: "Disabled", BaseURL: "https://provider.example.com/v1", Enabled: false,
	}); err != nil {
		t.Fatal(err)
	}
	run := createExecutableWorkflow(t, s, `{"prompt":"x","executionMode":"online","providerId":"disabled-provider"}`)
	completed, err := s.executeWorkflowRun(context.Background(), "test-owner", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if completed.Status != workflow.RunBlockedPolicy || eng.calls.Load() != 0 {
		t.Fatalf("disabled provider was used: status=%s calls=%d", completed.Status, eng.calls.Load())
	}
}

func TestWorkflowAgentConcurrentExecutionClaimsOnce(t *testing.T) {
	s, eng := testAgentServer(t)
	run := createExecutableWorkflow(t, s, `{"prompt":"concurrent"}`)
	results := make(chan workflow.WorkflowRun, 2)
	errs := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() {
			completed, err := s.executeWorkflowRun(context.Background(), "test-owner", run.ID)
			results <- completed
			errs <- err
		}()
	}
	for i := 0; i < 2; i++ {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 2; i++ {
		if completed := <-results; completed.Status != workflow.RunSucceeded {
			t.Fatalf("concurrent result: %+v", completed)
		}
	}
	if eng.calls.Load() != 1 {
		t.Fatalf("concurrent model calls: %d", eng.calls.Load())
	}
}

func TestDuplicateWorkflowExecutionDoesNotInterruptActiveAgent(t *testing.T) {
	s, eng := testAgentServer(t)
	eng.blocked = make(chan struct{})
	eng.started = make(chan struct{}, 1)
	run := createExecutableWorkflow(t, s, `{"prompt":"active"}`)

	firstResult := make(chan struct {
		run workflow.WorkflowRun
		err error
	}, 1)
	go func() {
		completed, err := s.executeWorkflowRun(context.Background(), "test-owner", run.ID)
		firstResult <- struct {
			run workflow.WorkflowRun
			err error
		}{completed, err}
	}()
	select {
	case <-eng.started:
	case <-time.After(5 * time.Second):
		t.Fatal("agent execution did not become active")
	}

	duplicateResult := make(chan struct {
		run workflow.WorkflowRun
		err error
	}, 1)
	go func() {
		duplicate, duplicateErr := s.executeWorkflowRun(context.Background(), "test-owner", run.ID)
		duplicateResult <- struct {
			run workflow.WorkflowRun
			err error
		}{duplicate, duplicateErr}
	}()
	active, err := s.workflows.GetRun("test-owner", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if active.Status != workflow.RunRunning || active.Steps[0].Status != workflow.StepRunning {
		t.Fatalf("active execution was not preserved: %+v", active)
	}
	close(eng.blocked)

	select {
	case result := <-firstResult:
		if result.err != nil || result.run.Status != workflow.RunSucceeded {
			t.Fatalf("original execution: %+v err=%v", result.run, result.err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("original execution did not finish")
	}
	select {
	case result := <-duplicateResult:
		if result.err != nil || result.run.Status != workflow.RunSucceeded {
			t.Fatalf("duplicate execution result: %+v err=%v", result.run, result.err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("duplicate execution did not finish")
	}
}

func TestWorkflowRecoverySkipsActiveInProcessExecution(t *testing.T) {
	s, eng := testAgentServer(t)
	eng.blocked = make(chan struct{})
	eng.started = make(chan struct{}, 1)
	run := createExecutableWorkflow(t, s, `{"prompt":"active recovery"}`)
	result := make(chan struct {
		run workflow.WorkflowRun
		err error
	}, 1)
	go func() {
		completed, err := s.executeWorkflowRun(context.Background(), "test-owner", run.ID)
		result <- struct {
			run workflow.WorkflowRun
			err error
		}{completed, err}
	}()
	select {
	case <-eng.started:
	case <-time.After(5 * time.Second):
		t.Fatal("agent execution did not become active")
	}
	report, err := s.recoverWorkflows()
	if err != nil || report.Reconciled != 0 || report.Skipped == 0 {
		t.Fatalf("active recovery was not skipped: %+v %v", report, err)
	}
	active, err := s.workflows.GetRun("test-owner", run.ID)
	if err != nil || active.Status != workflow.RunRunning {
		t.Fatalf("active workflow was interrupted: %+v %v", active, err)
	}
	close(eng.blocked)
	select {
	case completed := <-result:
		if completed.err != nil || completed.run.Status != workflow.RunSucceeded {
			t.Fatalf("active workflow did not finish: %+v %v", completed.run, completed.err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("active workflow did not finish")
	}
}
