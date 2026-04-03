package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"ai-server-studio-backend/engine"
)

// Server is the OpenAI-compatible HTTP server
type Server struct {
	eng     engine.EngineInterface
	port    int
	mux     *http.ServeMux
	dlMgr   *engine.DownloadManager
	agentRuns *agentRunStore
	baseDir string
}

// New creates a new server instance
func New(eng engine.EngineInterface, port int) *Server {
	return NewWithBaseDir(eng, port, "")
}

// NewWithBaseDir creates a new server instance with a known base directory for embedded Python.
func NewWithBaseDir(eng engine.EngineInterface, port int, baseDir string) *Server {
	s := &Server{
		eng:     eng,
		port:    port,
		mux:     http.NewServeMux(),
		dlMgr:   engine.NewDownloadManager(),
		agentRuns: newAgentRunStore(),
		baseDir: baseDir,
	}
	s.registerRoutes()
	// Best-effort: keep auth sessions across restarts.
	s.loadAuthSessionsFromDisk()
	return s
}

// Start begins listening on the configured port
func (s *Server) Start() error {
	addr := fmt.Sprintf(":%d", s.port)
	return http.ListenAndServe(addr, corsMiddleware(s.mux))
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == "OPTIONS" {
			w.WriteHeader(204)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ── Helpers ──────────────────────────────────────────────────────────────

func jsonDecode(r *http.Request, v interface{}) error {
	return json.NewDecoder(r.Body).Decode(v)
}

func writeJSON(w http.ResponseWriter, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, message, errType string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"error": map[string]string{
			"message": message,
			"type":    errType,
		},
	})
}

// loggingResponseWriter wraps http.ResponseWriter to capture SSE delta tokens
type loggingResponseWriter struct {
	http.ResponseWriter
	output string
}

func (lw *loggingResponseWriter) Write(p []byte) (int, error) {
	text := string(p)
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := line[6:]
		if data == "[DONE]" {
			continue
		}
		var chunk map[string]interface{}
		if json.Unmarshal([]byte(data), &chunk) != nil {
			continue
		}
		choices, _ := chunk["choices"].([]interface{})
		if len(choices) == 0 {
			continue
		}
		choice, _ := choices[0].(map[string]interface{})
		delta, _ := choice["delta"].(map[string]interface{})
		if content, ok := delta["content"].(string); ok {
			lw.output += content
		}
	}
	return lw.ResponseWriter.Write(p)
}

func (lw *loggingResponseWriter) Flush() {
	if f, ok := lw.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}
