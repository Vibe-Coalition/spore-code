# TUI

Spore Code now uses React Ink for the npm/npx terminal UI. The legacy Go/Bubble
Tea UI remains in-tree as a behavior reference while the npm client catches up
on advanced panels.

## Layout

The main view contains:

- header with connection/session/mode status,
- chat transcript,
- optional activity panel,
- optional output log,
- latest file/diff artifact preview,
- input area or active modal,
- usage/status line.

## Input

- Enter sends the current message.
- Ctrl+J inserts a newline without sending.
- Up/Down walks persisted command history from `~/.spore-code/history.jsonl`.
- Ctrl+C stops an active generation; when idle, it exits.
- Ctrl+P toggles the activity panel.
- Ctrl+O toggles the command output panel.
- Tab cycles scroll focus between chat, activity, and output.
- PageUp/PageDown or Ctrl+U/Ctrl+D scroll the focused panel.
- Home/End jumps to the oldest/newest content in the focused panel.

## Slash Commands

| Command | Purpose |
|---|---|
| `/help` | show command list |
| `/clear` | clear chat |
| `/quit` | exit |
| `/stop` | stop current generation |
| `/plan` | toggle plan mode |
| `/scope` | set file-op sandbox scope |
| `/mode` | set local tool approval mode |
| `/models_preset` | view/apply/clear this device's routing override |
| `/index` | build/refresh code index |
| `/architecture` | show code architecture summary |
| `/calls` | show symbol-level call hints |
| `/impact` | show symbol-level impact hints |

## Plan Mode

Plan mode is signaled through `projectContext.mode = "plan"`. A response with a
standalone `PLAN_READY` marker opens the plan approval modal.

Approval choices:

- execute the plan,
- revise with feedback,
- cancel.

Approved plans are saved to `.spore-code/plans/` before execution begins so the
project has a local artifact for review or later handoff.

## Questions

The npm UI has one question modal for structured server `ask_user` frames and
CLI plan-mode `QUESTIONS:` blocks.

Supported question types:

- single select,
- multi select,
- open-ended.

Structured `ask_user` answers return as `ask_user_answer`. Plan-mode question
answers are sent back as a normal chat message so the planner can continue the
workflow.

## Permissions

The permission modal appears when local tool execution requires user approval.
It shows the tool, summary, and proposed session rule. The choices are:

- `y` or Enter: allow this single call,
- `a`: allow matching calls for the current session,
- `n` or Esc: deny.

Companion surfaces receive
`tool:awaiting-approval` and `tool:approval-resolved` broadcasts.

## Compaction Status

When Spore Core compacts long sessions, `chat:status` frames can include token
counts and remaining context percent. The npm UI surfaces these status messages
in the header/status line.
