// Package engine provides explicit backend selection for AI Server Studio.
// Selection never silently falls back between local and provider backends.
package engine

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
)

type BackendKind string

const (
	BackendLocal    BackendKind = "local"
	BackendProvider BackendKind = "provider"
)

type Capability string

const (
	CapabilityChat      Capability = "chat"
	CapabilitySTT       Capability = "stt"
	CapabilityTTS       Capability = "tts"
	CapabilityImage     Capability = "image"
	CapabilityVideo     Capability = "video"
	CapabilityEmbedding Capability = "embedding"
)

var (
	ErrNoBackendConfigured   = errors.New("no backend configured for request")
	ErrBackendUnavailable    = errors.New("backend is unavailable")
	ErrCapabilityUnsupported = errors.New("backend does not support requested capability")
)

// Backend is implemented by a local runtime or provider adapter.
type Backend interface {
	Name() string
	Kind() BackendKind
	Supports(Capability) bool
	Available(context.Context) error
}

// BackendRequest describes the routing constraints for one operation.
type BackendRequest struct {
	Kind       BackendKind
	Capability Capability
	Model      string // Optional; interpret in the concrete adapter.
}

// Selector resolves requests to explicitly registered backends.
type Selector struct {
	mu       sync.RWMutex
	backends map[BackendKind]map[string]Backend
}

func NewSelector() *Selector {
	return &Selector{backends: make(map[BackendKind]map[string]Backend)}
}

func (s *Selector) Register(backend Backend) error {
	if s == nil {
		return errors.New("backend selector is nil")
	}
	if backend == nil {
		return errors.New("backend is nil")
	}

	kind := BackendKind(strings.ToLower(strings.TrimSpace(string(backend.Kind()))))
	name := strings.TrimSpace(backend.Name())
	if kind != BackendLocal && kind != BackendProvider {
		return fmt.Errorf("unsupported backend kind %q", backend.Kind())
	}
	if name == "" {
		return errors.New("backend name cannot be empty")
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.backends == nil {
		s.backends = make(map[BackendKind]map[string]Backend)
	}
	if s.backends[kind] == nil {
		s.backends[kind] = make(map[string]Backend)
	}
	s.backends[kind][name] = backend
	return nil
}

// Select picks a compatible available backend of the requested kind.
// Supplying name restricts selection to that exact registered backend.
// With no name, candidates are checked in stable alphabetical order.
func (s *Selector) Select(ctx context.Context, request BackendRequest, name string) (Backend, error) {
	if s == nil {
		return nil, errors.New("backend selector is nil")
	}
	if ctx == nil {
		return nil, errors.New("context cannot be nil")
	}

	kind := BackendKind(strings.ToLower(strings.TrimSpace(string(request.Kind))))
	if kind != BackendLocal && kind != BackendProvider {
		return nil, fmt.Errorf("invalid backend kind %q: must be %q or %q",
			request.Kind, BackendLocal, BackendProvider)
	}
	capability := Capability(strings.ToLower(strings.TrimSpace(string(request.Capability))))
	if capability == "" {
		return nil, errors.New("capability cannot be empty")
	}

	s.mu.RLock()
	registered := s.backends[kind]
	names := make([]string, 0, len(registered))
	for backendName := range registered {
		if strings.TrimSpace(name) == "" || backendName == strings.TrimSpace(name) {
			names = append(names, backendName)
		}
	}
	sort.Strings(names)
	candidates := make([]Backend, 0, len(names))
	for _, backendName := range names {
		candidates = append(candidates, registered[backendName])
	}
	s.mu.RUnlock()

	if len(candidates) == 0 {
		if strings.TrimSpace(name) != "" {
			return nil, fmt.Errorf("%w: kind=%s name=%q", ErrNoBackendConfigured, kind, name)
		}
		return nil, fmt.Errorf("%w: kind=%s", ErrNoBackendConfigured, kind)
	}

	var unavailable []error
	for _, backend := range candidates {
		if !backend.Supports(capability) {
			continue
		}
		if err := backend.Available(ctx); err != nil {
			unavailable = append(unavailable, fmt.Errorf("%s: %w", backend.Name(), err))
			continue
		}
		return backend, nil
	}
	if len(unavailable) > 0 {
		return nil, fmt.Errorf("%w for kind=%s capability=%s: %w",
			ErrBackendUnavailable, kind, capability, errors.Join(unavailable...))
	}
	return nil, fmt.Errorf("%w: kind=%s capability=%s",
		ErrCapabilityUnsupported, kind, capability)
}
