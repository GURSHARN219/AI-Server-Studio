//go:build windows

package engine

import "testing"

func TestHiddenCommandDoesNotCreateAConsoleWindow(t *testing.T) {
	cmd := hiddenCommand("nvidia-smi")
	if cmd.SysProcAttr == nil || !cmd.SysProcAttr.HideWindow {
		t.Fatal("non-interactive Windows probes must hide their console window")
	}
}
