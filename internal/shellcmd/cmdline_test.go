package shellcmd

import (
	"strings"
	"testing"
)

func TestWindowsCmdLinePreservesQuotedCommitMessage(t *testing.T) {
	got := WindowsCmdLine(
		`C:\Windows\System32\cmd.exe`,
		`git add -A && git commit -m "Remove delegation settings from chat screen; clean up unused types and context"`,
	)

	if !strings.Contains(got, `git commit -m "Remove delegation settings from chat screen; clean up unused types and context"`) {
		t.Fatalf("commit message quotes were not preserved:\n%s", got)
	}
	if strings.Contains(got, `git commit -m \"`) {
		t.Fatalf("cmd.exe should receive raw quote syntax, not slash-escaped quotes:\n%s", got)
	}
	if !strings.Contains(got, ` /D /S /C "`) {
		t.Fatalf("expected stable cmd.exe /D /S /C wrapper:\n%s", got)
	}
}

func TestWindowsCmdLineAllowsQuotedExecutable(t *testing.T) {
	got := WindowsCmdLine(
		`C:\Windows\System32\cmd.exe`,
		`"C:\Program Files\nodejs\node.exe" -e "console.log('ok')"`,
	)

	if !strings.Contains(got, `"C:\Program Files\nodejs\node.exe" -e "console.log('ok')"`) {
		t.Fatalf("quoted executable command was not preserved:\n%s", got)
	}
}
