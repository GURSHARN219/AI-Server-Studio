package engine

import "testing"

func TestMemoryPressureUsesAvailableMemory(t *testing.T) {
	tests := []struct {
		name      string
		available uint64
		total     uint64
		want      string
	}{
		{"low", 8, 10, "low"},
		{"moderate", 4, 10, "moderate"},
		{"high", 2, 10, "high"},
		{"critical", 1, 10, "critical"},
		{"unknown", 0, 0, "unknown"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := memoryPressure(tt.available, tt.total); got != tt.want {
				t.Fatalf("memoryPressure(%d, %d) = %q, want %q", tt.available, tt.total, got, tt.want)
			}
		})
	}
}

func TestParseOptionalFloatLeavesUnsupportedTelemetryUnknown(t *testing.T) {
	if got := parseOptionalFloat("N/A"); got != nil {
		t.Fatalf("parseOptionalFloat(N/A) = %v, want nil", *got)
	}
	if got := parseOptionalFloat("42.5"); got == nil || *got != 42.5 {
		t.Fatalf("parseOptionalFloat(42.5) = %v, want 42.5", got)
	}
}
