//go:build cgo

package llamacpp

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// Engine represents the embedded llama.cpp runtime
type Engine struct {
	mu sync.Mutex

	model  *LlamaModel
	params Params

	// ModelName is the name of the currently loaded model
	ModelName string

	// global init tracker
	initialized bool
}

// NewEngine creates a new embedded engine instance
func NewEngine(params Params) *Engine {
	return &Engine{params: params}
}

// Init initializes the llama.cpp backend
func (e *Engine) Init() {
	e.mu.Lock()
	defer e.mu.Unlock()
	if !e.initialized {
		if logPath := os.Getenv("AIST_ENGINE_LOG_FILE"); logPath != "" && !RedirectStderr(logPath) {
			log.Printf("[llamacpp] failed to redirect native stderr to %s", logPath)
		}
		BackendInit()
		e.initialized = true
	}
}

// Close frees the model and backend
func (e *Engine) Close() {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.model != nil {
		e.model.Free()
		e.model = nil
	}
	if e.initialized {
		BackendFree()
		e.initialized = false
	}
}

// LoadModel loads a GGUF model from disk
func (e *Engine) LoadModel(path string) error {
	e.mu.Lock()
	params := e.params
	e.mu.Unlock()
	return e.LoadModelWithParams(path, params)
}

// LoadModelWithParams loads a model using a per-load context/GPU configuration.
func (e *Engine) LoadModelWithParams(path string, params Params) error {
	e.mu.Lock()
	defer e.mu.Unlock()

	if !e.initialized {
		if logPath := os.Getenv("AIST_ENGINE_LOG_FILE"); logPath != "" && !RedirectStderr(logPath) {
			log.Printf("[llamacpp] failed to redirect native stderr to %s", logPath)
		}
		BackendInit()
		e.initialized = true
	}

	if e.model != nil {
		e.model.Free()
		e.model = nil
	}
	e.ModelName = ""

	model, err := LoadModel(path, params)
	if err != nil {
		return err
	}
	e.model = model
	e.params = params
	e.ModelName = strings.TrimSuffix(filepath.Base(path), ".gguf")
	return nil
}

// Session represents an inference state with KV cache
type Session struct {
	mu sync.Mutex

	engine *Engine
	ctx    *LlamaContext
	params Params
	nPast  int

	// tokens tracks generated tokens for stop-sequence detection
	tokens []int32
}

// NewSession creates a new inference session for the current model.
// Does NOT hold e.mu across the CGO NewContext call.
func (e *Engine) NewSession() (*Session, error) {
	e.mu.Lock()
	model := e.model
	params := e.params
	e.mu.Unlock()

	if model == nil {
		return nil, fmt.Errorf("no model loaded")
	}

	ctx, err := model.NewContext(params)
	if err != nil {
		return nil, err
	}

	return &Session{engine: e, ctx: ctx, params: params}, nil
}

// Close frees the session context
func (s *Session) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ctx != nil {
		s.ctx.Free()
		s.ctx = nil
	}
}

// Tokenize converts text to tokens. Safe to call without holding any lock.
func (e *Engine) Tokenize(text string, addBos bool) ([]int32, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	model := e.model

	if model == nil {
		return nil, fmt.Errorf("no model loaded")
	}
	tokens := model.Tokenize(text, 8192, addBos)
	if tokens == nil {
		return nil, fmt.Errorf("tokenization failed")
	}
	return tokens, nil
}

// Generate runs the inference loop, streaming tokens via onToken.
// Holds s.mu only per-step so Close() can interrupt between tokens.
func (s *Session) Generate(ctx context.Context, prompt string, sampler SamplerParams, onToken func(string)) error {
	// Quick open-check
	s.mu.Lock()
	if s.ctx == nil {
		s.mu.Unlock()
		return fmt.Errorf("session closed")
	}
	s.mu.Unlock()

	// Tokenize outside the lock (model is read-only after load)
	tokens, err := s.engine.Tokenize(prompt, s.nPast == 0)
	if err != nil {
		return err
	}

	// Decode prompt batch
	s.mu.Lock()
	if s.ctx == nil {
		s.mu.Unlock()
		return fmt.Errorf("session closed")
	}
	if len(tokens) > 0 {
		if err = s.ctx.Decode(tokens, s.nPast); err != nil {
			s.mu.Unlock()
			return fmt.Errorf("failed to decode prompt: %w", err)
		}
		s.nPast += len(tokens)
	}
	s.mu.Unlock()

	eosToken := s.engine.model.GetEOS()
	maxTokens := sampler.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 2048
	}

	count := 0
	for count < maxTokens {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		// Lock only for this sample+decode step
		s.mu.Lock()
		if s.ctx == nil {
			s.mu.Unlock()
			return fmt.Errorf("session closed")
		}

		kvUsed := s.ctx.GetKVCount()
		if s.params.CtxSize > 0 && kvUsed >= s.params.CtxSize-1 {
			s.mu.Unlock()
			onToken("\n[Context limit reached]")
			break
		}

		token := s.ctx.Sample(sampler)
		if token == eosToken {
			s.mu.Unlock()
			break
		}

		piece := s.engine.model.Detokenize(token)

		if err = s.ctx.Decode([]int32{token}, s.nPast); err != nil {
			s.mu.Unlock()
			return fmt.Errorf("failed to decode token: %w", err)
		}
		s.tokens = append(s.tokens, token)
		s.nPast++
		s.mu.Unlock()

		count++

		// Check stop sequences BEFORE emitting — trim the stop string from piece
		shouldStop := false
		if len(sampler.Stop) > 0 {
			fullText := strings.Join(s.getGeneratedText(), "")
			for _, stop := range sampler.Stop {
				if idx := strings.Index(fullText, stop); idx >= 0 {
					shouldStop = true
					// Trim anything at or after the stop sequence from piece
					overlapStart := idx - (len(fullText) - len(piece))
					if overlapStart >= 0 && overlapStart < len(piece) {
						piece = piece[:overlapStart]
					} else if overlapStart < 0 {
						piece = "" // stop was entirely in previous tokens
					}
					break
				}
			}
		}

		if piece != "" {
			onToken(piece)
		}
		if shouldStop {
			break
		}
	}

	return nil
}

// getGeneratedText returns all generated pieces joined — called without lock
// (tokens slice is only appended inside the locked section of Generate)
func (s *Session) getGeneratedText() []string {
	res := make([]string, len(s.tokens))
	for i, t := range s.tokens {
		res[i] = s.engine.model.Detokenize(t)
	}
	return res
}
