package server

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func (s *Server) registerConfigRoutes() {
	s.mux.HandleFunc("GET /v1/config", s.handleGetConfig)
	s.mux.HandleFunc("POST /v1/config", s.handlePostConfig)
}

// GET /v1/config
func (s *Server) handleGetConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]interface{}{
		"models_dir": s.eng.GetModelsDir(),
	})
}

// POST /v1/config
func (s *Server) handlePostConfig(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ModelsDir      string `json:"models_dir"`
		GpuAccel       *bool  `json:"gpu_accel"`
		DefaultContext *int   `json:"default_context"`
		DebugMode      *bool  `json:"debug_mode"`
	}
	if err := jsonDecode(r, &req); err != nil {
		writeError(w, 400, "invalid JSON: "+err.Error(), "invalid_request")
		return
	}

	if modelsDir := strings.TrimSpace(req.ModelsDir); modelsDir != "" {
		abs, err := filepath.Abs(modelsDir)
		if err != nil {
			writeError(w, 400, "invalid models directory", "invalid_request")
			return
		}
		if err := os.MkdirAll(abs, 0o700); err != nil {
			writeError(w, 400, "models directory could not be created", "invalid_request")
			return
		}
		realPath, err := filepath.EvalSymlinks(abs)
		if err != nil {
			writeError(w, 400, "models directory is not available", "invalid_request")
			return
		}
		info, err := os.Stat(realPath)
		if err != nil || !info.IsDir() {
			writeError(w, 400, "models path must be a directory", "invalid_request")
			return
		}
		s.eng.SetModelsDir(realPath)
		log.Printf("[Server] Models dir updated: %s\n", realPath)
	}
	if req.DefaultContext != nil && *req.DefaultContext > 0 {
		s.eng.SetDefaultContext(*req.DefaultContext)
		log.Printf("[Server] Default context updated: %d\n", *req.DefaultContext)
	}
	if req.GpuAccel != nil {
		s.eng.SetGpuAccel(*req.GpuAccel)
		log.Printf("[Server] GPU accel updated: %v\n", *req.GpuAccel)
	}
	if req.DebugMode != nil {
		log.Printf("[Server] Debug mode: %v\n", *req.DebugMode)
	}

	writeJSON(w, map[string]interface{}{"ok": true, "models_dir": s.eng.GetModelsDir()})
}
