package server

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"ai-server-studio-backend/agentrun"
	"ai-server-studio-backend/engine"
)

type agentTestEngine struct {
	engine.EngineInterface
	stops   atomic.Int32
	calls   atomic.Int32
	blocked chan struct{}
	started chan struct{}
}

func (e *agentTestEngine) StopGenerating()      { e.stops.Add(1) }
func (e *agentTestEngine) Shutdown()            {}
func (e *agentTestEngine) GetModelName() string { return "test-model" }
func (e *agentTestEngine) IsModelLoaded() bool  { return true }
func (e *agentTestEngine) ChatCompletion([]byte) (*http.Response, error) {
	if e.started != nil {
		e.started <- struct{}{}
	}
	if e.blocked != nil {
		<-e.blocked
	}
	content := "final answer"
	if e.calls.Add(1) == 1 {
		content = `{"steps":[{"id":"step-1","description":"do work"}]}`
	}
	data, _ := json.Marshal(map[string]interface{}{"choices": []interface{}{map[string]interface{}{"message": map[string]interface{}{"content": content}}}})
	return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(string(data)))}, nil
}

func testAgentServer(t *testing.T) (*Server, *agentTestEngine) {
	t.Helper()
	t.Setenv("AI_SERVER_DATA_DIR", t.TempDir())
	eng := &agentTestEngine{}
	s := NewWithBaseDir(eng, 0, "")
	if s.dbErr != nil || s.agentRunsErr != nil {
		t.Fatalf("initialization: %v, %v", s.dbErr, s.agentRunsErr)
	}
	installAgentTestOwner(t, s)
	t.Cleanup(func() { s.Shutdown(context.Background()) })
	return s, eng
}

func installAgentTestOwner(t *testing.T, s *Server) {
	t.Helper()
	if _, err := s.db.Exec(`INSERT INTO users(id,email,password_hash,display_name,created_at) VALUES('test-owner','agent@example.test','fixture','Test',?)`, nowRFC3339()); err != nil {
		t.Fatal(err)
	}
}

func agentRequest(t *testing.T, s *Server, method, url string, body io.Reader) *http.Request {
	t.Helper()
	token, err := s.makeSession("test-owner")
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	return req
}

func TestAgentRunReplayCursorsAndLargeHistory(t *testing.T) {
	s, _ := testAgentServer(t)
	run, err := s.agentRuns.createWithMetadata("goal", "model", "test-owner", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 80; i++ {
		if err := run.record("step_observation", map[string]interface{}{"i": i}, nil); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := run.finish(agentrun.StatusDone, "", "answer", 1); err != nil {
		t.Fatal(err)
	}
	id := run.snapshot().ID
	for _, tc := range []struct {
		name, query, header string
		first, count        int
	}{
		{"legacy-full-replay", "", "", 1, 81},
		{"cursor", "?cursor=79", "", 80, 2},
		{"last-event-id", "", "80", 81, 1},
		{"header-precedence", "?cursor=1", "80", 81, 1},
		{"already-consumed", "?cursor=81", "", 0, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := agentRequest(t, s, "GET", "/v1/agent/runs/"+id+"/events"+tc.query, nil)
			req.Header.Set("Last-Event-ID", tc.header)
			w := httptest.NewRecorder()
			s.mux.ServeHTTP(w, req)
			if w.Code != 200 || w.Header().Get("Content-Type") != "text/event-stream" {
				t.Fatalf("response: %d %s", w.Code, w.Body.String())
			}
			var events []agentrun.RunEvent
			var ids []uint64
			scanner := bufio.NewScanner(w.Body)
			for scanner.Scan() {
				line := scanner.Text()
				if strings.HasPrefix(line, "id: ") {
					id, err := strconv.ParseUint(strings.TrimPrefix(line, "id: "), 10, 64)
					if err != nil {
						t.Fatal(err)
					}
					ids = append(ids, id)
				}
				if strings.HasPrefix(line, "data: ") {
					var event agentrun.RunEvent
					if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &event); err != nil {
						t.Fatal(err)
					}
					events = append(events, event)
				}
			}
			if err := scanner.Err(); err != nil {
				t.Fatal(err)
			}
			if len(events) != tc.count || len(ids) != tc.count {
				t.Fatalf("replay count: events %d ids %d", len(events), len(ids))
			}
			for i, event := range events {
				if event.Sequence != uint64(tc.first+i) || ids[i] != event.Sequence {
					t.Fatalf("replay order: %+v", event)
				}
			}
			if len(events) > 0 && events[len(events)-1].Type != "agent_done" {
				t.Fatal("terminal event was lost")
			}
		})
	}
	for _, cursor := range []string{"-1", "nope", "18446744073709551616"} {
		w := httptest.NewRecorder()
		s.mux.ServeHTTP(w, agentRequest(t, s, "GET", "/v1/agent/runs/"+id+"/events?cursor="+cursor, nil))
		if w.Code != 400 {
			t.Fatalf("invalid cursor accepted: %s", cursor)
		}
	}
}

func TestAgentRunLiveReplayDrainsCancellation(t *testing.T) {
	s, eng := testAgentServer(t)
	run, err := s.agentRuns.createWithMetadata("goal", "model", "test-owner", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := run.record("plan_created", nil, nil); err != nil {
		t.Fatal(err)
	}
	httpServer := httptest.NewServer(s.mux)
	defer httpServer.Close()
	client := &http.Client{Timeout: 5 * time.Second}
	url := httpServer.URL + "/v1/agent/runs/" + run.snapshot().ID
	resp, err := client.Do(agentRequest(t, s, "GET", url+"/events", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		if strings.HasPrefix(scanner.Text(), "data: ") {
			break
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		cancelResp, err := client.Do(agentRequest(t, s, "POST", url+"/cancel", nil))
		if err != nil {
			t.Fatal(err)
		}
		cancelResp.Body.Close()
		if cancelResp.StatusCode != 200 {
			t.Fatalf("cancel: %d", cancelResp.StatusCode)
		}
	}
	var last agentrun.RunEvent
	for scanner.Scan() {
		if strings.HasPrefix(scanner.Text(), "data: ") {
			if err := json.Unmarshal([]byte(strings.TrimPrefix(scanner.Text(), "data: ")), &last); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	if last.Sequence != 2 || last.Type != "agent_error" || last.Data["reason"] != "Canceled by user" {
		t.Fatalf("missing cancellation event: %+v", last)
	}
	if eng.stops.Load() != 1 || run.snapshot().Status != agentrun.StatusCanceled {
		t.Fatal("cancellation was not idempotent")
	}
	s.finishAgentRun(run, agentrun.StatusDone, "", "late answer", 1)
	if run.snapshot().Status != agentrun.StatusCanceled || len(run.snapshot().Events) != 2 {
		t.Fatal("completion overwrote cancellation")
	}
}

func TestAgentRunExecutionAndHistoryAcrossServerRestart(t *testing.T) {
	t.Setenv("AI_SERVER_DATA_DIR", t.TempDir())
	eng := &agentTestEngine{}
	s := NewWithBaseDir(eng, 0, "")
	if s.agentRunsErr != nil {
		t.Fatal(s.agentRunsErr)
	}
	installAgentTestOwner(t, s)
	t.Cleanup(func() { s.Shutdown(context.Background()) })
	w := httptest.NewRecorder()
	s.mux.ServeHTTP(w, agentRequest(t, s, "POST", "/v1/agent/runs", strings.NewReader(`{"goal":"test goal"}`)))
	if w.Code != 200 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	run, ok := s.agentRuns.get(created.ID)
	if !ok {
		t.Fatal("created run missing")
	}
	deadline := time.Now().Add(5 * time.Second)
	for !run.snapshot().Status.Terminal() && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	state := run.snapshot()
	if state.Status != agentrun.StatusDone || state.Result != "do work: final answer" || state.Iterations != 1 || len(state.Events) != 4 || state.Checkpoint.Boundary != "done" {
		t.Fatalf("execution changed: %+v", state)
	}
	if err := s.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
	restarted := NewWithBaseDir(eng, 0, "")
	t.Cleanup(func() { restarted.Shutdown(context.Background()) })
	if restarted.agentRunsErr != nil {
		t.Fatal(restarted.agentRunsErr)
	}
	w = httptest.NewRecorder()
	restarted.mux.ServeHTTP(w, agentRequest(t, restarted, "GET", "/v1/agent/runs/"+created.ID, nil))
	var loaded agentrun.Run
	if err := json.Unmarshal(w.Body.Bytes(), &loaded); err != nil {
		t.Fatal(err)
	}
	if loaded.Status != agentrun.StatusDone || loaded.Result != state.Result || len(loaded.Events) != 4 || loaded.Plan == nil {
		t.Fatalf("history not served after restart: %+v", loaded)
	}
}

func TestAgentRunCanceledWhilePlanningDoesNotExecuteSteps(t *testing.T) {
	s, eng := testAgentServer(t)
	eng.blocked = make(chan struct{})
	eng.started = make(chan struct{}, 1)
	run, err := s.agentRuns.createWithMetadata("goal", "model", "test-owner", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	finished := make(chan struct{})
	go func() { defer close(finished); s.executeAgentRun(run, agentRunCreateReq{}) }()
	select {
	case <-eng.started:
	case <-time.After(5 * time.Second):
		t.Fatal("planner did not start")
	}
	w := httptest.NewRecorder()
	s.mux.ServeHTTP(w, agentRequest(t, s, "POST", "/v1/agent/runs/"+run.snapshot().ID+"/cancel", nil))
	close(eng.blocked)
	select {
	case <-finished:
	case <-time.After(5 * time.Second):
		t.Fatal("executor did not exit")
	}
	state := run.snapshot()
	if w.Code != 200 || state.Status != agentrun.StatusCanceled || len(state.Events) != 1 || eng.calls.Load() != 1 {
		t.Fatalf("execution continued after cancel: %+v", state)
	}
}

func TestAgentRunCancellationPersistenceFailureAndTerminalNoOp(t *testing.T) {
	s, eng := testAgentServer(t)
	failing := &failingRunRepository{Repository: s.agentRuns.repo}
	store, err := newAgentRunStore(failing)
	if err != nil {
		t.Fatal(err)
	}
	s.agentRuns = store
	run, err := store.createWithMetadata("goal", "model", "test-owner", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	url := "/v1/agent/runs/" + run.snapshot().ID + "/cancel"
	failing.fail = true
	w := httptest.NewRecorder()
	s.mux.ServeHTTP(w, agentRequest(t, s, "POST", url, nil))
	if w.Code != 500 || eng.stops.Load() != 0 || run.snapshot().Status != agentrun.StatusRunning {
		t.Fatalf("failed cancellation changed execution: %d, %+v", w.Code, run.snapshot())
	}
	failing.fail = false
	if _, err := run.finish(agentrun.StatusDone, "", "answer", 1); err != nil {
		t.Fatal(err)
	}
	w = httptest.NewRecorder()
	s.mux.ServeHTTP(w, agentRequest(t, s, "POST", url, nil))
	if w.Code != 200 || eng.stops.Load() != 0 || run.snapshot().Status != agentrun.StatusDone || len(run.snapshot().Events) != 1 {
		t.Fatalf("terminal cancellation was not a no-op: %d, %+v", w.Code, run.snapshot())
	}
}

func TestAgentRunHandlersRequireAuthAndEnforceOwner(t *testing.T) {
	s, eng := testAgentServer(t)
	if _, err := s.db.Exec(`INSERT INTO users(id,email,password_hash,display_name,created_at) VALUES('other-owner','other@example.test','fixture','Other',?)`, nowRFC3339()); err != nil {
		t.Fatal(err)
	}
	run, err := s.agentRuns.createWithMetadata("private goal", "model", "test-owner", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	id := run.snapshot().ID
	otherToken, err := s.makeSession("other-owner")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct{ method, path string }{
		{"GET", "/v1/agent/runs/" + id},
		{"GET", "/v1/agent/runs/" + id + "/events"},
		{"POST", "/v1/agent/runs/" + id + "/cancel"},
	} {
		t.Run(tc.method+tc.path, func(t *testing.T) {
			for _, token := range []string{"", "invalid-token", otherToken} {
				req := httptest.NewRequest(tc.method, tc.path, nil)
				if token != "" {
					req.Header.Set("Authorization", "Bearer "+token)
				}
				w := httptest.NewRecorder()
				s.mux.ServeHTTP(w, req)
				want := http.StatusUnauthorized
				if token == otherToken {
					want = http.StatusNotFound
				}
				if w.Code != want || strings.Contains(w.Body.String(), "private goal") || w.Header().Get("Content-Type") == "text/event-stream" {
					t.Fatalf("owner isolation failed: %d %s", w.Code, w.Body.String())
				}
			}
		})
	}
	w := httptest.NewRecorder()
	s.mux.ServeHTTP(w, httptest.NewRequest("POST", "/v1/agent/runs", strings.NewReader(`{"goal":"unauthenticated","ownerId":"test-owner"}`)))
	if w.Code != 401 {
		t.Fatalf("unauthed creation: %d %s", w.Code, w.Body.String())
	}
	if eng.stops.Load() != 0 || run.snapshot().Status != agentrun.StatusRunning {
		t.Fatal("another owner changed execution")
	}
	// Ownership supplied by the client is ignored even when that user exists.
	w = httptest.NewRecorder()
	s.mux.ServeHTTP(w, agentRequest(t, s, "POST", "/v1/agent/runs", strings.NewReader(`{"goal":"safe goal","ownerId":"other-owner"}`)))
	if w.Code != 200 {
		t.Fatalf("owned creation: %d %s", w.Code, w.Body.String())
	}
	var created struct {
		ID string `json:"id"`
	}
	if err = json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	owned, ok := s.agentRuns.get(created.ID)
	if !ok || owned.snapshot().OwnerID != "test-owner" {
		t.Fatal("client forged run ownership")
	}
	// An authenticated gateway principal is also an identity source; routes do
	// not trust owner fields or require a second body/header identity.
	req := httptest.NewRequest("GET", "/v1/agent/runs/"+id, nil)
	req = req.WithContext(context.WithValue(req.Context(), principalContextKey{}, &principal{OwnerID: "test-owner", KeyID: "external-fixture"}))
	w = httptest.NewRecorder()
	s.mux.ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatalf("context principal not honored: %d %s", w.Code, w.Body.String())
	}
}

func TestServerShutdownDurablyTerminatesRunsAndRejectsNewWork(t *testing.T) {
	s, _ := testAgentServer(t)
	run, err := s.agentRuns.createWithMetadata("unfinished", "model", "test-owner", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	dataDir := s.resolveDataDir()
	if err = s.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err = s.Shutdown(context.Background()); err != nil {
		t.Fatal("shutdown not idempotent:", err)
	}
	state := run.snapshot()
	if state.Status != agentrun.StatusError || state.Error != "Server shut down before run completed" || len(state.Events) != 1 {
		t.Fatalf("shutdown did not terminate durable work: %+v", state)
	}
	if err = s.db.Ping(); err == nil {
		t.Fatal("database left open")
	}
	t.Setenv("AI_SERVER_DATA_DIR", dataDir)
	restarted := NewWithBaseDir(&agentTestEngine{}, 0, "")
	defer restarted.Shutdown(context.Background())
	if restarted.agentRunsErr != nil {
		t.Fatal(restarted.agentRunsErr)
	}
	loaded, ok := restarted.agentRuns.get(state.ID)
	if !ok || loaded.snapshot().Status != agentrun.StatusError || len(loaded.snapshot().Events) != 1 {
		t.Fatal("shutdown state was not durable")
	}
	// With an authenticated request already resolved, creation still refuses
	// a lifecycle that has started draining.
	restarted.lifecycleMu.Lock()
	restarted.closing = true
	restarted.lifecycleMu.Unlock()
	w := httptest.NewRecorder()
	restarted.mux.ServeHTTP(w, agentRequest(t, restarted, "POST", "/v1/agent/runs", strings.NewReader(`{"goal":"late"}`)))
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("work accepted during shutdown: %d %s", w.Code, w.Body.String())
	}
}

func TestServerLegacyRunImportNeverAssignsFirstRegistrant(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("AI_SERVER_DATA_DIR", dir)
	t.Setenv("AI_SERVER_AGENT_RUN_OWNER_MAP", "")
	t.Setenv("AI_SERVER_LEGACY_AGENT_RUN_DIR", "")
	legacy, err := agentrun.NewJSONRepository(filepath.Join(dir, "agent-runs"))
	if err != nil {
		t.Fatal(err)
	}
	state := agentrun.Run{ID: "run-legacy", Goal: "legacy goal", Status: agentrun.StatusDone, CreatedAt: 1, UpdatedAt: 2, CompletedAt: 2,
		Events:     []agentrun.RunEvent{{Sequence: 1, Type: "agent_done", Timestamp: 2}},
		Checkpoint: &agentrun.RunCheckpoint{Boundary: "done", EventSequence: 1, UpdatedAt: 2}}
	if err = legacy.Save(state); err != nil {
		t.Fatal(err)
	}
	first := NewWithBaseDir(&agentTestEngine{}, 0, "")
	if first.agentRunsErr != nil {
		t.Fatal(first.agentRunsErr)
	}
	installAgentTestOwner(t, first)
	if _, ok := first.agentRuns.get(state.ID); ok {
		t.Fatal("unowned legacy run assigned to first registrant")
	}
	if err = first.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
	second := NewWithBaseDir(&agentTestEngine{}, 0, "")
	if second.agentRunsErr != nil {
		t.Fatal(second.agentRunsErr)
	}
	if _, ok := second.agentRuns.get(state.ID); ok {
		t.Fatal("restart assigned unowned legacy run")
	}
	if err = second.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
	mapping := filepath.Join(dir, "owner-map.json")
	if err = os.WriteFile(mapping, []byte(`{"run-legacy":"test-owner"}`), 0600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("AI_SERVER_AGENT_RUN_OWNER_MAP", mapping)
	migrated := NewWithBaseDir(&agentTestEngine{}, 0, "")
	if migrated.agentRunsErr != nil {
		t.Fatal(migrated.agentRunsErr)
	}
	loaded, ok := migrated.agentRuns.get(state.ID)
	if !ok || loaded.snapshot().OwnerID != "test-owner" || len(loaded.snapshot().Events) != 1 {
		t.Fatal("explicit mapping did not import original history")
	}
	if err = migrated.Shutdown(context.Background()); err != nil {
		t.Fatal(err)
	}
	t.Setenv("AI_SERVER_AGENT_RUN_OWNER_MAP", "")
	restarted := NewWithBaseDir(&agentTestEngine{}, 0, "")
	defer restarted.Shutdown(context.Background())
	if restarted.agentRunsErr != nil {
		t.Fatal(restarted.agentRunsErr)
	}
	loaded, ok = restarted.agentRuns.get(state.ID)
	if !ok || len(loaded.snapshot().Events) != 1 {
		t.Fatal("idempotent restart changed imported history")
	}
	if _, err = os.Stat(filepath.Join(dir, "agent-runs", state.ID+".json")); err != nil {
		t.Fatal("legacy original removed")
	}
}
