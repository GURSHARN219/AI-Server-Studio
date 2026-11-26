package tools

import "testing"

func TestDefaultRegistryListsOnlyEnabledDefinitions(t *testing.T) {
	r := DefaultRegistry()
	items := r.List()
	if len(items) < 11 {
		t.Fatalf("native tool definitions missing: %+v", items)
	}
	for _, name := range []string{"web.search", "web.fetch", "sandbox.run_js", "sandbox.run_python", "kb.search", "kb.store", "kb.list"} {
		definition, ok := r.Get(name)
		if !ok || !definition.Enabled {
			t.Fatalf("%s was not registered and enabled", name)
		}
	}
	for _, name := range []string{"rag.search", "rag.ingest", "rag.delete", "rag.update"} {
		if definition, ok := r.Get(name); !ok || !definition.Enabled {
			t.Fatalf("%s was not registered and enabled", name)
		}
	}
}

func TestRegistryRegisterAndLookup(t *testing.T) {
	r := NewRegistry()
	if err := r.Register(Definition{Name: "custom", Enabled: true}); err != nil {
		t.Fatal(err)
	}
	definition, ok := r.Get("custom")
	if !ok || !definition.Enabled {
		t.Fatalf("custom tool missing: %+v", definition)
	}
}
