package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
)

// Usage:
//
//	aist                  → Wails desktop window + local API
//	aist --server         → headless API-only mode
//	aist --server --vllm → headless API-only mode using vLLM
//	aist --cpu            → GUI mode, CPU only

const (
	defaultPort    = 1234
	defaultCtx     = 4096
	defaultModsDir = ""
	maxContextSize = 131072
)

type cliOptions struct {
	server    bool
	version   bool
	vllm      bool
	cpu       bool
	port      int
	ctx       int
	model     string
	modelsDir string
}

func parseCLI(args []string) (cliOptions, error) {
	options := cliOptions{port: defaultPort, ctx: defaultCtx, modelsDir: defaultModsDir}
	flags := flag.NewFlagSet("aist", flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	flags.Usage = func() {}
	flags.BoolVar(&options.server, "server", false, "Run headless API-only mode (never open a browser)")
	flags.BoolVar(&options.version, "version", false, "Print build version information and exit")
	flags.BoolVar(&options.vllm, "vllm", false, "Use the vLLM backend (requires --server)")
	flags.BoolVar(&options.cpu, "cpu", false, "Force CPU-only inference (no GPU)")
	flags.IntVar(&options.port, "port", defaultPort, "HTTP port to listen on (0-65535; 0 selects a free port)")
	flags.IntVar(&options.ctx, "ctx", defaultCtx, "Context size in tokens (1-131072)")
	flags.StringVar(&options.model, "model", "", "Load this model at startup")
	flags.StringVar(&options.modelsDir, "models-dir", defaultModsDir, "Directory to scan for models")
	if err := flags.Parse(args); err != nil {
		return cliOptions{}, err
	}
	if flags.NArg() > 0 {
		return cliOptions{}, fmt.Errorf("unexpected argument %q; use --help for supported options", flags.Arg(0))
	}
	if options.version {
		return options, nil
	}
	if options.port < 0 || options.port > 65535 {
		return cliOptions{}, fmt.Errorf("invalid --port %d: must be between 0 and 65535", options.port)
	}
	if options.ctx < 1 || options.ctx > maxContextSize {
		return cliOptions{}, fmt.Errorf("invalid --ctx %d: must be between 1 and %d", options.ctx, maxContextSize)
	}
	if options.vllm && !options.server {
		return cliOptions{}, errors.New("invalid option combination: --vllm requires --server")
	}
	return options, nil
}

func main() {
	if len(os.Args) > 1 {
		if err := prepareCLIOutput(); err != nil {
			fmt.Fprintf(os.Stderr, "[aist] Could not attach a console: %v\n", err)
		}
	}

	options, err := parseCLI(os.Args[1:])
	if err != nil {
		if errors.Is(err, flag.ErrHelp) {
			printUsage(os.Stdout)
			return
		}
		fmt.Fprintf(os.Stderr, "[aist] %v\n", err)
		printUsage(os.Stderr)
		os.Exit(2)
	}
	if options.version {
		printVersion(os.Stdout)
		return
	}

	if options.server {
		if err := runHeadless(options); err != nil {
			fmt.Fprintf(os.Stderr, "[aist] Headless startup failed: %v\n", err)
			os.Exit(1)
		}
		return
	}
	if err := runDesktop(options); err != nil {
		fmt.Fprintf(os.Stderr, "[aist] Desktop startup failed: %v\n", err)
		os.Exit(1)
	}
}
