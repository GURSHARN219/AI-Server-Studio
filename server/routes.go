package server

import (
	"io/fs"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

func (s *Server) registerRoutes() {
	s.registerModelRoutes()
	s.registerChatRoutes()
	s.registerProviderRoutes()
	s.registerSettingsRoutes()
	s.registerAuthDataRoutes()
	s.registerToolRoutes()
	s.registerRAGRoutes()
	s.registerAgentRoutes()
	s.registerWorkflowRoutes()
	s.registerSystemRoutes()
	s.registerConfigRoutes()
	s.registerTaskRoutes()
	s.registerComponentRoutes()
	s.registerEventRoutes()
	s.registerTunnelRoutes()

	if !s.serveFrontend {
		return
	}
	// The catch-all is registered after the /v1 routes. The handler also keeps
	// /v1 separate so an unknown API path can never be turned into an SPA hit.
	s.mux.HandleFunc("GET /", s.handleStaticUI)
	s.mux.HandleFunc("GET /index.html", s.handleStaticUI)
}

func (s *Server) handleStaticUI(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "" || r.URL.Path == "/v1" || strings.HasPrefix(r.URL.Path, "/v1/") {
		http.NotFound(w, r)
		return
	}
	if s.serveEmbeddedUI(w, r) {
		return
	}

	frontendDir := s.frontendDir
	production := frontendDir != "" && hasFrontendIndex(frontendDir)
	if !production {
		// Keep the existing development fixture available when no production
		// bundle is installed next to the executable.
		legacyDir := filepath.Join(s.baseDir, "test_ui")
		if hasFrontendIndex(legacyDir) {
			frontendDir = legacyDir
		}
	}
	if frontendDir == "" {
		http.NotFound(w, r)
		return
	}

	if !production && r.URL.Path != "/" && r.URL.Path != "/index.html" {
		http.NotFound(w, r)
		return
	}
	if production {
		if file, ok := frontendFile(frontendDir, r.URL.Path); ok {
			http.ServeFile(w, r, file)
			return
		}
		// A request with an extension or an asset path is an asset request, not
		// a client-side route. Missing assets must remain real 404s.
		if r.URL.Path != "/" && isFrontendAsset(r.URL.Path) {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join(frontendDir, "index.html"))
		return
	}
	http.ServeFile(w, r, filepath.Join(frontendDir, "index.html"))
}

// serveEmbeddedUI serves the production React bundle from the Go binary. It
// returns false when the bundle is unavailable so development fixtures and an
// explicitly configured external frontend can retain their existing behavior.
func (s *Server) serveEmbeddedUI(w http.ResponseWriter, r *http.Request) bool {
	if s.embeddedFrontend == nil || hasFrontendIndex(s.frontendDir) {
		return false
	}
	requested := strings.TrimPrefix(path.Clean(strings.ReplaceAll(r.URL.Path, "\\", "/")), "/")
	if requested == "." || requested == "" {
		requested = "index.html"
	}
	if info, err := fs.Stat(s.embeddedFrontend, requested); err == nil && info.Mode().IsRegular() {
		serveEmbeddedFile(w, r, s.embeddedFrontend, requested)
		return true
	}
	if isFrontendAsset(r.URL.Path) {
		// A missing asset must remain a real 404, not an SPA fallback.
		http.NotFound(w, r)
		return true
	}
	serveEmbeddedFile(w, r, s.embeddedFrontend, "index.html")
	return true
}

func serveEmbeddedFile(w http.ResponseWriter, r *http.Request, files fs.FS, name string) {
	data, err := fs.ReadFile(files, name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if contentType := mime.TypeByExtension(filepath.Ext(name)); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	_, _ = w.Write(data)
}

func hasFrontendIndex(dir string) bool {
	info, err := os.Stat(filepath.Join(dir, "index.html"))
	return err == nil && info.Mode().IsRegular()
}

func frontendFile(root, requestPath string) (string, bool) {
	relative := strings.TrimPrefix(requestPath, "/")
	if relative == "" {
		return "", false
	}
	relative = path.Clean(strings.ReplaceAll(relative, "\\", "/"))
	if relative == "." || relative == ".." || strings.HasPrefix(relative, "../") {
		return "", false
	}
	file := filepath.Join(root, filepath.FromSlash(relative))
	info, err := os.Stat(file)
	if err != nil || !info.Mode().IsRegular() {
		return "", false
	}
	return file, true
}

func isFrontendAsset(requestPath string) bool {
	clean := path.Clean(strings.TrimPrefix(requestPath, "/"))
	return path.Ext(clean) != "" || clean == "assets" || strings.HasPrefix(clean, "assets/") || strings.HasPrefix(clean, "static/")
}
