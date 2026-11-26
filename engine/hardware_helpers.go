package engine

import (
	"strconv"
	"strings"
)

// classifyGPU returns (vendor, hasCuda, hasVulkan) based on GPU name/description string.
func classifyGPU(name string) (vendor string, hasCuda bool, hasVulkan bool) {
	n := strings.ToLower(name)
	switch {
	case strings.Contains(n, "nvidia") || strings.Contains(n, "geforce") ||
		strings.Contains(n, "quadro") || strings.Contains(n, "tesla") || strings.Contains(n, "rtx"):
		return "NVIDIA", true, true
	case strings.Contains(n, "amd") || strings.Contains(n, "radeon") ||
		strings.Contains(n, "rx ") || strings.Contains(n, "vega") || strings.Contains(n, "navi"):
		return "AMD", false, true
	case strings.Contains(n, "intel") || strings.Contains(n, "arc ") ||
		strings.Contains(n, "iris") || strings.Contains(n, "uhd") || strings.Contains(n, "hd graphics"):
		return "Intel", false, true
	case strings.Contains(n, "apple") || strings.Contains(n, "m1") ||
		strings.Contains(n, "m2") || strings.Contains(n, "m3") || strings.Contains(n, "m4"):
		return "Apple", false, false // Metal, not Vulkan
	default:
		return "Unknown", false, false
	}
}

// parseUint64 parses the leading digits of s as uint64.
func parseUint64(s string) uint64 {
	s = strings.TrimSpace(s)
	var v uint64
	for _, c := range s {
		if c >= '0' && c <= '9' {
			v = v*10 + uint64(c-'0')
		} else {
			break
		}
	}
	return v
}

func parseOptionalFloat(s string) *float64 {
	value, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil {
		return nil
	}
	return &value
}

func memoryPressure(available, total uint64) string {
	if total == 0 {
		return "unknown"
	}
	used := float64(total-available) / float64(total)
	switch {
	case used >= 0.9:
		return "critical"
	case used >= 0.75:
		return "high"
	case used >= 0.5:
		return "moderate"
	default:
		return "low"
	}
}

// itoa converts a non-negative int to a single-char string (0-9).
func itoa(i int) string {
	if i < 0 {
		i = 0
	}
	if i > 9 {
		return strconv.Itoa(i)
	}
	return string(rune('0' + i))
}
