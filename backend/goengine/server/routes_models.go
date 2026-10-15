package server

import (
	"net/http"
	"time"

	"ai-server-studio-backend/engine"
)

func (s *Server) registerModelRoutes() {
	s.mux.HandleFunc("GET /v1/models", s.handleGetModels)
	s.mux.HandleFunc("GET /v1/models/available", s.handleGetAvailableModels)
	s.mux.HandleFunc("GET /v1/models/current", s.handleGetCurrentModel)
	s.mux.HandleFunc("POST /v1/models/load", s.handleLoadModel)
	s.mux.HandleFunc("POST /v1/models/unload", s.handleUnloadModel)
}

// GET /v1/models — loaded/local models (OpenAI-compatible)
func (s *Server) handleGetModels(w http.ResponseWriter, r *http.Request) {
	data := []interface{}{}
	if s.eng.IsModelLoaded() {
		data = append(data, map[string]interface{}{
			"id":                   s.eng.GetModelName(),
			"object":               "model",
			"created":              time.Now().Unix(),
			"owned_by":             "local",
			"supported_parameters": []string{"tools", "temperature", "top_p", "max_tokens", "stream"},
		})
	}
	writeJSON(w, map[string]interface{}{"object": "list", "data": data})
}

// GET /v1/models/available — all .gguf files on disk
func (s *Server) handleGetAvailableModels(w http.ResponseWriter, r *http.Request) {
	models := s.eng.ScanModels()
	data := make([]interface{}, len(models))
	for i, m := range models {
		data[i] = map[string]interface{}{
			"id":         m.ID,
			"path":       m.Path,
			"size_bytes": m.Size,
			"object":     "model",
			"owned_by":   "local",
		}
	}
	writeJSON(w, map[string]interface{}{"object": "list", "data": data})
}

// GET /v1/models/current — currently active model
func (s *Server) handleGetCurrentModel(w http.ResponseWriter, r *http.Request) {
	if !s.eng.IsModelLoaded() {
		writeJSON(w, map[string]interface{}{"model": nil})
		return
	}
	writeJSON(w, map[string]interface{}{
		"id":      s.eng.GetModelName(),
		"loaded":  true,
		"backend": "llama.cpp",
	})
}

// POST /v1/models/load
func (s *Server) handleLoadModel(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ModelPath string                 `json:"model_path"`
		Config    map[string]interface{} `json:"config"`
	}
	if err := jsonDecode(r, &req); err != nil {
		writeError(w, 400, "Invalid JSON", "invalid_request")
		return
	}
	if req.ModelPath == "" {
		writeError(w, 400, "model_path required", "invalid_request")
		return
	}

	var loadConfig *engine.LoadConfig
	if req.Config != nil {
		loadConfig = &engine.LoadConfig{}
		if v, ok := req.Config["n_ctx"].(float64); ok {
			loadConfig.NCtx = int(v)
		}
		if v, ok := req.Config["n_gpu_layers"].(float64); ok {
			n := int(v)
			if n < 0 {
				n = 999
			}
			loadConfig.NGpuLayers = &n
		}
	}

	if err := s.eng.LoadModel(req.ModelPath, loadConfig); err != nil {
		writeError(w, 500, err.Error(), "engine_error")
		return
	}
	writeJSON(w, map[string]interface{}{"ok": true, "model": s.eng.GetModelName()})
}

// POST /v1/models/unload
func (s *Server) handleUnloadModel(w http.ResponseWriter, r *http.Request) {
	s.eng.UnloadModel()
	writeJSON(w, map[string]interface{}{"ok": true})
}
