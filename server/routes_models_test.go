package server

import (
	"ai-server-studio-backend/engine"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func modelLoadBody(t *testing.T, path string, config map[string]interface{}) string {
	t.Helper()
	body, err := json.Marshal(map[string]interface{}{"model_path": path, "config": config})
	if err != nil {
		t.Fatal(err)
	}
	return string(body)
}

type modelRouteEngine struct {
	loadCalls int
	loaded    string
	modelsDir string
	config    *engine.LoadConfig
	loadErr   error
}

func (e *modelRouteEngine) LoadModel(path string, config *engine.LoadConfig) error {
	e.loadCalls++
	e.loaded = path
	e.config = config
	return e.loadErr
}
func (e *modelRouteEngine) UnloadModel()                      {}
func (e *modelRouteEngine) StopGenerating()                   {}
func (e *modelRouteEngine) IsModelLoaded() bool               { return e.loaded != "" }
func (e *modelRouteEngine) IsLoading() bool                   { return false }
func (e *modelRouteEngine) GetModelName() string              { return "fixture-model" }
func (e *modelRouteEngine) GetModelPath() string              { return e.loaded }
func (e *modelRouteEngine) GetModelsDir() string              { return e.modelsDir }
func (e *modelRouteEngine) SetModelsDir(string)               {}
func (e *modelRouteEngine) SetDefaultContext(int)             {}
func (e *modelRouteEngine) SetGpuAccel(bool)                  {}
func (e *modelRouteEngine) GetInternalPort() int              { return 0 }
func (e *modelRouteEngine) GetStatus() map[string]interface{} { return map[string]interface{}{} }
func (e *modelRouteEngine) ScanModels() []engine.ModelInfo    { return nil }
func (e *modelRouteEngine) ChatCompletion([]byte) (*http.Response, error) {
	return nil, fmt.Errorf("not used")
}
func (e *modelRouteEngine) StreamChatCompletion([]byte, http.ResponseWriter) error {
	return fmt.Errorf("not used")
}
func (e *modelRouteEngine) Subscribe() chan engine.Event  { return make(chan engine.Event) }
func (e *modelRouteEngine) Unsubscribe(chan engine.Event) {}
func (e *modelRouteEngine) HealthCheck() bool             { return true }
func (e *modelRouteEngine) Shutdown()                     {}

func TestLoadModelRejectsInvalidPathAndConfiguration(t *testing.T) {
	root := t.TempDir()
	eng := &modelRouteEngine{modelsDir: root}
	s := &Server{eng: eng, mux: http.NewServeMux()}
	s.registerModelRoutes()

	missing := root + string(os.PathSeparator) + "missing.gguf"
	w := httptest.NewRecorder()
	s.mux.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/v1/models/load", strings.NewReader(modelLoadBody(t, missing, nil))))
	assertStatus(t, w, http.StatusBadRequest)
	if !strings.Contains(w.Body.String(), "model file not found") || eng.loadCalls != 0 {
		t.Fatalf("missing model was not rejected before engine call: %d %s calls=%d", w.Code, w.Body.String(), eng.loadCalls)
	}

	model := root + string(os.PathSeparator) + "fixture.gguf"
	if err := os.WriteFile(model, []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	w = httptest.NewRecorder()
	s.mux.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/v1/models/load", strings.NewReader(modelLoadBody(t, model, map[string]interface{}{"n_ctx": 128}))))
	assertStatus(t, w, http.StatusBadRequest)
	if !strings.Contains(w.Body.String(), "config.n_ctx") || eng.loadCalls != 0 {
		t.Fatalf("invalid config was not rejected before engine call: %d %s calls=%d", w.Code, w.Body.String(), eng.loadCalls)
	}
}

func TestLoadModelPassesValidatedRequestToEngine(t *testing.T) {
	root := t.TempDir()
	eng := &modelRouteEngine{modelsDir: root}
	s := &Server{eng: eng, mux: http.NewServeMux()}
	s.registerModelRoutes()
	model := root + string(os.PathSeparator) + "fixture.gguf"
	if err := os.WriteFile(model, []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}

	w := httptest.NewRecorder()
	s.mux.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/v1/models/load", strings.NewReader(modelLoadBody(t, model, map[string]interface{}{"n_ctx": 4096, "n_gpu_layers": 0}))))
	assertStatus(t, w, http.StatusOK)
	if eng.loadCalls != 1 || eng.loaded != model || eng.config == nil || eng.config.NCtx != 4096 || eng.config.NGpuLayers == nil || *eng.config.NGpuLayers != 0 {
		t.Fatalf("validated model request was not passed through: %+v", eng)
	}
}

func TestLoadModelReportsUnavailableEngineWithoutInternalDetail(t *testing.T) {
	root := t.TempDir()
	eng := &modelRouteEngine{modelsDir: root, loadErr: fmt.Errorf("%w: embedded llama.cpp requires CGO", engine.ErrUnavailable)}
	s := &Server{eng: eng, mux: http.NewServeMux()}
	s.registerModelRoutes()
	model := root + string(os.PathSeparator) + "fixture.gguf"
	if err := os.WriteFile(model, []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}

	w := httptest.NewRecorder()
	s.mux.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/v1/models/load", strings.NewReader(modelLoadBody(t, model, nil))))
	assertStatus(t, w, http.StatusServiceUnavailable)
	if strings.Contains(w.Body.String(), "CGO") || !strings.Contains(w.Body.String(), "engine_unavailable") {
		t.Fatalf("unavailable engine leaked internal detail: %s", w.Body.String())
	}
}

func TestLoadModelReportsUnsupportedArchitecture(t *testing.T) {
	root := t.TempDir()
	eng := &modelRouteEngine{modelsDir: root, loadErr: fmt.Errorf("%w: gemma4", engine.ErrUnsupportedModelArchitecture)}
	s := &Server{eng: eng, mux: http.NewServeMux()}
	s.registerModelRoutes()
	model := root + string(os.PathSeparator) + "fixture.gguf"
	if err := os.WriteFile(model, []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}

	w := httptest.NewRecorder()
	s.mux.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/v1/models/load", strings.NewReader(modelLoadBody(t, model, nil))))
	assertStatus(t, w, http.StatusUnprocessableEntity)
	if !strings.Contains(w.Body.String(), "unsupported_model_architecture") || !strings.Contains(w.Body.String(), "gemma4") {
		t.Fatalf("unsupported architecture response = %s", w.Body.String())
	}
}
