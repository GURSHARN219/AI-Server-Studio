package server

import (
	"encoding/json"
	"net/url"
	"strings"
)

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
	Goal              string                 `json:"goal"`
	ModelName         string                 `json:"modelName"`
	SessionID         string                 `json:"sessionId,omitempty"`
	ExecutionMetadata map[string]interface{} `json:"executionMetadata,omitempty"`
	MaxSteps          int                    `json:"maxSteps"`
	MaxIterations     int                    `json:"maxIterations"`
	ExecutionMode     string                 `json:"executionMode"`
	Provider          *agentProviderConfig   `json:"provider"`
	Tools             []agentToolDef         `json:"tools"`
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
