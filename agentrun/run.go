// Package agentrun defines durable agent state independently of HTTP and execution.
package agentrun

import (
	"encoding/json"
	"errors"
	"fmt"
)

var ErrConflict = errors.New("agent run conflict")

type Status string

const (
	StatusQueued           Status = "queued"
	StatusRunning          Status = "running"
	StatusAwaitingApproval Status = "awaiting_approval"
	// These values retain the existing wire contract. The descriptive aliases
	// below are used by new application code while older clients can continue
	// to consume done/error/canceled.
	StatusDone     Status = "done"
	StatusError    Status = "error"
	StatusCanceled Status = "canceled"

	StatusCompleted Status = StatusDone
	StatusFailed    Status = StatusError
	StatusCancelled Status = StatusCanceled
)

func (s Status) Terminal() bool {
	return s == StatusDone || s == StatusError || s == StatusCanceled
}

func (s Status) Valid() bool {
	return s == StatusQueued || s == StatusRunning || s == StatusAwaitingApproval || s.Terminal()
}

// taskStatus is the storage vocabulary used by the unified task_runs table.
// The agent API continues to expose the historical wire values above.
func taskStatus(s Status) string {
	switch s {
	case StatusQueued:
		return "queued"
	case StatusRunning:
		return "running"
	case StatusAwaitingApproval:
		return "waiting_approval"
	case StatusDone:
		return "succeeded"
	case StatusError:
		return "failed"
	case StatusCanceled:
		return "cancelled"
	default:
		return string(s)
	}
}

func agentStatus(s string) (Status, bool) {
	switch s {
	case "queued", "validating":
		return StatusQueued, true
	case "running", "waiting":
		return StatusRunning, true
	case "waiting_approval":
		return StatusAwaitingApproval, true
	case "succeeded":
		return StatusDone, true
	case "failed", "blocked_policy", "interrupted":
		return StatusError, true
	case "cancelled":
		return StatusCanceled, true
	default:
		return "", false
	}
}

type RunEvent struct {
	RunID        string                 `json:"run_id,omitempty"`
	TimestampUTC string                 `json:"timestampUtc,omitempty"`
	Sequence     uint64                 `json:"sequence"`
	Type         string                 `json:"type"`
	Timestamp    int64                  `json:"timestamp"`
	Data         map[string]interface{} `json:"data,omitempty"`
}

// RunCheckpoint records execution boundaries, including pending side effects.
// Checkpoints are retained for inspection; restarting does not rerun tools.
type RunCheckpoint struct {
	Boundary         string                   `json:"boundary"`
	PreviousBoundary string                   `json:"previousBoundary,omitempty"`
	StepID           string                   `json:"stepId,omitempty"`
	Iteration        int                      `json:"iteration,omitempty"`
	Completed        []string                 `json:"completed,omitempty"`
	Messages         []map[string]interface{} `json:"messages,omitempty"`
	EventSequence    uint64                   `json:"eventSequence"`
	UpdatedAt        int64                    `json:"updatedAt"`
}

// Approval records a user decision boundary without coupling the domain to
// HTTP or a particular approval UI.
type Approval struct {
	ID          string                 `json:"id"`
	RunID       string                 `json:"runId"`
	Tool        string                 `json:"tool"`
	Arguments   map[string]interface{} `json:"arguments,omitempty"`
	Status      string                 `json:"status"`
	RequestedAt int64                  `json:"requestedAt"`
	DecidedAt   int64                  `json:"decidedAt,omitempty"`
	Reason      string                 `json:"reason,omitempty"`
}

type Run struct {
	ID                string                 `json:"id"`
	Revision          uint64                 `json:"revision,omitempty"`
	Goal              string                 `json:"goal"`
	ModelName         string                 `json:"modelName"`
	OwnerID           string                 `json:"ownerId,omitempty"`
	SessionID         string                 `json:"sessionId,omitempty"`
	ExecutionMetadata map[string]interface{} `json:"executionMetadata,omitempty"`
	CancelRequested   bool                   `json:"cancelRequested,omitempty"`
	Status            Status                 `json:"status"`
	Error             string                 `json:"error"`
	Result            string                 `json:"result"`
	Plan              map[string]interface{} `json:"plan"`
	Iterations        int                    `json:"iterations"`
	TotalTokens       int                    `json:"totalTokens"`
	CreatedAt         int64                  `json:"createdAt"`
	UpdatedAt         int64                  `json:"updatedAt"`
	StartedAt         int64                  `json:"startedAt"`
	CompletedAt       int64                  `json:"completedAt"`
	Events            []RunEvent             `json:"events"`
	Checkpoint        *RunCheckpoint         `json:"checkpoint,omitempty"`
}

// Repository persists a complete run atomically. Callers serialize updates to
// each run; an unsuccessful Save must leave the last committed state intact.
type Repository interface {
	List() ([]Run, error)
	// Create atomically creates run, or returns the durable run already stored
	// under the same ID when its immutable creation fields are compatible.
	Create(Run) (Run, error)
	Save(Run) error
}

// creationConflict reports which immutable creation field prevented an
// idempotent retry from being accepted. Runtime fields such as status,
// timestamps, revision, events, and checkpoints are intentionally ignored.
func creationConflict(existing, requested Run) error {
	if existing.OwnerID != requested.OwnerID {
		return fmt.Errorf("%w: run %q owner_id conflicts", ErrConflict, requested.ID)
	}
	if existing.Goal != requested.Goal {
		return fmt.Errorf("%w: run %q goal conflicts", ErrConflict, requested.ID)
	}
	if existing.ModelName != requested.ModelName {
		return fmt.Errorf("%w: run %q model_name conflicts", ErrConflict, requested.ID)
	}
	if existing.SessionID != requested.SessionID {
		return fmt.Errorf("%w: run %q session_id conflicts", ErrConflict, requested.ID)
	}
	existingMetadata, err := json.Marshal(existing.ExecutionMetadata)
	if err != nil {
		return err
	}
	requestedMetadata, err := json.Marshal(requested.ExecutionMetadata)
	if err != nil {
		return err
	}
	if string(existingMetadata) != string(requestedMetadata) {
		return fmt.Errorf("%w: run %q execution_metadata conflicts", ErrConflict, requested.ID)
	}
	return nil
}
