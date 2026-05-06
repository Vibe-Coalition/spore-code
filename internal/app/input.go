package app

import (
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	tea "github.com/charmbracelet/bubbletea"
)

const inputBurstDelay = 12 * time.Millisecond

type inputTextFlushMsg struct {
	seq uint64
}

var fileURIRe = regexp.MustCompile(`file://[^\s"'<>]+`)

func (m *Model) handleTextInputKey(km tea.KeyMsg) (tea.Cmd, bool) {
	if km.Paste {
		if text := keyText(km); text != "" {
			m.flushPendingInputText()
			m.insertInputText(normalizePastedInput(text, m.cwd))
			return nil, true
		}
	}

	text := keyText(km)
	if text == "" {
		return nil, false
	}
	return m.queueInputText(text), true
}

func keyText(km tea.KeyMsg) string {
	if km.Alt {
		return ""
	}
	switch km.Type {
	case tea.KeyRunes:
		if len(km.Runes) == 0 {
			return ""
		}
		return string(km.Runes)
	case tea.KeySpace:
		return " "
	default:
		return ""
	}
}

func (m *Model) queueInputText(text string) tea.Cmd {
	if text == "" {
		return nil
	}
	m.inputBurst = append(m.inputBurst, []rune(text)...)
	if m.inputBurstScheduled {
		return nil
	}
	m.inputBurstScheduled = true
	m.inputBurstSeq++
	seq := m.inputBurstSeq
	return func() tea.Msg {
		time.Sleep(inputBurstDelay)
		return inputTextFlushMsg{seq: seq}
	}
}

func (m *Model) flushPendingInputText() {
	if len(m.inputBurst) == 0 {
		m.inputBurstScheduled = false
		return
	}
	text := normalizePastedInput(string(m.inputBurst), m.cwd)
	m.inputBurst = nil
	m.inputBurstScheduled = false
	m.insertInputText(text)
}

func (m *Model) insertInputText(text string) {
	if text == "" {
		return
	}
	m.input.InsertString(text)
	if m.modal == modalNone {
		m.refreshSuggest()
	}
}

func normalizePastedInput(raw, cwd string) string {
	s := strings.ReplaceAll(raw, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	if paths, ok := droppedPathFields(s, cwd); ok {
		return strings.Join(paths, "\n")
	}
	s = fileURIRe.ReplaceAllStringFunc(s, func(token string) string {
		path, ok := fileURIToPath(token)
		if !ok {
			return token
		}
		return path
	})
	return s
}

func droppedPathFields(s, cwd string) ([]string, bool) {
	fields, ok := shellLikeFields(s)
	if !ok || len(fields) == 0 {
		return nil, false
	}
	paths := make([]string, 0, len(fields))
	for _, field := range fields {
		if path, ok := fileURIToPath(field); ok {
			paths = append(paths, path)
			continue
		}
		if looksLikeDroppedPath(field, cwd) {
			paths = append(paths, field)
			continue
		}
		return nil, false
	}
	return paths, true
}

func fileURIToPath(token string) (string, bool) {
	u, err := url.Parse(token)
	if err != nil || u.Scheme != "file" {
		return "", false
	}
	path, err := url.PathUnescape(u.EscapedPath())
	if err != nil {
		path = u.Path
	}
	if u.Host != "" && u.Host != "localhost" {
		return "//" + u.Host + path, true
	}
	if isWindowsDrivePath(strings.TrimPrefix(path, "/")) {
		return strings.TrimPrefix(path, "/"), true
	}
	return path, true
}

func shellLikeFields(s string) ([]string, bool) {
	var fields []string
	var b strings.Builder
	inSingle := false
	inDouble := false
	escaped := false
	haveField := false

	flush := func() {
		if haveField {
			fields = append(fields, b.String())
			b.Reset()
			haveField = false
		}
	}

	for _, r := range s {
		if escaped {
			b.WriteRune(r)
			haveField = true
			escaped = false
			continue
		}
		switch {
		case r == '\\' && !inSingle && !inDouble:
			escaped = true
			haveField = true
		case r == '\'' && !inDouble:
			inSingle = !inSingle
			haveField = true
		case r == '"' && !inSingle:
			inDouble = !inDouble
			haveField = true
		case (r == ' ' || r == '\t' || r == '\n') && !inSingle && !inDouble:
			flush()
		default:
			b.WriteRune(r)
			haveField = true
		}
	}
	if escaped {
		b.WriteRune('\\')
	}
	if inSingle || inDouble {
		return nil, false
	}
	flush()
	return fields, true
}

func looksLikeDroppedPath(path, cwd string) bool {
	if path == "" {
		return false
	}
	if pathExists(path, cwd) {
		return true
	}
	if filepath.IsAbs(path) || isWindowsDrivePath(path) || strings.HasPrefix(path, `\\`) {
		return true
	}
	return strings.HasPrefix(path, "./") ||
		strings.HasPrefix(path, "../") ||
		strings.HasPrefix(path, `.\`) ||
		strings.HasPrefix(path, `..\`) ||
		strings.HasPrefix(path, "~/") ||
		strings.HasPrefix(path, `~\`)
}

func pathExists(path, cwd string) bool {
	if _, err := os.Stat(expandHome(path)); err == nil {
		return true
	}
	if cwd != "" && !filepath.IsAbs(path) && !isWindowsDrivePath(path) {
		if _, err := os.Stat(filepath.Join(cwd, path)); err == nil {
			return true
		}
	}
	return false
}

func expandHome(path string) string {
	if path != "~" && !strings.HasPrefix(path, "~/") && !strings.HasPrefix(path, `~\`) {
		return path
	}
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return path
	}
	if path == "~" {
		return home
	}
	return filepath.Join(home, path[2:])
}

func isWindowsDrivePath(path string) bool {
	if utf8.RuneCountInString(path) < 3 {
		return false
	}
	b := []byte(path)
	return ((b[0] >= 'a' && b[0] <= 'z') || (b[0] >= 'A' && b[0] <= 'Z')) &&
		b[1] == ':' &&
		(b[2] == '\\' || b[2] == '/')
}
