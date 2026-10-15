//go:build cgo

package engine

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"sync"

	"ai-server-studio-backend/engine/llamacpp"
)

// responseRecorder captures http.ResponseWriter output into a buffer
type responseRecorder struct {
	header http.Header
	body   bytes.Buffer
	code   int
}

func (r *responseRecorder) Header() http.Header         { return r.header }
func (r *responseRecorder) WriteHeader(code int)        { r.code = code }
func (r *responseRecorder) Write(b []byte) (int, error) { return r.body.Write(b) }
func (r *responseRecorder) Flush()                      {} // no-op for buffered recorder

// EmbeddedEngine implements EngineInterface using CGO llamacpp bindings
type EmbeddedEngine struct {
	mu sync.RWMutex

	core *llamacpp.Engine
	// session is removed to support concurrency

	modelsDir   string
	loadedModel string
	modelName   string
	isLoading   bool

	nCtx       int
	nGpuLayers int
	gpuBackend GPUBackend

	eventMu     sync.Mutex
	subscribers []chan Event
}

// NewEmbeddedEngine creates a new CGO-based engine
func NewEmbeddedEngine(modelsDir string, nGpuLayers, nCtx int, backend GPUBackend) *EmbeddedEngine {
	params := llamacpp.Params{
		Threads:    8,
		CtxSize:    nCtx,
		BatchSize:  512,
		GpuLayers:  nGpuLayers,
		UseMmap:    true,
		UseMlock:   false,
		Embeddings: true,
	}

	return &EmbeddedEngine{
		core:       llamacpp.NewEngine(params),
		modelsDir:  modelsDir,
		nCtx:       nCtx,
		nGpuLayers: nGpuLayers,
		gpuBackend: backend,
	}
}

func (e *EmbeddedEngine) LoadModel(modelPath string, config *LoadConfig) error {
	e.mu.Lock()
	if e.isLoading {
		e.mu.Unlock()
		return fmt.Errorf("already loading")
	}
	e.isLoading = true
	e.mu.Unlock()

	defer func() {
		e.mu.Lock()
		e.isLoading = false
		e.mu.Unlock()
	}()

	// 2. Load model into core
	if err := e.core.LoadModel(modelPath); err != nil {
		return err
	}

	e.mu.Lock()
	e.loadedModel = modelPath
	e.modelName = strings.TrimSuffix(filepath.Base(modelPath), ".gguf")
	e.mu.Unlock()

	e.broadcast(Event{
		Type:      "status",
		Loaded:    true,
		ModelName: e.modelName,
		Backend:   "embedded/llamacpp",
	})

	return nil
}

func (e *EmbeddedEngine) UnloadModel() {
	e.mu.Lock()
	defer e.mu.Unlock()

	// No global session to close anymore
	e.loadedModel = ""
	e.modelName = ""
	e.broadcast(Event{Type: "status", Loaded: false, Backend: "embedded/llamacpp"})
}

func (e *EmbeddedEngine) StopGenerating() {
	// Handled via context cancellation to the Generate call
}

func (e *EmbeddedEngine) IsModelLoaded() bool {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.loadedModel != ""
}

func (e *EmbeddedEngine) IsLoading() bool {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.isLoading
}

func (e *EmbeddedEngine) GetModelName() string {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.modelName
}

func (e *EmbeddedEngine) GetModelPath() string {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.loadedModel
}

func (e *EmbeddedEngine) GetModelsDir() string {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.modelsDir
}

func (e *EmbeddedEngine) SetModelsDir(dir string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.modelsDir = dir
}

func (e *EmbeddedEngine) SetDefaultContext(nCtx int) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.nCtx = nCtx
}

func (e *EmbeddedEngine) SetGpuAccel(enabled bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if enabled {
		e.nGpuLayers = 999
	} else {
		e.nGpuLayers = 0
	}
}

func (e *EmbeddedEngine) GetInternalPort() int {
	return 0 // internal, no port
}

func (e *EmbeddedEngine) GetStatus() map[string]interface{} {
	e.mu.RLock()
	defer e.mu.RUnlock()
	cpuOnly := e.gpuBackend == GPUBackendNone || e.nGpuLayers == 0
	return map[string]interface{}{
		"loaded":        e.loadedModel != "",
		"model":         e.loadedModel,
		"modelName":     e.modelName,
		"backend":       "embedded/llamacpp",
		"runtimeMode":   "embedded",
		"loading":       e.isLoading,
		"gpuBackend":    string(e.gpuBackend),
		"gpuLayers":     e.nGpuLayers,
		"binaryPath":    "",
		"binaryVariant": "",
		"binaryVersion": "",
		"cpuOnly":       cpuOnly,
	}
}

func (e *EmbeddedEngine) ScanModels() []ModelInfo {
	return scanModelsDir(e.modelsDir)
}

func (e *EmbeddedEngine) ChatCompletion(body []byte) (*http.Response, error) {
	// Wrap StreamChatCompletion into a buffered response so non-streaming callers work
	e.mu.RLock()
	modelName := e.modelName
	e.mu.RUnlock()
	if modelName == "" {
		return nil, fmt.Errorf("no model loaded")
	}

	sess, err := e.core.NewSession()
	if err != nil {
		return nil, fmt.Errorf("failed to create session: %w", err)
	}
	defer sess.Close()

	rec := &responseRecorder{header: make(http.Header)}
	if err := sess.HandleChatCompletion(context.Background(), body, rec); err != nil {
		return nil, err
	}

	return &http.Response{
		StatusCode: 200,
		Header:     rec.header,
		Body:       io.NopCloser(strings.NewReader(rec.body.String())),
	}, nil
}

func (e *EmbeddedEngine) StreamChatCompletion(body []byte, w http.ResponseWriter) error {
	e.mu.RLock()
	modelName := e.modelName
	e.mu.RUnlock()

	if modelName == "" {
		return fmt.Errorf("no model loaded")
	}

	// Create a new session for this request
	sess, err := e.core.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create session: %w", err)
	}
	defer sess.Close()

	e.broadcast(Event{Type: "generation_start", Model: modelName})
	defer e.broadcast(Event{Type: "generation_done", Model: modelName})

	return sess.HandleChatCompletion(context.Background(), body, w)
}

func (e *EmbeddedEngine) Subscribe() chan Event {
	e.eventMu.Lock()
	defer e.eventMu.Unlock()
	ch := make(chan Event, 16)
	e.subscribers = append(e.subscribers, ch)
	return ch
}

func (e *EmbeddedEngine) Unsubscribe(ch chan Event) {
	e.eventMu.Lock()
	defer e.eventMu.Unlock()
	for i, sub := range e.subscribers {
		if sub == ch {
			e.subscribers = append(e.subscribers[:i], e.subscribers[i+1:]...)
			close(ch)
			break
		}
	}
}

func (e *EmbeddedEngine) HealthCheck() bool {
	return true
}

func (e *EmbeddedEngine) Shutdown() {
	e.core.Close()
}

func (e *EmbeddedEngine) broadcast(evt Event) {
	e.eventMu.Lock()
	defer e.eventMu.Unlock()
	for _, ch := range e.subscribers {
		select {
		case ch <- evt:
		default:
		}
	}
}
