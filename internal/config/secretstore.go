package config

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

const keychainService = "spore-code"

type tokenFile struct {
	Version int               `json:"version"`
	Tokens  map[string]string `json:"tokens"`
}

func deviceTokenAccount(cfg *Config) string {
	host := strings.TrimRight(cfg.Connection.Host, "/")
	return fmt.Sprintf("%s:%d/%s", host, cfg.Connection.Port, cfg.Connection.User)
}

func deviceTokenPath(cfg *Config) string {
	return filepath.Join(cfg.GlobalDir, "device_tokens.json")
}

func LoadDeviceToken(cfg *Config) (string, error) {
	account := deviceTokenAccount(cfg)
	if token, err := keychainLoad(account); err == nil && strings.TrimSpace(token) != "" {
		return strings.TrimSpace(token), nil
	}
	file, err := readTokenFile(cfg)
	if err != nil {
		return "", err
	}
	token := strings.TrimSpace(file.Tokens[account])
	if token == "" {
		return "", errors.New("device token not found")
	}
	return token, nil
}

func SaveDeviceToken(cfg *Config, token string) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return errors.New("empty device token")
	}
	account := deviceTokenAccount(cfg)
	if err := keychainSave(account, token); err == nil {
		_ = deleteDeviceTokenFromFile(cfg, account)
		return nil
	}
	file, _ := readTokenFile(cfg)
	if file.Tokens == nil {
		file.Tokens = map[string]string{}
	}
	file.Version = 1
	file.Tokens[account] = token
	return writeTokenFile(cfg, file)
}

func DeleteDeviceToken(cfg *Config) error {
	account := deviceTokenAccount(cfg)
	_ = keychainDelete(account)
	return deleteDeviceTokenFromFile(cfg, account)
}

func readTokenFile(cfg *Config) (tokenFile, error) {
	out := tokenFile{Version: 1, Tokens: map[string]string{}}
	data, err := os.ReadFile(deviceTokenPath(cfg))
	if err != nil {
		if os.IsNotExist(err) {
			return out, nil
		}
		return out, err
	}
	_ = json.Unmarshal(data, &out)
	if out.Tokens == nil {
		out.Tokens = map[string]string{}
	}
	return out, nil
}

func writeTokenFile(cfg *Config, file tokenFile) error {
	if err := os.MkdirAll(cfg.GlobalDir, 0o700); err != nil {
		return err
	}
	path := deviceTokenPath(cfg)
	data, err := json.MarshalIndent(file, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(data, '\n'), 0o600)
}

func deleteDeviceTokenFromFile(cfg *Config, account string) error {
	file, err := readTokenFile(cfg)
	if err != nil {
		return err
	}
	delete(file.Tokens, account)
	if len(file.Tokens) == 0 {
		if err := os.Remove(deviceTokenPath(cfg)); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	return writeTokenFile(cfg, file)
}

func keychainLoad(account string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	switch runtime.GOOS {
	case "darwin":
		cmd := exec.CommandContext(ctx, "security", "find-generic-password", "-s", keychainService, "-a", account, "-w")
		out, err := cmd.Output()
		return string(out), err
	case "linux":
		if _, err := exec.LookPath("secret-tool"); err != nil {
			return "", err
		}
		cmd := exec.CommandContext(ctx, "secret-tool", "lookup", "service", keychainService, "account", account)
		out, err := cmd.Output()
		return string(out), err
	default:
		return "", errors.New("no keychain backend")
	}
}

func keychainSave(account, token string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	switch runtime.GOOS {
	case "darwin":
		return exec.CommandContext(ctx, "security", "add-generic-password", "-U", "-s", keychainService, "-a", account, "-w", token).Run()
	case "linux":
		if _, err := exec.LookPath("secret-tool"); err != nil {
			return err
		}
		cmd := exec.CommandContext(ctx, "secret-tool", "store", "--label", "Spore Code device token", "service", keychainService, "account", account)
		cmd.Stdin = bytes.NewBufferString(token)
		return cmd.Run()
	default:
		return errors.New("no keychain backend")
	}
}

func keychainDelete(account string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	switch runtime.GOOS {
	case "darwin":
		return exec.CommandContext(ctx, "security", "delete-generic-password", "-s", keychainService, "-a", account).Run()
	case "linux":
		if _, err := exec.LookPath("secret-tool"); err != nil {
			return err
		}
		return exec.CommandContext(ctx, "secret-tool", "clear", "service", keychainService, "account", account).Run()
	default:
		return errors.New("no keychain backend")
	}
}
