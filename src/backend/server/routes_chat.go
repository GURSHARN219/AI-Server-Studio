package server

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
)

func (s *Server) registerChatRoutes() {
	s.mux.HandleFunc("POST /v1/chat/completions", s.handleChatCompletions)
	s.mux.HandleFunc("POST /v1/chat/stop", s.handleStopGenerating)
}

// POST /v1/chat/completions — OpenAI-compatible, supports streaming
func (s *Server) handleChatCompletions(w http.ResponseWriter, r *http.Request) {
	if !s.eng.IsModelLoaded() {
		writeError(w, 503, "No model loaded", "engine_error")
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, 400, "Failed to read request body", "invalid_request")
		return
	}

	var req map[string]interface{}
	if err := json.Unmarshal(body, &req); err != nil {
		writeError(w, 400, "Invalid JSON", "invalid_request")
		return
	}

	messages, ok := req["messages"]
	if !ok || messages == nil {
		writeError(w, 400, "messages array required", "invalid_request")
		return
	}

	logLastUserMessage(messages)

	isStream, _ := req["stream"].(bool)
	if isStream {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}

		lw := &loggingResponseWriter{ResponseWriter: w}
		if err := s.eng.StreamChatCompletion(body, lw); err != nil {
			errData, _ := json.Marshal(map[string]interface{}{
				"error": map[string]string{"message": err.Error(), "type": "engine_error"},
			})
			fmt.Fprintf(w, "data: %s\n\n", errData)
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
		}
		if lw.output != "" {
			log.Printf("[Chat] Assistant: %s", lw.output)
		}
		return
	}

	resp, err := s.eng.ChatCompletion(body)
	if err != nil {
		writeError(w, 500, err.Error(), "engine_error")
		return
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	logAssistantResponse(respBody)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(respBody)
}

// POST /v1/chat/stop
func (s *Server) handleStopGenerating(w http.ResponseWriter, r *http.Request) {
	s.eng.StopGenerating()
	writeJSON(w, map[string]interface{}{"ok": true})
}

func logLastUserMessage(messages interface{}) {
	msgList, ok := messages.([]interface{})
	if !ok {
		return
	}
	for i := len(msgList) - 1; i >= 0; i-- {
		m, ok := msgList[i].(map[string]interface{})
		if !ok || m["role"] != "user" {
			continue
		}
		content := ""
		switch v := m["content"].(type) {
		case string:
			content = v
		case []interface{}:
			for _, part := range v {
				if p, ok := part.(map[string]interface{}); ok && p["type"] == "text" {
					if t, ok := p["text"].(string); ok {
						content += t
					}
				}
			}
		}
		log.Printf("[Chat] User: %s", content)
		return
	}
}

func logAssistantResponse(body []byte) {
	var respJSON map[string]interface{}
	if json.Unmarshal(body, &respJSON) != nil {
		return
	}
	choices, ok := respJSON["choices"].([]interface{})
	if !ok || len(choices) == 0 {
		return
	}
	choice, _ := choices[0].(map[string]interface{})
	msg, _ := choice["message"].(map[string]interface{})
	if content, ok := msg["content"].(string); ok && content != "" {
		log.Printf("[Chat] Assistant: %s", content)
	}
}
