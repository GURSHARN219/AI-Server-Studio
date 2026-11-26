//go:build windows

package engine

import (
	"os/exec"
	"syscall"
)

// hiddenCommand keeps non-interactive probes from flashing a console window
// while preserving their stdout/stderr for the caller to inspect.
func hiddenCommand(name string, args ...string) *exec.Cmd {
	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return cmd
}
