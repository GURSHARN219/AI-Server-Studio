package engine

import (
	"os"
	"path/filepath"
	"strings"
)

// scanModelsDir walks a directory and returns all .gguf files found.
func scanModelsDir(dir string) []ModelInfo {
	var models []ModelInfo
	if dir == "" {
		return models
	}

	filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if !info.IsDir() && strings.HasSuffix(strings.ToLower(info.Name()), ".gguf") {
			models = append(models, ModelInfo{
				ID:   strings.TrimSuffix(info.Name(), ".gguf"),
				Path: path,
				Size: info.Size(),
			})
		}
		return nil
	})

	return models
}
