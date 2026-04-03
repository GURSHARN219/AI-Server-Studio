package server

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"time"
)

type agentRunEvent struct {
	Type      string                 `json:"type"`
	Timestamp int64                  `json:"timestamp"`
	Data      map[string]interface{} `json:"data,omitempty"`
}

type agentRun struct {
	ID          string                 `json:"id"`
	Goal        string                 `json:"goal"`
	ModelName   string                 `json:"modelName"`
	Status      string                 `json:"status"`
	Error       string                 `json:"error,omitempty"`
	Result      string                 `json:"result,omitempty"`
	Plan        map[string]interface{} `json:"plan,omitempty"`
	Iterations  int                    `json:"iterations"`
	TotalTokens int                    `json:"totalTokens"`
	CreatedAt   int64                  `json:"createdAt"`
	UpdatedAt   int64                  `json:"updatedAt"`
	StartedAt   int64                  `json:"startedAt,omitempty"`
	CompletedAt int64                  `json:"completedAt,omitempty"`

	mu          sync.RWMutex
	events      []agentRunEvent
	subscribers map[chan agentRunEvent]struct{}
	done        chan struct{}
	cancel      chan struct{}
	closed      bool
}

type agentRunStore struct {
	mu   sync.RWMutex
	runs map[string]*agentRun
}

func newAgentRunStore() *agentRunStore {
	return &agentRunStore{runs: make(map[string]*agentRun)}
}

func (s *agentRunStore) create(goal string, modelName string) *agentRun {
	now := time.Now().UnixMilli()
	run := &agentRun{
		ID:          fmt.Sprintf("run-%d", now),
		Goal:        goal,
		ModelName:   modelName,
		Status:      "running",
		CreatedAt:   now,
		UpdatedAt:   now,
		StartedAt:   now,
		events:      make([]agentRunEvent, 0, 8),
		subscribers: make(map[chan agentRunEvent]struct{}),
		done:        make(chan struct{}),
		cancel:      make(chan struct{}),
	}
	s.mu.Lock()
	s.runs[run.ID] = run
	s.mu.Unlock()
	return run
}

func (s *agentRunStore) get(id string) (*agentRun, bool) {
	s.mu.RLock()
	run, ok := s.runs[id]
	s.mu.RUnlock()
	return run, ok
}

func (r *agentRun) appendEvent(eventType string, data map[string]interface{}) {
	evt := agentRunEvent{Type: eventType, Timestamp: time.Now().UnixMilli(), Data: data}

	r.mu.Lock()
	r.events = append(r.events, evt)
	r.UpdatedAt = evt.Timestamp
	subs := make([]chan agentRunEvent, 0, len(r.subscribers))
	for ch := range r.subscribers {
		subs = append(subs, ch)
	}
	r.mu.Unlock()

	for _, ch := range subs {
		select {
		case ch <- evt:
		default:
		}
	}
}

func (r *agentRun) snapshot() map[string]interface{} {
	r.mu.RLock()
	defer r.mu.RUnlock()

	copyEvents := make([]agentRunEvent, len(r.events))
	copy(copyEvents, r.events)

	return map[string]interface{}{
		"id":          r.ID,
		"goal":        r.Goal,
		"modelName":   r.ModelName,
		"status":      r.Status,
		"error":       r.Error,
		"result":      r.Result,
		"plan":        r.Plan,
		"iterations":  r.Iterations,
		"totalTokens": r.TotalTokens,
		"createdAt":   r.CreatedAt,
		"updatedAt":   r.UpdatedAt,
		"startedAt":   r.StartedAt,
		"completedAt": r.CompletedAt,
		"events":      copyEvents,
	}
}

func (r *agentRun) subscribe() chan agentRunEvent {
	ch := make(chan agentRunEvent, 64)
	r.mu.Lock()
	r.subscribers[ch] = struct{}{}
	events := make([]agentRunEvent, len(r.events))
	copy(events, r.events)
	r.mu.Unlock()

	for _, evt := range events {
		ch <- evt
	}
	return ch
}

func (r *agentRun) unsubscribe(ch chan agentRunEvent) {
	r.mu.Lock()
	delete(r.subscribers, ch)
	close(ch)
	r.mu.Unlock()
}

func (r *agentRun) markDone(result string, iterations int) {
	now := time.Now().UnixMilli()
	r.mu.Lock()
	r.Status = "done"
	r.Result = result
	r.Iterations = iterations
	r.UpdatedAt = now
	r.CompletedAt = now
	if !r.closed {
		close(r.done)
		r.closed = true
	}
	r.mu.Unlock()
}

func (r *agentRun) markError(errMsg string) {
	now := time.Now().UnixMilli()
	r.mu.Lock()
	r.Status = "error"
	r.Error = errMsg
	r.UpdatedAt = now
	r.CompletedAt = now
	if !r.closed {
		close(r.done)
		r.closed = true
	}
	r.mu.Unlock()
}

func (r *agentRun) markCanceled() {
	now := time.Now().UnixMilli()
	r.mu.Lock()
	r.Status = "canceled"
	r.UpdatedAt = now
	r.CompletedAt = now
	select {
	case <-r.cancel:
	default:
		close(r.cancel)
	}
	if !r.closed {
		close(r.done)
		r.closed = true
	}
	r.mu.Unlock()
}

func (r *agentRun) isCanceled() bool {
	select {
	case <-r.cancel:
		return true
	default:
		return false
	}
}

type agentProviderConfig struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	BaseURL string `json:"baseUrl"`
	APIKey  string `json:"apiKey"`
}

type agentToolDef struct {
	Type     string `json:"type"`
	Function struct {
		Name        string                 `json:"name"`
		Description string                 `json:"description"`
		Parameters  map[string]interface{} `json:"parameters"`
	} `json:"function"`
}

type agentRunCreateReq struct {
	Goal          string               `json:"goal"`
	ModelName     string               `json:"modelName"`
	MaxSteps      int                  `json:"maxSteps"`
	MaxIterations int                  `json:"maxIterations"`
	Provider      *agentProviderConfig `json:"provider"`
	Tools         []agentToolDef       `json:"tools"`
}

type agentChatToolCall struct {
	ID       string `json:"id"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type agentChatResponse struct {
	Content   string
	ToolCalls []agentChatToolCall
}

func isLocalProvider(baseURL string) bool {
	if baseURL == "" {
		return true
	}
	u, err := url.Parse(baseURL)
	if err != nil {
		return true
	}
	h := strings.ToLower(u.Hostname())
	return h == "localhost" || h == "127.0.0.1" || h == ""
}

func toString(v interface{}, fallback string) string {
	s, ok := v.(string)
	if !ok || strings.TrimSpace(s) == "" {
		return fallback
	}
	return strings.TrimSpace(s)
}

func extractAssistantContent(respBody []byte) string {
	var payload map[string]interface{}
	if json.Unmarshal(respBody, &payload) != nil {
		return ""
	}
	choices, ok := payload["choices"].([]interface{})
	if !ok || len(choices) == 0 {
		return ""
	}
	choice, _ := choices[0].(map[string]interface{})
	msg, _ := choice["message"].(map[string]interface{})
	content, _ := msg["content"].(string)
	return content
}
