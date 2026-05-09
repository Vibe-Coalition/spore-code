//go:build !windows

package bg

import (
	"os/exec"
	"syscall"
)

func signalTree(cmd *exec.Cmd, sig syscall.Signal) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	pid := cmd.Process.Pid
	if pid <= 0 {
		return
	}
	if err := syscall.Kill(-pid, sig); err != nil {
		_ = cmd.Process.Signal(sig)
	}
}

// TerminateTree asks a process group to stop.
func TerminateTree(cmd *exec.Cmd) { signalTree(cmd, syscall.SIGTERM) }

// KillTree force-kills a process group.
func KillTree(cmd *exec.Cmd) { signalTree(cmd, syscall.SIGKILL) }
