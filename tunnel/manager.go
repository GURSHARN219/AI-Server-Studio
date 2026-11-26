// Package tunnel provides an optional process adapter for supported tunnel
// clients. It never implements a tunnelling protocol and is disabled by
// default; the local API remains the source of truth.
package tunnel

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"
)

type Provider string

const (
	ProviderNgrok      Provider = "ngrok"
	ProviderCloudflare Provider = "cloudflare"
)

type Status struct {
	Enabled   bool     `json:"enabled"`
	Running   bool     `json:"running"`
	Provider  Provider `json:"provider,omitempty"`
	PublicURL string   `json:"public_url,omitempty"`
	Message   string   `json:"message,omitempty"`
}

type Manager struct {
	mu       sync.RWMutex
	provider Provider
	target   string
	command  string
	args     []string
	cmd      *exec.Cmd
	status   Status
	cancel   context.CancelFunc
}

var urlPattern = regexp.MustCompile(`https://[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}(?:/[^\s]*)?`)

// NewFromEnv constructs an opt-in manager. Credentials are intentionally not
// read by this package; ngrok/cloudflared read their own supported stores.
func NewFromEnv(publicPort string) *Manager {
	provider := Provider(strings.ToLower(strings.TrimSpace(os.Getenv("AI_SERVER_TUNNEL_PROVIDER"))))
	enabled := os.Getenv("AI_SERVER_TUNNEL_ENABLED") == "1"
	command := strings.TrimSpace(os.Getenv("AI_SERVER_TUNNEL_COMMAND"))
	if command == "" {
		switch provider {
		case ProviderNgrok:
			command = "ngrok"
		case ProviderCloudflare:
			command = "cloudflared"
		}
	}
	target := "http://127.0.0.1:" + strings.TrimSpace(publicPort)
	args := []string{}
	switch provider {
	case ProviderNgrok:
		args = []string{"http", target, "--log=stdout"}
	case ProviderCloudflare:
		args = []string{"tunnel", "--url", target, "--no-autoupdate"}
	}
	return &Manager{
		provider: provider,
		target:   target,
		command:  command,
		args:     args,
		status:   Status{Enabled: enabled, Provider: provider, Message: "Tunnel is disabled by default"},
	}
}

func (m *Manager) Status() Status {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.status
}

func (m *Manager) Start(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if !m.status.Enabled {
		return errors.New("tunnel is disabled; set AI_SERVER_TUNNEL_ENABLED=1")
	}
	if m.cmd != nil && m.cmd.Process != nil {
		return nil
	}
	if m.provider != ProviderNgrok && m.provider != ProviderCloudflare {
		return errors.New("unsupported tunnel provider")
	}
	if m.command == "" || strings.TrimSpace(strings.TrimPrefix(m.target, "http://127.0.0.1:")) == "" {
		return errors.New("tunnel command and local target are required")
	}
	childCtx, cancel := context.WithCancel(ctx)
	cmd := exec.CommandContext(childCtx, m.command, m.args...)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		cancel()
		return err
	}
	if err := cmd.Start(); err != nil {
		cancel()
		m.status.Message = fmt.Sprintf("failed to start %s", m.provider)
		return err
	}
	m.cmd = cmd
	m.cancel = cancel
	m.status.Running = true
	m.status.Message = "Tunnel process started; waiting for provider URL"
	go m.readOutput(stdout)
	go func() {
		err := cmd.Wait()
		m.mu.Lock()
		if m.cmd == cmd {
			m.cmd = nil
			m.cancel = nil
			m.status.Running = false
			if err != nil {
				m.status.Message = "Tunnel process stopped"
			} else {
				m.status.Message = "Tunnel process exited"
			}
		}
		m.mu.Unlock()
	}()
	return nil
}

func (m *Manager) readOutput(stdout interface{ Read([]byte) (int, error) }) {
	scanner := bufio.NewScanner(stdout)
	for scanner.Scan() {
		line := scanner.Text()
		if match := urlPattern.FindString(line); match != "" {
			m.mu.Lock()
			m.status.PublicURL = match
			m.status.Message = "Tunnel is connected"
			m.mu.Unlock()
		}
	}
}

func (m *Manager) Stop() error {
	m.mu.Lock()
	if m.cancel == nil {
		m.status.Running = false
		m.mu.Unlock()
		return nil
	}
	cancel := m.cancel
	m.mu.Unlock()
	cancel()
	return nil
}
