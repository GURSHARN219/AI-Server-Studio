package main

import (
	"fmt"
	"io"
)

// These values are replaced by the release build script through -ldflags.
// Development builds retain useful, explicit fallback values.
var (
	appVersion = "0.1.01-dev"
	gitCommit  = "unknown"
	buildDate  = "unknown"
)

func printVersion(w io.Writer) {
	fmt.Fprintf(w, "AI Server Studio %s\n", appVersion)
	fmt.Fprintf(w, "Git commit: %s\n", gitCommit)
	fmt.Fprintf(w, "Build date: %s\n", buildDate)
}

func printUsage(w io.Writer) {
	fmt.Fprintln(w, "AI Server Studio")
	fmt.Fprintln(w, "")
	fmt.Fprintln(w, "Usage:")
	fmt.Fprintln(w, "  AI-Server-Studio.exe [flags]")
	fmt.Fprintln(w, "")
	fmt.Fprintln(w, "Modes:")
	fmt.Fprintln(w, "  (no flags)          Launch the Wails desktop application")
	fmt.Fprintln(w, "  --server            Run the HTTP API without opening a desktop window")
	fmt.Fprintln(w, "")
	fmt.Fprintln(w, "Flags:")
	fmt.Fprintf(w, "  --server            headless API-only mode (default: false)\n")
	fmt.Fprintf(w, "  --help, -h          show this help text\n")
	fmt.Fprintf(w, "  --version           print version, commit, and build date\n")
	fmt.Fprintf(w, "  --port int          HTTP port, 0 selects a free port (default: %d)\n", defaultPort)
	fmt.Fprintf(w, "  --cpu               force CPU-only inference (default: false)\n")
	fmt.Fprintf(w, "  --vllm              use vLLM; requires --server (default: false)\n")
	fmt.Fprintf(w, "  --ctx int            context size in tokens (default: %d)\n", defaultCtx)
	fmt.Fprintln(w, "  --model string      load this model at startup (default: empty)")
	fmt.Fprintln(w, "  --models-dir path   directory to scan for models (default: executable data/models)")
	fmt.Fprintln(w, "")
	fmt.Fprintln(w, "Examples:")
	fmt.Fprintln(w, "  AI-Server-Studio.exe")
	fmt.Fprintln(w, "  AI-Server-Studio.exe --server --port 1234")
	fmt.Fprintln(w, "  AI-Server-Studio.exe --server --cpu --model models\\model.gguf")
}
