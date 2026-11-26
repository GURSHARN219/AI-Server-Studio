// Package sandbox owns the application sandbox contract.
//
// Code execution is intentionally delegated to an explicitly configured,
// isolated worker command. Go goroutines, Node vm contexts, restricted Python
// built-ins and this package are not security boundaries. If an isolation
// worker is not configured, execution fails closed.
package sandbox

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	DefaultTimeout        = 5 * time.Second
	DefaultMaxCodeBytes   = 256 * 1024
	DefaultMaxOutputBytes = 512 * 1024
	DefaultMaxConcurrent  = 2
)

var (
	ErrUnavailable = errors.New("sandbox isolation worker is unavailable")
	ErrLimit       = errors.New("sandbox execution limit exceeded")
)

// Config describes an OS-isolated worker. The command must read source code
// from stdin and emit a JSON Result on stdout. The worker itself is responsible
// for language parsing; the Go process never evaluates untrusted source.
type Config struct {
	JSCommand         []string
	PythonCommand     []string
	WorkDir           string
	Timeout           time.Duration
	MaxCodeBytes      int
	MaxOutputBytes    int
	MaxConcurrent     int
	IsolationVerified bool
}

// Result is the stable run_js/run_python response contract.
type Result struct {
	Stdout string      `json:"stdout"`
	Stderr string      `json:"stderr"`
	Result interface{} `json:"result,omitempty"`
	Logs   []string    `json:"logs,omitempty"`
	Error  string      `json:"error,omitempty"`
}

type Executor struct {
	cfg Config
	sem chan struct{}
}

func New(cfg Config) *Executor {
	if cfg.Timeout <= 0 {
		cfg.Timeout = DefaultTimeout
	}
	if cfg.MaxCodeBytes <= 0 {
		cfg.MaxCodeBytes = DefaultMaxCodeBytes
	}
	if cfg.MaxOutputBytes <= 0 {
		cfg.MaxOutputBytes = DefaultMaxOutputBytes
	}
	if cfg.MaxConcurrent <= 0 {
		cfg.MaxConcurrent = DefaultMaxConcurrent
	}
	return &Executor{cfg: cfg, sem: make(chan struct{}, cfg.MaxConcurrent)}
}

// FromEnvironment creates a disabled executor unless an operator explicitly
// opts into an isolated process worker. No Python or Node installation is
// discovered implicitly and no fallback evaluator is used.
func FromEnvironment() *Executor {
	return New(Config{
		JSCommand:         splitCommand(os.Getenv("AIST_SANDBOX_JS_COMMAND")),
		PythonCommand:     splitCommand(os.Getenv("AIST_SANDBOX_PYTHON_COMMAND")),
		WorkDir:           strings.TrimSpace(os.Getenv("AIST_SANDBOX_WORKDIR")),
		IsolationVerified: os.Getenv("AIST_SANDBOX_ISOLATION") == "process",
	})
}

func splitCommand(raw string) []string {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	return strings.Fields(raw)
}

func (e *Executor) Available(language string) bool {
	if e == nil || !e.cfg.IsolationVerified {
		return false
	}
	return len(e.command(language)) > 0
}

func (e *Executor) command(language string) []string {
	switch strings.ToLower(strings.TrimSpace(language)) {
	case "js", "javascript", "run_js":
		return e.cfg.JSCommand
	case "python", "py", "run_python":
		return e.cfg.PythonCommand
	default:
		return nil
	}
}

// Run executes a configured worker with bounded input/output and cancellation.
func (e *Executor) Run(ctx context.Context, language, code string) Result {
	if e == nil || !e.Available(language) {
		return Result{Error: ErrUnavailable.Error()}
	}
	if len([]byte(code)) > e.cfg.MaxCodeBytes {
		return Result{Error: fmt.Sprintf("%v: code exceeds %d bytes", ErrLimit, e.cfg.MaxCodeBytes)}
	}
	if strings.TrimSpace(code) == "" {
		return Result{}
	}

	select {
	case e.sem <- struct{}{}:
		defer func() { <-e.sem }()
	case <-ctx.Done():
		return Result{Error: ctx.Err().Error()}
	}

	runCtx, cancel := context.WithTimeout(ctx, e.cfg.Timeout)
	defer cancel()
	cmdSpec := e.command(language)
	cmd := exec.CommandContext(runCtx, cmdSpec[0], cmdSpec[1:]...)
	workDir, cleanup, err := e.privateWorkDir()
	if err != nil {
		return Result{Error: fmt.Sprintf("create sandbox work directory: %v", err)}
	}
	defer cleanup()
	cmd.Dir = workDir
	cmd.Env = []string{"PATH=" + os.Getenv("PATH"), "LANG=C", "LC_ALL=C"}
	cmd.Stdin = strings.NewReader(code)
	var stdout, stderr limitedBuffer
	stdout.limit = e.cfg.MaxOutputBytes
	stderr.limit = e.cfg.MaxOutputBytes
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err = cmd.Run()
	result := Result{Stdout: stdout.String(), Stderr: stderr.String()}
	if stdout.truncated || stderr.truncated {
		result.Error = fmt.Sprintf("%v: output exceeds %d bytes", ErrLimit, e.cfg.MaxOutputBytes)
		return result
	}
	if runCtx.Err() != nil {
		result.Error = runCtx.Err().Error()
		return result
	}
	if err != nil {
		result.Error = err.Error()
		return result
	}
	if text := strings.TrimSpace(result.Stdout); text != "" {
		if json.Unmarshal([]byte(text), &result) != nil {
			result.Logs = strings.Split(text, "\n")
		}
	}
	return result
}

func (e *Executor) privateWorkDir() (string, func(), error) {
	base := strings.TrimSpace(e.cfg.WorkDir)
	if base == "" {
		base = os.TempDir()
	}
	dir, err := os.MkdirTemp(base, "aist-sandbox-")
	if err != nil {
		return "", func() {}, err
	}
	return dir, func() { _ = os.RemoveAll(filepath.Clean(dir)) }, nil
}

type limitedBuffer struct {
	bytes.Buffer
	limit     int
	truncated bool
	mu        sync.Mutex
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	remaining := b.limit - b.Len()
	if remaining <= 0 {
		b.truncated = true
		return len(p), nil
	}
	if len(p) > remaining {
		_, _ = b.Buffer.Write(p[:remaining])
		b.truncated = true
		return len(p), nil
	}
	return b.Buffer.Write(p)
}

var _ io.Writer = (*limitedBuffer)(nil)
