package engine

import "strings"

// detectWindowsGPUs detects GPUs on Windows.
// Priority: nvidia-smi (CUDA) → PowerShell WMI → WMIC fallback. Once the
// NVIDIA probe succeeds, the CUDA device information is complete for the
// inference runtime; do not launch a supplemental PowerShell process during
// every desktop startup just to discover an unrelated display adapter.
func detectWindowsGPUs() []GPUInfo {
	// NVIDIA via nvidia-smi (most accurate — gives real VRAM + driver)
	if gpus := detectNvidiaGPUs(); len(gpus) > 0 {
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
	out, err := hiddenCommand("nvidia-smi",
		"--query-gpu=name,memory.total,memory.free,driver_version,utilization.gpu,temperature.gpu,power.draw,power.limit",
		"--format=csv,noheader,nounits").Output()
	if err != nil {
		return nil
	}

	var gpus []GPUInfo
	for i, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		parts := strings.SplitN(line, ", ", 8)
		if len(parts) < 4 {
			continue
		}
		vram := parseUint64(parts[1]) * 1024 * 1024
		vramFree := parseUint64(parts[2]) * 1024 * 1024
		gpu := GPUInfo{
			Name:              strings.TrimSpace(parts[0]),
			VRAM:              vram,
			VRAMFree:          vramFree,
			Vendor:            "NVIDIA",
			DeviceID:          itoa(i),
			HasCuda:           true,
			HasVulkan:         true,
			DriverVersion:     strings.TrimSpace(parts[3]),
			SupportedBackends: []string{"cuda", "vulkan"},
		}
		if len(parts) > 4 {
			gpu.UtilizationPercent = parseOptionalFloat(parts[4])
		}
		if len(parts) > 5 {
			gpu.TemperatureC = parseOptionalFloat(parts[5])
		}
		if len(parts) > 6 {
			gpu.PowerUsageWatts = parseOptionalFloat(parts[6])
		}
		if len(parts) > 7 {
			gpu.PowerLimitWatts = parseOptionalFloat(parts[7])
		}
		gpus = append(gpus, gpu)
	}
	return gpus
}

// detectWMIGPUs uses PowerShell Get-WmiObject (replaces deprecated WMIC).
func detectWMIGPUs() []GPUInfo {
	out, err := hiddenCommand("powershell", "-NoProfile", "-NonInteractive", "-Command",
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
			Name:              name,
			VRAM:              vram,
			Vendor:            vendor,
			DeviceID:          itoa(i - 1),
			HasCuda:           hasCuda,
			HasVulkan:         hasVulkan,
			DriverVersion:     driver,
			SupportedBackends: supportedBackends(hasCuda, hasVulkan),
		})
	}
	return gpus
}

// detectWMICGPUs is the legacy WMIC fallback (deprecated in Win11 but still present).
func detectWMICGPUs() []GPUInfo {
	out, err := hiddenCommand("wmic", "path", "Win32_VideoController", "get",
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
			Name:              name,
			VRAM:              vram,
			Vendor:            vendor,
			DeviceID:          itoa(i - 1),
			HasCuda:           hasCuda,
			HasVulkan:         hasVulkan,
			DriverVersion:     driver,
			SupportedBackends: supportedBackends(hasCuda, hasVulkan),
		})
	}
	return gpus
}

func supportedBackends(hasCuda, hasVulkan bool) []string {
	backends := make([]string, 0, 2)
	if hasCuda {
		backends = append(backends, "cuda")
	}
	if hasVulkan {
		backends = append(backends, "vulkan")
	}
	return backends
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
