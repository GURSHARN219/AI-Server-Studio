package engine

import (
	"errors"
	"net/http"
)

// ErrUnavailable marks a selected runtime that cannot execute inference in
// the current build (for example, embedded llama.cpp without CGO support).
var ErrUnavailable = errors.New("inference engine unavailable")

// ErrBusy marks a conflicting load, unload, or shutdown lifecycle operation.
var ErrBusy = errors.New("inference engine operation already in progress")

// ErrUnsupportedModelArchitecture marks a valid model file whose GGUF
// architecture is not implemented by the bundled inference runtime.
var ErrUnsupportedModelArchitecture = errors.New("unsupported model architecture")

// EngineInterface is the common interface for both the subprocess engine
// (Engine, uses llama-server binary) and the CGo direct engine (CgoEngine).
// The HTTP server works with either implementation.
type EngineInterface interface {
	LoadModel(modelPath string, config *LoadConfig) error
	UnloadModel()
	StopGenerating()
	IsModelLoaded() bool
	IsLoading() bool
	GetModelName() string
	GetModelPath() string
	GetModelsDir() string
	SetModelsDir(dir string)
	SetDefaultContext(nCtx int)
	SetGpuAccel(enabled bool)
	GetInternalPort() int
	GetStatus() map[string]interface{}
	ScanModels() []ModelInfo
	ChatCompletion(body []byte) (*http.Response, error)
	StreamChatCompletion(body []byte, w http.ResponseWriter) error
	Subscribe() chan Event
	Unsubscribe(ch chan Event)
	HealthCheck() bool
	Shutdown()
}
