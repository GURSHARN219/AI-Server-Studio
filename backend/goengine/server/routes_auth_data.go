package server

import (
	"ai-server-studio-backend/persistence"
	"ai-server-studio-backend/security"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/mail"
	"path/filepath"
	"strings"
	"time"
)

type localUser struct {
	ID           string `json:"id"`
	Email        string `json:"email"`
	PasswordHash string `json:"-"`
	DisplayName  string `json:"display_name"`
	CreatedAt    string `json:"created_at"`
}
type localProfile struct {
	UserID      string `json:"user_id"`
	DisplayName string `json:"display_name"`
	AvatarURL   string `json:"avatar_url"`
}
type localApiKey struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	KeyPrefix     string   `json:"key_prefix"`
	IsActive      bool     `json:"is_active"`
	RateLimitRPM  int      `json:"rate_limit_rpm"`
	AllowedModels []string `json:"allowed_models"`
	Permissions   []string `json:"permissions"`
	LastUsedAt    *string  `json:"last_used_at"`
	ExpiresAt     *string  `json:"expires_at"`
	CreatedAt     string   `json:"created_at"`
}
type localUsageLog struct {
	ID           string `json:"id"`
	Model        string `json:"model"`
	Provider     string `json:"provider"`
	Endpoint     string `json:"endpoint"`
	StatusCode   int    `json:"status_code"`
	TokensInput  int    `json:"tokens_input"`
	TokensOutput int    `json:"tokens_output"`
	LatencyMs    int    `json:"latency_ms"`
	ErrorMessage string `json:"error_message"`
	ApiKeyID     string `json:"api_key_id"`
	CreatedAt    string `json:"created_at"`
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
	HasHeaders  bool              `json:"has_headers"`
	Enabled     bool              `json:"enabled"`
	Description string            `json:"description"`
	CreatedAt   string            `json:"created_at"`
}

func (s *Server) registerAuthDataRoutes() {
	s.mux.HandleFunc("POST /v1/auth/signup", s.handleAuthSignUp)
	s.mux.HandleFunc("POST /v1/auth/signin", s.handleAuthSignIn)
	s.mux.HandleFunc("POST /v1/auth/import-legacy", s.handleAuthImportLegacy)
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
	s.mux.HandleFunc("PATCH /v1/kb/documents/{id}", s.handlePatchDocument)
	s.mux.HandleFunc("DELETE /v1/kb/documents/{id}", s.handleDeleteDocument)
	s.mux.HandleFunc("GET /v1/mcp/servers", s.handleListMcpServers)
	s.mux.HandleFunc("POST /v1/mcp/servers", s.handleCreateMcpServer)
	s.mux.HandleFunc("PATCH /v1/mcp/servers/{id}", s.handlePatchMcpServer)
	s.mux.HandleFunc("DELETE /v1/mcp/servers/{id}", s.handleDeleteMcpServer)
	s.mux.HandleFunc("POST /v1/mcp/proxy", s.handleMcpProxy)
}
func (s *Server) dataPath(name string) string { return filepath.Join(s.resolveDataDir(), name) }
func (s *Server) resolveDataDir() string {
	dir, err := persistence.DataDir()
	if err != nil {
		return ""
	}
	return dir
}

// Retained for construction compatibility. Sessions are never read from JSON.
func (s *Server) loadAuthSessionsFromDisk() {}
func nowRFC3339() string                    { return time.Now().UTC().Format(time.RFC3339) }
func newID(prefix string) string {
	token, err := security.Token()
	if err != nil {
		panic(err)
	}
	return prefix + "-" + token
}
func hashPassword(password string) (string, error) { return security.HashPassword(password) }
func newSessionToken() (string, error)             { return security.Token() }
func authTokenFromRequest(r *http.Request) string {
	a := strings.TrimSpace(r.Header.Get("Authorization"))
	if strings.HasPrefix(strings.ToLower(a), "bearer ") {
		return strings.TrimSpace(a[7:])
	}
	return ""
}
func (s *Server) currentUserFromRequest(r *http.Request) (*localUser, error) {
	p := principalFromRequest(r)
	if p == nil {
		var err error
		p, err = s.resolvePrincipal(r, false)
		if err != nil {
			return nil, err
		}
	}
	if p == nil {
		return nil, nil
	}
	var u localUser
	err := s.db.QueryRow(`SELECT id,email,password_hash,display_name,created_at FROM users WHERE id=?`, p.OwnerID).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.DisplayName, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &u, err
}
func (s *Server) makeSession(userID string) (string, error) {
	token, err := newSessionToken()
	if err != nil {
		return "", err
	}
	now := time.Now()
	_, err = s.db.Exec(`INSERT INTO security_sessions(token_hash,owner_id,created_at,expires_at) VALUES(?,?,?,?)`, security.TokenHash(token), userID, now.Unix(), now.Add(30*24*time.Hour).Unix())
	return token, err
}
func validPassword(p string) bool { return len(p) >= 8 && len(p) <= 1024 }
func decodeSecurityJSON(r *http.Request, v any) error {
	b, err := io.ReadAll(io.LimitReader(r.Body, 4<<20+1))
	if err != nil || len(b) > 4<<20 {
		return fmt.Errorf("request body too large")
	}
	dec := json.NewDecoder(strings.NewReader(string(b)))
	if err := dec.Decode(v); err != nil {
		return err
	}
	var extra any
	if err := dec.Decode(&extra); err == io.EOF {
		return nil
	}
	return fmt.Errorf("one JSON value required")
}
func (s *Server) handleAuthSignUp(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email       string `json:"email"`
		Password    string `json:"password"`
		DisplayName string `json:"display_name"`
	}
	if decodeSecurityJSON(r, &req) != nil {
		writeError(w, 400, "invalid JSON", "invalid_request")
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if s.authThrottled(w, r, email) {
		return
	}
	parsed, err := mail.ParseAddress(email)
	if err != nil || parsed.Address != email || len(email) > 254 || !validPassword(req.Password) || len(req.DisplayName) > 200 {
		writeError(w, 400, "valid email and password (8-1024 characters) required", "invalid_request")
		return
	}
	hash, err := hashPassword(req.Password)
	if err != nil {
		resourceError(w, err)
		return
	}
	u := localUser{ID: newID("user"), Email: email, PasswordHash: hash, DisplayName: strings.TrimSpace(req.DisplayName), CreatedAt: nowRFC3339()}
	_, err = s.db.Exec(`INSERT INTO users(id,email,password_hash,display_name,created_at) VALUES(?,?,?,?,?)`, u.ID, u.Email, u.PasswordHash, u.DisplayName, u.CreatedAt)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			writeError(w, 409, "email already registered", "conflict")
		} else {
			resourceError(w, err)
		}
		return
	}
	token, err := s.makeSession(u.ID)
	if err != nil {
		resourceError(w, err)
		return
	}
	writeJSON(w, map[string]any{"token": token, "user": u})
}
func (s *Server) handleAuthSignIn(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if decodeSecurityJSON(r, &req) != nil || len(req.Password) > 1024 {
		writeError(w, 400, "invalid credentials input", "invalid_request")
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if s.authThrottled(w, r, email) {
		return
	}
	var u localUser
	err := s.db.QueryRow(`SELECT id,email,password_hash,display_name,created_at FROM users WHERE email=?`, email).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.DisplayName, &u.CreatedAt)
	if err != nil && err != sql.ErrNoRows {
		resourceError(w, err)
		return
	}
	valid, upgrade := security.VerifyPassword(u.PasswordHash, req.Password)
	if !valid {
		writeError(w, 401, "invalid email or password", "unauthorized")
		return
	}
	if upgrade {
		hash, err := hashPassword(req.Password)
		if err != nil {
			resourceError(w, err)
			return
		}
		if _, err = s.db.Exec(`UPDATE users SET password_hash=? WHERE id=? AND password_hash=?`, hash, u.ID, u.PasswordHash); err != nil {
			resourceError(w, err)
			return
		}
	}
	token, err := s.makeSession(u.ID)
	if err != nil {
		resourceError(w, err)
		return
	}
	writeJSON(w, map[string]any{"token": token, "user": u})
}
func (s *Server) handleAuthSignOut(w http.ResponseWriter, r *http.Request) {
	_, err := s.db.Exec(`UPDATE security_sessions SET revoked=1 WHERE token_hash=?`, security.TokenHash(authTokenFromRequest(r)))
	if err != nil {
		resourceError(w, err)
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

func (s *Server) handleAuthImportLegacy(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Directory string `json:"directory"`
		Email     string `json:"email"`
		Password  string `json:"password"`
	}
	if decodeSecurityJSON(r, &req) != nil || !filepath.IsAbs(req.Directory) || req.Email == "" || req.Password == "" || len(req.Password) > 1024 {
		writeError(w, 400, "explicit absolute directory and legacy credentials required", "invalid_request")
		return
	}
	if s.authThrottled(w, r, req.Email) {
		return
	}
	report, err := s.ImportLegacyAccount(r.Context(), req.Directory, req.Email, req.Password)
	if err != nil {
		writeError(w, 400, "legacy migration could not verify and import account; original files retained", "migration_failed")
		return
	}
	token, err := s.makeSession(report.OwnerID)
	if err != nil {
		resourceError(w, err)
		return
	}
	u, err := s.currentUserFromRequest(r.WithContext(context.WithValue(r.Context(), principalContextKey{}, &principal{OwnerID: report.OwnerID})))
	if err != nil {
		resourceError(w, err)
		return
	}
	writeJSON(w, map[string]any{"token": token, "user": u, "migration": report})
}
func (s *Server) handleAuthResetPassword(w http.ResponseWriter, r *http.Request) {
	writeError(w, 501, "use authenticated password change", "unsupported")
}
func (s *Server) handleAuthUpdatePassword(w http.ResponseWriter, r *http.Request) {
	u, err := s.currentUserFromRequest(r)
	if err != nil {
		resourceError(w, err)
		return
	}
	if u == nil {
		writeError(w, 401, "not authenticated", "unauthorized")
		return
	}
	var req struct {
		Password        string `json:"password"`
		CurrentPassword string `json:"current_password"`
	}
	if decodeSecurityJSON(r, &req) != nil || !validPassword(req.Password) {
		writeError(w, 400, "password (8-1024 characters) required", "invalid_request")
		return
	}
	if s.authThrottled(w, r, u.Email) {
		return
	}
	valid, _ := security.VerifyPassword(u.PasswordHash, req.CurrentPassword)
	if !valid {
		writeError(w, 401, "current password required", "unauthorized")
		return
	}
	hash, err := hashPassword(req.Password)
	if err != nil {
		resourceError(w, err)
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		resourceError(w, err)
		return
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`UPDATE users SET password_hash=? WHERE id=?`, hash, u.ID); err == nil {
		_, err = tx.Exec(`UPDATE security_sessions SET revoked=1 WHERE owner_id=?`, u.ID)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		resourceError(w, err)
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}
func (s *Server) handleAuthSession(w http.ResponseWriter, r *http.Request) {
	u, err := s.currentUserFromRequest(r)
	if err != nil {
		resourceError(w, err)
		return
	}
	writeJSON(w, map[string]any{"user": u})
}
func (s *Server) handleGetProfile(w http.ResponseWriter, r *http.Request) {
	owner := s.requireOwner(w, r)
	if owner == "" {
		return
	}
	var p localProfile
	_, err := s.getResource(owner, "profile", "profile", &p)
	if err == sql.ErrNoRows {
		u, e := s.currentUserFromRequest(r)
		if e != nil || u == nil {
			resourceError(w, sql.ErrNoRows)
			return
		}
		p = localProfile{UserID: owner, DisplayName: u.DisplayName}
	} else if err != nil {
		resourceError(w, err)
		return
	}
	writeJSON(w, p)
}
func (s *Server) handlePatchProfile(w http.ResponseWriter, r *http.Request) {
	owner := s.requireOwner(w, r)
	if owner == "" {
		return
	}
	var req struct {
		DisplayName *string `json:"display_name"`
		AvatarURL   *string `json:"avatar_url"`
	}
	if decodeSecurityJSON(r, &req) != nil {
		writeError(w, 400, "invalid JSON", "invalid_request")
		return
	}
	u, e := s.currentUserFromRequest(r)
	if e != nil || u == nil {
		resourceError(w, sql.ErrNoRows)
		return
	}
	p := localProfile{UserID: owner, DisplayName: u.DisplayName}
	if _, err := s.getResource(owner, "profile", "profile", &p); err != nil && err != sql.ErrNoRows {
		resourceError(w, err)
		return
	}
	if req.DisplayName != nil {
		p.DisplayName = strings.TrimSpace(*req.DisplayName)
	}
	if req.AvatarURL != nil {
		p.AvatarURL = strings.TrimSpace(*req.AvatarURL)
	}
	if len(p.DisplayName) > 200 || len(p.AvatarURL) > 2048 {
		writeError(w, 400, "profile field too long", "invalid_request")
		return
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		resourceError(w, err)
		return
	}
	defer tx.Rollback()
	if err = putResource(r.Context(), tx, owner, "profile", "profile", p, nil); err == nil {
		_, err = tx.Exec(`UPDATE users SET display_name=? WHERE id=?`, p.DisplayName, owner)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		resourceError(w, err)
		return
	}
	writeJSON(w, p)
}
func (s *Server) handleGetProfileStats(w http.ResponseWriter, r *http.Request) {
	owner := s.requireOwner(w, r)
	if owner == "" {
		return
	}
	logs, err := resourceList[localUsageLog](s, owner, "usage")
	if err != nil {
		resourceError(w, err)
		return
	}
	keys, err := s.listAPIKeys(owner)
	if err != nil {
		resourceError(w, err)
		return
	}
	tokens, latency := 0, 0
	models := []string{}
	for _, l := range logs {
		tokens += l.TokensInput + l.TokensOutput
		latency += l.LatencyMs
		if l.Model != "" && !containsString(models, l.Model) {
			models = append(models, l.Model)
		}
	}
	if len(logs) > 0 {
		latency /= len(logs)
	}
	writeJSON(w, map[string]any{"totalRequests": len(logs), "totalTokens": tokens, "avgLatency": latency, "modelsUsed": models, "apiKeyCount": len(keys)})
}
func (s *Server) listAPIKeys(owner string) ([]localApiKey, error) {
	out := []localApiKey{}
	rows, err := s.db.Query(`SELECT payload,active FROM security_api_keys WHERE owner_id=? ORDER BY id DESC`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var b string
		var active bool
		var key localApiKey
		if err = rows.Scan(&b, &active); err != nil {
			return nil, err
		}
		if err = json.Unmarshal([]byte(b), &key); err != nil {
			return nil, err
		}
		key.IsActive = active
		out = append(out, key)
	}
	return out, rows.Err()
}
func (s *Server) handleListAPIKeys(w http.ResponseWriter, r *http.Request) {
	owner := s.requireOwner(w, r)
	if owner == "" {
		return
	}
	keys, err := s.listAPIKeys(owner)
	if err != nil {
		resourceError(w, err)
		return
	}
	writeJSON(w, map[string]any{"data": keys})
}
func (s *Server) handleCreateAPIKey(w http.ResponseWriter, r *http.Request) {
	owner := s.requireOwner(w, r)
	if owner == "" {
		return
	}
	var req struct {
		Name          string   `json:"name"`
		RateLimitRPM  int      `json:"rate_limit_rpm"`
		AllowedModels []string `json:"allowed_models"`
		Permissions   []string `json:"permissions"`
		ExpiresAt     *string  `json:"expires_at"`
	}
	if decodeSecurityJSON(r, &req) != nil || strings.TrimSpace(req.Name) == "" || len(req.Name) > 200 {
		writeError(w, 400, "key name required", "invalid_request")
		return
	}
	if req.RateLimitRPM == 0 {
		req.RateLimitRPM = 60
	}
	if req.RateLimitRPM < 1 || req.RateLimitRPM > 10000 || len(req.AllowedModels) > 100 {
		writeError(w, 400, "invalid key limits", "invalid_request")
		return
	}
	if len(req.Permissions) == 0 {
		req.Permissions = []string{"chat", "models"}
	}
	for _, p := range req.Permissions {
		if p != "chat" && p != "models" {
			writeError(w, 400, "only chat/models permissions supported", "invalid_request")
			return
		}
	}
	var expiry any
	if req.ExpiresAt != nil {
		t, err := time.Parse(time.RFC3339, *req.ExpiresAt)
		if err != nil || !t.After(time.Now()) {
			writeError(w, 400, "expiry must be in future", "invalid_request")
			return
		}
		expiry = t.Unix()
	}
	raw, err := security.Token()
	if err != nil {
		resourceError(w, err)
		return
	}
	raw = "ais_" + raw
	key := localApiKey{ID: newID("key"), Name: strings.TrimSpace(req.Name), KeyPrefix: raw[:12], IsActive: true, RateLimitRPM: req.RateLimitRPM, AllowedModels: req.AllowedModels, Permissions: req.Permissions, ExpiresAt: req.ExpiresAt, CreatedAt: nowRFC3339()}
	if key.AllowedModels == nil {
		key.AllowedModels = []string{}
	}
	b, _ := json.Marshal(key)
	_, err = s.db.Exec(`INSERT INTO security_api_keys(id,owner_id,token_hash,payload,expires_at) VALUES(?,?,?,?,?)`, key.ID, owner, security.TokenHash(raw), string(b), expiry)
	if err != nil {
		resourceError(w, err)
		return
	}
	writeJSON(w, map[string]any{"data": key, "raw_key": raw})
}
func (s *Server) handlePatchAPIKey(w http.ResponseWriter, r *http.Request) {
	owner := s.requireOwner(w, r)
	if owner == "" {
		return
	}
	var req struct {
		IsActive *bool `json:"is_active"`
	}
	if decodeSecurityJSON(r, &req) != nil || req.IsActive == nil {
		writeError(w, 400, "is_active required", "invalid_request")
		return
	}
	res, err := s.db.Exec(`UPDATE security_api_keys SET active=? WHERE owner_id=? AND id=?`, *req.IsActive, owner, r.PathValue("id"))
	if err != nil {
		resourceError(w, err)
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		resourceError(w, sql.ErrNoRows)
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}
func (s *Server) handleDeleteAPIKey(w http.ResponseWriter, r *http.Request) {
	owner := s.requireOwner(w, r)
	if owner == "" {
		return
	}
	res, err := s.db.Exec(`DELETE FROM security_api_keys WHERE owner_id=? AND id=?`, owner, r.PathValue("id"))
	if err != nil {
		resourceError(w, err)
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		resourceError(w, sql.ErrNoRows)
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}
func (s *Server) handleListUsageLogs(w http.ResponseWriter, r *http.Request) {
	owner := s.requireOwner(w, r)
	if owner == "" {
		return
	}
	rows, err := resourceList[localUsageLog](s, owner, "usage")
	if err != nil {
		resourceError(w, err)
		return
	}
	writeJSON(w, map[string]any{"data": rows})
}
func (s *Server) handleListDocuments(w http.ResponseWriter, r *http.Request) {
	owner := s.requireOwner(w, r)
	if owner == "" {
		return
	}
	rows, err := resourceList[localDocument](s, owner, "document")
	if err != nil {
		resourceError(w, err)
		return
	}
	query := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("query")))
	filtered := []localDocument{}
	for _, d := range rows {
		if query == "" || strings.Contains(strings.ToLower(d.Title+"\n"+d.Content+"\n"+strings.Join(d.Tags, " ")), query) {
			filtered = append(filtered, d)
		}
	}
	writeJSON(w, map[string]any{"data": filtered})
}
func (s *Server) handleCreateDocument(w http.ResponseWriter, r *http.Request) {
	owner := s.requireOwner(w, r)
	if owner == "" {
		return
	}
	var d localDocument
	if decodeSecurityJSON(r, &d) != nil || strings.TrimSpace(d.Content) == "" {
		writeError(w, 400, "document content required", "invalid_request")
		return
	}
	d.ID = newID("doc")
	d.CreatedAt = nowRFC3339()
	if d.Title == "" {
		d.Title = "Untitled"
	}
	if d.Source == "" {
		d.Source = "ai-tool"
	}
	if err := s.putResource(owner, "document", d.ID, d, nil); err != nil {
		resourceError(w, err)
		return
	}
	writeJSON(w, map[string]any{"data": d})
}
func (s *Server) handleDeleteDocument(w http.ResponseWriter, r *http.Request) {
	owner := s.requireOwner(w, r)
	if owner == "" {
		return
	}
	if err := s.deleteResource(owner, "document", r.PathValue("id")); err != nil {
		resourceError(w, err)
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}

func (s *Server) handlePatchDocument(w http.ResponseWriter, r *http.Request) {
	owner := s.requireOwner(w, r)
	if owner == "" {
		return
	}
	var d localDocument
	if _, err := s.getResource(owner, "document", r.PathValue("id"), &d); err != nil {
		resourceError(w, err)
		return
	}
	var req struct {
		Title   *string   `json:"title"`
		Content *string   `json:"content"`
		Tags    *[]string `json:"tags"`
		Source  *string   `json:"source"`
	}
	if decodeSecurityJSON(r, &req) != nil {
		writeError(w, 400, "invalid JSON", "invalid_request")
		return
	}
	if req.Title != nil {
		d.Title = strings.TrimSpace(*req.Title)
	}
	if req.Content != nil {
		d.Content = *req.Content
	}
	if req.Tags != nil {
		d.Tags = *req.Tags
	}
	if req.Source != nil {
		d.Source = strings.TrimSpace(*req.Source)
	}
	if strings.TrimSpace(d.Content) == "" {
		writeError(w, 400, "document content required", "invalid_request")
		return
	}
	if err := s.putResource(owner, "document", d.ID, d, nil); err != nil {
		resourceError(w, err)
		return
	}
	writeJSON(w, map[string]any{"data": d})
}
func validMcpHeaders(headers map[string]string) bool {
	for k, v := range headers {
		if strings.ContainsAny(k+v, "\r\n") || len(k) > 200 || len(v) > 8192 {
			return false
		}
		switch strings.ToLower(strings.TrimSpace(k)) {
		case "host", "content-length", "transfer-encoding", "connection", "proxy-authorization", "proxy-connection":
			return false
		}
	}
	return len(headers) <= 30
}
func (s *Server) saveMcp(owner string, row localMcpServer, headers map[string]string) error {
	if err := assertPublicURL(row.URL); err != nil {
		return err
	}
	if !validMcpHeaders(headers) {
		return fmt.Errorf("invalid headers")
	}
	b, err := json.Marshal(headers)
	if err != nil {
		return err
	}
	secret, err := s.protect(owner, "mcp:"+row.ID, b)
	if err != nil {
		return err
	}
	row.Headers = map[string]string{}
	row.HasHeaders = len(headers) > 0
	return s.putResource(owner, "mcp", row.ID, row, secret)
}
func (s *Server) ownedMcp(owner, id string) (*localMcpServer, error) {
	var row localMcpServer
	secret, err := s.getResource(owner, "mcp", id, &row)
	if err != nil {
		return nil, err
	}
	b, err := s.unprotect(owner, "mcp:"+id, secret)
	if err != nil {
		return nil, err
	}
	if len(b) > 0 {
		if err = json.Unmarshal(b, &row.Headers); err != nil {
			return nil, err
		}
	}
	return &row, nil
}
func (s *Server) handleListMcpServers(w http.ResponseWriter, r *http.Request) {
	owner := s.requireOwner(w, r)
	if owner == "" {
		return
	}
	rows, err := resourceList[localMcpServer](s, owner, "mcp")
	if err != nil {
		resourceError(w, err)
		return
	}
	writeJSON(w, map[string]any{"data": rows})
}
func (s *Server) handleCreateMcpServer(w http.ResponseWriter, r *http.Request) {
	owner := s.requireOwner(w, r)
	if owner == "" {
		return
	}
	var row localMcpServer
	if decodeSecurityJSON(r, &row) != nil || row.Name == "" || assertPublicURL(row.URL) != nil || !validMcpHeaders(row.Headers) {
		writeError(w, 400, "valid name, public URL and headers required", "invalid_request")
		return
	}
	row.ID = newID("mcp")
	row.CreatedAt = nowRFC3339()
	row.Status = "disconnected"
	if err := s.saveMcp(owner, row, row.Headers); err != nil {
		resourceError(w, err)
		return
	}
	row.HasHeaders = len(row.Headers) > 0
	row.Headers = map[string]string{}
	writeJSON(w, map[string]any{"data": row})
}
func (s *Server) handlePatchMcpServer(w http.ResponseWriter, r *http.Request) {
	owner := s.requireOwner(w, r)
	if owner == "" {
		return
	}
	row, err := s.ownedMcp(owner, r.PathValue("id"))
	if err != nil {
		resourceError(w, err)
		return
	}
	var req struct {
		Name        *string            `json:"name"`
		URL         *string            `json:"url"`
		Enabled     *bool              `json:"enabled"`
		Headers     *map[string]string `json:"headers"`
		Description *string            `json:"description"`
	}
	if decodeSecurityJSON(r, &req) != nil {
		writeError(w, 400, "invalid JSON", "invalid_request")
		return
	}
	if req.Name != nil {
		row.Name = strings.TrimSpace(*req.Name)
	}
	if req.URL != nil {
		row.URL = *req.URL
	}
	if req.Enabled != nil {
		row.Enabled = *req.Enabled
	}
	if req.Headers != nil {
		row.Headers = *req.Headers
	}
	if req.Description != nil {
		row.Description = *req.Description
	}
	if row.Name == "" || assertPublicURL(row.URL) != nil || !validMcpHeaders(row.Headers) {
		writeError(w, 400, "invalid MCP configuration", "invalid_request")
		return
	}
	if err = s.saveMcp(owner, *row, row.Headers); err != nil {
		resourceError(w, err)
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}
func (s *Server) handleDeleteMcpServer(w http.ResponseWriter, r *http.Request) {
	owner := s.requireOwner(w, r)
	if owner == "" {
		return
	}
	if err := s.deleteResource(owner, "mcp", r.PathValue("id")); err != nil {
		resourceError(w, err)
		return
	}
	writeJSON(w, map[string]any{"ok": true})
}
func validMcpMethod(method string, params map[string]any) bool {
	switch method {
	case "initialize", "ping", "tools/list":
		return true
	case "tools/call":
		name, ok := params["name"].(string)
		if !ok || name == "" {
			return false
		}
		_, ok = params["arguments"].(map[string]any)
		return ok
	}
	return false
}
func (s *Server) handleMcpProxy(w http.ResponseWriter, r *http.Request) {
	owner := s.requireOwner(w, r)
	if owner == "" {
		return
	}
	var req struct {
		ServerID string         `json:"server_id"`
		Method   string         `json:"method"`
		Params   map[string]any `json:"params"`
	}
	if decodeSecurityJSON(r, &req) != nil || req.ServerID == "" || !validMcpMethod(req.Method, req.Params) {
		writeError(w, 400, "registered server_id and allowed method required", "invalid_request")
		return
	}
	row, err := s.ownedMcp(owner, req.ServerID)
	if err != nil {
		resourceError(w, err)
		return
	}
	if !row.Enabled {
		writeError(w, 400, "MCP server disabled", "invalid_request")
		return
	}
	if req.Method == "tools/call" {
		listed, e := s.mcpJSONRPC(*row, "tools/list", map[string]any{})
		if e != nil || !mcpToolExistsInList(listed, req.Params["name"].(string)) {
			writeError(w, 400, "registered tool required", "invalid_request")
			return
		}
	}
	out, err := s.mcpJSONRPC(*row, req.Method, req.Params)
	if err != nil {
		writeError(w, 502, "MCP request failed", "upstream_error")
		return
	}
	writeJSON(w, out)
}
