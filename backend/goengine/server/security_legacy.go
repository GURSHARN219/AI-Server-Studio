package server

import (
	"ai-server-studio-backend/security"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type LegacyMigrationReport struct {
	OwnerID          string `json:"owner_id"`
	Imported         int    `json:"imported"`
	SkippedUnowned   int    `json:"skipped_unowned"`
	AlreadyImported  bool   `json:"already_imported"`
	RotationRequired bool   `json:"rotation_required"`
	BackupDirectory  string `json:"backup_directory"`
}

// ImportLegacyAccount is an explicit, credential-verified migration entry point.
// It is never called on startup. Old files without per-record ownership are
// retained but not attributed to the first/only account. Sessions and API keys
// are invalidated rather than importing previously exposed credentials.
func (s *Server) ImportLegacyAccount(ctx context.Context, directory, email, password string) (LegacyMigrationReport, error) {
	var report LegacyMigrationReport
	if !filepath.IsAbs(directory) {
		return report, fmt.Errorf("absolute legacy directory required")
	}
	if len(password) > 1024 {
		return report, fmt.Errorf("invalid credentials")
	}
	names := []string{"users.json", "profiles.json", "providers.json", "api_keys.json", "api_usage_logs.json", "auth_sessions.json", "mcp_servers.json", "documents.json", "provider_model_prefs.json"}
	files := map[string][]byte{}
	digestInput := ""
	for _, name := range names {
		b, err := os.ReadFile(filepath.Join(directory, name))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return report, err
		}
		if len(b) > 32<<20 {
			return report, fmt.Errorf("legacy file too large")
		}
		if !json.Valid(b) {
			return report, fmt.Errorf("invalid legacy JSON in %s", name)
		}
		files[name] = b
		digestInput += name + ":" + security.TokenHash(string(b)) + "\n"
	}
	var users []struct {
		ID           string `json:"id"`
		Email        string `json:"email"`
		PasswordHash string `json:"password_hash"`
		DisplayName  string `json:"display_name"`
		CreatedAt    string `json:"created_at"`
	}
	if err := json.Unmarshal(files["users.json"], &users); err != nil {
		return report, fmt.Errorf("legacy users required")
	}
	email = strings.ToLower(strings.TrimSpace(email))
	var user localUser
	for _, u := range users {
		if strings.ToLower(strings.TrimSpace(u.Email)) == email {
			valid, _ := security.VerifyPassword(u.PasswordHash, password)
			if valid {
				user = localUser{ID: u.ID, Email: email, PasswordHash: u.PasswordHash, DisplayName: u.DisplayName, CreatedAt: u.CreatedAt}
			}
		}
	}
	if user.ID == "" {
		return report, fmt.Errorf("legacy credentials not verified")
	}
	report.OwnerID = user.ID
	hash, err := security.HashPassword(password)
	if err != nil {
		return report, err
	}
	user.PasswordHash = hash
	if user.CreatedAt == "" {
		user.CreatedAt = nowRFC3339()
	}
	source := "legacy:" + security.TokenHash(filepath.Clean(directory))
	digest := security.TokenHash(digestInput)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return report, err
	}
	defer tx.Rollback()
	var existingID, existingEmail, existingHash string
	err = tx.QueryRow(`SELECT id,email,password_hash FROM users WHERE email=? OR id=?`, user.Email, user.ID).Scan(&existingID, &existingEmail, &existingHash)
	if err == nil {
		valid, _ := security.VerifyPassword(existingHash, password)
		if existingID != user.ID || existingEmail != user.Email || !valid {
			return report, fmt.Errorf("existing account ownership does not match")
		}
	} else if err == sql.ErrNoRows {
		_, err = tx.Exec(`INSERT INTO users(id,email,password_hash,display_name,created_at) VALUES(?,?,?,?,?)`, user.ID, user.Email, user.PasswordHash, user.DisplayName, user.CreatedAt)
	}
	if err != nil {
		return report, err
	}
	var prior string
	err = tx.QueryRow(`SELECT digest FROM security_imports WHERE owner_id=? AND source_id=?`, user.ID, source).Scan(&prior)
	if err == nil {
		if prior != digest {
			return report, fmt.Errorf("legacy source changed after migration")
		}
		report.AlreadyImported = true
		report.RotationRequired = true
		return report, nil
	}
	if err != sql.ErrNoRows {
		return report, err
	}
	report.BackupDirectory = filepath.Join(directory, "pre-sqlite-backup")
	if err = os.MkdirAll(report.BackupDirectory, 0700); err != nil {
		return report, err
	}
	for name, b := range files {
		path := filepath.Join(report.BackupDirectory, name)
		f, e := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if os.IsExist(e) {
			old, re := os.ReadFile(path)
			if re != nil || security.TokenHash(string(old)) != security.TokenHash(string(b)) {
				return report, fmt.Errorf("legacy backup verification failed")
			}
			continue
		}
		if e != nil {
			return report, e
		}
		_, e = f.Write(b)
		if e == nil {
			e = f.Sync()
		}
		ce := f.Close()
		if e != nil {
			return report, e
		}
		if ce != nil {
			return report, ce
		}
		copied, e := os.ReadFile(path)
		if e != nil || security.TokenHash(string(copied)) != security.TokenHash(string(b)) {
			return report, fmt.Errorf("legacy backup verification failed")
		}
	}
	kinds := map[string]string{"profiles.json": "profile", "providers.json": "provider", "api_usage_logs.json": "usage", "mcp_servers.json": "mcp", "documents.json": "document"}
	for _, name := range names {
		kind, ok := kinds[name]
		if !ok {
			continue
		}
		b, ok := files[name]
		if !ok {
			continue
		}
		var rows []json.RawMessage
		if err = json.Unmarshal(b, &rows); err != nil {
			return report, fmt.Errorf("invalid legacy rows in %s", name)
		}
		for _, raw := range rows {
			var identity struct {
				ID      string `json:"id"`
				UserID  string `json:"user_id"`
				OwnerID string `json:"owner_id"`
			}
			if json.Unmarshal(raw, &identity) != nil {
				return report, fmt.Errorf("invalid row")
			}
			owner := identity.UserID
			if owner == "" {
				owner = identity.OwnerID
			}
			if owner != user.ID || (identity.OwnerID != "" && identity.OwnerID != user.ID) {
				report.SkippedUnowned++
				continue
			}
			id := identity.ID
			if kind == "profile" {
				id = "profile"
			}
			if id == "" {
				return report, fmt.Errorf("legacy resource ID required")
			}
			var payload any
			var encrypted []byte
			switch kind {
			case "provider":
				var p providerRecord
				if err = json.Unmarshal(raw, &p); err != nil {
					return report, err
				}
				if assertPublicURL(p.BaseURL) != nil || strings.ContainsAny(p.APIKey, "\r\n") {
					return report, fmt.Errorf("invalid legacy provider")
				}
				encrypted, err = s.protect(owner, "provider:"+id, []byte(p.APIKey))
				if err != nil {
					return report, err
				}
				p.HasKey = p.APIKey != ""
				report.RotationRequired = report.RotationRequired || p.HasKey
				p.APIKey = ""
				payload = p
			case "mcp":
				var m localMcpServer
				if err = json.Unmarshal(raw, &m); err != nil {
					return report, err
				}
				if assertPublicURL(m.URL) != nil || !validMcpHeaders(m.Headers) {
					return report, fmt.Errorf("invalid legacy MCP configuration")
				}
				secret, _ := json.Marshal(m.Headers)
				encrypted, err = s.protect(owner, "mcp:"+id, secret)
				if err != nil {
					return report, err
				}
				m.HasHeaders = len(m.Headers) > 0
				report.RotationRequired = report.RotationRequired || m.HasHeaders
				m.Headers = map[string]string{}
				payload = m
			default:
				var v map[string]any
				if err = json.Unmarshal(raw, &v); err != nil {
					return report, err
				}
				delete(v, "owner_id")
				if kind != "profile" {
					delete(v, "user_id")
				}
				payload = v
			}
			var count int
			if err = tx.QueryRow(`SELECT count(*) FROM security_resources WHERE owner_id=? AND kind=? AND id=?`, owner, kind, id).Scan(&count); err != nil {
				return report, err
			}
			if count > 0 {
				return report, fmt.Errorf("legacy resource conflicts with account data")
			}
			if err = putResource(ctx, tx, owner, kind, id, payload, encrypted); err != nil {
				return report, err
			}
			report.Imported++
		}
	}
	if b, ok := files["provider_model_prefs.json"]; ok {
		var wrapper struct {
			OwnerID string                        `json:"owner_id"`
			UserID  string                        `json:"user_id"`
			Data    map[string]providerModelPrefs `json:"data"`
		}
		if err = json.Unmarshal(b, &wrapper); err != nil {
			return report, fmt.Errorf("invalid legacy model preferences")
		}
		owner := wrapper.OwnerID
		if owner == "" {
			owner = wrapper.UserID
		}
		if owner == user.ID && (wrapper.UserID == "" || wrapper.UserID == user.ID) && wrapper.Data != nil {
			for id := range wrapper.Data {
				if id == "local" {
					continue
				}
				var count int
				if err = tx.QueryRow(`SELECT count(*) FROM security_resources WHERE owner_id=? AND kind='provider' AND id=?`, owner, id).Scan(&count); err != nil {
					return report, err
				}
				if count != 1 {
					return report, fmt.Errorf("owned provider required for legacy preferences")
				}
			}
			var count int
			if err = tx.QueryRow(`SELECT count(*) FROM security_resources WHERE owner_id=? AND kind='provider-prefs' AND id='state'`, owner).Scan(&count); err != nil {
				return report, err
			}
			if count > 0 {
				return report, fmt.Errorf("legacy preferences conflict with account data")
			}
			if err = putResource(ctx, tx, owner, "provider-prefs", "state", wrapper.Data, nil); err != nil {
				return report, err
			}
			report.Imported++
		} else {
			report.SkippedUnowned++
		}
	}
	for _, name := range []string{"api_keys.json", "auth_sessions.json"} {
		if b, ok := files[name]; ok {
			report.RotationRequired = report.RotationRequired || name != "provider_model_prefs.json"
			var rows []json.RawMessage
			if json.Unmarshal(b, &rows) == nil {
				report.SkippedUnowned += len(rows)
			} else {
				report.SkippedUnowned++
			}
		}
	}
	if _, err = tx.Exec(`UPDATE security_sessions SET revoked=1 WHERE owner_id=?`, user.ID); err != nil {
		return report, err
	}
	if _, err = tx.Exec(`INSERT INTO security_imports(owner_id,source_id,digest,created_at) VALUES(?,?,?,?)`, user.ID, source, digest, nowRFC3339()); err != nil {
		return report, err
	}
	if err = tx.Commit(); err != nil {
		return report, err
	}
	return report, nil
}
