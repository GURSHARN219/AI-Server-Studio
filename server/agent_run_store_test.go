package server

import (
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"ai-server-studio-backend/agentrun"
	"ai-server-studio-backend/persistence"
)

func testRunStore(t *testing.T) (*agentRunStore, agentrun.Repository) {
	t.Helper()
	db, err := persistence.Open(filepath.Join(t.TempDir(), "test.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if _, err = db.Exec(`CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES('test-owner')`); err != nil {
		t.Fatal(err)
	}
	repo, err := agentrun.NewSQLiteRepository(db)
	if err != nil {
		t.Fatal(err)
	}
	store, err := newAgentRunStore(repo)
	if err != nil {
		t.Fatal(err)
	}
	return store, repo
}

func TestRunStoreStableIDConcurrentCreationReusesMemoryAndDurableRun(t *testing.T) {
	store, repo := testRunStore(t)
	const calls = 32
	runs := make(chan *agentRun, calls)
	errs := make(chan error, calls)
	var wg sync.WaitGroup
	for i := 0; i < calls; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			run, err := store.createWithID("run-stable", "goal", "model", "test-owner", "session", map[string]interface{}{"kind": "test"})
			if err != nil {
				errs <- err
				return
			}
			runs <- run
		}()
	}
	wg.Wait()
	close(runs)
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	if len(runs) != calls {
		t.Fatalf("successful creates: %d, want %d", len(runs), calls)
	}
	var first *agentRun
	for run := range runs {
		if first == nil {
			first = run
		} else if run != first {
			t.Fatal("stable-ID retry returned a different in-memory run")
		}
	}
	duplicate, err := store.createWithID("run-stable", "goal", "model", "test-owner", "session", map[string]interface{}{"kind": "test"})
	if err != nil || duplicate != first {
		t.Fatalf("duplicate creation did not reuse run: same=%t err=%v", duplicate == first, err)
	}
	state := first.snapshot()
	if state.ID != "run-stable" || state.Status != agentrun.StatusRunning || len(state.Events) != 0 {
		t.Fatalf("unexpected stable run: %+v", state)
	}
	onDisk, err := repo.List()
	if err != nil || len(onDisk) != 1 || onDisk[0].ID != state.ID || len(onDisk[0].Events) != 0 {
		t.Fatalf("duplicate durable run or event: %+v %v", onDisk, err)
	}
}

func TestRunStoreStableIDRejectsOwnerGoalAndModelConflicts(t *testing.T) {
	store, _ := testRunStore(t)
	if _, err := store.createWithID("run-conflict", "goal", "model", "test-owner", "session", map[string]interface{}{"mode": "offline"}); err != nil {
		t.Fatal(err)
	}
	for name, candidate := range map[string]struct {
		owner, goal, model, session string
		metadata                    map[string]interface{}
	}{
		"owner":    {owner: "other-owner", goal: "goal", model: "model", session: "session", metadata: map[string]interface{}{"mode": "offline"}},
		"goal":     {owner: "test-owner", goal: "different goal", model: "model", session: "session", metadata: map[string]interface{}{"mode": "offline"}},
		"model":    {owner: "test-owner", goal: "goal", model: "different model", session: "session", metadata: map[string]interface{}{"mode": "offline"}},
		"session":  {owner: "test-owner", goal: "goal", model: "model", session: "different", metadata: map[string]interface{}{"mode": "offline"}},
		"metadata": {owner: "test-owner", goal: "goal", model: "model", session: "session", metadata: map[string]interface{}{"mode": "online"}},
	} {
		_, err := store.createWithID("run-conflict", candidate.goal, candidate.model, candidate.owner, candidate.session, candidate.metadata)
		if !errors.Is(err, agentrun.ErrConflict) || !strings.Contains(err.Error(), name) {
			t.Fatalf("%s conflict was not clear: %v", name, err)
		}
	}
}

func TestRunConcurrentEventOrderingAndReload(t *testing.T) {
	store, repo := testRunStore(t)
	run, err := store.createWithMetadata("goal", "model", "test-owner", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	ch := run.subscribe()
	defer run.unsubscribe(ch)
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			if err := run.record("observation", map[string]interface{}{"i": i}, nil); err != nil {
				t.Error(err)
			}
		}(i)
	}
	wg.Wait()
	state := run.snapshot()
	if len(state.Events) != 100 {
		t.Fatalf("events: %d", len(state.Events))
	}
	for i, event := range state.Events {
		if event.Sequence != uint64(i+1) {
			t.Fatalf("out of order: %+v", event)
		}
	}
	// Coalesced notifications still expose the complete durable log.
	select {
	case <-ch:
	default:
		t.Fatal("missing notification")
	}
	events, terminal := run.eventsAfter(0)
	if terminal || len(events) != 100 {
		t.Fatalf("lost replay: %d, terminal %v", len(events), terminal)
	}
	if _, err := run.finish(agentrun.StatusDone, "", "answer", 1); err != nil {
		t.Fatal(err)
	}
	reloaded, err := newAgentRunStore(repo)
	if err != nil {
		t.Fatal(err)
	}
	loaded, ok := reloaded.get(state.ID)
	if !ok || loaded.snapshot().Status != agentrun.StatusDone || len(loaded.snapshot().Events) != 101 {
		t.Fatal("history not retained")
	}
}

func TestRunTerminalTransitionSingleWinner(t *testing.T) {
	store, repo := testRunStore(t)
	run, err := store.createWithMetadata("goal", "model", "test-owner", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	winners := 0
	for i := 0; i < 30; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			status := []agentrun.Status{agentrun.StatusDone, agentrun.StatusError, agentrun.StatusCanceled}[i%3]
			changed, err := run.finish(status, "reason", "answer", 1)
			if err != nil {
				t.Error(err)
			}
			if changed {
				mu.Lock()
				winners++
				mu.Unlock()
			}
		}(i)
	}
	wg.Wait()
	state := run.snapshot()
	if winners != 1 || !state.Status.Terminal() || len(state.Events) != 1 || state.CompletedAt == 0 {
		t.Fatalf("invalid terminal state: %+v, winners %d", state, winners)
	}
	if err := run.record("late", nil, nil); !errors.Is(err, errRunTerminal) {
		t.Fatalf("late event accepted: %v", err)
	}
	onDisk, err := repo.List()
	if err != nil || onDisk[0].Status != state.Status || len(onDisk[0].Events) != 1 {
		t.Fatalf("disk differs: %v", err)
	}
}

func TestRunRestartPreservesCheckpointAndMarksInterrupted(t *testing.T) {
	store, repo := testRunStore(t)
	run, err := store.createWithMetadata("goal", "model", "test-owner", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	checkpoint := &agentrun.RunCheckpoint{Boundary: "tool_pending", StepID: "step-2", Completed: []string{"step one done"}, Iteration: 3}
	if err := run.record("step_started", nil, checkpoint); err != nil {
		t.Fatal(err)
	}
	reloaded, err := newAgentRunStore(repo)
	if err != nil {
		t.Fatal(err)
	}
	loaded, _ := reloaded.get(run.snapshot().ID)
	state := loaded.snapshot()
	if state.Status != agentrun.StatusError || state.Error != "Server restarted before run completed" || state.Checkpoint.PreviousBoundary != "tool_pending" || state.Checkpoint.StepID != "step-2" || state.Checkpoint.Iteration != 3 || len(state.Checkpoint.Completed) != 1 || len(state.Events) != 2 {
		t.Fatalf("bad recovery: %+v", state)
	}
	if _, err := newAgentRunStore(repo); err != nil {
		t.Fatal(err)
	}
	runs, _ := repo.List()
	if len(runs[0].Events) != 2 {
		t.Fatal("restart duplicated terminal event")
	}
}

type failingRunRepository struct {
	agentrun.Repository
	fail bool
}

func (r *failingRunRepository) Save(run agentrun.Run) error {
	if r.fail {
		return errors.New("disk unavailable")
	}
	return r.Repository.Save(run)
}

func TestRunPersistenceFailureDoesNotPublishOrCancel(t *testing.T) {
	_, repo := testRunStore(t)
	failing := &failingRunRepository{Repository: repo}
	store, err := newAgentRunStore(failing)
	if err != nil {
		t.Fatal(err)
	}
	run, err := store.createWithMetadata("goal", "model", "test-owner", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	ch := run.subscribe()
	defer run.unsubscribe(ch)
	failing.fail = true
	if err := run.record("event", nil, nil); err == nil {
		t.Fatal("expected error")
	}
	if changed, err := run.finish(agentrun.StatusCanceled, "cancel", "", 0); changed || err == nil {
		t.Fatal("failed cancellation committed")
	}
	if run.isTerminal() || len(run.snapshot().Events) != 0 {
		t.Fatal("memory advanced after failed save")
	}
	select {
	case <-ch:
		t.Fatal("published unpersisted event")
	default:
	}
	failing.fail = false
	if err := run.record("event", nil, nil); err != nil {
		t.Fatal(err)
	}
	// The wakeup is emitted only after Save completed.
	<-ch
	runs, err := repo.List()
	if err != nil || len(runs[0].Events) != 1 || runs[0].Events[0].Sequence != 1 {
		t.Fatalf("notification preceded disk commit: %v", err)
	}
}
