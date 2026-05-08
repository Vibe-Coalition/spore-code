# Configuration

Spore Code reads global config from `~/.spore-code/config.toml` and an optional
per-project override from `./.spore-code/config.toml`.

## Global Config

Example:

```toml
[connection]
host = "spore.example.com"
port = 443
user = "test-user"
auth_method = "device"
key = ""
password = ""
device_id = "<server-issued-device-id>"

[display]
theme = "dark"
show_thinking = true
show_tools = true
show_usage = true

[session]
auto_resume = false
```

The setup wizard writes this file with `0600` permissions.

## Connection

| Field | Purpose |
|---|---|
| `host` | Spore Core host or full URL |
| `port` | Spore Core web port when host is not a full URL |
| `user` | Spore username |
| `auth_method` | `device`, `password`, or `invite` |
| `key` | invite key, used only before migration |
| `password` | account password, used only before migration |
| `device_id` | server-issued device id |

Invite keys and account passwords are used during setup or migration. The normal
steady state is `auth_method = "device"` plus a device token stored separately.

## Device Tokens

Device tokens are stored through the OS keychain when available:

- macOS: `security` generic password,
- Linux: `secret-tool`,
- other platforms: fallback JSON file.

The fallback file is `~/.spore-code/device_tokens.json` and is written with
`0600` permissions. `spore logout` asks the server to revoke the token and then
removes local token material.

## Display

| Field | Purpose |
|---|---|
| `theme` | theme name, commonly `dark`, `oled`, or `light` |
| `show_thinking` | show thinking in activity panels |
| `show_tools` | show tool/file activity |
| `show_usage` | show token/iteration usage after turns |

Display settings can also be changed through slash commands such as `/theme` and
`/display`.

## Session

`auto_resume = false` means a plain `spore` launch creates a fresh timestamped
session. Use `spore -c` or `spore --session <id>` to resume.

`auto_resume = true` restores the older deterministic session behavior for a
given user and cwd.

## Project Config And State

Project-local `.spore-code/` holds:

- optional `config.toml` overrides,
- `index.db`,
- saved plans,
- project logs and scratch state.

Run `/init` to create `SPORE.md` and add `.spore-code/` to `.gitignore`.

## Environment Variables

| Variable | Purpose |
|---|---|
| `SPORE_CODE_ALLOW_INSECURE_AUTH` | allow credentials over non-local HTTP |
| `SPORE_CODE_VERSION` | installer version pin |
| `SPORE_CODE_DIR` | installer destination |
| `SPORE_CODE_UPDATE_BINARY` | explicit local update binary |
| `SPORE_CODE_UPDATE_DIR` | local update directory |
| `SPORE_CODE_STAGE_UPDATE` | set `0` to skip staging release binary |
| `GO` | Go binary for build scripts |
| `ZIG` | Zig binary for CGO fallback/cross-compile |
| `VERSION` | version stamp for `make build`/`make release` |
| `INCLUDE_DARWIN` | include Darwin targets in release build |

## Routing Presets

`/models_preset` fetches server routing presets and applies a preset only for
this device. `/models_preset server` clears the device override and returns to
server routing.

The client tries multiple route variants for compatibility:

- `/api/spore-code/routing-presets`,
- `/api/plugins/spore-code/routing-presets`,
- `/api/models/routing-presets`.

## Insecure Transport Guard

Spore Code refuses to send credentials or device tokens over plain HTTP except
for localhost, private LAN, loopback, and link-local addresses. Set
`SPORE_CODE_ALLOW_INSECURE_AUTH=true` only when you intentionally accept that
risk.
