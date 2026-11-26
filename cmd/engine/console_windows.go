//go:build windows

package main

import (
	"fmt"
	"os"
	"syscall"
)

const attachParentProcess = ^uint32(0)

var (
	kernel32             = syscall.NewLazyDLL("kernel32.dll")
	getConsoleWindowProc = kernel32.NewProc("GetConsoleWindow")
	getStdHandleProc     = kernel32.NewProc("GetStdHandle")
	attachConsoleProc    = kernel32.NewProc("AttachConsole")
	allocConsoleProc     = kernel32.NewProc("AllocConsole")
)

const (
	stdOutputHandle = ^uintptr(10) // (DWORD)-11
	stdErrorHandle  = ^uintptr(11) // (DWORD)-12
	invalidHandle   = ^uintptr(0)
)

// prepareCLIOutput makes a GUI-subsystem Wails binary behave like a normal
// console command when a flag is supplied. Desktop mode never calls this, so
// launching the app normally does not flash or allocate a console window.
func prepareCLIOutput() error {
	// A GUI-subsystem process can still inherit valid file or pipe handles when
	// launched with PowerShell/cmd redirection. Prefer those handles so CLI
	// output remains capturable by automation as well as visible in a console.
	stdoutHandle, _, _ := getStdHandleProc.Call(stdOutputHandle)
	stderrHandle, _, _ := getStdHandleProc.Call(stdErrorHandle)
	if stdoutHandle != 0 && stdoutHandle != invalidHandle {
		os.Stdout = os.NewFile(stdoutHandle, "stdout")
	}
	if stderrHandle != 0 && stderrHandle != invalidHandle {
		os.Stderr = os.NewFile(stderrHandle, "stderr")
	}
	if stdoutHandle != 0 && stdoutHandle != invalidHandle || stderrHandle != 0 && stderrHandle != invalidHandle {
		if stdoutHandle == 0 || stdoutHandle == invalidHandle {
			os.Stdout = os.Stderr
		}
		if stderrHandle == 0 || stderrHandle == invalidHandle {
			os.Stderr = os.Stdout
		}
		return nil
	}

	if consoleWindow, _, _ := getConsoleWindowProc.Call(); consoleWindow == 0 {
		if attached, _, attachErr := attachConsoleProc.Call(uintptr(attachParentProcess)); attached == 0 {
			if allocated, _, allocErr := allocConsoleProc.Call(); allocated == 0 {
				return fmt.Errorf("attach parent console: %v; allocate console: %v", attachErr, allocErr)
			}
		}
	}

	stdout, err := os.OpenFile("CONOUT$", os.O_WRONLY, 0)
	if err != nil {
		return fmt.Errorf("open console output: %w", err)
	}
	stderr, err := os.OpenFile("CONOUT$", os.O_WRONLY, 0)
	if err != nil {
		_ = stdout.Close()
		return fmt.Errorf("open console error output: %w", err)
	}
	os.Stdout = stdout
	os.Stderr = stderr
	return nil
}
