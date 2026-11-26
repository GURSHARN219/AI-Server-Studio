package engine

import (
	"bufio"
	"io"
	"os"
	"strings"
)

// readNativeLoadDiagnostic returns only the last concise llama.cpp load
// failure. Native llama.cpp writes the architecture/tokenizer reason to the
// engine log and its C API currently exposes only a nil model pointer.
func readNativeLoadDiagnostic(logPath string) string {
	return readNativeLoadDiagnosticAfter(logPath, 0)
}

func nativeLogOffset(logPath string) int64 {
	file, err := os.Open(logPath)
	if err != nil {
		return 0
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return 0
	}
	return info.Size()
}

func readNativeLoadDiagnosticAfter(logPath string, offset int64) string {
	if strings.TrimSpace(logPath) == "" {
		return ""
	}
	file, err := os.Open(logPath)
	if err != nil {
		return ""
	}
	defer file.Close()
	if offset > 0 {
		if _, err := file.Seek(offset, io.SeekStart); err != nil {
			return ""
		}
	}

	var diagnostic string
	bestRank := 0
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		lower := strings.ToLower(line)
		rank := 0
		switch {
		case strings.Contains(lower, "unknown pre-tokenizer type"):
			rank = 4
		case strings.Contains(lower, "error loading model:"):
			rank = 3
		case strings.Contains(lower, "failed to open gguf file"):
			rank = 2
		case strings.Contains(lower, "failed to load model"):
			rank = 1
		}
		if rank > bestRank || rank == bestRank && rank > 0 {
			diagnostic = line
			bestRank = rank
		}
	}
	return diagnostic
}
