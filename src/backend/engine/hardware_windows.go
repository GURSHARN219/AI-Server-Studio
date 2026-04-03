package engine

import (
	"os/exec"
	"strings"
)

// detectWindowsGPUs detects GPUs on Windows.
// Priority: nvidia-smi (CUDA) → PowerShell WMI → WMIC fallback
func detectWindowsGPUs() []GPUInfo {
	// NVIDIA via nvidia-smi (most accurate — gives real VRAM + driver)
	if gpus := detectNvidiaGPUs(); len(gpus) > 0 {
		// Also append any non-NVIDIA GPUs from WMI (e.g. Intel iGPU alongside NVIDIA dGPU)
		wmi := detectWMIGPUs()
		for _, w := range wmi {
			if w.Vendor != "NVIDIA" {
				gpus = append(gpus, w)
			}
		}
		return gpus
	}

	// No NVIDIA — try PowerShell WMI (preferred over deprecated WMIC)
	if gpus := detectWMIGPUs(); len(gpus) > 0 {
		return gpus
	}

	// Last resort: legacy WMIC
	return detectWMICGPUs()
}

// detectNvidiaGPUs uses nvidia-smi for accurate CUDA GPU info.
func detectNvidiaGPUs() []GPUInfo {
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

// detectWMIGPUs uses PowerShell Get-WmiObject (replaces deprecated WMIC).
func detectWMIGPUs() []GPUInfo {
	out, err := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command",
		`Get-WmiObject Win32_VideoController | Select-Object Name,AdapterRAM,DriverVersion | ConvertTo-Csv -NoTypeInformation`).Output()
	if err != nil {
		return nil
	}

	var gpus []GPUInfo
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	for i, line := range lines {
		if i == 0 { // header
			continue
		}
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := splitCSV(line)
		if len(parts) < 3 {
			continue
		}
		name := unquote(parts[0])
		vram := parseUint64(unquote(parts[1]))
		driver := unquote(parts[2])
		if name == "" {
			continue
		}
		vendor, hasCuda, hasVulkan := classifyGPU(name)
		gpus = append(gpus, GPUInfo{
			Name:          name,
			VRAM:          vram,
			Vendor:        vendor,
			DeviceID:      itoa(i - 1),
			HasCuda:       hasCuda,
			HasVulkan:     hasVulkan,
			DriverVersion: driver,
		})
	}
	return gpus
}

// detectWMICGPUs is the legacy WMIC fallback (deprecated in Win11 but still present).
func detectWMICGPUs() []GPUInfo {
	out, err := exec.Command("wmic", "path", "Win32_VideoController", "get",
		"Name,AdapterRAM,DriverVersion", "/format:csv").Output()
	if err != nil {
		return nil
	}

	var gpus []GPUInfo
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	for i, line := range lines {
		if i == 0 {
			continue
		}
		parts := strings.Split(strings.TrimSpace(line), ",")
		if len(parts) < 4 {
			continue
		}
		vram := parseUint64(strings.TrimSpace(parts[1]))
		driver := strings.TrimSpace(parts[2])
		name := strings.TrimSpace(parts[3])
		if name == "" {
			continue
		}
		vendor, hasCuda, hasVulkan := classifyGPU(name)
		gpus = append(gpus, GPUInfo{
			Name:          name,
			VRAM:          vram,
			Vendor:        vendor,
			DeviceID:      itoa(i - 1),
			HasCuda:       hasCuda,
			HasVulkan:     hasVulkan,
			DriverVersion: driver,
		})
	}
	return gpus
}

// unquote strips surrounding double-quotes from a CSV field.
func unquote(s string) string {
	s = strings.TrimSpace(s)
	if len(s) >= 2 && s[0] == '"' && s[len(s)-1] == '"' {
		return s[1 : len(s)-1]
	}
	return s
}

// splitCSV splits a single CSV line respecting quoted fields.
func splitCSV(line string) []string {
	var fields []string
	var cur strings.Builder
	inQuote := false
	for _, c := range line {
		switch {
		case c == '"':
			inQuote = !inQuote
			cur.WriteRune(c)
		case c == ',' && !inQuote:
			fields = append(fields, cur.String())
			cur.Reset()
		default:
			cur.WriteRune(c)
		}
	}
	fields = append(fields, cur.String())
	return fields
}

// fmt_sscanf kept for backward compat
func fmt_sscanf(s string, v *uint64) {
	*v = parseUint64(s)
}

func detectPlatformGPUs() []GPUInfo {
	return detectWindowsGPUs()
}
