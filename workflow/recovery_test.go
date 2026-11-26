package workflow

import (
	"database/sql"
	"encoding/json"
	"testing"

	"ai-server-studio-backend/agentrun"
)

func seedTerminalAgent(t *testing.T, db *sql.DB, intent DispatchIntent, status agentrun.Status, reason, result string) {
	t.Helper()
	state := agentrun.Run{ID: intent.AgentRunID, OwnerID: intent.OwnerID, Status: status, Revision: 2, Error: reason, Result: result, CreatedAt: 1, UpdatedAt: 2, CompletedAt: 2}
	raw, err := json.Marshal(state)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE task_runs SET status=?,revision=2,state_json=?,finished_at=2 WHERE id=?`, canonicalAgentStatus(status), string(raw), intent.AgentRunID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE agent_runs SET status=?,revision=2,state_json=?,updated_at=2 WHERE id=?`, status, string(raw), intent.AgentRunID); err != nil {
		t.Fatal(err)
	}
}

func recoverySingleRun(t *testing.T, repo *SQLiteRepository, id string) {
	t.Helper()
	definition := b2Definition(t, repo, WorkflowGraph{Steps: []Step{{ID: "only", StepType: StepTypeAgentPromptV1, Input: []byte(`{"prompt":"recover"}`)}}}, id+"-definition")
	if _, err := repo.CreateRun("owner-a", CreateRunRequest{ID: id, DefinitionID: definition.ID}); err != nil {
		t.Fatal(err)
	}
}

func TestRecoverySuccessfulAgentResultReconcilesWithoutAgentRewrite(t *testing.T) {
	repo, db := workflowFixture(t)
	recoverySingleRun(t, repo, "recover-success")
	intent, err := repo.ClaimAndPrepareDispatchIntent("owner-a", DispatchIntentRequest{RunID: "recover-success", StepID: "only", ExpectedWorkflowRevision: 1, ExpectedStepRevision: 1, Input: []byte(`{"prompt":"recover"}`)})
	if err != nil {
		t.Fatal(err)
	}
	seedTerminalAgent(t, db, intent, agentrun.StatusDone, "", "durable answer")
	service := NewRecoveryService(repo)
	scan, err := service.Scan()
	if err != nil || len(scan.Issues) != 1 || scan.Issues[0].Classification != RecoverySuccessfulAgentResult {
		t.Fatalf("scan: %+v %v", scan, err)
	}
	report, err := service.Recover()
	if err != nil || report.Reconciled != 1 {
		t.Fatalf("recover: %+v %v", report, err)
	}
	run, err := repo.GetRun("owner-a", "recover-success")
	if err != nil || run.Status != RunSucceeded || string(run.Steps[0].Output) != `"durable answer"` {
		t.Fatalf("workflow result: %+v %v", run, err)
	}
	var agentStatus string
	if err = db.QueryRow(`SELECT status FROM agent_runs WHERE id=?`, intent.AgentRunID).Scan(&agentStatus); err != nil {
		t.Fatal(err)
	}
	if agentStatus != "done" {
		t.Fatalf("agent history was rewritten: %s", agentStatus)
	}
	before, err := repo.ListEvents("owner-a", "recover-success", 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	repeat, err := service.Recover()
	if err != nil || repeat.Reconciled != 0 {
		t.Fatalf("repeat recovery: %+v %v", repeat, err)
	}
	after, err := repo.ListEvents("owner-a", "recover-success", 0, 100)
	if err != nil || len(after) != len(before) {
		t.Fatalf("repeat changed events: %d/%d %v", len(after), len(before), err)
	}
}

func TestRecoveryPreservesCompletedStepWhenDownstreamIsQueued(t *testing.T) {
	repo, _ := workflowFixture(t)
	definition := b2Definition(t, repo, WorkflowGraph{Steps: []Step{
		{ID: "a", StepType: StepTypeAgentPromptV1, Input: []byte(`{"prompt":"a"}`)},
		{ID: "b", StepType: StepTypeAgentPromptV1, Dependencies: []string{"a"}, Input: []byte(`{"prompt":"b"}`)},
	}}, "recover-partial-definition")
	run, err := repo.CreateRun("owner-a", CreateRunRequest{ID: "recover-partial", DefinitionID: definition.ID})
	if err != nil {
		t.Fatal(err)
	}
	intent, err := repo.ClaimAndPrepareDispatchIntent("owner-a", DispatchIntentRequest{
		RunID: run.ID, StepID: "a", ExpectedWorkflowRevision: 1, ExpectedStepRevision: 1,
		Input: []byte(`{"prompt":"a"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = repo.CompleteStep("owner-a", run.ID, "a", 2, 2, intent.AgentRunID, []byte(`{"answer":"a"}`)); err != nil {
		t.Fatal(err)
	}
	before, err := repo.GetRun("owner-a", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	eventsBefore, err := repo.ListEvents("owner-a", run.ID, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	report, err := NewRecoveryService(repo).Recover()
	if err != nil || report.Reconciled != 0 || report.Counts[RecoveryQueuedNoDispatch] != 1 {
		t.Fatalf("partial recovery: %+v %v", report, err)
	}
	after, err := repo.GetRun("owner-a", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	eventsAfter, err := repo.ListEvents("owner-a", run.ID, 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	if after.Status != RunRunning || after.Steps[0].Status != StepSucceeded || after.Steps[0].Revision != before.Steps[0].Revision || string(after.Steps[0].Output) != string(before.Steps[0].Output) || len(eventsAfter) != len(eventsBefore) {
		t.Fatalf("completed step was rewritten: before=%+v after=%+v events=%d/%d", before, after, len(eventsBefore), len(eventsAfter))
	}
}

func TestRecoveryTerminalAgentClassifications(t *testing.T) {
	tests := []struct {
		name           string
		status         agentrun.Status
		reason         string
		classification string
		workflowStatus RunStatus
	}{
		{"failure", agentrun.StatusError, "provider failed", RecoveryNormalFailedAgent, RunFailed},
		{"restart", agentrun.StatusError, RestartFailureReason, RecoveryRestartFailedAgent, RunInterrupted},
		{"cancelled", agentrun.StatusCanceled, "", RecoveryCancelledAgent, RunInterrupted},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			repo, db := workflowFixture(t)
			recoverySingleRun(t, repo, "recover-"+tc.name)
			intent, err := repo.ClaimAndPrepareDispatchIntent("owner-a", DispatchIntentRequest{RunID: "recover-" + tc.name, StepID: "only", ExpectedWorkflowRevision: 1, ExpectedStepRevision: 1, Input: []byte(`{"prompt":"recover"}`)})
			if err != nil {
				t.Fatal(err)
			}
			seedTerminalAgent(t, db, intent, tc.status, tc.reason, "")
			service := NewRecoveryService(repo)
			scan, err := service.Scan()
			if err != nil || len(scan.Issues) != 1 || scan.Issues[0].Classification != tc.classification {
				t.Fatalf("classification: %+v %v", scan, err)
			}
			if _, err = service.Recover(); err != nil {
				t.Fatal(err)
			}
			run, err := repo.GetRun("owner-a", "recover-"+tc.name)
			if err != nil || run.Status != tc.workflowStatus || run.Steps[0].Status != StepFailed {
				t.Fatalf("terminal mapping: %+v %v", run, err)
			}
		})
	}
}

func TestRecoveryConcurrentPassesReconcileOnceAndActiveGuardSkips(t *testing.T) {
	repo, db := workflowFixture(t)
	recoverySingleRun(t, repo, "recover-concurrent")
	intent, err := repo.ClaimAndPrepareDispatchIntent("owner-a", DispatchIntentRequest{RunID: "recover-concurrent", StepID: "only", ExpectedWorkflowRevision: 1, ExpectedStepRevision: 1, Input: []byte(`{"prompt":"recover"}`)})
	if err != nil {
		t.Fatal(err)
	}
	seedTerminalAgent(t, db, intent, agentrun.StatusDone, "", "answer")
	service := NewRecoveryService(repo)
	blocked, err := service.RecoverWithGuard(func(string) bool { return true })
	if err != nil || blocked.Skipped != 1 || blocked.Reconciled != 0 {
		t.Fatalf("active guard: %+v %v", blocked, err)
	}
	if _, err = repo.GetRun("owner-a", "recover-concurrent"); err != nil {
		t.Fatal(err)
	}
	results := make(chan RecoveryReport, 2)
	for i := 0; i < 2; i++ {
		go func() {
			report, _ := service.Recover()
			results <- report
		}()
	}
	first, second := <-results, <-results
	if first.Reconciled+second.Reconciled != 1 {
		t.Fatalf("concurrent reconciliation count: %d/%d", first.Reconciled, second.Reconciled)
	}
	events, err := repo.ListEvents("owner-a", "recover-concurrent", 0, 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 6 {
		t.Fatalf("duplicate recovery events: %d", len(events))
	}
}

func TestRecoveryQueuedAndAmbiguousStatesFailClosed(t *testing.T) {
	repo, db := workflowFixture(t)
	definition := b2Definition(t, repo, WorkflowGraph{Steps: []Step{{ID: "only", StepType: StepTypeAgentPromptV1, Input: []byte(`{"prompt":"recover"}`)}}}, "recover-states-definition")
	queued, err := repo.CreateRun("owner-a", CreateRunRequest{ID: "recover-queued", DefinitionID: definition.ID})
	if err != nil {
		t.Fatal(err)
	}
	service := NewRecoveryService(repo)
	report, err := service.Recover()
	if err != nil || report.Reconciled != 0 || report.Counts[RecoveryQueuedNoDispatch] != 1 {
		t.Fatalf("queued recovery: %+v %v", report, err)
	}
	if _, err = repo.ClaimAndPrepareDispatchIntent("owner-a", DispatchIntentRequest{RunID: queued.ID, StepID: "only", ExpectedWorkflowRevision: 1, ExpectedStepRevision: 1, Input: []byte(`{"prompt":"recover"}`)}); err != nil {
		t.Fatal(err)
	}
	report, err = service.Recover()
	if err != nil || report.Reconciled != 1 || report.Counts[RecoveryPreparedQueuedAgent] != 1 {
		t.Fatalf("prepared recovery: %+v %v", report, err)
	}
	run, err := repo.GetRun("owner-a", queued.ID)
	if err != nil || run.Status != RunInterrupted {
		t.Fatalf("prepared run was not interrupted: %+v %v", run, err)
	}
	var taskStatus string
	if err = db.QueryRow(`SELECT status FROM task_runs WHERE id=?`, queued.ID).Scan(&taskStatus); err != nil || taskStatus != string(RunInterrupted) {
		t.Fatalf("canonical workflow status: %s %v", taskStatus, err)
	}
}

func TestRecoveryPreparedMissingAgentLinkageInterruptsWithoutReplacement(t *testing.T) {
	repo, db := workflowFixture(t)
	recoverySingleRun(t, repo, "recover-missing-agent")
	intent, err := repo.ClaimAndPrepareDispatchIntent("owner-a", DispatchIntentRequest{
		RunID: "recover-missing-agent", StepID: "only", ExpectedWorkflowRevision: 1, ExpectedStepRevision: 1,
		Input: []byte(`{"prompt":"recover"}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`PRAGMA foreign_keys=OFF`); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE workflow_dispatches SET agent_run_id='missing-agent' WHERE dispatch_id=?`, intent.DispatchID); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`PRAGMA foreign_keys=ON`); err != nil {
		t.Fatal(err)
	}
	report, err := NewRecoveryService(repo).Recover()
	if err != nil || report.Reconciled != 1 || report.Counts[RecoveryPreparedMissingLinkage] != 1 {
		t.Fatalf("missing linkage recovery: %+v %v", report, err)
	}
	run, err := repo.GetRun("owner-a", "recover-missing-agent")
	if err != nil || run.Status != RunInterrupted || run.Steps[0].Status != StepFailed {
		t.Fatalf("missing linkage was not interrupted: %+v %v", run, err)
	}
	var dispatchAgent string
	if err = db.QueryRow(`SELECT agent_run_id FROM workflow_dispatches WHERE dispatch_id=?`, intent.DispatchID).Scan(&dispatchAgent); err != nil {
		t.Fatal(err)
	}
	if dispatchAgent != "missing-agent" {
		t.Fatalf("recovery replaced stable agent ID: %s", dispatchAgent)
	}
}

func TestRecoveryOrphanRunningStepAndRollback(t *testing.T) {
	repo, db := workflowFixture(t)
	definition := b2Definition(t, repo, WorkflowGraph{Steps: []Step{{ID: "only", StepType: StepTypeAgentPromptV1, Input: []byte(`{"prompt":"recover"}`)}}}, "recover-orphan-definition")
	if _, err := repo.CreateRun("owner-a", CreateRunRequest{ID: "recover-orphan", DefinitionID: definition.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.ClaimStep("owner-a", ClaimStepRequest{RunID: "recover-orphan", StepID: "only", ExpectedWorkflowRevision: 1, ExpectedStepRevision: 1}); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TRIGGER reject_recovery BEFORE INSERT ON workflow_events WHEN NEW.event_type='step.failed' BEGIN SELECT RAISE(ABORT,'rollback'); END`); err != nil {
		t.Fatal(err)
	}
	report, err := NewRecoveryService(repo).Recover()
	if err != nil || report.Failed != 1 || report.Issues[0].Classification != RecoveryReconciliationFailed {
		t.Fatalf("rollback report: %+v %v", report, err)
	}
	run, err := repo.GetRun("owner-a", "recover-orphan")
	if err != nil || run.Status != RunRunning || run.Steps[0].Status != StepRunning {
		t.Fatalf("rollback changed workflow: %+v %v", run, err)
	}
	if _, err = db.Exec(`DROP TRIGGER reject_recovery`); err != nil {
		t.Fatal(err)
	}
	report, err = NewRecoveryService(repo).Recover()
	if err != nil || report.Reconciled != 1 {
		t.Fatalf("orphan recovery: %+v %v", report, err)
	}
	run, err = repo.GetRun("owner-a", "recover-orphan")
	if err != nil || run.Status != RunInterrupted || run.Steps[0].Status != StepFailed {
		t.Fatalf("orphan was not interrupted: %+v %v", run, err)
	}
}
