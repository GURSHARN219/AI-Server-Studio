package tools

import "testing"

func TestDefaultRegistryListsOnlyEnabledDefinitions(t *testing.T) {
	r := DefaultRegistry()
	items := r.List()
	if len(items) != 2 || items[0].Name != "web.fetch" || items[1].Name != "web.search" {
		t.Fatalf("unexpected definitions: %+v", items)
	}
	if _, ok := r.Get("web.search"); !ok {
		t.Fatal("web.search was not registered")
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
