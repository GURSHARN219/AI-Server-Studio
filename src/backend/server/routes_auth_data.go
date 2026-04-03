package server

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"os"
)

type localUser struct {
	ID           string `json:"id"`
	Email        string `json:"email"`
	PasswordHash string `json:"password_hash"`
	DisplayName  string `json:"display_name"`
	CreatedAt    string `json:"created_at"`
}

type localProfile struct {
	UserID      string `json:"user_id"`
	DisplayName string `json:"display_name"`
	AvatarURL   string `json:"avatar_url"`
}

type localApiKey struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	KeyHash       string    `json:"key_hash"`
	KeyPrefix     string    `json:"key_prefix"`
	IsActive      bool      `json:"is_active"`
	RateLimitRPM  int       `json:"rate_limit_rpm"`
	AllowedModels []string  `json:"allowed_models"`
	LastUsedAt    *string   `json:"last_used_at"`
	ExpiresAt     *string   `json:"expires_at"`
	CreatedAt     string    `json:"created_at"`
}

type localUsageLog struct {
	ID          string `json:"id"`
	Model       string `json:"model"`
	Provider    string `json:"provider"`
	Endpoint    string `json:"endpoint"`
	StatusCode  int    `json:"status_code"`
	TokensInput int    `json:"tokens_input"`
	TokensOutput int   `json:"tokens_output"`
	LatencyMs   int    `json:"latency_ms"`
	ErrorMessage string `json:"error_message"`
	ApiKeyID    string `json:"api_key_id"`
	CreatedAt   string `json:"created_at"`
}

type localDocument struct {
	ID        string   `json:"id"`
	Title     string   `json:"title"`
	Content   string   `json:"content"`
	Tags      []string `json:"tags"`
	Source    string   `json:"source"`
	CreatedAt string   `json:"created_at"`
}

type localMcpServer struct {
	ID          string            `json:"id"`
	Name        string            `json:"name"`
	URL         string            `json:"url"`
	Status      string            `json:"status"`
	Headers     map[string]string `json:"headers"`
	Enabled     bool              `json:"enabled"`
	Description string            `json:"description"`
	CreatedAt   string            `json:"created_at"`
}

type authSession struct {
	Token     string `json:"token"`
	UserID    string `json:"user_id"`
	CreatedAt string `json:"created_at"`
	ExpiresAt string `json:"expires_at"`
}

var authMu sync.Mutex
var authSessions = map[string]authSession{}

func (s *Server) authSessionsPath() string {
	return s.dataPath("auth_sessions.json")
}

func (s *Server) loadAuthSessionsFromDisk() {
	var rows []authSession
	if err := loadJSON(s.authSessionsPath(), &rows); err != nil {
		return
	}

	now := time.Now().UTC()
	clean := make([]authSession, 0, len(rows))
	loaded := map[string]authSession{}
	for _, row := range rows {
		if strings.TrimSpace(row.Token) == "" || strings.TrimSpace(row.UserID) == "" {
			continue
		}
		exp, err := time.Parse(time.RFC3339, row.ExpiresAt)
		if err != nil {
			continue
		}
		if now.After(exp) {
			continue
		}
		loaded[row.Token] = row
		clean = append(clean, row)
	}

	authMu.Lock()
	authSessions = loaded
	authMu.Unlock()

	// Best-effort: prune expired sessions on disk.
	_ = saveJSON(s.authSessionsPath(), clean)
}

func (s *Server) persistAuthSessionsLocked() {
	rows := make([]authSession, 0, len(authSessions))
	for _, v := range authSessions {
		rows = append(rows, v)
	}
	_ = saveJSON(s.authSessionsPath(), rows)
}

func (s *Server) registerAuthDataRoutes() {
	s.mux.HandleFunc("POST /v1/auth/signup", s.handleAuthSignUp)
	s.mux.HandleFunc("POST /v1/auth/signin", s.handleAuthSignIn)
	s.mux.HandleFunc("POST /v1/auth/signout", s.handleAuthSignOut)
	s.mux.HandleFunc("POST /v1/auth/reset-password", s.handleAuthResetPassword)
	s.mux.HandleFunc("POST /v1/auth/update-password", s.handleAuthUpdatePassword)
	s.mux.HandleFunc("GET /v1/auth/session", s.handleAuthSession)

	s.mux.HandleFunc("GET /v1/profile", s.handleGetProfile)
	s.mux.HandleFunc("PATCH /v1/profile", s.handlePatchProfile)
	s.mux.HandleFunc("GET /v1/profile/stats", s.handleGetProfileStats)

	s.mux.HandleFunc("GET /v1/api-keys", s.handleListAPIKeys)
	s.mux.HandleFunc("POST /v1/api-keys", s.handleCreateAPIKey)
	s.mux.HandleFunc("PATCH /v1/api-keys/{id}", s.handlePatchAPIKey)
	s.mux.HandleFunc("DELETE /v1/api-keys/{id}", s.handleDeleteAPIKey)
	s.mux.HandleFunc("GET /v1/api-usage-logs", s.handleListUsageLogs)

	s.mux.HandleFunc("GET /v1/kb/documents", s.handleListDocuments)
	s.mux.HandleFunc("POST /v1/kb/documents", s.handleCreateDocument)

	s.mux.HandleFunc("GET /v1/mcp/servers", s.handleListMcpServers)
	s.mux.HandleFunc("POST /v1/mcp/servers", s.handleCreateMcpServer)
	s.mux.HandleFunc("PATCH /v1/mcp/servers/{id}", s.handlePatchMcpServer)
	s.mux.HandleFunc("DELETE /v1/mcp/servers/{id}", s.handleDeleteMcpServer)
	s.mux.HandleFunc("POST /v1/mcp/proxy", s.handleMcpProxy)
}

func (s *Server) dataPath(name string) string {
	dataDir := s.resolveDataDir()
	path := filepath.Join(dataDir, name)

	// Best-effort legacy migration: if data is still in src/backend/data, copy once.
	legacyPath := s.legacyDataPath(name)
	if legacyPath != "" {
		if _, err := os.Stat(path); os.IsNotExist(err) {
			if b, readErr := os.ReadFile(legacyPath); readErr == nil {
				_ = os.MkdirAll(filepath.Dir(path), 0o755)
				_ = os.WriteFile(path, b, 0o600)
			}
		}
	}

	return path
}

func (s *Server) resolveDataDir() string {
	if envDir := strings.TrimSpace(os.Getenv("AI_SERVER_DATA_DIR")); envDir != "" {
		return envDir
	}

	starts := []string{}
	if strings.TrimSpace(s.baseDir) != "" {
		starts = append(starts, s.baseDir)
	}
	if wd, err := os.Getwd(); err == nil && strings.TrimSpace(wd) != "" {
		starts = append(starts, wd)
	}

	seen := map[string]struct{}{}
	for _, start := range starts {
		dir, err := filepath.Abs(start)
		if err != nil {
			dir = start
		}
		for {
			if _, ok := seen[dir]; ok {
				break
			}
			seen[dir] = struct{}{}

			// Root workspace marker: package.json + src/backend
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
	}

	if strings.TrimSpace(s.baseDir) != "" {
		return filepath.Join(s.baseDir, "data")
	}
	return filepath.Join(".", "data")
}

func (s *Server) legacyDataPath(name string) string {
	dataDir := s.resolveDataDir()
	root := filepath.Dir(dataDir)
	legacy := filepath.Join(root, "src", "backend", "data", name)
	if _, err := os.Stat(legacy); err == nil {
		return legacy
	}
	return ""
}

func loadJSON[T any](path string, out *[]T) error {
	if _, err := os.Stat(path); err != nil {
		if os.IsNotExist(err) {
			*out = []T{}
			return nil
		}
		return err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	if len(b) == 0 {
		*out = []T{}
		return nil
	}
	if err := json.Unmarshal(b, out); err != nil {
		return err
	}
	return nil
}

func saveJSON[T any](path string, rows []T) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(rows, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o600)
}

func nowRFC3339() string { return time.Now().UTC().Format(time.RFC3339) }

func newID(prefix string) string { return fmt.Sprintf("%s-%d", prefix, time.Now().UnixNano()) }

func hashPassword(password string) string {
	h := sha256.Sum256([]byte(password))
	return hex.EncodeToString(h[:])
}

func authTokenFromRequest(r *http.Request) string {
	a := strings.TrimSpace(r.Header.Get("Authorization"))
	if strings.HasPrefix(strings.ToLower(a), "bearer ") {
		return strings.TrimSpace(a[7:])
	}
	return ""
}

func (s *Server) currentUserFromRequest(r *http.Request) (*localUser, error) {
	token := authTokenFromRequest(r)
	if token == "" {
		return nil, nil
	}
	authMu.Lock()
	sess, ok := authSessions[token]
	if ok {
		exp, err := time.Parse(time.RFC3339, sess.ExpiresAt)
		if err != nil || time.Now().UTC().After(exp) {
			delete(authSessions, token)
			s.persistAuthSessionsLocked()
			ok = false
		}
	}
	authMu.Unlock()
	if !ok {
		return nil, nil
	}
	var users []localUser
	if err := loadJSON(s.dataPath("users.json"), &users); err != nil {
		return nil, err
	}
	for i := range users {
		if users[i].ID == sess.UserID {
			return &users[i], nil
		}
	}
	return nil, nil
}

func (s *Server) makeSession(userID string) string {
	t := hashPassword(fmt.Sprintf("%s:%d", userID, time.Now().UnixNano()))
	now := time.Now().UTC()
	exp := now.Add(30 * 24 * time.Hour) // 30 days
	authMu.Lock()
	authSessions[t] = authSession{Token: t, UserID: userID, CreatedAt: now.Format(time.RFC3339), ExpiresAt: exp.Format(time.RFC3339)}
	s.persistAuthSessionsLocked()
	authMu.Unlock()
	return t
}

func (s *Server) handleAuthSignUp(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email       string `json:"email"`
		Password    string `json:"password"`
		DisplayName string `json:"display_name"`
	}
	if err := jsonDecode(r, &req); err != nil {
		writeError(w, 400, "invalid JSON", "invalid_request")
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if email == "" || len(req.Password) < 6 {
		writeError(w, 400, "email and password(min 6) are required", "invalid_request")
		return
	}
	var users []localUser
	if err := loadJSON(s.dataPath("users.json"), &users); err != nil {
		writeError(w, 500, "failed to load users", "internal_error")
		return
	}
	for _, u := range users {
		if strings.EqualFold(u.Email, email) {
			writeError(w, 409, "email already registered", "conflict")
			return
		}
	}
	u := localUser{ID: newID("user"), Email: email, PasswordHash: hashPassword(req.Password), DisplayName: strings.TrimSpace(req.DisplayName), CreatedAt: nowRFC3339()}
	users = append(users, u)
	if err := saveJSON(s.dataPath("users.json"), users); err != nil {
		writeError(w, 500, "failed to save user", "internal_error")
		return
	}
	token := s.makeSession(u.ID)
	writeJSON(w, map[string]any{"token": token, "user": map[string]any{"id": u.ID, "email": u.Email, "created_at": u.CreatedAt, "display_name": u.DisplayName}})
}

func (s *Server) handleAuthSignIn(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := jsonDecode(r, &req); err != nil {
		writeError(w, 400, "invalid JSON", "invalid_request")
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	passHash := hashPassword(req.Password)
	var users []localUser
	if err := loadJSON(s.dataPath("users.json"), &users); err != nil {
		writeError(w, 500, "failed to load users", "internal_error")
		return
	}
	for _, u := range users {
		if strings.EqualFold(u.Email, email) && u.PasswordHash == passHash {
			token := s.makeSession(u.ID)
			writeJSON(w, map[string]any{"token": token, "user": map[string]any{"id": u.ID, "email": u.Email, "created_at": u.CreatedAt, "display_name": u.DisplayName}})
			return
		}
	}
	writeError(w, 401, "invalid email or password", "unauthorized")
}

func (s *Server) handleAuthSignOut(w http.ResponseWriter, r *http.Request) {
	token := authTokenFromRequest(r)
	if token != "" {
		authMu.Lock()
		delete(authSessions, token)
		s.persistAuthSessionsLocked()
		authMu.Unlock()
	}
	writeJSON(w, map[string]any{"ok": true})
}

func (s *Server) handleAuthResetPassword(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, map[string]any{"ok": true, "message": "Local auth mode: reset email is not required; use Change Password in profile."})
}

func (s *Server) handleAuthUpdatePassword(w http.ResponseWriter, r *http.Request) {
	user, err := s.currentUserFromRequest(r)
	if err != nil {
		writeError(w, 500, "failed to load auth session", "internal_error")
		return
	}
	if user == nil {
		writeError(w, 401, "not authenticated", "unauthorized")
		return
	}
	var req struct{ Password string `json:"password"` }
	if err := jsonDecode(r, &req); err != nil || len(req.Password) < 6 {
		writeError(w, 400, "password(min 6) required", "invalid_request")
		return
	}
	var users []localUser
	if err := loadJSON(s.dataPath("users.json"), &users); err != nil {
		writeError(w, 500, "failed to load users", "internal_error")
		return
	}
	for i := range users {
		if users[i].ID == user.ID {
			users[i].PasswordHash = hashPassword(req.Password)
			break
		}
	}
	if err := saveJSON(s.dataPath("users.json"), users); err != nil {
		writeError(w, 500, "failed to save users", "internal_error")
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

func (s *Server) handleAuthSession(w http.ResponseWriter, r *http.Request) {
	user, err := s.currentUserFromRequest(r)
	if err != nil {
		writeError(w, 500, "failed to load auth session", "internal_error")
		return
	}
	if user == nil {
		writeJSON(w, map[string]any{"user": nil})
		return
	}
	writeJSON(w, map[string]any{"user": map[string]any{"id": user.ID, "email": user.Email, "created_at": user.CreatedAt, "display_name": user.DisplayName}})
}

func (s *Server) handleGetProfile(w http.ResponseWriter, r *http.Request) {
	user, err := s.currentUserFromRequest(r)
	if err != nil {
		writeError(w, 500, "failed to load session", "internal_error")
		return
	}
	if user == nil {
		writeError(w, 401, "not authenticated", "unauthorized")
		return
	}
	var rows []localProfile
	_ = loadJSON(s.dataPath("profiles.json"), &rows)
	for _, p := range rows {
		if p.UserID == user.ID {
			writeJSON(w, p)
			return
		}
	}
	writeJSON(w, localProfile{UserID: user.ID, DisplayName: user.DisplayName, AvatarURL: ""})
}

func (s *Server) handlePatchProfile(w http.ResponseWriter, r *http.Request) {
	user, err := s.currentUserFromRequest(r)
	if err != nil {
		writeError(w, 500, "failed to load session", "internal_error")
		return
	}
	if user == nil {
		writeError(w, 401, "not authenticated", "unauthorized")
		return
	}
	var req struct {
		DisplayName *string `json:"display_name"`
		AvatarURL   *string `json:"avatar_url"`
	}
	if err := jsonDecode(r, &req); err != nil {
		writeError(w, 400, "invalid JSON", "invalid_request")
		return
	}
	var rows []localProfile
	_ = loadJSON(s.dataPath("profiles.json"), &rows)
	found := false
	for i := range rows {
		if rows[i].UserID == user.ID {
			if req.DisplayName != nil {
				rows[i].DisplayName = strings.TrimSpace(*req.DisplayName)
			}
			if req.AvatarURL != nil {
				rows[i].AvatarURL = strings.TrimSpace(*req.AvatarURL)
			}
			found = true
			break
		}
	}
	if !found {
		p := localProfile{UserID: user.ID, DisplayName: user.DisplayName, AvatarURL: ""}
		if req.DisplayName != nil {
			p.DisplayName = strings.TrimSpace(*req.DisplayName)
		}
		if req.AvatarURL != nil {
			p.AvatarURL = strings.TrimSpace(*req.AvatarURL)
		}
		rows = append(rows, p)
	}
	if err := saveJSON(s.dataPath("profiles.json"), rows); err != nil {
		writeError(w, 500, "failed to save profile", "internal_error")
		return
	}
	s.handleGetProfile(w, r)
}

func (s *Server) handleGetProfileStats(w http.ResponseWriter, r *http.Request) {
	user, err := s.currentUserFromRequest(r)
	if err != nil {
		writeError(w, 500, "failed to load session", "internal_error")
		return
	}
	if user == nil {
		writeError(w, 401, "not authenticated", "unauthorized")
		return
	}
	var logs []localUsageLog
	_ = loadJSON(s.dataPath("api_usage_logs.json"), &logs)
	totalTokens := 0
	latencySum := 0
	models := map[string]bool{}
	for _, l := range logs {
		totalTokens += l.TokensInput + l.TokensOutput
		latencySum += l.LatencyMs
		if strings.TrimSpace(l.Model) != "" {
			models[l.Model] = true
		}
	}
	avgLatency := 0
	if len(logs) > 0 {
		avgLatency = latencySum / len(logs)
	}
	modelList := make([]string, 0, len(models))
	for m := range models {
		modelList = append(modelList, m)
	}
	var keys []localApiKey
	_ = loadJSON(s.dataPath("api_keys.json"), &keys)
	writeJSON(w, map[string]any{
		"totalRequests": len(logs),
		"totalTokens": totalTokens,
		"avgLatency": avgLatency,
		"modelsUsed": modelList,
		"apiKeyCount": len(keys),
	})
}

func (s *Server) handleListAPIKeys(w http.ResponseWriter, r *http.Request) {
	var keys []localApiKey
	if err := loadJSON(s.dataPath("api_keys.json"), &keys); err != nil {
		writeError(w, 500, "failed to load keys", "internal_error")
		return
	}
	slices.Reverse(keys)
	writeJSON(w, map[string]any{"data": keys})
}

func (s *Server) handleCreateAPIKey(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name         string `json:"name"`
		KeyHash      string `json:"key_hash"`
		KeyPrefix    string `json:"key_prefix"`
		RateLimitRPM int    `json:"rate_limit_rpm"`
	}
	if err := jsonDecode(r, &req); err != nil {
		writeError(w, 400, "invalid JSON", "invalid_request")
		return
	}
	if strings.TrimSpace(req.Name) == "" || strings.TrimSpace(req.KeyHash) == "" {
		writeError(w, 400, "name and key_hash are required", "invalid_request")
		return
	}
	var keys []localApiKey
	_ = loadJSON(s.dataPath("api_keys.json"), &keys)
	key := localApiKey{ID: newID("key"), Name: strings.TrimSpace(req.Name), KeyHash: req.KeyHash, KeyPrefix: req.KeyPrefix, IsActive: true, RateLimitRPM: req.RateLimitRPM, AllowedModels: []string{}, CreatedAt: nowRFC3339()}
	keys = append(keys, key)
	if err := saveJSON(s.dataPath("api_keys.json"), keys); err != nil {
		writeError(w, 500, "failed to save key", "internal_error")
		return
	}
	writeJSON(w, map[string]any{"data": key})
}

func (s *Server) handlePatchAPIKey(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req struct {
		IsActive *bool `json:"is_active"`
	}
	if err := jsonDecode(r, &req); err != nil {
		writeError(w, 400, "invalid JSON", "invalid_request")
		return
	}
	var keys []localApiKey
	_ = loadJSON(s.dataPath("api_keys.json"), &keys)
	updated := false
	for i := range keys {
		if keys[i].ID == id {
			if req.IsActive != nil {
				keys[i].IsActive = *req.IsActive
			}
			updated = true
			break
		}
	}
	if !updated {
		writeError(w, 404, "key not found", "not_found")
		return
	}
	if err := saveJSON(s.dataPath("api_keys.json"), keys); err != nil {
		writeError(w, 500, "failed to save key", "internal_error")
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

func (s *Server) handleDeleteAPIKey(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var keys []localApiKey
	_ = loadJSON(s.dataPath("api_keys.json"), &keys)
	next := keys[:0]
	deleted := false
	for _, k := range keys {
		if k.ID == id {
			deleted = true
			continue
		}
		next = append(next, k)
	}
	if !deleted {
		writeError(w, 404, "key not found", "not_found")
		return
	}
	if err := saveJSON(s.dataPath("api_keys.json"), next); err != nil {
		writeError(w, 500, "failed to save key", "internal_error")
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

func (s *Server) handleListUsageLogs(w http.ResponseWriter, r *http.Request) {
	var logs []localUsageLog
	_ = loadJSON(s.dataPath("api_usage_logs.json"), &logs)
	slices.Reverse(logs)
	writeJSON(w, map[string]any{"data": logs})
}

func (s *Server) handleListDocuments(w http.ResponseWriter, r *http.Request) {
	query := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("query")))
	var docs []localDocument
	_ = loadJSON(s.dataPath("documents.json"), &docs)
	slices.Reverse(docs)
	if query == "" {
		writeJSON(w, map[string]any{"data": docs})
		return
	}
	filtered := make([]localDocument, 0)
	for _, d := range docs {
		hay := strings.ToLower(d.Title + "\n" + d.Content + "\n" + strings.Join(d.Tags, " "))
		if strings.Contains(hay, query) {
			filtered = append(filtered, d)
		}
	}
	writeJSON(w, map[string]any{"data": filtered})
}

func (s *Server) handleCreateDocument(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Title   string   `json:"title"`
		Content string   `json:"content"`
		Tags    []string `json:"tags"`
		Source  string   `json:"source"`
	}
	if err := jsonDecode(r, &req); err != nil {
		writeError(w, 400, "invalid JSON", "invalid_request")
		return
	}
	if strings.TrimSpace(req.Content) == "" {
		writeError(w, 400, "content is required", "invalid_request")
		return
	}
	var docs []localDocument
	_ = loadJSON(s.dataPath("documents.json"), &docs)
	d := localDocument{ID: newID("doc"), Title: strings.TrimSpace(req.Title), Content: req.Content, Tags: req.Tags, Source: strings.TrimSpace(req.Source), CreatedAt: nowRFC3339()}
	if d.Title == "" {
		d.Title = "Untitled"
	}
	if d.Source == "" {
		d.Source = "ai-tool"
	}
	docs = append(docs, d)
	if err := saveJSON(s.dataPath("documents.json"), docs); err != nil {
		writeError(w, 500, "failed to save document", "internal_error")
		return
	}
	writeJSON(w, map[string]any{"data": d})
}

func (s *Server) handleListMcpServers(w http.ResponseWriter, r *http.Request) {
	var rows []localMcpServer
	_ = loadJSON(s.dataPath("mcp_servers.json"), &rows)
	writeJSON(w, map[string]any{"data": rows})
}

func (s *Server) handleCreateMcpServer(w http.ResponseWriter, r *http.Request) {
	var req localMcpServer
	if err := jsonDecode(r, &req); err != nil {
		writeError(w, 400, "invalid JSON", "invalid_request")
		return
	}
	if strings.TrimSpace(req.Name) == "" || strings.TrimSpace(req.URL) == "" {
		writeError(w, 400, "name and url are required", "invalid_request")
		return
	}
	var rows []localMcpServer
	_ = loadJSON(s.dataPath("mcp_servers.json"), &rows)
	req.ID = newID("mcp")
	req.Status = "disconnected"
	req.CreatedAt = nowRFC3339()
	if req.Headers == nil {
		req.Headers = map[string]string{}
	}
	rows = append(rows, req)
	if err := saveJSON(s.dataPath("mcp_servers.json"), rows); err != nil {
		writeError(w, 500, "failed to save mcp server", "internal_error")
		return
	}
	writeJSON(w, map[string]any{"data": req})
}

func (s *Server) handlePatchMcpServer(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var req map[string]any
	if err := jsonDecode(r, &req); err != nil {
		writeError(w, 400, "invalid JSON", "invalid_request")
		return
	}
	var rows []localMcpServer
	_ = loadJSON(s.dataPath("mcp_servers.json"), &rows)
	ok := false
	for i := range rows {
		if rows[i].ID != id {
			continue
		}
		if v, ok2 := req["name"].(string); ok2 {
			rows[i].Name = v
		}
		if v, ok2 := req["url"].(string); ok2 {
			rows[i].URL = v
		}
		if v, ok2 := req["status"].(string); ok2 {
			rows[i].Status = v
		}
		if v, ok2 := req["enabled"].(bool); ok2 {
			rows[i].Enabled = v
		}
		if v, ok2 := req["headers"].(map[string]any); ok2 {
			headers := map[string]string{}
			for k, hv := range v {
				headers[k] = fmt.Sprintf("%v", hv)
			}
			rows[i].Headers = headers
		}
		ok = true
		break
	}
	if !ok {
		writeError(w, 404, "mcp server not found", "not_found")
		return
	}
	if err := saveJSON(s.dataPath("mcp_servers.json"), rows); err != nil {
		writeError(w, 500, "failed to save mcp server", "internal_error")
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

func (s *Server) handleDeleteMcpServer(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	var rows []localMcpServer
	_ = loadJSON(s.dataPath("mcp_servers.json"), &rows)
	next := rows[:0]
	deleted := false
	for _, row := range rows {
		if row.ID == id {
			deleted = true
			continue
		}
		next = append(next, row)
	}
	if !deleted {
		writeError(w, 404, "mcp server not found", "not_found")
		return
	}
	if err := saveJSON(s.dataPath("mcp_servers.json"), next); err != nil {
		writeError(w, 500, "failed to save mcp server", "internal_error")
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

func (s *Server) handleMcpProxy(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ServerURL string            `json:"server_url"`
		Method    string            `json:"method"`
		Params    map[string]any    `json:"params"`
		Headers   map[string]string `json:"headers"`
	}
	if err := jsonDecode(r, &req); err != nil {
		writeError(w, 400, "invalid JSON", "invalid_request")
		return
	}
	if strings.TrimSpace(req.ServerURL) == "" || strings.TrimSpace(req.Method) == "" {
		writeError(w, 400, "server_url and method are required", "invalid_request")
		return
	}
	payload := map[string]any{
		"jsonrpc": "2.0",
		"id":      time.Now().UnixNano(),
		"method":  req.Method,
		"params":  req.Params,
	}
	b, _ := json.Marshal(payload)
	httpReq, err := http.NewRequest(http.MethodPost, req.ServerURL, bytes.NewReader(b))
	if err != nil {
		writeError(w, 500, "failed to create proxy request", "internal_error")
		return
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json, text/event-stream")
	for k, v := range req.Headers {
		httpReq.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		writeError(w, 502, "mcp proxy request failed: "+err.Error(), "upstream_error")
		return
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		writeError(w, 502, string(respBody), "upstream_error")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(respBody)
}
