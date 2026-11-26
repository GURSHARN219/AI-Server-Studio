package engine

import (
	"log"
	"strconv"
	"strings"
)

// DetectCUDAVersion returns the installed CUDA major version (e.g. 12, 11, 0).
// Uses nvidia-smi which is available on all platforms with NVIDIA drivers.
// Returns 0 if CUDA is not available.
func DetectCUDAVersion() int {
	// nvidia-smi --query → "CUDA Version: 12.4"
	out, err := hiddenCommand("nvidia-smi", "--query", "--display=COMPUTE").Output()
	if err == nil {
		if v := parseCUDAVersionFromSMI(string(out)); v > 0 {
			return v
		}
	}

	// Fallback: nvidia-smi plain output has "CUDA Version: X.Y" in the header
	out, err = hiddenCommand("nvidia-smi").Output()
	if err != nil {
		return 0
	}
	return parseCUDAVersionFromSMI(string(out))
}

func parseCUDAVersionFromSMI(output string) int {
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		lower := strings.ToLower(line)
		if strings.Contains(lower, "cuda version") {
			idx := strings.LastIndex(lower, ":")
			if idx < 0 {
				continue
			}
			vstr := strings.TrimSpace(line[idx+1:])
			parts := strings.Split(vstr, ".")
			if len(parts) >= 1 {
				trimmed := strings.TrimSpace(parts[0])
				if _, err := strconv.Atoi(trimmed); err != nil {
					log.Printf("[CUDA] Non-numeric version field %q in nvidia-smi output\n", trimmed)
					continue
				}
				major := int(parseUint64(trimmed))
				if major > 0 {
					return major
				}
			}
		}
	}
	return 0
}
