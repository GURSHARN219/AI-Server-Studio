package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"

	"ai-server-studio-backend/engine"
	"ai-server-studio-backend/server"
)

// Usage:
//
//	aist              → GUI mode, auto-detect GPU (NVIDIA/AMD/Intel), use GPU if found
//	aist --cpu        → GUI mode, CPU only (n_gpu_layers=0)
//	aist --server     → Server/API mode, auto-detect GPU, use llama-server backend
//	aist --vllm       → GUI mode using vLLM backend
//	aist --server --vllm → Server/API mode using vLLM
//	aist --server --cpu  → Server/API mode, CPU only
//	aist --embedded   → Opt into the in-process CGO llama.cpp runtime (experimental)

const (
	defaultPort       = 1234
	defaultCtx        = 4096
	defaultModsDir    = ""
	defaultAistclawPort = 18790
)

func main() {
	// ── CLI flags ──────────────────────────────────────────────────────
	cpuOnly := flag.Bool("cpu", false, "Force CPU-only inference (no GPU)")
	server_ := flag.Bool("server", false, "Run in server/API-only mode (no GUI)")
	useVLLM := flag.Bool("vllm", false, "Use vLLM backend instead of llama-server (requires --server)")
	useEmbedded := flag.Bool("embedded", false, "Use CGO embedded llama.cpp runtime")
	singleEngine := flag.Bool("single-engine", os.Getenv("AIST_SINGLE_ENGINE") != "0", "Run Aistclaw under this backend process supervisor")
	modelsDir := flag.String("models-dir", defaultModsDir, "Directory to scan for .gguf models")
	modelPath := flag.String("model", "", "Auto-load this model on startup")
	port := flag.Int("port", defaultPort, "HTTP port to listen on")
	ctx := flag.Int("ctx", defaultCtx, "Context size (tokens)")
	flag.Parse()

	printBanner(*server_, *cpuOnly, *useVLLM)

	// ── Resolve models dir ─────────────────────────────────────────────
	if *modelsDir == "" {
		if v := os.Getenv("MODELS_DIR"); v != "" {
			*modelsDir = v
		}
	}
	if *modelPath == "" {
		if v := os.Getenv("MODEL_PATH"); v != "" {
			*modelPath = v
		}
	}

	// ── Detect GPU ─────────────────────────────────────────────────────
	gpuBackend, gpuLayers, gpuName, _ := engine.BestGPUBackend(*cpuOnly)

	switch {
	case *cpuOnly:
		log.Println("[aist] Mode: CPU only")
	case gpuBackend != engine.GPUBackendNone:
		log.Printf("[aist] GPU detected: %s → backend=%s layers=%d\n", gpuName, gpuBackend, gpuLayers)
	default:
		log.Println("[aist] No GPU detected → falling back to CPU")
	}

	// ── Choose backend ─────────────────────────────────────────────────
	var eng engine.EngineInterface

	useEmbeddedRuntime := *useEmbedded
	if *server_ && useEmbeddedRuntime {
		log.Println("[aist] --embedded is ignored in --server mode; using llama-server backend")
		useEmbeddedRuntime = false
	}

	if *useVLLM {
		log.Println("[aist] Backend: vLLM")
		eng = newVLLMEngine(*modelsDir, gpuLayers, *ctx)
	} else if *server_ || !useEmbeddedRuntime {
		log.Println("[aist] Backend: llama-server (llama.cpp)")
		eng = newLlamaEngine(*modelsDir, gpuLayers, gpuBackend, 0, *ctx)
	} else {
		log.Println("[aist] Backend: Embedded Llama (CGO)")
		eng = engine.NewEmbeddedEngine(*modelsDir, gpuLayers, *ctx, gpuBackend)
	}

	// ── Auto-load model ────────────────────────────────────────────────
	if *modelPath != "" {
		log.Printf("[aist] Auto-loading: %s\n", *modelPath)
		if err := eng.LoadModel(*modelPath, nil); err != nil {
			log.Printf("[aist] Auto-load failed: %v\n", err)
		}
	} else {
		log.Println("[aist] No model loaded. Use POST /v1/models/load to load one.")
	}

	// ── Find free port ─────────────────────────────────────────────────
	listenPort := findFreePort(*port)
	if listenPort != *port {
		log.Printf("[aist] Port %d in use → using %d\n", *port, listenPort)
	}

	// ── Start HTTP server ──────────────────────────────────────────────
	srv := server.NewWithBaseDir(eng, listenPort, filepath.Dir(func() string { e, _ := os.Executable(); return e }()))

	// Notify Electron of port via JSON on stdout
	portMsg, _ := json.Marshal(map[string]interface{}{
		"type":      "engine:port",
		"port":      listenPort,
		"gpu":       string(gpuBackend),
		"gpuName":   gpuName,
		"gpuLayers": gpuLayers,
		"mode":      modeString(*server_, *cpuOnly, *useVLLM),
	})
	fmt.Println(string(portMsg))

	var aistclawProcess *exec.Cmd
	if *singleEngine {
		aistclawProcess = startAistclawSupervisor(defaultAistclawPort)
		if aistclawProcess != nil {
			goClawMsg, _ := json.Marshal(map[string]interface{}{
				"type": "aistclaw:port",
				"port": defaultAistclawPort,
			})
			fmt.Println(string(goClawMsg))
		}
	}

	// ── Graceful shutdown ──────────────────────────────────────────────
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigChan
		log.Println("[aist] Shutting down...")
		if aistclawProcess != nil && aistclawProcess.Process != nil {
			_ = aistclawProcess.Process.Kill()
		}
		eng.Shutdown()
		os.Exit(0)
	}()

	log.Printf("[aist] Listening on http://localhost:%d\n", listenPort)
	if !*server_ {
		log.Printf("[aist] Test UI: src/backend/test_ui/index.html\n")
	}

	if err := srv.Start(); err != nil {
		log.Fatalf("[aist] Server error: %v\n", err)
	}
}

// ── Engine constructors ────────────────────────────────────────────────

func newLlamaEngine(modelsDir string, gpuLayers int, gpuBackend engine.GPUBackend, cudaMajor, nCtx int) engine.EngineInterface {
	exePath, _ := os.Executable()
	exeDir := filepath.Dir(exePath)
	searchBases := []string{exeDir}
	if cwd, err := os.Getwd(); err == nil && cwd != "" && cwd != exeDir {
		searchBases = append(searchBases, cwd)
	}

	var (
		binaryPath string
		sel        *engine.SelectedBackend
	)
	for _, baseDir := range searchBases {
		binaryPath, _, sel = engine.FindLlamaServerWithBackend(baseDir, gpuBackend, cudaMajor)
		if binaryPath != "" {
			break
		}
	}

	if binaryPath == "" {
		log.Println("[aist] WARNING: llama-server binary not found in any backend directory.")
		for _, baseDir := range searchBases {
			log.Printf("[aist]   Searched near: %s\n", baseDir)
		}
		log.Println("[aist]   Download a pre-built release from: https://github.com/ggml-org/llama.cpp/releases")
		log.Println("[aist]   Place llama-server.exe in: " + filepath.Join(exeDir, "bin"))
		// If GPU backend was requested but no GPU binary found, note the fallback
		if gpuBackend != engine.GPUBackendNone {
			log.Printf("[aist]   NOTE: No %s binary found — inference will be CPU-only\n", gpuBackend)
		}
	} else {
		log.Printf("[aist] Binary selected: %s\n", binaryPath)
		log.Printf("[aist] Reason: %s\n", sel.Reason)
		if sel.Fallback {
			log.Println("[aist] WARNING: Using CPU-only fallback — GPU binary not available")
		}
	}

	return engine.NewEngineFromSelection(sel, modelsDir, gpuLayers, nCtx, gpuBackend)
}

func newVLLMEngine(modelsDir string, gpuLayers, nCtx int) engine.EngineInterface {
	exePath, _ := os.Executable()
	exeDir := filepath.Dir(exePath)
	return engine.NewVLLMEngine(modelsDir, exeDir, gpuLayers, nCtx)
}

// ── Helpers ────────────────────────────────────────────────────────────

func findFreePort(start int) int {
	for p := start; p <= start+100; p++ {
		ln, err := net.Listen("tcp", fmt.Sprintf(":%d", p))
		if err == nil {
			ln.Close()
			return p
		}
	}
	return start
}

func modeString(serverMode, cpuOnly, vllm bool) string {
	if vllm && serverMode {
		return "server-vllm"
	}
	if vllm {
		return "gui-vllm"
	}
	if serverMode {
		return "server"
	}
	if cpuOnly {
		return "gui-cpu"
	}
	return "gui-auto"
}

func printBanner(serverMode, cpuOnly, vllm bool) {
	fmt.Println()
	fmt.Println("╔══════════════════════════════════════════╗")
	fmt.Println("║          aist — AI Server Studio         ║")
	switch {
	case vllm && serverMode:
		fmt.Println("║          mode: server  backend: vLLM     ║")
	case vllm:
		fmt.Println("║          mode: gui     backend: vLLM     ║")
	case serverMode:
		fmt.Println("║          mode: server  backend: llama    ║")
	case cpuOnly:
		fmt.Println("║          mode: gui     device: CPU only  ║")
	default:
		fmt.Println("║          mode: gui     device: auto      ║")
	}
	fmt.Println("╚══════════════════════════════════════════╝")
	fmt.Println()
}

func startAistclawSupervisor(port int) *exec.Cmd {
	exePath, _ := os.Executable()
	exeDir := filepath.Dir(exePath)
	env := append(
		os.Environ(),
		fmt.Sprintf("AISTCLAW_PORT=%d", port),
		"AISTCLAW_DESKTOP=1",
	)

	binaryCandidates := []string{
		filepath.Join(exeDir, "backend", "aistclaw.exe"),
		filepath.Join(exeDir, "..", "..", "extensions", "backend", "aistclaw.exe"),
		filepath.Join(exeDir, "aistclaw.exe"),
	}
	for _, binaryPath := range binaryCandidates {
		if _, err := os.Stat(binaryPath); err != nil {
			continue
		}
		cmd := exec.Command(binaryPath)
		cmd.Dir = filepath.Dir(binaryPath)
		cmd.Env = env
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Start(); err != nil {
			log.Printf("[aist] Failed to start Aistclaw (binary %s): %v", binaryPath, err)
			return nil
		}
		log.Printf("[aist] Aistclaw supervisor started (binary %s) on port %d", binaryPath, port)
		return cmd
	}

	devModuleDir := filepath.Join(exeDir, "aistclaw")
	if st, err := os.Stat(devModuleDir); err == nil && st.IsDir() {
		cmd := exec.Command("go", "run", ".")
		cmd.Dir = devModuleDir
		cmd.Env = env
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Start(); err != nil {
			log.Printf("[aist] Failed to start Aistclaw (source fallback): %v", err)
			return nil
		}
		log.Printf("[aist] Aistclaw supervisor started (source fallback) on port %d", port)
		return cmd
	}

	log.Printf("[aist] Aistclaw binary not found in expected locations: %v", binaryCandidates)
	return nil
}
