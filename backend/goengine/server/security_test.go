package server

import (
	"ai-server-studio-backend/security"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func securityTestServer(t *testing.T) (*Server, string, string) {
	t.Helper()
	t.Setenv("AI_SERVER_DATA_DIR", t.TempDir())
	t.Setenv("AI_SERVER_SECRET_KEY", base64.StdEncoding.EncodeToString(make([]byte, 32)))
	db, e := sql.Open("sqlite", ":memory:")
	if e != nil {
		t.Fatal(e)
	}
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	if _, e = db.Exec(`PRAGMA foreign_keys=ON`); e != nil {
		t.Fatal(e)
	}
	s := &Server{db: db, mux: http.NewServeMux()}
	if e = s.initLocalSecurity(); e != nil {
		t.Fatal(e)
	}
	s.registerAuthDataRoutes()
	s.registerProviderRoutes()
	s.registerSettingsRoutes()
	hash, e := hashPassword("test-password")
	if e != nil {
		t.Fatal(e)
	}
	for _, id := range []string{"owner-a", "owner-b"} {
		if _, e = db.Exec(`INSERT INTO users(id,email,password_hash,created_at) VALUES(?,?,?,?)`, id, id+"@example.test", hash, nowRFC3339()); e != nil {
			t.Fatal(e)
		}
	}
	a, e := s.makeSession("owner-a")
	if e != nil {
		t.Fatal(e)
	}
	b, e := s.makeSession("owner-b")
	if e != nil {
		t.Fatal(e)
	}
	return s, a, b
}
func securityRequest(t *testing.T, h http.Handler, method, path, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	r.RemoteAddr = "127.0.0.1:12345"
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func responseMap(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if e := json.Unmarshal(w.Body.Bytes(), &out); e != nil {
		t.Fatal(e, w.Body.String())
	}
	return out
}
func assertStatus(t *testing.T, w *httptest.ResponseRecorder, status int) {
	t.Helper()
	if w.Code != status {
		t.Fatalf("status %d wanted %d: %s", w.Code, status, w.Body.String())
	}
}
func TestSecurityOwnedResourcesAndSecretStorage(t *testing.T) {
	s, a, b := securityTestServer(t)
	h := s.authMiddleware(s.mux)
	w := securityRequest(t, h, "POST", "/v1/kb/documents", a, `{"content":"account a","title":"one"}`)
	assertStatus(t, w, 200)
	id := responseMap(t, w)["data"].(map[string]any)["id"].(string)
	w = securityRequest(t, h, "GET", "/v1/kb/documents", b, "")
	if len(responseMap(t, w)["data"].([]any)) != 0 {
		t.Fatal("cross-owner documents")
	}
	assertStatus(t, securityRequest(t, h, "DELETE", "/v1/kb/documents/"+id, b, ""), 404)
	assertStatus(t, securityRequest(t, h, "PATCH", "/v1/kb/documents/"+id, b, `{"content":"hijack"}`), 404)
	assertStatus(t, securityRequest(t, h, "PATCH", "/v1/kb/documents/"+id, a, `{"content":"updated"}`), 200)
	assertStatus(t, securityRequest(t, h, "DELETE", "/v1/kb/documents/"+id, a, ""), 200)
	p := providerRecord{ID: "test-provider", Name: "test", BaseURL: "https://example.com/v1", APIKey: "synthetic-provider-secret", Enabled: true}
	if e := s.saveProvider("owner-a", p); e != nil {
		t.Fatal(e)
	}
	var payload string
	var ciphertext []byte
	if e := s.db.QueryRow(`SELECT payload,secret FROM security_resources WHERE owner_id=? AND kind='provider'`, "owner-a").Scan(&payload, &ciphertext); e != nil {
		t.Fatal(e)
	}
	if strings.Contains(payload, p.APIKey) || strings.Contains(string(ciphertext), p.APIKey) {
		t.Fatal("plaintext provider credential")
	}
	w = securityRequest(t, h, "GET", "/v1/providers", a, "")
	row := responseMap(t, w)["data"].([]any)[0].(map[string]any)
	if row["api_key"] != "" || row["has_key"] != true {
		t.Fatal("provider credential response unsafe")
	}
	assertStatus(t, securityRequest(t, h, "PATCH", "/v1/providers/test-provider", b, `{"name":"hijack"}`), 404)
	assertStatus(t, securityRequest(t, h, "DELETE", "/v1/providers/test-provider", b, ""), 404)
	if _, e := s.findProviderByID("owner-b", p.ID); e != sql.ErrNoRows {
		t.Fatal("substituted provider ID")
	}
	if _, e := s.executeKnowledgeBaseTool(map[string]any{"action": "list"}); e == nil {
		t.Fatal("unowned KB permitted")
	}
	assertStatus(t, securityRequest(t, h, "POST", "/v1/mcp/servers", a, `{"name":"ssrf","url":"https://127.0.0.1"}`), 400)
	assertStatus(t, securityRequest(t, h, "POST", "/v1/mcp/proxy", a, `{"server_url":"https://example.com","method":"tools/list"}`), 400)
	m := localMcpServer{ID: "mcp-test", Name: "test", URL: "https://8.8.8.8/mcp", Headers: map[string]string{"Authorization": "synthetic-mcp-secret"}, Enabled: true}
	if e := s.saveMcp("owner-a", m, m.Headers); e != nil {
		t.Fatal(e)
	}
	w = securityRequest(t, h, "GET", "/v1/mcp/servers", a, "")
	if strings.Contains(w.Body.String(), "synthetic-mcp-secret") {
		t.Fatal("MCP header secret returned")
	}
	assertStatus(t, securityRequest(t, h, "PATCH", "/v1/mcp/servers/mcp-test", b, `{"enabled":false}`), 404)
	assertStatus(t, securityRequest(t, h, "DELETE", "/v1/mcp/servers/mcp-test", b, ""), 404)
	if _, e := s.ownedMcp("owner-b", "mcp-test"); e != sql.ErrNoRows {
		t.Fatal("substituted MCP ID")
	}
	assertStatus(t, securityRequest(t, h, "POST", "/v1/mcp/proxy", a, `{"server_id":"mcp-test","method":"admin/delete","params":{}}`), 400)
}
func TestSecurityGatewayHashesPermissionsRateExpiryAndRevocation(t *testing.T) {
	s, a, b := securityTestServer(t)
	h := s.authMiddleware(s.mux)
	s.mux.HandleFunc("GET /v1/models", func(w http.ResponseWriter, r *http.Request) {
		u, e := s.currentUserFromRequest(r)
		if e != nil || u == nil || u.ID != "owner-a" {
			t.Error("external principal not resolved")
		}
		writeJSON(w, map[string]any{"data": []any{map[string]any{"id": "allowed"}, map[string]any{"id": "blocked"}}})
	})
	s.mux.HandleFunc("POST /v1/chat/completions", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, map[string]any{"ok": true}) })
	w := securityRequest(t, h, "POST", "/v1/api-keys", a, `{"name":"test-key","rate_limit_rpm":2,"permissions":["models"],"allowed_models":["allowed"]}`)
	assertStatus(t, w, 200)
	created := responseMap(t, w)
	raw := created["raw_key"].(string)
	id := created["data"].(map[string]any)["id"].(string)
	var hash, payload string
	if e := s.db.QueryRow(`SELECT token_hash,payload FROM security_api_keys WHERE id=?`, id).Scan(&hash, &payload); e != nil {
		t.Fatal(e)
	}
	if hash != security.TokenHash(raw) || strings.Contains(payload, raw) {
		t.Fatal("raw API key persisted")
	}
	var sessionHash string
	if e := s.db.QueryRow(`SELECT token_hash FROM security_sessions WHERE owner_id='owner-a'`).Scan(&sessionHash); e != nil || sessionHash != security.TokenHash(a) {
		t.Fatal("session not hashed")
	}
	public := s.PublicHandler()
	assertStatus(t, securityRequest(t, public, "GET", "/v1/models", a, ""), 401)
	assertStatus(t, securityRequest(t, public, "GET", "/v1/api-keys", raw, ""), 403)
	assertStatus(t, securityRequest(t, h, "GET", "/v1/profile", raw, ""), 403)
	assertStatus(t, securityRequest(t, public, "POST", "/v1/chat/completions", raw, `{"model":"allowed"}`), 403)
	w = securityRequest(t, public, "GET", "/v1/models", raw, "")
	assertStatus(t, w, 200)
	if len(responseMap(t, w)["data"].([]any)) != 1 {
		t.Fatal("model allowlist not applied")
	}
	assertStatus(t, securityRequest(t, public, "GET", "/v1/models", raw, ""), 200)
	assertStatus(t, securityRequest(t, public, "GET", "/v1/models", raw, ""), 429)
	assertStatus(t, securityRequest(t, h, "DELETE", "/v1/api-keys/"+id, b, ""), 404)
	assertStatus(t, securityRequest(t, h, "PATCH", "/v1/api-keys/"+id, a, `{"is_active":false}`), 200)
	assertStatus(t, securityRequest(t, public, "GET", "/v1/models", raw, ""), 401)
	if _, e := s.db.Exec(`UPDATE security_api_keys SET active=1,expires_at=? WHERE id=?`, time.Now().Add(-time.Hour).Unix(), id); e != nil {
		t.Fatal(e)
	}
	assertStatus(t, securityRequest(t, public, "GET", "/v1/models", raw, ""), 401)
	if _, e := s.db.Exec(`UPDATE security_sessions SET expires_at=? WHERE token_hash=?`, time.Now().Add(-time.Hour).Unix(), security.TokenHash(b)); e != nil {
		t.Fatal(e)
	}
	assertStatus(t, securityRequest(t, h, "GET", "/v1/profile", b, ""), 401)
	w = securityRequest(t, h, "POST", "/v1/api-keys", a, `{"name":"chat-only","permissions":["chat"],"allowed_models":["allowed"]}`)
	assertStatus(t, w, 200)
	chatKey := responseMap(t, w)["raw_key"].(string)
	assertStatus(t, securityRequest(t, public, "POST", "/v1/chat/completions", chatKey, `{"model":"blocked"}`), 403)
	assertStatus(t, securityRequest(t, public, "POST", "/v1/chat/completions", chatKey, `{"model":"allowed"}`), 200)
	assertStatus(t, securityRequest(t, public, "GET", "/v1/models", chatKey, ""), 403)
	assertStatus(t, securityRequest(t, h, "POST", "/v1/api-keys", a, `{"name":"bad","permissions":["admin"]}`), 400)
	assertStatus(t, securityRequest(t, h, "POST", "/v1/api-keys", a, `{"name":"bad","rate_limit_rpm":-1}`), 400)
	assertStatus(t, securityRequest(t, h, "POST", "/v1/api-keys", a, `{"name":"bad","expires_at":"not-a-date"}`), 400)
}
func TestSecurityPasswordChangeLegacyUpgradeAndThrottle(t *testing.T) {
	s, a, _ := securityTestServer(t)
	h := s.authMiddleware(s.mux)
	old := security.TokenHash("legacy-password")
	if _, e := s.db.Exec(`UPDATE users SET password_hash=? WHERE id='owner-b'`, old); e != nil {
		t.Fatal(e)
	}
	w := securityRequest(t, h, "POST", "/v1/auth/signin", "", `{"email":"owner-b@example.test","password":"legacy-password"}`)
	assertStatus(t, w, 200)
	var upgraded string
	if e := s.db.QueryRow(`SELECT password_hash FROM users WHERE id='owner-b'`).Scan(&upgraded); e != nil || !strings.HasPrefix(upgraded, "$argon2id$") {
		t.Fatal("legacy hash not upgraded")
	}
	assertStatus(t, securityRequest(t, h, "POST", "/v1/auth/update-password", a, `{"password":"new-password","current_password":"wrong"}`), 401)
	assertStatus(t, securityRequest(t, h, "POST", "/v1/auth/update-password", a, `{"password":"new-password","current_password":"test-password"}`), 200)
	assertStatus(t, securityRequest(t, h, "GET", "/v1/profile", a, ""), 401)
	for i := 0; i < 10; i++ {
		w = securityRequest(t, h, "POST", "/v1/auth/signin", "", `{"email":"missing@example.test","password":"bad"}`)
	}
	assertStatus(t, securityRequest(t, h, "POST", "/v1/auth/signin", "", `{"email":"missing@example.test","password":"bad"}`), 429)
	assertStatus(t, securityRequest(t, h, "POST", "/v1/auth/signup", "", `{"email":"bad","password":"tiny"}`), 400)
}
func TestSecurityAccountStateImportIdempotencyAndRollback(t *testing.T) {
	s, a, b := securityTestServer(t)
	h := s.authMiddleware(s.mux)
	assertStatus(t, securityRequest(t, h, "PUT", "/v1/settings/user", a, `{"data":{"theme":"dark"}}`), 200)
	w := securityRequest(t, h, "GET", "/v1/settings/user", b, "")
	if len(responseMap(t, w)["data"].(map[string]any)) != 0 {
		t.Fatal("settings cross-owner leak")
	}
	body := `{"source_id":"browser-1","data":{"sessions":[{"id":"chat-1"}],"activeSessionId":"chat-1"}}`
	assertStatus(t, securityRequest(t, h, "POST", "/v1/conversations/import", a, body), 200)
	w = securityRequest(t, h, "POST", "/v1/conversations/import", a, body)
	if responseMap(t, w)["imported"] != false {
		t.Fatal("non-idempotent import")
	}
	assertStatus(t, securityRequest(t, h, "POST", "/v1/conversations/import", a, `{"source_id":"browser-1","data":{"sessions":[]}}`), 409)
	assertStatus(t, securityRequest(t, h, "POST", "/v1/conversations/import", b, body), 200)
	assertStatus(t, securityRequest(t, h, "PUT", "/v1/conversations/state", b, `{"data":null}`), 400)
	if e := s.deleteResource("owner-b", "conversations", "state"); e != nil {
		t.Fatal(e)
	}
	if _, e := s.db.Exec(`CREATE TRIGGER reject_import BEFORE INSERT ON security_imports WHEN NEW.source_id='rollback' BEGIN SELECT RAISE(ABORT,'fixture'); END`); e != nil {
		t.Fatal(e)
	}
	assertStatus(t, securityRequest(t, h, "POST", "/v1/conversations/import", b, `{"source_id":"rollback","data":{"sessions":[]}}`), 500)
	var count int
	if e := s.db.QueryRow(`SELECT count(*) FROM security_resources WHERE owner_id='owner-b' AND kind='conversations'`).Scan(&count); e != nil || count != 0 {
		t.Fatal("failed import left state")
	}
}
func TestSecurityExplicitLegacyMigrationOwnershipBackupAndRollback(t *testing.T) {
	s, _, _ := securityTestServer(t)
	dir := t.TempDir()
	write := func(name, body string) {
		t.Helper()
		if e := os.WriteFile(filepath.Join(dir, name), []byte(body), 0600); e != nil {
			t.Fatal(e)
		}
	}
	write("users.json", `[{"id":"legacy-owner","email":"legacy@example.test","password_hash":"`+security.TokenHash("legacy-password")+`"}]`)
	docs := `[{"id":"owned","user_id":"legacy-owner","content":"owned"},{"id":"other","user_id":"other-owner","content":"other"},{"id":"unowned","content":"unowned"}]`
	write("documents.json", docs)
	write("auth_sessions.json", `[{"token":"old-exposed-token","user_id":"legacy-owner"}]`)
	if _, e := s.ImportLegacyAccount(context.Background(), dir, "legacy@example.test", "wrong"); e == nil {
		t.Fatal("unverified legacy login accepted")
	}
	report, e := s.ImportLegacyAccount(context.Background(), dir, "legacy@example.test", "legacy-password")
	if e != nil {
		t.Fatal(e)
	}
	if report.Imported != 1 || report.SkippedUnowned != 3 || !report.RotationRequired {
		t.Fatalf("unexpected report %+v", report)
	}
	rows, e := resourceList[localDocument](s, "legacy-owner", "document")
	if e != nil || len(rows) != 1 || rows[0].ID != "owned" {
		t.Fatal("legacy ownership failure")
	}
	for _, path := range []string{filepath.Join(dir, "documents.json"), filepath.Join(report.BackupDirectory, "documents.json")} {
		b, e := os.ReadFile(path)
		if e != nil || string(b) != docs {
			t.Fatal("original/backup altered")
		}
	}
	report, e = s.ImportLegacyAccount(context.Background(), dir, "legacy@example.test", "legacy-password")
	if e != nil || !report.AlreadyImported {
		t.Fatal("legacy import not idempotent", e)
	}
	changed, e := hashPassword("changed-password")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.db.Exec(`UPDATE users SET password_hash=? WHERE id='legacy-owner'`, changed); e != nil {
		t.Fatal(e)
	}
	if _, e = s.ImportLegacyAccount(context.Background(), dir, "legacy@example.test", "legacy-password"); e == nil {
		t.Fatal("old legacy password bypassed changed account password")
	}
	dir2 := t.TempDir()
	if e = os.WriteFile(filepath.Join(dir2, "users.json"), []byte(`[{"id":"rollback-owner","email":"rollback@example.test","password_hash":"`+security.TokenHash("legacy-password")+`"}]`), 0600); e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(filepath.Join(dir2, "documents.json"), []byte(`[{"id":"rollback-doc","user_id":"rollback-owner","content":"fixture"}]`), 0600); e != nil {
		t.Fatal(e)
	}
	if _, e = s.db.Exec(`CREATE TRIGGER reject_legacy BEFORE INSERT ON security_imports WHEN NEW.owner_id='rollback-owner' BEGIN SELECT RAISE(ABORT,'fixture'); END`); e != nil {
		t.Fatal(e)
	}
	if _, e = s.ImportLegacyAccount(context.Background(), dir2, "rollback@example.test", "legacy-password"); e == nil {
		t.Fatal("expected rollback")
	}
	var count int
	if e = s.db.QueryRow(`SELECT count(*) FROM users WHERE id='rollback-owner'`).Scan(&count); e != nil || count != 0 {
		t.Fatal("legacy migration failed to rollback account")
	}
	if e = s.db.QueryRow(`SELECT count(*) FROM security_resources WHERE owner_id='rollback-owner'`).Scan(&count); e != nil || count != 0 {
		t.Fatal("legacy migration failed to rollback resources")
	}
}

// Test-only outbound transport records the full provider request without making
// network calls; URL validation uses the deterministic public literal address.
type securityRoundTripper func(*http.Request) (*http.Response, error)

func (f securityRoundTripper) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestSecurityProviderCompletionPreservesToolSamplingAndStream(t *testing.T) {
	s, a, _ := securityTestServer(t)
	p := providerRecord{ID: "provider", Name: "test", BaseURL: "https://8.8.8.8/v1", APIKey: "synthetic", Enabled: true}
	if e := s.saveProvider("owner-a", p); e != nil {
		t.Fatal(e)
	}
	old := outboundHTTPClient
	t.Cleanup(func() { outboundHTTPClient = old })
	outboundHTTPClient = &http.Client{Transport: securityRoundTripper(func(r *http.Request) (*http.Response, error) {
		b, _ := io.ReadAll(r.Body)
		var v map[string]any
		if json.Unmarshal(b, &v) != nil {
			t.Fatal("invalid upstream payload")
		}
		if v["tools"] == nil || v["tool_choice"] != "auto" || v["temperature"] != 0.7 || v["top_p"] != 0.8 || v["frequency_penalty"] != 0.2 {
			t.Fatal("provider options dropped", v)
		}
		if r.Header.Get("Authorization") != "Bearer synthetic" {
			t.Fatal("stored provider key not used")
		}
		if v["stream"] == true {
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("data: [DONE]\n\n")), Header: make(http.Header)}, nil
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"choices":[{"message":{"content":"answer","tool_calls":[{"id":"call"}]}}]}`)), Header: make(http.Header)}, nil
	})}
	h := s.authMiddleware(s.mux)
	for _, stream := range []string{"false", "true"} {
		body := `{"providerId":"provider","model":"model","messages":[],"tools":[{"type":"function"}],"tool_choice":"auto","temperature":0.7,"top_p":0.8,"frequency_penalty":0.2,"stream":` + stream + `}`
		w := securityRequest(t, h, "POST", "/v1/providers/chat/completions", a, body)
		assertStatus(t, w, 200)
		if stream == "true" {
			if w.Body.String() != "data: [DONE]\n\n" {
				t.Fatal("stream altered")
			}
		} else {
			raw := responseMap(t, w)["raw"].(map[string]any)
			if raw["choices"] == nil {
				t.Fatal("tool response dropped")
			}
		}
	}
}
