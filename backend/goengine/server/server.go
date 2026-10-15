package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"ai-server-studio-backend/agentrun"
	"ai-server-studio-backend/engine"
	"ai-server-studio-backend/persistence"
	"ai-server-studio-backend/tools"
	"ai-server-studio-backend/tunnel"
)

// Server is the OpenAI-compatible HTTP server
type Server struct {
	eng          engine.EngineInterface
	port         int
	mux          *http.ServeMux
	dlMgr        *engine.DownloadManager
	agentRuns    *agentRunStore
	agentRunsErr error
	toolRegistry *tools.Registry
	baseDir      string
	db           *sql.DB
	dbErr        error
	httpServer   *http.Server
	publicServer *http.Server
	shutdownOnce sync.Once
	shutdownErr  error
	lifecycleMu  sync.Mutex
	runWG        sync.WaitGroup
	closing      bool
	tunnel       *tunnel.Manager
}

// New creates a new server instance
func New(eng engine.EngineInterface, port int) *Server {
	return NewWithBaseDir(eng, port, "")
}

// NewWithBaseDir creates a new server instance with a known base directory for embedded Python.
func NewWithBaseDir(eng engine.EngineInterface, port int, baseDir string) *Server {
	s := &Server{
		eng:          eng,
		port:         port,
		mux:          http.NewServeMux(),
		dlMgr:        engine.NewDownloadManager(),
		baseDir:      baseDir,
		toolRegistry: tools.DefaultRegistry(),
	}
	dataDir, err := persistence.DataDir()
	if err == nil {
		s.db, err = persistence.Open(filepath.Join(dataDir, "studio.sqlite"))
	}
	s.dbErr = err
	if s.dbErr == nil {
		s.dbErr = s.initLocalSecurity()
	}
	if s.dbErr == nil {
		var repo *agentrun.SQLiteRepository
		repo, err = agentrun.NewSQLiteRepository(s.db)
		if err == nil {
			err = s.importLegacyAgentRuns(repo, dataDir)
		}
		if err == nil {
			s.agentRuns, err = newAgentRunStore(repo)
		}
	} else {
		err = s.dbErr
	}
	s.agentRunsErr = err
	s.registerRoutes()
	return s
}

// Start begins listening on the configured port
func (s *Server) Start() error {
	if s.dbErr != nil {
		return s.dbErr
	}
	if s.agentRunsErr != nil {
		return s.agentRunsErr
	}
	host := strings.TrimSpace(os.Getenv("AI_SERVER_BIND_ADDR"))
	if host == "" {
		host = "127.0.0.1"
	}

	addr := net.JoinHostPort(host, strconv.Itoa(s.port))
	s.lifecycleMu.Lock()
	if s.closing {
		s.lifecycleMu.Unlock()
		return http.ErrServerClosed
	}
	s.httpServer = &http.Server{Addr: addr, Handler: corsMiddleware(s.authMiddleware(s.mux)), ReadHeaderTimeout: 10 * time.Second}
	httpServer := s.httpServer
	publicPort := strings.TrimSpace(os.Getenv("AI_SERVER_PUBLIC_PORT"))
	if publicPort != "" && publicPort != "0" {
		s.tunnel = tunnel.NewFromEnv(publicPort)
		publicAddr := net.JoinHostPort("127.0.0.1", publicPort)
		s.publicServer = &http.Server{Addr: publicAddr, Handler: s.PublicAPIHandler(), ReadHeaderTimeout: 10 * time.Second}
		publicServer := s.publicServer
		go func() {
			if err := publicServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				// The private desktop API remains usable if the optional listener fails.
			}
		}()
		if os.Getenv("AI_SERVER_TUNNEL_ENABLED") == "1" {
			if err := s.tunnel.Start(context.Background()); err != nil {
				// Tunnel failure must not take down the local API.
			}
		}
	}
	s.lifecycleMu.Unlock()
	return httpServer.ListenAndServe()
}

// Shutdown stops accepting work, durably terminates in-flight runs, drains HTTP
// requests/executors within ctx, stops inference, and then closes SQLite.
func (s *Server) Shutdown(ctx context.Context) error {
	s.shutdownOnce.Do(func() {
		s.lifecycleMu.Lock()
		s.closing = true
		httpServer := s.httpServer
		publicServer := s.publicServer
		s.lifecycleMu.Unlock()
		if s.agentRuns != nil {
			s.agentRuns.mu.RLock()
			runs := make([]*agentRun, 0, len(s.agentRuns.runs))
			for _, run := range s.agentRuns.runs {
				runs = append(runs, run)
			}
			s.agentRuns.mu.RUnlock()
			for _, run := range runs {
				if _, err := run.finish(agentrun.StatusError, "Server shut down before run completed", "", 0); err != nil {
					s.shutdownErr = errors.Join(s.shutdownErr, err)
				}
			}
		}
		if s.eng != nil {
			s.eng.StopGenerating()
		}
		if httpServer != nil {
			if err := httpServer.Shutdown(ctx); err != nil {
				s.shutdownErr = errors.Join(s.shutdownErr, err)
				_ = httpServer.Close()
			}
		}
		if publicServer != nil {
			if err := publicServer.Shutdown(ctx); err != nil {
				s.shutdownErr = errors.Join(s.shutdownErr, err)
				_ = publicServer.Close()
			}
		}
		s.stopTunnel()
		if s.eng != nil {
			s.eng.Shutdown()
		}
		drained := make(chan struct{})
		go func() { s.runWG.Wait(); close(drained) }()
		select {
		case <-drained:
		case <-ctx.Done():
			s.shutdownErr = errors.Join(s.shutdownErr, ctx.Err())
		}
		if s.db != nil {
			s.shutdownErr = errors.Join(s.shutdownErr, s.db.Close())
		}
	})
	return s.shutdownErr
}

var outboundHTTPClient = &http.Client{
	Timeout: 30 * time.Second,
	CheckRedirect: func(req *http.Request, _ []*http.Request) error {
		return assertPublicURL(req.URL.String())
	},
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if origin != "" && allowedOrigin(origin) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		if origin != "" && !allowedOrigin(origin) {
			http.Error(w, "origin not allowed", http.StatusForbidden)
			return
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Last-Event-ID")
		if r.Method == "OPTIONS" {
			if origin != "" && !allowedOrigin(origin) {
				http.Error(w, "origin not allowed", http.StatusForbidden)
				return
			}
			w.WriteHeader(204)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func allowedOrigin(origin string) bool {
	for _, allowed := range strings.Split(os.Getenv("AI_SERVER_ALLOWED_ORIGINS"), ",") {
		if strings.TrimSpace(allowed) == origin {
			return true
		}
	}
	return origin == "http://127.0.0.1" ||
		origin == "http://localhost" ||
		strings.HasPrefix(origin, "http://127.0.0.1:") ||
		strings.HasPrefix(origin, "http://localhost:")
}

func (s *Server) authMiddleware(next http.Handler) http.Handler {
	return s.secureAuthMiddleware(next)
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
