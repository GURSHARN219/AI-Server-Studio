package llamacpp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// ChatCompletionRequest mirrors the OpenAI request format
type ChatCompletionRequest struct {
	Model     string      `json:"model"`
	Messages  []Message   `json:"messages"`
	Stream    bool        `json:"stream"`
	MaxTokens interface{} `json:"max_tokens"` // int or null
	Temp      float32     `json:"temperature"`
	TopP      float32     `json:"top_p"`
	Stop      interface{} `json:"stop"` // string or []string
}

// ChatCompletionResponse mirrors the OpenAI non-streaming response
type ChatCompletionResponse struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	Model   string `json:"model"`
	Choices []struct {
		Message      Message `json:"message"`
		Index        int     `json:"index"`
		FinishReason string  `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
}

// ChatCompletionChunk mirrors the standard OpenAI streaming chunk format
type ChatCompletionChunk struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	Model   string `json:"model"`
	Choices []struct {
		Index int `json:"index"`
		Delta struct {
			Content string `json:"content"`
		} `json:"delta"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
}

// HandleChatCompletion handles an incoming chat request (streaming or blocking)
func (s *Session) HandleChatCompletion(ctx context.Context, body []byte, w http.ResponseWriter) error {
	var req ChatCompletionRequest
	if err := json.Unmarshal(body, &req); err != nil {
		return fmt.Errorf("invalid request body: %w", err)
	}

	modelName := s.engine.ModelName
	template := GetTemplate(modelName)
	prompt := template.Format(req.Messages)

	maxTokens := 2048
	if req.MaxTokens != nil {
		switch v := req.MaxTokens.(type) {
		case float64:
			maxTokens = int(v)
		case int:
			maxTokens = v
		}
	}

	var stop []string
	if req.Stop != nil {
		switch v := req.Stop.(type) {
		case string:
			stop = []string{v}
		case []interface{}:
			for _, s := range v {
				if str, ok := s.(string); ok {
					stop = append(stop, str)
				}
			}
		}
	}

	sampler := SamplerParams{
		TopK:      40,
		TopP:      req.TopP,
		Temp:      req.Temp,
		MaxTokens: maxTokens,
		Stop:      stop,
	}
	if sampler.Temp == 0 {
		sampler.Temp = 0.7
	}
	if sampler.TopP == 0 {
		sampler.TopP = 0.9
	}

	if req.Stream {
		return s.handleStreaming(ctx, req, prompt, sampler, w)
	}
	return s.handleBlocking(ctx, req, prompt, sampler, w)
}

func (s *Session) handleStreaming(ctx context.Context, req ChatCompletionRequest, prompt string, sampler SamplerParams, w http.ResponseWriter) error {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	flusher, ok := w.(http.Flusher)
	if !ok {
		return fmt.Errorf("streaming not supported")
	}

	id := fmt.Sprintf("chatcmpl-%d", time.Now().Unix())

	err := s.Generate(ctx, prompt, sampler, func(token string) {
		chunk := ChatCompletionChunk{
			ID:      id,
			Object:  "chat.completion.chunk",
			Created: time.Now().Unix(),
			Model:   req.Model,
		}
		chunk.Choices = make([]struct {
			Index int `json:"index"`
			Delta struct {
				Content string `json:"content"`
			} `json:"delta"`
			FinishReason string `json:"finish_reason"`
		}, 1)
		chunk.Choices[0].Delta.Content = token

		data, _ := json.Marshal(chunk)
		fmt.Fprintf(w, "data: %s\n\n", string(data))
		flusher.Flush()
	})

	if err != nil {
		// Send error as SSE event so client knows generation failed
		errData, _ := json.Marshal(map[string]interface{}{
			"error": map[string]string{"message": err.Error(), "type": "engine_error"},
		})
		fmt.Fprintf(w, "data: %s\n\n", errData)
		flusher.Flush()
		return err
	}
	fmt.Fprintf(w, "data: [DONE]\n\n")
	flusher.Flush()
	return nil
}

func (s *Session) handleBlocking(ctx context.Context, req ChatCompletionRequest, prompt string, sampler SamplerParams, w http.ResponseWriter) error {
	var content strings.Builder
	promptTokenCount := len(prompt) / 4 // rough estimate; real count needs tokenizer access
	err := s.Generate(ctx, prompt, sampler, func(token string) {
		content.WriteString(token)
	})
	if err != nil {
		return err
	}

	completionTokens := len(content.String()) / 4 // rough estimate

	resp := ChatCompletionResponse{
		ID:      fmt.Sprintf("chatcmpl-%d", time.Now().Unix()),
		Object:  "chat.completion",
		Created: time.Now().Unix(),
		Model:   req.Model,
	}
	resp.Choices = make([]struct {
		Message      Message `json:"message"`
		Index        int     `json:"index"`
		FinishReason string  `json:"finish_reason"`
	}, 1)
	resp.Choices[0].Message = Message{Role: "assistant", Content: content.String()}
	resp.Choices[0].FinishReason = "stop"
	resp.Usage.PromptTokens = promptTokenCount
	resp.Usage.CompletionTokens = completionTokens
	resp.Usage.TotalTokens = promptTokenCount + completionTokens

	data, _ := json.Marshal(resp)
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
	return nil
}
