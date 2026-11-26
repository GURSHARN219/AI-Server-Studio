// Package workflow owns immutable workflow definitions and the durable,
// execution-free workflow run state used by server handlers.
package workflow

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
)

const (
	// MaxStepIDLength bounds identifiers accepted in a workflow graph.
	MaxStepIDLength = 128
	// MaxWorkflowSteps prevents an accidentally unbounded graph from consuming
	// repository memory while it is validated.
	MaxWorkflowSteps = 1024
	// MaxStepDependencies bounds the adjacency list of one step.
	MaxStepDependencies = 1024
	// MaxJSONInputBytes bounds step, run, and event JSON payloads.
	MaxJSONInputBytes = 64 * 1024
	MaxEventLimit     = 10_000
	// StepTypeAgentPromptV1 is the only executable contract reserved by Phase
	// 3B. It is validated here, but execution is intentionally not implemented
	// in Stage B1.
	StepTypeAgentPromptV1 = "agent_prompt.v1"
)

var (
	ErrNotFound          = errors.New("workflow resource not found")
	ErrConflict          = errors.New("workflow revision conflict")
	ErrValidation        = errors.New("workflow validation failed")
	ErrInvalidTransition = errors.New("invalid workflow state transition")
	ErrTerminal          = errors.New("workflow run is terminal")
	ErrIncompleteSteps   = errors.New("workflow run has incomplete steps")
	ErrNotExecutable     = errors.New("workflow step is not executable")
)

// Step is one node in a workflow DAG. Input is any valid JSON value; a nil
// input is persisted as {}.
type Step struct {
	ID string `json:"id"`
	// StepType is intentionally optional for backwards compatibility. Empty
	// values are readable legacy definitions, but are never executable.
	StepType     string          `json:"stepType,omitempty"`
	Dependencies []string        `json:"dependencies,omitempty"`
	Input        json.RawMessage `json:"input,omitempty"`
}

// WorkflowStep is the durable state of a step in a run.
type WorkflowStep struct {
	ID           string     `json:"id"`
	StepType     string     `json:"stepType,omitempty"`
	Status       StepStatus `json:"status"`
	Dependencies []string   `json:"dependencies,omitempty"`
	// Attempt is reserved for a future execution engine; Phase 3A persists the
	// value but never increments or retries a step.
	Attempt uint64 `json:"attempt"`
	// Revision is the optimistic-concurrency version of this step row.
	Revision     uint64          `json:"revision"`
	Input        json.RawMessage `json:"input,omitempty"`
	Output       json.RawMessage `json:"output,omitempty"`
	ErrorSummary string          `json:"errorSummary,omitempty"`
	StartedAt    int64           `json:"startedAt,omitempty"`
	FinishedAt   int64           `json:"finishedAt,omitempty"`
}

type StepStatus string

const (
	StepQueued    StepStatus = "queued"
	StepRunning   StepStatus = "running"
	StepWaiting   StepStatus = "waiting"
	StepSucceeded StepStatus = "succeeded"
	StepFailed    StepStatus = "failed"
	StepCancelled StepStatus = "cancelled"
	StepSkipped   StepStatus = "skipped"
)

// WorkflowGraph is the immutable definition graph. Validate it before
// persisting; repository methods perform the validation again at the boundary.
type WorkflowGraph struct {
	Steps []Step `json:"steps"`
}

// Validate checks graph shape, references, payload bounds, and acyclicity.
// Validation order is deterministic so handlers receive stable errors.
func (g WorkflowGraph) Validate() error {
	_, err := normalizeGraph(g)
	return err
}

// Normalize returns a defensive, canonical copy suitable for storage and
// checksumming. Steps and dependency lists are sorted by identifier.
func (g WorkflowGraph) Normalize() (WorkflowGraph, error) {
	return normalizeGraph(g)
}

type CreateDefinitionRequest struct {
	ID    string
	Name  string
	Graph WorkflowGraph
}

type CreateRunRequest struct {
	ID           string
	DefinitionID string
	Version      uint64 // zero selects the current definition version.
	Input        json.RawMessage
	Metadata     map[string]interface{}
}

type WorkflowDefinition struct {
	ID             string `json:"id"`
	OwnerID        string `json:"ownerId"`
	Name           string `json:"name"`
	CurrentVersion uint64 `json:"currentVersion"`
	CreatedAt      int64  `json:"createdAt"`
}

type WorkflowVersion struct {
	DefinitionID string        `json:"definitionId"`
	OwnerID      string        `json:"ownerId"`
	Version      uint64        `json:"version"`
	Graph        WorkflowGraph `json:"graph"`
	Checksum     string        `json:"checksum"`
	CreatedAt    int64         `json:"createdAt"`
}

// WorkflowDefinitionVersion is a descriptive alias for handler code that
// wants to make the definition/version relationship explicit.
type WorkflowDefinitionVersion = WorkflowVersion

// WorkflowStepDefinition is a descriptive alias for a graph node.
type WorkflowStepDefinition = Step

type RunStatus string

const (
	RunQueued          RunStatus = "queued"
	RunValidating      RunStatus = "validating"
	RunRunning         RunStatus = "running"
	RunWaiting         RunStatus = "waiting"
	RunWaitingApproval RunStatus = "waiting_approval"
	RunBlockedPolicy   RunStatus = "blocked_policy"
	RunSucceeded       RunStatus = "succeeded"
	RunFailed          RunStatus = "failed"
	RunCancelled       RunStatus = "cancelled"
	RunInterrupted     RunStatus = "interrupted"
)

// Conventional Status* aliases keep this package easy to consume alongside
// the existing agentrun repository vocabulary.
const (
	StatusQueued          = RunQueued
	StatusValidating      = RunValidating
	StatusRunning         = RunRunning
	StatusWaiting         = RunWaiting
	StatusWaitingApproval = RunWaitingApproval
	StatusBlockedPolicy   = RunBlockedPolicy
	StatusSucceeded       = RunSucceeded
	StatusFailed          = RunFailed
	StatusCancelled       = RunCancelled
	StatusInterrupted     = RunInterrupted
)

// The workflow FSM is intentionally execution-free:
// queued -> validating|cancelled|interrupted
// validating -> running|failed|blocked_policy|cancelled|interrupted
// running -> waiting|waiting_approval|succeeded|failed|cancelled|interrupted
// waiting, waiting_approval -> running|failed|cancelled|interrupted
// blocked_policy -> failed|cancelled|interrupted
// succeeded, failed, cancelled, interrupted are terminal.
func (s RunStatus) Terminal() bool {
	return s == RunSucceeded || s == RunFailed || s == RunCancelled || s == RunInterrupted
}

func (s RunStatus) Valid() bool {
	switch s {
	case RunQueued, RunValidating, RunRunning, RunWaiting, RunWaitingApproval,
		RunBlockedPolicy, RunSucceeded, RunFailed, RunCancelled, RunInterrupted:
		return true
	default:
		return false
	}
}

func canTransition(from, to RunStatus) bool {
	switch from {
	case RunQueued:
		return to == RunValidating || to == RunCancelled || to == RunInterrupted
	case RunValidating:
		return to == RunRunning || to == RunFailed || to == RunBlockedPolicy || to == RunCancelled || to == RunInterrupted
	case RunRunning:
		return to == RunWaiting || to == RunWaitingApproval || to == RunSucceeded || to == RunFailed || to == RunCancelled || to == RunInterrupted
	case RunWaiting, RunWaitingApproval:
		return to == RunRunning || to == RunFailed || to == RunCancelled || to == RunInterrupted
	case RunBlockedPolicy:
		return to == RunFailed || to == RunCancelled || to == RunInterrupted
	default:
		return false
	}
}

// CanTransition reports whether a state change is permitted by the workflow
// finite state machine. It does not persist anything.
func CanTransition(from, to RunStatus) bool { return canTransition(from, to) }

type WorkflowRun struct {
	ID           string          `json:"id"`
	OwnerID      string          `json:"ownerId"`
	DefinitionID string          `json:"definitionId"`
	Version      uint64          `json:"version"`
	Status       RunStatus       `json:"status"`
	Revision     uint64          `json:"revision"`
	Input        json.RawMessage `json:"input"`
	CreatedAt    int64           `json:"createdAt"`
	UpdatedAt    int64           `json:"updatedAt"`
	StartedAt    int64           `json:"startedAt,omitempty"`
	FinishedAt   int64           `json:"finishedAt,omitempty"`
	ErrorCode    string          `json:"errorCode,omitempty"`
	ErrorSummary string          `json:"errorSummary,omitempty"`
	Steps        []WorkflowStep  `json:"steps"`
}

type TransitionRequest struct {
	To           RunStatus       `json:"to"`
	ErrorCode    string          `json:"errorCode,omitempty"`
	ErrorSummary string          `json:"errorSummary,omitempty"`
	EventType    string          `json:"eventType,omitempty"`
	Data         json.RawMessage `json:"data,omitempty"`
}

// WorkflowTransition is an alias that reads naturally in handler code.
type WorkflowTransition = TransitionRequest

type WorkflowEvent struct {
	RunID     string          `json:"runId"`
	OwnerID   string          `json:"ownerId"`
	Sequence  uint64          `json:"sequence"`
	Type      string          `json:"type"`
	Timestamp int64           `json:"timestamp"`
	Data      json.RawMessage `json:"data,omitempty"`
}

func normalizeGraph(graph WorkflowGraph) (WorkflowGraph, error) {
	if len(graph.Steps) == 0 {
		return WorkflowGraph{}, fmt.Errorf("%w: graph must contain at least one step", ErrValidation)
	}
	if len(graph.Steps) > MaxWorkflowSteps {
		return WorkflowGraph{}, fmt.Errorf("%w: too many steps", ErrValidation)
	}
	result := WorkflowGraph{Steps: make([]Step, len(graph.Steps))}
	ids := make(map[string]struct{}, len(graph.Steps))
	for i, source := range graph.Steps {
		if strings.TrimSpace(source.ID) == "" || source.ID != strings.TrimSpace(source.ID) {
			return WorkflowGraph{}, fmt.Errorf("%w: step %d has an empty or padded id", ErrValidation, i)
		}
		if len(source.ID) > MaxStepIDLength {
			return WorkflowGraph{}, fmt.Errorf("%w: step %q id is too long", ErrValidation, source.ID)
		}
		if _, exists := ids[source.ID]; exists {
			return WorkflowGraph{}, fmt.Errorf("%w: duplicate step id %q", ErrValidation, source.ID)
		}
		ids[source.ID] = struct{}{}
		if len(source.Dependencies) > MaxStepDependencies {
			return WorkflowGraph{}, fmt.Errorf("%w: too many dependencies for %q", ErrValidation, source.ID)
		}
		input, err := canonicalJSON(source.Input)
		if err != nil {
			return WorkflowGraph{}, fmt.Errorf("%w: step %q input: %v", ErrValidation, source.ID, err)
		}
		deps := append([]string(nil), source.Dependencies...)
		sort.Strings(deps)
		seenDeps := make(map[string]struct{}, len(deps))
		for _, dep := range deps {
			if dep == source.ID {
				return WorkflowGraph{}, fmt.Errorf("%w: step %q depends on itself", ErrValidation, source.ID)
			}
			if strings.TrimSpace(dep) == "" || dep != strings.TrimSpace(dep) || len(dep) > MaxStepIDLength {
				return WorkflowGraph{}, fmt.Errorf("%w: invalid dependency %q", ErrValidation, dep)
			}
			if _, exists := seenDeps[dep]; exists {
				return WorkflowGraph{}, fmt.Errorf("%w: duplicate dependency %q for %q", ErrValidation, dep, source.ID)
			}
			seenDeps[dep] = struct{}{}
		}
		result.Steps[i] = Step{ID: source.ID, Dependencies: deps, Input: input}
		stepType := strings.TrimSpace(source.StepType)
		if stepType != "" && stepType != source.StepType {
			return WorkflowGraph{}, fmt.Errorf("%w: step %q type has surrounding whitespace", ErrValidation, source.ID)
		}
		if len(stepType) > MaxStepIDLength {
			return WorkflowGraph{}, fmt.Errorf("%w: step %q type is too long", ErrValidation, source.ID)
		}
		result.Steps[i].StepType = stepType
	}
	sort.Slice(result.Steps, func(i, j int) bool { return result.Steps[i].ID < result.Steps[j].ID })
	for _, step := range result.Steps {
		for _, dep := range step.Dependencies {
			if _, ok := ids[dep]; !ok {
				return WorkflowGraph{}, fmt.Errorf("%w: step %q references missing dependency %q", ErrValidation, step.ID, dep)
			}
		}
	}
	// Kahn's algorithm with sorted queues makes cycle detection deterministic.
	indegree := make(map[string]int, len(result.Steps))
	dependents := make(map[string][]string, len(result.Steps))
	for _, step := range result.Steps {
		indegree[step.ID] = len(step.Dependencies)
		for _, dep := range step.Dependencies {
			dependents[dep] = append(dependents[dep], step.ID)
		}
	}
	queue := make([]string, 0, len(result.Steps))
	for id, degree := range indegree {
		if degree == 0 {
			queue = append(queue, id)
		}
	}
	sort.Strings(queue)
	visited := 0
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		visited++
		children := append([]string(nil), dependents[id]...)
		sort.Strings(children)
		for _, child := range children {
			indegree[child]--
			if indegree[child] == 0 {
				queue = append(queue, child)
				sort.Strings(queue)
			}
		}
	}
	if visited != len(result.Steps) {
		return WorkflowGraph{}, fmt.Errorf("%w: graph contains a dependency cycle", ErrValidation)
	}
	return result, nil
}

func canonicalJSON(raw json.RawMessage) (json.RawMessage, error) {
	if len(raw) == 0 {
		return json.RawMessage(`{}`), nil
	}
	if len(raw) > MaxJSONInputBytes {
		return nil, fmt.Errorf("JSON exceeds %d bytes", MaxJSONInputBytes)
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.UseNumber()
	var value interface{}
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	var extra interface{}
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return nil, errors.New("multiple JSON values")
		}
		return nil, err
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return encoded, nil
}

func validOwner(ownerID string) error {
	if strings.TrimSpace(ownerID) == "" {
		return fmt.Errorf("%w: owner is required", ErrValidation)
	}
	return nil
}

func validResourceID(id string, label string) error {
	if strings.TrimSpace(id) == "" || id != strings.TrimSpace(id) || len(id) > MaxStepIDLength {
		return fmt.Errorf("%w: invalid %s id", ErrValidation, label)
	}
	return nil
}

func newID(prefix string) (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}
	return prefix + hex.EncodeToString(bytes[:]), nil
}

// ExecutionMode controls how a future executor will run a prepared dispatch.
// Persistence accepts only these two explicit modes; omitted input is offline.
type ExecutionMode string

const (
	ExecutionModeOffline ExecutionMode = "offline"
	ExecutionModeOnline  ExecutionMode = "online"
)

// NormalizeExecutionMode applies the safe default used by workflow
// persistence. It does not start an executor or contact a provider.
func NormalizeExecutionMode(value string) (ExecutionMode, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", string(ExecutionModeOffline):
		return ExecutionModeOffline, nil
	case string(ExecutionModeOnline):
		return ExecutionModeOnline, nil
	default:
		return "", fmt.Errorf("%w: execution mode must be offline or online", ErrValidation)
	}
}

// ValidateExecutableStep is the future-execution gate. Legacy untyped steps
// remain readable and persistable, but cannot be claimed for dispatch.
func ValidateExecutableStep(step Step) error {
	return validateStepType(step.StepType)
}

// ValidateExecutableWorkflowStep is the state-row form of the same gate.
func ValidateExecutableWorkflowStep(step WorkflowStep) error {
	return validateStepType(step.StepType)
}

func validateStepType(stepType string) error {
	if strings.TrimSpace(stepType) == "" {
		return fmt.Errorf("%w: explicit step type is required", ErrNotExecutable)
	}
	if stepType != strings.TrimSpace(stepType) || len(stepType) > MaxStepIDLength {
		return fmt.Errorf("%w: invalid step type", ErrValidation)
	}
	if stepType != StepTypeAgentPromptV1 {
		return fmt.Errorf("%w: unsupported step type %q", ErrNotExecutable, stepType)
	}
	return nil
}
