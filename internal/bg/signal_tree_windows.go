//go:build windows

package bg

import "os/exec"

// TerminateTree is best-effort on Windows. Child processes are already placed
// in the shared job object for process-lifetime cleanup; targeted per-tree
// termination falls back to terminating the root command.
func TerminateTree(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	_ = cmd.Process.Kill()
}

// KillTree force-kills the root command on Windows.
func KillTree(cmd *exec.Cmd) { TerminateTree(cmd) }
