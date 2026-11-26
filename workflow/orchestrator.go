package workflow

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"sort"
	"strings"
	"sync"
)

// ExecutionResult is the only result shape accepted from a trusted injected
// executor. It deliberately contains no provider, model, or tool fields.
type ExecutionResult struct {
	AgentRunID   string          `json:"agentRunId"`
	Status       RunStatus       `json:"status"`
	Output       json.RawMessage `json:"output,omitempty"`
	ErrorCode    string          `json:"errorCode,omitempty"`
	ErrorSummary string          `json:"errorSummary,omitempty"`
}

// ExecutionStatus is an explicit name for the terminal status vocabulary
// shared with the canonical workflow task status.
type ExecutionStatus = RunStatus

const (
	ExecutionSucceeded     = RunSucceeded
	ExecutionFailed        = RunFailed
	ExecutionBlockedPolicy = RunBlockedPolicy
	ExecutionInterrupted   = RunInterrupted
)

// ExecutionExecutor is injected by the application or a deterministic test.
// The workflow package never constructs a provider client and never performs a
// real model or tool call itself.
type ExecutionExecutor interface {
	Execute(context.Context, DispatchIntent) (ExecutionResult, error)
}

type Orchestrator struct {
	repo     *SQLiteRepository
	executor ExecutionExecutor
	mu       sync.Mutex
}

// TrustedOrchestrator is the descriptive name used by application wiring.
type TrustedOrchestrator = Orchestrator

func NewOrchestrator(repo *SQLiteRepository, executor ExecutionExecutor) *Orchestrator {
	return &Orchestrator{repo: repo, executor: executor}
}

func NewTrustedOrchestrator(repo *SQLiteRepository, executor ExecutionExecutor) *TrustedOrchestrator {
	return NewOrchestrator(repo, executor)
}

const MaxPromptBytes = 16 * 1024

// Run executes eligible steps sequentially until the run is terminal, policy
// blocked, or there is no eligible queued step. A running step is never
// re-executed by this method.
func (o *Orchestrator) Run(ctx context.Context, ownerID, runID string) (WorkflowRun, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	for {
		before, err := o.repo.GetRun(ownerID, runID)
		if err != nil {
			return WorkflowRun{}, err
		}
		if err = verifyImmutableRunGraph(o.repo, ownerID, before); err != nil {
			return before, err
		}
		if before.Status.Terminal() || before.Status == RunBlockedPolicy {
			return before, nil
		}
		after, err := o.RunNext(ctx, ownerID, runID)
		if err != nil {
			return after, err
		}
		if after.Status.Terminal() || after.Status == RunBlockedPolicy || after.Revision == before.Revision {
			return after, nil
		}
	}
}

// RunNext validates the immutable graph, finds the first eligible queued step,
// atomically prepares its dispatch, invokes the injected executor once, and
// commits the structured result. It returns unchanged state when a step is
// already active or no queued step is currently eligible.
func (o *Orchestrator) RunNext(ctx context.Context, ownerID, runID string) (WorkflowRun, error) {
	if o == nil || o.repo == nil || o.executor == nil {
		return WorkflowRun{}, errors.New("workflow orchestrator is not configured")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	// The database revisions are the durable gate. This mutex also prevents a
	// pair of in-process callers from both observing a newly prepared intent.
	o.mu.Lock()
	defer o.mu.Unlock()

	run, err := o.repo.GetRun(ownerID, runID)
	if err != nil {
		return WorkflowRun{}, err
	}
	if err = verifyImmutableRunGraph(o.repo, ownerID, run); err != nil {
		return run, err
	}
	if run.Status.Terminal() || run.Status == RunBlockedPolicy {
		return run, nil
	}
	if run.Status != RunQueued && run.Status != RunRunning {
		return run, fmt.Errorf("%w: orchestrator requires queued or running run", ErrConflict)
	}
	for _, step := range run.Steps {
		if step.Status == StepRunning || step.Status == StepWaiting {
			return run, nil
		}
	}

	step, ok := eligibleStep(run)
	if !ok {
		return run, nil
	}
	if err = ValidateExecutableWorkflowStep(step); err != nil {
		return run, err
	}
	if err = validatePromptInput(step.Input); err != nil {
		return run, err
	}

	intent, err := o.repo.ClaimAndPrepareDispatchIntent(ownerID, DispatchIntentRequest{
		RunID: run.ID, StepID: step.ID, ExpectedWorkflowRevision: run.Revision,
		ExpectedStepRevision: step.Revision, ExecutionMode: string(ExecutionModeOffline), Input: step.Input,
	})
	if err != nil {
		if errors.Is(err, ErrConflict) {
			latest, reloadErr := o.repo.GetRun(ownerID, runID)
			if reloadErr == nil {
				return latest, nil
			}
		}
		return run, err
	}
	if !intent.Created {
		// A prepared or terminal dispatch is durable evidence that another call
		// owns this step. No retry or second executor call is allowed.
		latest, getErr := o.repo.GetRun(ownerID, runID)
		if getErr != nil {
			return run, getErr
		}
		return latest, nil
	}
	if err = o.repo.markDispatchStarted(ownerID, intent); err != nil {
		return run, err
	}

	if err = contextError(ctx); err != nil {
		latest, finishErr := o.repo.InterruptStep(ownerID, run.ID, step.ID, intentRevisionRun(run, intent), intent.Revision, intent.AgentRunID, "execution_interrupted", err.Error())
		return latest, joinExecutionError(finishErr, err)
	}
	result, executeErr := o.executor.Execute(ctx, intent)
	if executeErr != nil {
		result = ExecutionResult{AgentRunID: intent.AgentRunID, Status: RunFailed, ErrorCode: "executor_error", ErrorSummary: executeErr.Error()}
	}
	if validationErr := validateExecutionResult(intent, result); validationErr != nil {
		latest, finishErr := o.repo.FailStep(ownerID, run.ID, step.ID, intentRevisionRun(run, intent), intent.Revision, intent.AgentRunID, "invalid_execution_result", validationErr.Error())
		return latest, joinExecutionError(finishErr, validationErr)
	}

	var completed WorkflowRun
	switch result.Status {
	case RunSucceeded:
		completed, err = o.repo.CompleteStep(ownerID, run.ID, step.ID, intentRevisionRun(run, intent), intent.Revision, intent.AgentRunID, result.Output)
	case RunFailed:
		completed, err = o.repo.FailStep(ownerID, run.ID, step.ID, intentRevisionRun(run, intent), intent.Revision, intent.AgentRunID, result.ErrorCode, result.ErrorSummary)
	case RunBlockedPolicy:
		completed, err = o.repo.BlockWorkflowByPolicy(ownerID, run.ID, step.ID, intentRevisionRun(run, intent), intent.Revision, intent.AgentRunID, result.ErrorCode, result.ErrorSummary)
	case RunInterrupted:
		completed, err = o.repo.InterruptStep(ownerID, run.ID, step.ID, intentRevisionRun(run, intent), intent.Revision, intent.AgentRunID, result.ErrorCode, result.ErrorSummary)
	}
	if err != nil {
		return completed, err
	}
	if executeErr != nil {
		return completed, executeErr
	}
	return completed, nil
}

func intentRevisionRun(run WorkflowRun, _ DispatchIntent) uint64 { return run.Revision + 1 }

func joinExecutionError(persistErr, executeErr error) error {
	if persistErr != nil {
		return persistErr
	}
	return executeErr
}

func contextError(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return nil
	}
}

func eligibleStep(run WorkflowRun) (WorkflowStep, bool) {
	steps := append([]WorkflowStep(nil), run.Steps...)
	sort.Slice(steps, func(i, j int) bool { return steps[i].ID < steps[j].ID })
	byID := make(map[string]WorkflowStep, len(steps))
	for _, step := range steps {
		byID[step.ID] = step
	}
	for _, step := range steps {
		if step.Status != StepQueued {
			continue
		}
		ready := true
		for _, depID := range step.Dependencies {
			dep, exists := byID[depID]
			if !exists || dep.Status != StepSucceeded {
				ready = false
				break
			}
		}
		if ready {
			return step, true
		}
	}
	return WorkflowStep{}, false
}

func validatePromptInput(raw json.RawMessage) error {
	if len(raw) == 0 || len(raw) > MaxPromptBytes {
		return fmt.Errorf("%w: prompt input is missing or too large", ErrValidation)
	}
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil || object == nil {
		return fmt.Errorf("%w: prompt input must be an object", ErrValidation)
	}
	var prompt string
	value, ok := object["prompt"]
	if !ok || json.Unmarshal(value, &prompt) != nil || strings.TrimSpace(prompt) == "" || len(prompt) > MaxPromptBytes {
		return fmt.Errorf("%w: prompt must be a non-empty bounded string", ErrValidation)
	}
	return nil
}

func validateExecutionResult(intent DispatchIntent, result ExecutionResult) error {
	if result.AgentRunID == "" || result.AgentRunID != intent.AgentRunID {
		return fmt.Errorf("agent run id does not match dispatch")
	}
	switch result.Status {
	case RunSucceeded, RunFailed, RunBlockedPolicy, RunInterrupted:
	default:
		return fmt.Errorf("invalid terminal execution status %q", result.Status)
	}
	if result.Status == RunSucceeded {
		if _, err := canonicalJSON(result.Output); err != nil {
			return fmt.Errorf("invalid execution output: %v", err)
		}
	} else {
		if result.ErrorCode == "" || result.ErrorSummary == "" {
			return fmt.Errorf("terminal execution failure requires sanitized error metadata")
		}
		if len(result.ErrorCode) > 128 || len(result.ErrorSummary) > 2048 {
			return fmt.Errorf("execution error metadata is too long")
		}
	}
	return nil
}

func verifyImmutableRunGraph(repo *SQLiteRepository, ownerID string, run WorkflowRun) error {
	version, err := repo.GetVersion(ownerID, run.DefinitionID, run.Version)
	if err != nil {
		return err
	}
	graph, err := version.Graph.Normalize()
	if err != nil {
		return err
	}
	stored := make([]Step, 0, len(run.Steps))
	for _, step := range run.Steps {
		stored = append(stored, Step{ID: step.ID, StepType: step.StepType, Dependencies: step.Dependencies, Input: step.Input})
	}
	storedGraph, err := (WorkflowGraph{Steps: stored}).Normalize()
	if err != nil || !reflect.DeepEqual(graph, storedGraph) {
		return fmt.Errorf("%w: stored run graph does not match immutable version", ErrValidation)
	}
	return nil
}
