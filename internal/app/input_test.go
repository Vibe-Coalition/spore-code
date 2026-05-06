package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/charmbracelet/bubbles/textarea"
	tea "github.com/charmbracelet/bubbletea"

	"github.com/yumlevi/spore-code/internal/config"
)

func TestBracketedPasteInsertsImmediately(t *testing.T) {
	m := inputTestModel(t)

	next, _ := m.updateKey(tea.KeyMsg{
		Type:  tea.KeyRunes,
		Runes: []rune("hello\nworld"),
		Paste: true,
	})
	got := next.(*Model)

	if got.input.Value() != "hello\nworld" {
		t.Fatalf("paste was not inserted as one value: %q", got.input.Value())
	}
	if len(got.inputBurst) != 0 {
		t.Fatalf("paste should not leave buffered input: %#v", got.inputBurst)
	}
}

func TestSlowPasteRunesFlushBeforeEnter(t *testing.T) {
	m := inputTestModel(t)

	next, _ := m.updateKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("h")})
	m = next.(*Model)
	next, _ = m.updateKey(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune("i")})
	m = next.(*Model)

	if got := m.input.Value(); got != "" {
		t.Fatalf("ordinary runes should be buffered before the timer flushes, got %q", got)
	}

	next, _ = m.updateKey(tea.KeyMsg{Type: tea.KeyEnter})
	m = next.(*Model)
	if len(m.messages) == 0 || m.messages[len(m.messages)-1].Text != "hi" {
		t.Fatalf("enter did not flush buffered text before send: %#v", m.messages)
	}
}

func TestDroppedFileURIsNormalizeToPaths(t *testing.T) {
	m := inputTestModel(t)

	next, _ := m.updateKey(tea.KeyMsg{
		Type:  tea.KeyRunes,
		Runes: []rune("file:///tmp/spore%20shot.png file:///tmp/second%20shot.png"),
		Paste: true,
	})
	got := next.(*Model)

	if got.input.Value() != "/tmp/spore shot.png\n/tmp/second shot.png" {
		t.Fatalf("file URI was not decoded: %q", got.input.Value())
	}
}

func TestFileURIInProseStillNormalizes(t *testing.T) {
	got := normalizePastedInput("look at file:///tmp/spore%20shot.png please", "")
	want := "look at /tmp/spore shot.png please"
	if got != want {
		t.Fatalf("file URI in prose mismatch\nwant: %q\n got: %q", want, got)
	}
}

func TestShellQuotedFileDropNormalizesToNewlinePaths(t *testing.T) {
	dir := t.TempDir()
	first := filepath.Join(dir, "one image.png")
	second := filepath.Join(dir, "two.txt")
	touchFile(t, first)
	touchFile(t, second)

	raw := "'" + first + "' \"" + second + "\""
	got := normalizePastedInput(raw, dir)
	want := strings.Join([]string{first, second}, "\n")
	if got != want {
		t.Fatalf("drop normalization mismatch\nwant: %q\n got: %q", want, got)
	}
}

func TestQuotedWindowsPathDropKeepsBackslashes(t *testing.T) {
	got := normalizePastedInput(`"C:\Users\Levi\Pictures\spore shot.png"`, "")
	want := `C:\Users\Levi\Pictures\spore shot.png`
	if got != want {
		t.Fatalf("windows path normalization mismatch\nwant: %q\n got: %q", want, got)
	}
}

func TestOpenQuestionPasteUsesFastPath(t *testing.T) {
	m := inputTestModel(t)
	m.modal = modalQuestion
	m.question = &questionModal{
		questions: []question{{Text: "Path?"}},
		answers:   make([]string, 1),
		checked:   map[int]bool{},
	}

	next, _ := m.updateQuestionModal(tea.KeyMsg{
		Type:  tea.KeyRunes,
		Runes: []rune("file:///tmp/example%20image.png"),
		Paste: true,
	})
	got := next.(*Model)

	if got.input.Value() != "/tmp/example image.png" {
		t.Fatalf("question paste was not normalized: %q", got.input.Value())
	}
}

func inputTestModel(t *testing.T) *Model {
	t.Helper()
	ta := textarea.New()
	ta.Focus()
	return &Model{
		cfg:              &config.Config{GlobalDir: t.TempDir()},
		cwd:              t.TempDir(),
		sess:             "test-session",
		input:            ta,
		currentStreamIdx: -1,
		histIdx:          -1,
		followBottom:     true,
	}
}

func touchFile(t *testing.T, path string) {
	t.Helper()
	if err := os.WriteFile(path, []byte("x"), 0o600); err != nil {
		t.Fatalf("write temp file: %v", err)
	}
}
