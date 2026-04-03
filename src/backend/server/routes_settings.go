package server

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
)

type providerModelPrefs struct {
	AllowedModels []string `json:"allowedModels"`
	DefaultModel  string   `json:"defaultModel,omitempty"`
	Selections    []struct {
		ModelID   string `json:"modelId"`
		ModelType string `json:"modelType"`
	} `json:"selections,omitempty"`
}

func (s *Server) registerSettingsRoutes() {
	s.mux.HandleFunc("GET /v1/settings/provider-model-prefs", s.handleGetProviderModelPrefs)
	s.mux.HandleFunc("PUT /v1/settings/provider-model-prefs", s.handlePutProviderModelPrefs)
}

func (s *Server) providerModelPrefsFilePath() string {
	return s.dataPath("provider_model_prefs.json")
}

func (s *Server) loadProviderModelPrefs() (map[string]providerModelPrefs, error) {
	path := s.providerModelPrefsFilePath()
	if _, err := os.Stat(path); err != nil {
		if os.IsNotExist(err) {
			return map[string]providerModelPrefs{}, nil
		}
		return nil, err
	}

	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if len(b) == 0 {
		return map[string]providerModelPrefs{}, nil
	}

	var prefs map[string]providerModelPrefs
	if err := json.Unmarshal(b, &prefs); err != nil {
		return nil, err
	}
	if prefs == nil {
		prefs = map[string]providerModelPrefs{}
	}
	return prefs, nil
}

func (s *Server) saveProviderModelPrefs(prefs map[string]providerModelPrefs) error {
	path := s.providerModelPrefsFilePath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(prefs, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o600)
}

func (s *Server) handleGetProviderModelPrefs(w http.ResponseWriter, r *http.Request) {
	prefs, err := s.loadProviderModelPrefs()
	if err != nil {
		writeError(w, 500, "failed to load provider model prefs", "internal_error")
		return
	}
	writeJSON(w, map[string]any{"data": prefs})
}

func (s *Server) handlePutProviderModelPrefs(w http.ResponseWriter, r *http.Request) {
	// Accept either {"data": {...}} or a raw object map.
	var wrapper struct {
		Data map[string]providerModelPrefs `json:"data"`
	}
	if err := jsonDecode(r, &wrapper); err == nil && wrapper.Data != nil {
		if err := s.saveProviderModelPrefs(wrapper.Data); err != nil {
			writeError(w, 500, "failed to save provider model prefs", "internal_error")
			return
		}
		writeJSON(w, map[string]any{"ok": true})
		return
	}

	// Fallback: try decoding the raw map.
	var prefs map[string]providerModelPrefs
	if err := json.NewDecoder(r.Body).Decode(&prefs); err != nil {
		writeError(w, 400, "invalid JSON", "invalid_request")
		return
	}
	if prefs == nil {
		prefs = map[string]providerModelPrefs{}
	}
	if err := s.saveProviderModelPrefs(prefs); err != nil {
		writeError(w, 500, "failed to save provider model prefs", "internal_error")
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}
