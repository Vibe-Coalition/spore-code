package main

import "testing"

func TestCleanPromptLineStripsBracketedPaste(t *testing.T) {
	got := cleanPromptLine("\x1b[200~invite-key-123\x1b[201~\r\n")
	if got != "invite-key-123" {
		t.Fatalf("expected bracketed paste wrappers stripped, got %q", got)
	}
}
