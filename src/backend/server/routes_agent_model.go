package server

import (
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

func (s *Server) callAgentModel(req agentRunCreateReq, messages []map[string]interface{}, tools []agentToolDef) (*agentChatResponse, error) {
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
	if isLocalProvider(req.Provider.BaseURL) {
		resp, err := s.eng.ChatCompletion(payload)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		respBody, _ = io.ReadAll(resp.Body)
	} else {
		url := buildProviderChatCompletionsURL(req.Provider.BaseURL)
		httpReq, _ := http.NewRequest("POST", url, strings.NewReader(string(payload)))
		httpReq.Header.Set("Content-Type", "application/json")
		if req.Provider.APIKey != "" {
			httpReq.Header.Set("Authorization", "Bearer "+req.Provider.APIKey)
		}
		if strings.Contains(req.Provider.BaseURL, "openrouter.ai") {
			httpReq.Header.Set("HTTP-Referer", "http://localhost")
			httpReq.Header.Set("X-Title", "AI Server Studio")
		}
		httpResp, err := http.DefaultClient.Do(httpReq)
		if err != nil {
			return nil, err
		}
		defer httpResp.Body.Close()
		respBody, _ = io.ReadAll(httpResp.Body)
		if httpResp.StatusCode >= 400 {
			errPreview := previewTextForLog(string(respBody), 1200)
			return nil, fmt.Errorf("provider API error %d at %s: %s", httpResp.StatusCode, url, errPreview)
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
