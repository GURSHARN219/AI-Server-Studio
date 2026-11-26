package engine

import (
	"os/exec"
	"testing"
)

func TestLifecycleOldProcessExitCannotClearNewActivation(t *testing.T) {
	l := newLifecycleCoordinator(18080)
	op1, _, err := l.beginLoad()
	if err != nil {
		t.Fatal(err)
	}
	old := exec.Command("old")
	if !l.attachProcess(op1, old) {
		t.Fatal("failed to attach first process")
	}
	if !l.markReady(op1, "old.gguf", "old") {
		t.Fatal("failed to mark first process ready")
	}

	op2, replaced, err := l.beginLoad()
	if err != nil {
		t.Fatal(err)
	}
	if replaced == nil || replaced.cmd != old {
		t.Fatal("reload did not detach the old process")
	}
	newProcess := exec.Command("new")
	if !l.attachProcess(op2, newProcess) || !l.markReady(op2, "new.gguf", "new") {
		t.Fatal("failed to activate replacement process")
	}

	if l.processExited(op1, old) {
		t.Fatal("old process exit was reported as the active ready process")
	}
	loaded, loading, model, name, proc := l.snapshot()
	if !loaded || loading || model != "new.gguf" || name != "new" || proc == nil || proc.cmd != newProcess {
		t.Fatalf("new activation was invalidated: loaded=%v loading=%v model=%q name=%q proc=%v", loaded, loading, model, name, proc)
	}
}

func TestLifecycleRejectsConflictingOperations(t *testing.T) {
	l := newLifecycleCoordinator(18080)
	op, _, err := l.beginLoad()
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := l.beginLoad(); err == nil {
		t.Fatal("concurrent load was accepted")
	}
	if _, err := l.beginUnload(); err == nil {
		t.Fatal("unload was accepted while loading")
	}
	_ = l.fail(op)
	if _, err := l.beginUnload(); err != nil {
		t.Fatalf("unload after failed load: %v", err)
	}
}

func TestLifecycleAllowsInProcessRuntimeWithoutChildProcess(t *testing.T) {
	l := newLifecycleCoordinator(0)
	op, _, err := l.beginLoad()
	if err != nil {
		t.Fatal(err)
	}
	if !l.markReadyWithoutProcess(op, "model.gguf", "model") {
		t.Fatal("in-process activation was rejected without a child process")
	}
	loaded, loading, model, name, proc := l.snapshot()
	if !loaded || loading || model != "model.gguf" || name != "model" || proc != nil {
		t.Fatalf("unexpected in-process snapshot: loaded=%v loading=%v model=%q name=%q proc=%v", loaded, loading, model, name, proc)
	}
}
