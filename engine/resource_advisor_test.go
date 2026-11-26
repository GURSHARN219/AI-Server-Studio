package engine

import (
	"testing"

	"ai-server-studio-backend/modelregistry"
)

func TestAssessModelResourcesDoesNotHardcodeArchitectureSupport(t *testing.T) {
	assessment := AssessModelResources(
		modelregistry.GGUFMetadata{Status: "known", Architecture: "gemma4", Quantization: "file_type:15"},
		4<<30,
		&HardwareInfo{Memory: MemInfo{TotalRAM: 16 << 30, FreeRAM: 8 << 30}, GPUs: []GPUInfo{{VRAM: 8 << 30, VRAMFree: 7 << 30}}},
		4096,
	)
	if assessment.Status == "unsupported_architecture" {
		t.Fatalf("status = %q; architecture support must come from the actual runtime", assessment.Status)
	}
}

func TestAssessModelResourcesRecommendsHybridWhenVRAMIsTight(t *testing.T) {
	assessment := AssessModelResources(
		modelregistry.GGUFMetadata{Status: "known", Architecture: "qwen3", Quantization: "file_type:15"},
		7<<30,
		&HardwareInfo{Memory: MemInfo{TotalRAM: 16 << 30, FreeRAM: 10 << 30}, GPUs: []GPUInfo{{VRAM: 8 << 30, VRAMFree: 7 << 30}}},
		4096,
	)
	if assessment.Status != "hybrid_recommended" {
		t.Fatalf("status = %q, want hybrid_recommended", assessment.Status)
	}
	if assessment.RecommendedGPULayers != 33 {
		t.Fatalf("gpu layers = %d, want conservative hybrid recommendation", assessment.RecommendedGPULayers)
	}
}
