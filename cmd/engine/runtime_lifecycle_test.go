package main

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"
)

// The runtime started by startBackend is the single application runtime shared
// by desktop and headless modes. These tests exercise it directly so duplicate
// initialization or listener leaks cannot regress unnoticed.

func TestStartBackendSharedRuntimeServesAndShutsDown(t *testing.T) {
	t.Setenv("AIST_PORTABLE_ROOT", t.TempDir())
	runtime, err := startBackend(cliOptions{port: 0, ctx: defaultCtx})
	if err != nil {
		t.Fatal(err)
	}
	port := runtime.srv.ActualPort()
	if port == 0 {
		t.Fatal("startBackend did not bind a listener")
	}
	if runtime.serverURL != runtime.srv.ActualURL() {
		t.Fatalf("runtime URL %q does not match the bound listener %q", runtime.serverURL, runtime.srv.ActualURL())
	}

	serveDone := make(chan error, 1)
	go func() { serveDone <- runtime.srv.Serve() }()

	// /v1/system/status is the public readiness endpoint on the same server
	// instance used by both modes.
	response, err := http.Get(runtime.serverURL + "/v1/system/status")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(response.Body)
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("readiness endpoint = %d %s", response.StatusCode, body)
	}
	var status struct {
		Loaded bool `json:"loaded"`
	}
	if json.Unmarshal(body, &status) != nil || status.Loaded {
		t.Fatalf("unexpected readiness body: %s", body)
	}

	// Shutdown must be graceful and safe to invoke repeatedly.
	if err := runtime.shutdown(); err != nil {
		t.Fatalf("first shutdown: %v", err)
	}
	if err := runtime.shutdown(); err != nil {
		t.Fatalf("second shutdown must be idempotent: %v", err)
	}
	select {
	case err := <-serveDone:
		if err != nil && !strings.Contains(err.Error(), "Server closed") {
			t.Fatalf("serve after shutdown: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("server did not stop after shutdown")
	}
	if conn, dialErr := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)), time.Second); dialErr == nil {
		_ = conn.Close()
		t.Fatal("listener still accepts connections after shutdown")
	}
}

func TestStartBackendPropagatesBindFailure(t *testing.T) {
	t.Setenv("AIST_PORTABLE_ROOT", t.TempDir())
	occupied, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer occupied.Close()
	options := cliOptions{port: occupied.Addr().(*net.TCPAddr).Port, ctx: defaultCtx}

	runtime, err := startBackend(options)
	if err == nil {
		_ = runtime.shutdown()
		t.Fatal("startBackend succeeded on an occupied port")
	}
	if !strings.Contains(err.Error(), "bind local API") {
		t.Fatalf("bind failure error = %v, want a bind-local-API failure", err)
	}
}

// TestHeadlessModeStringAndCLIRemainHeadless documents the mode selection that
// keeps --server away from Wails and browser startup.
func TestHeadlessModeStringAndCLIRemainHeadless(t *testing.T) {
	if mode := modeString(true, false, false); mode != "server" {
		t.Fatalf("--server mode string = %q, want \"server\"", mode)
	}
	if mode := modeString(false, false, false); mode != "desktop-auto" {
		t.Fatalf("default mode string = %q, want \"desktop-auto\"", mode)
	}
	options, err := parseCLI([]string{"--server", "--port", "0"})
	if err != nil {
		t.Fatal(err)
	}
	if !options.server {
		t.Fatal("--server did not select headless mode")
	}
}
