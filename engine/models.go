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

	root, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return models
	}
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil || entry == nil {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return nil
		}
		if info.Mode().IsRegular() && strings.HasSuffix(strings.ToLower(info.Name()), ".gguf") {
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
