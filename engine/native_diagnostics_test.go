package engine

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadNativeLoadDiagnosticReturnsLastRelevantFailure(t *testing.T) {
	path := filepath.Join(t.TempDir(), "engine.log")
	contents := "noise\nllama_model_load: error loading model: first\n" +
		"llama_model_loader: unknown pre-tokenizer type: 'minicpm5'\n"
	if err := os.WriteFile(path, []byte(contents), 0600); err != nil {
		t.Fatal(err)
	}
	if got := readNativeLoadDiagnostic(path); got != "llama_model_loader: unknown pre-tokenizer type: 'minicpm5'" {
		t.Fatalf("diagnostic = %q", got)
	}
}

func TestReadNativeLoadDiagnosticAfterIgnoresEarlierModelFailure(t *testing.T) {
	path := filepath.Join(t.TempDir(), "engine.log")
	prefix := "old: error loading model: old-model\n"
	if err := os.WriteFile(path, []byte(prefix), 0600); err != nil {
		t.Fatal(err)
	}
	offset := nativeLogOffset(path)
	if file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0600); err != nil {
		t.Fatal(err)
	} else {
		_, _ = file.WriteString("new: error loading model: new-model\n")
		_ = file.Close()
	}
	if got := readNativeLoadDiagnosticAfter(path, offset); got != "new: error loading model: new-model" {
		t.Fatalf("diagnostic = %q", got)
	}
}
