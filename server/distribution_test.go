package server

import (
	"context"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	frontend "ai-server-studio-backend"
	"ai-server-studio-backend/engine"
)

type distributionTestEngine struct{ engine.EngineInterface }

func (*distributionTestEngine) StopGenerating() {}
func (*distributionTestEngine) Shutdown()       {}

func newDistributionServer(t *testing.T) *Server {
	t.Helper()
	t.Setenv("AI_SERVER_DATA_DIR", t.TempDir())
	frontend := t.TempDir()
	if err := os.WriteFile(filepath.Join(frontend, "index.html"), []byte("<html>spa</html>"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(frontend, "assets"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(frontend, "assets", "app.js"), []byte("console.log('ok')"), 0o600); err != nil {
		t.Fatal(err)
	}
	s := NewWithBaseDirAndFrontend(&distributionTestEngine{}, 0, t.TempDir(), frontend)
	if s.dbErr != nil {
		t.Fatalf("server initialization: %v", s.dbErr)
	}
	t.Cleanup(func() { _ = s.Shutdown(context.Background()) })
	return s
}

func TestExternalProductionFrontendSPAFallbackAndAsset404(t *testing.T) {
	s := newDistributionServer(t)
	cases := []struct {
		name   string
		path   string
		status int
		body   string
	}{
		{name: "root", path: "/", status: http.StatusOK, body: "<html>spa</html>"},
		{name: "route", path: "/workflows/example", status: http.StatusOK, body: "<html>spa</html>"},
		{name: "asset", path: "/assets/app.js", status: http.StatusOK, body: "console.log('ok')"},
		{name: "missing asset", path: "/assets/missing.js", status: http.StatusNotFound},
		{name: "missing extension", path: "/styles/missing.css", status: http.StatusNotFound},
		{name: "unknown API", path: "/v1/does-not-exist", status: http.StatusNotFound},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			s.mux.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, tc.path, nil))
			if recorder.Code != tc.status {
				t.Fatalf("status = %d, want %d; body=%q", recorder.Code, tc.status, recorder.Body.String())
			}
			if tc.body != "" && recorder.Body.String() != tc.body {
				t.Fatalf("body = %q, want %q", recorder.Body.String(), tc.body)
			}
		})
	}
}

func TestExternalProductionFrontendLoadsWithoutAuthentication(t *testing.T) {
	s := newDistributionServer(t)
	recorder := httptest.NewRecorder()
	s.authMiddleware(s.mux).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/", nil))
	if recorder.Code != http.StatusOK || recorder.Body.String() != "<html>spa</html>" {
		t.Fatalf("unauthenticated frontend response = %d %q", recorder.Code, recorder.Body.String())
	}
}

func TestHeadlessServerDoesNotServeFrontendRoutes(t *testing.T) {
	t.Setenv("AI_SERVER_DATA_DIR", t.TempDir())
	s := NewWithBaseDirAndFrontendMode(&distributionTestEngine{}, 0, t.TempDir(), t.TempDir(), false)
	if s.dbErr != nil {
		t.Fatalf("server initialization: %v", s.dbErr)
	}
	t.Cleanup(func() { _ = s.Shutdown(context.Background()) })
	recorder := httptest.NewRecorder()
	s.mux.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/", nil))
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("headless frontend response = %d %q, want 404", recorder.Code, recorder.Body.String())
	}
}

func TestEmbeddedFrontendServesWhenNoExternalBundleIsConfigured(t *testing.T) {
	files, err := frontend.Files()
	if err != nil {
		t.Fatalf("embedded frontend unavailable: %v", err)
	}
	var knownAsset string
	if err := fs.WalkDir(files, ".", func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if !entry.IsDir() && strings.HasPrefix(path, "assets/") && strings.HasSuffix(path, ".js") && knownAsset == "" {
			knownAsset = path
		}
		return nil
	}); err != nil {
		t.Fatalf("walk embedded frontend: %v", err)
	}
	if knownAsset == "" {
		t.Fatal("embedded frontend has no JavaScript asset to verify")
	}
	t.Setenv("AI_SERVER_DATA_DIR", t.TempDir())
	s := NewWithBaseDirAndFrontend(&distributionTestEngine{}, 0, t.TempDir(), filepath.Join(t.TempDir(), "missing-frontend"))
	if s.dbErr != nil {
		t.Fatalf("server initialization: %v", s.dbErr)
	}
	t.Cleanup(func() { _ = s.Shutdown(context.Background()) })
	cases := []struct {
		name   string
		path   string
		status int
		body   string
	}{
		{name: "root", path: "/", status: http.StatusOK, body: "AI Server Studio"},
		{name: "spa route", path: "/workflows/example", status: http.StatusOK, body: "AI Server Studio"},
		{name: "known asset", path: "/" + knownAsset, status: http.StatusOK},
		{name: "missing asset", path: "/assets/missing-from-embedded.js", status: http.StatusNotFound},
		{name: "api separation", path: "/v1/does-not-exist", status: http.StatusNotFound},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			s.mux.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, tc.path, nil))
			if recorder.Code != tc.status {
				t.Fatalf("status = %d, want %d; body=%q", recorder.Code, tc.status, recorder.Body.String())
			}
			if tc.body != "" && !strings.Contains(recorder.Body.String(), tc.body) {
				t.Fatalf("body = %q, want it to contain %q", recorder.Body.String(), tc.body)
			}
		})
	}
}

func TestEmptyFrontendOverrideDoesNotPreferAdjacentFilesystemBundle(t *testing.T) {
	files, err := frontend.Files()
	if err != nil {
		t.Fatalf("embedded frontend unavailable: %v", err)
	}
	baseDir := t.TempDir()
	if err := os.Mkdir(filepath.Join(baseDir, "frontend"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(baseDir, "frontend", "index.html"), []byte("external bundle"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("AI_SERVER_DATA_DIR", t.TempDir())
	s := NewWithBaseDirAndFrontend(&distributionTestEngine{}, 0, baseDir, "")
	if s.dbErr != nil {
		t.Fatalf("server initialization: %v", s.dbErr)
	}
	t.Cleanup(func() { _ = s.Shutdown(context.Background()) })
	recorder := httptest.NewRecorder()
	s.mux.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("embedded frontend response = %d", recorder.Code)
	}
	if recorder.Body.String() == "external bundle" {
		t.Fatal("empty frontend override selected the adjacent filesystem bundle")
	}
	if _, err := fs.Stat(files, "index.html"); err != nil {
		t.Fatalf("embedded frontend index missing: %v", err)
	}
}

func TestServerReadinessAndActualPort(t *testing.T) {
	s := newDistributionServer(t)
	if err := s.Listen(); err != nil {
		t.Fatal(err)
	}
	select {
	case <-s.Ready():
	case <-time.After(time.Second):
		t.Fatal("server did not report readiness")
	}
	actualPort := s.ActualPort()
	if actualPort == 0 {
		t.Fatal("server did not expose an actual port")
	}
	if !strings.HasSuffix(s.ActualURL(), ":"+strconv.Itoa(actualPort)) {
		t.Fatalf("actual URL %q does not contain port %d", s.ActualURL(), actualPort)
	}
	conn, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(actualPort)), time.Second)
	if err != nil {
		t.Fatalf("bound listener is not reachable: %v", err)
	}
	_ = conn.Close()

	serveDone := make(chan error, 1)
	go func() { serveDone <- s.Serve() }()
	response, err := http.Get(s.ActualURL() + "/v1/unknown")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, response.Body)
	_ = response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("served status = %d, want %d", response.StatusCode, http.StatusUnauthorized)
	}
	if err := s.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
	select {
	case <-serveDone:
	case <-time.After(time.Second):
		t.Fatal("server did not stop after shutdown")
	}
}
