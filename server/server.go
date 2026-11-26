package server

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	frontend "ai-server-studio-backend"
	"ai-server-studio-backend/agentrun"
	"ai-server-studio-backend/engine"
	"ai-server-studio-backend/modelregistry"
	"ai-server-studio-backend/persistence"
	"ai-server-studio-backend/portable"
	"ai-server-studio-backend/rag"
	"ai-server-studio-backend/sandbox"
	"ai-server-studio-backend/toolcalls"
	"ai-server-studio-backend/tools"
	"ai-server-studio-backend/tunnel"
	"ai-server-studio-backend/workflow"
)

// Server is the OpenAI-compatible HTTP server
type Server struct {
	eng                 engine.EngineInterface
	port                int
	mux                 *http.ServeMux
	dlMgr               *engine.DownloadManager
	agentRuns           *agentRunStore
	agentRunsErr        error
	workflows           *workflow.SQLiteRepository
	workflowErr         error
	trustedOrchestrator *workflow.TrustedOrchestrator
	workflowRecovery    *workflow.RecoveryService
	toolRegistry        *tools.Registry
	toolCalls           *toolcalls.SQLiteRepository
	sandbox             *sandbox.Executor
	rag                 *rag.Service
	modelRegistry       *modelregistry.Registry
	baseDir             string
	frontendDir         string
	serveFrontend       bool
	embeddedFrontend    fs.FS
	db                  *sql.DB
	dbErr               error
	httpServer          *http.Server
	listener            net.Listener
	ready               chan struct{}
	actualURL           string
	publicServer        *http.Server
	shutdownOnce        sync.Once
	shutdownErr         error
	lifecycleMu         sync.Mutex
	workflowCoordMu     sync.Mutex
	activeWorkflowRuns  map[string]struct{}
	runWG               sync.WaitGroup
	closing             bool
	tunnel              *tunnel.Manager
}

// New creates a new server instance
func New(eng engine.EngineInterface, port int) *Server {
	return NewWithBaseDir(eng, port, "")
}

// NewWithBaseDir creates a new server instance with a known base directory for embedded Python.
func NewWithBaseDir(eng engine.EngineInterface, port int, baseDir string) *Server {
	return NewWithBaseDirAndFrontend(eng, port, baseDir, "")
}

// NewWithBaseDirAndFrontend creates a server with explicit runtime and
// production frontend roots. An empty frontend root uses only the embedded
// bundle; AIST_FRONTEND_DIR is an explicit external override.
func NewWithBaseDirAndFrontend(eng engine.EngineInterface, port int, baseDir, frontendDir string) *Server {
	return NewWithBaseDirAndFrontendMode(eng, port, baseDir, frontendDir, true)
}

// NewWithBaseDirAndFrontendMode creates a server with explicit runtime and
// production frontend roots. When serveFrontend is false, the process remains
// API-only and does not register browser-facing fallback routes.
func NewWithBaseDirAndFrontendMode(eng engine.EngineInterface, port int, baseDir, frontendDir string, serveFrontend bool) *Server {
	if frontendDir == "" {
		frontendDir = strings.TrimSpace(os.Getenv("AIST_FRONTEND_DIR"))
	}
	s := &Server{
		eng:                eng,
		port:               port,
		mux:                http.NewServeMux(),
		dlMgr:              engine.NewDownloadManager(),
		baseDir:            baseDir,
		frontendDir:        frontendDir,
		serveFrontend:      serveFrontend,
		ready:              make(chan struct{}),
		toolRegistry:       tools.DefaultRegistry(),
		sandbox:            sandbox.FromEnvironment(),
		activeWorkflowRuns: make(map[string]struct{}),
	}
	// The production bundle is embedded in the root Go module. Ignore the
	// lookup error here so test fixtures and development-only builds can still
	// provide an external frontend directory.
	s.embeddedFrontend, _ = frontend.Files()
	databasePath, err := persistence.DatabasePath()
	if err == nil {
		s.db, err = persistence.Open(databasePath)
	}
	s.dbErr = err
	if s.dbErr == nil {
		s.dbErr = s.initLocalSecurity()
	}
	if s.dbErr == nil {
		var paths portable.Paths
		paths, err = portable.Resolve()
		if err == nil {
			s.toolCalls, err = toolcalls.NewSQLiteRepository(s.db, paths.Toolcalls)
		}
		s.dbErr = err
	}
	if s.dbErr == nil {
		var embedder rag.Embedder
		// Production semantic RAG is opt-in. No network provider is contacted
		// unless all explicit embedding settings are present.
		baseURL := strings.TrimSpace(os.Getenv("AIST_RAG_EMBEDDING_BASE_URL"))
		model := strings.TrimSpace(os.Getenv("AIST_RAG_EMBEDDING_MODEL"))
		version := strings.TrimSpace(os.Getenv("AIST_RAG_EMBEDDING_VERSION"))
		if baseURL != "" || model != "" || version != "" || strings.TrimSpace(os.Getenv("AIST_RAG_EMBEDDING_DIMENSIONS")) != "" {
			dimensions := 0
			if raw := strings.TrimSpace(os.Getenv("AIST_RAG_EMBEDDING_DIMENSIONS")); raw != "" {
				if parsed, parseErr := strconv.Atoi(raw); parseErr == nil {
					dimensions = parsed
				}
			}
			configured, configErr := rag.NewOpenAIEmbedder(rag.OpenAIEmbedderConfig{
				BaseURL: baseURL, APIKey: os.Getenv("AIST_RAG_EMBEDDING_API_KEY"), Model: model, Dimensions: dimensions, Version: version,
			})
			if configErr == nil {
				embedder = configured
			}
		}
		s.rag, s.dbErr = rag.New(s.db, embedder)
	}
	if s.dbErr == nil {
		// The model root is refreshed from the engine at request time. Some
		// lightweight test/fake engines intentionally implement only the methods
		// needed by their route tests, so startup must not dereference it here.
		s.dbErr = s.dlMgr.Configure(s.db, "")
	}
	if s.dbErr == nil {
		s.modelRegistry, s.dbErr = modelregistry.New(s.db)
	}
	if s.dbErr == nil {
		var repo *agentrun.SQLiteRepository
		repo, err = agentrun.NewSQLiteRepository(s.db)
		if err == nil {
			dataDir, dataErr := persistence.DataDir()
			if dataErr != nil {
				err = dataErr
			} else {
				err = s.importLegacyAgentRuns(repo, dataDir)
			}
		}
		if err == nil {
			s.agentRuns, err = newAgentRunStore(repo)
		}
		if err == nil {
			s.workflows, err = workflow.NewSQLiteRepository(s.db)
		}
		if err == nil {
			s.workflowRecovery = workflow.NewRecoveryService(s.workflows)
			_, err = s.recoverWorkflows()
		}
		if err == nil {
			s.trustedOrchestrator = workflow.NewTrustedOrchestrator(s.workflows, s.newWorkflowExecutionAdapter())
		}
	} else {
		err = s.dbErr
	}
	s.agentRunsErr = err
	s.workflowErr = err
	s.registerRoutes()
	return s
}

// Ready is closed after the local listener has successfully bound.
func (s *Server) Ready() <-chan struct{} { return s.ready }

// URL returns the actual local URL after Listen succeeds.
func (s *Server) URL() string {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	return s.actualURL
}

// ActualURL is an explicit alias for URL for callers that need to distinguish
// the bound address from the configured address.
func (s *Server) ActualURL() string { return s.URL() }

// ActualPort returns the port assigned by the listener, including when the
// configured port was zero.
func (s *Server) ActualPort() int {
	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()
	if s.listener == nil {
		return 0
	}
	_, port, err := net.SplitHostPort(s.listener.Addr().String())
	if err != nil {
		return 0
	}
	value, _ := strconv.Atoi(port)
	return value
}

// Handler returns the authenticated local API handler used by the TCP server.
// Desktop shells can mount this handler behind their own embedded asset server
// without creating a second backend or bypassing the existing auth gateway.
func (s *Server) Handler() http.Handler {
	return corsMiddleware(s.authMiddleware(s.mux))
}

// Listen binds the local HTTP listener without blocking. Serve or Start must
// be called afterward to process requests.
func (s *Server) Listen() error {
	if s.dbErr != nil {
		return s.dbErr
	}
	if s.agentRunsErr != nil {
		return s.agentRunsErr
	}
	if s.workflowErr != nil {
		return s.workflowErr
	}
	host := strings.TrimSpace(os.Getenv("AI_SERVER_BIND_ADDR"))
	if host == "" {
		host = "127.0.0.1"
	}

	addr := net.JoinHostPort(host, strconv.Itoa(s.port))
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	s.lifecycleMu.Lock()
	if s.closing {
		s.lifecycleMu.Unlock()
		_ = listener.Close()
		return http.ErrServerClosed
	}
	if s.listener != nil {
		s.lifecycleMu.Unlock()
		_ = listener.Close()
		return nil
	}
	s.listener = listener
	s.actualURL = localURL(listener.Addr())
	s.httpServer = &http.Server{Addr: listener.Addr().String(), Handler: s.Handler(), ReadHeaderTimeout: 10 * time.Second}
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
	close(s.ready)
	return nil
}

// Serve processes requests on the listener created by Listen.
func (s *Server) Serve() error {
	s.lifecycleMu.Lock()
	listener, httpServer := s.listener, s.httpServer
	s.lifecycleMu.Unlock()
	if listener == nil || httpServer == nil {
		return errors.New("server has not been bound; call Listen first")
	}
	return httpServer.Serve(listener)
}

// Start begins listening on the configured port and blocks serving requests.
func (s *Server) Start() error {
	if err := s.Listen(); err != nil {
		return err
	}
	return s.Serve()
}

func localURL(addr net.Addr) string {
	host, port, err := net.SplitHostPort(addr.String())
	if err != nil {
		return "http://" + addr.String()
	}
	if host == "" || host == "::" || host == "0.0.0.0" {
		host = "127.0.0.1"
	}
	return (&url.URL{Scheme: "http", Host: net.JoinHostPort(host, port)}).String()
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
		if s.dlMgr != nil {
			s.dlMgr.CancelAll()
		}
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
		origin == "http://wails.localhost" ||
		origin == "wails://wails.localhost" ||
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

func writeJSONStatus(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
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
