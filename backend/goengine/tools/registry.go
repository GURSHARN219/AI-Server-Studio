// Package tools owns backend tool metadata and capability declarations.
// Execution adapters can be added without making the HTTP layer the registry.
package tools

import (
	"fmt"
	"sort"
	"sync"
)

type Definition struct {
	Name             string                 `json:"name"`
	Description      string                 `json:"description"`
	InputSchema      map[string]interface{} `json:"inputSchema"`
	Capabilities     []string               `json:"capabilities"`
	RequiresApproval bool                   `json:"requiresApproval"`
	Enabled          bool                   `json:"enabled"`
}

type Registry struct {
	mu    sync.RWMutex
	items map[string]Definition
}

func NewRegistry(definitions ...Definition) *Registry {
	r := &Registry{items: make(map[string]Definition, len(definitions))}
	for _, definition := range definitions {
		if definition.Name != "" {
			r.items[definition.Name] = definition
		}
	}
	return r
}

func DefaultRegistry() *Registry {
	return NewRegistry(
		Definition{
			Name: "web.search", Description: "Search the public web using DuckDuckGo.",
			InputSchema:  map[string]interface{}{"type": "object", "properties": map[string]interface{}{"query": map[string]interface{}{"type": "string"}}, "required": []string{"query"}},
			Capabilities: []string{"net:http"}, Enabled: true,
		},
		Definition{
			Name: "web.fetch", Description: "Fetch readable text from a public HTTPS URL.",
			InputSchema:  map[string]interface{}{"type": "object", "properties": map[string]interface{}{"url": map[string]interface{}{"type": "string", "format": "uri"}}, "required": []string{"url"}},
			Capabilities: []string{"net:http"}, Enabled: true,
		},
	)
}

func (r *Registry) Register(definition Definition) error {
	if definition.Name == "" {
		return fmt.Errorf("tool name is required")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.items[definition.Name] = definition
	return nil
}

func (r *Registry) Get(name string) (Definition, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	definition, ok := r.items[name]
	return definition, ok
}

func (r *Registry) List() []Definition {
	r.mu.RLock()
	defer r.mu.RUnlock()
	items := make([]Definition, 0, len(r.items))
	for _, definition := range r.items {
		items = append(items, definition)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Name < items[j].Name })
	return items
}
