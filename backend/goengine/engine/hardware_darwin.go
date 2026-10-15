//go:build darwin

package engine

import (
	"os/exec"
	"strings"
)

func detectDarwinGPUs() []GPUInfo {
	out, err := exec.Command("system_profiler", "SPDisplaysDataType").Output()
	if err != nil {
		return nil
	}
	return parseSPDisplaysText(out)
}

// parseSPDisplaysText parses plain-text output of `system_profiler SPDisplaysDataType`.
func parseSPDisplaysText(data []byte) []GPUInfo {
	var gpus []GPUInfo
	idx := 0
	var current *GPUInfo

	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)

		if strings.HasPrefix(line, "Chipset Model:") {
			if current != nil {
				gpus = append(gpus, *current)
				idx++
			}
			name := strings.TrimSpace(strings.TrimPrefix(line, "Chipset Model:"))
			vendor, hasCuda, hasVulkan := classifyGPU(name)
			// Apple Silicon GPUs use Metal
			if strings.Contains(strings.ToLower(name), "apple") {
				hasVulkan = false
			}
			current = &GPUInfo{
				Name:      name,
				Vendor:    vendor,
				DeviceID:  itoa(idx),
				HasCuda:   hasCuda,
				HasVulkan: hasVulkan,
			}
		}

		if current != nil && strings.HasPrefix(line, "VRAM") {
			// "VRAM (Total): 8 GB" or "VRAM (Dynamic, Max): 2 GB"
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				current.VRAM = parseVRAMString(strings.TrimSpace(parts[1]))
			}
		}
	}
	if current != nil {
		gpus = append(gpus, *current)
	}
	return gpus
}

// parseVRAMString parses strings like "8 GB" or "512 MB" into bytes.
func parseVRAMString(s string) uint64 {
	s = strings.ToLower(strings.TrimSpace(s))
	val := parseUint64(s)
	switch {
	case strings.Contains(s, "gb"):
		return val * 1024 * 1024 * 1024
	case strings.Contains(s, "mb"):
		return val * 1024 * 1024
	default:
		return val
	}
}

func detectPlatformGPUs() []GPUInfo {
	return detectDarwinGPUs()
}
