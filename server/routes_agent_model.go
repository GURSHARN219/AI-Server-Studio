package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

func buildProviderChatCompletionsURL(baseURL string) string {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	lower := strings.ToLower(base)
	if strings.HasSuffix(lower, "/chat/completions") {
		return base
	}
	return base + "/chat/completions"
}

func (s *Server) resolveAgentProvider(r *http.Request, input *agentProviderConfig) (*agentProviderConfig, error) {
	if input == nil || input.ID == "local" || input.ID == "" {
		if input != nil && (input.BaseURL != "" || input.APIKey != "") && input.ID != "local" {
			return nil, fmt.Errorf("stored provider ID required")
		}
		return &agentProviderConfig{ID: "local", Name: "Local Server", BaseURL: "http://localhost/v1"}, nil
	}
	p, err := s.requireProvider(r, input.ID)
	if err != nil {
		return nil, fmt.Errorf("owned enabled provider required")
	}
	return &agentProviderConfig{ID: p.ID, Name: p.Name, BaseURL: p.BaseURL}, nil
}
func (s *Server) callAgentModel(req agentRunCreateReq, messages []map[string]interface{}, tools []agentToolDef, owners ...string) (*agentChatResponse, error) {
	var provider *providerRecord
	if req.Provider == nil || req.Provider.ID == "local" {
		req.Provider = &agentProviderConfig{ID: "local", BaseURL: "http://localhost/v1"}
	} else {
		if len(owners) != 1 || owners[0] == "" {
			return nil, fmt.Errorf("authenticated provider owner required")
		}
		var err error
		provider, err = s.findProviderByID(owners[0], req.Provider.ID)
		if err != nil || !provider.Enabled {
			return nil, fmt.Errorf("owned enabled provider required")
		}
		if err = assertPublicURL(provider.BaseURL); err != nil {
			return nil, err
		}
		req.Provider = &agentProviderConfig{ID: provider.ID, Name: provider.Name, BaseURL: provider.BaseURL}
	}
	body := map[string]interface{}{
		"model":       req.ModelName,
		"messages":    messages,
		"stream":      false,
		"temperature": 0.4,
		"max_tokens":  1024,
	}
	if len(tools) > 0 {
		body["tools"] = tools
		body["tool_choice"] = "auto"
		body["parallel_tool_calls"] = false
	}

	payload, _ := json.Marshal(body)

	var respBody []byte
	if req.Provider.ID == "local" {
		resp, err := s.eng.ChatCompletion(payload)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		respBody, _ = io.ReadAll(resp.Body)
	} else {
		url := buildProviderChatCompletionsURL(req.Provider.BaseURL)
		httpReq, _ := http.NewRequestWithContext(context.Background(), "POST", url, strings.NewReader(string(payload)))
		httpReq.Header.Set("Content-Type", "application/json")
		if provider.APIKey != "" {
			httpReq.Header.Set("Authorization", "Bearer "+provider.APIKey)
		}
		if strings.Contains(req.Provider.BaseURL, "openrouter.ai") {
			httpReq.Header.Set("HTTP-Referer", "http://localhost")
			httpReq.Header.Set("X-Title", "AI Server Studio")
		}
		httpResp, err := outboundHTTPClient.Do(httpReq)
		if err != nil {
			return nil, err
		}
		defer httpResp.Body.Close()
		respBody, _ = io.ReadAll(httpResp.Body)
		if httpResp.StatusCode >= 400 {
			return nil, fmt.Errorf("provider API error %d", httpResp.StatusCode)
		}
	}

	parsed := &agentChatResponse{}
	var payloadResp map[string]interface{}
	if json.Unmarshal(respBody, &payloadResp) != nil {
		parsed.Content = string(respBody)
		return parsed, nil
	}

	choices, _ := payloadResp["choices"].([]interface{})
	if len(choices) == 0 {
		return parsed, nil
	}
	choice, _ := choices[0].(map[string]interface{})
	msg, _ := choice["message"].(map[string]interface{})
	content, _ := extractMessageContentAndThinking(msg)
	parsed.Content = content

	rawToolCalls, _ := msg["tool_calls"].([]interface{})
	for _, raw := range rawToolCalls {
		m, ok := raw.(map[string]interface{})
		if !ok {
			continue
		}
		var tc agentChatToolCall
		tc.ID, _ = m["id"].(string)
		fn, _ := m["function"].(map[string]interface{})
		tc.Function.Name, _ = fn["name"].(string)
		if argText, ok := fn["arguments"].(string); ok {
			tc.Function.Arguments = argText
		} else if fn["arguments"] != nil {
			argJSON, _ := json.Marshal(fn["arguments"])
			tc.Function.Arguments = string(argJSON)
		}
		if tc.Function.Name != "" {
			parsed.ToolCalls = append(parsed.ToolCalls, tc)
		}
	}

	return parsed, nil
}
