package engine

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestResolveModelFileStaysInsideRoot(t *testing.T) {
	root := t.TempDir()
	inside := filepath.Join(root, "nested", "model.gguf")
	if err := os.MkdirAll(filepath.Dir(inside), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(inside, []byte("fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	resolved, err := resolveModelFile(root, filepath.Join("nested", "model.gguf"))
	if err != nil {
		t.Fatal(err)
	}
	expected, err := filepath.EvalSymlinks(inside)
	if err != nil {
		t.Fatal(err)
	}
	if resolved != expected {
		t.Fatalf("resolved path %q, want %q", resolved, expected)
	}

	outside := filepath.Join(filepath.Dir(root), "outside.gguf")
	if err := os.WriteFile(outside, []byte("fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Remove(outside) })
	if _, err := resolveModelFile(root, filepath.Join("..", filepath.Base(outside))); err == nil {
		t.Errorf("accepted relative escaping model path")
	}
	expectedOutside, err := filepath.EvalSymlinks(outside)
	if resolved, err := resolveModelFile(root, outside); err != nil || resolved != expectedOutside {
		t.Fatalf("external user-selected model path rejected: %q %v", resolved, err)
	}
}

func TestResolveModelFileRejectsSymlinkEscape(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("symlink creation may require elevated Windows privileges")
	}
	root := t.TempDir()
	outside := filepath.Join(filepath.Dir(root), "outside.gguf")
	if err := os.WriteFile(outside, []byte("fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Remove(outside) })
	link := filepath.Join(root, "link.gguf")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	if _, err := resolveModelFile(root, link); err == nil {
		t.Fatal("accepted symlink model path")
	}
}

func TestVLLMModelIdentifierValidation(t *testing.T) {
	for _, id := range []string{"org/model", "meta-llama/Llama-3.1-8B"} {
		if err := validateModelID(id); err != nil {
			t.Errorf("valid ID %q rejected: %v", id, err)
		}
	}
	for _, id := range []string{"../model", "/tmp/model", "org/model/extra", "org\\model", "org/"} {
		if err := validateModelID(id); err == nil {
			t.Errorf("invalid ID %q accepted", id)
		}
	}
}

func TestVLLMTrustRemoteCodeIsOptIn(t *testing.T) {
	args := buildVLLMArgs("org/model", 18081, 4096, false, nil)
	for _, arg := range args {
		if arg == "--trust-remote-code" {
			t.Fatal("trust-remote-code enabled without explicit configuration")
		}
	}
	trust := true
	args = buildVLLMArgs("org/model", 18081, 4096, false, &LoadConfig{TrustRemoteCode: &trust})
	found := false
	for _, arg := range args {
		if arg == "--trust-remote-code" {
			found = true
		}
	}
	if !found {
		t.Fatal("explicit trust_remote_code was not propagated")
	}
}
