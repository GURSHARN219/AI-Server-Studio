package engine

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var modelIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)

// resolveModelFile accepts managed relative files below the configured model
// root and explicit absolute user-selected files elsewhere. EvalSymlinks also
// makes the managed-root check useful for symlinked ancestors and Windows
// reparse points where the platform exposes them through that API.
func resolveModelFile(root, requested string) (string, error) {
	return resolveModelPath(root, requested, false)
}

func resolveModelPath(root, requested string, allowDirectory bool) (string, error) {
	if strings.TrimSpace(requested) == "" {
		return "", fmt.Errorf("model path is empty")
	}
	external := filepath.IsAbs(requested)
	var rootAbs, rootReal string
	var err error
	if !external {
		if strings.TrimSpace(root) == "" {
			return "", fmt.Errorf("model root is not configured")
		}
		rootAbs, err = filepath.Abs(root)
		if err != nil {
			return "", fmt.Errorf("invalid model root: %w", err)
		}
		rootReal, err = filepath.EvalSymlinks(rootAbs)
		if err != nil {
			return "", fmt.Errorf("model root unavailable: %w", err)
		}
		rootInfo, statErr := os.Stat(rootReal)
		if statErr != nil || !rootInfo.IsDir() {
			return "", fmt.Errorf("model root is not a directory")
		}
	}
	candidate := requested
	if external {
		candidate, err = filepath.Abs(requested)
		if err != nil {
			return "", fmt.Errorf("invalid model path: %w", err)
		}
	} else {
		candidate = filepath.Join(rootAbs, requested)
	}
	candidate, err = filepath.Abs(candidate)
	if err != nil {
		return "", fmt.Errorf("invalid model path: %w", err)
	}
	candidateAbs := candidate
	info, err := os.Lstat(candidateAbs)
	if err != nil {
		return "", fmt.Errorf("model file not found: %s", requested)
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return "", fmt.Errorf("model path must not be a symlink")
	}
	realPath, err := filepath.EvalSymlinks(candidateAbs)
	if err != nil {
		return "", fmt.Errorf("model path cannot be resolved: %w", err)
	}
	if !external {
		rel, relErr := filepath.Rel(rootReal, realPath)
		if relErr != nil {
			return "", fmt.Errorf("model path containment check failed: %w", relErr)
		}
		if rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
			return "", fmt.Errorf("model path escapes configured model root")
		}
	}
	info, err = os.Stat(realPath)
	if err != nil || (!info.Mode().IsRegular() && !(allowDirectory && info.IsDir())) {
		return "", fmt.Errorf("model path must be a regular file")
	}
	if info.Mode().IsRegular() && !strings.EqualFold(filepath.Ext(realPath), ".gguf") {
		return "", fmt.Errorf("model file must have a .gguf extension")
	}
	return realPath, nil
}

func looksLikeLocalModelPath(root, requested string) bool {
	if filepath.IsAbs(requested) || strings.HasPrefix(requested, ".") || strings.Contains(requested, `\`) || strings.EqualFold(filepath.Ext(requested), ".gguf") {
		return true
	}
	if root == "" || modelIDPattern.MatchString(requested) {
		return false
	}
	_, err := os.Lstat(filepath.Join(root, requested))
	return err == nil
}

func validateModelID(id string) error {
	if !modelIDPattern.MatchString(id) {
		return fmt.Errorf("invalid vLLM model ID: use a namespace/name identifier")
	}
	return nil
}
