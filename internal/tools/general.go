package tools

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/Vibe-Coalition/spore-code/internal/bg"
)

func resolveDir(input map[string]any, cwd, scope string) (string, error) {
	raw := asString(input["path"], cwd)
	p, err := ResolvePathScoped(raw, cwd, scope)
	if err != nil {
		return "", err
	}
	st, err := os.Stat(p)
	if err != nil {
		return "", err
	}
	if !st.IsDir() {
		return "", fmt.Errorf("%s is not a directory", p)
	}
	return p, nil
}

func ListDir(input map[string]any, cwd, scope string) any {
	dir, err := resolveDir(input, cwd, scope)
	if err != nil {
		return map[string]string{"error": err.Error()}
	}
	includeHidden := asBool(input["include_hidden"], false)
	maxEntries := asInt(input["max_entries"], 200)
	if maxEntries <= 0 {
		maxEntries = 200
	}
	if maxEntries > 1000 {
		maxEntries = 1000
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return map[string]string{"error": err.Error()}
	}
	type row struct {
		Name  string `json:"name"`
		Path  string `json:"path"`
		Type  string `json:"type"`
		Size  int64  `json:"size"`
		MTime string `json:"mtime,omitempty"`
	}
	rows := make([]row, 0, len(entries))
	for _, ent := range entries {
		name := ent.Name()
		if !includeHidden && strings.HasPrefix(name, ".") {
			continue
		}
		if !includeHidden && ent.IsDir() && noiseDirs[name] {
			continue
		}
		info, _ := ent.Info()
		typ := "other"
		if ent.IsDir() {
			typ = "dir"
		} else if ent.Type().IsRegular() {
			typ = "file"
		} else if ent.Type()&os.ModeSymlink != 0 {
			typ = "symlink"
		}
		var size int64
		var mtime string
		if info != nil {
			size = info.Size()
			mtime = info.ModTime().UTC().Format(time.RFC3339)
		}
		rows = append(rows, row{Name: name, Path: filepath.ToSlash(name), Type: typ, Size: size, MTime: mtime})
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Type != rows[j].Type {
			return rows[i].Type == "dir"
		}
		return rows[i].Name < rows[j].Name
	})
	truncated := len(rows) > maxEntries
	if truncated {
		rows = rows[:maxEntries]
	}
	return map[string]any{"ok": true, "path": dir, "entries": rows, "count": len(rows), "truncated": truncated}
}

func ReadManyFiles(input map[string]any, cwd, scope string) any {
	paths := asStringSlice(input["paths"])
	if len(paths) == 0 {
		return map[string]string{"error": "paths is required"}
	}
	truncated := false
	if len(paths) > 20 {
		paths = paths[:20]
		truncated = true
	}
	limit := asInt(input["limit"], 400)
	offset := asInt(input["offset"], 0)
	files := make([]map[string]any, 0, len(paths))
	for _, p := range paths {
		files = append(files, map[string]any{
			"path":   p,
			"result": ReadFile(map[string]any{"path": p, "limit": limit, "offset": offset}, cwd, scope),
		})
	}
	return map[string]any{"ok": true, "files": files, "count": len(files), "truncated": truncated}
}

func runCmdArgs(cwd string, timeoutMs int, name string, args ...string) (string, int, error) {
	if timeoutMs <= 0 {
		timeoutMs = 60000
	}
	if timeoutMs > 600000 {
		timeoutMs = 600000
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = cwd
	out, err := cmd.CombinedOutput()
	exit := 0
	if err != nil {
		exit = 1
		if ee, ok := err.(*exec.ExitError); ok {
			exit = ee.ExitCode()
		}
		if ctx.Err() == context.DeadlineExceeded {
			return string(out), exit, fmt.Errorf("command timed out after %dms", timeoutMs)
		}
	}
	return string(out), exit, err
}

func truncateOutput(s string, limit int) string {
	if limit <= 0 {
		limit = 20000
	}
	if len(s) <= limit {
		return s
	}
	return s[:limit] + fmt.Sprintf("\n... [truncated %d chars]", len(s)-limit)
}

func GitStatus(input map[string]any, cwd, scope string) any {
	dir, err := resolveDir(input, cwd, scope)
	if err != nil {
		return map[string]string{"error": err.Error()}
	}
	out1, exit1, err1 := runCmdArgs(dir, 30000, "git", "status", "--short", "--branch")
	out2, _, _ := runCmdArgs(dir, 30000, "git", "diff", "--stat")
	out := strings.TrimRight(out1, "\n")
	if strings.TrimSpace(out2) != "" {
		out += "\n\n" + strings.TrimRight(out2, "\n")
	}
	if err1 != nil {
		return map[string]any{"ok": false, "exit": exit1, "error": err1.Error(), "output": truncateOutput(out, 12000)}
	}
	return map[string]any{"ok": true, "path": dir, "output": truncateOutput(out, 12000)}
}

func GitDiff(input map[string]any, cwd, scope string) any {
	dir, err := resolveDir(input, cwd, scope)
	if err != nil {
		return map[string]string{"error": err.Error()}
	}
	args := []string{"diff"}
	if asBool(input["staged"], false) {
		args = append(args, "--staged")
	}
	if asBool(input["stat"], false) {
		args = append(args, "--stat")
	}
	if ref := asString(input["ref"], ""); ref != "" {
		args = append(args, ref)
	}
	if file := asString(input["file"], ""); file != "" {
		args = append(args, "--", file)
	}
	out, exit, err := runCmdArgs(dir, 60000, "git", args...)
	limit := asInt(input["limit"], 20000)
	if limit < 1000 {
		limit = 1000
	}
	if limit > 100000 {
		limit = 100000
	}
	res := map[string]any{"ok": err == nil, "path": dir, "exit": exit, "output": truncateOutput(out, limit)}
	if err != nil {
		res["error"] = err.Error()
	}
	return res
}

func patchPaths(diff string) ([]string, error) {
	seen := map[string]bool{}
	var paths []string
	for _, line := range strings.Split(diff, "\n") {
		if !strings.HasPrefix(line, "--- ") && !strings.HasPrefix(line, "+++ ") {
			continue
		}
		p := strings.Fields(strings.TrimSpace(line[4:]))
		if len(p) == 0 || p[0] == "/dev/null" {
			continue
		}
		name := p[0]
		if strings.HasPrefix(name, "a/") || strings.HasPrefix(name, "b/") {
			name = name[2:]
		}
		if filepath.IsAbs(name) {
			return nil, fmt.Errorf("unsafe absolute patch path: %s", name)
		}
		for _, part := range strings.FieldsFunc(name, func(r rune) bool { return r == '/' || r == '\\' }) {
			if part == ".." {
				return nil, fmt.Errorf("unsafe patch path: %s", name)
			}
		}
		if !seen[name] {
			seen[name] = true
			paths = append(paths, filepath.ToSlash(name))
		}
	}
	return paths, nil
}

func PatchFile(input map[string]any, cwd, scope string) any {
	diff := asString(input["patch"], asString(input["diff"], ""))
	if strings.TrimSpace(diff) == "" {
		return map[string]string{"error": "patch is required"}
	}
	paths, err := patchPaths(diff)
	if err != nil {
		return map[string]string{"error": err.Error()}
	}
	dir, err := resolveDir(input, cwd, scope)
	if err != nil {
		return map[string]string{"error": err.Error()}
	}
	tmp, err := os.CreateTemp("", "spore-patch-*.diff")
	if err != nil {
		return map[string]string{"error": err.Error()}
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if _, err := tmp.WriteString(diff); err != nil {
		tmp.Close()
		return map[string]string{"error": err.Error()}
	}
	tmp.Close()

	checkOut, checkExit, checkErr := runCmdArgs(dir, 60000, "git", "apply", "--check", tmpPath)
	if checkErr != nil {
		return map[string]any{"ok": false, "checked": false, "exit": checkExit, "error": checkErr.Error(), "output": truncateOutput(checkOut, 12000)}
	}
	if asBool(input["dry_run"], false) {
		return map[string]any{"ok": true, "dry_run": true, "paths": paths, "output": checkOut}
	}
	out, exit, err := runCmdArgs(dir, 60000, "git", "apply", tmpPath)
	res := map[string]any{"ok": err == nil, "dry_run": false, "paths": paths, "exit": exit, "output": truncateOutput(out, 12000)}
	if err != nil {
		res["error"] = err.Error()
	}
	return res
}

func detectTestCommand(dir string) string {
	if data, err := os.ReadFile(filepath.Join(dir, "package.json")); err == nil {
		if strings.Contains(string(data), `"test"`) {
			switch {
			case fileExists(filepath.Join(dir, "bun.lockb")):
				return "bun test"
			case fileExists(filepath.Join(dir, "pnpm-lock.yaml")):
				return "pnpm test"
			case fileExists(filepath.Join(dir, "yarn.lock")):
				return "yarn test"
			default:
				return "npm test"
			}
		}
	}
	if fileExists(filepath.Join(dir, "go.mod")) {
		return "go test ./..."
	}
	if fileExists(filepath.Join(dir, "Cargo.toml")) {
		return "cargo test"
	}
	if fileExists(filepath.Join(dir, "pyproject.toml")) || fileExists(filepath.Join(dir, "pytest.ini")) {
		return "pytest"
	}
	return ""
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

func RunTests(input map[string]any, cwd, logDir string, pm *bg.Manager, on func(line string), scope string) any {
	dir, err := resolveDir(input, cwd, scope)
	if err != nil {
		return map[string]string{"error": err.Error()}
	}
	command := asString(input["command"], "")
	if command == "" {
		command = detectTestCommand(dir)
	}
	if command == "" {
		return map[string]string{"error": "No test command supplied and no standard project test command detected"}
	}
	result := Exec(map[string]any{
		"command": command,
		"timeout": asInt(input["timeout"], 120000),
	}, dir, logDir, pm, on)
	if m, ok := result.(map[string]any); ok {
		m["command"] = command
		m["path"] = dir
		if _, has := m["ok"]; !has {
			_, hasErr := m["error"]
			m["ok"] = !hasErr
		}
		return m
	}
	return map[string]any{"ok": true, "command": command, "path": dir, "result": result}
}

func BgList(pm *bg.Manager) any {
	if pm == nil {
		return map[string]string{"error": "background manager unavailable"}
	}
	procs := pm.List()
	rows := make([]map[string]any, 0, len(procs))
	for _, p := range procs {
		rows = append(rows, map[string]any{
			"id": p.ID, "command": p.Command, "running": p.Running,
			"exitCode": p.ExitCode, "elapsed": p.Elapsed(), "logFile": p.LogPath,
		})
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i]["id"].(int) < rows[j]["id"].(int) })
	return map[string]any{"ok": true, "processes": rows, "count": len(rows)}
}

func BgTail(input map[string]any, pm *bg.Manager) any {
	if pm == nil {
		return map[string]string{"error": "background manager unavailable"}
	}
	id := asInt(input["id"], 0)
	p := pm.Get(id)
	if p == nil {
		return map[string]string{"error": fmt.Sprintf("background process #%d not found", id)}
	}
	lines := p.Output()
	n := asInt(input["lines"], 80)
	if n <= 0 {
		n = 80
	}
	if n > 500 {
		n = 500
	}
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return map[string]any{"ok": true, "id": id, "running": p.Running, "exitCode": p.ExitCode, "logFile": p.LogPath, "output": strings.Join(lines, "\n")}
}

func BgKill(input map[string]any, pm *bg.Manager) any {
	if pm == nil {
		return map[string]string{"error": "background manager unavailable"}
	}
	id := asInt(input["id"], 0)
	if id <= 0 {
		return map[string]string{"error": "id is required"}
	}
	return map[string]any{"ok": pm.Kill(id), "id": id}
}
