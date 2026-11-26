package sandbox

import (
	"context"
	"testing"
)

func TestExecutorFailsClosedWithoutVerifiedIsolation(t *testing.T) {
	executor := New(Config{JSCommand: []string{"node"}, IsolationVerified: false})
	result := executor.Run(context.Background(), "js", "1 + 1")
	if result.Error != ErrUnavailable.Error() {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestExecutorRejectsOversizedCodeBeforeWorker(t *testing.T) {
	executor := New(Config{JSCommand: []string{"node"}, IsolationVerified: true, MaxCodeBytes: 3})
	result := executor.Run(context.Background(), "js", "1234")
	if result.Error == "" || result.Stdout != "" {
		t.Fatalf("expected bounded failure: %+v", result)
	}
}
