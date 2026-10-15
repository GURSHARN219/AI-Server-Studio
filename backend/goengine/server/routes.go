package server

import (
	"net/http"
	"path/filepath"
)

func (s *Server) registerRoutes() {
	s.registerModelRoutes()
	s.registerChatRoutes()
	s.registerProviderRoutes()
	s.registerSettingsRoutes()
	s.registerAuthDataRoutes()
	s.registerToolRoutes()
	s.registerAgentRoutes()
	s.registerSystemRoutes()
	s.registerConfigRoutes()
	s.registerTaskRoutes()
	s.registerComponentRoutes()
	s.registerEventRoutes()
	s.registerTunnelRoutes()

	// Static test UI
	s.mux.HandleFunc("GET /", s.handleStaticUI)
	s.mux.HandleFunc("GET /index.html", s.handleStaticUI)
}

func (s *Server) handleStaticUI(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" && r.URL.Path != "/index.html" {
		http.NotFound(w, r)
		return
	}
	http.ServeFile(w, r, filepath.Join(s.baseDir, "test_ui", "index.html"))
}
