//go:build cgo

package engine

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"ai-server-studio-backend/engine/llamacpp"
)

var embeddedLoadOperation uint64

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

	core     *llamacpp.Engine
	nativeMu sync.Mutex
	// session is removed to support concurrency

	modelsDir string
	lifecycle *lifecycleCoordinator

	nCtx           int
	nGpuLayers     int
	gpuBackend     GPUBackend
	inferenceReady bool

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
		lifecycle:  newLifecycleCoordinator(0),
	}
}

func (e *EmbeddedEngine) LoadModel(modelPath string, config *LoadConfig) error {
	e.mu.RLock()
	modelsDir := e.modelsDir
	e.mu.RUnlock()
	modelPath, err := resolveModelFile(modelsDir, modelPath)
	if err != nil {
		return err
	}
	operationID := fmt.Sprintf("load-%d", atomic.AddUint64(&embeddedLoadOperation, 1))
	logPath := os.Getenv("AIST_ENGINE_LOG_FILE")
	logOffset := nativeLogOffset(logPath)
	if info, statErr := os.Stat(modelPath); statErr == nil {
		log.Printf("[ModelLoad %s] path=%s size_bytes=%d backend=%s gpu_layers=%d n_ctx=%d", operationID, filepath.Base(modelPath), info.Size(), e.gpuBackend, e.nGpuLayers, e.nCtx)
	} else {
		log.Printf("[ModelLoad %s] path=%s stat_error=%v", operationID, filepath.Base(modelPath), statErr)
	}
	op, _, err := e.lifecycle.beginLoad()
	if err != nil {
		return err
	}
	completed := false
	defer func() {
		if !completed {
			_ = e.lifecycle.fail(op)
		}
		op.cancel()
	}()

	// The CGO API frees a previous model as part of LoadModel. It does not
	// expose a separate swap primitive, so lifecycle state is not committed
	// until the new native model has loaded successfully.
	e.mu.RLock()
	params := llamacpp.Params{Threads: 8, CtxSize: e.nCtx, BatchSize: 512, GpuLayers: e.nGpuLayers, UseMmap: true, UseMlock: false, Embeddings: true}
	e.mu.RUnlock()
	if config != nil {
		if config.NCtx > 0 {
			params.CtxSize = config.NCtx
		}
		if config.NGpuLayers != nil {
			params.GpuLayers = *config.NGpuLayers
		}
	}
	log.Printf("[ModelLoad %s] native_start backend=%s gpu_layers=%d n_ctx=%d at=%s", operationID, e.gpuBackend, params.GpuLayers, params.CtxSize, time.Now().UTC().Format(time.RFC3339Nano))
	e.nativeMu.Lock()
	loadErr := e.core.LoadModelWithParams(modelPath, params)
	verifyErr := error(nil)
	if loadErr == nil {
		verifyErr = verifyEmbeddedInference(e.core)
	}
	err = loadErr
	if err == nil {
		err = verifyErr
	}
	if err != nil {
		e.core.Close()
	}
	e.nativeMu.Unlock()
	if err != nil {
		if loadErr == nil {
			log.Printf("[ModelLoad %s] inference_verification_failed error=%v", operationID, verifyErr)
			return fmt.Errorf("inference verification failed: %w", verifyErr)
		}
		diagnostic := readNativeLoadDiagnosticAfter(logPath, logOffset)
		if diagnostic != "" {
			log.Printf("[ModelLoad %s] native_failed error=%v diagnostic=%s", operationID, err, diagnostic)
			if architecture := unsupportedArchitectureFromDiagnostic(diagnostic); architecture != "" {
				return fmt.Errorf("%w: %s", ErrUnsupportedModelArchitecture, architecture)
			}
			return fmt.Errorf("native model load failed: %w (%s)", err, diagnostic)
		}
		log.Printf("[ModelLoad %s] native_failed error=%v", operationID, err)
		return fmt.Errorf("native model load failed: %w", err)
	}
	log.Printf("[ModelLoad %s] native_succeeded", operationID)

	modelName := strings.TrimSuffix(filepath.Base(modelPath), ".gguf")
	if !e.lifecycle.markReadyWithoutProcess(op, modelPath, modelName) {
		// Shutdown may have won the lifecycle race while native loading was
		// queued. Do not leave a native model behind an inactive state owner.
		e.nativeMu.Lock()
		e.core.Close()
		e.nativeMu.Unlock()
		return fmt.Errorf("model load cancelled")
	}
	completed = true
	e.mu.Lock()
	e.inferenceReady = true
	e.mu.Unlock()

	e.broadcast(Event{
		Type:      "status",
		Loaded:    true,
		ModelName: modelName,
		Backend:   "embedded/llamacpp",
	})

	return nil
}

func (e *EmbeddedEngine) UnloadModel() {
	_ = e.UnloadModelWithError()
}

func (e *EmbeddedEngine) UnloadModelWithError() error {
	if _, err := e.lifecycle.beginUnload(); err != nil {
		return err
	}
	defer e.lifecycle.finishUnload()
	// Close is the native API's actual unload operation: it frees the model
	// and backend. Existing sessions are independent and are not forcibly
	// cancelled by this API, so callers must not assume in-flight generation
	// is interrupted.
	e.nativeMu.Lock()
	e.core.Close()
	e.nativeMu.Unlock()
	e.mu.Lock()
	e.inferenceReady = false
	e.mu.Unlock()
	e.broadcast(Event{Type: "status", Loaded: false, Backend: "embedded/llamacpp"})
	return nil
}

func (e *EmbeddedEngine) StopGenerating() {
	// Handled via context cancellation to the Generate call
}

func (e *EmbeddedEngine) IsModelLoaded() bool {
	loaded, _, _, _, _ := e.lifecycle.snapshot()
	return loaded
}

func (e *EmbeddedEngine) IsLoading() bool {
	_, loading, _, _, _ := e.lifecycle.snapshot()
	return loading
}

func (e *EmbeddedEngine) GetModelName() string {
	_, _, _, name, _ := e.lifecycle.snapshot()
	return name
}

func (e *EmbeddedEngine) GetModelPath() string {
	_, _, model, _, _ := e.lifecycle.snapshot()
	return model
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
	loaded, loading, model, modelName, _ := e.lifecycle.snapshot()
	e.mu.RLock()
	nGpuLayers, backend, inferenceReady := e.nGpuLayers, e.gpuBackend, e.inferenceReady
	e.mu.RUnlock()
	cpuOnly := backend == GPUBackendNone || nGpuLayers == 0
	return map[string]interface{}{
		"loaded": loaded,
		"model":  model,
		"modelName": func() string {
			if loaded {
				return modelName
			}
			return ""
		}(),
		"backend":        "embedded/llamacpp",
		"runtimeMode":    "embedded",
		"available":      true,
		"loading":        loading,
		"inferenceReady": inferenceReady,
		"gpuBackend":     string(backend),
		"gpuLayers":      nGpuLayers,
		"binaryPath":     "",
		"binaryVariant":  "",
		"binaryVersion":  "",
		"cpuOnly":        cpuOnly,
	}
}

func (e *EmbeddedEngine) ScanModels() []ModelInfo {
	return scanModelsDir(e.modelsDir)
}

func (e *EmbeddedEngine) ChatCompletion(body []byte) (*http.Response, error) {
	// Wrap StreamChatCompletion into a buffered response so non-streaming callers work
	loaded, _, _, _, _ := e.lifecycle.snapshot()
	if !loaded {
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
	loaded, _, _, modelName, _ := e.lifecycle.snapshot()
	if !loaded {
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
	loaded, _, _, _, _ := e.lifecycle.snapshot()
	e.mu.RLock()
	ready := e.inferenceReady
	e.mu.RUnlock()
	return loaded && ready
}

func (e *EmbeddedEngine) Shutdown() {
	_, changed := e.lifecycle.shutdown()
	if changed {
		e.nativeMu.Lock()
		e.core.Close()
		e.nativeMu.Unlock()
		e.mu.Lock()
		e.inferenceReady = false
		e.mu.Unlock()
	}
}

func verifyEmbeddedInference(core *llamacpp.Engine) error {
	session, err := core.NewSession()
	if err != nil {
		return fmt.Errorf("create verification session: %w", err)
	}
	defer session.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	var generated bool
	err = session.Generate(ctx, "Hello", llamacpp.SamplerParams{MaxTokens: 1, Temp: 0.1}, func(token string) {
		generated = generated || strings.TrimSpace(token) != ""
	})
	if err != nil {
		return fmt.Errorf("run verification inference: %w", err)
	}
	if !generated {
		return fmt.Errorf("run verification inference: model produced no token")
	}
	return nil
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
