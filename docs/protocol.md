# Protocol

Spore Code talks to Spore Core through a short HTTP authentication step and a
long-lived WebSocket.

## Authentication

Initial invite/password auth:

```text
POST /api/spore-code/auth
Content-Type: application/json

{
  "username": "test-user",
  "key": "invite-key"
}
```

or:

```json
{
  "username": "test-user",
  "authMethod": "password",
  "password": "..."
}
```

Device-token session auth:

```text
POST /api/spore-code/session
Authorization: Bearer <device-token>
```

Successful responses include a short-lived WebSocket token. Setup/migration
responses may also include `deviceToken` and `deviceId`.

Logout:

```text
POST /api/spore-code/logout
Authorization: Bearer <device-token>
```

## WebSocket

Connect to:

```text
/ws?token=<short-lived-token>
```

The token comes from auth/session creation. The client reconnects after
disconnects, re-authenticates, and flushes queued outbound frames.

## Core Chat Frames

Server to client:

| Type | Purpose |
|---|---|
| `capabilities` | server feature advertisement |
| `chat:history` | replay prior messages |
| `chat:start` | begin assistant turn |
| `chat:delta` | streamed assistant text |
| `chat:thinking` | streamed thinking text |
| `chat:status` | progress, tool, compaction, or waiting status |
| `chat:tool` | tool activity marker |
| `chat:done` | end of assistant turn with usage |
| `chat:error` | fatal turn error |
| `chat:busy` | session already running elsewhere |
| `chat:stopped` | stop acknowledged |
| `chat:cleared` | clear acknowledged |

Client to server:

| Type | Purpose |
|---|---|
| `chat:submit` | user message, session id, username, project context |
| `chat:history-request` | request session history |
| `chat:stop` | interrupt current turn |
| `chat:clear` | clear session |

## Project Context

`chat:submit` includes `projectContext` when the server advertises support. The
context carries project and local-machine metadata without injecting it into
chat history.

Important fields:

- `cwd`, `project`, `gitBranch`, `gitStatus`, `gitHash`,
- `projectType`, `sporeMd`, `tree`,
- `tools`, `localTools`, `toolGuidance`,
- `mode`, `scope`,
- `hasCodeIndex`, `indexHead`,
- `os`, `arch`, `hardware`.

## Session Frames

On connect, the client sends:

```json
{
  "type": "session:start",
  "sessionId": "cli:user@project-...",
  "userName": "test-user",
  "cwd": "/path/to/project",
  "startedAt": "2026-05-08T00:00:00Z",
  "clientVersion": "v1.0.33",
  "localTools": ["exec", "read_file"],
  "projectContext": {}
}
```

On graceful exit, the client sends:

```json
{
  "type": "session:end",
  "sessionId": "cli:user@project-...",
  "endedAt": "2026-05-08T00:10:00Z"
}
```

The server uses these frames for project graph/session lifecycle. Older servers
may ignore them.

## Tool Frames

Server to client:

```json
{
  "type": "tool:request",
  "id": "tool-call-id",
  "name": "read_file",
  "input": { "path": "README.md" }
}
```

Client to server:

```json
{
  "type": "tool:result",
  "id": "tool-call-id",
  "result": { "content": "..." }
}
```

The CLI only returns results for tools it owns. Server-owned tools are left for
the server.

## Questions

Structured `ask_user`:

```json
{
  "type": "ask_user",
  "qid": "q_...",
  "question": "Which path should I take?",
  "mode": "single",
  "multi": false,
  "options": [
    { "label": "A", "description": "..." }
  ]
}
```

The client supports:

- single select,
- multi select,
- open-ended/free-text mode.

The answer frame is:

```json
{
  "type": "ask_user_answer",
  "qid": "q_...",
  "answer": "..."
}
```

The server may send `ask_user_cancelled` or `ask_user_answer_ack`.

Plan-mode prose questions use a `QUESTIONS:` marker in assistant text. The CLI
parses the marker into the same question modal, then sends answers back as a
normal user message.

## Companion Broadcast Frames

The TUI broadcasts selected local state back over the WebSocket so companion
surfaces can mirror it:

- `plan:show-approval`,
- `plan:decided`,
- `plan:set-mode`,
- `state:questions`,
- `interactive:resolved`,
- `tool:awaiting-approval`,
- `tool:approval-resolved`,
- `perm:current-mode`,
- `delegate:config`.

These are UI-state notifications, not tool results.

## Compatibility Rules

- Prefer structured `projectContext` when advertised.
- Fall back to text-prefixed project context for older servers.
- Unknown inbound frames should be ignored unless they are safety-critical.
- New client behavior should tolerate older route variants where practical.
