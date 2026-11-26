package server

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"ai-server-studio-backend/engine"
	"ai-server-studio-backend/modelregistry"
)

func (s *Server) registerModelRoutes() {
	s.mux.HandleFunc("GET /v1/models", s.handleGetModels)
	s.mux.HandleFunc("GET /v1/models/available", s.handleGetAvailableModels)
	s.mux.HandleFunc("GET /v1/models/current", s.handleGetCurrentModel)
	s.mux.HandleFunc("POST /v1/models/assess", s.handleAssessModel)
	s.mux.HandleFunc("POST /v1/models/load", s.handleLoadModel)
	s.mux.HandleFunc("POST /v1/models/unload", s.handleUnloadModel)
}

// POST /v1/models/assess returns a conservative resource estimate without
// starting a model or changing the active runtime state.
func (s *Server) handleAssessModel(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ModelPath string `json:"model_path"`
		NCtx      int    `json:"n_ctx"`
	}
	if err := jsonDecode(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid JSON", "invalid_request")
		return
	}
	req.ModelPath = strings.TrimSpace(req.ModelPath)
	if err := validateModelPath(s.eng.GetModelsDir(), req.ModelPath); err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), "invalid_request")
		return
	}

	resolved := req.ModelPath
	if !filepath.IsAbs(resolved) {
		resolved = filepath.Join(s.eng.GetModelsDir(), resolved)
	}
	info, err := os.Stat(resolved)
	if err != nil {
		writeError(w, http.StatusBadRequest, "model file could not be accessed", "invalid_request")
		return
	}
	metadata, err := modelregistry.ReadGGUFMetadata(resolved)
	if err != nil {
		writeError(w, http.StatusBadRequest, "model metadata could not be read", "invalid_request")
		return
	}
	hardware, err := engine.GetHardwareInfo()
	if err != nil {
		writeError(w, http.StatusServiceUnavailable, "hardware information unavailable", "capability_unavailable")
		return
	}
	assessment := engine.AssessModelResources(metadata, info.Size(), hardware, req.NCtx)
	writeJSON(w, map[string]interface{}{
		"model_path": resolved,
		"metadata":   metadata,
		"assessment": assessment,
	})
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
	if s.modelRegistry != nil {
		_, _ = s.modelRegistry.DiscoverAndRegister(r.Context(), []string{s.eng.GetModelsDir()}, "configured")
		if models, err := s.modelRegistry.List(r.Context()); err == nil {
			data := make([]interface{}, 0, len(models))
			for _, model := range models {
				data = append(data, modelRegistryResponse(model))
			}
			writeJSON(w, map[string]interface{}{"object": "list", "data": data})
			return
		}
	}
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

func modelRegistryResponse(model modelregistry.Model) map[string]interface{} {
	return map[string]interface{}{
		"id":                   model.Filename,
		"path":                 model.Path,
		"size_bytes":           model.Size,
		"object":               "model",
		"owned_by":             "local",
		"source":               model.Source,
		"repository_id":        model.RepositoryID,
		"repository_revision":  model.RepositoryRevision,
		"architecture":         model.Architecture,
		"quantization":         model.Quantization,
		"tokenizer":            model.Tokenizer,
		"compatibility_status": model.CompatibilityStatus,
		"load_status":          model.LoadStatus,
		"last_load":            model.LastLoad,
		"exists":               model.Exists,
		"stale":                model.Stale,
	}
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
	req.ModelPath = strings.TrimSpace(req.ModelPath)
	if req.ModelPath == "" {
		writeError(w, 400, "model_path required", "invalid_request")
		return
	}

	var loadConfig *engine.LoadConfig
	if req.Config != nil {
		loadConfig = &engine.LoadConfig{}
		if v, ok := req.Config["n_ctx"].(float64); ok {
			if v != float64(int(v)) || v < 512 || v > 131072 {
				writeError(w, 400, "config.n_ctx must be an integer from 512 to 131072", "invalid_request")
				return
			}
			loadConfig.NCtx = int(v)
		} else if _, present := req.Config["n_ctx"]; present {
			writeError(w, 400, "config.n_ctx must be an integer from 512 to 131072", "invalid_request")
			return
		}
		if v, ok := req.Config["n_gpu_layers"].(float64); ok {
			if v != float64(int(v)) || v < -1 || v > 999 {
				writeError(w, 400, "config.n_gpu_layers must be an integer from -1 to 999", "invalid_request")
				return
			}
			n := int(v)
			if n < 0 {
				n = 999
			}
			loadConfig.NGpuLayers = &n
		} else if _, present := req.Config["n_gpu_layers"]; present {
			writeError(w, 400, "config.n_gpu_layers must be an integer from -1 to 999", "invalid_request")
			return
		}
		if v, ok := req.Config["trust_remote_code"].(bool); ok {
			loadConfig.TrustRemoteCode = &v
		} else if _, present := req.Config["trust_remote_code"]; present {
			writeError(w, 400, "config.trust_remote_code must be a boolean", "invalid_request")
			return
		}
	}
	if err := validateModelPath(s.eng.GetModelsDir(), req.ModelPath); err != nil {
		writeError(w, 400, err.Error(), "invalid_request")
		return
	}
	registryPath := ""
	if s.modelRegistry != nil && strings.HasSuffix(strings.ToLower(req.ModelPath), ".gguf") {
		registryRequestPath := req.ModelPath
		if !filepath.IsAbs(registryRequestPath) {
			registryRequestPath = filepath.Join(s.eng.GetModelsDir(), registryRequestPath)
		}
		if registered, registerErr := s.modelRegistry.Register(r.Context(), modelregistry.RegisterRequest{Path: registryRequestPath, Source: "configured"}); registerErr == nil {
			registryPath = registered.Path
		}
	}

	if err := s.eng.LoadModel(req.ModelPath, loadConfig); err != nil {
		if registryPath != "" {
			_ = s.modelRegistry.RecordLoad(r.Context(), registryPath, modelregistry.LoadResult{Status: "load_failed", Error: err.Error()})
		}
		if errors.Is(err, engine.ErrBusy) {
			writeError(w, http.StatusConflict, err.Error(), "engine_busy")
			return
		}
		if errors.Is(err, engine.ErrUnavailable) {
			writeError(w, 503, "selected inference engine is unavailable in this build", "engine_unavailable")
			return
		}
		if errors.Is(err, engine.ErrUnsupportedModelArchitecture) {
			writeError(w, http.StatusUnprocessableEntity, err.Error(), "unsupported_model_architecture")
			return
		}
		writeError(w, 500, err.Error(), "engine_error")
		return
	}
	if registryPath != "" {
		_ = s.modelRegistry.RecordLoad(r.Context(), registryPath, modelregistry.LoadResult{Status: "loadable"})
	}
	writeJSON(w, map[string]interface{}{"ok": true, "model": s.eng.GetModelName()})
}

// validateModelPath validates filesystem model paths before they reach a
// native loader. vLLM may also accept a model identifier, so identifier-like
// values are left to that selected engine instead of being treated as files.
func validateModelPath(modelsDir, modelPath string) error {
	trimmed := strings.TrimSpace(modelPath)
	if trimmed == "" {
		return fmt.Errorf("model_path required")
	}
	looksLikeFile := filepath.IsAbs(trimmed) || strings.HasSuffix(strings.ToLower(trimmed), ".gguf")
	if !looksLikeFile {
		return nil
	}
	external := filepath.IsAbs(trimmed)
	var rootAbs, rootReal string
	var err error
	if !external {
		if strings.TrimSpace(modelsDir) == "" {
			return fmt.Errorf("model root is not configured")
		}
		rootAbs, err = filepath.Abs(modelsDir)
		if err != nil {
			return fmt.Errorf("invalid model root")
		}
		rootReal, err = filepath.EvalSymlinks(rootAbs)
		if err != nil {
			return fmt.Errorf("model root is not available")
		}
	}
	candidate := trimmed
	if !external {
		candidate = filepath.Join(rootAbs, candidate)
	}
	candidate, err = filepath.Abs(candidate)
	if err != nil {
		return fmt.Errorf("invalid model path")
	}
	entry, err := os.Lstat(candidate)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("model file not found")
		}
		return fmt.Errorf("model path could not be accessed")
	}
	if entry.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("model path must not be a symlink")
	}
	realPath, err := filepath.EvalSymlinks(candidate)
	if err != nil {
		return fmt.Errorf("model path could not be resolved")
	}
	if !external {
		rel, relErr := filepath.Rel(rootReal, realPath)
		if relErr != nil {
			return fmt.Errorf("model path containment could not be checked")
		}
		if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return fmt.Errorf("model path escapes configured model root")
		}
	}
	info, err := os.Stat(realPath)
	if err != nil || !info.Mode().IsRegular() {
		return fmt.Errorf("model path must be a file")
	}
	return nil
}

// POST /v1/models/unload
func (s *Server) handleUnloadModel(w http.ResponseWriter, r *http.Request) {
	if unloadable, ok := s.eng.(interface{ UnloadModelWithError() error }); ok {
		if err := unloadable.UnloadModelWithError(); err != nil {
			writeError(w, http.StatusConflict, err.Error(), "engine_busy")
			return
		}
	} else {
		s.eng.UnloadModel()
	}
	writeJSON(w, map[string]interface{}{"ok": true})
}
