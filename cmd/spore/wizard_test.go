package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/yumlevi/spore-code/internal/config"
)

func TestCleanPromptLineStripsBracketedPaste(t *testing.T) {
	got := cleanPromptLine("\x1b[200~invite-key-123\x1b[201~\r\n")
	if got != "invite-key-123" {
		t.Fatalf("expected bracketed paste wrappers stripped, got %q", got)
	}
}

func TestTestAuthUsesPasswordPayload(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/spore-code/auth" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		_, _ = w.Write([]byte(`{"token":"ok","deviceToken":"device"}`))
	}))
	defer srv.Close()

	if _, err := testAuth(srv.URL, 0, "yam", config.AuthPassword, "", "secret"); err != nil {
		t.Fatalf("test auth: %v", err)
	}
	if got["username"] != "yam" || got["password"] != "secret" || got["authMethod"] != config.AuthPassword || got["issueDevice"] != true {
		t.Fatalf("password auth payload mismatch: %#v", got)
	}
	if _, ok := got["key"]; ok {
		t.Fatalf("password auth should not send invite key: %#v", got)
	}
}

func TestTestAuthAutoDetectsPassword(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if got["authMethod"] != config.AuthPassword || got["password"] != "secret" {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"Invalid credentials"}`))
			return
		}
		_, _ = w.Write([]byte(`{"token":"ok","deviceToken":"device"}`))
	}))
	defer srv.Close()

	attempt, err := testAuthAuto(srv.URL, 0, "yam", "secret")
	if err != nil {
		t.Fatalf("auto auth: %v", err)
	}
	if attempt.Method != config.AuthPassword {
		t.Fatalf("expected password auth, got %q", attempt.Method)
	}
}

func TestTestAuthAutoFallsBackToInviteKey(t *testing.T) {
	var calls []map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var got map[string]any
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		calls = append(calls, got)
		if got["key"] != "invite-key" {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"Invalid credentials"}`))
			return
		}
		_, _ = w.Write([]byte(`{"token":"ok","deviceToken":"device"}`))
	}))
	defer srv.Close()

	attempt, err := testAuthAuto(srv.URL, 0, "yam", "invite-key")
	if err != nil {
		t.Fatalf("auto auth: %v", err)
	}
	if attempt.Method != config.AuthInvite {
		t.Fatalf("expected invite auth, got %q", attempt.Method)
	}
	if len(calls) != 2 {
		t.Fatalf("expected password attempt then invite fallback, got %d calls", len(calls))
	}
	if calls[0]["password"] != "invite-key" || calls[1]["key"] != "invite-key" {
		t.Fatalf("unexpected auth fallback payloads: %#v", calls)
	}
}
