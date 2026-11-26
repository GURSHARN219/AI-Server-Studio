package engine

import (
	"fmt"
	"strings"

	"ai-server-studio-backend/modelregistry"
)

const (
	defaultAssessmentContext = 4096
	ramReserveBytes          = 1536 << 20
	vramReserveBytes         = 768 << 20
)

// ModelResourceAssessment is a conservative planning result. It is an
// estimate, not a guarantee: native allocator overhead and other processes can
// change the final capacity at load time.
type ModelResourceAssessment struct {
	Status               string `json:"status"`
	Confidence           string `json:"confidence"`
	Reason               string `json:"reason"`
	Architecture         string `json:"architecture"`
	Quantization         string `json:"quantization"`
	FileSizeBytes        int64  `json:"fileSizeBytes"`
	EstimatedRAMBytes    uint64 `json:"estimatedRamBytes"`
	EstimatedVRAMBytes   uint64 `json:"estimatedVramBytes"`
	AvailableRAMBytes    uint64 `json:"availableRamBytes"`
	AvailableVRAMBytes   uint64 `json:"availableVramBytes"`
	RecommendedContext   int    `json:"recommendedContext"`
	RecommendedGPULayers int    `json:"recommendedGpuLayers"`
	Backend              string `json:"backend"`
	RAMHeadroomBytes     int64  `json:"ramHeadroomBytes"`
	VRAMHeadroomBytes    int64  `json:"vramHeadroomBytes"`
}

// AssessModelResources estimates whether a GGUF model can fit the currently
// available system resources. The model file size is used as a conservative
// proxy for weights because the minimal GGUF reader intentionally does not
// invent parameter-count or tensor-layout information.
func AssessModelResources(metadata modelregistry.GGUFMetadata, fileSize int64, hardware *HardwareInfo, requestedContext int) ModelResourceAssessment {
	contextSize := requestedContext
	if contextSize <= 0 {
		contextSize = defaultAssessmentContext
	}
	architecture := strings.TrimSpace(metadata.Architecture)
	quantization := strings.TrimSpace(metadata.Quantization)
	if architecture == "" {
		architecture = modelregistry.Unknown
	}
	if quantization == "" {
		quantization = modelregistry.Unknown
	}

	result := ModelResourceAssessment{
		Status:             "compatibility_unknown",
		Confidence:         "low",
		Reason:             "model metadata or hardware capacity is incomplete",
		Architecture:       architecture,
		Quantization:       quantization,
		FileSizeBytes:      fileSize,
		RecommendedContext: contextSize,
		Backend:            "cpu",
	}

	if fileSize <= 0 || hardware == nil {
		return result
	}

	result.EstimatedRAMBytes = uint64(fileSize) + uint64(contextSize)*4096
	result.EstimatedVRAMBytes = uint64(float64(fileSize)*1.12) + uint64(contextSize)*4096
	result.AvailableRAMBytes = hardware.Memory.FreeRAM
	for _, gpu := range hardware.GPUs {
		if gpu.VRAMFree > result.AvailableVRAMBytes {
			result.AvailableVRAMBytes = gpu.VRAMFree
		}
	}

	ramHeadroom := int64(result.AvailableRAMBytes) - int64(result.EstimatedRAMBytes) - ramReserveBytes
	vramHeadroom := int64(result.AvailableVRAMBytes) - int64(result.EstimatedVRAMBytes) - vramReserveBytes
	result.RAMHeadroomBytes = ramHeadroom
	result.VRAMHeadroomBytes = vramHeadroom

	if len(hardware.GPUs) > 0 && result.AvailableVRAMBytes > vramReserveBytes {
		result.Backend = "cuda"
		result.RecommendedGPULayers = 99
		if vramHeadroom < 0 {
			result.Backend = "cpu/gpu-hybrid"
			result.RecommendedGPULayers = 33
		}
	}

	switch {
	case ramHeadroom < 0:
		result.Status = "insufficient_estimated_memory"
		result.Confidence = "medium"
		result.Reason = fmt.Sprintf("estimated RAM requirement exceeds available RAM at context %d", contextSize)
	case vramHeadroom < 0 && result.Backend == "cpu/gpu-hybrid":
		result.Status = "hybrid_recommended"
		result.Confidence = "medium"
		result.Reason = "full GPU offload exceeds the conservative VRAM budget; CPU/GPU hybrid execution is recommended"
	default:
		result.Status = "compatible"
		result.Confidence = "medium"
		result.Reason = "estimated memory fits with reserved headroom"
	}
	return result
}
