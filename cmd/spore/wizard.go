package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
	"golang.org/x/term"

	"github.com/yumlevi/spore-code/internal/app"
	"github.com/yumlevi/spore-code/internal/config"
)

// runSetupWizard is the Go port of acorn/config.py:run_setup_wizard.
// Writes ~/.spore-code/config.toml. Tests auth with the entered credentials
// before saving, offering the user a chance to continue anyway on failure.
func runSetupWizard() (*config.Config, error) {
	restoreTerminal := guardSetupTerminal()
	defer restoreTerminal()

	rd := bufio.NewReader(os.Stdin)
	home, _ := os.UserHomeDir()
	globalDir := filepath.Join(home, ".spore-code")

	// One-shot migration: legacy ~/.acorn/ → ~/.spore-code/. If the new
	// global dir doesn't exist yet but the old one does, copy contents
	// over and leave a MIGRATED.md breadcrumb so the operator can find
	// the old data if anything seems off after the rename. Best-effort:
	// failures here just mean the user goes through fresh setup.
	if home != "" {
		legacyDir := filepath.Join(home, ".acorn")
		if _, err := os.Stat(globalDir); os.IsNotExist(err) {
			if _, err := os.Stat(legacyDir); err == nil {
				if err := copyDirRecursive(legacyDir, globalDir); err == nil {
					_ = os.WriteFile(filepath.Join(legacyDir, "MIGRATED.md"),
						[]byte("# Migrated to ~/.spore-code/\n\nSpore Code (formerly acorn) renamed its global config dir to ~/.spore-code/.\nContents of this directory were copied there on the first run of `spore`. You can safely delete this directory once you've confirmed the new location works.\n"),
						0o644)
					fmt.Println()
					fmt.Println("Migrated ~/.acorn/ → ~/.spore-code/  (legacy dir kept; see ~/.acorn/MIGRATED.md)")
				}
			}
		}
	}

	fmt.Println()
	fmt.Println("╔════════════════════════════════════════╗")
	fmt.Println("║  Spore Code — first-time setup          ║")
	fmt.Println("╚════════════════════════════════════════╝")
	fmt.Println()

	// 1. Host + port
	fmt.Println("1. Connect to Spore Core")
	fmt.Println("   Enter your Spore Core server address.")
	fmt.Println("   Examples: 192.168.1.78 · https://spore.example.com")
	host, port := promptEndpoint(rd, "localhost", 18810)
	fmt.Println()

	// 2. User
	fmt.Println("2. Your identity")
	fmt.Println("   Choose a username — the agent will remember you by this name.")
	user := ""
	for user == "" {
		user = strings.TrimSpace(prompt(rd, "   Username", ""))
		if user == "" {
			fmt.Println("   Username is required.")
		}
	}
	fmt.Println()

	// 3. Authentication
	fmt.Println("3. Authentication")
	fmt.Println("   Paste either your invite key or your Spore account password.")
	secret := promptLoginSecret(rd, "")
	authMethod := config.AuthInvite
	key := ""
	password := ""
	deviceToken := ""
	deviceID := ""
	fmt.Println()

	// 4. Test
	for {
		fmt.Println("4. Testing connection…")
		if detected, err := testAuthAuto(host, port, user, secret); err != nil {
			fmt.Printf("   ✗ %s\n", err)
			if confirm(rd, "   Edit details and retry?", true) {
				host, port = promptEndpoint(rd, host, port)
				for {
					nextUser := strings.TrimSpace(prompt(rd, "   Username", user))
					if nextUser != "" {
						user = nextUser
					}
					if user != "" {
						break
					}
					if user == "" {
						fmt.Println("   Username is required.")
					}
				}
				secret = promptLoginSecret(rd, secret)
				fmt.Println()
				continue
			}
			return nil, fmt.Errorf("setup aborted")
		} else {
			if detected.DeviceToken == "" {
				return nil, fmt.Errorf("server authenticated but did not issue a device token; update Spore Core and retry")
			}
			authMethod = config.AuthDevice
			deviceToken = detected.DeviceToken
			deviceID = detected.DeviceID
			key = ""
			password = ""
			fmt.Println("   ✓ Connected and authenticated successfully.")
		}
		break
	}
	fmt.Println()

	// 5. Theme — show the current palette with swatches so the
	// user can preview the choice before picking.
	fmt.Println("5. Choose a theme")
	all := app.AllThemes()
	for _, t := range all {
		swatch := lipgloss.JoinHorizontal(lipgloss.Top,
			swatchCell(t.Accent),
			swatchCell(t.Accent2),
			swatchCell(t.Success),
			swatchCell(t.Warning),
			swatchCell(t.Error),
			swatchCell(t.Muted),
		)
		name := t.Name
		if t.Icon != "" {
			name = t.Icon + " " + name
		}
		// Pad the name column so swatches line up.
		fmt.Printf("   %-14s %s\n", name, swatch)
	}
	themes := app.ThemeNames()
	theme := prompt(rd, "   Theme", "dark")
	if !contains(themes, theme) {
		theme = "dark"
	}
	fmt.Println()

	// 6. Save
	cfg := &config.Config{
		Connection: config.ConnectionSection{Host: host, Port: port, User: user, AuthMethod: authMethod, Key: key, Password: password, DeviceID: deviceID},
		Display:    config.DisplaySection{Theme: theme},
		GlobalDir:  globalDir,
	}
	if deviceToken != "" {
		if err := config.SaveDeviceToken(cfg, deviceToken); err != nil {
			return nil, fmt.Errorf("save device token: %w", err)
		}
	}
	if err := config.Save(cfg); err != nil {
		return nil, fmt.Errorf("save config: %w", err)
	}
	fmt.Printf("   ✓ Saved to %s\n\n", filepath.Join(globalDir, "config.toml"))
	return cfg, nil
}

// guardSetupTerminal recovers terminals left in no-echo/raw mode by an
// interrupted prior wizard run, then catches Ctrl+C during this run so the
// password prompt cannot leave the terminal unusable again.
func guardSetupTerminal() func() {
	fd := int(os.Stdin.Fd())
	if term.IsTerminal(fd) {
		terminalSane()
	}
	state, _ := term.GetState(fd)
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt)
	done := make(chan struct{})
	go func() {
		select {
		case <-sigCh:
			if state != nil {
				_ = term.Restore(fd, state)
			}
			terminalSane()
			fmt.Fprintln(os.Stderr, "\nsetup cancelled")
			os.Exit(130)
		case <-done:
		}
	}()
	return func() {
		close(done)
		signal.Stop(sigCh)
		if state != nil {
			_ = term.Restore(fd, state)
		}
	}
}

func terminalSane() {
	if _, err := exec.LookPath("stty"); err != nil {
		return
	}
	cmd := exec.Command("stty", "sane")
	cmd.Stdin = os.Stdin
	_ = cmd.Run()
}

func prompt(rd *bufio.Reader, label, def string) string {
	if def != "" {
		fmt.Printf("%s [%s]: ", label, def)
	} else {
		fmt.Printf("%s: ", label)
	}
	line, _ := rd.ReadString('\n')
	line = cleanPromptLine(line)
	if line == "" {
		return def
	}
	return line
}

func promptEndpoint(rd *bufio.Reader, defaultHost string, defaultPort int) (string, int) {
	host := prompt(rd, "   Host", defaultHost)
	port := defaultPort
	if !strings.Contains(host, "://") {
		portStr := prompt(rd, "   Port", strconv.Itoa(defaultPort))
		if p, err := strconv.Atoi(portStr); err == nil && p > 0 {
			port = p
		}
	}
	return host, port
}

func promptLoginSecret(rd *bufio.Reader, existing string) string {
	for {
		secret := strings.TrimSpace(promptPassword(rd, "   Invite key or account password", existing != ""))
		if secret != "" {
			return secret
		}
		if existing != "" {
			return existing
		}
		fmt.Println("   Invite key or account password is required.")
	}
}

func promptPassword(rd *bufio.Reader, label string, hasExisting bool) string {
	if hasExisting {
		fmt.Printf("%s [keep existing; paste replacement or enter to keep]: ", label)
	} else {
		fmt.Printf("%s: ", label)
	}
	if term.IsTerminal(int(os.Stdin.Fd())) {
		data, _ := term.ReadPassword(int(os.Stdin.Fd()))
		fmt.Println()
		return cleanPromptLine(string(data))
	}
	line, _ := rd.ReadString('\n')
	return cleanPromptLine(line)
}

func cleanPromptLine(line string) string {
	line = strings.TrimRight(line, "\r\n")
	// Some terminals paste bracketed text as ESC[200~...ESC[201~ when a
	// previous alt-screen app left bracketed paste enabled. Strip those
	// wrappers so secrets pasted during setup remain valid.
	line = strings.ReplaceAll(line, "\x1b[200~", "")
	line = strings.ReplaceAll(line, "\x1b[201~", "")
	return line
}

func confirm(rd *bufio.Reader, label string, def bool) bool {
	suffix := "[y/N]"
	if def {
		suffix = "[Y/n]"
	}
	fmt.Printf("%s %s: ", label, suffix)
	line, _ := rd.ReadString('\n')
	line = strings.ToLower(strings.TrimSpace(line))
	if line == "" {
		return def
	}
	return line == "y" || line == "yes"
}

// swatchCell renders one colored block for the wizard theme picker.
func swatchCell(c lipgloss.Color) string {
	return lipgloss.NewStyle().Background(c).Render("  ")
}

func contains(xs []string, s string) bool {
	for _, x := range xs {
		if x == s {
			return true
		}
	}
	return false
}

type authAttempt struct {
	Method      string
	DeviceToken string
	DeviceID    string
}

func setupAuthTransportAllowed(base string) bool {
	u, err := url.Parse(base)
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
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast()
	}
	return strings.EqualFold(os.Getenv("SPORE_CODE_ALLOW_INSECURE_AUTH"), "true") || os.Getenv("SPORE_CODE_ALLOW_INSECURE_AUTH") == "1"
}

// testAuth POSTs to /api/spore-code/auth to validate credentials and request
// a revocable device token. It does not establish the WS.
func testAuth(host string, port int, user, authMethod, key, password string) (authAttempt, error) {
	base := host
	if !strings.Contains(host, "://") {
		base = fmt.Sprintf("http://%s:%d", host, port)
	}
	base = strings.TrimRight(base, "/")
	if !setupAuthTransportAllowed(base) {
		return authAttempt{}, fmt.Errorf("refusing to send credentials over insecure HTTP to %s (use HTTPS, localhost/private LAN, or SPORE_CODE_ALLOW_INSECURE_AUTH=true)", base)
	}
	authBody := map[string]any{"username": user, "issueDevice": true}
	if authMethod == config.AuthPassword {
		authBody["authMethod"] = config.AuthPassword
		authBody["password"] = password
	} else {
		authBody["key"] = key
	}
	payload, _ := json.Marshal(authBody)
	req, _ := http.NewRequestWithContext(
		context.Background(), "POST", base+"/api/spore-code/auth", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return authAttempt{}, fmt.Errorf("cannot reach server: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		var e struct {
			Error string `json:"error"`
		}
		_ = json.Unmarshal(body, &e)
		if e.Error != "" {
			return authAttempt{}, fmt.Errorf("%s", e.Error)
		}
		return authAttempt{}, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	var ok struct {
		DeviceToken string `json:"deviceToken"`
		DeviceID    string `json:"deviceId"`
	}
	_ = json.Unmarshal(body, &ok)
	return authAttempt{Method: authMethod, DeviceToken: ok.DeviceToken, DeviceID: ok.DeviceID}, nil
}

func testAuthAuto(host string, port int, user, secret string) (authAttempt, error) {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return authAttempt{}, fmt.Errorf("invite key or account password is required")
	}
	passwordAttempt, passwordErr := testAuth(host, port, user, config.AuthPassword, "", secret)
	if passwordErr == nil {
		return passwordAttempt, nil
	}
	inviteAttempt, inviteErr := testAuth(host, port, user, config.AuthInvite, secret, "")
	if inviteErr == nil {
		return inviteAttempt, nil
	}
	return authAttempt{}, fmt.Errorf("account password failed (%s); invite key failed (%s)", passwordErr, inviteErr)
}

// copyDirRecursive copies src → dst, creating dst if needed. Used for
// the one-shot ~/.acorn/ → ~/.spore-code/ migration on first run after
// the rebrand. Best-effort: errors propagate up so the wizard can fall
// through to fresh setup if the copy fails.
func copyDirRecursive(src, dst string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, info.Mode())
		}
		// Skip the breadcrumb file if a previous run already wrote it.
		if filepath.Base(path) == "MIGRATED.md" {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		return os.WriteFile(target, data, info.Mode())
	})
}
