package engine

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"sync"
)

var errEngineStopped = errors.New("engine is shut down")

type lifecyclePhase string

const (
	lifecycleIdle      lifecyclePhase = "idle"
	lifecycleLoading   lifecyclePhase = "loading"
	lifecycleReady     lifecyclePhase = "ready"
	lifecycleUnloading lifecyclePhase = "unloading"
	lifecycleStopped   lifecyclePhase = "stopped"
)

// lifecycleCoordinator is the single owner of runtime state.  A generation
// is assigned to every activation so an old process' Wait goroutine can never
// mutate state belonging to a later activation.
type lifecycleCoordinator struct {
	mu sync.Mutex

	phase      lifecyclePhase
	generation uint64
	port       int
	model      string
	modelName  string
	process    *runtimeProcess
	operation  *lifecycleOperation
}

type lifecycleOperation struct {
	generation uint64
	ctx        context.Context
	cancel     context.CancelFunc
}

type runtimeProcess struct {
	generation uint64
	cmd        *exec.Cmd
	port       int
}

func newLifecycleCoordinator(port int) *lifecycleCoordinator {
	return &lifecycleCoordinator{phase: lifecycleIdle, port: port}
}

func (l *lifecycleCoordinator) beginLoad() (*lifecycleOperation, *runtimeProcess, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.phase == lifecycleStopped {
		return nil, nil, errEngineStopped
	}
	if l.phase == lifecycleLoading {
		return nil, nil, fmt.Errorf("%w: load", ErrBusy)
	}
	if l.phase == lifecycleUnloading {
		return nil, nil, fmt.Errorf("%w: unload", ErrBusy)
	}

	l.generation++
	old := l.process
	if old != nil {
		l.port++
		if l.port > 19000 {
			l.port = 18080
		}
	}
	l.process = nil
	l.model = ""
	l.modelName = ""
	l.phase = lifecycleLoading
	ctx, cancel := context.WithCancel(context.Background())
	op := &lifecycleOperation{generation: l.generation, ctx: ctx, cancel: cancel}
	l.operation = op
	return op, old, nil
}

func (l *lifecycleCoordinator) attachProcess(op *lifecycleOperation, cmd *exec.Cmd) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.operation != op || l.phase != lifecycleLoading || l.generation != op.generation {
		return false
	}
	l.process = &runtimeProcess{generation: op.generation, cmd: cmd, port: l.port}
	return true
}

func (l *lifecycleCoordinator) markReady(op *lifecycleOperation, model, name string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.operation != op || l.phase != lifecycleLoading || l.generation != op.generation || l.process == nil {
		return false
	}
	l.model = model
	l.modelName = name
	l.phase = lifecycleReady
	l.operation = nil
	return true
}

// markReadyWithoutProcess is used by in-process runtimes that do not own an
// OS child process. The same generation and operation checks apply, but there
// is no runtimeProcess to attach before the model becomes ready.
func (l *lifecycleCoordinator) markReadyWithoutProcess(op *lifecycleOperation, model, name string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.operation != op || l.phase != lifecycleLoading || l.generation != op.generation {
		return false
	}
	l.model = model
	l.modelName = name
	l.phase = lifecycleReady
	l.operation = nil
	return true
}

func (l *lifecycleCoordinator) fail(op *lifecycleOperation) *runtimeProcess {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.operation != op || l.generation != op.generation {
		return nil
	}
	proc := l.process
	l.process = nil
	l.model = ""
	l.modelName = ""
	l.phase = lifecycleIdle
	l.operation = nil
	return proc
}

// processExited invalidates only the activation that owns cmd. The bool says
// whether that activation had reached ready state and therefore needs a
// status event.
func (l *lifecycleCoordinator) processExited(op *lifecycleOperation, cmd *exec.Cmd) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.generation != op.generation || l.process == nil || l.process.cmd != cmd {
		return false
	}
	wasReady := l.phase == lifecycleReady
	l.process = nil
	l.model = ""
	l.modelName = ""
	if l.phase != lifecycleStopped {
		l.phase = lifecycleIdle
	}
	l.operation = nil
	return wasReady
}

func (l *lifecycleCoordinator) beginUnload() (*runtimeProcess, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.phase == lifecycleStopped {
		return nil, errEngineStopped
	}
	if l.phase == lifecycleLoading {
		return nil, fmt.Errorf("%w: load", ErrBusy)
	}
	if l.phase == lifecycleUnloading {
		return nil, fmt.Errorf("%w: unload", ErrBusy)
	}
	l.generation++
	proc := l.process
	l.process = nil
	l.model = ""
	l.modelName = ""
	l.phase = lifecycleUnloading
	return proc, nil
}

func (l *lifecycleCoordinator) finishUnload() {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.phase == lifecycleUnloading {
		l.phase = lifecycleIdle
	}
}

func (l *lifecycleCoordinator) shutdown() (*runtimeProcess, bool) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.phase == lifecycleStopped {
		return nil, false
	}
	l.generation++
	if l.operation != nil {
		l.operation.cancel()
		l.operation = nil
	}
	proc := l.process
	l.process = nil
	l.model = ""
	l.modelName = ""
	l.phase = lifecycleStopped
	return proc, true
}

func (l *lifecycleCoordinator) snapshot() (loaded, loading bool, model, name string, proc *runtimeProcess) {
	l.mu.Lock()
	defer l.mu.Unlock()
	loaded = l.phase == lifecycleReady
	loading = l.phase == lifecycleLoading
	model, name, proc = l.model, l.modelName, l.process
	return
}

func (l *lifecycleCoordinator) portNumber() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.port
}
