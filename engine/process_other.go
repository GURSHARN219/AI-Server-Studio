//go:build !windows

package engine

import "os/exec"

func hiddenCommand(name string, args ...string) *exec.Cmd {
	return exec.Command(name, args...)
}
