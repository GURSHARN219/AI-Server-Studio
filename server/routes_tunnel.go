package server

import (
	"context"
	"net/http"

	"ai-server-studio-backend/tunnel"
)

func (s *Server) registerTunnelRoutes() {
	s.mux.HandleFunc("GET /v1/tunnel/status", s.handleTunnelStatus)
	s.mux.HandleFunc("POST /v1/tunnel/start", s.handleTunnelStart)
	s.mux.HandleFunc("POST /v1/tunnel/stop", s.handleTunnelStop)
}

func (s *Server) handleTunnelStatus(w http.ResponseWriter, _ *http.Request) {
	if s.tunnel == nil {
		writeJSON(w, tunnel.Status{Enabled: false, Message: "Tunnel support is disabled"})
		return
	}
	writeJSON(w, s.tunnel.Status())
}

func (s *Server) handleTunnelStart(w http.ResponseWriter, r *http.Request) {
	if s.tunnel == nil {
		writeError(w, http.StatusNotImplemented, "tunnel support is not configured", "not_implemented")
		return
	}
	if err := s.tunnel.Start(context.Background()); err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), "tunnel_error")
		return
	}
	writeJSON(w, s.tunnel.Status())
}

func (s *Server) handleTunnelStop(w http.ResponseWriter, _ *http.Request) {
	if s.tunnel == nil {
		writeJSON(w, tunnel.Status{Enabled: false, Message: "Tunnel support is disabled"})
		return
	}
	if err := s.tunnel.Stop(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error(), "tunnel_error")
		return
	}
	writeJSON(w, s.tunnel.Status())
}

func (s *Server) stopTunnel() {
	if s.tunnel != nil {
		_ = s.tunnel.Stop()
	}
}
