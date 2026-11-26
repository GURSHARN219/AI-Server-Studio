package server

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"ai-server-studio-backend/engine"
)

type lifecycleTestEngine struct{ engine.EngineInterface }

func (*lifecycleTestEngine) StopGenerating() {}
func (*lifecycleTestEngine) Shutdown()       {}
func (*lifecycleTestEngine) GetStatus() map[string]interface{} {
	return map[string]interface{}{"loaded": false, "model": "", "modelName": "", "backend": "lifecycle-test"}
}

// TestRouteRegistrationIsSingleShot proves the mux rejects a second
// registration pass. Server construction succeeded for every test in this
// package, so the constructor registered each route exactly once; any future
// double registration would panic here or at construction time.
func TestRouteRegistrationIsSingleShot(t *testing.T) {
	s := newDistributionServer(t)
	defer func() {
		if recover() == nil {
			t.Fatal("second route registration did not panic; the duplicate-registration guard is not active")
		}
	}()
	s.registerRoutes()
}

// TestListenTwiceKeepsSingleListener pins the one-listener-per-runtime rule:
// a repeated Listen must never bind a second listener or move the URL.
func TestListenTwiceKeepsSingleListener(t *testing.T) {
	s := newDistributionServer(t)
	if err := s.Listen(); err != nil {
		t.Fatal(err)
	}
	firstURL := s.ActualURL()
	firstPort := s.ActualPort()
	if err := s.Listen(); err != nil {
		t.Fatalf("repeated Listen returned an error: %v", err)
	}
	if s.ActualURL() != firstURL || s.ActualPort() != firstPort {
		t.Fatalf("repeated Listen rebound the listener: %s -> %s", firstURL, s.ActualURL())
	}
	conn, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(firstPort)), time.Second)
	if err != nil {
		t.Fatalf("original listener is no longer reachable: %v", err)
	}
	_ = conn.Close()
}

// TestListenAfterShutdownIsRejected keeps a closed runtime from being revived;
// a fresh runtime must be constructed instead of reusing closed resources.
func TestListenAfterShutdownIsRejected(t *testing.T) {
	s := newDistributionServer(t)
	if err := s.Listen(); err != nil {
		t.Fatal(err)
	}
	if err := s.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := s.Listen(); !errors.Is(err, http.ErrServerClosed) {
		t.Fatalf("Listen after Shutdown = %v, want http.ErrServerClosed", err)
	}
}

// TestShutdownIsIdempotentAndClosesListener verifies graceful shutdown is safe
// to invoke repeatedly and stops accepting connections after the first call.
func TestShutdownIsIdempotentAndClosesListener(t *testing.T) {
	s := newDistributionServer(t)
	if err := s.Listen(); err != nil {
		t.Fatal(err)
	}
	serveDone := make(chan error, 1)
	go func() { serveDone <- s.Serve() }()

	url := s.ActualURL()
	if err := s.Shutdown(context.Background()); err != nil {
		t.Fatalf("first shutdown: %v", err)
	}
	if err := s.Shutdown(context.Background()); err != nil {
		t.Fatalf("second shutdown must be idempotent: %v", err)
	}
	select {
	case err := <-serveDone:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			t.Fatalf("serve after shutdown: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("server did not stop after shutdown")
	}
	if _, err := net.DialTimeout("tcp", strings.TrimPrefix(url, "http://"), time.Second); err == nil {
		t.Fatal("listener still accepts connections after shutdown")
	}
}

// TestHealthReadinessAndAuthEnforcement covers the readiness contract: the
// listener reports Ready only after binding, /v1/system/status stays public
// for health checks, and every other API route still requires authentication.
func TestHealthReadinessAndAuthEnforcement(t *testing.T) {
	t.Setenv("AI_SERVER_DATA_DIR", t.TempDir())
	s := NewWithBaseDirAndFrontendMode(&lifecycleTestEngine{}, 0, t.TempDir(), "", false)
	if s.dbErr != nil {
		t.Fatalf("server initialization: %v", s.dbErr)
	}
	t.Cleanup(func() { _ = s.Shutdown(context.Background()) })
	if err := s.Listen(); err != nil {
		t.Fatal(err)
	}
	serveDone := make(chan error, 1)
	go func() { serveDone <- s.Serve() }()
	t.Cleanup(func() { _ = s.Shutdown(context.Background()) })

	select {
	case <-s.Ready():
	case <-time.After(time.Second):
		t.Fatal("ready channel was not closed after a successful Listen")
	}

	response, err := http.Get(s.ActualURL() + "/v1/system/status")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("public status endpoint = %d, want 200", response.StatusCode)
	}
	var status map[string]interface{}
	if json.Unmarshal(body, &status) != nil || status["backend"] != "lifecycle-test" {
		t.Fatalf("status body = %s, want the runtime engine status", body)
	}

	unauthorized := []string{"/v1/kb/documents", "/v1/models", "/v1/auth/session-unknown"}
	for _, path := range unauthorized {
		response, err := http.Get(s.ActualURL() + path)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.Copy(io.Discard, response.Body)
		_ = response.Body.Close()
		if response.StatusCode != http.StatusUnauthorized {
			t.Fatalf("%s without credentials = %d, want 401", path, response.StatusCode)
		}
	}

	request, _ := http.NewRequest(http.MethodGet, s.ActualURL()+"/v1/kb/documents", nil)
	request.Header.Set("Authorization", "Bearer not-a-real-session-token")
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, response.Body)
	_ = response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("invalid session token = %d, want 401", response.StatusCode)
	}
}

// TestGUIHandlerAndListenerObserveSharedState proves the desktop path (the
// handler mounted by the Wails asset server) and the external API path (the
// TCP listener) read and write the same owner-scoped persistent state.
func TestGUIHandlerAndListenerObserveSharedState(t *testing.T) {
	s := newDistributionServer(t)
	if _, err := s.db.Exec(`INSERT INTO users(id,email,password_hash,display_name,created_at) VALUES('shared-owner','shared@example.test','fixture','Shared',?)`, nowRFC3339()); err != nil {
		t.Fatal(err)
	}
	token, err := s.makeSession("shared-owner")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Listen(); err != nil {
		t.Fatal(err)
	}
	serveDone := make(chan error, 1)
	go func() { serveDone <- s.Serve() }()
	t.Cleanup(func() { _ = s.Shutdown(context.Background()) })

	// GUI path: the Wails asset server mounts this handler in-process.
	gui := s.Handler()
	create := httptest.NewRecorder()
	createRequest := httptest.NewRequest(http.MethodPost, "/v1/kb/documents", strings.NewReader(`{"title":"shared-doc","content":"visible to both transports"}`))
	createRequest.Header.Set("Authorization", "Bearer "+token)
	createRequest.Header.Set("Content-Type", "application/json")
	gui.ServeHTTP(create, createRequest)
	if create.Code != http.StatusOK {
		t.Fatalf("GUI document create = %d %s", create.Code, create.Body.String())
	}

	// External API path: the same state over the real listener with the same
	// session, without any second backend instance.
	request, _ := http.NewRequest(http.MethodGet, s.ActualURL()+"/v1/kb/documents", nil)
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("listener document list = %d %s", response.StatusCode, body)
	}
	var payload struct {
		Data []struct {
			Title string `json:"title"`
		} `json:"data"`
	}
	if json.Unmarshal(body, &payload) != nil || len(payload.Data) != 1 || payload.Data[0].Title != "shared-doc" {
		t.Fatalf("listener did not observe GUI-created state: %s", body)
	}
}

// TestPortConflictFailsStartupReleasingResources pins startup-failure
// propagation: a bind failure must surface as an error and leave the runtime
// safely shut-downable without a leaked listener.
func TestPortConflictFailsStartupReleasingResources(t *testing.T) {
	t.Setenv("AI_SERVER_DATA_DIR", t.TempDir())
	occupied, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer occupied.Close()
	port := occupied.Addr().(*net.TCPAddr).Port

	s := NewWithBaseDirAndFrontendMode(&lifecycleTestEngine{}, port, t.TempDir(), "", false)
	if s.dbErr != nil {
		t.Fatalf("server initialization: %v", s.dbErr)
	}
	if err := s.Listen(); err == nil {
		t.Fatal("Listen succeeded on an occupied port")
	}
	if s.ActualPort() != 0 {
		t.Fatalf("failed startup reported an actual port %d", s.ActualPort())
	}
	if err := s.Shutdown(context.Background()); err != nil {
		t.Fatalf("shutdown after failed startup: %v", err)
	}
}
