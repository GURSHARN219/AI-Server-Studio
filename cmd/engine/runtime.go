package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"ai-server-studio-backend/engine"
	"ai-server-studio-backend/portable"
	"ai-server-studio-backend/server"
)

type backendRuntime struct {
	srv          *server.Server
	logFile      *os.File
	gpu          engine.GPUBackend
	gpuName      string
	gpuLayers    int
	serverURL    string
	shutdownOnce sync.Once
	shutdownErr  error
}

func startBackend(options cliOptions) (*backendRuntime, error) {
	portablePaths, err := portable.Resolve()
	if err != nil {
		return nil, fmt.Errorf("resolve portable paths: %w", err)
	}
	if portablePaths.UsingLegacy {
		log.Printf("[aist] Portable layout: legacy compatibility (%s); preserving existing data root %s\n", portablePaths.LegacyRoot, portablePaths.Data)
	} else {
		log.Printf("[aist] Portable layout: canonical executable-rooted storage at %s\n", portablePaths.Root)
	}
	if err := portablePaths.ApplyEnvironment(); err != nil {
		return nil, fmt.Errorf("apply portable environment: %w", err)
	}
	logFile, err := setupEngineLogging(portablePaths)
	if err != nil {
		return nil, fmt.Errorf("start logging: %w", err)
	}
	log.Printf("[aist] Effective paths: root=%s data=%s config=%s cache=%s temp=%s", portablePaths.Root, portablePaths.Data, portablePaths.Config, portablePaths.Cache, portablePaths.Temp)
	log.Printf("[aist] Windows environment: APPDATA=%q LOCALAPPDATA=%q USERPROFILE=%q TEMP=%q TMP=%q", os.Getenv("APPDATA"), os.Getenv("LOCALAPPDATA"), os.Getenv("USERPROFILE"), os.Getenv("TEMP"), os.Getenv("TMP"))

	cleanup := func(startErr error) (*backendRuntime, error) {
		_ = logFile.Close()
		return nil, startErr
	}

	printBanner(options.server, options.cpu, options.vllm)
	log.Println("[aist] Engine process started")

	modelsDir := strings.TrimSpace(options.modelsDir)
	if modelsDir == "" {
		for _, name := range []string{"MODELS_DIR", "AIST_MODELS_DIR", "AI_SERVER_MODELS_DIR"} {
			if value := strings.TrimSpace(os.Getenv(name)); value != "" {
				modelsDir = value
				break
			}
		}
		if modelsDir == "" {
			modelsDir = portablePaths.Models
		}
	}
	modelPath := strings.TrimSpace(options.model)
	if modelPath == "" {
		modelPath = strings.TrimSpace(os.Getenv("MODEL_PATH"))
	}

	gpuBackend, gpuLayers, gpuName, _ := engine.BestGPUBackend(options.cpu)
	switch {
	case options.cpu:
		log.Println("[aist] Mode: CPU only")
	case gpuBackend != engine.GPUBackendNone:
		log.Printf("[aist] GPU detected: %s → backend=%s layers=%d\n", gpuName, gpuBackend, gpuLayers)
	default:
		log.Println("[aist] No GPU detected → falling back to CPU")
	}

	var eng engine.EngineInterface
	if options.vllm {
		log.Println("[aist] Backend: vLLM")
		eng = newVLLMEngine(modelsDir, gpuLayers, options.ctx)
	} else {
		log.Println("[aist] Backend: llama.cpp embedded in Go (CGO)")
		eng = engine.NewEmbeddedEngine(modelsDir, gpuLayers, options.ctx, gpuBackend)
	}
	if modelPath != "" {
		log.Printf("[aist] Auto-loading: %s\n", modelPath)
		if err := eng.LoadModel(modelPath, nil); err != nil {
			log.Printf("[aist] Auto-load failed: %v", err)
		}
	} else {
		log.Println("[aist] No model loaded. Use POST /v1/models/load to load one.")
	}

	if strings.EqualFold(strings.TrimSpace(os.Getenv("AI_SERVER_PUBLIC_PORT")), "auto") {
		publicPort := findFreePort(options.port + 1)
		_ = os.Setenv("AI_SERVER_PUBLIC_PORT", fmt.Sprintf("%d", publicPort))
	}

	executable, _ := os.Executable()
	baseDir := filepath.Dir(executable)
	if baseDir == "." || baseDir == "" {
		baseDir, _ = os.Getwd()
	}
	frontendDir := strings.TrimSpace(os.Getenv("AIST_FRONTEND_DIR"))
	runtimeBaseDir := baseDir
	if _, statErr := os.Stat(filepath.Join(baseDir, "test_ui", "index.html")); statErr != nil {
		if cwd, cwdErr := os.Getwd(); cwdErr == nil {
			if _, uiErr := os.Stat(filepath.Join(cwd, "test_ui", "index.html")); uiErr == nil {
				log.Printf("[aist] Using development test UI from %s\n", cwd)
				runtimeBaseDir = cwd
			}
		}
	}

	// The Wails asset server owns the UI in desktop mode. Headless mode is
	// intentionally API-only as well; neither mode opens a system browser.
	srv := server.NewWithBaseDirAndFrontendMode(eng, options.port, runtimeBaseDir, frontendDir, false)
	if err := srv.Listen(); err != nil {
		// A failed listener must still release the repositories and the
		// SQLite handle the constructor already opened.
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_ = srv.Shutdown(shutdownCtx)
		cancel()
		eng.Shutdown()
		return cleanup(fmt.Errorf("bind local API: %w", err))
	}
	runtime := &backendRuntime{
		srv:       srv,
		logFile:   logFile,
		gpu:       gpuBackend,
		gpuName:   gpuName,
		gpuLayers: gpuLayers,
		serverURL: srv.ActualURL(),
	}
	log.Printf("[aist] Listening on %s\n", runtime.serverURL)
	return runtime, nil
}

func (r *backendRuntime) serve() <-chan error {
	done := make(chan error, 1)
	go func() { done <- r.srv.Serve() }()
	return done
}

func (r *backendRuntime) shutdown() error {
	r.shutdownOnce.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		r.shutdownErr = r.srv.Shutdown(ctx)
		if closeErr := r.logFile.Close(); r.shutdownErr == nil {
			r.shutdownErr = closeErr
		}
		log.Println("[aist] Engine process stopped")
	})
	return r.shutdownErr
}

func runHeadless(options cliOptions) error {
	runtime, err := startBackend(options)
	if err != nil {
		return err
	}
	defer func() { _ = runtime.shutdown() }()

	serverDone := runtime.serve()
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(sigChan)
	if shutdownFile := strings.TrimSpace(os.Getenv("AIST_TEST_SHUTDOWN_FILE")); shutdownFile != "" {
		go watchTestShutdownFile(shutdownFile, sigChan)
	}

	portMsg, _ := json.Marshal(map[string]interface{}{
		"type":       "engine:port",
		"port":       runtime.srv.ActualPort(),
		"gpu":        string(runtime.gpu),
		"gpuName":    runtime.gpuName,
		"gpuLayers":  runtime.gpuLayers,
		"mode":       modeString(true, options.cpu, options.vllm),
		"publicPort": os.Getenv("AI_SERVER_PUBLIC_PORT"),
	})
	fmt.Printf("[aist] Headless server listening on %s (port=%d, mode=%s)\n", runtime.serverURL, runtime.srv.ActualPort(), modeString(true, options.cpu, options.vllm))
	fmt.Println(string(portMsg))

	select {
	case <-sigChan:
		log.Println("[aist] Shutting down...")
	case err := <-serverDone:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("server stopped: %w", err)
		}
	}
	return nil
}

func watchTestShutdownFile(path string, signals chan<- os.Signal) {
	for {
		if _, err := os.Stat(path); err == nil {
			signals <- os.Interrupt
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
}

func setupEngineLogging(paths portable.Paths) (*os.File, error) {
	if err := os.MkdirAll(paths.Logs, 0o700); err != nil {
		return nil, fmt.Errorf("create log directory %q: %w", paths.Logs, err)
	}
	logFile, err := os.OpenFile(paths.EngineLog, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open log file %q: %w", paths.EngineLog, err)
	}
	log.SetFlags(log.Ldate | log.Ltime | log.Lmicroseconds)
	log.SetOutput(io.MultiWriter(os.Stderr, logFile))
	if err := os.Setenv("AIST_ENGINE_LOG_FILE", paths.EngineLog); err != nil {
		_ = logFile.Close()
		return nil, fmt.Errorf("configure native log path: %w", err)
	}
	log.Printf("[aist] Log file: %s\n", paths.EngineLog)
	return logFile, nil
}

func newVLLMEngine(modelsDir string, gpuLayers, nCtx int) engine.EngineInterface {
	executable, _ := os.Executable()
	return engine.NewVLLMEngine(modelsDir, filepath.Dir(executable), gpuLayers, nCtx)
}

func findFreePort(start int) int {
	if start < 1 {
		start = 1
	}
	for port := start; port <= start+100 && port <= 65535; port++ {
		listener, err := net.Listen("tcp", fmt.Sprintf(":%d", port))
		if err == nil {
			_ = listener.Close()
			return port
		}
	}
	return start
}

func modeString(serverMode, cpuOnly, vllm bool) string {
	if vllm {
		return "server-vllm"
	}
	if serverMode {
		return "server"
	}
	if cpuOnly {
		return "desktop-cpu"
	}
	return "desktop-auto"
}

func printBanner(serverMode, cpuOnly, vllm bool) {
	fmt.Println("=== AI Server Studio ===")
	switch {
	case vllm:
		fmt.Println("mode: server; backend: vLLM")
	case serverMode:
		fmt.Println("mode: server; backend: llama")
	case cpuOnly:
		fmt.Println("mode: desktop; device: CPU only")
	default:
		fmt.Println("mode: desktop; device: auto")
	}
	fmt.Println()
}
