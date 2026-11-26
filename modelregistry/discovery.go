package modelregistry

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// CommonLMStudioRoots returns known LM Studio model directories for the
// current platform. It only returns directories that already exist.
func CommonLMStudioRoots() []string {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	candidates := []string{
		filepath.Join(home, ".cache", "lm-studio", "models"),
		filepath.Join(home, ".lmstudio", "models"),
		filepath.Join(home, "Library", "Application Support", "LM Studio", "models"),
	}
	if local := os.Getenv("LOCALAPPDATA"); local != "" {
		candidates = append(candidates, filepath.Join(local, "LM Studio", "models"))
	}
	return existingCanonicalDirectories(candidates)
}

// DiscoverRoots combines explicitly configured roots with existing common LM
// Studio roots. Nonexistent roots are ignored, and no drive-wide search is
// ever performed.
func DiscoverRoots(configured []string) ([]string, error) {
	candidates := append([]string{}, configured...)
	candidates = append(candidates, CommonLMStudioRoots()...)
	result := make([]string, 0, len(candidates))
	seen := make(map[string]struct{})
	for _, candidate := range candidates {
		candidate = strings.TrimSpace(candidate)
		if candidate == "" {
			continue
		}
		canonical, err := canonicalPath(candidate)
		if err != nil {
			return nil, err
		}
		info, err := os.Stat(canonical)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if !info.IsDir() {
			continue
		}
		key := strings.ToLower(canonical)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, canonical)
	}
	sort.Strings(result)
	return result, nil
}

// Discover scans only the supplied roots (typically the result of
// DiscoverRoots) for regular .gguf files. Symlinked directories are not
// followed, bounding discovery to operator-selected roots.
func Discover(ctx context.Context, roots []string) ([]DiscoveredModel, error) {
	models := make([]DiscoveredModel, 0)
	for _, root := range roots {
		canonical, err := canonicalPath(root)
		if err != nil {
			return nil, err
		}
		info, err := os.Stat(canonical)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if !info.IsDir() {
			continue
		}
		err = filepath.WalkDir(canonical, func(path string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			select {
			case <-ctx.Done():
				return ctx.Err()
			default:
			}
			if entry.IsDir() && entry.Type()&os.ModeSymlink != 0 {
				return filepath.SkipDir
			}
			if entry.IsDir() || !strings.EqualFold(filepath.Ext(entry.Name()), ".gguf") {
				return nil
			}
			fileInfo, statErr := entry.Info()
			if statErr != nil || !fileInfo.Mode().IsRegular() {
				return nil
			}
			metadata, _ := ReadGGUFMetadata(path)
			models = append(models, DiscoveredModel{Path: path, Size: fileInfo.Size(), Metadata: metadata})
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	sort.Slice(models, func(i, j int) bool { return models[i].Path < models[j].Path })
	return models, nil
}

// DiscoverAndRegister performs bounded discovery and registers each result.
func (r *Registry) DiscoverAndRegister(ctx context.Context, configuredRoots []string, source string) ([]Model, error) {
	roots, err := DiscoverRoots(configuredRoots)
	if err != nil {
		return nil, err
	}
	discovered, err := Discover(ctx, roots)
	if err != nil {
		return nil, err
	}
	models := make([]Model, 0, len(discovered))
	for _, item := range discovered {
		model, registerErr := r.Register(ctx, RegisterRequest{Path: item.Path, Source: source})
		if registerErr != nil {
			return nil, registerErr
		}
		models = append(models, model)
	}
	return models, nil
}

func existingCanonicalDirectories(candidates []string) []string {
	result := make([]string, 0, len(candidates))
	seen := make(map[string]struct{})
	for _, candidate := range candidates {
		canonical, err := canonicalPath(candidate)
		if err != nil {
			continue
		}
		info, err := os.Stat(canonical)
		if err != nil || !info.IsDir() {
			continue
		}
		key := strings.ToLower(canonical)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, canonical)
	}
	sort.Strings(result)
	return result
}
