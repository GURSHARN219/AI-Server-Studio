package workflow

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

const (
	StepSucceededEvent     = "step.succeeded"
	StepFailedEvent        = "step.failed"
	StepBlockedPolicyEvent = "step.blocked_policy"
	RunSucceededEvent      = "run.succeeded"
	RunFailedEvent         = "run.failed"
	RunBlockedPolicyEvent  = "run.blocked_policy"
	RunInterruptedEvent    = "run.interrupted"
)

// markDispatchStarted advances the dispatch state after the claim transaction
// has committed and immediately before the injected executor is called. It is
// deliberately private: external callers cannot manufacture workflow events
// or arbitrary dispatch transitions.
func (r *SQLiteRepository) markDispatchStarted(ownerID string, intent DispatchIntent) error {
	if err := validOwner(ownerID); err != nil {
		return err
	}
	result, err := r.db.Exec(`UPDATE workflow_dispatches SET state=?,updated_at=? WHERE dispatch_id=? AND run_id=? AND step_id=? AND agent_run_id=? AND state=?`, DispatchStateStarted, nowMillis(), intent.DispatchID, intent.RunID, intent.StepID, intent.AgentRunID, DispatchStatePrepared)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected != 1 {
		return ErrConflict
	}
	return nil
}

// CompleteStep is the trusted completion boundary used by the orchestrator.
// It accepts only the dispatch's stable agent ID and the revisions observed
// when that dispatch was prepared. Step, dispatch, canonical task state,
// events, and the event cursor are committed as one transaction.
func (r *SQLiteRepository) CompleteStep(ownerID, runID, stepID string, expectedRunRevision, expectedStepRevision uint64, agentRunID string, output json.RawMessage) (WorkflowRun, error) {
	return r.finishStep(ownerID, runID, stepID, expectedRunRevision, expectedStepRevision, agentRunID, output, RunSucceeded, "", "", StepSucceededEvent, RunSucceededEvent)
}

// FailStep records a fixed failure event and terminal workflow failure. The
// variadic form keeps the boundary convenient for callers that have only a
// summary while still accepting the canonical error-code/summary pair.
func (r *SQLiteRepository) FailStep(ownerID, runID, stepID string, expectedRunRevision, expectedStepRevision uint64, agentRunID string, errorDetails ...string) (WorkflowRun, error) {
	errorCode, errorSummary := executionErrorDetails(errorDetails...)
	return r.finishStep(ownerID, runID, stepID, expectedRunRevision, expectedStepRevision, agentRunID, nil, RunFailed, errorCode, errorSummary, StepFailedEvent, RunFailedEvent)
}

// BlockWorkflowByPolicy records a policy denial without allowing the step to
// be retried. blocked_policy is intentionally a distinct workflow status so a
// caller can distinguish policy from execution failure.
func (r *SQLiteRepository) BlockWorkflowByPolicy(ownerID, runID, stepID string, expectedRunRevision, expectedStepRevision uint64, agentRunID string, errorDetails ...string) (WorkflowRun, error) {
	errorCode, errorSummary := executionErrorDetails(errorDetails...)
	if errorCode == "execution_failed" {
		errorCode = "policy_denied"
	}
	return r.finishStep(ownerID, runID, stepID, expectedRunRevision, expectedStepRevision, agentRunID, nil, RunBlockedPolicy, errorCode, errorSummary, StepBlockedPolicyEvent, RunBlockedPolicyEvent)
}

// InterruptStep records an executor interruption as a terminal workflow
// result. It is kept separate from FailStep so callers can preserve the
// distinction in the canonical task status.
func (r *SQLiteRepository) InterruptStep(ownerID, runID, stepID string, expectedRunRevision, expectedStepRevision uint64, agentRunID string, errorDetails ...string) (WorkflowRun, error) {
	errorCode, errorSummary := executionErrorDetails(errorDetails...)
	if errorCode == "execution_failed" {
		errorCode = "execution_interrupted"
	}
	return r.finishStep(ownerID, runID, stepID, expectedRunRevision, expectedStepRevision, agentRunID, nil, RunInterrupted, errorCode, errorSummary, StepFailedEvent, RunInterruptedEvent)
}

func executionErrorDetails(details ...string) (string, string) {
	code, summary := "execution_failed", "workflow step execution failed"
	if len(details) > 0 && strings.TrimSpace(details[0]) != "" {
		code = sanitizeErrorCode(details[0])
	}
	if len(details) > 1 && strings.TrimSpace(details[1]) != "" {
		summary = sanitizeErrorSummary(details[1])
	} else if len(details) == 1 && strings.TrimSpace(details[0]) != "" && !looksLikeCode(details[0]) {
		summary = sanitizeErrorSummary(details[0])
	}
	return code, summary
}

func looksLikeCode(value string) bool {
	for _, r := range value {
		if !(r == '_' || r == '-' || r == '.' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9') {
			return false
		}
	}
	return true
}

func sanitizeErrorCode(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "execution_failed"
	}
	var b strings.Builder
	for _, r := range value {
		if b.Len() >= 128 {
			break
		}
		if r == '_' || r == '-' || r == '.' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' {
			b.WriteRune(r)
		} else {
			b.WriteByte('_')
		}
	}
	if b.Len() == 0 {
		return "execution_failed"
	}
	return b.String()
}

func sanitizeErrorSummary(value string) string {
	value = strings.TrimSpace(value)
	var b strings.Builder
	for _, r := range value {
		if b.Len() >= 2048 {
			break
		}
		if r < 0x20 && r != '\t' {
			b.WriteByte(' ')
		} else {
			b.WriteRune(r)
		}
	}
	if b.Len() == 0 {
		return "workflow step execution failed"
	}
	return b.String()
}

type executionRow struct {
	definitionID  string
	version       uint64
	runStatus     RunStatus
	runRevision   uint64
	input         string
	createdAt     int64
	stepStatus    StepStatus
	stepRevision  uint64
	dispatchID    string
	dispatchState string
	dispatchAgent string
}

func (r *SQLiteRepository) finishStep(ownerID, runID, stepID string, expectedRunRevision, expectedStepRevision uint64, agentRunID string, output json.RawMessage, terminal RunStatus, errorCode, errorSummary, stepEvent, runEvent string) (WorkflowRun, error) {
	if err := validOwner(ownerID); err != nil {
		return WorkflowRun{}, err
	}
	if terminal != RunSucceeded && terminal != RunFailed && terminal != RunBlockedPolicy && terminal != RunInterrupted {
		return WorkflowRun{}, fmt.Errorf("%w: unsupported completion status", ErrValidation)
	}
	if strings.TrimSpace(agentRunID) == "" {
		return WorkflowRun{}, fmt.Errorf("%w: agent run id is required", ErrValidation)
	}
	var outputJSON string
	if terminal == RunSucceeded {
		canonical, err := canonicalJSON(output)
		if err != nil {
			return WorkflowRun{}, fmt.Errorf("%w: output: %v", ErrValidation, err)
		}
		outputJSON = string(canonical)
	}

	tx, err := r.db.Begin()
	if err != nil {
		return WorkflowRun{}, err
	}
	defer tx.Rollback()
	var row executionRow
	err = tx.QueryRow(`SELECT w.definition_id,w.version,t.status,t.revision,w.input_json,w.created_at,
		s.status,s.revision,d.dispatch_id,d.state,d.agent_run_id
		FROM workflow_runs w JOIN task_runs t ON t.id=w.run_id AND t.kind='workflow'
		JOIN workflow_steps s ON s.run_id=w.run_id AND s.step_id=?
		JOIN workflow_dispatches d ON d.run_id=s.run_id AND d.step_id=s.step_id
		WHERE w.owner_id=? AND w.run_id=?`, stepID, ownerID, runID).
		Scan(&row.definitionID, &row.version, &row.runStatus, &row.runRevision, &row.input, &row.createdAt,
			&row.stepStatus, &row.stepRevision, &row.dispatchID, &row.dispatchState, &row.dispatchAgent)
	if errors.Is(err, sql.ErrNoRows) {
		return WorkflowRun{}, ErrNotFound
	}
	if err != nil {
		return WorkflowRun{}, err
	}
	if row.runRevision != expectedRunRevision || row.stepRevision != expectedStepRevision || row.dispatchAgent != agentRunID {
		return WorkflowRun{}, ErrConflict
	}
	if row.runStatus.Terminal() || row.runStatus == RunBlockedPolicy {
		return WorkflowRun{}, ErrTerminal
	}
	if row.runStatus != RunRunning || row.stepStatus != StepRunning {
		return WorkflowRun{}, fmt.Errorf("%w: completion requires a running step", ErrConflict)
	}
	if row.dispatchState != DispatchStatePrepared && row.dispatchState != DispatchStateStarted {
		return WorkflowRun{}, fmt.Errorf("%w: dispatch is not active", ErrConflict)
	}

	now := nowMillis()
	nextStepRevision, nextRunRevision := expectedStepRevision+1, expectedRunRevision+1
	stepOutput := interface{}(nil)
	if outputJSON != "" {
		stepOutput = outputJSON
	}
	stepUpdate, err := tx.Exec(`UPDATE workflow_steps SET status=?,revision=?,output_json=?,error_summary=?,finished_at=? WHERE run_id=? AND step_id=? AND status=? AND revision=?`, stepStatusForTerminal(terminal), nextStepRevision, stepOutput, nullableString(errorSummary), now, runID, stepID, StepRunning, expectedStepRevision)
	if err != nil {
		return WorkflowRun{}, err
	}
	if affected, rowsErr := stepUpdate.RowsAffected(); rowsErr != nil || affected != 1 {
		if rowsErr != nil {
			return WorkflowRun{}, rowsErr
		}
		return WorkflowRun{}, ErrConflict
	}
	dispatchUpdate, err := tx.Exec(`UPDATE workflow_dispatches SET state=?,revision=?,output_json=?,updated_at=? WHERE dispatch_id=? AND state IN (?,?)`, dispatchStateForTerminal(terminal), nextStepRevision, stepOutput, now, row.dispatchID, DispatchStatePrepared, DispatchStateStarted)
	if err != nil {
		return WorkflowRun{}, err
	}
	if affected, rowsErr := dispatchUpdate.RowsAffected(); rowsErr != nil || affected != 1 {
		if rowsErr != nil {
			return WorkflowRun{}, rowsErr
		}
		return WorkflowRun{}, ErrConflict
	}

	allSucceeded := false
	if terminal == RunSucceeded {
		var remaining int
		if err = tx.QueryRow(`SELECT COUNT(*) FROM workflow_steps WHERE run_id=? AND status<>?`, runID, StepSucceeded).Scan(&remaining); err != nil {
			return WorkflowRun{}, err
		}
		allSucceeded = remaining == 0
	}
	nextRunStatus := RunRunning
	if allSucceeded || terminal != RunSucceeded {
		nextRunStatus = terminal
	}
	state, err := json.Marshal(map[string]interface{}{"definitionId": row.definitionID, "version": row.version, "status": nextRunStatus, "revision": nextRunRevision})
	if err != nil {
		return WorkflowRun{}, err
	}
	finished := interface{}(nil)
	if nextRunStatus.Terminal() || nextRunStatus == RunBlockedPolicy {
		finished = now
	}
	if _, err = tx.Exec(`UPDATE task_runs SET status=?,revision=?,state_json=?,updated_at=?,finished_at=?,error_code=?,error_summary=? WHERE id=? AND owner_id=? AND kind='workflow' AND revision=?`, nextRunStatus, nextRunRevision, string(state), now, finished, nullableString(errorCode), nullableString(errorSummary), runID, ownerID, expectedRunRevision); err != nil {
		return WorkflowRun{}, err
	}
	if _, err = tx.Exec(`UPDATE workflow_runs SET updated_at=? WHERE run_id=? AND owner_id=?`, now, runID, ownerID); err != nil {
		return WorkflowRun{}, err
	}
	if err = updateAgentProjection(tx, ownerID, agentRunID, terminal, now, row.dispatchID); err != nil {
		return WorkflowRun{}, err
	}
	if err = appendWorkflowEvent(tx, runID, stepEvent, now, map[string]interface{}{"stepId": stepID, "agentRunId": agentRunID, "dispatchId": row.dispatchID, "revision": nextStepRevision}); err != nil {
		return WorkflowRun{}, err
	}
	if allSucceeded || terminal != RunSucceeded {
		if err = appendWorkflowEvent(tx, runID, runEvent, now, map[string]interface{}{"revision": nextRunRevision}); err != nil {
			return WorkflowRun{}, err
		}
	}
	if err = tx.Commit(); err != nil {
		return WorkflowRun{}, err
	}
	return r.GetRun(ownerID, runID)
}

func stepStatusForTerminal(status RunStatus) StepStatus {
	if status == RunSucceeded {
		return StepSucceeded
	}
	return StepFailed
}

func dispatchStateForTerminal(status RunStatus) string {
	if status == RunSucceeded {
		return DispatchStateSucceeded
	}
	return DispatchStateFailed
}

func updateAgentProjection(tx *sql.Tx, ownerID, agentRunID string, status RunStatus, now int64, dispatchID string) error {
	agentStatus, projectionStatus := "failed", "error"
	if status == RunSucceeded {
		agentStatus, projectionStatus = "succeeded", "done"
	}
	var revision uint64
	var err error
	if err = tx.QueryRow(`SELECT revision FROM task_runs WHERE id=? AND owner_id=? AND kind='agent'`, agentRunID, ownerID).Scan(&revision); err != nil {
		return err
	}
	if _, err = tx.Exec(`UPDATE task_runs SET status=?,revision=?,state_json=json_set(state_json,'$.status',?,'$.revision',?,'$.updatedAt',?,'$.completedAt',?),updated_at=?,finished_at=? WHERE id=? AND owner_id=? AND kind='agent' AND revision=?`, agentStatus, revision+1, projectionStatus, revision+1, now, now, now, now, agentRunID, ownerID, revision); err != nil {
		return err
	}
	// Preserve the full agent document written by the execution adapter. The
	// projection still advances its status/revision, but must not replace the
	// goal, result, events, or checkpoint with a compact workflow-only object.
	_, err = tx.Exec(`UPDATE agent_runs SET status=?,revision=revision+1,state_json=json_set(state_json,'$.status',?,'$.revision',revision+1,'$.updatedAt',?,'$.completedAt',?),updated_at=? WHERE id=? AND owner_id=?`, projectionStatus, projectionStatus, now, now, now, agentRunID, ownerID)
	return err
}
