//go:build windows

package shellcmd

import (
	"context"
	"os"
	"os/exec"
	"syscall"
)

func New(ctx context.Context, command string) *exec.Cmd {
	shell := os.Getenv("ComSpec")
	if shell == "" {
		shell = "cmd.exe"
	}
	cmd := exec.CommandContext(ctx, shell)
	cmd.SysProcAttr = &syscall.SysProcAttr{
		CmdLine: WindowsCmdLine(shell, command),
	}
	return cmd
}
