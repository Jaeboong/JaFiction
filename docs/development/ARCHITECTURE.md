# Jasojeon Development Harness Architecture

## Goal

Keep Jasojeon's repository-level validation, execution entrypoints, and review scaffolding separate from the shipped web/runner product runtime.

## The Two-Plane Model

This repository has two different planes.

### 1. Product Plane

The product plane is the software users actually run.

- `packages/shared/**` contains orchestration, storage, schemas, and shared view models
- `packages/runner/**` contains the localhost HTTP/WebSocket runner
- `packages/web/**` contains the React + Vite browser UI

Changes in this plane affect runtime behavior and need stronger review plus local smoke validation.

### Local Runner Trust Boundary

The localhost runner now treats browser access as a narrow trusted boundary rather than an open loopback port.

- `GET /api/session` is the only bootstrap endpoint. It sets or refreshes an `HttpOnly` session cookie and returns bootstrap state only.
- Browser HTTP and WebSocket requests are trusted only when they arrive from approved local origins: the runner origin itself or the official dev-web origin on `127.0.0.1:${JASOJEON_WEB_PORT:-4124}`.
- Runner secret storage is hardened with either `JASOJEON_SECRET_PASSPHRASE` or a machine-local key file under `~/.jasojeon/secret.key`, with legacy predictable-seed blobs migrated forward on read.

### 2. Development-Harness Plane

The development-harness plane exists to make local development safer and more repeatable.

- `docs/development/**` documents operating rules
- `docs/plans/**` captures design and implementation planning
- `tools/**` contains deterministic validators
- `scripts/**` contains safe execution and dev apply entrypoints
- `.github/**` contains review scaffolding
- root `package.json` exposes convenience aliases

Harness changes are lower risk to user behavior, but they still change how contributors build, validate, and operate the repo.

## Official Entrypoints

The official entrypoints for this repository are the shell scripts under `scripts/`.

Important examples:

- `./scripts/check.sh`
- `./scripts/apply-dev-stack.sh`
- `./scripts/status-dev-stack.sh`
- `./scripts/stop-dev-stack.sh`
- `./scripts/with-node.sh`
- `./scripts/with-npm.sh`

`package.json` should stay a thin alias layer over these scripts rather than being the only source of truth.

## WSL Node Strategy

WSL environments in this repo may have a working `node` but a broken `npm` shim.

Because of that, the harness follows two rules:

- never trust raw `npm` as the only official entrypoint
- always resolve a usable `node` first, then execute either a real `npm-cli.js` or direct CLI JS files

This keeps dev workflows stable even when the shell PATH contains a broken `npm`.

## Dev Apply Flow

Jasojeon does not need a VSIX or extension reinstall harness anymore.

The new apply flow is:

```text
deterministic check -> runner dev restart -> web dev restart -> endpoint verification
```

The dev harness persists runtime metadata under `.harness/`:

- `.harness/pids/runner.pid`
- `.harness/pids/web.pid`
- `.harness/logs/runner.log`
- `.harness/logs/web.log`

## Review Boundaries

### High-scrutiny product paths

- `packages/shared/src/core/orchestrator.ts`
- `packages/shared/src/core/providers.ts`
- `packages/runner/src/index.ts`
- `packages/runner/src/runnerContext.ts`
- `packages/runner/src/routes/**`
- `packages/web/src/App.tsx`
- `packages/web/src/api/client.ts`

### Harness control paths

- `docs/development/**`
- `tools/**`
- `scripts/**`
- `.github/**`
- `package.json`
- `README.md`

## Practical Workflow

1. Inspect the current repository state.
2. Update or add a dated design/plan document under `docs/plans/`.
3. Make minimal coherent changes.
4. Run `./scripts/check.sh`.
5. If runtime entrypoints changed, run `./scripts/apply-dev-stack.sh`.
6. Summarize what changed, what was validated, and what still needs human review.
