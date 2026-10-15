package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	agentExecutionModeOnline  = "online"
	agentExecutionModeOffline = "offline"
	agentToolMaxRetries       = 2
)

var agentToolTimeout = 15 * time.Second

func normalizeAgentExecutionMode(mode string) string {
	if strings.EqualFold(strings.TrimSpace(mode), agentExecutionModeOffline) {
		return agentExecutionModeOffline
	}
	return agentExecutionModeOnline
}

func isNetworkBoundAgentTool(name string) bool {
	switch name {
	case "web-search", "url-fetch", "knowledge-base":
		return true
	default:
		return false
	}
}

func isRetryableAgentToolError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "timeout") || strings.Contains(msg, "network") || strings.Contains(msg, "connection reset") || strings.Contains(msg, "connection refused") {
		return true
	}
	return strings.Contains(msg, "http 5")
}

func (s *Server) executeAgentToolWithRetry(name string, argsJSON string, executionMode string, owners ...string) (string, error) {
	var lastErr error
	for attempt := 1; attempt <= agentToolMaxRetries+1; attempt++ {
		type toolResult struct {
			observation string
			err         error
		}

		resultCh := make(chan toolResult, 1)
		go func() {
			obs, err := s.executeAgentTool(name, argsJSON, executionMode, owners...)
			resultCh <- toolResult{observation: obs, err: err}
		}()

		select {
		case res := <-resultCh:
			if res.err == nil {
				return res.observation, nil
			}
			lastErr = res.err
			if !isRetryableAgentToolError(res.err) || attempt > agentToolMaxRetries {
				return "", res.err
			}
		case <-time.After(agentToolTimeout):
			lastErr = fmt.Errorf("tool %q timed out after %s", name, agentToolTimeout)
			if attempt > agentToolMaxRetries {
				return "", lastErr
			}
		}

		time.Sleep(time.Duration(attempt) * 500 * time.Millisecond)
	}

	if lastErr == nil {
		lastErr = fmt.Errorf("tool execution failed")
	}
	return "", lastErr
}

func canonicalBackendAgentToolName(name string) (string, bool) {
	switch strings.TrimSpace(strings.ToLower(name)) {
	case "web-search", "web.search":
		return "web-search", true
	case "url-fetch", "web.fetch":
		return "url-fetch", true
	case "knowledge-base", "kb", "kb.search", "kb.store", "kb.list", "rag-cloud", "rag-local":
		return "knowledge-base", true
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
	seen := make(map[string]struct{}, len(tools))
	for _, tool := range tools {
		name := strings.TrimSpace(tool.Function.Name)
		if name == "" {
			dropped = append(dropped, "")
			continue
		}
		canonical, ok := canonicalBackendAgentToolName(tool.Function.Name)
		if ok {
			tool.Function.Name = canonical
		}
		if _, exists := seen[tool.Function.Name]; exists {
			continue
		}
		seen[tool.Function.Name] = struct{}{}
		filtered = append(filtered, tool)
	}

	return filtered, dropped
}

func (s *Server) handleAgentChat(w http.ResponseWriter, r *http.Request) {
	owner := s.requireOwner(w, r)
	if owner == "" {
		return
	}
	var req struct {
		Provider      *agentProviderConfig     `json:"provider"`
		ModelName     string                   `json:"modelName"`
		Messages      []map[string]interface{} `json:"messages"`
		Tools         []agentToolDef           `json:"tools"`
		MaxIterations int                      `json:"maxIterations"`
		ExecutionMode string                   `json:"executionMode"`
	}

	if err := decodeSecurityJSON(r, &req); err != nil {
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

	provider, err := s.resolveAgentProvider(r, req.Provider)
	if err != nil {
		writeError(w, 400, "stored provider ID required", "invalid_request")
		return
	}
	req.Provider = provider
	req.ExecutionMode = normalizeAgentExecutionMode(req.ExecutionMode)
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
	if maxIterations > 100 {
		writeError(w, 400, "maxIterations cannot exceed 100", "invalid_request")
		return
	}

	messages := append([]map[string]interface{}{}, req.Messages...)
	toolLogs := make([]map[string]interface{}, 0)

	for i := 0; i < maxIterations; i++ {
		chatReq := agentRunCreateReq{
			ModelName:     req.ModelName,
			ExecutionMode: req.ExecutionMode,
			Provider:      req.Provider,
			Tools:         req.Tools,
		}

		result, err := s.callAgentModel(chatReq, messages, req.Tools, owner)
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
		obs, toolErr := s.executeAgentToolWithRetry(tc.Function.Name, tc.Function.Arguments, req.ExecutionMode, owner)
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

func (s *Server) executeAgentTool(name string, argsJSON string, executionMode string, owners ...string) (string, error) {
	originalToolName := strings.TrimSpace(strings.ToLower(name))
	normalizedName := strings.TrimSpace(name)
	if canonicalName, ok := canonicalBackendAgentToolName(name); ok {
		normalizedName = canonicalName
	}

	executionMode = normalizeAgentExecutionMode(executionMode)
	if executionMode == agentExecutionModeOffline && isNetworkBoundAgentTool(normalizedName) {
		return "", fmt.Errorf("tool %q is blocked in offline mode", normalizedName)
	}

	args := map[string]interface{}{}
	if strings.TrimSpace(argsJSON) != "" {
		if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
			return "", fmt.Errorf("invalid tool arguments")
		}
	}

	switch originalToolName {
	case "kb.search", "rag-cloud", "rag-local":
		args["action"] = "search"
	case "kb.store":
		args["action"] = "add"
	case "kb.list":
		args["action"] = "list"
	}

	switch normalizedName {
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
	case "knowledge-base":
		return s.executeKnowledgeBaseTool(args, owners...)
	default:
		return s.executeMcpTool(normalizedName, args, executionMode, owners...)
	}
}

func (s *Server) executeKnowledgeBaseTool(args map[string]interface{}, owners ...string) (string, error) {
	if len(owners) != 1 || owners[0] == "" {
		return "", fmt.Errorf("authenticated knowledge-base owner required")
	}
	owner := owners[0]
	action := strings.ToLower(strings.TrimSpace(toString(args["action"], "search")))
	if action == "" {
		action = "search"
	}

	docs, err := resourceList[localDocument](s, owner, "document")
	if err != nil {
		return "", err
	}

	switch action {
	case "search":
		query := strings.TrimSpace(toString(args["query"], ""))
		if query == "" {
			return "", fmt.Errorf("query is required for knowledge-base search")
		}
		queryLower := strings.ToLower(query)
		results := make([]map[string]interface{}, 0, 12)
		for i := len(docs) - 1; i >= 0; i-- {
			d := docs[i]
			hay := strings.ToLower(d.Title + "\n" + d.Content + "\n" + strings.Join(d.Tags, " "))
			if !strings.Contains(hay, queryLower) {
				continue
			}
			snippet := strings.TrimSpace(d.Content)
			if len(snippet) > 500 {
				snippet = snippet[:500] + "..."
			}
			results = append(results, map[string]interface{}{
				"id":         d.ID,
				"title":      d.Title,
				"snippet":    snippet,
				"tags":       d.Tags,
				"source":     d.Source,
				"created_at": d.CreatedAt,
			})
			if len(results) >= 12 {
				break
			}
		}
		out, _ := json.Marshal(map[string]interface{}{
			"action":      "search",
			"query":       query,
			"resultCount": len(results),
			"results":     results,
		})
		return string(out), nil

	case "add":
		title := strings.TrimSpace(toString(args["title"], "Untitled"))
		content := strings.TrimSpace(toString(args["content"], ""))
		if content == "" {
			return "", fmt.Errorf("content is required to add a knowledge-base document")
		}
		tags := make([]string, 0)
		if arr, ok := args["tags"].([]interface{}); ok {
			for _, raw := range arr {
				tag := strings.TrimSpace(fmt.Sprintf("%v", raw))
				if tag != "" {
					tags = append(tags, tag)
				}
			}
		}
		source := strings.TrimSpace(toString(args["source"], "ai-tool"))
		d := localDocument{
			ID:        newID("doc"),
			Title:     title,
			Content:   content,
			Tags:      tags,
			Source:    source,
			CreatedAt: nowRFC3339(),
		}
		if err := s.putResource(owner, "document", d.ID, d, nil); err != nil {
			return "", fmt.Errorf("failed to save knowledge-base document: %w", err)
		}
		out, _ := json.Marshal(map[string]interface{}{
			"action": "add",
			"saved":  true,
			"id":     d.ID,
			"title":  d.Title,
		})
		return string(out), nil

	case "list":
		items := make([]map[string]interface{}, 0, 50)
		for i := len(docs) - 1; i >= 0; i-- {
			d := docs[i]
			items = append(items, map[string]interface{}{
				"id":         d.ID,
				"title":      d.Title,
				"tags":       d.Tags,
				"source":     d.Source,
				"created_at": d.CreatedAt,
			})
			if len(items) >= 50 {
				break
			}
		}
		out, _ := json.Marshal(map[string]interface{}{
			"action":      "list",
			"resultCount": len(items),
			"results":     items,
		})
		return string(out), nil
	default:
		return "", fmt.Errorf("unknown knowledge-base action: %s", action)
	}
}

func isLocalMcpServerURL(raw string) bool {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		v := strings.ToLower(raw)
		return strings.Contains(v, "localhost") || strings.Contains(v, "127.0.0.1")
	}
	host := strings.ToLower(parsed.Hostname())
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

func (s *Server) loadEnabledMcpServersForMode(executionMode string, owners ...string) []localMcpServer {
	if len(owners) != 1 || owners[0] == "" {
		return nil
	}
	rows, err := resourceList[localMcpServer](s, owners[0], "mcp")
	if err != nil {
		return nil
	}

	filtered := make([]localMcpServer, 0, len(rows))
	for _, row := range rows {
		if !row.Enabled {
			continue
		}
		if executionMode == agentExecutionModeOffline && !isLocalMcpServerURL(row.URL) {
			continue
		}
		owned, err := s.ownedMcp(owners[0], row.ID)
		if err == nil {
			filtered = append(filtered, *owned)
		}
	}
	return filtered
}

func extractMcpErrorMessage(errField interface{}) string {
	switch v := errField.(type) {
	case string:
		return v
	case map[string]interface{}:
		if msg, ok := v["message"].(string); ok {
			return msg
		}
		if b, err := json.Marshal(v); err == nil {
			return string(b)
		}
	}
	return fmt.Sprintf("%v", errField)
}

func (s *Server) mcpJSONRPC(server localMcpServer, method string, params map[string]interface{}) (map[string]interface{}, error) {
	if !validMcpMethod(method, params) {
		return nil, fmt.Errorf("unsupported MCP method or parameters")
	}
	payload := map[string]interface{}{
		"jsonrpc": "2.0",
		"id":      time.Now().UnixNano(),
		"method":  method,
		"params":  params,
	}
	body, _ := json.Marshal(payload)
	httpReq, err := http.NewRequest(http.MethodPost, server.URL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("failed to create MCP request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json, text/event-stream")
	for k, v := range server.Headers {
		switch strings.ToLower(strings.TrimSpace(k)) {
		case "host", "content-length", "transfer-encoding", "connection", "proxy-authorization":
			return nil, fmt.Errorf("restricted MCP header %q", k)
		}
		httpReq.Header.Set(k, v)
	}

	if err := assertPublicURL(server.URL); err != nil {
		return nil, fmt.Errorf("blocked MCP destination: %w", err)
	}
	httpResp, err := outboundHTTPClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("MCP request failed for %s: %w", server.Name, err)
	}
	defer httpResp.Body.Close()
	respBody, err := io.ReadAll(io.LimitReader(httpResp.Body, (4<<20)+1))
	if err != nil || len(respBody) > 4<<20 {
		return nil, fmt.Errorf("invalid or oversized MCP response")
	}
	if httpResp.StatusCode < 200 || httpResp.StatusCode >= 300 {
		return nil, fmt.Errorf("MCP server returned HTTP %d", httpResp.StatusCode)
	}

	var decoded map[string]interface{}
	if err := json.Unmarshal(respBody, &decoded); err != nil {
		return nil, fmt.Errorf("invalid MCP response")
	}
	if errField, ok := decoded["error"]; ok && errField != nil {
		return nil, fmt.Errorf("MCP server %s error: %s", server.Name, extractMcpErrorMessage(errField))
	}
	return decoded, nil
}

func mcpToolExistsInList(payload map[string]interface{}, toolName string) bool {
	if result, ok := payload["result"].(map[string]interface{}); ok {
		if tools, ok := result["tools"].([]interface{}); ok {
			for _, raw := range tools {
				if item, ok := raw.(map[string]interface{}); ok {
					if name, _ := item["name"].(string); name == toolName {
						return true
					}
				}
			}
		}
	}
	if tools, ok := payload["tools"].([]interface{}); ok {
		for _, raw := range tools {
			if item, ok := raw.(map[string]interface{}); ok {
				if name, _ := item["name"].(string); name == toolName {
					return true
				}
			}
		}
	}
	return false
}

func (s *Server) executeMcpTool(toolName string, args map[string]interface{}, executionMode string, owners ...string) (string, error) {
	if len(owners) != 1 || owners[0] == "" {
		return "", fmt.Errorf("authenticated MCP owner required")
	}
	servers := s.loadEnabledMcpServersForMode(executionMode, owners...)
	if len(servers) == 0 {
		return "", fmt.Errorf("unsupported backend tool: %s", toolName)
	}

	for _, server := range servers {
		listed, err := s.mcpJSONRPC(server, "tools/list", map[string]interface{}{})
		if err != nil {
			continue
		}
		if !mcpToolExistsInList(listed, toolName) {
			continue
		}

		called, err := s.mcpJSONRPC(server, "tools/call", map[string]interface{}{
			"name":      toolName,
			"arguments": args,
		})
		if err != nil {
			return "", err
		}

		if result, ok := called["result"]; ok {
			b, _ := json.Marshal(result)
			return string(b), nil
		}
		b, _ := json.Marshal(called)
		return string(b), nil
	}

	return "", fmt.Errorf("unsupported backend tool: %s", toolName)
}
