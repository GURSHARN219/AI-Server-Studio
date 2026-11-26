package engine

import "testing"

func TestUnsupportedArchitectureFromDiagnostic(t *testing.T) {
	if got := unsupportedArchitectureFromDiagnostic("llama_model_load: error loading model: error loading model architecture: unknown model architecture: 'gemma4'"); got != "gemma4" {
		t.Fatalf("architecture = %q, want gemma4", got)
	}
	if got := unsupportedArchitectureFromDiagnostic("failed to open gguf file"); got != "" {
		t.Fatalf("unexpected architecture %q", got)
	}
}
