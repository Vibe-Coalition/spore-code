<div align="center">
<pre>
    ███████╗██████╗  ██████╗ ██████╗ ███████╗     ██████╗ ██████╗ ██████╗ ███████╗
    ██╔════╝██╔══██╗██╔═══██╗██╔══██╗██╔════╝    ██╔════╝██╔═══██╗██╔══██╗██╔════╝
    ███████╗██████╔╝██║   ██║██████╔╝█████╗      ██║     ██║   ██║██║  ██║█████╗
    ╚════██║██╔═══╝ ██║   ██║██╔══██╗██╔══╝      ██║     ██║   ██║██║  ██║██╔══╝
    ███████║██║     ╚██████╔╝██║  ██║███████╗    ╚██████╗╚██████╔╝██████╔╝███████╗
    ╚══════╝╚═╝      ╚═════╝ ╚═╝  ╚═╝╚══════╝     ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝
</pre>
  <strong>Spore Code</strong><br>
  The terminal companion for Spore Core: local tools, project memory, and an agent in your repo.
</div>

<p align="center">
  <a href="https://github.com/Vibe-Coalition"><img alt="Vibe Coalition" src="https://img.shields.io/badge/Vibe%20Coalition-Spore%20Code-ff7a1a?style=for-the-badge"></a>
  <img alt="Status" src="https://img.shields.io/badge/status-in%20active%20development-2f855a?style=for-the-badge">
  <img alt="License" src="https://img.shields.io/badge/license-PolyForm%20NC%201.0.0-c8762c?style=for-the-badge">
  <img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-2563eb?style=for-the-badge">
  <a href="https://discord.gg/mtsQ6GrdsN"><img alt="Discord" src="https://img.shields.io/badge/Discord-join%20chat-5865F2?style=for-the-badge&logo=discord&logoColor=white"></a>
  <img alt="Vibe code welcome" src="https://img.shields.io/badge/vibe%20code-welcome-7c3aed?style=for-the-badge">
</p>

# Spore Code

Spore Code is the npm/npx terminal coding client for Spore Core. It opens in
the current project, connects to the Spore Core `spore-code` plugin over HTTP
and WebSocket, streams the conversation, and executes approved local tools on
the user's machine.

The command is `spore`. The product is Spore Code. The server plugin is
`spore-code`.

Spore Code is part of the Vibe Coalition Spore stack. It is built for the messy
middle of real coding sessions: reading a repo, asking for clarification, making
edits, running local tools where the files actually live, and carrying useful
project knowledge forward without leaking the rest of your system into the
prompt. It is a passion project and still moving fast.

PRs are welcome. Bug reports, terminal polish, protocol hardening, docs, release
automation, and vibe-coded experiments are all useful when they are clear,
reviewable, and tested. Join the
[Spore Discord](https://discord.gg/mtsQ6GrdsN) for project chat and
coordination.

## License

Spore Code is source-available under the
[PolyForm Noncommercial License 1.0.0](LICENSE). Personal, hobby, educational,
research, nonprofit, and other noncommercial uses are permitted. Commercial use
requires a separate commercial license from Vibe Coalition; see
[COMMERCIAL.md](COMMERCIAL.md).

## Install

Linux/macOS one-liner:

```sh
curl -fsSL https://raw.githubusercontent.com/Vibe-Coalition/spore-code/main/install.sh | sh
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/Vibe-Coalition/spore-code/main/install.ps1 | iex
```

Downloaded zip or local checkout on Windows:

```powershell
.\install.cmd
& "$env:APPDATA\npm\spore.cmd" # works immediately if this terminal PATH is stale
```

If you want to run the PowerShell file directly, use a process-local execution
policy bypass:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

The installers require Node.js 22+. In a downloaded zip or local checkout they
run `npm install`, build the local client, and install from that folder. In
one-liner mode they download/build the GitHub branch until the npm beta package
is published.

Optional overrides:

| Variable | Default | Purpose |
|---|---|---|
| `SPORE_CODE_SOURCE` | `auto` | `auto`, `local`, `github`, or `npm` |
| `SPORE_CODE_REF` | `work/spore-code-20260513` | GitHub branch/tag when source is `github` |
| `SPORE_CODE_VERSION` | `beta` | npm version or dist-tag when source is `npm` |
| `SPORE_CODE_PACKAGE` | `@vibe-coalition/spore-code` | npm package name |
| `SPORE_CODE_PREFIX` | npm global prefix | custom npm install prefix |

Direct npm beta install, once published:

```sh
npm install -g @vibe-coalition/spore-code@beta
spore doctor
spore smoke
spore
```

One-shot:

```sh
npx @vibe-coalition/spore-code@beta
```

Global install:

```sh
npm install -g @vibe-coalition/spore-code
spore
```

The command is still `spore`; npm is now the primary distribution path.

Legacy native-binary installers may remain available while the npm client
settles, but new users should prefer npm/npx.

## First Launch

Run `spore` from a project directory. If `~/.spore-code/config.toml` does not
exist or usable credentials are missing, the setup wizard asks for:

- Spore Core host and port,
- username,
- invite key or account password,
- theme.

Invite keys and passwords are masked while you type. The wizard exchanges
invite/password credentials for a revocable device token. Future launches use
the device token and do not need the web app open. Run `spore setup` any time
to rewrite the connection/auth config.

## Common Commands

```sh
spore                         # start a fresh session in this directory
spore -c                      # resume this project's saved session
spore --session cli:...       # resume a specific session id
spore --plan                  # start in plan mode
spore --host spore.tld --port 443 --user test-user
spore setup                   # rerun setup wizard
spore login                   # alias for setup
spore doctor                  # auth + websocket smoke check without opening UI
spore check                   # alias for doctor
spore smoke                   # live protocol smoke + beta manual checklist
spore help                    # print CLI help
spore --version
spore logout                  # clear saved credentials for configured host/user
spore --user test-user logout # clear a different scoped device token
```

Inside the terminal UI, type `/help` for the supported slash-command list.
Typing `/` opens inline command suggestions; Tab completes the selected command.
Common commands:

| Command | Purpose |
|---|---|
| `/plan` | toggle plan/execute mode |
| `/index` | ask the agent to build or refresh the local code index |
| `/architecture`, `/calls`, `/impact` | structural code navigation through local tools |
| `/scope strict\|expanded` | control file-op sandboxing |
| `/mode auto\|ask\|locked\|yolo` | control local tool approval behavior |
| `/models_preset [name\|server]` | view/apply/clear this device's routing override |
| `/stop` | interrupt the current turn |
| `/clear` | clear the visible session |

Input history is persisted in `~/.spore-code/history.jsonl`. Use Up/Down to
walk prior prompts, and Ctrl+J to insert a newline without sending. When the
slash-command menu is open, Up/Down selects commands instead of history.

Session continuity is project-local. Each launch records the active session in
`.spore-code/last_session.json`; `spore -c` and `auto_resume = true` prefer
that pointer, then fall back to the global last session for the same cwd, then
to the deterministic legacy id.

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

The npm client uses a React Ink terminal UI. It shows chat, activity, tool
approvals, `ask_user` questions, plan/execute state, plan approval, usage, and
local tool status. Approved plans are saved under `.spore-code/plans/` before
execution starts. The Go/Bubble Tea client remains in-tree as a legacy behavior
reference during the rewrite.

## Build From Source

Requires Node.js 22+.

```sh
npm install
npm test
npm run typecheck
npm run build
npm run smoke:live
node dist/bin/spore.js --version
```

The generated package binary is `dist/bin/spore.js`.

Package smoke before publishing:

```sh
npm run pack:smoke
npm pack
npm install -g ./vibe-coalition-spore-code-*.tgz
spore --version
spore doctor
spore smoke
```

The previous Go client can still be built for comparison while the rewrite is
in progress:

```sh
go test ./...
make build
```

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
src/bin/               npm binary entry point
src/ui/                React Ink terminal UI
src/transport.ts       HTTP auth and WebSocket client
src/controller.ts      session orchestration and frame handling
src/tools/             local tool executor and tool implementations
src/project-context.ts structured project context sent to Spore Core
tests/                 npm client tests
cmd/, internal/        legacy Go client reference during the rewrite
```

## Compatibility

Spore Code requires a Spore Core server with the `spore-code` plugin installed.
Older servers without `/api/spore-code/auth` and `/api/spore-code/session` will
reject setup or session creation.
