//go:build !windows

package main

import "os/exec"

func terminateViteProcess(cmd *exec.Cmd) error { return cmd.Process.Kill() }
