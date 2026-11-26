package main

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const vitePort = 8080

type viteProcess struct {
	cmd *exec.Cmd
	url string
}

func startVite(frontendDir, backendURL string) (*viteProcess, error) {
	workingDir := findViteDirectory(frontendDir)
	if workingDir == "" {
		return nil, nil
	}
	backend, err := url.Parse(backendURL)
	if err != nil {
		return nil, fmt.Errorf("parse backend URL for Vite: %w", err)
	}
	backendHost, backendPort, err := splitHostPort(backend.Host)
	if err != nil {
		return nil, err
	}

	npm := "npm"
	if runtime.GOOS == "windows" {
		npm = "npm.cmd"
	}
	cmd := exec.Command(npm, "run", "dev", "--", "--host", "127.0.0.1", "--port", strconv.Itoa(vitePort), "--strictPort")
	cmd.Dir = workingDir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env = overrideEnvironment(os.Environ(), map[string]string{
		"VITE_BACKEND_HOST": backendHost,
		"VITE_BACKEND_PORT": backendPort,
	})
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start Vite in %q: %w", workingDir, err)
	}
	result := &viteProcess{cmd: cmd, url: fmt.Sprintf("http://127.0.0.1:%d", vitePort)}
	if err := waitForHTTP(result.url, 15*time.Second); err != nil {
		_ = result.stop()
		return nil, fmt.Errorf("wait for Vite: %w", err)
	}
	return result, nil
}

func (p *viteProcess) stop() error {
	if p == nil || p.cmd == nil || p.cmd.Process == nil || p.cmd.ProcessState != nil {
		return nil
	}
	terminateErr := terminateViteProcess(p.cmd)
	waitErr := p.cmd.Wait()
	if terminateErr != nil && !errors.Is(terminateErr, os.ErrProcessDone) {
		return terminateErr
	}
	if waitErr != nil && !errors.Is(waitErr, os.ErrProcessDone) {
		return waitErr
	}
	return nil
}

func waitForHTTP(target string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	client := &http.Client{Timeout: 500 * time.Millisecond}
	for time.Now().Before(deadline) {
		response, err := client.Get(target)
		if err == nil {
			_ = response.Body.Close()
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("%s did not become ready within %s", target, timeout)
}

func findViteDirectory(frontendDir string) string {
	candidates := []string{
		os.Getenv("AIST_VITE_DIR"),
		frontendDir,
	}
	if cwd, err := os.Getwd(); err == nil {
		candidates = append(candidates, filepath.Join(cwd, "app"))
		for current := cwd; current != filepath.Dir(current); current = filepath.Dir(current) {
			candidates = append(candidates, filepath.Join(current, "app"))
		}
	}
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		absolute, err := filepath.Abs(candidate)
		if err != nil {
			continue
		}
		if info, err := os.Stat(filepath.Join(absolute, "package.json")); err == nil && !info.IsDir() {
			return absolute
		}
	}
	return ""
}

func overrideEnvironment(base []string, values map[string]string) []string {
	result := make([]string, 0, len(base)+len(values))
	seen := make(map[string]bool, len(values))
	for _, item := range base {
		key, value := item, ""
		if index := strings.IndexByte(item, '='); index >= 0 {
			key, value = item[:index], item[index+1:]
		}
		if replacement, ok := values[key]; ok {
			result = append(result, key+"="+replacement)
			seen[key] = true
			continue
		}
		result = append(result, key+"="+value)
	}
	for key, value := range values {
		if !seen[key] {
			result = append(result, key+"="+value)
		}
	}
	return result
}

func splitHostPort(address string) (string, string, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		return "", "", fmt.Errorf("parse backend address %q: %w", address, err)
	}
	if host == "" {
		host = "127.0.0.1"
	}
	return host, port, nil
}
