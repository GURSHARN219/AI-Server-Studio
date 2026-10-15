package server

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestToolRegistryDiscoveryAndValidation(t *testing.T) {
	s := &Server{mux: http.NewServeMux()}
	s.registerToolRoutes()

	w := httptest.NewRecorder()
	s.mux.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/v1/tools", nil))
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), "web.search") {
		t.Fatalf("tool discovery response: %d %s", w.Code, w.Body.String())
	}

	w = httptest.NewRecorder()
	s.mux.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/v1/tools/execute", strings.NewReader(`{"tool":"not-registered","args":{}}`)))
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "unknown or disabled") {
		t.Fatalf("unknown tool was not rejected: %d %s", w.Code, w.Body.String())
	}
}
