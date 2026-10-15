package server

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"ai-server-studio-backend/agentrun"
)

var errRunTerminal = agentrun.ErrTerminal

// agentRun owns synchronization and notifications; durable state belongs to the
// domain and all commits pass through the Repository boundary.
type agentRun struct {
	mu          sync.RWMutex
	state       agentrun.Run
	repo        agentrun.Repository
	subscribers map[chan struct{}]struct{}
}

type agentRunStore struct {
	mu   sync.RWMutex
	runs map[string]*agentRun
	repo agentrun.Repository
}

func newAgentRunStore(repo agentrun.Repository) (*agentRunStore, error) {
	states, err := repo.List()
	if err != nil {
		return nil, err
	}
	s := &agentRunStore{runs: make(map[string]*agentRun), repo: repo}
	for _, state := range states {
		run := newAgentRun(state, repo)
		if !state.Status.Terminal() {
			// In-flight model/tool calls cannot be resumed safely after a restart.
			if _, err := run.finish(agentrun.StatusError, "Server restarted before run completed", "", 0); err != nil {
				return nil, err
			}
		}
		s.runs[state.ID] = run
	}
	return s, nil
}

func newAgentRun(state agentrun.Run, repo agentrun.Repository) *agentRun {
	return &agentRun{state: state, repo: repo, subscribers: make(map[chan struct{}]struct{})}
}

func (s *agentRunStore) createWithMetadata(goal, modelName, ownerID, sessionID string, metadata map[string]interface{}) (*agentRun, error) {
	if ownerID == "" {
		return nil, errors.New("authenticated run owner required")
	}
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return nil, err
	}
	now := time.Now().UnixMilli()
	state := agentrun.Run{
		Revision: 1,
		ID:       "run-" + hex.EncodeToString(id[:]), Goal: goal, ModelName: modelName,
		OwnerID: ownerID, SessionID: sessionID, ExecutionMetadata: metadata,
		Status: agentrun.StatusRunning, CreatedAt: now, UpdatedAt: now, StartedAt: now,
		Events:     make([]agentrun.RunEvent, 0),
		Checkpoint: &agentrun.RunCheckpoint{Boundary: "created", UpdatedAt: now},
	}
	if err := s.repo.Save(state); err != nil {
		return nil, err
	}
	run := newAgentRun(state, s.repo)
	s.mu.Lock()
	s.runs[state.ID] = run
	s.mu.Unlock()
	return run, nil
}

func (s *agentRunStore) get(id string) (*agentRun, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	run, ok := s.runs[id]
	return run, ok
}

// cloneRun also isolates nested maps from writers and callers after a commit.
func cloneRun(state agentrun.Run) (agentrun.Run, error) {
	data, err := json.Marshal(state)
	if err != nil {
		return agentrun.Run{}, err
	}
	var copy agentrun.Run
	err = json.Unmarshal(data, &copy)
	return copy, err
}

func (r *agentRun) snapshot() agentrun.Run {
	r.mu.RLock()
	defer r.mu.RUnlock()
	state, _ := cloneRun(r.state) // Only JSON-serializable state is committed.
	return state
}

// update serializes state/event/checkpoint changes, saves before publishing,
// and leaves memory untouched when persistence fails.
func (r *agentRun) update(change func(*agentrun.Run)) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.state.Status.Terminal() {
		return errRunTerminal
	}
	next, err := cloneRun(r.state)
	if err != nil {
		return err
	}
	change(&next)
	next.Revision++
	next.UpdatedAt = time.Now().UnixMilli()
	if next.Checkpoint != nil {
		next.Checkpoint.UpdatedAt = next.UpdatedAt
		next.Checkpoint.EventSequence = uint64(len(next.Events))
	}
	// Clone after applying the change so externally supplied maps stay isolated.
	next, err = cloneRun(next)
	if err != nil {
		return err
	}
	if err := r.repo.Save(next); err != nil {
		return fmt.Errorf("persist run %s: %w", next.ID, err)
	}
	r.state = next
	for ch := range r.subscribers {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
	return nil
}

func addRunEvent(state *agentrun.Run, eventType string, data map[string]interface{}) {
	now := time.Now().UTC()
	state.Events = append(state.Events, agentrun.RunEvent{
		RunID: state.ID, TimestampUTC: now.Format(time.RFC3339Nano),
		Sequence: uint64(len(state.Events) + 1), Type: eventType, Timestamp: now.UnixMilli(), Data: data,
	})
}

func (r *agentRun) record(eventType string, data map[string]interface{}, checkpoint *agentrun.RunCheckpoint) error {
	return r.update(func(state *agentrun.Run) {
		if eventType != "" {
			addRunEvent(state, eventType, data)
		}
		if checkpoint != nil {
			state.Checkpoint = checkpoint
		}
		if eventType == "plan_created" {
			state.Plan, _ = data["plan"].(map[string]interface{})
		}
		if checkpoint != nil {
			state.Iterations = len(checkpoint.Completed)
		}
	})
}

func (r *agentRun) finish(status agentrun.Status, reason, result string, iterations int) (bool, error) {
	if !status.Terminal() {
		return false, fmt.Errorf("invalid terminal status %q", status)
	}
	err := r.update(func(state *agentrun.Run) {
		state.Status = status
		state.Error = reason
		state.Result = result
		state.CancelRequested = status == agentrun.StatusCanceled
		if status == agentrun.StatusDone {
			state.Iterations = iterations
		}
		state.CompletedAt = time.Now().UnixMilli()
		if state.Checkpoint == nil {
			state.Checkpoint = &agentrun.RunCheckpoint{}
		}
		state.Checkpoint.PreviousBoundary = state.Checkpoint.Boundary
		state.Checkpoint.Boundary = string(status)
		if status == agentrun.StatusDone {
			addRunEvent(state, "agent_done", map[string]interface{}{"answer": result})
		} else {
			addRunEvent(state, "agent_error", map[string]interface{}{"reason": reason})
		}
	})
	if errors.Is(err, errRunTerminal) {
		return false, nil
	}
	return err == nil, err
}

func (r *agentRun) isTerminal() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.state.Status.Terminal()
}

// Notifications coalesce, but the event log never drops entries. Register
// before reading replay state to avoid a replay/live handoff gap.
func (r *agentRun) subscribe() chan struct{} {
	r.mu.Lock()
	defer r.mu.Unlock()
	ch := make(chan struct{}, 1)
	r.subscribers[ch] = struct{}{}
	return ch
}

func (r *agentRun) unsubscribe(ch chan struct{}) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.subscribers, ch)
}

func (r *agentRun) eventsAfter(cursor uint64) ([]agentrun.RunEvent, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	state, _ := cloneRun(r.state)
	if cursor >= uint64(len(state.Events)) {
		return nil, state.Status.Terminal()
	}
	return state.Events[cursor:], state.Status.Terminal()
}
