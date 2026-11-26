//go:build linux

package engine

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func detectLinuxGPUs() []GPUInfo {
	// NVIDIA first (most reliable via nvidia-smi)
	if gpus := detectLinuxNvidiaGPUs(); len(gpus) > 0 {
		return gpus
	}
	// AMD / Intel via lspci + /sys/class/drm
	return detectLspciGPUs()
}

func detectLinuxNvidiaGPUs() []GPUInfo {
	out, err := exec.Command("nvidia-smi",
		"--query-gpu=name,memory.total,memory.free,driver_version",
		"--format=csv,noheader,nounits").Output()
	if err != nil {
		return nil
	}
	var gpus []GPUInfo
	for i, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		parts := strings.SplitN(line, ", ", 4)
		if len(parts) < 4 {
			continue
		}
		vram := parseUint64(parts[1]) * 1024 * 1024
		vramFree := parseUint64(parts[2]) * 1024 * 1024
		gpus = append(gpus, GPUInfo{
			Name:          strings.TrimSpace(parts[0]),
			VRAM:          vram,
			VRAMFree:      vramFree,
			Vendor:        "NVIDIA",
			DeviceID:      itoa(i),
			HasCuda:       true,
			HasVulkan:     true,
			DriverVersion: strings.TrimSpace(parts[3]),
		})
	}
	return gpus
}

// detectLspciGPUs uses lspci to find AMD/Intel GPUs.
func detectLspciGPUs() []GPUInfo {
	out, err := exec.Command("lspci", "-mm").Output()
	if err != nil {
		return detectDRMGPUs()
	}

	var gpus []GPUInfo
	idx := 0
	for _, line := range strings.Split(string(out), "\n") {
		lower := strings.ToLower(line)
		if !strings.Contains(lower, "vga") && !strings.Contains(lower, "display") &&
			!strings.Contains(lower, "3d controller") {
			continue
		}
		vendor, hasCuda, hasVulkan := classifyGPU(line)
		if vendor == "Unknown" {
			continue
		}
		name := extractLspciName(line)
		gpus = append(gpus, GPUInfo{
			Name:      name,
			Vendor:    vendor,
			DeviceID:  itoa(idx),
			HasCuda:   hasCuda,
			HasVulkan: hasVulkan,
			VRAM:      detectDRMVRAM(idx),
		})
		idx++
	}
	return gpus
}

// detectDRMGPUs reads /sys/class/drm as a last resort.
func detectDRMGPUs() []GPUInfo {
	entries, err := os.ReadDir("/sys/class/drm")
	if err != nil {
		return nil
	}
	seen := map[string]bool{}
	var gpus []GPUInfo
	idx := 0
	for _, e := range entries {
		name := e.Name()
		if !strings.HasPrefix(name, "card") || strings.Contains(name, "-") {
			continue
		}
		driverLink := filepath.Join("/sys/class/drm", name, "device/driver")
		driver, _ := os.Readlink(driverLink)
		driver = filepath.Base(driver)
		if seen[driver] {
			continue
		}
		seen[driver] = true

		vendor, hasCuda, hasVulkan := classifyGPU(driver)
		gpus = append(gpus, GPUInfo{
			Name:      driver,
			Vendor:    vendor,
			DeviceID:  itoa(idx),
			HasCuda:   hasCuda,
			HasVulkan: hasVulkan,
			VRAM:      detectDRMVRAM(idx),
		})
		idx++
	}
	return gpus
}

func detectDRMVRAM(cardIdx int) uint64 {
	path := filepath.Join("/sys/class/drm", "card"+itoa(cardIdx), "device/mem_info_vram_total")
	data, err := os.ReadFile(path)
	if err != nil {
		return 0
	}
	return parseUint64(strings.TrimSpace(string(data)))
}

func extractLspciName(line string) string {
	// lspci -mm: slot "Class" "Vendor" "Device" "SVendor" "SDevice" "Rev"
	parts := strings.Split(line, `"`)
	if len(parts) >= 6 {
		return strings.TrimSpace(parts[3]) + " " + strings.TrimSpace(parts[5])
	}
	return strings.TrimSpace(line)
}

func detectPlatformGPUs() []GPUInfo {
	return detectLinuxGPUs()
}
