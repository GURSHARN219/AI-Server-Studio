package workflow

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
)

const (
	DispatchStatePrepared  = "prepared"
	DispatchStateStarted   = "started"
	DispatchStateSucceeded = "succeeded"
	DispatchStateFailed    = "failed"
	DispatchStateCancelled = "cancelled"
	DispatchPreparedEvent  = "step.dispatch_prepared"
	DispatchStartedEvent   = "step.started"
	RunStartedEvent        = "run.started"
)

type ClaimStepRequest struct {
	RunID                    string
	StepID                   string
	ExpectedWorkflowRevision uint64
	ExpectedStepRevision     uint64
}

type ClaimedStep struct {
	RunID            string
	WorkflowRevision uint64
	Step             WorkflowStep
}

type DispatchIntentRequest struct {
	RunID                    string
	StepID                   string
	ExpectedWorkflowRevision uint64
	ExpectedStepRevision     uint64
	DispatchID               string
	AgentRunID               string
	ExecutionMode            string
	Input                    json.RawMessage
	Metadata                 map[string]interface{}
}

type DispatchIntent struct {
	DispatchID    string          `json:"dispatchId"`
	RunID         string          `json:"runId"`
	OwnerID       string          `json:"-"`
	StepID        string          `json:"stepId"`
	AgentRunID    string          `json:"agentRunId"`
	State         string          `json:"state"`
	ExecutionMode ExecutionMode   `json:"executionMode"`
	Attempt       uint64          `json:"attempt"`
	Revision      uint64          `json:"revision"`
	Input         json.RawMessage `json:"input"`
	Output        json.RawMessage `json:"output,omitempty"`
	Metadata      json.RawMessage `json:"metadata"`
	CreatedAt     int64           `json:"createdAt"`
	UpdatedAt     int64           `json:"updatedAt"`
	// Created is an internal orchestration hint. It is true only when this
	// call inserted the intent; an existing prepared intent must never be
	// executed a second time by a racing caller.
	Created bool `json:"-"`
}

// GetDispatchIntent returns the durable intent for a workflow step. Ownership
// is checked through the workflow run rather than by trusting the identifiers
// supplied by a caller.
func (r *SQLiteRepository) GetDispatchIntent(ownerID, runID, stepID string) (DispatchIntent, error) {
	if err := validOwner(ownerID); err != nil {
		return DispatchIntent{}, err
	}
	var intent DispatchIntent
	var input, output, metadata string
	err := r.db.QueryRow(`SELECT d.dispatch_id,d.run_id,w.owner_id,d.step_id,d.agent_run_id,d.state,d.execution_mode,d.attempt,d.revision,d.input_json,COALESCE(d.output_json,''),d.metadata_json,d.created_at,d.updated_at
		FROM workflow_dispatches d JOIN workflow_runs w ON w.run_id=d.run_id
		WHERE w.owner_id=? AND d.run_id=? AND d.step_id=?`, ownerID, runID, stepID).
		Scan(&intent.DispatchID, &intent.RunID, &intent.OwnerID, &intent.StepID, &intent.AgentRunID, &intent.State, &intent.ExecutionMode, &intent.Attempt, &intent.Revision, &input, &output, &metadata, &intent.CreatedAt, &intent.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return DispatchIntent{}, ErrNotFound
	}
	if err != nil {
		return DispatchIntent{}, err
	}
	intent.Input = json.RawMessage(input)
	intent.Metadata = json.RawMessage(metadata)
	if output != "" {
		intent.Output = json.RawMessage(output)
	}
	return intent, nil
}

// ClaimStep atomically claims one queued, explicitly typed step. It records
// state only; no agent or provider is started by this method.
func (r *SQLiteRepository) ClaimStep(ownerID string, request ClaimStepRequest) (ClaimedStep, error) {
	if err := validOwner(ownerID); err != nil {
		return ClaimedStep{}, err
	}
	tx, err := r.db.Begin()
	if err != nil {
		return ClaimedStep{}, err
	}
	defer tx.Rollback()
	var runRevision, version uint64
	var runStatus RunStatus
	var definitionID string
	if err = tx.QueryRow(`SELECT t.revision,t.status,w.definition_id,w.version FROM workflow_runs w JOIN task_runs t ON t.id=w.run_id AND t.kind='workflow' WHERE w.run_id=? AND w.owner_id=?`, request.RunID, ownerID).Scan(&runRevision, &runStatus, &definitionID, &version); errors.Is(err, sql.ErrNoRows) {
		return ClaimedStep{}, ErrNotFound
	} else if err != nil {
		return ClaimedStep{}, err
	}
	if runRevision != request.ExpectedWorkflowRevision {
		return ClaimedStep{}, ErrConflict
	}
	if runStatus.Terminal() {
		return ClaimedStep{}, ErrTerminal
	}
	if runStatus != RunQueued && runStatus != RunRunning {
		return ClaimedStep{}, ErrConflict
	}
	var step WorkflowStep
	var deps, input string
	err = tx.QueryRow(`SELECT step_type,status,dependencies_json,attempt,revision,input_json FROM workflow_steps WHERE run_id=? AND step_id=?`, request.RunID, request.StepID).Scan(&step.StepType, &step.Status, &deps, &step.Attempt, &step.Revision, &input)
	if errors.Is(err, sql.ErrNoRows) {
		return ClaimedStep{}, ErrNotFound
	}
	if err != nil {
		return ClaimedStep{}, err
	}
	step.ID, step.Input = request.StepID, json.RawMessage(input)
	if step.Revision != request.ExpectedStepRevision {
		return ClaimedStep{}, ErrConflict
	}
	if step.Status != StepQueued {
		return ClaimedStep{}, ErrConflict
	}
	if err = ValidateExecutableWorkflowStep(step); err != nil {
		return ClaimedStep{}, err
	}
	if err = json.Unmarshal([]byte(deps), &step.Dependencies); err != nil {
		return ClaimedStep{}, fmt.Errorf("decode dependencies: %w", err)
	}
	var blocked int
	if err = tx.QueryRow(`SELECT COUNT(*) FROM workflow_steps d JOIN json_each((SELECT dependencies_json FROM workflow_steps WHERE run_id=? AND step_id=?)) x ON d.run_id=? AND d.step_id=x.value WHERE d.status<>?`, request.RunID, request.StepID, request.RunID, StepSucceeded).Scan(&blocked); err != nil {
		return ClaimedStep{}, err
	}
	if blocked != 0 {
		return ClaimedStep{}, ErrConflict
	}
	now := nowMillis()
	nextStepRevision := step.Revision + 1
	nextRunRevision := runRevision + 1
	result, err := tx.Exec(`UPDATE workflow_steps SET status=?,attempt=?,revision=?,started_at=? WHERE run_id=? AND step_id=? AND status=? AND revision=?`, StepRunning, step.Attempt+1, nextStepRevision, now, request.RunID, request.StepID, StepQueued, request.ExpectedStepRevision)
	if err != nil {
		return ClaimedStep{}, err
	}
	affected, _ := result.RowsAffected()
	if affected != 1 {
		return ClaimedStep{}, ErrConflict
	}
	nextRunStatus := runStatus
	if runStatus == RunQueued {
		nextRunStatus = RunRunning
	}
	state, err := json.Marshal(map[string]interface{}{"definitionId": definitionID, "version": version, "status": nextRunStatus, "revision": nextRunRevision})
	if err != nil {
		return ClaimedStep{}, err
	}
	startedAt := interface{}(nil)
	if runStatus == RunQueued {
		startedAt = now
	}
	result, err = tx.Exec(`UPDATE task_runs SET status=?,revision=?,state_json=?,updated_at=?,started_at=COALESCE(started_at,?) WHERE id=? AND kind='workflow' AND revision=?`, nextRunStatus, nextRunRevision, string(state), now, startedAt, request.RunID, request.ExpectedWorkflowRevision)
	if err != nil {
		return ClaimedStep{}, err
	}
	affected, _ = result.RowsAffected()
	if affected != 1 {
		return ClaimedStep{}, ErrConflict
	}
	if _, err = tx.Exec(`UPDATE workflow_runs SET updated_at=? WHERE run_id=? AND owner_id=?`, now, request.RunID, ownerID); err != nil {
		return ClaimedStep{}, err
	}
	if runStatus == RunQueued {
		if err = appendWorkflowEvent(tx, request.RunID, RunStartedEvent, now, map[string]interface{}{"revision": nextRunRevision}); err != nil {
			return ClaimedStep{}, err
		}
	}
	if err = appendWorkflowEvent(tx, request.RunID, DispatchStartedEvent, now, map[string]interface{}{"stepId": request.StepID, "attempt": step.Attempt + 1, "revision": nextStepRevision}); err != nil {
		return ClaimedStep{}, err
	}
	if err = tx.Commit(); err != nil {
		return ClaimedStep{}, err
	}
	step.Status, step.Attempt, step.Revision, step.StartedAt = StepRunning, step.Attempt+1, nextStepRevision, now
	return ClaimedStep{RunID: request.RunID, WorkflowRevision: nextRunRevision, Step: step}, nil
}

// ClaimQueuedStep is a descriptive alias for ClaimStep.
func (r *SQLiteRepository) ClaimQueuedStep(ownerID string, request ClaimStepRequest) (ClaimedStep, error) {
	return r.ClaimStep(ownerID, request)
}

// PrepareDispatchIntent transactionally records a stable, idempotent dispatch
// intent and a canonical queued agent task. It never executes that task.
func (r *SQLiteRepository) PrepareDispatchIntent(ownerID string, request DispatchIntentRequest) (DispatchIntent, error) {
	return r.prepareDispatchIntent(ownerID, request, DispatchPreparedEvent)
}

// ClaimAndPrepareDispatchIntent atomically claims a queued step and records its
// stable dispatch intent. It is the preferred Stage B1 boundary for callers
// that must not leave a running step without a durable intent.
func (r *SQLiteRepository) ClaimAndPrepareDispatchIntent(ownerID string, request DispatchIntentRequest) (DispatchIntent, error) {
	if err := validOwner(ownerID); err != nil {
		return DispatchIntent{}, err
	}
	mode, err := NormalizeExecutionMode(request.ExecutionMode)
	if err != nil {
		return DispatchIntent{}, err
	}
	input, err := canonicalJSON(request.Input)
	if err != nil {
		return DispatchIntent{}, fmt.Errorf("%w: dispatch input: %v", ErrValidation, err)
	}
	metadata := json.RawMessage(`{}`)
	if request.Metadata != nil {
		raw, marshalErr := json.Marshal(request.Metadata)
		if marshalErr != nil {
			return DispatchIntent{}, marshalErr
		}
		metadata, err = canonicalJSON(raw)
		if err != nil {
			return DispatchIntent{}, err
		}
	}
	tx, err := r.db.Begin()
	if err != nil {
		return DispatchIntent{}, err
	}
	defer tx.Rollback()
	var existing DispatchIntent
	var existingInput, existingMetadata, existingOutput string
	err = tx.QueryRow(`SELECT d.dispatch_id,d.run_id,w.owner_id,d.step_id,d.agent_run_id,d.state,d.execution_mode,d.attempt,d.revision,d.input_json,COALESCE(d.output_json,''),d.metadata_json,d.created_at,d.updated_at FROM workflow_dispatches d JOIN workflow_runs w ON w.run_id=d.run_id WHERE w.owner_id=? AND d.run_id=? AND d.step_id=?`, ownerID, request.RunID, request.StepID).Scan(&existing.DispatchID, &existing.RunID, &existing.OwnerID, &existing.StepID, &existing.AgentRunID, &existing.State, &existing.ExecutionMode, &existing.Attempt, &existing.Revision, &existingInput, &existingOutput, &existingMetadata, &existing.CreatedAt, &existing.UpdatedAt)
	if err == nil {
		if (request.DispatchID != "" && existing.DispatchID != request.DispatchID) || (request.AgentRunID != "" && existing.AgentRunID != request.AgentRunID) || existing.ExecutionMode != mode || existingInput != string(input) || existingMetadata != string(metadata) {
			return DispatchIntent{}, ErrConflict
		}
		existing.Input, existing.Metadata = json.RawMessage(existingInput), json.RawMessage(existingMetadata)
		if existingOutput != "" {
			existing.Output = json.RawMessage(existingOutput)
		}
		existing.Created = false
		return existing, tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return DispatchIntent{}, err
	}

	var runRevision, version uint64
	var runStatus RunStatus
	var definitionID string
	if err = tx.QueryRow(`SELECT t.revision,t.status,w.definition_id,w.version FROM workflow_runs w JOIN task_runs t ON t.id=w.run_id AND t.kind='workflow' WHERE w.run_id=? AND w.owner_id=?`, request.RunID, ownerID).Scan(&runRevision, &runStatus, &definitionID, &version); errors.Is(err, sql.ErrNoRows) {
		return DispatchIntent{}, ErrNotFound
	} else if err != nil {
		return DispatchIntent{}, err
	}
	if runRevision != request.ExpectedWorkflowRevision || runStatus.Terminal() || (runStatus != RunQueued && runStatus != RunRunning) {
		return DispatchIntent{}, ErrConflict
	}
	var step WorkflowStep
	var deps, stepInput string
	if err = tx.QueryRow(`SELECT step_type,status,dependencies_json,attempt,revision,input_json FROM workflow_steps WHERE run_id=? AND step_id=?`, request.RunID, request.StepID).Scan(&step.StepType, &step.Status, &deps, &step.Attempt, &step.Revision, &stepInput); errors.Is(err, sql.ErrNoRows) {
		return DispatchIntent{}, ErrNotFound
	} else if err != nil {
		return DispatchIntent{}, err
	}
	if step.Revision != request.ExpectedStepRevision || step.Status != StepQueued {
		return DispatchIntent{}, ErrConflict
	}
	if err = ValidateExecutableWorkflowStep(step); err != nil {
		return DispatchIntent{}, err
	}
	if err = json.Unmarshal([]byte(deps), &step.Dependencies); err != nil {
		return DispatchIntent{}, fmt.Errorf("decode dependencies: %w", err)
	}
	var blocked int
	if err = tx.QueryRow(`SELECT COUNT(*) FROM workflow_steps d JOIN json_each((SELECT dependencies_json FROM workflow_steps WHERE run_id=? AND step_id=?)) x ON d.run_id=? AND d.step_id=x.value WHERE d.status<>?`, request.RunID, request.StepID, request.RunID, StepSucceeded).Scan(&blocked); err != nil {
		return DispatchIntent{}, err
	}
	if blocked != 0 {
		return DispatchIntent{}, ErrConflict
	}

	dispatchID, agentRunID := request.DispatchID, request.AgentRunID
	if dispatchID == "" {
		dispatchID, err = newID("wd_")
		if err != nil {
			return DispatchIntent{}, err
		}
	}
	if agentRunID == "" {
		agentRunID, err = newID("run-")
		if err != nil {
			return DispatchIntent{}, err
		}
	}
	if err = validResourceID(dispatchID, "dispatch"); err != nil {
		return DispatchIntent{}, err
	}
	if err = validResourceID(agentRunID, "agent run"); err != nil {
		return DispatchIntent{}, err
	}
	now := nowMillis()
	nextStepRevision, nextRunRevision := step.Revision+1, runRevision+1
	if _, err = tx.Exec(`UPDATE workflow_steps SET status=?,attempt=?,revision=?,started_at=? WHERE run_id=? AND step_id=? AND status=? AND revision=?`, StepRunning, step.Attempt+1, nextStepRevision, now, request.RunID, request.StepID, StepQueued, request.ExpectedStepRevision); err != nil {
		return DispatchIntent{}, err
	}
	nextRunStatus := runStatus
	if runStatus == RunQueued {
		nextRunStatus = RunRunning
	}
	state, err := json.Marshal(map[string]interface{}{"definitionId": definitionID, "version": version, "status": nextRunStatus, "revision": nextRunRevision})
	if err != nil {
		return DispatchIntent{}, err
	}
	startedAt := interface{}(nil)
	if runStatus == RunQueued {
		startedAt = now
	}
	if _, err = tx.Exec(`UPDATE task_runs SET status=?,revision=?,state_json=?,updated_at=?,started_at=COALESCE(started_at,?) WHERE id=? AND kind='workflow' AND revision=?`, nextRunStatus, nextRunRevision, string(state), now, startedAt, request.RunID, request.ExpectedWorkflowRevision); err != nil {
		return DispatchIntent{}, err
	}
	if _, err = tx.Exec(`UPDATE workflow_runs SET updated_at=? WHERE run_id=? AND owner_id=?`, now, request.RunID, ownerID); err != nil {
		return DispatchIntent{}, err
	}
	if runStatus == RunQueued {
		if err = appendWorkflowEvent(tx, request.RunID, RunStartedEvent, now, map[string]interface{}{"revision": nextRunRevision}); err != nil {
			return DispatchIntent{}, err
		}
	}
	if err = appendWorkflowEvent(tx, request.RunID, DispatchStartedEvent, now, map[string]interface{}{"stepId": request.StepID, "attempt": step.Attempt + 1, "revision": nextStepRevision}); err != nil {
		return DispatchIntent{}, err
	}
	agentProjection, _ := json.Marshal(map[string]interface{}{"id": agentRunID, "goal": "workflow step " + request.StepID, "modelName": "", "ownerId": ownerID, "status": "queued", "revision": 1, "createdAt": now, "updatedAt": now, "startedAt": 0, "completedAt": 0, "events": []interface{}{}, "checkpoint": map[string]interface{}{"boundary": "created", "updatedAt": now}})
	if _, err = tx.Exec(`INSERT INTO task_runs(id,owner_id,kind,status,attempt,resource_class,created_at,updated_at,metadata_json,state_json,revision) VALUES(?,?, 'agent','queued',0,'default',?,?,?,?,1)`, agentRunID, ownerID, now, now, string(metadata), string(agentProjection)); err != nil {
		return DispatchIntent{}, err
	}
	if _, err = tx.Exec(`INSERT INTO agent_runs(id,owner_id,status,revision,state_json,created_at,updated_at) VALUES(?,?, 'queued',1,?,?,?)`, agentRunID, ownerID, string(agentProjection), now, now); err != nil {
		return DispatchIntent{}, err
	}
	if _, err = tx.Exec(`INSERT INTO workflow_dispatches(dispatch_id,run_id,step_id,agent_run_id,state,execution_mode,attempt,revision,input_json,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, dispatchID, request.RunID, request.StepID, agentRunID, DispatchStatePrepared, mode, step.Attempt+1, nextStepRevision, string(input), string(metadata), now, now); err != nil {
		return DispatchIntent{}, err
	}
	if err = appendWorkflowEvent(tx, request.RunID, DispatchPreparedEvent, now, map[string]interface{}{"dispatchId": dispatchID, "agentRunId": agentRunID, "stepId": request.StepID, "attempt": step.Attempt + 1, "revision": nextStepRevision, "executionMode": mode}); err != nil {
		return DispatchIntent{}, err
	}
	if err = tx.Commit(); err != nil {
		return DispatchIntent{}, err
	}
	return DispatchIntent{DispatchID: dispatchID, RunID: request.RunID, OwnerID: ownerID, StepID: request.StepID, AgentRunID: agentRunID, State: DispatchStatePrepared, ExecutionMode: mode, Attempt: step.Attempt + 1, Revision: nextStepRevision, Input: input, Metadata: metadata, CreatedAt: now, UpdatedAt: now, Created: true}, nil
}

// PrepareStartedDispatchIntent uses the alternate fixed event name for callers
// whose external event vocabulary treats preparation as started.
func (r *SQLiteRepository) PrepareStartedDispatchIntent(ownerID string, request DispatchIntentRequest) (DispatchIntent, error) {
	return r.prepareDispatchIntent(ownerID, request, DispatchStartedEvent)
}

func (r *SQLiteRepository) prepareDispatchIntent(ownerID string, request DispatchIntentRequest, eventType string) (DispatchIntent, error) {
	if err := validOwner(ownerID); err != nil {
		return DispatchIntent{}, err
	}
	mode, err := NormalizeExecutionMode(request.ExecutionMode)
	if err != nil {
		return DispatchIntent{}, err
	}
	input, err := canonicalJSON(request.Input)
	if err != nil {
		return DispatchIntent{}, fmt.Errorf("%w: dispatch input: %v", ErrValidation, err)
	}
	metadata := json.RawMessage(`{}`)
	if request.Metadata != nil {
		raw, e := json.Marshal(request.Metadata)
		if e != nil {
			return DispatchIntent{}, e
		}
		metadata, err = canonicalJSON(raw)
		if err != nil {
			return DispatchIntent{}, err
		}
	}
	dispatchID, agentRunID := request.DispatchID, request.AgentRunID
	tx, err := r.db.Begin()
	if err != nil {
		return DispatchIntent{}, err
	}
	defer tx.Rollback()
	var existing DispatchIntent
	var existingInput, existingMetadata, existingOutput string
	err = tx.QueryRow(`SELECT d.dispatch_id,d.run_id,w.owner_id,d.step_id,d.agent_run_id,d.state,d.execution_mode,d.attempt,d.revision,d.input_json,COALESCE(d.output_json,''),d.metadata_json,d.created_at,d.updated_at FROM workflow_dispatches d JOIN workflow_runs w ON w.run_id=d.run_id WHERE w.owner_id=? AND d.run_id=? AND d.step_id=?`, ownerID, request.RunID, request.StepID).Scan(&existing.DispatchID, &existing.RunID, &existing.OwnerID, &existing.StepID, &existing.AgentRunID, &existing.State, &existing.ExecutionMode, &existing.Attempt, &existing.Revision, &existingInput, &existingOutput, &existingMetadata, &existing.CreatedAt, &existing.UpdatedAt)
	if err == nil {
		if (dispatchID != "" && existing.DispatchID != dispatchID) || (agentRunID != "" && existing.AgentRunID != agentRunID) || existing.ExecutionMode != mode || existingInput != string(input) || existingMetadata != string(metadata) {
			return DispatchIntent{}, ErrConflict
		}
		existing.Input, existing.Metadata = json.RawMessage(existingInput), json.RawMessage(existingMetadata)
		if existingOutput != "" {
			existing.Output = json.RawMessage(existingOutput)
		}
		return existing, tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return DispatchIntent{}, err
	}
	if dispatchID == "" {
		dispatchID, err = newID("wd_")
		if err != nil {
			return DispatchIntent{}, err
		}
	}
	if agentRunID == "" {
		agentRunID, err = newID("ar_")
		if err != nil {
			return DispatchIntent{}, err
		}
	}
	if err = validResourceID(dispatchID, "dispatch"); err != nil {
		return DispatchIntent{}, err
	}
	if err = validResourceID(agentRunID, "agent run"); err != nil {
		return DispatchIntent{}, err
	}
	var duplicate int
	if err = tx.QueryRow(`SELECT COUNT(*) FROM workflow_dispatches WHERE agent_run_id=? OR dispatch_id=?`, agentRunID, dispatchID).Scan(&duplicate); err != nil {
		return DispatchIntent{}, err
	}
	if duplicate != 0 {
		return DispatchIntent{}, ErrConflict
	}
	var runRevision uint64
	if err = tx.QueryRow(`SELECT t.revision FROM workflow_runs w JOIN task_runs t ON t.id=w.run_id AND t.kind='workflow' WHERE w.run_id=? AND w.owner_id=?`, request.RunID, ownerID).Scan(&runRevision); errors.Is(err, sql.ErrNoRows) {
		return DispatchIntent{}, ErrNotFound
	} else if err != nil {
		return DispatchIntent{}, err
	}
	if runRevision != request.ExpectedWorkflowRevision {
		return DispatchIntent{}, ErrConflict
	}
	var step WorkflowStep
	var inputStored string
	err = tx.QueryRow(`SELECT step_type,status,attempt,revision,input_json FROM workflow_steps WHERE run_id=? AND step_id=?`, request.RunID, request.StepID).Scan(&step.StepType, &step.Status, &step.Attempt, &step.Revision, &inputStored)
	if errors.Is(err, sql.ErrNoRows) {
		return DispatchIntent{}, ErrNotFound
	}
	if err != nil {
		return DispatchIntent{}, err
	}
	if step.Revision != request.ExpectedStepRevision {
		return DispatchIntent{}, ErrConflict
	}
	if step.Status != StepRunning {
		return DispatchIntent{}, ErrConflict
	}
	if err = ValidateExecutableWorkflowStep(step); err != nil {
		return DispatchIntent{}, err
	}
	now := nowMillis()
	agentProjection, _ := json.Marshal(map[string]interface{}{
		"id": agentRunID, "goal": "workflow step " + request.StepID, "modelName": "",
		"ownerId": ownerID, "status": "queued", "revision": 1, "createdAt": now, "updatedAt": now,
		"startedAt": 0, "completedAt": 0, "events": []interface{}{},
		"checkpoint": map[string]interface{}{"boundary": "created", "updatedAt": now},
	})
	if _, err = tx.Exec(`INSERT INTO task_runs(id,owner_id,kind,status,attempt,resource_class,created_at,updated_at,metadata_json,state_json,revision) VALUES(?,?, 'agent','queued',0,'default',?,?,?,?,1)`, agentRunID, ownerID, now, now, string(metadata), string(agentProjection)); err != nil {
		return DispatchIntent{}, err
	}
	if _, err = tx.Exec(`INSERT INTO agent_runs(id,owner_id,status,revision,state_json,created_at,updated_at) VALUES(?,?, 'queued',1,?,?,?)`, agentRunID, ownerID, string(agentProjection), now, now); err != nil {
		return DispatchIntent{}, err
	}
	if _, err = tx.Exec(`INSERT INTO workflow_dispatches(dispatch_id,run_id,step_id,agent_run_id,state,execution_mode,attempt,revision,input_json,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, dispatchID, request.RunID, request.StepID, agentRunID, DispatchStatePrepared, mode, step.Attempt, step.Revision, string(input), string(metadata), now, now); err != nil {
		return DispatchIntent{}, err
	}
	if err = appendWorkflowEvent(tx, request.RunID, eventType, now, map[string]interface{}{"dispatchId": dispatchID, "agentRunId": agentRunID, "stepId": request.StepID, "attempt": step.Attempt, "revision": step.Revision, "executionMode": mode}); err != nil {
		return DispatchIntent{}, err
	}
	if err = tx.Commit(); err != nil {
		return DispatchIntent{}, err
	}
	return DispatchIntent{DispatchID: dispatchID, RunID: request.RunID, OwnerID: ownerID, StepID: request.StepID, AgentRunID: agentRunID, State: DispatchStatePrepared, ExecutionMode: mode, Attempt: step.Attempt, Revision: step.Revision, Input: input, Metadata: metadata, CreatedAt: now, UpdatedAt: now}, nil
}

func appendWorkflowEvent(tx *sql.Tx, runID, eventType string, timestamp int64, data interface{}) error {
	raw, err := json.Marshal(data)
	if err != nil {
		return err
	}
	var sequence uint64
	if err = tx.QueryRow(`SELECT next_sequence FROM workflow_event_cursors WHERE run_id=?`, runID).Scan(&sequence); err != nil {
		return err
	}
	if _, err = tx.Exec(`INSERT INTO workflow_events(run_id,sequence,event_type,timestamp,event_json) VALUES(?,?,?,?,?)`, runID, sequence, eventType, timestamp, string(raw)); err != nil {
		return err
	}
	_, err = tx.Exec(`UPDATE workflow_event_cursors SET next_sequence=?,updated_at=? WHERE run_id=?`, sequence+1, timestamp, runID)
	return err
}
