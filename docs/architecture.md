# Architecture

Spore Code is an npm/npx TypeScript client built around a React Ink terminal
UI. It connects to Spore Core, sends project context, receives chat/tool frames
over WebSocket, and executes only the local tools it owns.

## Runtime Shape

```text
src/bin/spore.tsx
  -> load config / run setup wizard
  -> resolve session id
  -> create SporeController + Ink UI
  -> authenticate with Spore Core
  -> open WebSocket
  -> send session:start + projectContext
  -> render chat and execute local tool requests
```

Key packages:

| Package | Role |
|---|---|
| `src/bin` | npm binary entry point |
| `src/ui` | React Ink terminal UI |
| `src/controller.ts` | session orchestration, slash commands, frame handling |
| `src/transport.ts` | HTTP auth, WebSocket connect/reconnect, frame routing |
| `src/protocol.ts` | typed protocol interfaces |
| `src/tools` | local tool ownership and implementations |
| `src/project-context.ts` | structured project metadata |
| `src/session.ts` | local JSONL transcript/debug logs |
| `cmd`, `internal` | legacy Go client reference during the rewrite |

## Startup Flow

1. Parse flags and commands in `src/bin/spore.tsx`.
2. Load `~/.spore-code/config.toml` plus optional project override.
3. Run setup wizard when config or credentials are missing, or when `spore setup`
   is called explicitly.
4. Exchange invite/password credentials for a device token when possible.
5. Ensure local project directories under `.spore-code/`.
6. Resolve the session:
   - `--session` uses an explicit id,
   - `-c`/`--continue` resumes `.spore-code/last_session.json` when present,
   - global last-session fallback is used only when it points at the same cwd,
   - no flag starts fresh unless `auto_resume = true`.
7. Create the controller and start the Ink terminal UI.
8. Authenticate, connect WebSocket, request history, and send `session:start`.

`spore doctor` follows the same auth and WebSocket path but exits after the
capability handshake, which makes it useful for smoke-testing a new install.

## WebSocket Client

`src/transport.ts` owns:

- `/api/spore-code/auth` and `/api/spore-code/session` authentication,
- `/ws?token=...` connection,
- read loop,
- reconnect with exponential backoff,
- outbound outbox for frames queued during disconnect,
The controller routes `tool:request` frames to the local executor and sends
`tool:result` frames back to Core.

Normal frames update Ink state. Tool requests run asynchronously so local
execution does not block protocol parsing.

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

## Terminal UI

`src/controller.ts` owns the session state, and `src/ui/App.tsx` renders it:

- connection status and server capabilities,
- chat messages and streaming tail,
- current session id and cwd,
- plan/execute mode,
- permission and question modals,
- activity/status, usage, and local tool status.

The previous Go/Bubble Tea UI remains as a reference while the npm UI catches
up on polish surfaces such as code panels, autocomplete, and richer display
settings.

## Tool Ownership

The executor has two explicit maps:

- local tools Spore Code executes on the user's machine,
- server tools that must be left for Spore Core.

When a server asks for a local tool, the executor prompts for dangerous or
mutating tools, runs the implementation, and returns `tool:result`. When a tool
is server-owned or unknown, the CLI does not execute it locally.

See [Tools](tools.md).

## Code Index

The npm code index lives at `.spore-code/index.json` in the project. It is
populated by `src/tools/code-index.ts` and exposed through local tools such as
`search_symbols`, `get_snippet`, `architecture`, and `impact`.

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
| `.spore-code/index.json` | npm project code index |
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
