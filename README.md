<p align="center">
  <img src="assets/spore-logo.svg" alt="Spore logo" width="96" height="96"><br>
  <strong>Spore Code</strong><br>
  The terminal companion for Spore Core: local tools, project memory, and an agent in your repo.
</p>

<p align="center">
  <a href="https://github.com/Vibe-Coalition"><img alt="Vibe Coalition" src="https://img.shields.io/badge/Vibe%20Coalition-Spore%20Code-ff7a1a?style=for-the-badge"></a>
  <img alt="Status" src="https://img.shields.io/badge/status-in%20active%20development-2f855a?style=for-the-badge">
  <img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-2563eb?style=for-the-badge">
  <img alt="Vibe code welcome" src="https://img.shields.io/badge/vibe%20code-welcome-7c3aed?style=for-the-badge">
</p>

# Spore Code

Spore Code is the terminal coding client for Spore Core. It opens a TUI in the
current project, connects to the Spore Core `spore-code` plugin over HTTP and
WebSocket, streams the conversation, and executes approved local tools on the
user's machine.

The command is `spore`. The product is Spore Code. The server plugin is
`spore-code`.

Spore Code is part of the Vibe Coalition Spore stack. It is built for the messy
middle of real coding sessions: reading a repo, asking for clarification, making
edits, running local tools where the files actually live, and carrying useful
project knowledge forward without leaking the rest of your system into the
prompt. It is a passion project and still moving fast.

PRs are welcome. Bug reports, terminal polish, protocol hardening, docs, release
automation, and vibe-coded experiments are all useful when they are clear,
reviewable, and tested. Discord is available for project chat and coordination;
a public invite link will be added here once it is finalized.

## Install

Linux:

```sh
curl -fsSL https://raw.githubusercontent.com/Vibe-Coalition/spore-code/main/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/Vibe-Coalition/spore-code/main/install.ps1 | iex
```

Optional installer overrides:

| Variable | Default | Purpose |
|---|---|---|
| `SPORE_CODE_VERSION` | `latest` | Install a specific release tag |
| `SPORE_CODE_DIR` | `~/.local/bin` or `%USERPROFILE%\.spore-code\bin` | Install directory |

## First Launch

Run `spore` from a project directory. If `~/.spore-code/config.toml` does not
exist, the setup wizard asks for:

- Spore Core host and port,
- username,
- invite key or account password,
- theme.

The wizard exchanges invite/password credentials for a revocable device token.
Future launches use the device token and do not need the web app open.

## Common Commands

```sh
spore                         # start a fresh session in this directory
spore -c                      # resume a previous project session
spore --session cli:...       # resume a specific session id
spore --plan                  # start in plan mode
spore --host spore.tld --port 443 --user yam
spore --version
spore logout                  # revoke/clear saved credentials
```

Inside the TUI, type `/help` for the full slash-command list. Common commands:

| Command | Purpose |
|---|---|
| `/plan` | toggle plan/execute mode |
| `/init` | create `SPORE.md` and add `.spore-code/` to `.gitignore` |
| `/index` | build or refresh `.spore-code/index.db` |
| `/architecture`, `/why`, `/calls`, `/impact` | structural code navigation |
| `/scope strict\|expanded` | control file-op sandboxing |
| `/mode auto\|ask\|locked\|yolo\|rules` | control tool approvals |
| `/models_preset` | apply or clear a device-local model routing preset |
| `/display` | toggle thinking, tools, and usage surfaces |
| `/update` | check, install, or list releases |
| `/logout` | clear saved credentials and exit |

## How It Works

Spore Code sends project context separately from the user message so project
metadata does not accumulate in chat history. That context includes cwd, project
name, git branch/status, `SPORE.md`, a shallow tree, available runtimes, local
tool names, plan/execute mode, scope mode, code-index status, OS/arch, and
best-effort hardware details.

Tool ownership is split:

- Spore Code owns local machine tools such as `exec`, file operations, git
  helpers, background processes, tests, and code-index lookups.
- Spore Core owns server tools such as graph memory, web search, channels,
  remote SSH, browser automation, wakeups, and settings.
- Server-owned or unknown tools are not executed locally by the CLI.

The TUI shows chat, activity, code previews, diffs, tool approvals, plan
approval, `ask_user` questions, compaction status, and output logs.

## Build From Source

Requires Go 1.25+ and a C compiler. Release cross-compiles require Zig 0.13+
because tree-sitter language grammars use CGO.

```sh
go mod tidy
make build
make install
make release
```

Script alternatives:

```sh
scripts/build.sh
scripts/test.sh
scripts/release.sh
```

Builds stamp the version from `scripts/version.sh`. Release binaries are named:

```text
spore-linux-amd64
spore-linux-arm64
spore-windows-amd64.exe
spore-windows-arm64.exe
```

Darwin builds are opt-in with `INCLUDE_DARWIN=1`.

## Documentation

- [Architecture](docs/architecture.md)
- [Configuration](docs/configuration.md)
- [Protocol](docs/protocol.md)
- [Tools](docs/tools.md)
- [TUI](docs/tui.md)
- [Security](docs/security.md)
- [Releases](docs/releases.md)
- [Contributing](CONTRIBUTING.md)
- [For AI Coding Assistants](FOR_AGENTS.md)

## Repository Layout

```text
cmd/spore/             CLI entry point, setup wizard, session picker
internal/app/          Bubble Tea TUI, commands, modals, themes, update loop
internal/conn/         HTTP auth and WebSocket client
internal/proto/        wire-protocol structs
internal/tools/        local tool executor and tool implementations
internal/codeindex/    tree-sitter walker, parser, SQLite code index
internal/config/       config, device token storage, keychain fallback
internal/sessionlog/   local JSONL session/debug logs
internal/bg/           background process manager and child lifetime handling
scripts/               build, test, release, version helpers
```

## Compatibility

Spore Code requires a Spore Core server with the `spore-code` plugin installed.
Older servers without `/api/spore-code/auth` and `/api/spore-code/session` will
reject setup or session creation.
