//go:build windows

package main

import (
	"os/exec"
	"strconv"
)

func terminateViteProcess(cmd *exec.Cmd) error {
	return exec.Command("taskkill", "/PID", strconv.Itoa(cmd.Process.Pid), "/T", "/F").Run()
}
