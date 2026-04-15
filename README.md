# Jasojeon

Jasojeon is a web UI plus local runner rewrite of the original `forJob` VS Code extension.

## Current Status

- **Stage**: 11.9 — Device Auto-Claim (진행 중)
- **Branch**: `feat/hosted-migration`
- **Docs**: [docs/plans/CURRENT_STAGE.md](docs/plans/CURRENT_STAGE.md)

## Workspace

- `packages/shared`: reusable orchestration, storage, schema, and workflow modules
- `packages/runner`: hosted-mode outbound runner (WebSocket to backend; no inbound server — local mode retired at Stage 11.7)
- `packages/web`: React + Vite browser UI

## Harness

The official entrypoints for local development live under `scripts/`.

- `./scripts/with-npm.sh install`: install workspace dependencies with a WSL-safe `npm` invocation
- `./scripts/check.sh`: deterministic validation
- `./scripts/apply-dev-stack.sh`: check, restart the local runner/web dev stack, and verify endpoints
- `./scripts/status-dev-stack.sh`: inspect current local runner/web status
- `./scripts/stop-dev-stack.sh`: stop the local dev stack
- `./scripts/with-node.sh`: run a command with a verified Linux `node`
- `./scripts/with-npm.sh`: run `npm-cli.js` safely when raw `npm` is broken in WSL

In WSL, assume raw `npm` may be flaky until proven otherwise. Prefer direct `./scripts/*.sh` entrypoints first, then `./scripts/with-npm.sh run ...`, and only use raw `npm` after you know the shell is healthy.

See:

- [Development harness architecture](docs/development/ARCHITECTURE.md)
- [Development harness operating rules](docs/development/OPERATING_RULES.md)

## Common Tasks

- Install dependencies: `./scripts/with-npm.sh install`
- Run deterministic validation: `./scripts/check.sh`
- Restart the local runner + web stack: `./scripts/apply-dev-stack.sh`
- Inspect the local dev stack: `./scripts/status-dev-stack.sh`
- Stop the local dev stack: `./scripts/stop-dev-stack.sh`

## Key Documents

| 목적 | 파일 |
|------|------|
| 현재 스테이지 및 진행 상황 | [docs/plans/CURRENT_STAGE.md](docs/plans/CURRENT_STAGE.md) |
| 하네스 아키텍처 | [docs/development/ARCHITECTURE.md](docs/development/ARCHITECTURE.md) |
| 파일 위치 네비게이션 | [docs/development/NAVIGATION.md](docs/development/NAVIGATION.md) |
| 로컬 환경 세팅 | [docs/development/LOCAL_SETUP.md](docs/development/LOCAL_SETUP.md) |
| Git 워크플로우 | [docs/development/GIT_WORKFLOW.md](docs/development/GIT_WORKFLOW.md) |
| 에이전트용 가이드 | [AGENTS.md](AGENTS.md) |

## Local Security Model

- `GET /api/session` bootstraps the local runner by setting an `HttpOnly` session cookie and returning bootstrap state. The browser client uses `credentials: "include"` for HTTP and the same cookie for WebSocket upgrades. Bearer tokens and `?token=` WebSocket URLs are no longer part of the local flow.
- Browser requests are accepted only from trusted local origins: the runner's own origin and the official dev-web origin on `http://127.0.0.1:${JASOJEON_WEB_PORT:-4124}`. If you override the runner base URL in the UI, keep it on one of those trusted local origins.
- Runner secrets in `~/.jasojeon/secrets.enc` are encrypted with `JASOJEON_SECRET_PASSPHRASE` when that env var is set. Otherwise the runner mints and reuses a machine-local key file at `~/.jasojeon/secret.key`.
- Older `secrets.enc` files that were encrypted with the legacy predictable seed migrate automatically on the next successful runner boot. If you intentionally move secrets between machines, move both `secrets.enc` and `secret.key` together or re-enter the API keys.

## Package Aliases

`package.json` exposes convenience aliases over the harness scripts. Use these only when raw `npm` is already known to work in your shell.

- `npm install`
- `npm run build`
- `npm run test`
- `npm run docs-check`
- `npm run check`
- `npm run dev:runner`
- `npm run dev:web`
- `npm run dev:apply`
- `npm run dev:status`
- `npm run dev:stop`
