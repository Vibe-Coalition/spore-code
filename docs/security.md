# Security

Spore Code runs tools on the user's machine. Treat it as a privileged local
execution client.

## Credential Handling

Setup uses an invite key or account password only long enough to obtain a
revocable device token. The normal steady state is:

- `~/.spore-code/config.toml` stores connection metadata and device id,
- device token is stored in the OS keychain when available,
- fallback token file is `~/.spore-code/device_tokens.json` with `0600`
  permissions.

`spore logout` revokes the server token when possible and clears local token
material.

## Transport Guard

Spore Code refuses to send credentials or device tokens over insecure HTTP
unless the target is localhost, private LAN, loopback, or link-local.

Set `SPORE_CODE_ALLOW_INSECURE_AUTH=true` only for an intentional trusted
environment.

## Local Tool Risk

Local tools can read files, write files, edit files, run shell commands, apply
patches, run tests, and start background processes. Permission mode and scope
mode are the main controls.

Recommended defaults:

- use `strict` scope for normal project work,
- use `ask` or `rules` mode when evaluating risky changes,
- use `expanded` scope only when the task genuinely needs paths outside the
  project.

## Scope

`strict` scope resolves file paths under cwd. Attempts to read/write outside cwd
are rejected. `expanded` scope disables that containment after user opt-in.

## Shell Guardrails

`exec` blocks known destructive command fragments and sensitive path references.
It also backgrounds known long-running dev-server commands to avoid hanging the
turn.

These guardrails are not a full sandbox. They reduce common accidents but do not
make untrusted prompts safe.

## Tool Ownership Boundary

Spore Code should not expose or execute server-only capabilities locally. Browser
automation, graph memory, remote SSH, webapp requests, channels, wakeups, and
settings belong to Spore Core and its plugins.

If a capability should be hidden from CLI sessions, fix the server catalog or
client ownership map. Do not rely on the model to ignore a visible tool.

## Runtime State

Do not commit:

- `.spore-code/`,
- `dist/`,
- built `spore` binaries,
- logs,
- local config,
- device tokens,
- caches.

## Safe Debugging

When diagnosing sessions:

- prefer local JSONL/log summaries over pasting secrets,
- inspect exact tool ownership and project context before assuming a leak,
- verify whether a fact came from project context, General Knowledge recall,
  session history, or the visible tool catalog.
