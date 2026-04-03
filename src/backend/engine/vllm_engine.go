package engine

import (
	"bufio"
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

// VLLMEngine spawns a vLLM OpenAI-compatible server as a subprocess and
// proxies all requests to it. vLLM must be installed (or use the embedded Python):
//
//	pip install vllm  OR  POST /v1/python/install
//
// vLLM only supports GPU (CUDA). For CPU-only machines it will error on load.
type VLLMEngine struct {
	mu sync.RWMutex

	modelsDir   string
	baseDir     string // exe directory, used to locate embedded Python
	nGpuLayers  int    // unused by vLLM (it always uses full GPU), kept for interface compat
	nCtx        int
	processPort int

	process     *exec.Cmd
	loadedModel string
	modelName   string
	isLoading   bool

	eventMu     sync.Mutex
	subscribers []chan Event
}

// NewVLLMEngine creates a new vLLM engine instance.
// baseDir is the directory of the running executable (used to find embedded Python).
func NewVLLMEngine(modelsDir, baseDir string, nGpuLayers, nCtx int) *VLLMEngine {
	return &VLLMEngine{
		modelsDir:   modelsDir,
		baseDir:     baseDir,
		nGpuLayers:  nGpuLayers,
		nCtx:        nCtx,
		processPort: 18081, // separate port from llama-server (18080)
		modelName:   "local-model",
	}
}

// FindPython returns the path to a usable python executable with vLLM installed.
// Checks: python3, python, py (Windows launcher).
func FindPython() (string, error) {
	candidates := []string{"python3", "python", "py"}
	for _, name := range candidates {
		p, err := exec.LookPath(name)
		if err != nil {
			continue
		}
		// Verify vLLM is importable
		out, err := exec.Command(p, "-c", "import vllm; print(vllm.__version__)").Output()
		if err == nil {
			ver := strings.TrimSpace(string(out))
			log.Printf("[vLLM] Found vLLM %s via %s\n", ver, p)
			return p, nil
		}
	}
	return "", fmt.Errorf("vLLM not found. Install with: pip install vllm")
}

// LoadModel starts vLLM with the given model (HuggingFace model ID or local path).
func (e *VLLMEngine) LoadModel(modelPath string, config *LoadConfig) error {
	e.mu.Lock()
	if e.isLoading {
		e.mu.Unlock()
		return fmt.Errorf("already loading a model")
	}
	e.isLoading = true
	e.stopProcessLocked()
	e.mu.Unlock()

	defer func() {
		e.mu.Lock()
		e.isLoading = false
		e.mu.Unlock()
	}()

	python, err := FindPythonWithInstaller(e.baseDir)
	if err != nil {
		return err
	}

	nCtx := e.nCtx
	if config != nil && config.NCtx > 0 {
		nCtx = config.NCtx
	}

	// vLLM args — model can be a HuggingFace ID ("meta-llama/Llama-3-8B") or local path
	args := []string{
		"-m", "vllm.entrypoints.openai.api_server",
		"--model", modelPath,
		"--port", fmt.Sprintf("%d", e.processPort),
		"--host", "127.0.0.1",
		"--max-model-len", fmt.Sprintf("%d", nCtx),
		"--trust-remote-code",
		"--disable-log-requests",
	}

	// If a local GGUF path is given, tell vLLM it's a local file
	if isLocalPath(modelPath) {
		args = append(args, "--tokenizer", modelPath)
	}

	log.Printf("[vLLM] Starting: %s %s\n", python, strings.Join(args, " "))

	cmd := exec.Command(python, args...)
	cmd.Env = os.Environ()

	stderr, err := cmd.StderrPipe()
	if err != nil {
		return fmt.Errorf("stderr pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("stdout pipe: %w", err)
	}

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start vLLM: %w", err)
	}

	e.mu.Lock()
	e.process = cmd
	e.mu.Unlock()

	// Stream vLLM output to our log
	go pipeToLog("[vLLM]", stderr)
	go pipeToLog("[vLLM]", stdout)

	// Health check — vLLM can take 30–120s to load large models
	log.Println("[vLLM] Waiting for server to be ready (this may take a while)...")

	exitCh := make(chan struct{})
	go func() {
		cmd.Wait()
		close(exitCh)
	}()

	ready := false
	for i := 0; i < 240; i++ { // up to 120 seconds
		time.Sleep(500 * time.Millisecond)

		select {
		case <-exitCh:
			return fmt.Errorf("vLLM process exited unexpectedly during startup")
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
		return fmt.Errorf("vLLM failed to start within 120 seconds")
	}

	e.mu.Lock()
	e.loadedModel = modelPath
	e.modelName = filepath.Base(modelPath)
	e.mu.Unlock()

	log.Printf("[vLLM] Ready: %s\n", e.modelName)
	e.broadcast(Event{Type: "status", Loaded: true, ModelName: e.modelName, Backend: "vllm"})
	return nil
}

// UnloadModel stops the vLLM process.
func (e *VLLMEngine) UnloadModel() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.stopProcessLocked()
	e.loadedModel = ""
	e.modelName = "local-model"
	e.broadcast(Event{Type: "status", Loaded: false, Backend: "vllm"})
}

// StopGenerating — vLLM handles this internally; no-op here.
func (e *VLLMEngine) StopGenerating() {}

func (e *VLLMEngine) IsModelLoaded() bool {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.loadedModel != ""
}

func (e *VLLMEngine) IsLoading() bool {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.isLoading
}

func (e *VLLMEngine) GetModelName() string {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.modelName
}

func (e *VLLMEngine) GetModelPath() string {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.loadedModel
}

func (e *VLLMEngine) GetModelsDir() string {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return e.modelsDir
}

func (e *VLLMEngine) SetModelsDir(dir string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.modelsDir = dir
}

func (e *VLLMEngine) SetDefaultContext(nCtx int) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if nCtx > 0 {
		e.nCtx = nCtx
	}
}

func (e *VLLMEngine) SetGpuAccel(enabled bool) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if !enabled {
		e.nGpuLayers = 0
	} else if e.nGpuLayers == 0 {
		e.nGpuLayers = 999
	}
}

func (e *VLLMEngine) GetInternalPort() int { return e.processPort }

func (e *VLLMEngine) GetStatus() map[string]interface{} {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return map[string]interface{}{
		"loaded":    e.loadedModel != "",
		"model":     e.loadedModel,
		"modelName": e.modelName,
		"backend":   "vllm",
		"loading":   e.isLoading,
	}
}

func (e *VLLMEngine) ScanModels() []ModelInfo {
	e.mu.RLock()
	dir := e.modelsDir
	e.mu.RUnlock()
	return scanModelsDir(dir)
}

// ChatCompletion proxies a non-streaming request to vLLM.
func (e *VLLMEngine) ChatCompletion(body []byte) (*http.Response, error) {
	e.mu.RLock()
	if e.loadedModel == "" {
		e.mu.RUnlock()
		return nil, fmt.Errorf("no model loaded")
	}
	port := e.processPort
	e.mu.RUnlock()

	url := fmt.Sprintf("http://127.0.0.1:%d/v1/chat/completions", port)
	resp, err := http.Post(url, "application/json", strings.NewReader(string(body)))
	if err != nil {
		return nil, fmt.Errorf("vLLM request failed: %w", err)
	}
	return resp, nil
}

// StreamChatCompletion proxies a streaming SSE request to vLLM.
func (e *VLLMEngine) StreamChatCompletion(body []byte, w http.ResponseWriter) error {
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
	resp, err := http.Post(url, "application/json", strings.NewReader(string(body)))
	if err != nil {
		return fmt.Errorf("vLLM request failed: %w", err)
	}
	defer resp.Body.Close()

	flusher, ok := w.(http.Flusher)
	if !ok {
		return fmt.Errorf("streaming not supported")
	}

	reader := bufio.NewReader(resp.Body)
	for {
		line, err := reader.ReadBytes('\n')
		if err != nil {
			if err == io.EOF {
				break
			}
			return err
		}
		w.Write(line)
		flusher.Flush()
	}
	return nil
}

func (e *VLLMEngine) Subscribe() chan Event {
	e.eventMu.Lock()
	defer e.eventMu.Unlock()
	ch := make(chan Event, 16)
	e.subscribers = append(e.subscribers, ch)
	return ch
}

func (e *VLLMEngine) Unsubscribe(ch chan Event) {
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

func (e *VLLMEngine) HealthCheck() bool {
	e.mu.RLock()
	defer e.mu.RUnlock()
	if e.process == nil {
		return false
	}
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/health", e.processPort))
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == 200
}

func (e *VLLMEngine) Shutdown() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.stopProcessLocked()
}

func (e *VLLMEngine) stopProcessLocked() {
	if e.process != nil && e.process.Process != nil {
		log.Println("[vLLM] Stopping process...")
		e.process.Process.Kill()
		// Don't Wait() here — the pipe goroutines will drain and exit naturally.
		// Just nil the reference to prevent double-kill.
		e.process = nil
	}
}

func (e *VLLMEngine) broadcast(evt Event) {
	e.eventMu.Lock()
	defer e.eventMu.Unlock()
	for _, ch := range e.subscribers {
		select {
		case ch <- evt:
		default:
		}
	}
}

// ── helpers ────────────────────────────────────────────────────────────

func isLocalPath(s string) bool {
	// Treat as local if it contains a path separator or starts with . or /
	return strings.ContainsAny(s, "/\\") || strings.HasPrefix(s, ".")
}

func pipeToLog(prefix string, r io.Reader) {
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		line := scanner.Text()
		if line != "" {
			log.Printf("%s %s\n", prefix, line)
		}
	}
}
