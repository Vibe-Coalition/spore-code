# TUI

Spore Code uses Bubble Tea to render chat, activity, approvals, project context,
code views, diffs, output logs, and plan-mode workflows in the terminal.

## Layout

The main view contains:

- header with connection/session/mode status,
- chat transcript,
- optional right activity panel,
- input area or active modal,
- optional output log panel,
- optional expanded panel view.

The right panel can show tool activity, subagent progress, plan task progress,
and code previews.

## Input

- Enter sends the current message.
- Alt+Enter or Ctrl+J inserts a newline.
- Up/Down browse command history when the input is empty.
- Slash-command autocomplete appears for `/` commands.
- Shift+Tab toggles plan/execute mode.
- Ctrl+C stops an active generation; when idle, press twice to quit.

## Slash Commands

| Command | Purpose |
|---|---|
| `/help` | show command list |
| `/new` | start a fresh session |
| `/clear` | clear chat |
| `/resume` | resume a session |
| `/sessions` | list saved project sessions |
| `/quit` | exit |
| `/logout` | clear credentials and exit |
| `/stop` | stop current generation |
| `/plan` | toggle plan mode |
| `/status` | connection/session info |
| `/models_preset` | list/apply/clear device routing preset |
| `/theme` | switch theme |
| `/display` | toggle thinking/tools/usage surfaces |
| `/mode` | set tool approval mode |
| `/approve-all` | shortcut for `/mode auto` |
| `/approve-all-dangerous` | shortcut for `/mode yolo` |
| `/bg` | list/run/kill background processes |
| `/update` | check/install/list releases |
| `/delegate` | set delegation policy |
| `/context` | show project context |
| `/tree` | print project tree |
| `/init` | create `SPORE.md` and ignore `.spore-code/` |
| `/panel` | show/hide activity panel |
| `/scope` | set file-op sandbox scope |
| `/test` | run built-in UI/behavior test |
| `/index` | build/refresh code index |
| `/architecture` or `/arch` | show code architecture summary |
| `/why` | show callers of a symbol |
| `/calls` | show callees of a symbol |
| `/impact` | show change blast radius |
| `/scripts` | graph-backed project scripts |
| `/decisions` | graph-backed project decisions |

## Plan Mode

Plan mode tells the agent to inspect, ask blocking questions, and produce a plan
without editing files. A plan ending in `PLAN_READY` opens the approval modal.

Approval choices:

- execute plan,
- revise with feedback,
- cancel.

Executing saves the plan under `.spore-code/plans/`, switches to execute mode,
and sends the execution trigger with structured project context.

## Questions

The TUI has one question modal for two sources:

- structured server `ask_user` frames,
- prose `QUESTIONS:` blocks emitted by plan mode.

Supported question types:

- single select,
- multi select,
- open-ended.

For structured `ask_user`, the answer returns as `ask_user_answer`. For prose
questions, answers return as a normal chat message.

## Permissions

The permission modal appears when local tool execution requires user approval.
It shows the tool, summary, matching rule, and danger state. Companion surfaces
receive `tool:awaiting-approval` and `tool:approval-resolved` broadcasts.

## Themes

Theme names include `dark`, `oled`, `light`, and additional palette variants.
The theme system uses semantic colors for backgrounds, accents, tools, diffs,
thinking, usage, plan/execute labels, and code highlighting.

Use `/theme <name>` to switch. Use `/display` to toggle optional surfaces.

## Activity And Output

The activity panel can show:

- thinking,
- tool calls,
- code view/diff previews,
- subagent progress,
- plan task checklist.

The output log captures live exec output for the session. It is bounded and can
follow the tail while commands run.

## Compaction Status

When Spore Core compacts long sessions, `chat:status` frames can include token
counts and remaining context percent. The TUI surfaces compacting/done messages
so the user can see why the session paused.
