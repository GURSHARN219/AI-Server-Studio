package engine

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

// VariantInfo describes a located llama-server binary.
type VariantInfo struct {
	BinaryPath string // absolute path to llama-server(.exe)
	BinaryDir  string // directory — set as cmd.Dir so sibling DLLs are found
	Variant    string // "cuda12", "cuda", "vulkan", "avx2", "metal", "rocm", "unknown"
	Version    string // from llama-server-variant.json, or ""
	Fallback   bool   // true when we fell back from GPU to CPU
	Reason     string // human-readable selection note
}

// SelectedBackend is an alias kept for compatibility with engine.go.
type SelectedBackend = VariantInfo

// FindLlamaServerWithBackend locates the best pre-built llama-server binary.
//
// Search order (GPU-aware):
//  1. If a GPU backend is detected, try the matching GPU variant directory first
//  2. Then fall through the full candidate list
//  3. Never silently use a CPU binary when a GPU was detected — log a clear warning
func FindLlamaServerWithBackend(baseDir string, gpuBackend GPUBackend, cudaMajor int) (binaryPath, binaryDir string, sel *SelectedBackend) {
	ext := ""
	if runtime.GOOS == "windows" {
		ext = ".exe"
	}
	name := "llama-server" + ext

	// Build GPU-preferred candidate list: matching GPU variant first, then fallbacks
	var candidates []string

	// If GPU detected, prepend the matching variant directory so it wins
	if gpuBackend != GPUBackendNone {
		preferred := variantForBackend(gpuBackend, cudaMajor)
		candidates = append(candidates, filepath.Join(baseDir, "bin", preferred))
		// Also try alternate CUDA variant names
		if gpuBackend == GPUBackendCUDA {
			if cudaMajor >= 13 {
				candidates = append(candidates, filepath.Join(baseDir, "bin", "cuda13"))
			}
			if cudaMajor >= 12 {
				candidates = append(candidates, filepath.Join(baseDir, "bin", "cuda12"))
			}
			candidates = append(candidates, filepath.Join(baseDir, "bin", "cuda"))
		}
	}

	// Full fallback list (CPU variants last)
	candidates = append(candidates,
		filepath.Join(baseDir, "bin", "cuda13"),
		filepath.Join(baseDir, "bin", "cuda12"),
		filepath.Join(baseDir, "bin", "cuda"),
		filepath.Join(baseDir, "bin", "vulkan"),
		filepath.Join(baseDir, "bin", "hip"),
		filepath.Join(baseDir, "bin", "metal"),
		filepath.Join(baseDir, "bin", "avx2"),
		filepath.Join(baseDir, "bin"),
		filepath.Join(baseDir, "..", "bin"),
		filepath.Join(baseDir, "..", "..", "bin"),
		baseDir,
	)

	// Deduplicate while preserving order
	seen := make(map[string]bool)
	var deduped []string
	for _, d := range candidates {
		abs, _ := filepath.Abs(d)
		if !seen[abs] {
			seen[abs] = true
			deduped = append(deduped, d)
		}
	}

	log.Println("[BinarySelector] Scanning candidate directories (GPU-preferred order)...")
	for i, dir := range deduped {
		p := filepath.Join(dir, name)
		if _, err := os.Stat(p); err == nil {
			abs, _ := filepath.Abs(p)
			absDir, _ := filepath.Abs(dir)
			variant, version := readVariantMarker(absDir)
			cpuBinary := isCPUVariant(variant)
			fallback := cpuBinary && gpuBackend != GPUBackendNone
			log.Printf("[BinarySelector] ✓ FOUND [%d] %s → variant=%s version=%s cpuBinary=%v\n", i, abs, variant, version, cpuBinary)

			if cpuBinary && gpuBackend != GPUBackendNone {
				log.Printf("[BinarySelector] WARNING: CPU-only binary found but GPU (%s) detected.\n", gpuBackend)
				log.Printf("[BinarySelector]   Install GPU binary via Settings → Runtime & Hardware → Install Engine (variant: %s)\n", variantForBackend(gpuBackend, cudaMajor))
			}

			sel = &VariantInfo{
				BinaryPath: abs,
				BinaryDir:  absDir,
				Variant:    variant,
				Version:    version,
				Fallback:   fallback,
				Reason:     buildVariantReason(variant, version, gpuBackend),
			}
			return abs, absDir, sel
		}
	}

	// Not found anywhere
	log.Println("[BinarySelector] llama-server binary not found.")
	log.Printf("[BinarySelector]   Expected: %s\n", filepath.Join(baseDir, "bin", name))
	log.Println("[BinarySelector]   Install via Settings → Runtime & Hardware → Install Engine")
	sel = &VariantInfo{
		Reason:   "binary not found — use Settings → Runtime & Hardware to install",
		Fallback: true,
	}
	return "", "", sel
}

// FindLlamaServer is the legacy single-path search (kept for compatibility).
func FindLlamaServer(baseDir string) string {
	p, _, _ := FindLlamaServerWithBackend(baseDir, GPUBackendNone, 0)
	return p
}

// readVariantMarker reads the llama-server-variant.json written by the setup script.
func readVariantMarker(dir string) (variant, version string) {
	data, err := os.ReadFile(filepath.Join(dir, "llama-server-variant.json"))
	if err != nil {
		return "unknown", ""
	}
	var m struct {
		Variant string `json:"variant"`
		Version string `json:"version"`
	}
	if err := json.Unmarshal(data, &m); err != nil {
		return "unknown", ""
	}
	return m.Variant, m.Version
}

func isCPUVariant(variant string) bool {
	return variant == "avx2" || variant == "cpu" || variant == "noavx" || variant == ""
}

func variantForBackend(backend GPUBackend, cudaMajor int) string {
	switch backend {
	case GPUBackendCUDA:
		if cudaMajor >= 12 {
			return "cuda12"
		}
		return "cuda"
	case GPUBackendVulkan:
		return "vulkan"
	case GPUBackendROCm:
		return "vulkan" // ROCm builds are rare; Vulkan works on AMD Linux too
	case GPUBackendMetal:
		return "metal"
	default:
		return "avx2"
	}
}

func buildVariantReason(variant, version string, gpuBackend GPUBackend) string {
	var sb strings.Builder
	sb.WriteString("binary=")
	sb.WriteString(variant)
	if version != "" {
		sb.WriteString(" version=")
		sb.WriteString(version)
	}
	if gpuBackend != GPUBackendNone {
		sb.WriteString(" gpu=")
		sb.WriteString(string(gpuBackend))
	}
	return sb.String()
}
