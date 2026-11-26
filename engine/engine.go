package engine

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// ModelInfo represents a discovered model file
type ModelInfo struct {
	ID   string `json:"id"`
	Path string `json:"path"`
	Size int64  `json:"size_bytes"`
}

// Engine manages the llama-server subprocess and provides model inference.
// The llama-server binary is from the official llama.cpp project — real llama.cpp,
// Communication between Go and llama-server is localhost-only
// (internal IPC, not exposed externally).
type Engine struct {
	mu sync.RWMutex

	llamaServerPath string
	llamaServerDir  string // directory containing the binary (for DLL resolution)
	modelsDir       string
	nGpuLayers      int
	nCtx            int
	gpuBackend      GPUBackend // cuda / rocm / vulkan / metal / none
	selectedBackend *SelectedBackend

	// Process management
	lifecycle *lifecycleCoordinator

	// Persistent HTTP client — reuses TCP connections to llama-server (no per-request dial)
	httpClient *http.Client

	// State
	// Event subscribers
	eventMu     sync.Mutex
	subscribers []chan Event
}

// newHTTPClient returns a keep-alive HTTP client tuned for localhost llama-server traffic.
func newHTTPClient() *http.Client {
	return &http.Client{
		Transport: &http.Transport{
			MaxIdleConns:        4,
			MaxIdleConnsPerHost: 4,
			IdleConnTimeout:     120 * time.Second,
			DisableCompression:  true, // localhost — no benefit, saves CPU
		},
		// No global timeout — streaming responses can be arbitrarily long.
		// Per-request timeouts are handled by the caller context.
	}
}

// Event represents an engine state change
type Event struct {
	Type      string `json:"type"`
	Loaded    bool   `json:"loaded,omitempty"`
	ModelName string `json:"modelName,omitempty"`
	Backend   string `json:"backend,omitempty"`
	Model     string `json:"model,omitempty"`
	Message   string `json:"message,omitempty"`
}

// LoadConfig mirrors the existing load config
type LoadConfig struct {
	NCtx            int   `json:"n_ctx,omitempty"`
	NGpuLayers      *int  `json:"n_gpu_layers"` // pointer so 0 (CPU-only) is distinguishable from "not set"
	TrustRemoteCode *bool `json:"trust_remote_code,omitempty"`
}

// NewEngine creates a new engine instance
func NewEngine(llamaServerPath, modelsDir string, nGpuLayers, nCtx int) *Engine {
	return NewEngineWithBackend(llamaServerPath, modelsDir, nGpuLayers, nCtx, GPUBackendNone)
}

// NewEngineWithBackend creates a new engine instance with an explicit GPU backend.
func NewEngineWithBackend(llamaServerPath, modelsDir string, nGpuLayers, nCtx int, backend GPUBackend) *Engine {
	return &Engine{
		llamaServerPath: llamaServerPath,
		llamaServerDir:  filepath.Dir(llamaServerPath),
		modelsDir:       modelsDir,
		nGpuLayers:      nGpuLayers,
		nCtx:            nCtx,
		gpuBackend:      backend,
		lifecycle:       newLifecycleCoordinator(18080),
		httpClient:      newHTTPClient(),
	}
}

// NewEngineFromSelection creates an engine from a SelectedBackend result.
func NewEngineFromSelection(sel *SelectedBackend, modelsDir string, nGpuLayers, nCtx int, backend GPUBackend) *Engine {
	dir := sel.BinaryDir
	if dir == "" && sel.BinaryPath != "" {
		dir = filepath.Dir(sel.BinaryPath)
	}
	return &Engine{
		llamaServerPath: sel.BinaryPath,
		llamaServerDir:  dir,
		modelsDir:       modelsDir,
		nGpuLayers:      nGpuLayers,
		nCtx:            nCtx,
		gpuBackend:      backend,
		selectedBackend: sel,
		lifecycle:       newLifecycleCoordinator(18080),
		httpClient:      newHTTPClient(),
	}
}

// LoadModel loads a GGUF model by starting llama-server with it
func (e *Engine) LoadModel(modelPath string, config *LoadConfig) error {
	e.mu.RLock()
	serverPath := e.llamaServerPath
	serverDir := e.llamaServerDir
	modelsDir := e.modelsDir
	backend := e.gpuBackend
	e.mu.RUnlock()
	if serverPath == "" {
		return fmt.Errorf("llama-server binary not found. Download from https://github.com/ggml-org/llama.cpp/releases")
	}
	modelPath, err := resolveModelFile(modelsDir, modelPath)
	if err != nil {
		return err
	}
	op, old, err := e.lifecycle.beginLoad()
	if err != nil {
		return err
	}
	if old != nil {
		killProcess(old.cmd)
	}
	completed := false
	defer func() {
		if !completed {
			if proc := e.lifecycle.fail(op); proc != nil {
				killProcess(proc.cmd)
			}
		}
		op.cancel()
	}()

	// --- build args (no lock needed, config is local) ---
	e.mu.RLock()
	nCtx := e.nCtx
	nGpuLayers := e.nGpuLayers
	e.mu.RUnlock()
	if config != nil {
		if config.NCtx > 0 {
			nCtx = config.NCtx
		}
		if config.NGpuLayers != nil {
			nGpuLayers = *config.NGpuLayers
		}
	}

	args := []string{
		"--model", modelPath,
		"--port", fmt.Sprintf("%d", e.lifecycle.portNumber()),
		"--host", "127.0.0.1",
		"--ctx-size", fmt.Sprintf("%d", nCtx),
		"--n-gpu-layers", fmt.Sprintf("%d", nGpuLayers),
		"-fa", "on", // flash attention (huge speed and VRAM improvement)
		"-cb", // enable continuous batching
	}

	// Add backend-specific GPU flags
	switch backend {
	case GPUBackendCUDA:
		log.Printf("[Engine] GPU backend: CUDA (n_gpu_layers=%d)\n", nGpuLayers)
	case GPUBackendROCm:
		log.Printf("[Engine] GPU backend: ROCm/HIP (n_gpu_layers=%d)\n", nGpuLayers)
	case GPUBackendVulkan:
		log.Printf("[Engine] GPU backend: Vulkan (n_gpu_layers=%d)\n", nGpuLayers)
	case GPUBackendMetal:
		log.Printf("[Engine] GPU backend: Metal (n_gpu_layers=%d)\n", nGpuLayers)
	default:
		log.Printf("[Engine] GPU backend: CPU only\n")
	}

	log.Printf("[Engine] Starting llama-server with args: %v\n", args)

	cmd := exec.Command(serverPath, args...)
	// Run from the backend dir so all sibling DLLs (ggml-cuda.dll, etc.) are found.
	// Also inject the dir into PATH as a safety net for transitive DLL loads.
	if serverDir != "" {
		cmd.Dir = serverDir
	} else {
		cmd.Dir = filepath.Dir(serverPath)
	}
	cmd.Env = append(os.Environ(),
		// Keep GPU/CUDA init messages visible; only suppress verbose token-level logs
		"LLAMA_LOG_DISABLE=0",
		"PATH="+cmd.Dir+string(os.PathListSeparator)+os.Getenv("PATH"),
	)

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("failed to create stderr pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start llama-server: %w", err)
	}
	if !e.lifecycle.attachProcess(op, cmd) {
		killProcessAndWait(cmd)
		return fmt.Errorf("model load cancelled")
	}

	// exitCh is closed when the process exits — used by the health loop below.
	exitCh := make(chan struct{})
	go func() {
		_ = cmd.Wait() // reaps the process; also drains stderr pipe
		if e.lifecycle.processExited(op, cmd) {
			e.broadcast(Event{Type: "status", Loaded: false, Backend: "llama.cpp", Message: "llama-server exited"})
		}
		close(exitCh)
	}()

	// log stderr — all output during startup, then filter to important lines
	go func() {
		scanner := bufio.NewScanner(stderr)
		for scanner.Scan() {
			line := scanner.Text()
			log.Printf("[llama-server] %s\n", line)
		}
	}()

	// --- health check loop — NO lock held so /v1/status can respond ---
	log.Println("[Engine] Waiting for llama-server to be ready...")
	ready := false
	for i := 0; i < 120; i++ { // up to 60 seconds
		select {
		case <-op.ctx.Done():
			return fmt.Errorf("model load cancelled")
		case <-time.After(500 * time.Millisecond):
		}

		// Check if process already exited (works on all platforms)
		select {
		case <-exitCh:
			return fmt.Errorf("llama-server exited during model load")
		default:
		}

		resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/health", e.lifecycle.portNumber()))
		if err != nil {
			continue
		}
		resp.Body.Close()
		if resp.StatusCode == 200 {
			ready = true
			break
		}
	}

	if !ready {
		if proc := e.lifecycle.fail(op); proc != nil {
			killProcess(proc.cmd)
		}
		return fmt.Errorf("llama-server failed to start within 60 seconds")
	}

	modelName := strings.TrimSuffix(filepath.Base(modelPath), ".gguf")
	if !e.lifecycle.markReady(op, modelPath, modelName) {
		if proc := e.lifecycle.fail(op); proc != nil {
			killProcess(proc.cmd)
		}
		return fmt.Errorf("model load cancelled")
	}
	completed = true

	log.Printf("[Engine] Model loaded: %s\n", modelName)

	e.broadcast(Event{
		Type:      "status",
		Loaded:    true,
		ModelName: modelName,
		Backend:   "llama.cpp",
	})

	return nil
}

// UnloadModel stops the llama-server process
func (e *Engine) UnloadModel() {
	_ = e.UnloadModelWithError()
}

func (e *Engine) UnloadModelWithError() error {
	proc, err := e.lifecycle.beginUnload()
	if err != nil {
		return err
	}
	defer e.lifecycle.finishUnload()
	if proc != nil {
		killProcess(proc.cmd)
	}
	e.broadcast(Event{
		Type:      "status",
		Loaded:    false,
		ModelName: "",
		Backend:   "llama.cpp",
	})
	return nil
}

// StopGenerating sends abort to llama-server
func (e *Engine) StopGenerating() {
	loaded, _, _, _, proc := e.lifecycle.snapshot()
	if !loaded || proc == nil {
		return
	}

	port := proc.port
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	// Try modern endpoint first (llama.cpp b3000+), fall back to legacy
	req, err := http.NewRequestWithContext(ctx, "POST", fmt.Sprintf("http://127.0.0.1:%d/slots/0/cancel", port), nil)
	if err == nil {
		if resp, err := e.httpClient.Do(req); err == nil {
			resp.Body.Close()
			return
		}
	}
	// Legacy endpoint (pre-b3000)
	req, err = http.NewRequestWithContext(ctx, "POST", fmt.Sprintf("http://127.0.0.1:%d/slots/0?action=erase", port), nil)
	if err == nil {
		if resp, err := e.httpClient.Do(req); err == nil {
			resp.Body.Close()
		}
	}
}

// IsModelLoaded returns whether a model is currently loaded
func (e *Engine) IsModelLoaded() bool {
	loaded, _, _, _, _ := e.lifecycle.snapshot()
	return loaded
}

// GetModelName returns the currently loaded model name
func (e *Engine) GetModelName() string {
	_, _, _, name, _ := e.lifecycle.snapshot()
	return name
}

// GetModelPath returns the currently loaded model path
func (e *Engine) GetModelPath() string {
	_, _, model, _, _ := e.lifecycle.snapshot()
	return model
}

// GetModelsDir returns the models directory
func (e *Engine) GetModelsDir() string {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.modelsDir
}

// SetModelsDir updates the models directory
func (e *Engine) SetModelsDir(dir string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.modelsDir = dir
}

// SetDefaultContext updates the default context size for future model loads
func (e *Engine) SetDefaultContext(nCtx int) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if nCtx > 0 {
		e.nCtx = nCtx
	}
}

// SetGpuAccel enables or disables GPU acceleration for future model loads
func (e *Engine) SetGpuAccel(enabled bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if !enabled {
		e.nGpuLayers = 0
	} else if e.nGpuLayers == 0 {
		e.nGpuLayers = 999 // restore full GPU offload
	}
}

// GetInternalPort returns the llama-server internal port
func (e *Engine) GetInternalPort() int {
	return e.lifecycle.portNumber()
}

// IsLoading returns whether a model is currently being loaded
func (e *Engine) IsLoading() bool {
	_, loading, _, _, _ := e.lifecycle.snapshot()
	return loading
}

// ChatCompletion proxies a chat completion request to llama-server
func (e *Engine) ChatCompletion(body []byte) (*http.Response, error) {
	loaded, _, _, _, proc := e.lifecycle.snapshot()
	if !loaded || proc == nil {
		return nil, fmt.Errorf("no model loaded")
	}
	port := proc.port

	url := fmt.Sprintf("http://127.0.0.1:%d/v1/chat/completions", port)
	req, err := http.NewRequest("POST", url, strings.NewReader(string(body)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := e.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("llama-server request failed: %w", err)
	}
	return resp, nil
}

// StreamChatCompletion proxies a streaming chat completion request
func (e *Engine) StreamChatCompletion(body []byte, w http.ResponseWriter) error {
	loaded, _, _, modelName, proc := e.lifecycle.snapshot()
	if !loaded || proc == nil {
		return fmt.Errorf("no model loaded")
	}
	port := proc.port

	e.broadcast(Event{Type: "generation_start", Model: modelName})
	defer e.broadcast(Event{Type: "generation_done", Model: modelName})

	url := fmt.Sprintf("http://127.0.0.1:%d/v1/chat/completions", port)
	req, err := http.NewRequest("POST", url, strings.NewReader(string(body)))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := e.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("llama-server request failed: %w", err)
	}
	defer resp.Body.Close()

	flusher, _ := w.(http.Flusher)

	// 32 KB buffer — large enough to avoid stalls on busy token bursts
	buf := make([]byte, 32*1024)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			w.Write(buf[:n])
			if flusher != nil {
				flusher.Flush()
			}
		}
		if err != nil {
			if err == io.EOF {
				break
			}
			return err
		}
	}

	return nil
}

// ScanModels returns all .gguf files in the models directory
func (e *Engine) ScanModels() []ModelInfo {
	e.mu.RLock()
	dir := e.modelsDir
	e.mu.RUnlock()
	return scanModelsDir(dir)
}

// Subscribe to engine events
func (e *Engine) Subscribe() chan Event {
	e.eventMu.Lock()
	defer e.eventMu.Unlock()

	ch := make(chan Event, 16)
	e.subscribers = append(e.subscribers, ch)
	return ch
}

// Unsubscribe from engine events
func (e *Engine) Unsubscribe(ch chan Event) {
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

// broadcast sends an event to all subscribers
func (e *Engine) broadcast(evt Event) {
	e.eventMu.Lock()
	defer e.eventMu.Unlock()

	for _, ch := range e.subscribers {
		select {
		case ch <- evt:
		default:
			// drop if buffer full
		}
	}
}

// GetStatus returns current engine status as JSON-compatible map
func (e *Engine) GetStatus() map[string]interface{} {
	loaded, loading, model, modelName, _ := e.lifecycle.snapshot()
	e.mu.RLock()
	backend := e.gpuBackend
	nGpuLayers := e.nGpuLayers
	serverPath := e.llamaServerPath
	selectedBackend := e.selectedBackend
	e.mu.RUnlock()

	backendLabel := "llama.cpp"
	if backend != GPUBackendNone {
		backendLabel = "llama.cpp/" + string(backend)
	}

	status := map[string]interface{}{
		"loaded": loaded,
		"model":  model,
		"modelName": func() string {
			if loaded {
				return modelName
			}
			return ""
		}(),
		"backend":        backendLabel,
		"runtimeMode":    "subprocess",
		"inferenceReady": loaded,
		"gpuBackend":     string(backend),
		"gpuLayers":      nGpuLayers,
		"loading":        loading,
		"binaryPath":     serverPath,
		"cpuOnly":        backend == GPUBackendNone || nGpuLayers == 0,
	}

	if selectedBackend != nil {
		status["binaryVariant"] = selectedBackend.Variant
		status["binaryVersion"] = selectedBackend.Version
		status["binaryFallback"] = selectedBackend.Fallback
		status["binaryReason"] = selectedBackend.Reason
	}

	return status
}

// Shutdown gracefully stops the engine
func (e *Engine) Shutdown() {
	proc, _ := e.lifecycle.shutdown()
	if proc != nil {
		killProcess(proc.cmd)
	}
}

func killProcess(cmd *exec.Cmd) {
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}

func killProcessAndWait(cmd *exec.Cmd) {
	killProcess(cmd)
	if cmd != nil {
		_ = cmd.Wait()
	}
}

// HealthCheck checks if llama-server is responsive
func (e *Engine) HealthCheck() bool {
	loaded, _, _, _, proc := e.lifecycle.snapshot()
	if !loaded || proc == nil {
		return false
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("http://127.0.0.1:%d/health", proc.port), nil)
	if err != nil {
		return false
	}
	resp, err := e.httpClient.Do(req)
	if err != nil {
		return false
	}
	io.Copy(io.Discard, resp.Body)
	resp.Body.Close()
	return resp.StatusCode == 200
}
