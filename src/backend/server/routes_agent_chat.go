package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

func canonicalBackendAgentToolName(name string) (string, bool) {
	switch strings.TrimSpace(strings.ToLower(name)) {
	case "web-search", "web.search":
		return "web-search", true
	case "url-fetch", "web.fetch":
		return "url-fetch", true
	default:
		return "", false
	}
}

func filterBackendAgentTools(tools []agentToolDef) ([]agentToolDef, []string) {
	if len(tools) == 0 {
		return nil, nil
	}

	filtered := make([]agentToolDef, 0, len(tools))
	dropped := make([]string, 0)
	for _, tool := range tools {
		canonical, ok := canonicalBackendAgentToolName(tool.Function.Name)
		if !ok {
			dropped = append(dropped, tool.Function.Name)
			continue
		}
		tool.Function.Name = canonical
		filtered = append(filtered, tool)
	}

	return filtered, dropped
}

func (s *Server) handleAgentChat(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Provider      *agentProviderConfig   `json:"provider"`
		ModelName     string                 `json:"modelName"`
		Messages      []map[string]interface{} `json:"messages"`
		Tools         []agentToolDef         `json:"tools"`
		MaxIterations int                    `json:"maxIterations"`
	}

	if err := jsonDecode(r, &req); err != nil {
		writeError(w, 400, "invalid JSON", "invalid_request")
		return
	}
	if req.ModelName == "" {
		writeError(w, 400, "modelName is required", "invalid_request")
		return
	}
	if len(req.Messages) == 0 {
		writeError(w, 400, "messages are required", "invalid_request")
		return
	}

	if req.Provider == nil || req.Provider.BaseURL == "" {
		req.Provider = &agentProviderConfig{ID: "local", Name: "Local Server", BaseURL: "http://localhost/v1"}
	}
	filteredTools, droppedTools := filterBackendAgentTools(req.Tools)
	req.Tools = filteredTools
	if len(droppedTools) > 0 {
		fmt.Printf("[Agent Chat] dropping unsupported backend tools: %s\n", strings.Join(droppedTools, ", "))
	}

	if isLocalProvider(req.Provider.BaseURL) && !s.eng.IsModelLoaded() {
		writeError(w, 503, "No model loaded", "engine_error")
		return
	}

	maxIterations := req.MaxIterations
	if maxIterations <= 0 {
		maxIterations = 8
	}

	messages := append([]map[string]interface{}{}, req.Messages...)
	toolLogs := make([]map[string]interface{}, 0)

	for i := 0; i < maxIterations; i++ {
		chatReq := agentRunCreateReq{
			ModelName: req.ModelName,
			Provider:  req.Provider,
			Tools:     req.Tools,
		}

		result, err := s.callAgentModel(chatReq, messages, req.Tools)
		if err != nil {
			writeError(w, 500, err.Error(), "agent_error")
			return
		}

		if len(result.ToolCalls) == 0 {
			writeJSON(w, map[string]interface{}{
				"content":   strings.TrimSpace(result.Content),
				"toolCalls": toolLogs,
			})
			return
		}

		tc := result.ToolCalls[0]
		start := time.Now()
		obs, toolErr := s.executeAgentTool(tc.Function.Name, tc.Function.Arguments)
		dur := time.Since(start).Milliseconds()

		entry := map[string]interface{}{
			"id":       tc.ID,
			"name":     tc.Function.Name,
			"args":     tc.Function.Arguments,
			"status":   "done",
			"result":   obs,
			"duration": dur,
		}
		if toolErr != nil {
			entry["status"] = "error"
			entry["error"] = toolErr.Error()
			obs = fmt.Sprintf("tool error: %v", toolErr)
		}
		toolLogs = append(toolLogs, entry)

		messages = append(messages,
			map[string]interface{}{
				"role":    "assistant",
				"content": result.Content,
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
	}

	writeJSON(w, map[string]interface{}{
		"content":   "",
		"toolCalls": toolLogs,
		"error":     "iteration limit reached",
	})
}

func (s *Server) executeAgentTool(name string, argsJSON string) (string, error) {
	canonicalName, ok := canonicalBackendAgentToolName(name)
	if !ok {
		return "", fmt.Errorf("unsupported backend tool: %s", strings.TrimSpace(name))
	}

	args := map[string]interface{}{}
	if strings.TrimSpace(argsJSON) != "" {
		_ = json.Unmarshal([]byte(argsJSON), &args)
	}

	switch canonicalName {
	case "web-search":
		query, _ := args["query"].(string)
		if query == "" {
			return "", fmt.Errorf("query is required")
		}
		res, err := webSearch(query)
		if err != nil {
			return "", err
		}
		b, _ := json.Marshal(res)
		return string(b), nil
	case "url-fetch":
		rawURL, _ := args["url"].(string)
		if rawURL == "" {
			return "", fmt.Errorf("url is required")
		}
		if err := assertPublicURL(rawURL); err != nil {
			return "", err
		}
		res, err := urlFetch(rawURL)
		if err != nil {
			return "", err
		}
		b, _ := json.Marshal(res)
		return string(b), nil
	default:
		return "", fmt.Errorf("unsupported backend tool: %s", canonicalName)
	}
}
