package engine

import (
	"runtime"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/host"
	"github.com/shirou/gopsutil/v3/mem"
)

// HardwareInfo represents system hardware information
type HardwareInfo struct {
	CPU      CPUInfo    `json:"cpu"`
	Memory   MemInfo    `json:"memory"`
	GPUs     []GPUInfo  `json:"gpus"`
	Platform string     `json:"platform"`
	Arch     string     `json:"arch"`
}

// CPUInfo represents CPU details
type CPUInfo struct {
	Name          string   `json:"name"`
	Manufacturer  string   `json:"manufacturer"`
	Cores         int      `json:"cores"`
	PhysicalCores int      `json:"physicalCores"`
	Speed         float64  `json:"speed"`
	Architecture  string   `json:"architecture"`
	Extensions    []string `json:"extensions"`
}

// MemInfo represents memory details
type MemInfo struct {
	TotalRAM uint64 `json:"totalRam"`
	FreeRAM  uint64 `json:"freeRam"`
	UsedRAM  uint64 `json:"usedRam"`
}

// GPUInfo represents GPU details
type GPUInfo struct {
	Name          string `json:"name"`
	VRAM          uint64 `json:"vram"`
	VRAMFree      uint64 `json:"vramFree"`
	Vendor        string `json:"vendor"`
	DeviceID      string `json:"deviceId"`
	HasCuda       bool   `json:"hasCuda"`
	HasVulkan     bool   `json:"hasVulkan"`
	DriverVersion string `json:"driverVersion"`
}

// ResourceUsage represents current system resource usage
type ResourceUsage struct {
	CPUPercent float64 `json:"cpuPercent"`
	RAMUsed    uint64  `json:"ramUsed"`
	RAMTotal   uint64  `json:"ramTotal"`
}

// GetHardwareInfo collects system hardware information
func GetHardwareInfo() (*HardwareInfo, error) {
	info := &HardwareInfo{
		Platform: runtime.GOOS,
		Arch:     runtime.GOARCH,
	}

	// CPU info
	cpuInfo, err := cpu.Info()
	if err == nil && len(cpuInfo) > 0 {
		ci := cpuInfo[0]
		info.CPU = CPUInfo{
			Name:          ci.ModelName,
			Manufacturer:  ci.VendorID,
			Cores:         int(ci.Cores),
			PhysicalCores: int(ci.Cores),
			Speed:         ci.Mhz / 1000.0,
			Architecture:  runtime.GOARCH,
			Extensions:    detectCPUExtensions(ci.Flags),
		}
	}

	// Logical core count
	logicalCores, err := cpu.Counts(true)
	if err == nil {
		info.CPU.Cores = logicalCores
	}
	physCores, err := cpu.Counts(false)
	if err == nil {
		info.CPU.PhysicalCores = physCores
	}

	// Memory info
	memInfo, err := mem.VirtualMemory()
	if err == nil {
		info.Memory = MemInfo{
			TotalRAM: memInfo.Total,
			FreeRAM:  memInfo.Available,
			UsedRAM:  memInfo.Used,
		}
	}

	// Host info for platform
	hostInfo, err := host.Info()
	if err == nil {
		info.Platform = hostInfo.Platform
	}

	// GPU info (basic detection on Windows)
	info.GPUs = detectGPUs()

	return info, nil
}

// GetResourceUsage returns current CPU and memory usage
func GetResourceUsage() (*ResourceUsage, error) {
	usage := &ResourceUsage{}

	// CPU percent
	percents, err := cpu.Percent(0, false)
	if err == nil && len(percents) > 0 {
		usage.CPUPercent = percents[0]
	}

	// Memory
	memInfo, err := mem.VirtualMemory()
	if err == nil {
		usage.RAMUsed = memInfo.Used
		usage.RAMTotal = memInfo.Total
	}

	return usage, nil
}

func detectCPUExtensions(flags []string) []string {
	var extensions []string
	flagSet := make(map[string]bool)
	for _, f := range flags {
		flagSet[f] = true
	}

	if flagSet["avx512f"] || flagSet["avx512"] {
		extensions = append(extensions, "AVX-512")
	}
	if flagSet["avx2"] {
		extensions = append(extensions, "AVX2")
	}
	if flagSet["avx"] {
		extensions = append(extensions, "AVX")
	}
	if flagSet["sse4_2"] || flagSet["sse42"] {
		extensions = append(extensions, "SSE4.2")
	}

	return extensions
}

// GPUBackend represents the compute backend to use for GPU inference.
type GPUBackend string

const (
	GPUBackendNone   GPUBackend = "none"
	GPUBackendCUDA   GPUBackend = "cuda"   // NVIDIA CUDA
	GPUBackendROCm   GPUBackend = "rocm"   // AMD ROCm (Linux)
	GPUBackendVulkan GPUBackend = "vulkan" // AMD/Intel Vulkan (cross-platform)
	GPUBackendMetal  GPUBackend = "metal"  // Apple Metal (macOS)
)

// BestGPUBackend returns the best available GPU backend, recommended gpu_layers,
// GPU name, and detected CUDA major version (0 if not NVIDIA/no CUDA).
// Returns (GPUBackendNone, 0, "", 0) when no GPU is found or cpuOnly is true.
func BestGPUBackend(cpuOnly bool) (backend GPUBackend, gpuLayers int, gpuName string, cudaMajor int) {
	if cpuOnly {
		return GPUBackendNone, 0, "", 0
	}

	gpus := detectGPUs()
	if len(gpus) == 0 {
		return GPUBackendNone, 0, "", 0
	}

	// Prefer discrete GPU with most VRAM
	best := gpus[0]
	for _, g := range gpus[1:] {
		if g.VRAM > best.VRAM {
			best = g
		}
	}

	switch best.Vendor {
	case "NVIDIA":
		cuda := DetectCUDAVersion()
		return GPUBackendCUDA, 99, best.Name, cuda
	case "AMD":
		if runtime.GOOS == "linux" {
			return GPUBackendROCm, 99, best.Name, 0
		}
		return GPUBackendVulkan, 99, best.Name, 0
	case "Intel":
		return GPUBackendVulkan, 33, best.Name, 0
	case "Apple":
		return GPUBackendMetal, 99, best.Name, 0
	default:
		if best.HasCuda {
			cuda := DetectCUDAVersion()
			return GPUBackendCUDA, 99, best.Name, cuda
		}
		if best.HasVulkan {
			return GPUBackendVulkan, 33, best.Name, 0
		}
		return GPUBackendNone, 0, "", 0
	}
}

func detectGPUs() []GPUInfo {
	return detectPlatformGPUs()
}
