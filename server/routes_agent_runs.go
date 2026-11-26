package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"ai-server-studio-backend/agentrun"
)

func (s *Server) registerAgentRoutes() {
	s.mux.HandleFunc("POST /v1/agent/runs", s.handleCreateAgentRun)
	s.mux.HandleFunc("POST /v1/agent/chat", s.handleAgentChat)
	s.mux.HandleFunc("GET /v1/agent/runs/{id}", s.handleGetAgentRun)
	s.mux.HandleFunc("GET /v1/agent/runs/{id}/events", s.handleAgentRunEvents)
	s.mux.HandleFunc("POST /v1/agent/runs/{id}/cancel", s.handleCancelAgentRun)
}

func (s *Server) handleCreateAgentRun(w http.ResponseWriter, r *http.Request) {
	if !s.agentRunsReady(w) {
		return
	}
	owner, ok := s.agentRunOwner(w, r)
	if !ok {
		return
	}
	var req agentRunCreateReq
	if err := jsonDecode(r, &req); err != nil {
		writeError(w, 400, "invalid JSON", "invalid_request")
		return
	}
	if req.Goal == "" {
		writeError(w, 400, "goal is required", "invalid_request")
		return
	}
	provider, err := s.resolveAgentProvider(r, req.Provider)
	if err != nil {
		writeError(w, http.StatusForbidden, "owned enabled provider required", "forbidden")
		return
	}
	req.Provider = provider

	if req.ModelName == "" {
		req.ModelName = s.eng.GetModelName()
	}
	req.ExecutionMode = normalizeAgentExecutionMode(req.ExecutionMode)
	filteredTools, droppedTools := filterBackendAgentTools(req.Tools)
	req.Tools = filteredTools
	if len(droppedTools) > 0 {
		fmt.Printf("[Agent Runs] dropping unsupported backend tools: %s\n", strings.Join(droppedTools, ", "))
	}

	s.lifecycleMu.Lock()
	if s.closing {
		s.lifecycleMu.Unlock()
		writeError(w, http.StatusServiceUnavailable, "server is shutting down", "unavailable")
		return
	}
	run, err := s.agentRuns.createWithMetadata(req.Goal, req.ModelName, owner, req.SessionID, req.ExecutionMetadata)
	if err != nil {
		s.lifecycleMu.Unlock()
		log.Printf("create agent run: %v", err)
		writeError(w, 500, "failed to persist run", "persistence_error")
		return
	}
	s.runWG.Add(1)
	s.lifecycleMu.Unlock()
	state := run.snapshot()
	writeJSON(w, map[string]interface{}{"id": state.ID, "status": state.Status})

	go func() { defer s.runWG.Done(); s.executeAgentRun(run, req) }()
}

func (s *Server) executeAgentRun(run *agentRun, req agentRunCreateReq) {
	claimed, err := run.claimExecution()
	if err != nil {
		s.failAgentRun(run, err)
		return
	}
	if !claimed {
		return
	}
	state := run.snapshot()
	goal := state.Goal
	if run.isTerminal() {
		return
	}
	maxSteps := req.MaxSteps
	if maxSteps <= 0 {
		maxSteps = 8
	}
	maxIterations := req.MaxIterations
	if maxIterations <= 0 {
		maxIterations = 8
	}

	if req.Provider == nil || req.Provider.BaseURL == "" {
		req.Provider = &agentProviderConfig{
			ID:      "local",
			Name:    "Local Server",
			BaseURL: "http://localhost/v1",
		}
	}
	if req.ExecutionMode == "" {
		req.ExecutionMode = agentExecutionModeOnline
	}

	if isLocalProvider(req.Provider.BaseURL) && !s.eng.IsModelLoaded() {
		errMsg := "No local model loaded for backend agent run"
		s.finishAgentRun(run, agentrun.StatusError, errMsg, "", 0)
		return
	}

	plan := s.createAgentPlan(goal, req, maxSteps, state.OwnerID)
	if err := run.record("plan_created", map[string]interface{}{"plan": plan}, &agentrun.RunCheckpoint{Boundary: "planned"}); err != nil {
		s.failAgentRun(run, err)
		return
	}

	stepsRaw, _ := plan["steps"].([]map[string]interface{})
	if len(stepsRaw) == 0 {
		stepsRaw = []map[string]interface{}{{
			"id":          "step-1",
			"description": goal,
			"status":      "pending",
		}}
	}

	completed := make([]string, 0, len(stepsRaw))
	for _, step := range stepsRaw {
		if run.isTerminal() {
			return
		}

		stepID := toString(step["id"], "step")
		stepDesc := toString(step["description"], goal)

		if err := run.record("step_started", map[string]interface{}{
			"step": map[string]interface{}{
				"id":          stepID,
				"description": stepDesc,
				"status":      "running",
			},
		}, &agentrun.RunCheckpoint{Boundary: "step_started", StepID: stepID, Completed: completed}); err != nil {
			s.failAgentRun(run, err)
			return
		}

		answer, err := s.executeAgentStep(run, req, stepID, stepDesc, completed, maxIterations)
		if err != nil {
			s.failAgentRun(run, err)
			return
		}

		completed = append(completed, fmt.Sprintf("%s: %s", stepDesc, answer))
		if err := run.record("step_done", map[string]interface{}{"stepId": stepID, "answer": answer}, &agentrun.RunCheckpoint{Boundary: "step_completed", StepID: stepID, Completed: completed}); err != nil {
			s.failAgentRun(run, err)
			return
		}
	}

	finalAnswer := ""
	if len(completed) > 0 {
		finalAnswer = strings.Join(completed, "\n")
	}
	if finalAnswer == "" {
		finalAnswer = goal
	}

	s.finishAgentRun(run, agentrun.StatusDone, "", finalAnswer, len(completed))
}

func (s *Server) finishAgentRun(run *agentRun, status agentrun.Status, reason, result string, iterations int) {
	if _, err := run.finish(status, reason, result, iterations); err != nil {
		log.Printf("finish agent run: %v", err)
	}
}

func (s *Server) failAgentRun(run *agentRun, err error) {
	if !errors.Is(err, errRunTerminal) {
		s.finishAgentRun(run, agentrun.StatusError, err.Error(), "", 0)
	}
}

func (s *Server) agentRunsReady(w http.ResponseWriter) bool {
	if s.agentRunsErr != nil || s.agentRuns == nil {
		writeError(w, 500, "agent run repository unavailable", "persistence_error")
		return false
	}
	return true
}

func (s *Server) createAgentPlan(goal string, req agentRunCreateReq, maxSteps int, owner string) map[string]interface{} {
	plannerPrompt := fmt.Sprintf(
		"Create a concise execution plan with at most %d steps for this goal. Return strict JSON: {\"steps\":[{\"id\":\"step-1\",\"description\":\"...\",\"status\":\"pending\"}]} and nothing else.",
		maxSteps,
	)

	response, err := s.callAgentModel(req, []map[string]interface{}{
		{"role": "system", "content": plannerPrompt},
		{"role": "user", "content": goal},
	}, nil, owner)
	if err != nil || response.Content == "" {
		return map[string]interface{}{
			"goal":      goal,
			"createdAt": time.Now().UnixMilli(),
			"steps": []map[string]interface{}{{
				"id":          "step-1",
				"description": goal,
				"status":      "pending",
			}},
		}
	}

	jsonText := strings.TrimSpace(response.Content)
	jsonText = strings.TrimPrefix(jsonText, "```json")
	jsonText = strings.TrimPrefix(jsonText, "```")
	jsonText = strings.TrimSuffix(jsonText, "```")
	jsonText = strings.TrimSpace(jsonText)

	var parsed map[string]interface{}
	if json.Unmarshal([]byte(jsonText), &parsed) != nil {
		return map[string]interface{}{
			"goal":      goal,
			"createdAt": time.Now().UnixMilli(),
			"steps": []map[string]interface{}{{
				"id":          "step-1",
				"description": goal,
				"status":      "pending",
			}},
		}
	}

	stepsAny, _ := parsed["steps"].([]interface{})
	steps := make([]map[string]interface{}, 0, len(stepsAny))
	for i, raw := range stepsAny {
		m, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		desc := toString(m["description"], "")
		if desc == "" {
			continue
		}
		steps = append(steps, map[string]interface{}{
			"id":          toString(m["id"], fmt.Sprintf("step-%d", i+1)),
			"description": desc,
			"status":      "pending",
		})
		if len(steps) >= maxSteps {
			break
		}
	}

	if len(steps) == 0 {
		steps = []map[string]interface{}{{
			"id":          "step-1",
			"description": goal,
			"status":      "pending",
		}}
	}

	return map[string]interface{}{
		"goal":      goal,
		"createdAt": time.Now().UnixMilli(),
		"steps":     steps,
	}
}

func (s *Server) executeAgentStep(
	run *agentRun,
	req agentRunCreateReq,
	stepID string,
	stepDesc string,
	completed []string,
	maxIterations int,
) (string, error) {
	return s.executeAgentStepContext(context.Background(), run, req, stepID, stepDesc, completed, maxIterations)
}

func (s *Server) executeAgentStepContext(
	ctx context.Context,
	run *agentRun,
	req agentRunCreateReq,
	stepID string,
	stepDesc string,
	completed []string,
	maxIterations int,
) (string, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	messages := []map[string]interface{}{
		{
			"role":    "system",
			"content": "You are an autonomous backend agent. If a tool is needed, call one tool at a time. When done, answer directly.",
		},
		{
			"role":    "user",
			"content": fmt.Sprintf("Goal: %s\nCurrent step: %s\nCompleted:\n%s", run.snapshot().Goal, stepDesc, strings.Join(completed, "\n")),
		},
	}

	for i := 0; i < maxIterations; i++ {
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		default:
		}
		if run.isTerminal() {
			return "", errRunTerminal
		}

		resp, err := s.callAgentModel(req, messages, req.Tools, run.snapshot().OwnerID)
		if err != nil {
			return "", err
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		default:
		}
		if run.isTerminal() {
			return "", errRunTerminal
		}

		if len(resp.ToolCalls) > 0 {
			select {
			case <-ctx.Done():
				return "", ctx.Err()
			default:
			}
			tc := resp.ToolCalls[0]
			pendingMessages := append(append([]map[string]interface{}{}, messages...), map[string]interface{}{
				"role": "assistant", "toolCall": tc,
			})
			if err := run.record("", nil, &agentrun.RunCheckpoint{Boundary: "tool_pending", StepID: stepID, Iteration: i + 1, Completed: completed, Messages: pendingMessages}); err != nil {
				return "", err
			}
			if run.isTerminal() {
				return "", errRunTerminal
			}
			snapshot := run.snapshot()
			obs, toolErr := s.executeAgentToolWithRetryContext(ctx, tc.ID, snapshot.ID, tc.Function.Name, tc.Function.Arguments, req.ExecutionMode, snapshot.OwnerID)
			if toolErr != nil {
				obs = fmt.Sprintf("tool error: %v", toolErr)
			}

			messages = append(messages,
				map[string]interface{}{
					"role":    "assistant",
					"content": resp.Content,
					"tool_calls": []map[string]interface{}{{
						"id":   tc.ID,
						"type": "function",
						"function": map[string]interface{}{
							"name":      tc.Function.Name,
							"arguments": tc.Function.Arguments,
						},
					}},
				},
				map[string]interface{}{
					"role":         "tool",
					"tool_call_id": tc.ID,
					"content":      obs,
				},
			)
			if err := run.record("step_observation", map[string]interface{}{
				"stepId": stepID, "toolName": tc.Function.Name, "observation": obs,
			}, &agentrun.RunCheckpoint{Boundary: "tool_completed", StepID: stepID, Iteration: i + 1, Completed: completed, Messages: messages}); err != nil {
				return "", err
			}
			continue
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		default:
		}

		answer := strings.TrimSpace(resp.Content)
		if answer == "" {
			answer = "Step completed"
		}
		return answer, nil
	}

	return "", fmt.Errorf("step iteration limit reached")
}

func (s *Server) handleGetAgentRun(w http.ResponseWriter, r *http.Request) {
	if !s.agentRunsReady(w) {
		return
	}
	run, ok := s.ownedAgentRun(w, r)
	if !ok {
		return
	}
	writeJSON(w, run.snapshot())
}

func (s *Server) handleAgentRunEvents(w http.ResponseWriter, r *http.Request) {
	if !s.agentRunsReady(w) {
		return
	}
	run, ok := s.ownedAgentRun(w, r)
	if !ok {
		return
	}
	// Native EventSource reconnects use Last-Event-ID; cursor supports initial
	// subscriptions and clients that cannot set headers. Header takes precedence.
	rawCursor := strings.TrimSpace(r.Header.Get("Last-Event-ID"))
	if rawCursor == "" {
		rawCursor = strings.TrimSpace(r.URL.Query().Get("cursor"))
	}
	var cursor uint64
	if rawCursor != "" {
		var err error
		cursor, err = strconv.ParseUint(rawCursor, 10, 64)
		if err != nil {
			writeError(w, 400, "invalid event cursor", "invalid_request")
			return
		}
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "SSE not supported", 500)
		return
	}

	ch := run.subscribe()
	defer run.unsubscribe(ch)
	flusher.Flush()

	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()

	for {
		events, terminal := run.eventsAfter(cursor)
		for _, evt := range events {
			b, _ := json.Marshal(evt)
			if _, err := fmt.Fprintf(w, "id: %d\ndata: %s\n\n", evt.Sequence, b); err != nil {
				return
			}
			cursor = evt.Sequence
			flusher.Flush()
		}
		if terminal {
			return
		}
		select {
		case <-ch:
		case <-heartbeat.C:
			fmt.Fprintf(w, ": heartbeat\n\n")
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

func (s *Server) handleCancelAgentRun(w http.ResponseWriter, r *http.Request) {
	if !s.agentRunsReady(w) {
		return
	}
	run, ok := s.ownedAgentRun(w, r)
	if !ok {
		return
	}

	changed, err := run.finish(agentrun.StatusCanceled, "Canceled by user", "", 0)
	if err != nil {
		log.Printf("cancel agent run: %v", err)
		writeError(w, 500, "failed to persist cancellation", "persistence_error")
		return
	}
	if changed {
		s.eng.StopGenerating()
	}
	writeJSON(w, map[string]interface{}{"ok": true})
}

func (s *Server) agentRunOwner(w http.ResponseWriter, r *http.Request) (string, bool) {
	user, err := s.currentUserFromRequest(r)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to load auth session", "internal_error")
		return "", false
	}
	if user == nil || user.ID == "" {
		writeError(w, http.StatusUnauthorized, "not authenticated", "unauthorized")
		return "", false
	}
	return user.ID, true
}

func (s *Server) ownedAgentRun(w http.ResponseWriter, r *http.Request) (*agentRun, bool) {
	owner, ok := s.agentRunOwner(w, r)
	if !ok {
		return nil, false
	}
	run, found := s.agentRuns.get(r.PathValue("id"))
	if !found || run.snapshot().OwnerID != owner {
		writeError(w, http.StatusNotFound, "run not found", "not_found")
		return nil, false
	}
	return run, true
}
