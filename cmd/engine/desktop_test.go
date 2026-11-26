package main

import (
	frontend "ai-server-studio-backend"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/wailsapp/wails/v2/pkg/options"
)

func TestDesktopAssetHandlerFallsBackToSPAAndPreservesAPI(t *testing.T) {
	assets := fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<html>app</html>")}}
	api := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
		_, _ = w.Write([]byte("api"))
	})
	handler := desktopAssetHandler(assets, api)

	spa := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/settings", nil)
	request.Header.Set("Accept", "text/html")
	handler.ServeHTTP(spa, request)
	if spa.Code != http.StatusOK || spa.Body.String() != "<html>app</html>" {
		t.Fatalf("SPA fallback = %d %q", spa.Code, spa.Body.String())
	}

	apiResponse := httptest.NewRecorder()
	handler.ServeHTTP(apiResponse, httptest.NewRequest(http.MethodGet, "/v1/models", nil))
	if apiResponse.Code != http.StatusTeapot || apiResponse.Body.String() != "api" {
		t.Fatalf("API response = %d %q", apiResponse.Code, apiResponse.Body.String())
	}
}

func TestDesktopAppStartsFramelessAndMaximised(t *testing.T) {
	app := desktopAppOptions(fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<html>app</html>")}}, http.NotFoundHandler(), "http://127.0.0.1:1234", func() error { return nil })
	if !app.Frameless {
		t.Fatal("desktop app must use the custom frameless title bar")
	}
	if app.WindowStartState != options.Maximised {
		t.Fatalf("window start state = %d, want maximised", app.WindowStartState)
	}
	if app.CSSDragProperty != "--wails-draggable" || app.CSSDragValue != "drag" {
		t.Fatalf("unexpected Wails drag configuration: %q=%q", app.CSSDragProperty, app.CSSDragValue)
	}
}

func TestEmbeddedFrontendContainsReferencedProductionAssets(t *testing.T) {
	assets, err := frontend.Files()
	if err != nil {
		t.Fatal(err)
	}
	index, err := fs.ReadFile(assets, "index.html")
	if err != nil {
		t.Fatal(err)
	}
	for _, match := range regexp.MustCompile(`(?:src|href)="(\.?/assets/[^"?]+)`).FindAllStringSubmatch(string(index), -1) {
		assetPath := strings.TrimPrefix(match[1], "./")
		if _, err := fs.Stat(assets, assetPath); err != nil {
			t.Fatalf("embedded index references missing asset %q: %v", assetPath, err)
		}
	}
	for _, name := range []string{"favicon.ico", "logo.png"} {
		if _, err := fs.Stat(assets, name); err != nil {
			t.Fatalf("embedded frontend missing public asset %q: %v", name, err)
		}
	}
}
