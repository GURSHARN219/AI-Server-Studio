package server

import (
	"ai-server-studio-backend/security"
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
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
	s.mux.HandleFunc("GET /v1/settings/user", func(w http.ResponseWriter, r *http.Request) { s.handleGetAccountState(w, r, "settings") })
	s.mux.HandleFunc("PUT /v1/settings/user", func(w http.ResponseWriter, r *http.Request) { s.handlePutAccountState(w, r, "settings") })
	s.mux.HandleFunc("GET /v1/conversations/state", func(w http.ResponseWriter, r *http.Request) { s.handleGetAccountState(w, r, "conversations") })
	s.mux.HandleFunc("PUT /v1/conversations/state", func(w http.ResponseWriter, r *http.Request) { s.handlePutAccountState(w, r, "conversations") })
	s.mux.HandleFunc("POST /v1/conversations/import", s.handleImportConversations)
}
func (s *Server) handleGetAccountState(w http.ResponseWriter, r *http.Request, kind string) {
	owner := s.requireOwner(w, r)
	if owner == "" {
		return
	}
	data := map[string]any{}
	_, err := s.getResource(owner, kind, "state", &data)
	if err != nil && err != sql.ErrNoRows {
		resourceError(w, err)
		return
	}
	writeJSON(w, map[string]any{"data": data})
}
func (s *Server) handlePutAccountState(w http.ResponseWriter, r *http.Request, kind string) {
	owner := s.requireOwner(w, r)
	if owner == "" {
		return
	}
	var req struct {
		Data map[string]any `json:"data"`
	}
	if decodeSecurityJSON(r, &req) != nil || req.Data == nil {
		writeError(w, 400, "data object required", "invalid_request")
		return
	}
	if err := s.putResource(owner, kind, "state", req.Data, nil); err != nil {
		resourceError(w, err)
		return
	}
	writeJSON(w, map[string]any{"data": req.Data, "ok": true})
}
func (s *Server) handleGetProviderModelPrefs(w http.ResponseWriter, r *http.Request) {
	s.handleGetAccountState(w, r, "provider-prefs")
}
func (s *Server) handlePutProviderModelPrefs(w http.ResponseWriter, r *http.Request) {
	owner := s.requireOwner(w, r)
	if owner == "" {
		return
	}
	var raw map[string]json.RawMessage
	if decodeSecurityJSON(r, &raw) != nil || raw == nil {
		writeError(w, 400, "prefs object required", "invalid_request")
		return
	}
	b, _ := json.Marshal(raw)
	if data, ok := raw["data"]; ok {
		b = data
	}
	var prefs map[string]providerModelPrefs
	if json.Unmarshal(b, &prefs) != nil || prefs == nil {
		writeError(w, 400, "invalid provider preferences", "invalid_request")
		return
	}
	for id := range prefs {
		if id == "local" {
			continue
		}
		var p providerRecord
		if _, err := s.getResource(owner, "provider", id, &p); err != nil {
			writeError(w, 400, "owned provider required", "invalid_request")
			return
		}
	}
	if err := s.putResource(owner, "provider-prefs", "state", prefs, nil); err != nil {
		resourceError(w, err)
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

// JSON state is account-scoped and transactional; normalized conversation/message
// tables are deliberately deferred until the frontend state contract is stable.
func (s *Server) handleImportConversations(w http.ResponseWriter, r *http.Request) {
	owner := s.requireOwner(w, r)
	if owner == "" {
		return
	}
	var req struct {
		Data     map[string]any `json:"data"`
		SourceID string         `json:"source_id"`
	}
	if decodeSecurityJSON(r, &req) != nil || req.Data == nil || strings.TrimSpace(req.SourceID) == "" || len(req.SourceID) > 200 {
		writeError(w, 400, "data object and source_id required", "invalid_request")
		return
	}
	b, _ := json.Marshal(req.Data)
	digest := security.TokenHash(string(b))
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		resourceError(w, err)
		return
	}
	defer tx.Rollback()
	var existing string
	err = tx.QueryRow(`SELECT digest FROM security_imports WHERE owner_id=? AND source_id=?`, owner, req.SourceID).Scan(&existing)
	if err == nil {
		if existing != digest {
			writeError(w, 409, "source already imported with different data", "conflict")
			return
		}
		writeJSON(w, map[string]any{"ok": true, "imported": false})
		return
	}
	if err != sql.ErrNoRows {
		resourceError(w, err)
		return
	}
	// An import cannot silently overwrite an established account conversation state.
	var count int
	if err = tx.QueryRow(`SELECT count(*) FROM security_resources WHERE owner_id=? AND kind='conversations' AND id='state'`, owner).Scan(&count); err != nil {
		resourceError(w, err)
		return
	}
	if count > 0 {
		writeError(w, 409, "account already has conversation state", "conflict")
		return
	}
	if err = putResource(r.Context(), tx, owner, "conversations", "state", req.Data, nil); err == nil {
		_, err = tx.Exec(`INSERT INTO security_imports(owner_id,source_id,digest,created_at) VALUES(?,?,?,?)`, owner, req.SourceID, digest, nowRFC3339())
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		resourceError(w, err)
		return
	}
	writeJSON(w, map[string]any{"ok": true, "imported": true, "data": req.Data})
}
