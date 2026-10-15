package server

import (
	"ai-server-studio-backend/security"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

type principal struct {
	OwnerID, KeyID      string
	RequestModel        string
	Permissions, Models []string
	RPM                 int
}
type principalContextKey struct{}

func principalFromRequest(r *http.Request) *principal {
	p, _ := r.Context().Value(principalContextKey{}).(*principal)
	return p
}
func externalRoute(r *http.Request) string {
	switch r.Method + " " + r.URL.Path {
	case "GET /v1/models":
		return "models"
	case "POST /v1/chat/completions", "POST /v1/providers/chat/completions":
		return "chat"
	}
	return ""
}
func containsString(ss []string, s string) bool {
	for _, v := range ss {
		if v == s {
			return true
		}
	}
	return false
}
func (s *Server) resolvePrincipal(r *http.Request, externalOnly bool) (*principal, error) {
	if s.db == nil || s.dbErr != nil {
		return nil, sql.ErrConnDone
	}
	token := authTokenFromRequest(r)
	if token == "" {
		return nil, nil
	}
	hash := security.TokenHash(token)
	if !externalOnly {
		var owner string
		err := s.db.QueryRow(`SELECT owner_id FROM security_sessions WHERE token_hash=? AND revoked=0 AND expires_at>?`, hash, time.Now().Unix()).Scan(&owner)
		if err == nil {
			return &principal{OwnerID: owner}, nil
		}
		if err != sql.ErrNoRows {
			return nil, err
		}
	}
	var key localApiKey
	var owner, id, payload string
	err := s.db.QueryRow(`SELECT owner_id,id,payload FROM security_api_keys WHERE token_hash=? AND active=1 AND (expires_at IS NULL OR expires_at>?)`, hash, time.Now().Unix()).Scan(&owner, &id, &payload)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err = json.Unmarshal([]byte(payload), &key); err != nil {
		return nil, err
	}
	return &principal{OwnerID: owner, KeyID: id, Permissions: key.Permissions, Models: key.AllowedModels, RPM: key.RateLimitRPM}, nil
}
func (s *Server) rateAllowed(scope string, limit int, period time.Duration) bool {
	if s.db == nil || limit <= 0 {
		return false
	}
	bucket := time.Now().Unix() / int64(period/time.Second)
	result, err := s.db.Exec(`INSERT INTO security_rate_limits(scope,bucket,count) VALUES(?,?,1) ON CONFLICT(scope,bucket) DO UPDATE SET count=count+1 WHERE count<?`, scope, bucket, limit)
	if err != nil {
		return false
	}
	n, err := result.RowsAffected()
	return err == nil && n > 0
}
func (s *Server) authThrottled(w http.ResponseWriter, r *http.Request, email string) bool {
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		ip = r.RemoteAddr
	}
	if !s.rateAllowed("login-ip:"+security.TokenHash(ip), 30, time.Minute) || !s.rateAllowed("login-account:"+security.TokenHash(strings.ToLower(email)), 10, time.Minute) {
		w.Header().Set("Retry-After", "60")
		writeError(w, 429, "too many authentication attempts", "rate_limit")
		return true
	}
	return false
}
func (s *Server) authorizeExternal(w http.ResponseWriter, r *http.Request, p *principal) bool {
	permission := externalRoute(r)
	if permission == "" || !containsString(p.Permissions, permission) {
		writeError(w, 403, "API key route or permission denied", "forbidden")
		return false
	}
	if !s.rateAllowed("api-key:"+p.KeyID, p.RPM, time.Minute) {
		w.Header().Set("Retry-After", "60")
		writeError(w, 429, "API key rate limit exceeded", "rate_limit")
		return false
	}
	if r.Method == "POST" {
		b, err := io.ReadAll(io.LimitReader(r.Body, (4<<20)+1))
		if err != nil || len(b) > 4<<20 {
			writeError(w, 400, "invalid request body", "invalid_request")
			return false
		}
		r.Body = io.NopCloser(bytes.NewReader(b))
		var v struct {
			Model string `json:"model"`
		}
		if json.Unmarshal(b, &v) != nil || v.Model == "" {
			writeError(w, 400, "model and valid JSON required", "invalid_request")
			return false
		}
		p.RequestModel = v.Model
		if len(p.Models) > 0 && !containsString(p.Models, v.Model) {
			writeError(w, 403, "model not permitted", "forbidden")
			return false
		}
	}
	_, _ = s.db.Exec(`UPDATE security_api_keys SET payload=json_set(payload,'$.last_used_at',?) WHERE id=? AND owner_id=?`, nowRFC3339(), p.KeyID, p.OwnerID)
	return true
}

// PublicHandler is the only handler suitable for a tunnel. It never accepts
// account sessions and denies every route except the explicit API allowlist.
func (s *Server) PublicHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if externalRoute(r) == "" {
			writeError(w, 403, "route unavailable on public API", "forbidden")
			return
		}
		p, err := s.resolvePrincipal(r, true)
		if err != nil {
			writeError(w, 503, "identity store unavailable", "unavailable")
			return
		}
		if p == nil {
			writeError(w, 401, "external API key required", "unauthorized")
			return
		}
		if !s.authorizeExternal(w, r, p) {
			return
		}
		s.serveExternal(s.mux, w, r.WithContext(context.WithValue(r.Context(), principalContextKey{}, p)), p)
	})
}

// PublicAPIHandler is the explicit tunnel-facing name retained for callers
// that distinguish the public API from the desktop session mux.
func (s *Server) PublicAPIHandler() http.Handler { return s.PublicHandler() }

type auditResponseWriter struct {
	http.ResponseWriter
	status int
}

func (w *auditResponseWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}
func (w *auditResponseWriter) Flush() {
	if f, ok := w.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (s *Server) secureAuthMiddleware(next http.Handler) http.Handler {
	public := map[string]bool{"/v1/auth/signup": true, "/v1/auth/signin": true, "/v1/auth/import-legacy": true, "/v1/auth/reset-password": true, "/v1/auth/session": true, "/v1/system/status": true}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if public[r.URL.Path] && authTokenFromRequest(r) == "" {
			next.ServeHTTP(w, r)
			return
		}
		p, err := s.resolvePrincipal(r, false)
		if err != nil {
			writeError(w, 503, "identity store unavailable", "unavailable")
			return
		}
		if p == nil {
			if public[r.URL.Path] {
				next.ServeHTTP(w, r)
				return
			}
			writeError(w, 401, "not authenticated", "unauthorized")
			return
		}
		if p.KeyID != "" && !s.authorizeExternal(w, r, p) {
			return
		}
		authed := r.WithContext(context.WithValue(r.Context(), principalContextKey{}, p))
		if p.KeyID != "" {
			s.serveExternal(next, w, authed, p)
		} else {
			s.servePrincipal(next, w, authed, p)
		}
	})
}

func (s *Server) serveExternal(next http.Handler, w http.ResponseWriter, r *http.Request, p *principal) {
	start := time.Now()
	sw := &auditResponseWriter{ResponseWriter: w, status: 200}
	s.servePrincipal(next, sw, r, p)
	log := localUsageLog{ID: newID("usage"), Model: p.RequestModel, Endpoint: r.URL.Path, StatusCode: sw.status, ApiKeyID: p.KeyID, LatencyMs: int(time.Since(start).Milliseconds()), CreatedAt: nowRFC3339()}
	_ = s.putResource(p.OwnerID, "usage", log.ID, log, nil)
}

type bufferedModelResponse struct {
	header http.Header
	status int
	bytes.Buffer
}

func (b *bufferedModelResponse) Header() http.Header  { return b.header }
func (b *bufferedModelResponse) WriteHeader(code int) { b.status = code }
func (s *Server) servePrincipal(next http.Handler, w http.ResponseWriter, r *http.Request, p *principal) {
	if p.KeyID == "" || len(p.Models) == 0 || externalRoute(r) != "models" {
		next.ServeHTTP(w, r)
		return
	}
	b := &bufferedModelResponse{header: make(http.Header), status: 200}
	next.ServeHTTP(b, r)
	if b.status >= 400 {
		for k, v := range b.header {
			w.Header()[k] = v
		}
		w.WriteHeader(b.status)
		_, _ = w.Write(b.Bytes())
		return
	}
	var result map[string]any
	if json.Unmarshal(b.Bytes(), &result) != nil {
		writeError(w, 502, "invalid model inventory response", "upstream_error")
		return
	}
	out := []any{}
	rows, _ := result["data"].([]any)
	for _, raw := range rows {
		v, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		id, _ := v["id"].(string)
		if containsString(p.Models, id) {
			out = append(out, v)
		}
	}
	result["data"] = out
	writeJSON(w, result)
}
