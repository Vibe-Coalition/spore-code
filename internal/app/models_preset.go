package app

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/Vibe-Coalition/spore-code/internal/config"
)

// presetsFetchedMsg carries the list of preset names from the backend.
type presetsFetchedMsg struct {
	names  []string
	err    error
	silent bool
}

func fetchPresets(m *Model) tea.Msg {
	return fetchPresetsWithMode(m, false)
}

func fetchPresetsSilently(m *Model) tea.Msg {
	return fetchPresetsWithMode(m, true)
}

func fetchPresetsWithMode(m *Model, silent bool) tea.Msg {
	base := m.baseURL()
	if !authTransportAllowed(base) {
		return presetsFetchedMsg{err: fmt.Errorf("refusing to fetch presets over insecure HTTP to %s", base), silent: silent}
	}

	token := m.authToken()
	if token == "" {
		return presetsFetchedMsg{err: fmt.Errorf("no auth token available for preset fetch"), silent: silent}
	}

	resp, err := doPresetRequest("GET", base, token, []presetRequestSpec{
		{path: "/api/spore-code/routing-presets"},
		{path: "/api/plugins/spore-code/routing-presets"},
		{path: "/api/models/routing-presets"},
	})
	if err != nil {
		return presetsFetchedMsg{err: fmt.Errorf("fetch presets: %w", err), silent: silent}
	}
	defer resp.Body.Close()

	var result struct {
		OK      bool `json:"ok"`
		Presets []struct {
			Name string `json:"name"`
		} `json:"presets"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return presetsFetchedMsg{err: err, silent: silent}
	}

	names := make([]string, 0, len(result.Presets))
	for _, p := range result.Presets {
		if p.Name != "" {
			names = append(names, p.Name)
		}
	}
	return presetsFetchedMsg{names: names, silent: silent}
}

// presetsAppliedMsg is sent after applying a preset via the backend.
type presetsAppliedMsg struct {
	name    string
	cleared bool
	err     error
}

func applyPresetCmd(m *Model, name string) tea.Cmd {
	return func() tea.Msg {
		cleared, err := doApplyPreset(m, name)
		return presetsAppliedMsg{
			name:    name,
			cleared: cleared,
			err:     err,
		}
	}
}

func doApplyPreset(m *Model, name string) (bool, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return false, fmt.Errorf("preset name is required")
	}
	base := m.baseURL()
	if !authTransportAllowed(base) {
		return false, fmt.Errorf("refusing to apply preset over insecure HTTP to %s", base)
	}

	token := m.authToken()
	if token == "" {
		return false, fmt.Errorf("no auth token available")
	}

	if isServerPresetResetName(name) {
		resp, err := doPresetRequest("DELETE", base, token, []presetRequestSpec{
			{path: "/api/spore-code/routing-presets/current"},
			{path: "/api/plugins/spore-code/routing-presets/current"},
		})
		if err != nil {
			return false, err
		}
		defer resp.Body.Close()
		return true, nil
	}

	payload, _ := json.Marshal(map[string]string{"name": name})
	encodedName := url.PathEscape(name)
	resp, err := doPresetRequest("POST", base, token, []presetRequestSpec{
		{path: "/api/spore-code/routing-presets/apply", body: payload},
		{path: "/api/plugins/spore-code/routing-presets/apply", body: payload},
		{path: "/api/models/routing-presets/" + encodedName + "/apply"},
	})
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	return false, nil
}

type presetRequestSpec struct {
	path string
	body []byte
}

func doPresetRequest(method, base, token string, specs []presetRequestSpec) (*http.Response, error) {
	var lastErr error
	for _, spec := range specs {
		var body io.Reader
		if spec.body != nil {
			body = bytes.NewReader(spec.body)
		}
		req, err := http.NewRequest(method, base+spec.path, body)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+token)
		if spec.body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return nil, err
		}
		if resp.StatusCode == http.StatusOK {
			return resp, nil
		}
		lastErr = presetHTTPError(resp)
		resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			return nil, lastErr
		}
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, fmt.Errorf("no preset routes configured")
}

func presetHTTPError(resp *http.Response) error {
	if resp == nil {
		return fmt.Errorf("HTTP request failed")
	}
	msg := fmt.Sprintf("HTTP %d", resp.StatusCode)
	if resp.Body != nil {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		var parsed struct {
			Error string `json:"error"`
			Name  string `json:"name"`
		}
		if len(body) > 0 && json.Unmarshal(body, &parsed) == nil && parsed.Error != "" {
			msg = fmt.Sprintf("HTTP %d: %s", resp.StatusCode, parsed.Error)
			if parsed.Name != "" {
				msg += " (" + parsed.Name + ")"
			}
		}
	}
	return fmt.Errorf("%s", msg)
}

func isServerPresetResetName(name string) bool {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "default", "server", "server-default", "reset", "clear":
		return true
	default:
		return false
	}
}

// handleModelsPreset processes /models_preset <NAME>.
func handleModelsPreset(m *Model, args []string) (tea.Model, tea.Cmd) {
	if len(args) == 0 {
		if len(m.presetNames) == 0 {
			m.pushChat("system", "No presets loaded. Fetching...")
			return m, func() tea.Msg { return fetchPresets(m) }
		}
		list := strings.Join(m.presetNames, ", ")
		m.pushChat("system", fmt.Sprintf("Available presets: %s\nUsage: /models_preset <name> (device only) or /models_preset server", list))
		return m, nil
	}

	name := strings.TrimSpace(strings.Join(args, " "))
	if name == "" {
		return handleModelsPreset(m, nil)
	}
	if isServerPresetResetName(name) {
		m.pushChat("system", "Clearing device preset override; this CLI will use server routing again.")
		return m, applyPresetCmd(m, name)
	}
	m.pushChat("system", "Applying preset: "+name)
	return m, applyPresetCmd(m, name)
}

// authTransportAllowed mirrors conn/authTransportAllowed to avoid importing conn
// from app (which already imports conn indirectly).
func authTransportAllowed(baseURL string) bool {
	u, err := url.Parse(baseURL)
	if err != nil {
		return false
	}
	if strings.EqualFold(u.Scheme, "https") {
		return true
	}
	host := u.Hostname()
	if host == "localhost" || host == "127.0.0.1" || host == "::1" {
		return true
	}
	ip := net.ParseIP(host)
	if ip != nil {
		return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast()
	}
	env := strings.TrimSpace(os.Getenv("SPORE_CODE_ALLOW_INSECURE_AUTH"))
	return strings.EqualFold(env, "true") || env == "1"
}

// ── helpers on Model ──

func (m *Model) baseURL() string {
	base := m.cfg.Connection.Host
	if !strings.Contains(base, "://") {
		base = fmt.Sprintf("http://%s:%d", base, m.cfg.Connection.Port)
	}
	return strings.TrimRight(base, "/")
}

func (m *Model) authToken() string {
	if m.cfg.Connection.Method() == config.AuthDevice {
		if tok, err := config.LoadDeviceToken(m.cfg); err == nil {
			return tok
		}
	}
	if m.cfg.Connection.Method() == config.AuthInvite {
		return m.cfg.Connection.Key
	}
	return ""
}

// ── slash command registration ──

func init() {
	register(&slashCmd{
		Name:    "/models_preset",
		Help:    "List or apply a model routing preset to this device (e.g. /models_preset fast, /models_preset server)",
		Handler: handleModelsPreset,
	})
}
