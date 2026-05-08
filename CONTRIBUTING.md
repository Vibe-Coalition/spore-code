# Contributing

Spore Code is a Go CLI/TUI. It connects to Spore Core, renders a terminal UI,
and executes approved local tools on the user's machine.

## Setup

Requirements:

- Go 1.25+,
- a C compiler for CGO,
- Zig 0.13+ for cross-compiling release binaries.

From the repository root:

```sh
go mod tidy
go test ./...
make build
```

If the host lacks `cc`/`gcc`, use the scripts. They fall back to `zig cc`:

```sh
scripts/test.sh
scripts/build.sh
```

## Development Workflow

- Keep source changes in tracked files under `cmd/`, `internal/`, `scripts/`,
  installers, or docs.
- Do not commit `.spore-code/`, `dist/`, local binaries, logs, config, or
  caches.
- Add focused tests for user-visible behavior changes.
- Keep protocol changes compatible with older Spore Core servers when possible.
- Update docs with behavior changes.

## Tests

Useful focused test sets:

```sh
go test ./internal/app
go test ./internal/tools
go test ./internal/codeindex
go test ./internal/conn ./internal/config
```

Before handoff:

```sh
go test ./...
git diff --check
```

Docs-only changes should run:

```sh
git diff --check
```

plus a Markdown link/stale-name sweep.

## Build And Release

Local build:

```sh
make build
```

Install to `~/.local/bin/spore`:

```sh
make install
```

Release build:

```sh
make release
```

The release target builds Linux and Windows amd64/arm64 binaries into `dist/`.
Set `INCLUDE_DARWIN=1` to include Darwin targets. Set `VERSION=vX.Y.Z` to stamp
an explicit version.

The release script stages the current-platform binary into
`~/.spore-code/updates` unless `SPORE_CODE_STAGE_UPDATE=0`.

## Security-Sensitive Areas

Changes need extra care and focused tests when they touch:

- credential migration, device tokens, logout, or keychain fallback,
- insecure HTTP guard behavior,
- local file path scope,
- shell execution, blocked paths, or background process handling,
- permission modes and approval modals,
- server/local tool ownership,
- websocket reconnect and queued outbound frames,
- `ask_user`, plan approval, or tool approval modal routing.
