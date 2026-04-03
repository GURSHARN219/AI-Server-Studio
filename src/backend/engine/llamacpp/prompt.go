package llamacpp

import (
	"fmt"
	"strings"
)

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// Template handles message list to raw string conversion
type Template interface {
	Format(messages []Message) string
}

// ChatML implementation
type ChatMLTemplate struct{}

func (t ChatMLTemplate) Format(messages []Message) string {
	var sb strings.Builder
	for _, msg := range messages {
		sb.WriteString(fmt.Sprintf("<|im_start|>%s\n%s<|im_end|>\n", msg.Role, msg.Content))
	}
	sb.WriteString("<|im_start|>assistant\n")
	return sb.String()
}

// Llama3 implementation
type Llama3Template struct{}

func (t Llama3Template) Format(messages []Message) string {
	var sb strings.Builder
	sb.WriteString("<|begin_of_text|>")
	for _, msg := range messages {
		sb.WriteString(fmt.Sprintf("<|start_header_id|>%s<|end_header_id|>\n\n%s<|eot_id|>", msg.Role, msg.Content))
	}
	sb.WriteString("<|start_header_id|>assistant<|end_header_id|>\n\n")
	return sb.String()
}

// Mistral/Mixtral [INST] format
type MistralTemplate struct{}

func (t MistralTemplate) Format(messages []Message) string {
	var sb strings.Builder
	sb.WriteString("<s>")
	for i, msg := range messages {
		switch msg.Role {
		case "system":
			// Mistral has no system token — prepend to first user message
			if i+1 < len(messages) && messages[i+1].Role == "user" {
				messages[i+1].Content = msg.Content + "\n\n" + messages[i+1].Content
			}
		case "user":
			sb.WriteString(fmt.Sprintf("[INST] %s [/INST]", msg.Content))
		case "assistant":
			sb.WriteString(fmt.Sprintf(" %s</s>", msg.Content))
		}
	}
	return sb.String()
}

// Gemma format
type GemmaTemplate struct{}

func (t GemmaTemplate) Format(messages []Message) string {
	var sb strings.Builder
	for _, msg := range messages {
		switch msg.Role {
		case "user":
			sb.WriteString(fmt.Sprintf("<start_of_turn>user\n%s<end_of_turn>\n", msg.Content))
		case "assistant":
			sb.WriteString(fmt.Sprintf("<start_of_turn>model\n%s<end_of_turn>\n", msg.Content))
		case "system":
			sb.WriteString(fmt.Sprintf("<start_of_turn>user\n%s<end_of_turn>\n", msg.Content))
		}
	}
	sb.WriteString("<start_of_turn>model\n")
	return sb.String()
}

// Phi-3 format
type Phi3Template struct{}

func (t Phi3Template) Format(messages []Message) string {
	var sb strings.Builder
	for _, msg := range messages {
		switch msg.Role {
		case "system":
			sb.WriteString(fmt.Sprintf("<|system|>\n%s<|end|>\n", msg.Content))
		case "user":
			sb.WriteString(fmt.Sprintf("<|user|>\n%s<|end|>\n", msg.Content))
		case "assistant":
			sb.WriteString(fmt.Sprintf("<|assistant|>\n%s<|end|>\n", msg.Content))
		}
	}
	sb.WriteString("<|assistant|>\n")
	return sb.String()
}

// GetTemplate detects the best template for a model name
func GetTemplate(modelName string) Template {
	lower := strings.ToLower(modelName)
	switch {
	case strings.Contains(lower, "llama-3") || strings.Contains(lower, "llama3"):
		return Llama3Template{}
	case strings.Contains(lower, "mistral") || strings.Contains(lower, "mixtral"):
		return MistralTemplate{}
	case strings.Contains(lower, "gemma"):
		return GemmaTemplate{}
	case strings.Contains(lower, "phi-3") || strings.Contains(lower, "phi3"):
		return Phi3Template{}
	default:
		// ChatML covers: Qwen, DeepSeek, Yi, InternLM, and most modern models
		return ChatMLTemplate{}
	}
}
