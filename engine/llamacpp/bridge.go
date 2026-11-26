//go:build cgo

package llamacpp

/*
#cgo LDFLAGS: -L${SRCDIR}/../../bin -lllama
#include <stdlib.h>
#include "bridge.h"
*/
import "C"
import (
	"fmt"
	"unsafe"
)

type Params struct {
	Threads    int
	CtxSize    int
	BatchSize  int
	GpuLayers  int
	UseMmap    bool
	UseMlock   bool
	Embeddings bool
}

type SamplerParams struct {
	TopK          int
	TopP          float32
	Temp          float32
	RepeatPenalty float32
	MaxTokens     int
	Stop          []string
}

func (p Params) toC() C.llama_bridge_params {
	return C.llama_bridge_params{
		n_threads:    C.int32_t(p.Threads),
		n_ctx:        C.int32_t(p.CtxSize),
		n_batch:      C.int32_t(p.BatchSize),
		n_gpu_layers: C.int32_t(p.GpuLayers),
		use_mmap:     C.bool(p.UseMmap),
		use_mlock:    C.bool(p.UseMlock),
		embeddings:   C.bool(p.Embeddings),
	}
}

func (p SamplerParams) toC() C.llama_bridge_sampler_params {
	return C.llama_bridge_sampler_params{
		top_k:          C.int32_t(p.TopK),
		top_p:          C.float(p.TopP),
		temp:           C.float(p.Temp),
		repeat_penalty: C.float(p.RepeatPenalty),
	}
}

func BackendInit() {
	C.bridge_backend_init()
}

func RedirectStderr(path string) bool {
	cPath := C.CString(path)
	defer C.free(unsafe.Pointer(cPath))
	return C.bridge_redirect_stderr(cPath) != 0
}

func BackendFree() {
	C.bridge_backend_free()
}

type LlamaModel struct {
	ptr C.llama_model_ptr
}

func LoadModel(path string, params Params) (*LlamaModel, error) {
	cPath := C.CString(path)
	defer C.free(unsafe.Pointer(cPath))

	ptr := C.bridge_load_model(cPath, params.toC())
	if ptr == nil {
		return nil, fmt.Errorf("failed to load model from %s", path)
	}
	return &LlamaModel{ptr: ptr}, nil
}

func (m *LlamaModel) GetBOS() int32 { return int32(C.bridge_token_bos(m.ptr)) }
func (m *LlamaModel) GetEOS() int32 { return int32(C.bridge_token_eos(m.ptr)) }
func (m *LlamaModel) GetNL() int32  { return int32(C.bridge_token_nl(m.ptr)) }

func (c *LlamaContext) GetKVCount() int { return int(C.bridge_get_kv_count(c.ptr)) }

func (m *LlamaModel) Free() {
	if m.ptr != nil {
		C.bridge_free_model(m.ptr)
		m.ptr = nil
	}
}

type LlamaContext struct {
	ptr C.llama_context_ptr
}

func (m *LlamaModel) NewContext(params Params) (*LlamaContext, error) {
	ptr := C.bridge_new_context(m.ptr, params.toC())
	if ptr == nil {
		return nil, fmt.Errorf("failed to create context")
	}
	return &LlamaContext{ptr: ptr}, nil
}

func (c *LlamaContext) Free() {
	if c.ptr != nil {
		C.bridge_free_context(c.ptr)
		c.ptr = nil
	}
}

func (m *LlamaModel) Tokenize(text string, maxTokens int, addBos bool) []int32 {
	if m == nil || m.ptr == nil || maxTokens <= 0 {
		return nil
	}
	cText := C.CString(text)
	defer C.free(unsafe.Pointer(cText))

	tokens := make([]C.int32_t, maxTokens)
	n := C.bridge_tokenize(m.ptr, cText, &tokens[0], C.int32_t(maxTokens), C.bool(addBos), C.bool(true))
	if n <= 0 || n > C.int32_t(maxTokens) {
		return nil
	}

	res := make([]int32, n)
	for i := range res {
		res[i] = int32(tokens[i])
	}
	return res
}

func (m *LlamaModel) Detokenize(token int32) string {
	buf := make([]C.char, 256)
	n := C.bridge_detokenize(m.ptr, C.int32_t(token), &buf[0], 256)
	if n < 0 {
		return ""
	}
	return C.GoStringN(&buf[0], n)
}

func (c *LlamaContext) Decode(tokens []int32, nPast int) error {
	if len(tokens) == 0 {
		return nil
	}
	cTokens := make([]C.int32_t, len(tokens))
	for i, t := range tokens {
		cTokens[i] = C.int32_t(t)
	}

	res := C.bridge_decode(c.ptr, &cTokens[0], C.int32_t(len(tokens)), C.int32_t(nPast))
	if res != 0 {
		return fmt.Errorf("decode failed with code %d", res)
	}
	return nil
}

func (c *LlamaContext) Sample(params SamplerParams) int32 {
	return int32(C.bridge_sample(c.ptr, params.toC()))
}
