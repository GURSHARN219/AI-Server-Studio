package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"ai-server-studio-backend/engine"
	"ai-server-studio-backend/persistence"
	"ai-server-studio-backend/server"
)

// Usage:
//
//	aist              → GUI mode, auto-detect GPU (NVIDIA/AMD/Intel), use GPU if found
//	aist --cpu        → GUI mode, CPU only (n_gpu_layers=0)
//	aist --server     → Server/API mode, auto-detect GPU, use embedded CGO llama.cpp
//	aist --vllm       → GUI mode using vLLM backend
//	aist --server --vllm → Server/API mode using vLLM
//	aist --server --cpu  → Server/API mode, CPU only

const (
	defaultPort    = 1234
	defaultCtx     = 4096
	defaultModsDir = ""
)

func main() {
	// ── CLI flags ──────────────────────────────────────────────────────
	cpuOnly := flag.Bool("cpu", false, "Force CPU-only inference (no GPU)")
	server_ := flag.Bool("server", false, "Run in server/API-only mode (no GUI)")
	useVLLM := flag.Bool("vllm", false, "Use vLLM backend instead of llama-server (requires --server)")
	useEmbedded := flag.Bool("embedded", true, "Use CGO embedded llama.cpp runtime (always enabled for llama.cpp)")
	modelsDir := flag.String("models-dir", defaultModsDir, "Directory to scan for .gguf models")
	modelPath := flag.String("model", "", "Auto-load this model on startup")
	port := flag.Int("port", defaultPort, "HTTP port to listen on")
	ctx := flag.Int("ctx", defaultCtx, "Context size (tokens)")
	flag.Parse()

	logFile := setupEngineLogging()
	if logFile != nil {
		defer logFile.Close()
	}

	printBanner(*server_, *cpuOnly, *useVLLM)
	log.Println("[aist] Engine process started")
	if !*useEmbedded {
		log.Println("[aist] --embedded=false is ignored; llama.cpp always uses the embedded CGO runtime")
	}

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

	if *useVLLM {
		log.Println("[aist] Backend: vLLM")
		eng = newVLLMEngine(*modelsDir, gpuLayers, *ctx)
	} else {
		log.Println("[aist] Backend: llama.cpp embedded in Go (CGO)")
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
	if strings.EqualFold(strings.TrimSpace(os.Getenv("AI_SERVER_PUBLIC_PORT")), "auto") {
		publicPort := findFreePort(listenPort + 1)
		_ = os.Setenv("AI_SERVER_PUBLIC_PORT", fmt.Sprintf("%d", publicPort))
	}

	// ── Start HTTP server ──────────────────────────────────────────────
	baseDir := filepath.Dir(func() string { e, _ := os.Executable(); return e }())
	if _, err := os.Stat(filepath.Join(baseDir, "test_ui", "index.html")); err != nil {
		if cwd, cwdErr := os.Getwd(); cwdErr == nil {
			if _, uiErr := os.Stat(filepath.Join(cwd, "test_ui", "index.html")); uiErr == nil {
				baseDir = cwd
			}
		}
	}
	srv := server.NewWithBaseDir(eng, listenPort, baseDir)

	// Notify Electron of port via JSON on stdout
	portMsg, _ := json.Marshal(map[string]interface{}{
		"type":       "engine:port",
		"port":       listenPort,
		"gpu":        string(gpuBackend),
		"gpuName":    gpuName,
		"gpuLayers":  gpuLayers,
		"mode":       modeString(*server_, *cpuOnly, *useVLLM),
		"publicPort": os.Getenv("AI_SERVER_PUBLIC_PORT"),
	})
	fmt.Println(string(portMsg))

	// ── Graceful shutdown ──────────────────────────────────────────────
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(sigChan)

	log.Printf("[aist] Listening on http://localhost:%d\n", listenPort)
	if !*server_ {
		log.Printf("[aist] Test UI: test_ui/index.html\n")
	}

	serverDone := make(chan error, 1)
	go func() { serverDone <- srv.Start() }()
	select {
	case <-sigChan:
		log.Println("[aist] Shutting down...")
	case err := <-serverDone:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Printf("[aist] Server error: %v", err)
		}
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("[aist] Shutdown: %v", err)
	}
	log.Println("[aist] Engine process stopped")
}

func setupEngineLogging() *os.File {
	dataDir, err := persistence.DataDir()
	if err != nil {
		fmt.Fprintf(os.Stderr, "[aist] Could not resolve data directory for logging: %v\n", err)
		return nil
	}
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		fmt.Fprintf(os.Stderr, "[aist] Could not create log directory %q: %v\n", dataDir, err)
		return nil
	}

	logPath := filepath.Join(dataDir, "engine.log")
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[aist] Could not open log file %q: %v\n", logPath, err)
		return nil
	}

	log.SetFlags(log.Ldate | log.Ltime | log.Lmicroseconds)
	log.SetOutput(io.MultiWriter(os.Stderr, logFile))
	if err := os.Setenv("AIST_ENGINE_LOG_FILE", logPath); err != nil {
		log.Printf("[aist] Could not configure native log path: %v", err)
	}
	log.Printf("[aist] Log file: %s\n", logPath)
	return logFile
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
