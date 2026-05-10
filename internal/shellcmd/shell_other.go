//go:build !windows

package shellcmd

import (
	"context"
	"os/exec"
)

func New(ctx context.Context, command string) *exec.Cmd {
	return exec.CommandContext(ctx, "sh", "-c", command)
}
