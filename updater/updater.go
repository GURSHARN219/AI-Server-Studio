// Package updater contains the deliberately small, source-agnostic update
// boundary for the portable executable. It validates and stages artifacts but
// never replaces a running executable; Windows replacement must be coordinated
// by the host process before a future release enables promotion.
package updater

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const DefaultMaxArtifactBytes int64 = 4 * 1024 * 1024 * 1024

var (
	ErrNotConfigured    = errors.New("application update source is not configured")
	ErrUpdateValidation = errors.New("invalid application update")
)

type Config struct {
	CurrentVersion string
	ManifestURL    string
	StageRoot      string
	AllowedHosts   []string
	MaxBytes       int64
	HTTPClient     *http.Client
}

type Manifest struct {
	Version   string `json:"version"`
	Artifact  string `json:"artifact"`
	SHA256    string `json:"sha256"`
	Signature string `json:"signature,omitempty"`
}

type Status struct {
	State            string `json:"state"`
	Configured       bool   `json:"configured"`
	CurrentVersion   string `json:"current_version"`
	AvailableVersion string `json:"available_version,omitempty"`
	Artifact         string `json:"artifact,omitempty"`
	Error            string `json:"error,omitempty"`
}

type Manager struct{ config Config }

func New(config Config) *Manager {
	if config.MaxBytes <= 0 {
		config.MaxBytes = DefaultMaxArtifactBytes
	}
	if len(config.AllowedHosts) == 0 {
		config.AllowedHosts = []string{"github.com", "objects.githubusercontent.com"}
	}
	return &Manager{config: config}
}

func (m *Manager) Check(ctx context.Context) (Status, error) {
	status := Status{State: "unavailable", CurrentVersion: m.config.CurrentVersion}
	if strings.TrimSpace(m.config.ManifestURL) == "" {
		status.Error = ErrNotConfigured.Error()
		return status, ErrNotConfigured
	}
	manifestURL, err := validateURL(m.config.ManifestURL, m.config.AllowedHosts)
	if err != nil {
		status.State, status.Error = "error", err.Error()
		return status, err
	}
	client := m.config.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, manifestURL.String(), nil)
	if err != nil {
		status.State, status.Error = "error", err.Error()
		return status, err
	}
	resp, err := client.Do(req)
	if err != nil {
		status.State, status.Error = "error", err.Error()
		return status, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		err = fmt.Errorf("update manifest returned HTTP %d", resp.StatusCode)
		status.State, status.Error = "error", err.Error()
		return status, err
	}
	var manifest Manifest
	if err = json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&manifest); err != nil {
		status.State, status.Error = "error", err.Error()
		return status, err
	}
	if err = validateManifest(manifest); err != nil {
		status.State, status.Error = "error", err.Error()
		return status, err
	}
	status.AvailableVersion, status.Artifact = manifest.Version, manifest.Artifact
	status.State = "available"
	if manifest.Version == m.config.CurrentVersion {
		status.State = "current"
	}
	return status, nil
}

func (m *Manager) Stage(ctx context.Context, manifest Manifest) (string, error) {
	if err := validateManifest(manifest); err != nil {
		return "", err
	}
	if strings.TrimSpace(m.config.StageRoot) == "" {
		return "", fmt.Errorf("%w: staging directory is not configured", ErrUpdateValidation)
	}
	artifactURL, err := validateURL(manifest.Artifact, m.config.AllowedHosts)
	if err != nil {
		return "", err
	}
	if err = os.MkdirAll(m.config.StageRoot, 0700); err != nil {
		return "", fmt.Errorf("create update staging directory: %w", err)
	}
	stage, err := os.CreateTemp(m.config.StageRoot, ".update-*.part")
	if err != nil {
		return "", err
	}
	stagePath := stage.Name()
	defer func() { _ = stage.Close(); _ = os.Remove(stagePath) }()
	client := m.config.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 2 * time.Hour}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, artifactURL.String(), nil)
	if err != nil {
		return "", err
	}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("update artifact returned HTTP %d", resp.StatusCode)
	}
	if resp.ContentLength > m.config.MaxBytes {
		return "", fmt.Errorf("%w: artifact exceeds configured size limit", ErrUpdateValidation)
	}
	hash := sha256.New()
	limited := io.LimitReader(io.TeeReader(resp.Body, hash), m.config.MaxBytes+1)
	n, err := io.Copy(stage, limited)
	if err != nil {
		return "", err
	}
	if n > m.config.MaxBytes {
		return "", fmt.Errorf("%w: artifact exceeds configured size limit", ErrUpdateValidation)
	}
	if err = stage.Sync(); err != nil {
		return "", err
	}
	if err = stage.Close(); err != nil {
		return "", err
	}
	if actual := hex.EncodeToString(hash.Sum(nil)); !strings.EqualFold(actual, manifest.SHA256) {
		return "", fmt.Errorf("%w: SHA-256 mismatch", ErrUpdateValidation)
	}
	final := filepath.Join(m.config.StageRoot, "AI-Server-Studio-"+safeVersion(manifest.Version)+".staged")
	if err = os.Rename(stagePath, final); err != nil {
		return "", fmt.Errorf("publish staged update: %w", err)
	}
	return final, nil
}

func validateManifest(manifest Manifest) error {
	if strings.TrimSpace(manifest.Version) == "" || strings.TrimSpace(manifest.Artifact) == "" || len(manifest.SHA256) != 64 {
		return fmt.Errorf("%w: version, artifact and SHA-256 are required", ErrUpdateValidation)
	}
	if _, err := hex.DecodeString(manifest.SHA256); err != nil {
		return fmt.Errorf("%w: SHA-256 is invalid", ErrUpdateValidation)
	}
	if strings.TrimSpace(manifest.Signature) != "" {
		return fmt.Errorf("%w: signed updates require a configured signature verifier", ErrUpdateValidation)
	}
	return nil
}

func validateURL(raw string, allowed []string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.Fragment != "" {
		return nil, fmt.Errorf("%w: update URLs must be approved HTTPS URLs", ErrUpdateValidation)
	}
	host := strings.ToLower(u.Hostname())
	approved := false
	for _, candidate := range allowed {
		candidate = strings.ToLower(strings.TrimSpace(candidate))
		if candidate != "" && (host == candidate || strings.HasSuffix(host, "."+candidate)) {
			approved = true
			break
		}
	}
	if !approved {
		return nil, fmt.Errorf("%w: update source is not approved", ErrUpdateValidation)
	}
	if ip := net.ParseIP(host); ip != nil && (!ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsUnspecified()) {
		return nil, fmt.Errorf("%w: update source is not public", ErrUpdateValidation)
	}
	return u, nil
}

func safeVersion(version string) string {
	var b strings.Builder
	for _, r := range version {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '-' || r == '_' {
			b.WriteRune(r)
		}
	}
	if b.Len() == 0 {
		return "unknown"
	}
	return b.String()
}
