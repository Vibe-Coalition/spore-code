# Tools

Spore Code is the local tool owner for CLI sessions. The server may request
tools over WebSocket, but the CLI only executes tools listed as local in
`internal/tools/executor.go`.

## Local Tools

| Group | Tools |
|---|---|
| shell/files | `exec`, `read_file`, `write_file`, `edit_file`, `glob`, `grep` |
| structured file/git | `list_dir`, `read_many_files`, `git_status`, `git_diff`, `patch_file` |
| tests/background | `run_tests`, `bg_list`, `bg_tail`, `bg_kill` |
| code index | `index_codebase`, `search_symbols`, `get_snippet`, `architecture`, `trace_calls`, `impact`, `verify_implementation`, `code_overview`, `trace_path`, `code_diff` |

Local tools run on the user's machine, in the current project context, subject
to permission and scope settings.

## Server-Owned Tools

Spore Code does not execute server tools locally. Examples include:

- graph memory tools,
- message/channel tools,
- delegation/status tools,
- web search,
- browser automation,
- remote SSH,
- wakeups,
- settings/environment management,
- custom server tools,
- `ask_user`.

If the server requests a server-owned or unknown tool, the CLI leaves it for
Spore Core instead of pretending to run it locally.

## Permission Modes

Set with `/mode`:

| Mode | Behavior |
|---|---|
| `auto` | auto-approve normal tools |
| `ask` | prompt before each tool |
| `locked` | deny tools |
| `yolo` | auto-approve including dangerous commands |
| `rules` | follow per-tool allow/deny rules |

Dangerous tools and command patterns can still trigger permission UI depending
on mode and rules.

## Scope Modes

Set with `/scope`:

| Scope | Behavior |
|---|---|
| `strict` | file operations stay inside cwd |
| `expanded` | user permits broader filesystem access |

`strict` is the default. `expanded` affects local path resolution and project
context guidance.

## Shell Execution

`exec` runs through the platform shell:

- Unix: `sh -c`,
- Windows: `cmd /C`.

The executor blocks known dangerous command fragments and sensitive path
references. Long-running dev-server commands are automatically launched through
the background process manager so the tool call can return promptly.

Background process output can be inspected and killed through `/bg` or the
`bg_*` tools.

## File Operations

`read_file` supports:

- `offset`/`limit`,
- `start_line`/`end_line`,
- `line_range`,
- tail mode with negative `offset`,
- optional line numbers.

Large files over the read cap are rejected with guidance to use shell range
commands or grep. Writes and edits mark code-index files dirty where relevant.

## Patch And Tests

`patch_file` applies a git-style patch after validating paths and running a
check. `run_tests` chooses a default test command from common project files or
uses the provided command.

## Code Index Tools

`/index` and `index_codebase` populate `.spore-code/index.db`. Index-backed
tools let the agent inspect structure without repeatedly reading entire files:

- `search_symbols`: find symbols by name/kind/file/language,
- `get_snippet`: return a symbol body or file range,
- `trace_calls`: callers/callees,
- `architecture`: entry points, clusters, hot paths, tech stack,
- `impact`: transitive caller blast radius for current diff,
- `verify_implementation`: check whether expected artifacts exist and are wired,
- `code_overview`, `trace_path`, `code_diff`: graph-oriented code analysis.

## Delegation Policy

`/delegate` configures whether server-side delegation is allowed:

| Mode | Behavior |
|---|---|
| `default` | research/background allowed, main orchestration stays local |
| `off` | no delegation |
| `research` | only research-style delegation |
| `code` | research plus parallel code work |
| `all` | unrestricted delegation |

The CLI intercepts `delegate_task` requests to enforce the selected policy
before the server handles them.
