package cmd

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"

	"github.com/GURSHARN219/aistclaw/internal/store"
)

type aiServerStudioProviderRecord struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	ProviderType string `json:"provider_type"`
	BaseURL      string `json:"base_url"`
	APIKey       string `json:"api_key"`
	Enabled      bool   `json:"enabled"`
}

type aiServerStudioProviderModelPrefs struct {
	DefaultModel string `json:"defaultModel"`
}

func importAIServerStudioConfigIfEnabled(providerStore store.ProviderStore, sysConfigs store.SystemConfigStore) {
	if providerStore == nil {
		return
	}

	flag := strings.TrimSpace(os.Getenv("AIST_IMPORT_ENGINE_CONFIG"))
	if flag == "" || (flag != "1" && strings.ToLower(flag) != "true") {
		return
	}

	dataDir := resolveAIServerStudioDataDir()
	if dataDir == "" {
		return
	}

	providersPath := filepath.Join(dataDir, "providers.json")
	b, err := os.ReadFile(providersPath)
	if err != nil {
		if !os.IsNotExist(err) {
			slog.Warn("embedded import: failed reading engine providers.json", "path", providersPath, "error", err)
		}
		return
	}
	if len(b) == 0 {
		return
	}

	var engineProviders []aiServerStudioProviderRecord
	if err := json.Unmarshal(b, &engineProviders); err != nil {
		slog.Warn("embedded import: failed parsing engine providers.json", "path", providersPath, "error", err)
		return
	}
	if len(engineProviders) == 0 {
		return
	}

	ctx := store.WithTenantID(context.Background(), store.MasterTenantID)
	usedNames := map[string]bool{}
	engineIDToName := map[string]string{}
	firstEnabled := ""
	firstEmbeddingCapable := ""

	seeded := 0
	for _, ep := range engineProviders {
		baseURL := strings.TrimSpace(ep.BaseURL)
		if baseURL == "" {
			continue
		}

		providerType := normalizeProviderType(ep.ProviderType, baseURL)
		name := uniqueSlug(slugify(ep.Name), usedNames)
		if name == "" {
			name = uniqueSlug(slugify(providerType), usedNames)
		}
		if name == "" {
			continue
		}

		displayName := strings.TrimSpace(ep.Name)
		if strings.EqualFold(displayName, name) {
			displayName = ""
		}

		p := store.LLMProviderData{
			Name:         name,
			DisplayName:  displayName,
			ProviderType: providerType,
			APIBase:      baseURL,
			APIKey:       strings.TrimSpace(ep.APIKey),
			Enabled:      ep.Enabled,
			Settings:     []byte("{}"),
		}

		if err := providerStore.CreateProvider(ctx, &p); err != nil {
			slog.Warn("embedded import: failed upserting provider into aistclaw store", "name", name, "type", providerType, "error", err)
			continue
		}
		seeded++
		usedNames[name] = true
		if ep.ID != "" {
			engineIDToName[ep.ID] = name
		}

		if firstEnabled == "" && p.Enabled {
			firstEnabled = name
		}
		if firstEmbeddingCapable == "" && p.Enabled && !store.NoEmbeddingTypes[p.ProviderType] {
			firstEmbeddingCapable = name
		}
	}

	if seeded == 0 {
		return
	}

	slog.Info("embedded import: seeded providers from engine", "count", seeded, "path", providersPath)

	// Repair / initialize system defaults so the UI doesn't crash on missing providers.
	if sysConfigs == nil {
		return
	}

	ensureSystemProvider := func(key string, fallbackName string) {
		if fallbackName == "" {
			return
		}
		cur, err := sysConfigs.Get(ctx, key)
		if err == nil && strings.TrimSpace(cur) != "" {
			cur = strings.TrimSpace(cur)
			if _, getErr := providerStore.GetProviderByName(ctx, cur); getErr == nil {
				return
			}
			slog.Warn("embedded import: system config provider missing; resetting", "key", key, "value", cur)
		}
		if err := sysConfigs.Set(ctx, key, fallbackName); err != nil {
			slog.Warn("embedded import: failed setting system config", "key", key, "error", err)
		}
	}

	ensureSystemProvider("agent.default_provider", firstEnabled)
	ensureSystemProvider("embedding.provider", firstEmbeddingCapable)

	// Seed default model from engine provider_model_prefs.json if available.
	if firstEnabled != "" {
		curModel, _ := sysConfigs.Get(ctx, "agent.default_model")
		if strings.TrimSpace(curModel) == "" {
			if model := readEngineDefaultModel(filepath.Join(dataDir, "provider_model_prefs.json"), engineProviders, engineIDToName, firstEnabled); model != "" {
				if err := sysConfigs.Set(ctx, "agent.default_model", model); err != nil {
					slog.Warn("embedded import: failed setting agent.default_model", "error", err)
				} else {
					slog.Info("embedded import: seeded agent.default_model from engine", "model", model)
				}
			}
		}
	}
}

func resolveAIServerStudioDataDir() string {
	if v := strings.TrimSpace(os.Getenv("AIST_ENGINE_DATA_DIR")); v != "" {
		return v
	}
	if v := strings.TrimSpace(os.Getenv("AI_SERVER_DATA_DIR")); v != "" {
		return v
	}

	// Heuristic: walk up from cwd looking for repo root marker (package.json + src/backend).
	wd, err := os.Getwd()
	if err != nil || strings.TrimSpace(wd) == "" {
		return ""
	}
	start, _ := filepath.Abs(wd)
	seen := map[string]struct{}{}
	for dir := start; dir != ""; {
		if _, ok := seen[dir]; ok {
			break
		}
		seen[dir] = struct{}{}

		if st, err := os.Stat(filepath.Join(dir, "package.json")); err == nil && !st.IsDir() {
			if sb, err2 := os.Stat(filepath.Join(dir, "src", "backend")); err2 == nil && sb.IsDir() {
				return filepath.Join(dir, "data")
			}
		}

		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}

	return ""
}

var nonSlug = regexp.MustCompile(`[^a-z0-9-_]+`)

func slugify(s string) string {
	trimmed := strings.ToLower(strings.TrimSpace(s))
	if trimmed == "" {
		return ""
	}
	trimmed = strings.ReplaceAll(trimmed, " ", "-")
	trimmed = nonSlug.ReplaceAllString(trimmed, "-")
	trimmed = strings.Trim(trimmed, "-")
	for strings.Contains(trimmed, "--") {
		trimmed = strings.ReplaceAll(trimmed, "--", "-")
	}
	return trimmed
}

func uniqueSlug(base string, used map[string]bool) string {
	base = strings.TrimSpace(base)
	if base == "" {
		return ""
	}
	if !used[base] {
		return base
	}
	for i := 2; i < 1000; i++ {
		cand := base + "-" + strconv.Itoa(i)
		if !used[cand] {
			return cand
		}
	}
	return ""
}

func normalizeProviderType(rawType string, baseURL string) string {
	t := strings.ToLower(strings.TrimSpace(rawType))
	if store.ValidProviderTypes[t] {
		return t
	}

	base := strings.ToLower(strings.TrimSpace(baseURL))
	switch {
	case strings.Contains(base, "openrouter.ai"):
		return store.ProviderOpenRouter
	case strings.Contains(base, "api.anthropic.com") || strings.Contains(base, "anthropic"):
		return store.ProviderAnthropicNative
	case strings.Contains(base, "generativelanguage.googleapis.com") || strings.Contains(base, "gemini"):
		return store.ProviderGeminiNative
	default:
		return store.ProviderOpenAICompat
	}
}

func readEngineDefaultModel(path string, engineProviders []aiServerStudioProviderRecord, engineIDToName map[string]string, firstEnabled string) string {
	b, err := os.ReadFile(path)
	if err != nil || len(b) == 0 {
		return ""
	}

	var prefs map[string]aiServerStudioProviderModelPrefs
	if json.Unmarshal(b, &prefs) != nil || len(prefs) == 0 {
		return ""
	}

	// Prefer the first enabled provider that matches firstEnabled by imported name.
	for _, ep := range engineProviders {
		if !ep.Enabled {
			continue
		}
		importedName := engineIDToName[ep.ID]
		if importedName == "" || importedName != firstEnabled {
			continue
		}
		if p, ok := prefs[ep.ID]; ok {
			return strings.TrimSpace(p.DefaultModel)
		}
		break
	}

	// Fallback: any defaultModel in prefs.
	for _, p := range prefs {
		if m := strings.TrimSpace(p.DefaultModel); m != "" {
			return m
		}
	}
	return ""
}
