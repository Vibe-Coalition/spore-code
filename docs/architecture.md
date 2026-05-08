# Architecture

Spore Code is a single Go binary built around a Bubble Tea TUI. It connects to
Spore Core, sends project context, receives chat/tool frames over WebSocket, and
executes only the local tools it owns.

## Runtime Shape

```text
cmd/spore/main.go
  -> load config / run setup wizard
  -> resolve session id
  -> create Bubble Tea model
  -> authenticate with Spore Core
  -> open WebSocket
  -> send session:start + projectContext
  -> render chat and execute local tool requests
```

Key packages:

| Package | Role |
|---|---|
| `cmd/spore` | CLI entry point, setup wizard, session picker, logout |
| `internal/app` | TUI model, view, update loop, slash commands, modals |
| `internal/conn` | HTTP auth, WebSocket connect/reconnect, frame routing |
| `internal/proto` | typed protocol structs |
| `internal/tools` | local tool ownership and implementations |
| `internal/codeindex` | tree-sitter/source index and SQLite store |
| `internal/config` | config file and device-token storage |
| `internal/sessionlog` | local JSONL transcript/debug logs |
| `internal/bg` | background process manager and child lifetime handling |

## Startup Flow

1. Parse flags and commands in `cmd/spore/main.go`.
2. Load `~/.spore-code/config.toml` plus optional project override.
3. Run setup wizard when config or credentials are missing.
4. Migrate invite/password credentials to a device token when possible.
5. Ensure local project directories under `.spore-code/`.
6. Resolve the session:
   - `--session` uses an explicit id,
   - `-c`/`--continue` resumes a project session or last session,
   - no flag starts fresh unless `auto_resume = true`.
7. Create the Bubble Tea model and start the TUI.
8. Authenticate, connect WebSocket, request history, and send `session:start`.

## WebSocket Client

`internal/conn.Client` owns:

- `/api/spore-code/auth` and `/api/spore-code/session` authentication,
- `/ws?token=...` connection,
- read loop,
- ping loop,
- reconnect with exponential backoff,
- outbound outbox for frames queued during disconnect,
- routing `tool:request` frames to the local executor.

Normal frames go to the TUI input channel. Tool requests go to the executor
channel so local execution does not block protocol parsing.

## Project Context

Spore Code sends `projectContext` as a sibling field on chat messages and on
`session:start`. This keeps project metadata out of chat history.

The context includes:

- cwd and project name,
- git branch/status/hash,
- project type,
- `SPORE.md` content,
- shallow tree,
- installed runtimes/tools,
- locally callable tool names,
- tool guidance,
- plan/execute mode,
- strict/expanded scope,
- code-index status and head,
- OS/arch,
- best-effort hardware details.

If the server does not advertise structured project context support, the client
uses the legacy text-prefix fallback.

## TUI Model

`internal/app.Model` owns the UI state:

- connection status and server capabilities,
- chat messages and streaming tail,
- current session id and cwd,
- plan/execute mode,
- permission, plan, and question modals,
- code view and diff panels,
- activity, output log, and subagent/task panels,
- command history,
- slash-command autocomplete,
- theme and display toggles.

The update loop handles Bubble Tea messages, WebSocket frames, local tool
results, reconnects, compaction status, and companion broadcasts.

## Tool Ownership

The executor has two explicit maps:

- local tools Spore Code executes on the user's machine,
- server tools that must be left for Spore Core.

When a server asks for a local tool, the executor checks permission mode, runs
the implementation, and returns `tool:result`. When a tool is server-owned or
unknown, the CLI does not execute it locally.

See [Tools](tools.md).

## Code Index

The code index lives at `.spore-code/index.db` in the project. It is a SQLite
database populated by `internal/codeindex` and exposed through local tools such
as `search_symbols`, `trace_calls`, `architecture`, and `impact`.

The walker skips build/cache/vendor noise, reads regular source files only, and
supports Go, TypeScript/JavaScript, Python, and Rust file discovery. Extractor
coverage varies by language.

## Session Logs

Spore Code writes local session/debug data under `~/.spore-code` and project
state under `.spore-code/`. These are runtime artifacts, not source files.

Useful persisted state:

| Path | Purpose |
|---|---|
| `~/.spore-code/config.toml` | global connection/display/session config |
| `~/.spore-code/device_tokens.json` | fallback device-token store |
| `~/.spore-code/sessions/` | local JSONL transcript history |
| `~/.spore-code/logs/` | debug logs |
| `.spore-code/index.db` | project code index |
| `.spore-code/plans/` | saved approved plans |
| `.spore-code/logs/` | project exec logs |

## Design Rules

- Keep local tool execution local and explicit.
- Keep project context structured, not glued into chat text when the server
  supports the structured field.
- Preserve reconnect/outbox behavior.
- Keep plan mode non-mutating until the user approves execution.
- Make UI surfaces responsive during streaming; avoid full transcript rerenders
  on every input tick.
- Update docs and tests when changing protocol, tool ownership, config, or
  modal behavior.
