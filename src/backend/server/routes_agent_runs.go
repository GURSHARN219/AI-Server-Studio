package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

func (s *Server) registerAgentRoutes() {
	s.mux.HandleFunc("POST /v1/agent/runs", s.handleCreateAgentRun)
	s.mux.HandleFunc("POST /v1/agent/chat", s.handleAgentChat)
	s.mux.HandleFunc("GET /v1/agent/runs/{id}", s.handleGetAgentRun)
	s.mux.HandleFunc("GET /v1/agent/runs/{id}/events", s.handleAgentRunEvents)
	s.mux.HandleFunc("POST /v1/agent/runs/{id}/cancel", s.handleCancelAgentRun)
}

func (s *Server) handleCreateAgentRun(w http.ResponseWriter, r *http.Request) {
	var req agentRunCreateReq
	if err := jsonDecode(r, &req); err != nil {
		writeError(w, 400, "invalid JSON", "invalid_request")
		return
	}
	if req.Goal == "" {
		writeError(w, 400, "goal is required", "invalid_request")
		return
	}

	if req.ModelName == "" {
		req.ModelName = s.eng.GetModelName()
	}
	req.ExecutionMode = normalizeAgentExecutionMode(req.ExecutionMode)
	filteredTools, droppedTools := filterBackendAgentTools(req.Tools)
	req.Tools = filteredTools
	if len(droppedTools) > 0 {
		fmt.Printf("[Agent Runs] dropping unsupported backend tools: %s\n", strings.Join(droppedTools, ", "))
	}

	run := s.agentRuns.create(req.Goal, req.ModelName)
	writeJSON(w, map[string]interface{}{"id": run.ID, "status": run.Status})

	go s.executeAgentRun(run, req)
}

func (s *Server) executeAgentRun(run *agentRun, req agentRunCreateReq) {
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
		run.appendEvent("agent_error", map[string]interface{}{"reason": errMsg})
		run.markError(errMsg)
		return
	}

	plan := s.createAgentPlan(run.Goal, req, maxSteps)
	run.mu.Lock()
	run.Plan = plan
	run.mu.Unlock()
	run.appendEvent("plan_created", map[string]interface{}{"plan": plan})

	stepsRaw, _ := plan["steps"].([]map[string]interface{})
	if len(stepsRaw) == 0 {
		stepsRaw = []map[string]interface{}{{
			"id":          "step-1",
			"description": run.Goal,
			"status":      "pending",
		}}
	}

	completed := make([]string, 0, len(stepsRaw))
	for _, step := range stepsRaw {
		if run.isCanceled() {
			return
		}

		stepID := toString(step["id"], "step")
		stepDesc := toString(step["description"], run.Goal)

		run.appendEvent("step_started", map[string]interface{}{
			"step": map[string]interface{}{
				"id":          stepID,
				"description": stepDesc,
				"status":      "running",
			},
		})

		answer, err := s.executeAgentStep(run, req, stepID, stepDesc, completed, maxIterations)
		if err != nil {
			errMsg := err.Error()
			run.appendEvent("agent_error", map[string]interface{}{"reason": errMsg})
			run.markError(errMsg)
			return
		}

		run.appendEvent("step_done", map[string]interface{}{"stepId": stepID, "answer": answer})
		completed = append(completed, fmt.Sprintf("%s: %s", stepDesc, answer))
	}

	finalAnswer := ""
	if len(completed) > 0 {
		finalAnswer = strings.Join(completed, "\n")
	}
	if finalAnswer == "" {
		finalAnswer = run.Goal
	}

	run.appendEvent("agent_done", map[string]interface{}{"answer": finalAnswer})
	run.markDone(finalAnswer, len(completed))
}

func (s *Server) createAgentPlan(goal string, req agentRunCreateReq, maxSteps int) map[string]interface{} {
	plannerPrompt := fmt.Sprintf(
		"Create a concise execution plan with at most %d steps for this goal. Return strict JSON: {\"steps\":[{\"id\":\"step-1\",\"description\":\"...\",\"status\":\"pending\"}]} and nothing else.",
		maxSteps,
	)

	response, err := s.callAgentModel(req, []map[string]interface{}{
		{"role": "system", "content": plannerPrompt},
		{"role": "user", "content": goal},
	}, nil)
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
	messages := []map[string]interface{}{
		{
			"role":    "system",
			"content": "You are an autonomous backend agent. If a tool is needed, call one tool at a time. When done, answer directly.",
		},
		{
			"role":    "user",
			"content": fmt.Sprintf("Goal: %s\nCurrent step: %s\nCompleted:\n%s", run.Goal, stepDesc, strings.Join(completed, "\n")),
		},
	}

	for i := 0; i < maxIterations; i++ {
		if run.isCanceled() {
			return "", fmt.Errorf("canceled")
		}

		resp, err := s.callAgentModel(req, messages, req.Tools)
		if err != nil {
			return "", err
		}

		if len(resp.ToolCalls) > 0 {
			tc := resp.ToolCalls[0]
			obs, toolErr := s.executeAgentToolWithRetry(tc.Function.Name, tc.Function.Arguments, req.ExecutionMode)
			if toolErr != nil {
				obs = fmt.Sprintf("tool error: %v", toolErr)
			}

			run.appendEvent("step_observation", map[string]interface{}{
				"stepId":      stepID,
				"toolName":    tc.Function.Name,
				"observation": obs,
			})

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
			continue
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
	id := r.PathValue("id")
	run, ok := s.agentRuns.get(id)
	if !ok {
		writeError(w, 404, "run not found", "not_found")
		return
	}
	writeJSON(w, run.snapshot())
}

func (s *Server) handleAgentRunEvents(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	run, ok := s.agentRuns.get(id)
	if !ok {
		writeError(w, 404, "run not found", "not_found")
		return
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

	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case evt, ok := <-ch:
			if !ok {
				return
			}
			b, _ := json.Marshal(evt)
			fmt.Fprintf(w, "data: %s\n\n", b)
			flusher.Flush()
		case <-run.done:
			return
		case <-heartbeat.C:
			fmt.Fprintf(w, ": heartbeat\n\n")
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

func (s *Server) handleCancelAgentRun(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	run, ok := s.agentRuns.get(id)
	if !ok {
		writeError(w, 404, "run not found", "not_found")
		return
	}

	run.markCanceled()
	s.eng.StopGenerating()
	run.appendEvent("agent_error", map[string]interface{}{"reason": "Canceled by user"})
	writeJSON(w, map[string]interface{}{"ok": true})
}
