//go:build !windows

package app

import "os/exec"

func hideCommandWindow(cmd *exec.Cmd) {}
