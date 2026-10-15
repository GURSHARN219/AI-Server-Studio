package server

import (
	"fmt"
	"net/http"
	"strings"

	"ai-server-studio-backend/engine"
)

func (s *Server) registerSystemRoutes() {
	s.mux.HandleFunc("GET /v1/system/status", s.handleGetStatus)
	s.mux.HandleFunc("GET /v1/system/hardware", s.handleGetHardware)
	s.mux.HandleFunc("GET /v1/system/usage", s.handleGetHardwareUsage)
	s.mux.HandleFunc("GET /v1/system/backends", s.handleGetBackends)
}

// GET /v1/system/status
func (s *Server) handleGetStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, s.eng.GetStatus())
}

// GET /v1/system/hardware
func (s *Server) handleGetHardware(w http.ResponseWriter, r *http.Request) {
	info, err := engine.GetHardwareInfo()
	if err != nil {
		writeError(w, 500, err.Error(), "server_error")
		return
	}
	writeJSON(w, info)
}

// GET /v1/system/usage
func (s *Server) handleGetHardwareUsage(w http.ResponseWriter, r *http.Request) {
	usage, err := engine.GetResourceUsage()
	if err != nil {
		writeError(w, 500, err.Error(), "server_error")
		return
	}
	writeJSON(w, usage)
}

// GET /v1/system/backends
func (s *Server) handleGetBackends(w http.ResponseWriter, r *http.Request) {
	status := s.eng.GetStatus()

	variant, _ := status["binaryVariant"].(string)
	version, _ := status["binaryVersion"].(string)
	if variant == "" || version == "" {
		installer := engine.GetEngineInstaller(s.baseDir)
		if variant == "" {
			variant = installer.InstalledVariant()
		}
		if version == "" {
			version = installer.InstalledVersion()
		}
	}

	displayName := "llama.cpp (Go Engine)"
	description := "llama.cpp via Go backend — manages llama-server subprocess"
	backendName, _ := status["backend"].(string)
	runtimeMode, _ := status["runtimeMode"].(string)
	isEmbedded := runtimeMode == "embedded" || strings.HasPrefix(backendName, "embedded/")
	if isEmbedded {
		displayName = "llama.cpp (embedded)"
		description = "llama.cpp embedded in the Go backend using prebuilt local binaries"
	} else if variant != "" && version != "" {
		displayName = fmt.Sprintf("llama.cpp %s (%s)", version, variant)
	} else if variant != "" {
		displayName = fmt.Sprintf("llama.cpp (%s)", variant)
	}

	backend := map[string]interface{}{
		"name":        "llama.cpp",
		"displayName": displayName,
		"description": description,
		"version":     version,
		"gpu":         nil,
		"gpuMake":     nil,
		"cpu":         []string{"AVX2"},
		"active":      status["loaded"],
		"gpuBackend":  status["gpuBackend"],
		"variant":     variant,
		"binaryPath":  status["binaryPath"],
	}

	if gpuBackend, ok := status["gpuBackend"].(string); ok && gpuBackend != "" && gpuBackend != "none" {
		switch gpuBackend {
		case "cuda":
			backend["gpu"] = "CUDA"
			backend["gpuMake"] = "Nvidia"
		case "rocm":
			backend["gpu"] = "ROCm"
			backend["gpuMake"] = "AMD"
		case "vulkan":
			backend["gpu"] = "Vulkan"
			if info, err := engine.GetHardwareInfo(); err == nil && len(info.GPUs) > 0 {
				backend["gpuMake"] = info.GPUs[0].Vendor
			}
		case "metal":
			backend["gpu"] = "Metal"
			backend["gpuMake"] = "Apple"
		}
	}

	writeJSON(w, map[string]interface{}{"object": "list", "data": []interface{}{backend}})
}
