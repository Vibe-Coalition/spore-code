# Releases

Spore Code is moving to npm/npx distribution. The Go/Bubble Tea client remains
available as a legacy reference until the npm client is proven stable in real
sessions.

## npm Beta Requirements

- Node.js 22+,
- a Spore Core server with the `spore-code` plugin,
- npm credentials for publishing when cutting a public beta.

## Local Build

```sh
npm install
npm run typecheck
npm test
npm run build
node dist/bin/spore.js --version
```

The generated package binary is `dist/bin/spore.js`.

## Live Smoke

Run these from a project directory against a real Spore Core:

```sh
npm run dev -- doctor
npm run dev -- smoke
npm run dev
```

`spore smoke` verifies auth, websocket connection, capabilities, session start,
and history request/response. It also prints the manual beta checklist for
chat streaming, local tools, server fallback, `ask_user`, plan mode, approval
choices, and background exec tailing.

## Package Smoke

```sh
npm run pack:smoke
npm pack
npm install -g ./vibe-coalition-spore-code-*.tgz
spore --version
spore doctor
spore smoke
```

Also test on Windows before promotion:

- paths with spaces,
- `cmd.exe` commands,
- `powershell_exec`,
- strict scope blocking,
- long-running command adoption and `bg_tail`.

## Beta Publish

Use a prerelease version and the npm `beta` dist-tag:

```sh
npm version 1.1.0-beta.0 --no-git-tag-version
npm publish --tag beta
```

Install options for testers:

```sh
curl -fsSL https://raw.githubusercontent.com/Vibe-Coalition/spore-code/main/install.sh | sh
SPORE_CODE_SOURCE=npm npm install -g @vibe-coalition/spore-code@beta
```

After the npm beta package is published, direct npm/npx installs work:

```sh
npm install -g @vibe-coalition/spore-code@beta
npx @vibe-coalition/spore-code@beta
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/Vibe-Coalition/spore-code/main/install.ps1 | iex
```

Downloaded zip or local checkout on Windows:

```powershell
.\install.cmd
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
& "$env:APPDATA\npm\spore.cmd" # works immediately if this terminal PATH is stale
```

Do not tag the npm package as `latest` until the beta survives real Core
sessions and Windows shell smoke tests.

## Legacy Go Release

The previous native binary release path remains available for comparison:

```sh
go test ./...
make build
make release
```

Do not remove the Go release/update channel as part of the npm beta.
