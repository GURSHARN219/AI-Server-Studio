package server

import (
	"log"
	"net/http"
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

	if req.ModelsDir != "" {
		s.eng.SetModelsDir(req.ModelsDir)
		log.Printf("[Server] Models dir updated: %s\n", req.ModelsDir)
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
