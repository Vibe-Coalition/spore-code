# Releases

Spore Code releases are static Go binaries named for the target OS and
architecture.

## Requirements

- Go 1.25+,
- CGO-capable C compiler for local builds,
- Zig 0.13+ for cross-compiling release binaries.

Tree-sitter grammars require CGO, so pure `CGO_ENABLED=0` builds are not the
normal release path.

## Local Build

```sh
make build
```

This creates `./spore`. If `cc` or `gcc` exists, Make uses it. Otherwise it
falls back to `zig cc`.

Install locally:

```sh
make install
```

## Script Build

```sh
scripts/build.sh
scripts/test.sh
scripts/release.sh
```

The scripts are useful on hosts without Make or without a system C compiler.

## Version Stamping

`scripts/version.sh` derives the version from git. Override with:

```sh
VERSION=v1.0.40 make build
VERSION=v1.0.40 make release
```

The version is injected with:

```text
-ldflags "-X main.version=<version>"
```

## Release Build

```sh
make release
```

Default outputs:

```text
dist/spore-linux-amd64
dist/spore-linux-arm64
dist/spore-windows-amd64.exe
dist/spore-windows-arm64.exe
```

Include Darwin targets:

```sh
INCLUDE_DARWIN=1 make release
```

Linux targets are built static with musl. Windows targets use the Zig MinGW
target. Darwin targets require compatible SDK support.

## Local Update Staging

`scripts/release.sh` stages the current-platform binary to:

```text
~/.spore-code/updates
```

unless:

```sh
SPORE_CODE_STAGE_UPDATE=0 scripts/release.sh
```

The running client can install a staged binary with:

```text
/update install local
```

Useful environment overrides:

| Variable | Purpose |
|---|---|
| `SPORE_CODE_UPDATE_BINARY` | exact local binary to install |
| `SPORE_CODE_UPDATE_DIR` | directory containing target-named binary |
| `SPORE_CODE_STAGE_UPDATE` | disable/enable staging |

## In-App Update Commands

```text
/update check
/update install
/update install pre
/update install local
/update list
```

Linux/macOS replace the running binary atomically. Windows schedules the
replacement because a running `.exe` cannot be overwritten.

## Release Checklist

1. Confirm working tree only contains intended changes.
2. Run `go test ./...` or `scripts/test.sh`.
3. Run `git diff --check`.
4. Build with explicit `VERSION`.
5. Run the built binary with `--version`.
6. Upload the expected assets to the GitHub release.
