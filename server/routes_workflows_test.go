package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"ai-server-studio-backend/workflow"
)

func TestWorkflowRoutesAreAuthenticatedOwnerScopedAndDurable(t *testing.T) {
	s, _ := testAgentServer(t)
	if _, err := s.db.Exec(`INSERT INTO users(id,email,password_hash,display_name,created_at) VALUES('other-owner','other@example.test','fixture','Other',?)`, nowRFC3339()); err != nil {
		t.Fatal(err)
	}

	definitionRequest := `{"name":"demo","graph":{"steps":[{"id":"finish","dependencies":["start"],"input":{"prompt":"finish"}},{"id":"start","input":{"prompt":"start"}}]}}`
	response := s.authMiddleware(s.mux).ServeHTTP
	req := agentRequest(t, s, http.MethodPost, "/v1/workflows", strings.NewReader(definitionRequest))
	w := httptest.NewRecorder()
	response(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("create definition: %d %s", w.Code, w.Body.String())
	}
	var definition struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &definition); err != nil || definition.ID == "" {
		t.Fatalf("definition response: %s %v", w.Body.String(), err)
	}

	otherToken, err := s.makeSession("other-owner")
	if err != nil {
		t.Fatal(err)
	}
	otherRequest, err := http.NewRequest(http.MethodGet, "/v1/workflows/"+definition.ID, nil)
	if err != nil {
		t.Fatal(err)
	}
	otherRequest.Header.Set("Authorization", "Bearer "+otherToken)
	w = httptest.NewRecorder()
	response(w, otherRequest)
	if w.Code != http.StatusNotFound {
		t.Fatalf("cross-owner definition read: %d %s", w.Code, w.Body.String())
	}

	versionRequest := agentRequest(t, s, http.MethodPost, "/v1/workflows/"+definition.ID+"/versions", strings.NewReader(`{"graph":{"steps":[{"id":"only"}]}}`))
	w = httptest.NewRecorder()
	response(w, versionRequest)
	if w.Code != http.StatusCreated {
		t.Fatalf("create version: %d %s", w.Code, w.Body.String())
	}

	runRequest := agentRequest(t, s, http.MethodPost, "/v1/workflows/"+definition.ID+"/runs", strings.NewReader(`{"input":{"request":true}}`))
	w = httptest.NewRecorder()
	response(w, runRequest)
	if w.Code != http.StatusCreated {
		t.Fatalf("create run: %d %s", w.Code, w.Body.String())
	}
	var run struct {
		ID       string `json:"id"`
		Revision uint64 `json:"revision"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &run); err != nil || run.ID == "" || run.Revision != 1 {
		t.Fatalf("run response: %s %v", w.Body.String(), err)
	}

	transition := agentRequest(t, s, http.MethodPost, "/v1/workflow-runs/"+run.ID+"/transition", strings.NewReader(`{"expectedRevision":1,"to":"validating"}`))
	w = httptest.NewRecorder()
	response(w, transition)
	if w.Code != http.StatusNotFound && w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("client transition endpoint is still exposed: %d %s", w.Code, w.Body.String())
	}
	stale := agentRequest(t, s, http.MethodPost, "/v1/workflow-runs/"+run.ID+"/transition", strings.NewReader(`{"expectedRevision":1,"to":"succeeded","eventType":"client.injected","data":{"unsafe":true}}`))
	w = httptest.NewRecorder()
	response(w, stale)
	if w.Code != http.StatusNotFound && w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("client completion/event injection endpoint is still exposed: %d %s", w.Code, w.Body.String())
	}

	events := agentRequest(t, s, http.MethodGet, "/v1/workflow-runs/"+run.ID+"/events?after=0", nil)
	w = httptest.NewRecorder()
	response(w, events)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"sequence":1`) || strings.Contains(w.Body.String(), `"sequence":2`) {
		t.Fatalf("events: %d %s", w.Code, w.Body.String())
	}
	runAfterAttempt, err := s.workflows.GetRun("test-owner", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if runAfterAttempt.Status != workflow.RunQueued || runAfterAttempt.Revision != 1 {
		t.Fatalf("client transition mutated run: %+v", runAfterAttempt)
	}

	unauthenticated := httptest.NewRequest(http.MethodGet, "/v1/workflows", nil)
	w = httptest.NewRecorder()
	response(w, unauthenticated)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated list: %d %s", w.Code, w.Body.String())
	}

}
