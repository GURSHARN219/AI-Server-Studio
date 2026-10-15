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
	process     *exec.Cmd
	processPort int

	// Persistent HTTP client — reuses TCP connections to llama-server (no per-request dial)
	httpClient *http.Client

	// State
	loadedModel string
	modelName   string
	isLoading   bool

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
	NCtx       int  `json:"n_ctx,omitempty"`
	NGpuLayers *int `json:"n_gpu_layers"` // pointer so 0 (CPU-only) is distinguishable from "not set"
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
		processPort:     18080,
		modelName:       "local-model",
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
		processPort:     18080,
		modelName:       "local-model",
		httpClient:      newHTTPClient(),
	}
}

// LoadModel loads a GGUF model by starting llama-server with it
func (e *Engine) LoadModel(modelPath string, config *LoadConfig) error {
	// --- pre-flight checks under lock ---
	e.mu.Lock()
	if e.isLoading {
		e.mu.Unlock()
		return fmt.Errorf("already loading a model")
	}
	if e.llamaServerPath == "" {
		e.mu.Unlock()
		return fmt.Errorf("llama-server binary not found. Download from https://github.com/ggml-org/llama.cpp/releases")
	}
	if _, err := os.Stat(modelPath); err != nil {
		e.mu.Unlock()
		return fmt.Errorf("model file not found: %s", modelPath)
	}
	e.isLoading = true
	e.stopProcessLocked()

	// Increment port to avoid Windows TCP TIME_WAIT conflicts when reloading
	e.processPort++
	if e.processPort > 19000 {
		e.processPort = 18080
	}

	e.mu.Unlock()

	// ensure isLoading is cleared on return
	defer func() {
		e.mu.Lock()
		e.isLoading = false
		e.mu.Unlock()
	}()

	// --- build args (no lock needed, config is local) ---
	nCtx := e.nCtx
	nGpuLayers := e.nGpuLayers
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
		"--port", fmt.Sprintf("%d", e.processPort),
		"--host", "127.0.0.1",
		"--ctx-size", fmt.Sprintf("%d", nCtx),
		"--n-gpu-layers", fmt.Sprintf("%d", nGpuLayers),
		"-fa", "on", // flash attention (huge speed and VRAM improvement)
		"-cb", // enable continuous batching
	}

	// Add backend-specific GPU flags
	e.mu.RLock()
	backend := e.gpuBackend
	e.mu.RUnlock()

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

	cmd := exec.Command(e.llamaServerPath, args...)
	// Run from the backend dir so all sibling DLLs (ggml-cuda.dll, etc.) are found.
	// Also inject the dir into PATH as a safety net for transitive DLL loads.
	if e.llamaServerDir != "" {
		cmd.Dir = e.llamaServerDir
	} else {
		cmd.Dir = filepath.Dir(e.llamaServerPath)
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

	// store process reference under lock
	e.mu.Lock()
	e.process = cmd
	e.mu.Unlock()

	// exitCh is closed when the process exits — used by the health loop below.
	exitCh := make(chan struct{})
	go func() {
		cmd.Wait() // reaps the process; also drains stderr pipe
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
		time.Sleep(500 * time.Millisecond)

		// Check if process already exited (works on all platforms)
		select {
		case <-exitCh:
			return fmt.Errorf("llama-server exited during model load")
		default:
		}

		resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/health", e.processPort))
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
		e.mu.Lock()
		e.stopProcessLocked()
		e.mu.Unlock()
		return fmt.Errorf("llama-server failed to start within 60 seconds")
	}

	e.mu.Lock()
	e.loadedModel = modelPath
	e.modelName = strings.TrimSuffix(filepath.Base(modelPath), ".gguf")
	e.mu.Unlock()

	log.Printf("[Engine] Model loaded: %s\n", e.modelName)

	e.broadcast(Event{
		Type:      "status",
		Loaded:    true,
		ModelName: e.modelName,
		Backend:   "llama.cpp",
	})

	return nil
}

// UnloadModel stops the llama-server process
func (e *Engine) UnloadModel() {
	e.mu.Lock()
	defer e.mu.Unlock()

	e.stopProcessLocked()
	e.loadedModel = ""
	e.modelName = "local-model"

	e.broadcast(Event{
		Type:      "status",
		Loaded:    false,
		ModelName: e.modelName,
		Backend:   "llama.cpp",
	})
}

// StopGenerating sends abort to llama-server
func (e *Engine) StopGenerating() {
	e.mu.RLock()
	defer e.mu.RUnlock()

	if e.process == nil {
		return
	}

	port := e.processPort
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
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.loadedModel != ""
}

// GetModelName returns the currently loaded model name
func (e *Engine) GetModelName() string {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.modelName
}

// GetModelPath returns the currently loaded model path
func (e *Engine) GetModelPath() string {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.loadedModel
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
	return e.processPort
}

// IsLoading returns whether a model is currently being loaded
func (e *Engine) IsLoading() bool {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.isLoading
}

// ChatCompletion proxies a chat completion request to llama-server
func (e *Engine) ChatCompletion(body []byte) (*http.Response, error) {
	e.mu.RLock()
	if e.loadedModel == "" {
		e.mu.RUnlock()
		return nil, fmt.Errorf("no model loaded")
	}
	port := e.processPort
	e.mu.RUnlock()

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
	e.mu.RLock()
	if e.loadedModel == "" {
		e.mu.RUnlock()
		return fmt.Errorf("no model loaded")
	}
	port := e.processPort
	modelName := e.modelName
	e.mu.RUnlock()

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

	flusher, ok := w.(http.Flusher)
	if !ok {
		return fmt.Errorf("streaming not supported")
	}

	// 32 KB buffer — large enough to avoid stalls on busy token bursts
	buf := make([]byte, 32*1024)
	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			w.Write(buf[:n])
			flusher.Flush()
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
	e.mu.RLock()
	defer e.mu.RUnlock()

	backendLabel := "llama.cpp"
	if e.gpuBackend != GPUBackendNone {
		backendLabel = "llama.cpp/" + string(e.gpuBackend)
	}

	status := map[string]interface{}{
		"loaded": e.loadedModel != "",
		"model":  e.loadedModel,
		"modelName": func() string {
			if e.loadedModel != "" {
				return e.modelName
			} else {
				return ""
			}
		}(),
		"backend":    backendLabel,
		"gpuBackend": string(e.gpuBackend),
		"gpuLayers":  e.nGpuLayers,
		"loading":    e.isLoading,
		"binaryPath": e.llamaServerPath,
		"cpuOnly":    e.gpuBackend == GPUBackendNone || e.nGpuLayers == 0,
	}

	if e.selectedBackend != nil {
		status["binaryVariant"] = e.selectedBackend.Variant
		status["binaryVersion"] = e.selectedBackend.Version
		status["binaryFallback"] = e.selectedBackend.Fallback
		status["binaryReason"] = e.selectedBackend.Reason
	}

	return status
}

// Shutdown gracefully stops the engine
func (e *Engine) Shutdown() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.stopProcessLocked()
}

func (e *Engine) stopProcessLocked() {
	if e.process != nil && e.process.Process != nil {
		log.Println("[Engine] Stopping llama-server process...")
		e.process.Process.Kill()
		// Don't call Wait() here — the exit goroutine in LoadModel handles it.
		// Just nil out the reference so we don't double-kill.
		e.process = nil
	}
}

// HealthCheck checks if llama-server is responsive
func (e *Engine) HealthCheck() bool {
	e.mu.RLock()
	defer e.mu.RUnlock()

	if e.process == nil {
		return false
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", fmt.Sprintf("http://127.0.0.1:%d/health", e.processPort), nil)
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
