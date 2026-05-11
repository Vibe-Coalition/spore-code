package tools

import (
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/Vibe-Coalition/spore-code/internal/bg"
)

func TestExecTimeoutAdoptsBackgroundProcess(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses POSIX shell syntax")
	}
	dir := t.TempDir()
	pm := bg.New(dir)

	res := Exec(map[string]any{
		"command": "printf 'ready\\n'; while true; do sleep 1; done",
		"timeout": 100,
	}, dir, dir, pm, nil)
	m, ok := res.(map[string]any)
	if !ok {
		t.Fatalf("Exec returned %T", res)
	}
	if m["backgrounded"] != true {
		t.Fatalf("expected backgrounded result, got %#v", m)
	}
	if m["pending"] != true || m["running"] != true {
		t.Fatalf("expected pending running background result, got %#v", m)
	}
	id, ok := m["processId"].(int)
	if !ok || id <= 0 {
		t.Fatalf("expected process id, got %#v", m["processId"])
	}

	tail, ok := BgTail(map[string]any{"id": id, "lines": 20}, pm).(map[string]any)
	if !ok {
		t.Fatal("BgTail did not return a map")
	}
	if !strings.Contains(tail["output"].(string), "ready") {
		t.Fatalf("expected tailed output to include ready, got %#v", tail["output"])
	}
	if tail["command"] != "printf 'ready\\n'; while true; do sleep 1; done" {
		t.Fatalf("expected tailed output to include command, got %#v", tail["command"])
	}

	killed := BgKill(map[string]any{"id": id}, pm).(map[string]any)
	if killed["ok"] != true {
		t.Fatalf("expected bg kill to succeed, got %#v", killed)
	}
	time.Sleep(300 * time.Millisecond)
	after := BgTail(map[string]any{"id": id, "lines": 20}, pm).(map[string]any)
	if after["running"] == true {
		t.Fatalf("expected process to stop after kill, got %#v", after)
	}
}

func TestExecAcceptsCommandAliases(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses POSIX shell syntax")
	}
	dir := t.TempDir()
	res := Exec(map[string]any{"cmd": "printf ok"}, dir, dir, nil, nil)
	m, ok := res.(map[string]any)
	if !ok {
		t.Fatalf("Exec returned %T", res)
	}
	if m["exitCode"] != 0 || !strings.Contains(m["output"].(string), "ok") {
		t.Fatalf("expected command alias to execute, got %#v", m)
	}
}
