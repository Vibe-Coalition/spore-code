package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveLocalUpdateSourceExplicitDir(t *testing.T) {
	dir := t.TempDir()
	want := filepath.Join(dir, currentAssetName())
	if err := os.WriteFile(want, []byte{0x7f, 'E', 'L', 'F'}, 0o755); err != nil {
		t.Fatal(err)
	}

	got, label, err := resolveLocalUpdateSource(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("source path = %q, want %q", got, want)
	}
	if label == "" {
		t.Fatalf("expected non-empty version label")
	}
}

func TestLocalUpdateCandidateMissingPlatformAsset(t *testing.T) {
	dir := t.TempDir()
	if _, ok := localUpdateCandidate(dir); ok {
		t.Fatalf("empty dir should not resolve as a local update")
	}
}

func TestWindowsReplacementScriptDoesNotDeleteItself(t *testing.T) {
	body := windowsReplacementScriptBody(
		`C:\Users\tester\AppData\Local\Temp\spore-new.exe`,
		`C:\Users\tester\.spore-code\bin\spore.exe`,
	)
	if strings.Contains(body, `%~f0`) {
		t.Fatalf("replacement script must not delete itself while cmd is still interpreting it:\n%s", body)
	}
	if strings.Contains(strings.ToLower(body), `del "%%~f0"`) {
		t.Fatalf("replacement script still contains self-delete command:\n%s", body)
	}
	if !strings.Contains(body, `exit /b 0`) {
		t.Fatalf("replacement script should exit cleanly after successful replacement:\n%s", body)
	}
	if !strings.Contains(body, `C:\Users\tester\.spore-code\bin\spore.exe`) {
		t.Fatalf("replacement script should target the installed executable:\n%s", body)
	}
}
