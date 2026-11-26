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
			Name: "sandbox.run_js", Description: "Run JavaScript through an explicitly configured isolated worker.",
			InputSchema:  map[string]interface{}{"type": "object", "properties": map[string]interface{}{"code": map[string]interface{}{"type": "string"}}, "required": []string{"code"}},
			Capabilities: []string{"local:compute", "local:exec"}, Enabled: true,
		},
		Definition{
			Name: "sandbox.run_python", Description: "Run Python through an explicitly configured isolated worker.",
			InputSchema:  map[string]interface{}{"type": "object", "properties": map[string]interface{}{"code": map[string]interface{}{"type": "string"}}, "required": []string{"code"}},
			Capabilities: []string{"local:compute", "local:exec"}, Enabled: true,
		},
		Definition{
			Name: "kb.search", Description: "Search the owner-scoped local knowledge base.",
			InputSchema:  map[string]interface{}{"type": "object", "properties": map[string]interface{}{"query": map[string]interface{}{"type": "string"}}, "required": []string{"query"}},
			Capabilities: []string{"local:rag", "local:db"}, Enabled: true,
		},
		Definition{
			Name: "kb.store", Description: "Store a document in the owner-scoped local knowledge base.",
			InputSchema:  map[string]interface{}{"type": "object", "properties": map[string]interface{}{"title": map[string]interface{}{"type": "string"}, "content": map[string]interface{}{"type": "string"}}, "required": []string{"content"}},
			Capabilities: []string{"local:rag", "local:db"}, Enabled: true,
		},
		Definition{
			Name: "kb.list", Description: "List documents in the owner-scoped local knowledge base.",
			InputSchema:  map[string]interface{}{"type": "object"},
			Capabilities: []string{"local:rag", "local:db"}, Enabled: true,
		},
		Definition{
			Name: "rag.search", Description: "Run vector similarity search against the owner-scoped local RAG index.",
			InputSchema:  map[string]interface{}{"type": "object", "properties": map[string]interface{}{"query": map[string]interface{}{"type": "string"}, "limit": map[string]interface{}{"type": "integer"}}, "required": []string{"query"}},
			Capabilities: []string{"local:rag", "local:db"}, Enabled: true,
		},
		Definition{
			Name: "rag.ingest", Description: "Embed and index a document in the owner-scoped local RAG index.",
			InputSchema:  map[string]interface{}{"type": "object", "properties": map[string]interface{}{"title": map[string]interface{}{"type": "string"}, "content": map[string]interface{}{"type": "string"}, "source": map[string]interface{}{"type": "string"}}, "required": []string{"content"}},
			Capabilities: []string{"local:rag", "local:db"}, Enabled: true,
		},
		Definition{
			Name: "rag.delete", Description: "Delete an owner-scoped document from the local RAG index.",
			InputSchema:  map[string]interface{}{"type": "object", "properties": map[string]interface{}{"document_id": map[string]interface{}{"type": "string"}}, "required": []string{"document_id"}},
			Capabilities: []string{"local:rag", "local:db"}, Enabled: true,
		},
		Definition{
			Name: "rag.update", Description: "Re-embed and update an owner-scoped document in the local RAG index.",
			InputSchema:  map[string]interface{}{"type": "object", "properties": map[string]interface{}{"document_id": map[string]interface{}{"type": "string"}, "title": map[string]interface{}{"type": "string"}, "content": map[string]interface{}{"type": "string"}}, "required": []string{"document_id", "content"}},
			Capabilities: []string{"local:rag", "local:db"}, Enabled: true,
		},
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
