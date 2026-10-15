package server

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"slices"
	"strings"
	"time"
)

type providerRecord struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	ProviderType string `json:"provider_type"`
	BaseURL      string `json:"base_url"`
	APIKey       string `json:"api_key"`
	HasKey       bool   `json:"has_key"`
	Enabled      bool   `json:"enabled"`
	CreatedAt    string `json:"created_at"`
}

func (s *Server) registerProviderRoutes() {
	s.mux.HandleFunc("GET /v1/providers", s.handleListProviders)
	s.mux.HandleFunc("POST /v1/providers", s.handleCreateProvider)
	s.mux.HandleFunc("PATCH /v1/providers/{id}", s.handleUpdateProvider)
	s.mux.HandleFunc("DELETE /v1/providers/{id}", s.handleDeleteProvider)

	s.mux.HandleFunc("GET /v1/providers/{id}/models", s.handleProviderModels)
	s.mux.HandleFunc("POST /v1/providers/chat/completions", s.handleProviderChatCompletions)
	s.mux.HandleFunc("POST /v1/providers/images/generations", s.handleProviderImageGenerations)
	s.mux.HandleFunc("POST /v1/providers/audio/transcriptions", s.handleProviderTranscriptions)
	s.mux.HandleFunc("POST /v1/providers/audio/speech", s.handleProviderSpeech)
}

func (s *Server) loadProviders(owner string) ([]providerRecord, error) {
	return resourceList[providerRecord](s, owner, "provider")
}
func (s *Server) saveProvider(owner string, row providerRecord) error {
	secret, err := s.protect(owner, "provider:"+row.ID, []byte(row.APIKey))
	if err != nil {
		return err
	}
	row.HasKey = row.APIKey != ""
	row.APIKey = ""
	return s.putResource(owner, "provider", row.ID, row, secret)
}

func newProviderID() string {
	return newID("prov")
}

func (s *Server) findProviderByID(owner, id string) (*providerRecord, error) {
	var row providerRecord
	secret, err := s.getResource(owner, "provider", id, &row)
	if err != nil {
		return nil, err
	}
	key, err := s.unprotect(owner, "provider:"+id, secret)
	if err != nil {
		return nil, err
	}
	row.APIKey = string(key)
	return &row, nil
}

func (s *Server) handleListProviders(w http.ResponseWriter, r *http.Request) {
	owner := s.requireOwner(w, r)
	if owner == "" {
		return
	}
	rows, err := s.loadProviders(owner)
	if err != nil {
		writeError(w, 500, "failed to load providers", "internal_error")
		return
	}
	writeJSON(w, map[string]any{"data": rows})
}

func (s *Server) handleCreateProvider(w http.ResponseWriter, r *http.Request) {
	owner := s.requireOwner(w, r)
	if owner == "" {
		return
	}
	var req struct {
		Name         string `json:"name"`
		ProviderType string `json:"provider_type"`
		BaseURL      string `json:"base_url"`
		APIKey       string `json:"api_key"`
		Enabled      *bool  `json:"enabled"`
	}
	if err := decodeSecurityJSON(r, &req); err != nil {
		writeError(w, 400, "invalid JSON: "+err.Error(), "invalid_request")
		return
	}
	if strings.TrimSpace(req.Name) == "" || assertPublicURL(req.BaseURL) != nil || len(req.APIKey) > 8192 || strings.ContainsAny(req.APIKey, "\r\n") {
		writeError(w, 400, "name and base_url are required", "invalid_request")
		return
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}
	created := providerRecord{
		ID:           newProviderID(),
		Name:         strings.TrimSpace(req.Name),
		ProviderType: strings.TrimSpace(req.ProviderType),
		BaseURL:      strings.TrimSpace(req.BaseURL),
		APIKey:       strings.TrimSpace(req.APIKey),
		Enabled:      enabled,
		CreatedAt:    time.Now().UTC().Format(time.RFC3339),
	}
	if err := s.saveProvider(owner, created); err != nil {
		writeError(w, 500, "failed to save providers", "internal_error")
		return
	}
	created.HasKey = created.APIKey != ""
	created.APIKey = ""
	writeJSON(w, map[string]any{"data": created})
}

func (s *Server) handleUpdateProvider(w http.ResponseWriter, r *http.Request) {
	owner := s.requireOwner(w, r)
	if owner == "" {
		return
	}
	id := r.PathValue("id")
	if id == "" {
		writeError(w, 400, "provider id required", "invalid_request")
		return
	}

	var req struct {
		Name         *string `json:"name"`
		ProviderType *string `json:"provider_type"`
		BaseURL      *string `json:"base_url"`
		APIKey       *string `json:"api_key"`
		Enabled      *bool   `json:"enabled"`
	}
	if err := decodeSecurityJSON(r, &req); err != nil {
		writeError(w, 400, "invalid JSON: "+err.Error(), "invalid_request")
		return
	}

	row, err := s.findProviderByID(owner, id)
	if err != nil {
		resourceError(w, err)
		return
	}
	rows := []providerRecord{*row}

	updated := false
	var out providerRecord
	for i := range rows {
		if rows[i].ID != id {
			continue
		}
		if req.Name != nil {
			rows[i].Name = strings.TrimSpace(*req.Name)
		}
		if req.ProviderType != nil {
			rows[i].ProviderType = strings.TrimSpace(*req.ProviderType)
		}
		if req.BaseURL != nil {
			rows[i].BaseURL = strings.TrimSpace(*req.BaseURL)
		}
		if req.APIKey != nil {
			rows[i].APIKey = strings.TrimSpace(*req.APIKey)
		}
		if req.Enabled != nil {
			rows[i].Enabled = *req.Enabled
		}
		updated = true
		out = rows[i]
		break
	}
	if !updated {
		writeError(w, 404, "provider not found", "not_found")
		return
	}

	if out.Name == "" || assertPublicURL(out.BaseURL) != nil || len(out.APIKey) > 8192 || strings.ContainsAny(out.APIKey, "\r\n") {
		writeError(w, 400, "invalid provider configuration", "invalid_request")
		return
	}
	if err := s.saveProvider(owner, out); err != nil {
		writeError(w, 500, "failed to save providers", "internal_error")
		return
	}
	out.HasKey = out.APIKey != ""
	out.APIKey = ""
	writeJSON(w, map[string]any{"data": out})
}

func (s *Server) handleDeleteProvider(w http.ResponseWriter, r *http.Request) {
	owner := s.requireOwner(w, r)
	if owner == "" {
		return
	}
	id := r.PathValue("id")
	if id == "" {
		writeError(w, 400, "provider id required", "invalid_request")
		return
	}

	if err := s.deleteResource(owner, "provider", id); err != nil {
		resourceError(w, err)
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

func (s *Server) requireProvider(r *http.Request, id string) (*providerRecord, error) {
	u, err := s.currentUserFromRequest(r)
	if err != nil {
		return nil, err
	}
	if u == nil {
		return nil, sql.ErrNoRows
	}
	row, err := s.findProviderByID(u.ID, id)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, fmt.Errorf("provider not found")
	}
	if !row.Enabled {
		return nil, fmt.Errorf("provider disabled")
	}
	if strings.TrimSpace(row.BaseURL) == "" {
		return nil, fmt.Errorf("provider base URL missing")
	}
	if err := assertPublicURL(row.BaseURL); err != nil {
		return nil, err
	}
	return row, nil
}

func buildProviderAuthHeaders(p *providerRecord, withJSON bool) http.Header {
	h := make(http.Header)
	if withJSON {
		h.Set("Content-Type", "application/json")
	}
	if strings.TrimSpace(p.APIKey) != "" {
		h.Set("Authorization", "Bearer "+strings.TrimSpace(p.APIKey))
	}
	if strings.Contains(strings.ToLower(p.BaseURL), "openrouter.ai") {
		h.Set("HTTP-Referer", "http://localhost")
		h.Set("X-Title", "AI Server Studio")
	}
	return h
}

func shouldEnableReasoningHints(p *providerRecord, model string) bool {
	base := strings.ToLower(strings.TrimSpace(p.BaseURL))
	providerType := strings.ToLower(strings.TrimSpace(p.ProviderType))
	isOpenRouter := strings.Contains(base, "openrouter.ai") || strings.Contains(providerType, "openrouter")
	if !isOpenRouter {
		return false
	}

	m := strings.ToLower(strings.TrimSpace(model))
	if m == "" {
		return false
	}

	return strings.Contains(m, "reason") ||
		strings.Contains(m, "thinking") ||
		strings.Contains(m, "qwq") ||
		strings.Contains(m, "deepseek-r") ||
		strings.Contains(m, "qwen3")
}

func appendText(builder *strings.Builder, text string) {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return
	}
	if builder.Len() > 0 {
		builder.WriteString("\n")
	}
	builder.WriteString(trimmed)
}

func extractTextValue(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case []any:
		var out strings.Builder
		for _, item := range v {
			appendText(&out, extractTextValue(item))
		}
		return out.String()
	case map[string]any:
		if text, ok := v["text"]; ok {
			if s := extractTextValue(text); s != "" {
				return s
			}
		}
		if content, ok := v["content"]; ok {
			if s := extractTextValue(content); s != "" {
				return s
			}
		}
		if valueField, ok := v["value"]; ok {
			if s := extractTextValue(valueField); s != "" {
				return s
			}
		}
		if reasoning, ok := v["reasoning"]; ok {
			if s := extractTextValue(reasoning); s != "" {
				return s
			}
		}
		if reasoningContent, ok := v["reasoning_content"]; ok {
			if s := extractTextValue(reasoningContent); s != "" {
				return s
			}
		}
	}
	return ""
}

func extractMessageContentAndThinking(msg map[string]any) (string, string) {
	var contentOut strings.Builder
	var thinkingOut strings.Builder

	if rawContent, ok := msg["content"]; ok {
		switch content := rawContent.(type) {
		case string:
			appendText(&contentOut, content)
		case []any:
			for _, block := range content {
				blockMap, ok := block.(map[string]any)
				if !ok {
					appendText(&contentOut, extractTextValue(block))
					continue
				}

				blockType, _ := blockMap["type"].(string)
				text := extractTextValue(blockMap)
				if strings.Contains(strings.ToLower(blockType), "reason") || strings.Contains(strings.ToLower(blockType), "think") {
					appendText(&thinkingOut, text)
				} else {
					appendText(&contentOut, text)
				}
			}
		default:
			appendText(&contentOut, extractTextValue(content))
		}
	}

	for _, key := range []string{"reasoning_content", "reasoning", "thinking"} {
		if val, ok := msg[key]; ok {
			appendText(&thinkingOut, extractTextValue(val))
		}
	}

	return contentOut.String(), thinkingOut.String()
}

func extractProviderChatContent(decoded map[string]any) (string, string) {
	choices, _ := decoded["choices"].([]any)
	if len(choices) == 0 {
		return "", ""
	}

	choice, ok := choices[0].(map[string]any)
	if !ok {
		return "", ""
	}

	var contentOut strings.Builder
	var thinkingOut strings.Builder

	if msg, ok := choice["message"].(map[string]any); ok {
		content, thinking := extractMessageContentAndThinking(msg)
		appendText(&contentOut, content)
		appendText(&thinkingOut, thinking)
	}

	for _, key := range []string{"reasoning_content", "reasoning", "thinking"} {
		if val, ok := choice[key]; ok {
			appendText(&thinkingOut, extractTextValue(val))
		}
	}

	if contentOut.Len() == 0 {
		appendText(&contentOut, extractTextValue(choice["text"]))
	}

	return contentOut.String(), thinkingOut.String()
}

func previewTextForLog(text string, max int) string {
	if max <= 0 {
		max = 400
	}
	s := strings.ReplaceAll(text, "\r", "")
	s = strings.ReplaceAll(s, "\n", "\\n")
	s = strings.TrimSpace(s)
	if len(s) <= max {
		return s
	}
	return s[:max] + "..."
}

func (s *Server) handleProviderModels(w http.ResponseWriter, r *http.Request) {
	providerID := r.PathValue("id")
	provider, err := s.requireProvider(r, providerID)
	if err != nil {
		writeError(w, 400, err.Error(), "invalid_request")
		return
	}

	url := strings.TrimRight(provider.BaseURL, "/") + "/models"
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, url, nil)
	if err != nil {
		writeError(w, 500, "failed to create request", "internal_error")
		return
	}
	req.Header = buildProviderAuthHeaders(provider, false)

	resp, err := outboundHTTPClient.Do(req)
	if err != nil {
		writeError(w, 502, "provider request failed: "+err.Error(), "upstream_error")
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		writeError(w, 502, "provider returned an error", "upstream_error")
		return
	}

	var decoded map[string]any
	if err := json.Unmarshal(body, &decoded); err != nil {
		writeError(w, 502, "invalid provider response", "upstream_error")
		return
	}
	data, _ := decoded["data"].([]any)
	if data == nil {
		if arr, ok := decoded["models"].([]any); ok {
			data = arr
		}
	}
	writeJSON(w, map[string]any{"data": data})
}

func (s *Server) handleProviderChatCompletions(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ProviderID        string   `json:"providerId"`
		Model             string   `json:"model"`
		Messages          any      `json:"messages"`
		Temperature       *float64 `json:"temperature"`
		MaxTokens         *int     `json:"max_tokens"`
		TopP              *float64 `json:"top_p"`
		Tools             any      `json:"tools"`
		ToolChoice        any      `json:"tool_choice"`
		ParallelToolCalls *bool    `json:"parallel_tool_calls"`
		Stream            bool     `json:"stream"`
		FrequencyPenalty  *float64 `json:"frequency_penalty"`
		PresencePenalty   *float64 `json:"presence_penalty"`
		Seed              *int     `json:"seed"`
		Stop              any      `json:"stop"`
		ResponseFormat    any      `json:"response_format"`
	}
	if err := decodeSecurityJSON(r, &req); err != nil {
		writeError(w, 400, "invalid JSON: "+err.Error(), "invalid_request")
		return
	}
	provider, err := s.requireProvider(r, req.ProviderID)
	if err != nil {
		writeError(w, 400, err.Error(), "invalid_request")
		return
	}

	payload := map[string]any{
		"model":    req.Model,
		"messages": req.Messages,
		"stream":   req.Stream,
	}
	if shouldEnableReasoningHints(provider, req.Model) {
		payload["include_reasoning"] = true
		payload["reasoning"] = map[string]any{"enabled": true}
		payload["chat_template_kwargs"] = map[string]any{"enable_thinking": true}
	}
	if req.Temperature != nil {
		payload["temperature"] = *req.Temperature
	}
	if req.MaxTokens != nil {
		payload["max_tokens"] = *req.MaxTokens
	}
	if req.TopP != nil {
		payload["top_p"] = *req.TopP
	}
	if req.Tools != nil {
		payload["tools"] = req.Tools
	}
	if req.ToolChoice != nil {
		payload["tool_choice"] = req.ToolChoice
	}
	if req.ParallelToolCalls != nil {
		payload["parallel_tool_calls"] = *req.ParallelToolCalls
	}
	if req.FrequencyPenalty != nil {
		payload["frequency_penalty"] = *req.FrequencyPenalty
	}
	if req.PresencePenalty != nil {
		payload["presence_penalty"] = *req.PresencePenalty
	}
	if req.Seed != nil {
		payload["seed"] = *req.Seed
	}
	if req.Stop != nil {
		payload["stop"] = req.Stop
	}
	if req.ResponseFormat != nil {
		payload["response_format"] = req.ResponseFormat
	}
	body, _ := json.Marshal(payload)

	url := strings.TrimRight(provider.BaseURL, "/") + "/chat/completions"
	httpReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		writeError(w, 500, "failed to create request", "internal_error")
		return
	}
	httpReq.Header = buildProviderAuthHeaders(provider, true)

	resp, err := outboundHTTPClient.Do(httpReq)
	if err != nil {
		writeError(w, 502, "provider request failed: "+err.Error(), "upstream_error")
		return
	}
	defer resp.Body.Close()
	if req.Stream && resp.StatusCode >= 200 && resp.StatusCode < 300 {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		buf := make([]byte, 8192)
		for {
			n, e := resp.Body.Read(buf)
			if n > 0 {
				if _, err := w.Write(buf[:n]); err != nil {
					return
				}
				if f, ok := w.(http.Flusher); ok {
					f.Flush()
				}
			}
			if e != nil {
				return
			}
		}
	}
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		writeError(w, 502, "provider returned an error", "upstream_error")
		return
	}

	var decoded map[string]any
	if err := json.Unmarshal(respBody, &decoded); err != nil {
		writeError(w, 502, "invalid provider response", "upstream_error")
		return
	}
	content, thinking := extractProviderChatContent(decoded)
	writeJSON(w, map[string]any{"content": content, "thinking": thinking, "raw": decoded})
}

func (s *Server) handleProviderImageGenerations(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ProviderID string `json:"providerId"`
		Model      string `json:"model"`
		Prompt     string `json:"prompt"`
		Size       string `json:"size"`
	}
	if err := decodeSecurityJSON(r, &req); err != nil {
		writeError(w, 400, "invalid JSON: "+err.Error(), "invalid_request")
		return
	}
	provider, err := s.requireProvider(r, req.ProviderID)
	if err != nil {
		writeError(w, 400, err.Error(), "invalid_request")
		return
	}

	size := req.Size
	if strings.TrimSpace(size) == "" {
		size = "1024x1024"
	}
	payload := map[string]any{
		"model":           req.Model,
		"prompt":          req.Prompt,
		"n":               1,
		"size":            size,
		"response_format": "url",
	}
	body, _ := json.Marshal(payload)

	base := strings.TrimRight(provider.BaseURL, "/")
	base = strings.TrimSuffix(base, "/v1")
	url := base + "/v1/images/generations"
	httpReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		writeError(w, 500, "failed to create request", "internal_error")
		return
	}
	httpReq.Header = buildProviderAuthHeaders(provider, true)

	resp, err := outboundHTTPClient.Do(httpReq)
	if err != nil {
		writeError(w, 502, "provider request failed: "+err.Error(), "upstream_error")
		return
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		writeError(w, 502, "provider returned an error", "upstream_error")
		return
	}

	var decoded map[string]any
	if err := json.Unmarshal(respBody, &decoded); err != nil {
		writeError(w, 502, "invalid provider response", "upstream_error")
		return
	}
	writeJSON(w, decoded)
}

func (s *Server) handleProviderTranscriptions(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(64 << 20); err != nil {
		writeError(w, 400, "invalid multipart form: "+err.Error(), "invalid_request")
		return
	}
	providerID := r.FormValue("providerId")
	provider, err := s.requireProvider(r, providerID)
	if err != nil {
		writeError(w, 400, err.Error(), "invalid_request")
		return
	}

	model := strings.TrimSpace(r.FormValue("model"))
	if model == "" {
		writeError(w, 400, "model is required", "invalid_request")
		return
	}

	file, fileHeader, err := r.FormFile("file")
	if err != nil {
		writeError(w, 400, "audio file is required", "invalid_request")
		return
	}
	defer file.Close()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", fileHeader.Filename)
	if err != nil {
		writeError(w, 500, "failed to build multipart form", "internal_error")
		return
	}
	if _, err := io.Copy(part, file); err != nil {
		writeError(w, 500, "failed to read uploaded file", "internal_error")
		return
	}
	_ = writer.WriteField("model", model)
	for _, key := range []string{"language", "translate"} {
		if v := strings.TrimSpace(r.FormValue(key)); v != "" {
			_ = writer.WriteField(key, v)
		}
	}
	_ = writer.Close()

	url := strings.TrimRight(provider.BaseURL, "/") + "/audio/transcriptions"
	httpReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, url, &body)
	if err != nil {
		writeError(w, 500, "failed to create request", "internal_error")
		return
	}
	httpReq.Header = buildProviderAuthHeaders(provider, false)
	httpReq.Header.Set("Content-Type", writer.FormDataContentType())

	resp, err := outboundHTTPClient.Do(httpReq)
	if err != nil {
		writeError(w, 502, "provider request failed: "+err.Error(), "upstream_error")
		return
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		writeError(w, 502, "provider returned an error", "upstream_error")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write(respBody)
}

func (s *Server) handleProviderSpeech(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ProviderID string `json:"providerId"`
		Model      string `json:"model"`
		Voice      string `json:"voice"`
		Input      string `json:"input"`
		Format     string `json:"format"`
	}
	if err := decodeSecurityJSON(r, &req); err != nil {
		writeError(w, 400, "invalid JSON: "+err.Error(), "invalid_request")
		return
	}
	provider, err := s.requireProvider(r, req.ProviderID)
	if err != nil {
		writeError(w, 400, err.Error(), "invalid_request")
		return
	}
	if strings.TrimSpace(req.Model) == "" || strings.TrimSpace(req.Input) == "" {
		writeError(w, 400, "model and input are required", "invalid_request")
		return
	}
	format := req.Format
	if strings.TrimSpace(format) == "" {
		format = "mp3"
	}
	voice := req.Voice
	if strings.TrimSpace(voice) == "" {
		voice = "alloy"
	}

	payload := map[string]any{
		"model":  req.Model,
		"voice":  voice,
		"input":  req.Input,
		"format": format,
	}
	body, _ := json.Marshal(payload)

	url := strings.TrimRight(provider.BaseURL, "/") + "/audio/speech"
	httpReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		writeError(w, 500, "failed to create request", "internal_error")
		return
	}
	httpReq.Header = buildProviderAuthHeaders(provider, true)

	resp, err := outboundHTTPClient.Do(httpReq)
	if err != nil {
		writeError(w, 502, "provider request failed: "+err.Error(), "upstream_error")
		return
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		writeError(w, 502, "provider returned an error", "upstream_error")
		return
	}

	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "audio/mpeg"
	}
	w.Header().Set("Content-Type", contentType)
	w.Write(respBody)
}

func (s *Server) providerIDs(rows []providerRecord) []string {
	out := make([]string, 0, len(rows))
	for _, row := range rows {
		out = append(out, row.ID)
	}
	return out
}

func (s *Server) validProvider(rows []providerRecord, id string) bool {
	return slices.Contains(s.providerIDs(rows), id)
}
