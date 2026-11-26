package modelregistry

import (
	"bufio"
	"encoding/binary"
	"io"
	"os"
)

const (
	ggufMagic       = "GGUF"
	ggufVersionV2   = 2
	ggufVersionV3   = 3
	maxMetadataSize = 64 << 20
	maxStringSize   = 16 << 20
	maxArrayItems   = 16 << 20
)

// UnknownGGUFMetadata returns a fully explicit unknown value.
func UnknownGGUFMetadata() GGUFMetadata {
	return GGUFMetadata{Status: Unknown, Architecture: Unknown, Quantization: Unknown, Tokenizer: UnknownTokenizerMetadata()}
}

// ReadGGUFMetadata reads only the bounded GGUF header and metadata section.
// Unsupported versions, malformed values, and truncated metadata return an
// all-unknown result with a nil error: callers can register a file without
// allowing a best-effort parser to invent model properties. File open errors
// are returned normally.
func ReadGGUFMetadata(path string) (GGUFMetadata, error) {
	unknown := UnknownGGUFMetadata()
	f, err := os.Open(path)
	if err != nil {
		return unknown, err
	}
	defer f.Close()
	r := &ggufReader{r: bufio.NewReader(io.LimitReader(f, maxMetadataSize))}
	var magic [4]byte
	if _, err = io.ReadFull(r.r, magic[:]); err != nil || string(magic[:]) != ggufMagic {
		return unknown, nil
	}
	version, err := r.u32()
	if err != nil || (version != ggufVersionV2 && version != ggufVersionV3) {
		return unknown, nil
	}
	tensorCount, err := r.u64()
	if err != nil {
		return unknown, nil
	}
	metadataCount, err := r.u64()
	if err != nil || metadataCount > maxArrayItems {
		return unknown, nil
	}
	_ = tensorCount // Tensor descriptors are outside this minimal reader's scope.
	metadata := UnknownGGUFMetadata()
	metadata.Version = uint32(version)
	for i := uint64(0); i < metadataCount; i++ {
		key, readErr := r.string()
		if readErr != nil {
			return UnknownGGUFMetadata(), nil
		}
		valueType, readErr := r.u32()
		if readErr != nil {
			return UnknownGGUFMetadata(), nil
		}
		value, readErr := r.value(valueType, key, 0)
		if readErr != nil {
			return UnknownGGUFMetadata(), nil
		}
		switch key {
		case "general.architecture":
			if text, ok := value.(string); ok {
				metadata.Architecture = text
			}
		case "general.quantization":
			if text, ok := value.(string); ok {
				metadata.Quantization = text
			}
		case "general.file_type":
			if number, ok := value.(uint64); ok {
				metadata.Quantization = "file_type:" + itoa(number)
			}
		case "tokenizer.ggml.model":
			if text, ok := value.(string); ok {
				metadata.Tokenizer.Model = text
			}
		case "tokenizer.ggml.pre":
			if text, ok := value.(string); ok {
				metadata.Tokenizer.Pre = text
			}
		case "tokenizer.ggml.token_type":
			if text, ok := value.(string); ok {
				metadata.Tokenizer.TokenType = text
			}
		case "tokenizer.ggml.tokens":
			if count, ok := value.(uint64); ok && count <= uint64(^uint64(0)>>1) {
				metadata.Tokenizer.TokenCount = int64(count)
			}
		}
	}
	metadata.Status = "known"
	return metadata, nil
}

type ggufReader struct{ r *bufio.Reader }

func (r *ggufReader) u32() (uint32, error) {
	var value uint32
	err := binary.Read(r.r, binary.LittleEndian, &value)
	return value, err
}

func (r *ggufReader) u64() (uint64, error) {
	var value uint64
	err := binary.Read(r.r, binary.LittleEndian, &value)
	return value, err
}

func (r *ggufReader) string() (string, error) {
	length, err := r.u64()
	if err != nil || length > maxStringSize {
		return "", io.ErrUnexpectedEOF
	}
	data := make([]byte, length)
	if _, err = io.ReadFull(r.r, data); err != nil {
		return "", err
	}
	return string(data), nil
}

func (r *ggufReader) value(valueType uint32, key string, depth int) (any, error) {
	if depth > 8 {
		return nil, io.ErrUnexpectedEOF
	}
	switch valueType {
	case 0:
		var value uint8
		return value, binary.Read(r.r, binary.LittleEndian, &value)
	case 1:
		var value int8
		return value, binary.Read(r.r, binary.LittleEndian, &value)
	case 2:
		var value uint16
		return value, binary.Read(r.r, binary.LittleEndian, &value)
	case 3:
		var value int16
		return value, binary.Read(r.r, binary.LittleEndian, &value)
	case 4:
		var value uint32
		return value, binary.Read(r.r, binary.LittleEndian, &value)
	case 5:
		var value int32
		return value, binary.Read(r.r, binary.LittleEndian, &value)
	case 6:
		var value float32
		return value, binary.Read(r.r, binary.LittleEndian, &value)
	case 7:
		var value uint8
		return value, binary.Read(r.r, binary.LittleEndian, &value)
	case 8:
		return r.string()
	case 9:
		elementType, err := r.u32()
		if err != nil {
			return nil, err
		}
		count, err := r.u64()
		if err != nil || count > maxArrayItems {
			return nil, io.ErrUnexpectedEOF
		}
		for i := uint64(0); i < count; i++ {
			if _, err = r.value(elementType, "", depth+1); err != nil {
				return nil, err
			}
		}
		if key == "tokenizer.ggml.tokens" {
			return count, nil
		}
		return nil, nil
	case 10:
		var value uint64
		return value, binary.Read(r.r, binary.LittleEndian, &value)
	case 11:
		var value int64
		return value, binary.Read(r.r, binary.LittleEndian, &value)
	case 12:
		var value float64
		return value, binary.Read(r.r, binary.LittleEndian, &value)
	default:
		return nil, io.ErrUnexpectedEOF
	}
}

func itoa(value uint64) string {
	const digits = "0123456789"
	if value == 0 {
		return "0"
	}
	var buffer [20]byte
	index := len(buffer)
	for value > 0 {
		index--
		buffer[index] = digits[value%10]
		value /= 10
	}
	return string(buffer[index:])
}
