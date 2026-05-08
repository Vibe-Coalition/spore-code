package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Vibe-Coalition/spore-code/internal/config"
)

func TestFetchPresetsFallsBackToCoreRoute(t *testing.T) {
	var sawCore bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.EscapedPath() {
		case "/api/spore-code/routing-presets", "/api/plugins/spore-code/routing-presets":
			http.NotFound(w, r)
		case "/api/models/routing-presets":
			sawCore = true
			if got := r.Header.Get("Authorization"); got != "Bearer invite-key" {
				t.Fatalf("auth header mismatch: %q", got)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok":      true,
				"presets": []map[string]string{{"name": "Mixed Mode"}},
			})
		default:
			t.Fatalf("unexpected path: %s", r.URL.EscapedPath())
		}
	}))
	defer srv.Close()

	m := inputTestModel(t)
	m.cfg.Connection = config.ConnectionSection{Host: srv.URL, AuthMethod: config.AuthInvite, Key: "invite-key"}
	msg := fetchPresetsWithMode(m, true).(presetsFetchedMsg)
	if msg.err != nil {
		t.Fatalf("fetch presets failed: %v", msg.err)
	}
	if !sawCore {
		t.Fatal("expected fallback to core routing preset endpoint")
	}
	if len(msg.names) != 1 || msg.names[0] != "Mixed Mode" {
		t.Fatalf("preset names mismatch: %#v", msg.names)
	}
}

func TestApplyPresetFallsBackToCoreRouteAndPreservesSpaces(t *testing.T) {
	var sawCore bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.EscapedPath() {
		case "/api/spore-code/routing-presets/apply", "/api/plugins/spore-code/routing-presets/apply":
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "route missing"})
		case "/api/models/routing-presets/Mixed%20Mode/apply":
			sawCore = true
			if r.Method != http.MethodPost {
				t.Fatalf("method mismatch: %s", r.Method)
			}
			if got := r.Header.Get("Authorization"); got != "Bearer invite-key" {
				t.Fatalf("auth header mismatch: %q", got)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
		default:
			t.Fatalf("unexpected path: %s", r.URL.EscapedPath())
		}
	}))
	defer srv.Close()

	m := inputTestModel(t)
	m.cfg.Connection = config.ConnectionSection{Host: srv.URL, AuthMethod: config.AuthInvite, Key: "invite-key"}
	cleared, err := doApplyPreset(m, " Mixed Mode ")
	if err != nil {
		t.Fatalf("apply preset failed: %v", err)
	}
	if cleared {
		t.Fatal("ordinary preset should not be reported as cleared")
	}
	if !sawCore {
		t.Fatal("expected fallback to core apply endpoint")
	}
}

func TestDispatchModelsPresetPreservesMultiWordName(t *testing.T) {
	var sawCore bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.EscapedPath() == "/api/models/routing-presets/Mixed%20Mode/apply" {
			sawCore = true
			_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
			return
		}
		http.NotFound(w, r)
	}))
	defer srv.Close()

	m := inputTestModel(t)
	m.cfg.Connection = config.ConnectionSection{Host: srv.URL, AuthMethod: config.AuthInvite, Key: "invite-key"}
	_, cmd, ok := dispatchSlash(m, "/models_preset Mixed Mode ")
	if !ok || cmd == nil {
		t.Fatalf("expected /models_preset command, ok=%v cmd=%v", ok, cmd)
	}
	msg := cmd().(presetsAppliedMsg)
	if msg.err != nil {
		t.Fatalf("apply command failed: %v", msg.err)
	}
	if !sawCore {
		t.Fatal("expected multi-word preset name to reach apply endpoint")
	}
}
