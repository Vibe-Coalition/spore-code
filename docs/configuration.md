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

The setup wizard masks invite keys and passwords while you type. It writes this
file with `0600` permissions. `spore setup` reruns the wizard, and normal launch
falls back to setup when the configured auth method is missing the required
credential material.

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

The npm client stores device tokens in `~/.spore-code/device_tokens.json` with
`0600` permissions. The file is keyed by host, port, and username. `spore
logout` clears local token material for the configured tuple; `--host`, `--port`,
and `--user` can target a different saved token. After logout, config returns to
`auth_method = "device"` with no token, so the next launch cleanly starts setup
instead of attempting an empty invite or password login.

Use `spore doctor` or `spore check` to verify the configured Core URL,
authentication, WebSocket session ticket, and advertised capabilities without
opening a chat UI. Use `spore smoke` for the wider beta smoke: auth, websocket,
capabilities, session start, history request/response, and the manual live-turn
checklist.
Use `spore help` or `spore --help` for the full CLI command list.

## Display

| Field | Purpose |
|---|---|
| `theme` | theme name, commonly `dark`, `oled`, or `light` |
| `show_thinking` | show thinking in activity panels |
| `show_tools` | show tool/file activity |
| `show_usage` | show token/iteration usage after turns |

Display settings are currently read from config. Runtime slash commands focus on
session behavior, local tool approvals, scope, code-index helpers, and routing
presets.

## Session

`auto_resume = false` means a plain `spore` launch creates a fresh timestamped
session. Use `spore -c` or `spore --session <id>` to resume.

`auto_resume = true` behaves like `spore -c`: it prefers
`.spore-code/last_session.json`, then a global last-session pointer for the same
cwd, then the deterministic legacy id for the current user/project.

## Project Config And State

Project-local `.spore-code/` holds:

- optional `config.toml` overrides,
- `index.json` for the npm client's TypeScript code index,
- `last_session.json` for project-local continuation,
- saved plans,
- project logs and scratch state.

The legacy Go client may still create `index.db` while it remains in-tree as a
reference implementation.

Global `~/.spore-code/` holds credentials, session transcripts, debug logs, and
the npm client's command history file.

## Environment Variables

| Variable | Purpose |
|---|---|
| `SPORE_CODE_ALLOW_INSECURE_AUTH` | allow credentials over non-local HTTP |
| `NODE_OPTIONS` | optional Node runtime flags |
| `npm_config_prefix` | npm global install location |

## Routing Presets

The npm client keeps the existing server-side device routing contract. The
interactive preset picker from the Go client has not been reintroduced yet; the
Core protocol and device token shape remain compatible so it can be added
without a server migration.

## Insecure Transport Guard

Spore Code refuses to send credentials or device tokens over plain HTTP except
for localhost, private LAN, loopback, and link-local addresses. Set
`SPORE_CODE_ALLOW_INSECURE_AUTH=true` only when you intentionally accept that
risk.
