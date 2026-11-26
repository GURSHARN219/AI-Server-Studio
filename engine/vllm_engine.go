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

	"ai-server-studio-backend/portable"
)

// VLLMEngine spawns a vLLM OpenAI-compatible server as a subprocess and
// proxies all requests to it. vLLM must be installed (or use the embedded Python):
//
//	pip install vllm  OR  POST /v1/python/install
//
// vLLM only supports GPU (CUDA). For CPU-only machines it will error on load.
type VLLMEngine struct {
	mu sync.RWMutex

	modelsDir  string
	baseDir    string // exe directory, used to locate embedded Python
	nGpuLayers int    // unused by vLLM (it always uses full GPU), kept for interface compat
	nCtx       int
	lifecycle  *lifecycleCoordinator

	eventMu     sync.Mutex
	subscribers []chan Event
}

// NewVLLMEngine creates a new vLLM engine instance.
// baseDir is the directory of the running executable (used to find embedded Python).
func NewVLLMEngine(modelsDir, baseDir string, nGpuLayers, nCtx int) *VLLMEngine {
	return &VLLMEngine{
		modelsDir:  modelsDir,
		baseDir:    baseDir,
		nGpuLayers: nGpuLayers,
		nCtx:       nCtx,
		lifecycle:  newLifecycleCoordinator(18081), // separate port from llama-server (18080)
	}
}

// FindPython returns the path to a usable python executable with vLLM installed.
// Checks: python3, python, py (Windows launcher).
func FindPython() (string, error) {
	paths, err := portable.Resolve()
	if err != nil {
		return "", fmt.Errorf("resolve portable paths: %w", err)
	}
	candidates := []string{"python3", "python", "py"}
	for _, name := range candidates {
		p, err := exec.LookPath(name)
		if err != nil {
			continue
		}
		// Verify vLLM is importable
		check := exec.Command(p, "-c", "import vllm; print(vllm.__version__)")
		check.Env = paths.ChildEnvironment(os.Environ())
		out, err := check.Output()
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
	e.mu.RLock()
	modelsDir, baseDir, defaultCtx := e.modelsDir, e.baseDir, e.nCtx
	e.mu.RUnlock()
	local := looksLikeLocalModelPath(modelsDir, modelPath)
	if local {
		var err error
		modelPath, err = resolveModelPath(modelsDir, modelPath, true)
		if err != nil {
			return err
		}
	} else if err := validateModelID(modelPath); err != nil {
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

	python, err := FindPythonWithInstaller(baseDir)
	if err != nil {
		return err
	}

	nCtx := defaultCtx
	if config != nil && config.NCtx > 0 {
		nCtx = config.NCtx
	}

	// vLLM args — model can be a HuggingFace ID ("meta-llama/Llama-3-8B") or local path
	args := buildVLLMArgs(modelPath, e.lifecycle.portNumber(), nCtx, local, config)

	log.Printf("[vLLM] Starting: %s %s\n", python, strings.Join(args, " "))

	cmd := exec.Command(python, args...)
	paths, err := portable.Resolve()
	if err != nil {
		return fmt.Errorf("resolve portable paths for vLLM: %w", err)
	}
	cmd.Env = paths.ChildEnvironment(os.Environ())

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

	if !e.lifecycle.attachProcess(op, cmd) {
		killProcessAndWait(cmd)
		return fmt.Errorf("model load cancelled")
	}

	// Stream vLLM output to our log
	go pipeToLog("[vLLM]", stderr)
	go pipeToLog("[vLLM]", stdout)

	// Health check — vLLM can take 30–120s to load large models
	log.Println("[vLLM] Waiting for server to be ready (this may take a while)...")

	exitCh := make(chan struct{})
	go func() {
		_ = cmd.Wait()
		if e.lifecycle.processExited(op, cmd) {
			e.broadcast(Event{Type: "status", Loaded: false, Backend: "vllm", Message: "vLLM process exited"})
		}
		close(exitCh)
	}()

	ready := false
	for i := 0; i < 240; i++ { // up to 120 seconds
		select {
		case <-op.ctx.Done():
			return fmt.Errorf("model load cancelled")
		case <-time.After(500 * time.Millisecond):
		}

		select {
		case <-exitCh:
			return fmt.Errorf("vLLM process exited unexpectedly during startup")
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
		return fmt.Errorf("vLLM failed to start within 120 seconds")
	}

	modelName := filepath.Base(modelPath)
	if !e.lifecycle.markReady(op, modelPath, modelName) {
		if proc := e.lifecycle.fail(op); proc != nil {
			killProcess(proc.cmd)
		}
		return fmt.Errorf("model load cancelled")
	}
	completed = true

	log.Printf("[vLLM] Ready: %s\n", modelName)
	e.broadcast(Event{Type: "status", Loaded: true, ModelName: modelName, Backend: "vllm"})
	return nil
}

func buildVLLMArgs(modelPath string, port, nCtx int, local bool, config *LoadConfig) []string {
	args := []string{
		"-m", "vllm.entrypoints.openai.api_server",
		"--model", modelPath,
		"--port", fmt.Sprintf("%d", port),
		"--host", "127.0.0.1",
		"--max-model-len", fmt.Sprintf("%d", nCtx),
		"--disable-log-requests",
	}
	if config != nil && config.TrustRemoteCode != nil && *config.TrustRemoteCode {
		args = append(args, "--trust-remote-code")
	}
	if local {
		args = append(args, "--tokenizer", modelPath)
	}
	return args
}

// UnloadModel stops the vLLM process.
func (e *VLLMEngine) UnloadModel() {
	_ = e.UnloadModelWithError()
}

func (e *VLLMEngine) UnloadModelWithError() error {
	proc, err := e.lifecycle.beginUnload()
	if err != nil {
		return err
	}
	defer e.lifecycle.finishUnload()
	if proc != nil {
		killProcess(proc.cmd)
	}
	e.broadcast(Event{Type: "status", Loaded: false, Backend: "vllm"})
	return nil
}

// StopGenerating — vLLM handles this internally; no-op here.
func (e *VLLMEngine) StopGenerating() {}

func (e *VLLMEngine) IsModelLoaded() bool {
	loaded, _, _, _, _ := e.lifecycle.snapshot()
	return loaded
}

func (e *VLLMEngine) IsLoading() bool {
	_, loading, _, _, _ := e.lifecycle.snapshot()
	return loading
}

func (e *VLLMEngine) GetModelName() string {
	_, _, _, name, _ := e.lifecycle.snapshot()
	return name
}

func (e *VLLMEngine) GetModelPath() string {
	_, _, model, _, _ := e.lifecycle.snapshot()
	return model
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

func (e *VLLMEngine) GetInternalPort() int { return e.lifecycle.portNumber() }

func (e *VLLMEngine) GetStatus() map[string]interface{} {
	loaded, loading, model, modelName, _ := e.lifecycle.snapshot()
	return map[string]interface{}{
		"loaded": loaded,
		"model":  model,
		"modelName": func() string {
			if loaded {
				return modelName
			}
			return ""
		}(),
		"backend": "vllm",
		"loading": loading,
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
	loaded, _, _, _, proc := e.lifecycle.snapshot()
	if !loaded || proc == nil {
		return nil, fmt.Errorf("no model loaded")
	}
	port := proc.port

	url := fmt.Sprintf("http://127.0.0.1:%d/v1/chat/completions", port)
	resp, err := http.Post(url, "application/json", strings.NewReader(string(body)))
	if err != nil {
		return nil, fmt.Errorf("vLLM request failed: %w", err)
	}
	return resp, nil
}

// StreamChatCompletion proxies a streaming SSE request to vLLM.
func (e *VLLMEngine) StreamChatCompletion(body []byte, w http.ResponseWriter) error {
	loaded, _, _, modelName, proc := e.lifecycle.snapshot()
	if !loaded || proc == nil {
		return fmt.Errorf("no model loaded")
	}
	port := proc.port

	e.broadcast(Event{Type: "generation_start", Model: modelName})
	defer e.broadcast(Event{Type: "generation_done", Model: modelName})

	url := fmt.Sprintf("http://127.0.0.1:%d/v1/chat/completions", port)
	resp, err := http.Post(url, "application/json", strings.NewReader(string(body)))
	if err != nil {
		return fmt.Errorf("vLLM request failed: %w", err)
	}
	defer resp.Body.Close()

	flusher, _ := w.(http.Flusher)

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
		if flusher != nil {
			flusher.Flush()
		}
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
	loaded, _, _, _, proc := e.lifecycle.snapshot()
	if !loaded || proc == nil {
		return false
	}
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/health", proc.port))
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == 200
}

func (e *VLLMEngine) Shutdown() {
	proc, _ := e.lifecycle.shutdown()
	if proc != nil {
		killProcess(proc.cmd)
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

func pipeToLog(prefix string, r io.Reader) {
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		line := scanner.Text()
		if line != "" {
			log.Printf("%s %s\n", prefix, line)
		}
	}
}
