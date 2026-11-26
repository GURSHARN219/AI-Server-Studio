package workflow

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"

	"ai-server-studio-backend/agentrun"
)

// Recovery classifications are intentionally stable. They are safe reason
// codes for logs and diagnostics; they never contain prompts, provider data,
// or agent output.
const (
	RecoveryQueuedNoDispatch          = "queued_no_dispatch"
	RecoveryPreparedMissingLinkage    = "prepared_missing_agent_linkage"
	RecoveryPreparedQueuedAgent       = "prepared_queued_agent"
	RecoveryStartedQueuedAgent        = "started_queued_agent"
	RecoveryStartedActiveAgent        = "started_active_agent"
	RecoverySuccessfulAgentResult     = "successful_agent_result"
	RecoveryNormalFailedAgent         = "normal_failed_agent"
	RecoveryRestartFailedAgent        = "restart_failed_agent"
	RecoveryCancelledAgent            = "cancelled_agent"
	RecoveryMissingLinkage            = "missing_linkage"
	RecoveryConflictingLinkage        = "conflicting_linkage"
	RecoveryInconsistentState         = "inconsistent_state"
	RecoveryAllStepsSucceededFinalize = "all_steps_succeeded_finalize"
	RecoveryTerminalNoop              = "terminal_noop"
	RecoveryReconciliationFailed      = "reconciliation_failed"
)

const restartFailureReason = "Server restarted before run completed"

// RestartFailureReason is the exact durable agent-store reason recognized by
// recovery after process restart.
const RestartFailureReason = restartFailureReason

// RecoveryIssue is a deterministic, safe description of one workflow/step
// observed by recovery. IDs are the only row identifiers exposed here.
type RecoveryIssue struct {
	RunID          string `json:"runId"`
	OwnerID        string `json:"ownerId"`
	StepID         string `json:"stepId,omitempty"`
	DispatchID     string `json:"dispatchId,omitempty"`
	AgentRunID     string `json:"agentRunId,omitempty"`
	Classification string `json:"classification"`
	ReasonCode     string `json:"reasonCode"`
	Reconciled     bool   `json:"reconciled"`
	Skipped        bool   `json:"skipped,omitempty"`
	Error          string `json:"error,omitempty"`
}

// RecoveryReport is the result of a deterministic scan/reconciliation pass.
// Issues are sorted by run, step, and classification.
type RecoveryReport struct {
	Issues     []RecoveryIssue `json:"issues"`
	Counts     map[string]int  `json:"counts"`
	Reconciled int             `json:"reconciled"`
	Skipped    int             `json:"skipped"`
	Failed     int             `json:"failed"`
}

// RecoveryService classifies and reconciles durable workflow state. It never
// calls an agent, model, provider, or tool service.
type RecoveryService struct {
	repo *SQLiteRepository
	mu   sync.Mutex
}

func NewRecoveryService(repo *SQLiteRepository) *RecoveryService {
	return &RecoveryService{repo: repo}
}

// Scan performs a read-only snapshot of nonterminal workflow state.
func (s *RecoveryService) Scan() (RecoveryReport, error) {
	return s.scan(nil)
}

// ScanNonTerminal is an explicit alias for callers that want to document the
// scope of the read-only pass.
func (s *RecoveryService) ScanNonTerminal() (RecoveryReport, error) { return s.Scan() }

// Recover performs a complete recovery pass. A storage/scan error is returned;
// an individual record error is retained in the report and does not stop other
// records from being reconciled.
func (s *RecoveryService) Recover() (RecoveryReport, error) {
	return s.RecoverWithGuard(nil)
}

// RecoverWithGuard is used by the server to skip workflow runs currently being
// executed in-process. The callback is consulted before each durable record.
func (s *RecoveryService) RecoverWithGuard(active func(string) bool) (RecoveryReport, error) {
	if s == nil {
		return RecoveryReport{}, errors.New("workflow recovery service unavailable")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	report, err := s.scan(active)
	if err != nil {
		return report, err
	}
	for i := range report.Issues {
		issue := &report.Issues[i]
		if issue.Skipped || issue.Classification == RecoveryQueuedNoDispatch {
			continue
		}
		if active != nil && active(issue.RunID) {
			issue.Skipped = true
			report.Skipped++
			continue
		}
		changed, reconcileErr := s.reconcileIssue(*issue)
		if reconcileErr != nil {
			report.Counts[issue.Classification]--
			issue.Classification = RecoveryReconciliationFailed
			issue.ReasonCode = RecoveryReconciliationFailed
			issue.Error = "durable reconciliation failed"
			report.Counts[RecoveryReconciliationFailed]++
			report.Failed++
			continue
		}
		if changed {
			issue.Reconciled = true
			report.Reconciled++
		}
	}
	return report, nil
}

// Reconcile is a descriptive alias for Recover.
func (s *RecoveryService) Reconcile() (RecoveryReport, error) { return s.Recover() }

// ReconcileNonTerminal is an explicit alias for Recover.
func (s *RecoveryService) ReconcileNonTerminal() (RecoveryReport, error) { return s.Recover() }

type recoveryCandidate struct {
	runID, ownerID, definitionID string
	runStatus                    RunStatus
	runRevision, version         uint64
	stepID                       string
	stepStatus                   StepStatus
	stepRevision, stepAttempt    uint64
	dispatchID, agentRunID       string
	dispatchState                string
	dispatchRevision             uint64
	taskOwner, taskStatus        string
	taskRevision                 uint64
	taskState                    string
	agentOwner, agentStatus      string
	agentRevision                uint64
	agentState                   string
	hasDispatch, hasTask         bool
	hasAgent                     bool
}

func (s *RecoveryService) scan(active func(string) bool) (RecoveryReport, error) {
	report := RecoveryReport{Issues: make([]RecoveryIssue, 0), Counts: make(map[string]int)}
	if s == nil || s.repo == nil || s.repo.db == nil {
		return report, errors.New("workflow recovery repository unavailable")
	}
	tx, err := s.repo.db.Begin()
	if err != nil {
		return report, err
	}
	defer tx.Rollback()
	rows, err := tx.Query(`SELECT w.run_id,w.owner_id,w.definition_id,w.version,t.status,t.revision,
		s.step_id,s.status,s.revision,s.attempt,
		d.dispatch_id,d.agent_run_id,d.state,d.revision,
		at.owner_id,at.status,at.revision,at.state_json,
		a.owner_id,a.status,a.revision,a.state_json
		FROM workflow_runs w
		JOIN task_runs t ON t.id=w.run_id AND t.kind='workflow'
		JOIN workflow_steps s ON s.run_id=w.run_id
		LEFT JOIN workflow_dispatches d ON d.run_id=s.run_id AND d.step_id=s.step_id
		LEFT JOIN task_runs at ON at.id=d.agent_run_id AND at.kind='agent'
		LEFT JOIN agent_runs a ON a.id=d.agent_run_id
		WHERE t.status NOT IN ('succeeded','failed','cancelled','interrupted')
		ORDER BY w.run_id,s.step_id`)
	if err != nil {
		return report, err
	}
	defer rows.Close()
	seenFinalize := make(map[string]bool)
	candidates := make([]recoveryCandidate, 0)
	for rows.Next() {
		candidate, scanErr := scanRecoveryCandidate(rows)
		if scanErr != nil {
			return report, scanErr
		}
		candidates = append(candidates, candidate)
	}
	if err = rows.Err(); err != nil {
		return report, err
	}
	for _, candidate := range candidates {
		issue := classifyRecoveryCandidate(candidate)
		if allStepsSucceeded(candidates, candidate.runID) && allStepsCanFinalize(candidates, candidate.runID) {
			if seenFinalize[candidate.runID] {
				continue
			}
			issue = baseIssue(candidate, RecoveryAllStepsSucceededFinalize)
			seenFinalize[candidate.runID] = true
		}
		if issue.Classification == RecoveryTerminalNoop {
			continue
		}
		if active != nil && active(candidate.runID) {
			issue.Skipped = true
		}
		report.Issues = append(report.Issues, issue)
		report.Counts[issue.Classification]++
	}
	if err = tx.Commit(); err != nil {
		return report, err
	}
	sort.Slice(report.Issues, func(i, j int) bool {
		left, right := report.Issues[i], report.Issues[j]
		if left.RunID != right.RunID {
			return left.RunID < right.RunID
		}
		if left.StepID != right.StepID {
			return left.StepID < right.StepID
		}
		return left.Classification < right.Classification
	})
	for i := range report.Issues {
		if report.Issues[i].Skipped {
			report.Skipped++
		}
	}
	return report, nil
}

func allStepsSucceeded(candidates []recoveryCandidate, runID string) bool {
	count := 0
	for _, candidate := range candidates {
		if candidate.runID != runID {
			continue
		}
		count++
		if candidate.stepStatus != StepSucceeded {
			return false
		}
	}
	return count > 0
}

func allStepsCanFinalize(candidates []recoveryCandidate, runID string) bool {
	for _, candidate := range candidates {
		if candidate.runID != runID || !candidate.hasDispatch {
			continue
		}
		classification := classifyRecoveryCandidate(candidate).Classification
		if classification != RecoverySuccessfulAgentResult && classification != RecoveryTerminalNoop {
			return false
		}
	}
	return true
}

func scanRecoveryCandidate(row *sql.Rows) (recoveryCandidate, error) {
	var c recoveryCandidate
	var taskOwner, taskStatus, taskState, agentOwner, agentStatus, agentState sql.NullString
	var taskRevision, agentRevision sql.NullInt64
	var dispatchID, agentRunID, dispatchState sql.NullString
	var dispatchRevision sql.NullInt64
	if err := row.Scan(&c.runID, &c.ownerID, &c.definitionID, &c.version, &c.runStatus, &c.runRevision,
		&c.stepID, &c.stepStatus, &c.stepRevision, &c.stepAttempt,
		&dispatchID, &agentRunID, &dispatchState, &dispatchRevision,
		&taskOwner, &taskStatus, &taskRevision, &taskState,
		&agentOwner, &agentStatus, &agentRevision, &agentState); err != nil {
		return c, err
	}
	if dispatchID.Valid {
		c.hasDispatch, c.dispatchID = true, dispatchID.String
		c.agentRunID, c.dispatchState, c.dispatchRevision = agentRunID.String, dispatchState.String, uint64(dispatchRevision.Int64)
	}
	if taskOwner.Valid {
		c.hasTask, c.taskOwner, c.taskStatus, c.taskRevision, c.taskState = true, taskOwner.String, taskStatus.String, uint64(taskRevision.Int64), taskState.String
	}
	if agentOwner.Valid {
		c.hasAgent, c.agentOwner, c.agentStatus, c.agentRevision, c.agentState = true, agentOwner.String, agentStatus.String, uint64(agentRevision.Int64), agentState.String
	}
	return c, nil
}

func baseIssue(c recoveryCandidate, classification string) RecoveryIssue {
	return RecoveryIssue{RunID: c.runID, OwnerID: c.ownerID, StepID: c.stepID, DispatchID: c.dispatchID, AgentRunID: c.agentRunID, Classification: classification, ReasonCode: classification}
}

func classifyRecoveryCandidate(c recoveryCandidate) RecoveryIssue {
	if !c.hasDispatch {
		if c.stepStatus == StepQueued {
			return baseIssue(c, RecoveryQueuedNoDispatch)
		}
		return baseIssue(c, RecoveryInconsistentState)
	}
	if !c.runStatus.Valid() || !validStepStatus(c.stepStatus) {
		return baseIssue(c, RecoveryInconsistentState)
	}
	if c.runStatus != RunRunning || (c.stepStatus != StepRunning && c.stepStatus != StepSucceeded) {
		return baseIssue(c, RecoveryInconsistentState)
	}
	if c.stepStatus == StepSucceeded && c.dispatchState == DispatchStateSucceeded {
		return baseIssue(c, RecoveryTerminalNoop)
	}
	if c.dispatchState != DispatchStatePrepared && c.dispatchState != DispatchStateStarted && c.dispatchState != DispatchStateSucceeded && c.dispatchState != DispatchStateFailed && c.dispatchState != DispatchStateCancelled {
		return baseIssue(c, RecoveryInconsistentState)
	}
	if strings.TrimSpace(c.agentRunID) == "" || !c.hasTask || !c.hasAgent {
		if c.dispatchState == DispatchStatePrepared {
			return baseIssue(c, RecoveryPreparedMissingLinkage)
		}
		return baseIssue(c, RecoveryMissingLinkage)
	}
	if c.taskOwner != c.ownerID || c.agentOwner != c.ownerID || c.taskRevision != c.agentRevision || c.dispatchRevision != c.stepRevision {
		return baseIssue(c, RecoveryConflictingLinkage)
	}
	var agentState agentrun.Run
	if err := json.Unmarshal([]byte(c.agentState), &agentState); err != nil || agentState.ID != c.agentRunID || agentState.OwnerID != c.ownerID {
		return baseIssue(c, RecoveryConflictingLinkage)
	}
	if string(agentState.Status) != c.agentStatus || !agentState.Status.Valid() {
		return baseIssue(c, RecoveryInconsistentState)
	}
	if c.taskStatus != canonicalAgentStatus(agentState.Status) {
		return baseIssue(c, RecoveryInconsistentState)
	}
	var taskState agentrun.Run
	if err := json.Unmarshal([]byte(c.taskState), &taskState); err != nil || taskState.ID != c.agentRunID || taskState.OwnerID != c.ownerID || taskState.Revision != c.taskRevision || taskState.Status != agentState.Status {
		return baseIssue(c, RecoveryInconsistentState)
	}
	switch agentState.Status {
	case agentrun.StatusQueued:
		if c.dispatchState == DispatchStateStarted {
			return baseIssue(c, RecoveryStartedQueuedAgent)
		}
		return baseIssue(c, RecoveryPreparedQueuedAgent)
	case agentrun.StatusRunning, agentrun.StatusAwaitingApproval:
		return baseIssue(c, RecoveryStartedActiveAgent)
	case agentrun.StatusDone:
		if c.dispatchState != DispatchStatePrepared && c.dispatchState != DispatchStateStarted && c.dispatchState != DispatchStateSucceeded {
			return baseIssue(c, RecoveryInconsistentState)
		}
		if _, err := json.Marshal(agentState.Result); err != nil {
			return baseIssue(c, RecoveryInconsistentState)
		}
		return baseIssue(c, RecoverySuccessfulAgentResult)
	case agentrun.StatusCanceled:
		if c.dispatchState != DispatchStatePrepared && c.dispatchState != DispatchStateStarted && c.dispatchState != DispatchStateCancelled && c.dispatchState != DispatchStateFailed {
			return baseIssue(c, RecoveryInconsistentState)
		}
		return baseIssue(c, RecoveryCancelledAgent)
	case agentrun.StatusError:
		if c.dispatchState != DispatchStatePrepared && c.dispatchState != DispatchStateStarted && c.dispatchState != DispatchStateFailed {
			return baseIssue(c, RecoveryInconsistentState)
		}
		if agentState.Error == restartFailureReason {
			return baseIssue(c, RecoveryRestartFailedAgent)
		}
		return baseIssue(c, RecoveryNormalFailedAgent)
	default:
		return baseIssue(c, RecoveryInconsistentState)
	}
}

func validStepStatus(status StepStatus) bool {
	switch status {
	case StepQueued, StepRunning, StepWaiting, StepSucceeded, StepFailed, StepCancelled, StepSkipped:
		return true
	default:
		return false
	}
}

func canonicalAgentStatus(status agentrun.Status) string {
	switch status {
	case agentrun.StatusDone:
		return "succeeded"
	case agentrun.StatusError:
		return "failed"
	case agentrun.StatusCanceled:
		return "cancelled"
	case agentrun.StatusAwaitingApproval:
		return "waiting_approval"
	default:
		return string(status)
	}
}

func (s *RecoveryService) reconcileIssue(issue RecoveryIssue) (bool, error) {
	tx, err := s.repo.db.Begin()
	if err != nil {
		return false, err
	}
	defer tx.Rollback()
	candidate, err := loadRecoveryCandidateTx(tx, issue.OwnerID, issue.RunID, issue.StepID)
	if errors.Is(err, sql.ErrNoRows) {
		return false, tx.Commit()
	}
	if err != nil {
		return false, err
	}
	if candidate.runStatus.Terminal() || candidate.runStatus == RunBlockedPolicy {
		return false, tx.Commit()
	}
	if issue.Classification == RecoveryAllStepsSucceededFinalize {
		changed, err := finalizeRunTx(tx, candidate)
		if err != nil {
			return false, err
		}
		if err = tx.Commit(); err != nil {
			return false, err
		}
		return changed, nil
	}
	current := classifyRecoveryCandidate(candidate)
	if current.Classification == RecoveryQueuedNoDispatch {
		return false, tx.Commit()
	}
	if current.Classification == RecoveryInconsistentState || current.Classification == RecoveryConflictingLinkage || current.Classification == RecoveryMissingLinkage || current.Classification == RecoveryPreparedMissingLinkage || current.Classification == RecoveryPreparedQueuedAgent || current.Classification == RecoveryStartedQueuedAgent || current.Classification == RecoveryStartedActiveAgent {
		if !candidate.hasDispatch {
			changed, err := reconcileOrphanStepTx(tx, candidate)
			if err != nil {
				return false, err
			}
			if err = tx.Commit(); err != nil {
				return false, err
			}
			return changed, nil
		}
		changed, err := reconcileTerminalTx(tx, candidate, RunInterrupted, "execution_interrupted", recoverySummaryFor(current.Classification), terminalReconcileOptions{})
		if err != nil {
			return false, err
		}
		if err = tx.Commit(); err != nil {
			return false, err
		}
		return changed, nil
	}
	switch current.Classification {
	case RecoverySuccessfulAgentResult:
		changed, err := reconcileSuccessTx(tx, candidate)
		if err != nil {
			return false, err
		}
		if err = tx.Commit(); err != nil {
			return false, err
		}
		return changed, nil
	case RecoveryRestartFailedAgent:
		changed, err := reconcileTerminalTx(tx, candidate, RunInterrupted, "execution_interrupted", "server restarted before run completed", terminalReconcileOptions{})
		if err != nil {
			return false, err
		}
		if err = tx.Commit(); err != nil {
			return false, err
		}
		return changed, nil
	case RecoveryCancelledAgent:
		changed, err := reconcileTerminalTx(tx, candidate, RunInterrupted, "agent_cancelled", "agent execution was cancelled", terminalReconcileOptions{cancelled: true})
		if err != nil {
			return false, err
		}
		if err = tx.Commit(); err != nil {
			return false, err
		}
		return changed, nil
	case RecoveryNormalFailedAgent:
		changed, err := reconcileTerminalTx(tx, candidate, RunFailed, "agent_execution_failed", "agent execution failed", terminalReconcileOptions{})
		if err != nil {
			return false, err
		}
		if err = tx.Commit(); err != nil {
			return false, err
		}
		return changed, nil
	default:
		return false, tx.Commit()
	}
}

func reconcileOrphanStepTx(tx *sql.Tx, c recoveryCandidate) (bool, error) {
	if c.stepStatus == StepQueued {
		return false, nil
	}
	now := nowMillis()
	nextStepRevision := c.stepRevision
	var result sql.Result
	var err error
	if c.stepStatus != StepSucceeded {
		nextStepRevision++
		result, err = tx.Exec(`UPDATE workflow_steps SET status=?,revision=?,error_summary=?,finished_at=? WHERE run_id=? AND step_id=? AND status=? AND revision=?`, StepFailed, nextStepRevision, "workflow step had no durable dispatch", now, c.runID, c.stepID, c.stepStatus, c.stepRevision)
		if err != nil {
			return false, err
		}
		if affected, err := result.RowsAffected(); err != nil || affected != 1 {
			if err != nil {
				return false, err
			}
			return false, ErrConflict
		}
	}
	nextRunRevision := c.runRevision + 1
	state, err := json.Marshal(map[string]interface{}{"definitionId": c.definitionID, "version": c.version, "status": RunInterrupted, "revision": nextRunRevision})
	if err != nil {
		return false, err
	}
	result, err = tx.Exec(`UPDATE task_runs SET status=?,revision=?,state_json=?,updated_at=?,started_at=COALESCE(started_at,?),finished_at=?,error_code=?,error_summary=? WHERE id=? AND owner_id=? AND kind='workflow' AND revision=?`, RunInterrupted, nextRunRevision, string(state), now, now, now, "execution_interrupted", "workflow step had no durable dispatch", c.runID, c.ownerID, c.runRevision)
	if err != nil {
		return false, err
	}
	if affected, err := result.RowsAffected(); err != nil || affected != 1 {
		if err != nil {
			return false, err
		}
		return false, ErrConflict
	}
	if _, err = tx.Exec(`UPDATE workflow_runs SET updated_at=? WHERE run_id=? AND owner_id=?`, now, c.runID, c.ownerID); err != nil {
		return false, err
	}
	if c.stepStatus != StepSucceeded {
		if err = appendWorkflowEvent(tx, c.runID, StepFailedEvent, now, map[string]interface{}{"stepId": c.stepID, "revision": nextStepRevision}); err != nil {
			return false, err
		}
	}
	if err = appendWorkflowEvent(tx, c.runID, RunInterruptedEvent, now, map[string]interface{}{"revision": nextRunRevision, "reasonCode": "execution_interrupted"}); err != nil {
		return false, err
	}
	return true, nil
}

func recoverySummaryFor(classification string) string {
	if classification == RecoveryStartedQueuedAgent || classification == RecoveryPreparedQueuedAgent {
		return "agent execution state is ambiguous"
	}
	if classification == RecoveryMissingLinkage || classification == RecoveryPreparedMissingLinkage || classification == RecoveryConflictingLinkage {
		return "workflow and agent linkage is inconsistent"
	}
	return "workflow state is inconsistent"
}

func loadRecoveryCandidateTx(tx *sql.Tx, ownerID, runID, stepID string) (recoveryCandidate, error) {
	row := tx.QueryRow(`SELECT w.run_id,w.owner_id,w.definition_id,w.version,t.status,t.revision,
		s.step_id,s.status,s.revision,s.attempt,
		d.dispatch_id,d.agent_run_id,d.state,d.revision,
		at.owner_id,at.status,at.revision,at.state_json,
		a.owner_id,a.status,a.revision,a.state_json
		FROM workflow_runs w JOIN task_runs t ON t.id=w.run_id AND t.kind='workflow'
		JOIN workflow_steps s ON s.run_id=w.run_id AND s.step_id=?
		LEFT JOIN workflow_dispatches d ON d.run_id=s.run_id AND d.step_id=s.step_id
		LEFT JOIN task_runs at ON at.id=d.agent_run_id AND at.kind='agent'
		LEFT JOIN agent_runs a ON a.id=d.agent_run_id
		WHERE w.owner_id=? AND w.run_id=?`, stepID, ownerID, runID)
	return scanRecoveryCandidateRow(row)
}

type recoveryRowScanner interface{ Scan(...interface{}) error }

func scanRecoveryCandidateRow(row recoveryRowScanner) (recoveryCandidate, error) {
	var c recoveryCandidate
	var taskOwner, taskStatus, taskState, agentOwner, agentStatus, agentState sql.NullString
	var taskRevision, agentRevision sql.NullInt64
	var dispatchID, agentRunID, dispatchState sql.NullString
	var dispatchRevision sql.NullInt64
	if err := row.Scan(&c.runID, &c.ownerID, &c.definitionID, &c.version, &c.runStatus, &c.runRevision,
		&c.stepID, &c.stepStatus, &c.stepRevision, &c.stepAttempt,
		&dispatchID, &agentRunID, &dispatchState, &dispatchRevision,
		&taskOwner, &taskStatus, &taskRevision, &taskState,
		&agentOwner, &agentStatus, &agentRevision, &agentState); err != nil {
		return c, err
	}
	if dispatchID.Valid {
		c.hasDispatch, c.dispatchID = true, dispatchID.String
		c.agentRunID, c.dispatchState, c.dispatchRevision = agentRunID.String, dispatchState.String, uint64(dispatchRevision.Int64)
	}
	if taskOwner.Valid {
		c.hasTask, c.taskOwner, c.taskStatus, c.taskRevision, c.taskState = true, taskOwner.String, taskStatus.String, uint64(taskRevision.Int64), taskState.String
	}
	if agentOwner.Valid {
		c.hasAgent, c.agentOwner, c.agentStatus, c.agentRevision, c.agentState = true, agentOwner.String, agentStatus.String, uint64(agentRevision.Int64), agentState.String
	}
	return c, nil
}

func reconcileSuccessTx(tx *sql.Tx, c recoveryCandidate) (bool, error) {
	var state agentrun.Run
	if err := json.Unmarshal([]byte(c.agentState), &state); err != nil {
		return false, err
	}
	output, err := json.Marshal(state.Result)
	if err != nil {
		return false, err
	}
	return reconcileTerminalTx(tx, c, RunSucceeded, "", "", terminalReconcileOptions{output: output})
}

// terminalReconcileOptions keeps the fixed state mutation explicit and avoids
// allowing arbitrary agent-provided data into workflow error fields.
type terminalReconcileOptions struct {
	output    json.RawMessage
	cancelled bool
}

func reconcileTerminalTx(tx *sql.Tx, c recoveryCandidate, status RunStatus, errorCode, summary string, options terminalReconcileOptions) (bool, error) {
	if status == RunSucceeded && len(options.output) == 0 {
		return false, fmt.Errorf("successful recovery output unavailable")
	}
	now := nowMillis()
	stepStatus := StepFailed
	if status == RunSucceeded {
		stepStatus = StepSucceeded
	}
	nextStepRevision := c.stepRevision + 1
	stepOutput := interface{}(nil)
	if status == RunSucceeded {
		stepOutput = string(options.output)
	}
	stepUpdate, err := tx.Exec(`UPDATE workflow_steps SET status=?,revision=?,output_json=?,error_summary=?,finished_at=? WHERE run_id=? AND step_id=? AND status=? AND revision=?`, stepStatus, nextStepRevision, stepOutput, nullableString(summary), now, c.runID, c.stepID, c.stepStatus, c.stepRevision)
	if err != nil {
		return false, err
	}
	if affected, err := stepUpdate.RowsAffected(); err != nil || affected != 1 {
		if err != nil {
			return false, err
		}
		return false, ErrConflict
	}
	dispatchState := DispatchStateFailed
	if status == RunSucceeded {
		dispatchState = DispatchStateSucceeded
	} else if options.cancelled {
		dispatchState = DispatchStateCancelled
	}
	dispatchUpdate, err := tx.Exec(`UPDATE workflow_dispatches SET state=?,revision=?,output_json=?,updated_at=? WHERE dispatch_id=? AND run_id=? AND step_id=? AND agent_run_id=? AND revision=? AND state IN ('prepared','started','succeeded','failed','cancelled')`, dispatchState, nextStepRevision, stepOutput, now, c.dispatchID, c.runID, c.stepID, c.agentRunID, c.dispatchRevision)
	if err != nil {
		return false, err
	}
	if affected, err := dispatchUpdate.RowsAffected(); err != nil || affected != 1 {
		if err != nil {
			return false, err
		}
		return false, ErrConflict
	}
	var remaining int
	if err = tx.QueryRow(`SELECT COUNT(*) FROM workflow_steps WHERE run_id=? AND status<>?`, c.runID, StepSucceeded).Scan(&remaining); err != nil {
		return false, err
	}
	nextRunStatus := RunRunning
	if status != RunSucceeded || remaining == 0 {
		nextRunStatus = status
	}
	nextRunRevision := c.runRevision + 1
	stateJSON, err := json.Marshal(map[string]interface{}{"definitionId": c.definitionID, "version": c.version, "status": nextRunStatus, "revision": nextRunRevision})
	if err != nil {
		return false, err
	}
	finished := interface{}(nil)
	if nextRunStatus.Terminal() || nextRunStatus == RunBlockedPolicy {
		finished = now
	}
	result, err := tx.Exec(`UPDATE task_runs SET status=?,revision=?,state_json=?,updated_at=?,started_at=COALESCE(started_at,?),finished_at=?,error_code=?,error_summary=? WHERE id=? AND owner_id=? AND kind='workflow' AND revision=?`, nextRunStatus, nextRunRevision, string(stateJSON), now, now, finished, nullableString(errorCode), nullableString(summary), c.runID, c.ownerID, c.runRevision)
	if err != nil {
		return false, err
	}
	if affected, err := result.RowsAffected(); err != nil || affected != 1 {
		if err != nil {
			return false, err
		}
		return false, ErrConflict
	}
	if _, err = tx.Exec(`UPDATE workflow_runs SET updated_at=? WHERE run_id=? AND owner_id=?`, now, c.runID, c.ownerID); err != nil {
		return false, err
	}
	eventData := map[string]interface{}{"stepId": c.stepID, "dispatchId": c.dispatchID, "agentRunId": c.agentRunID, "revision": nextStepRevision}
	stepEvent := StepFailedEvent
	if status == RunSucceeded {
		stepEvent = StepSucceededEvent
	}
	if err = appendWorkflowEvent(tx, c.runID, stepEvent, now, eventData); err != nil {
		return false, err
	}
	if nextRunStatus.Terminal() {
		runEvent := RunFailedEvent
		if nextRunStatus == RunSucceeded {
			runEvent = RunSucceededEvent
		}
		if nextRunStatus == RunInterrupted {
			runEvent = RunInterruptedEvent
		}
		if err = appendWorkflowEvent(tx, c.runID, runEvent, now, map[string]interface{}{"revision": nextRunRevision, "reasonCode": errorCode}); err != nil {
			return false, err
		}
	}
	return true, nil
}

func finalizeRunTx(tx *sql.Tx, c recoveryCandidate) (bool, error) {
	var count, incomplete int
	if err := tx.QueryRow(`SELECT COUNT(*),COALESCE(SUM(CASE WHEN status<>? THEN 1 ELSE 0 END),0) FROM workflow_steps WHERE run_id=?`, StepSucceeded, c.runID).Scan(&count, &incomplete); err != nil {
		return false, err
	}
	if count == 0 || incomplete != 0 {
		return false, nil
	}
	now := nowMillis()
	nextRevision := c.runRevision + 1
	state, err := json.Marshal(map[string]interface{}{"definitionId": c.definitionID, "version": c.version, "status": RunSucceeded, "revision": nextRevision})
	if err != nil {
		return false, err
	}
	result, err := tx.Exec(`UPDATE task_runs SET status=?,revision=?,state_json=?,updated_at=?,started_at=COALESCE(started_at,?),finished_at=?,error_code=NULL,error_summary=NULL WHERE id=? AND owner_id=? AND kind='workflow' AND revision=? AND status NOT IN ('succeeded','failed','cancelled','interrupted')`, RunSucceeded, nextRevision, string(state), now, now, now, c.runID, c.ownerID, c.runRevision)
	if err != nil {
		return false, err
	}
	if affected, err := result.RowsAffected(); err != nil || affected != 1 {
		if err != nil {
			return false, err
		}
		return false, nil
	}
	if _, err = tx.Exec(`UPDATE workflow_runs SET updated_at=? WHERE run_id=? AND owner_id=?`, now, c.runID, c.ownerID); err != nil {
		return false, err
	}
	if err = appendWorkflowEvent(tx, c.runID, RunSucceededEvent, now, map[string]interface{}{"revision": nextRevision}); err != nil {
		return false, err
	}
	return true, nil
}
