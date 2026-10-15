//go:build !cgo

package engine

import (
	"fmt"
	"net/http"
)

// EmbeddedEngine is unavailable in builds without CGO. The normal subprocess
// engine remains available and is used by default.
type EmbeddedEngine struct {
	modelsDir  string
	nCtx       int
	nGpuLayers int
	backend    GPUBackend
}

func NewEmbeddedEngine(modelsDir string, nGpuLayers, nCtx int, backend GPUBackend) *EmbeddedEngine {
	return &EmbeddedEngine{
		modelsDir:  modelsDir,
		nCtx:       nCtx,
		nGpuLayers: nGpuLayers,
		backend:    backend,
	}
}

func (e *EmbeddedEngine) LoadModel(string, *LoadConfig) error {
	return fmt.Errorf("embedded llama.cpp requires a CGO-enabled build")
}

func (e *EmbeddedEngine) UnloadModel()               {}
func (e *EmbeddedEngine) StopGenerating()            {}
func (e *EmbeddedEngine) IsModelLoaded() bool        { return false }
func (e *EmbeddedEngine) IsLoading() bool            { return false }
func (e *EmbeddedEngine) GetModelName() string       { return "" }
func (e *EmbeddedEngine) GetModelPath() string       { return "" }
func (e *EmbeddedEngine) GetModelsDir() string       { return e.modelsDir }
func (e *EmbeddedEngine) SetModelsDir(dir string)    { e.modelsDir = dir }
func (e *EmbeddedEngine) SetDefaultContext(nCtx int) { e.nCtx = nCtx }
func (e *EmbeddedEngine) SetGpuAccel(enabled bool) {
	if enabled {
		e.nGpuLayers = 999
	} else {
		e.nGpuLayers = 0
	}
}
func (e *EmbeddedEngine) GetInternalPort() int { return 0 }
func (e *EmbeddedEngine) GetStatus() map[string]interface{} {
	return map[string]interface{}{
		"loaded":        false,
		"model":         "",
		"modelName":     "",
		"backend":       "embedded/llamacpp",
		"runtimeMode":   "embedded",
		"loading":       false,
		"gpuBackend":    string(e.backend),
		"gpuLayers":     e.nGpuLayers,
		"binaryPath":    "",
		"binaryVariant": "",
		"binaryVersion": "",
		"cpuOnly":       e.backend == GPUBackendNone || e.nGpuLayers == 0,
		"available":     false,
	}
}
func (e *EmbeddedEngine) ScanModels() []ModelInfo { return scanModelsDir(e.modelsDir) }
func (e *EmbeddedEngine) ChatCompletion([]byte) (*http.Response, error) {
	return nil, fmt.Errorf("embedded llama.cpp requires a CGO-enabled build")
}
func (e *EmbeddedEngine) StreamChatCompletion([]byte, http.ResponseWriter) error {
	return fmt.Errorf("embedded llama.cpp requires a CGO-enabled build")
}
func (e *EmbeddedEngine) Subscribe() chan Event  { return make(chan Event) }
func (e *EmbeddedEngine) Unsubscribe(chan Event) {}
func (e *EmbeddedEngine) HealthCheck() bool      { return false }
func (e *EmbeddedEngine) Shutdown()              {}
