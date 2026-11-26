package modelregistry

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ai-server-studio-backend/persistence"
)

func newTestRegistry(t *testing.T) *Registry {
	t.Helper()
	db, err := persistence.Open(filepath.Join(t.TempDir(), "registry.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	registry, err := New(db)
	if err != nil {
		t.Fatal(err)
	}
	return registry
}

func TestRegisterDeduplicatesCanonicalPath(t *testing.T) {
	registry := newTestRegistry(t)
	dir := t.TempDir()
	path := filepath.Join(dir, "model.gguf")
	if err := os.WriteFile(path, []byte("not a complete gguf"), 0600); err != nil {
		t.Fatal(err)
	}
	first, err := registry.Register(context.Background(), RegisterRequest{Path: filepath.Join(dir, ".", "model.gguf"), Source: "configured"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := registry.Register(context.Background(), RegisterRequest{Path: filepath.Join(dir, "child", "..", "model.gguf"), Source: "lmstudio"})
	if err != nil {
		t.Fatal(err)
	}
	if first.ID != second.ID || first.Path != second.Path {
		t.Fatalf("path was not deduplicated: %#v %#v", first, second)
	}
	models, err := registry.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(models) != 1 || models[0].Source != "lmstudio" {
		t.Fatalf("want one refreshed registration, got %#v", models)
	}
	if models[0].Architecture != Unknown || models[0].Tokenizer.Model != Unknown {
		t.Fatalf("malformed metadata was guessed: %#v", models[0])
	}
}

func TestListStaleDetectsMissingAndChangedFiles(t *testing.T) {
	registry := newTestRegistry(t)
	dir := t.TempDir()
	path := filepath.Join(dir, "model.gguf")
	if err := os.WriteFile(path, []byte("123"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := registry.RegisterPath(context.Background(), path, "test"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("changed-size"), 0600); err != nil {
		t.Fatal(err)
	}
	stale, err := registry.ListStale(context.Background())
	if err != nil || len(stale) != 1 || !stale[0].Exists || !stale[0].Stale {
		t.Fatalf("changed file was not stale: %#v %v", stale, err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	stale, err = registry.ListStale(context.Background())
	if err != nil || len(stale) != 1 || stale[0].Exists || !stale[0].Stale {
		t.Fatalf("missing file was not stale: %#v %v", stale, err)
	}
}

func TestDiscoverRootsUsesOnlyExistingConfiguredRoots(t *testing.T) {
	existing := t.TempDir()
	canonicalExisting, err := filepath.EvalSymlinks(existing)
	if err != nil {
		t.Fatal(err)
	}
	roots, err := DiscoverRoots([]string{existing, filepath.Join(t.TempDir(), "does-not-exist")})
	if err != nil {
		t.Fatal(err)
	}
	foundExisting := false
	for _, root := range roots {
		if strings.EqualFold(filepath.Clean(root), filepath.Clean(canonicalExisting)) {
			foundExisting = true
		}
	}
	if !foundExisting {
		t.Fatalf("configured existing root missing: %#v", roots)
	}
	for _, root := range roots {
		if root == filepath.Join(t.TempDir(), "does-not-exist") {
			t.Fatal("nonexistent root was returned")
		}
	}
}

func TestReadGGUFMetadataReturnsUnknownForMalformedMetadata(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.gguf")
	// Valid magic/version, but a metadata key length that is truncated.
	data := []byte{'G', 'G', 'U', 'F', 3, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0xff}
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	metadata, err := ReadGGUFMetadata(path)
	if err != nil {
		t.Fatal(err)
	}
	if metadata.Status != Unknown || metadata.Architecture != Unknown || metadata.Quantization != Unknown || metadata.Tokenizer.TokenCount != UnknownCount {
		t.Fatalf("malformed metadata was not explicit unknown: %#v", metadata)
	}
}
