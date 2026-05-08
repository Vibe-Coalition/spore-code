# For AI Coding Assistants

This repository is the Go TUI client for Spore Code. It is a local execution
boundary: the server can ask for tool calls, but this client decides which tools
it owns and executes them on the user's machine.

## Read This First

- Do not treat local runtime directories as source. Ignore `.spore-code/`,
  `dist/`, generated binaries, logs, caches, and local config.
- Prefer source files under `cmd/spore/` and `internal/`.
- Do not hard-code private hosts, usernames, paths, tokens, or cluster names.
- Keep Spore Code's tool catalog honest. If a tool should not be available to
  CLI sessions, remove or gate it at the protocol/catalog boundary rather than
  adding prompt text that asks the model not to use it.
- Use focused tests. This repo has targeted tests for TUI behavior, question
  parsing, tool execution, config, websocket auth, code indexing, and updates.

## High-Value Files

| Area | Files |
|---|---|
| CLI entrypoint and setup | `cmd/spore/main.go`, `cmd/spore/wizard.go`, `cmd/spore/picker.go` |
| TUI model/update/view | `internal/app/model.go`, `internal/app/update.go`, `internal/app/view.go` |
| Slash commands | `internal/app/slash.go`, `internal/app/commands.go`, `internal/app/legacy_cmds.go` |
| Questions, plans, permissions | `internal/app/questions.go`, `internal/app/plan.go`, `internal/app/permissions.go` |
| Themes and panels | `internal/app/themes.go`, `internal/app/sidepanels.go`, `internal/app/permmodal.go` |
| Protocol | `internal/proto/messages.go`, `internal/conn/ws.go` |
| Config and credentials | `internal/config/config.go`, `internal/config/secretstore.go` |
| Local tool ownership | `internal/tools/executor.go`, `internal/tools/fileops.go`, `internal/tools/shell.go` |
| Code index | `internal/codeindex/`, `internal/tools/codeindex.go` |
| Build/release | `Makefile`, `scripts/*.sh`, `install.sh`, `install.ps1` |

## Tool Ownership Rules

Spore Code owns local tools:

- `exec`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`,
- `list_dir`, `read_many_files`, `git_status`, `git_diff`, `patch_file`,
  `run_tests`,
- `bg_list`, `bg_tail`, `bg_kill`,
- `index_codebase`, `search_symbols`, `get_snippet`, `architecture`,
  `trace_calls`, `impact`, `verify_implementation`, `code_overview`,
  `trace_path`, `code_diff`.

Server tools are not claimed locally. That includes graph memory, channels,
browser automation, remote SSH, wakeups, settings, web search, and custom server
tools. Unknown tools are also not claimed locally.

When changing this split, update `internal/tools/executor.go`, protocol docs,
and tests together.

## Common Checks

```sh
go test ./...
scripts/test.sh
go test ./internal/tools ./internal/app
go test ./internal/codeindex
git diff --check
```

Use `scripts/test.sh` when the host may need Zig as the CGO compiler fallback.

## Documentation

When changing public behavior, update the docs:

- slash commands: `docs/tui.md`,
- local/server tool ownership: `docs/tools.md`,
- protocol frames: `docs/protocol.md`,
- config/device tokens/routing presets: `docs/configuration.md`,
- build/release flow: `docs/releases.md`,
- security-sensitive behavior: `docs/security.md`.
