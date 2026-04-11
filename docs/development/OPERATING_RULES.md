# Jasojeon Development Harness Operating Rules

## Deterministic Checks vs Live Dev Apply

### Deterministic Checks

Required deterministic checks must be:

- repeatable on a clean checkout
- credential-free
- non-interactive
- stable across local sessions

In this repository, the baseline deterministic command is:

```bash
./scripts/check.sh
```

This command covers:

- shared tests
- runner tests
- web build
- documentation link validation

### Live Dev Apply

Live dev apply means bringing the local web + runner stack into a usable state for manual verification.

Use:

```bash
./scripts/apply-dev-stack.sh
./scripts/status-dev-stack.sh
```

Do not treat live dev apply as a deterministic CI gate.

## WSL Node/NPM Rules

If you are in WSL, assume raw `npm` may be broken even when `node` works.

Preferred command order:

1. direct `./scripts/*.sh` entrypoints
2. `./scripts/with-npm.sh run ...`
3. raw `npm run ...` only when you already know that shell is healthy

Do not introduce new repo instructions that depend exclusively on raw `npm`.

## Runtime Metadata

Never commit runtime metadata from the dev harness.

Ignore:

- `.harness/**`
- local logs
- pid files
- machine-specific temporary output

## When To Run Which Command

Run this after every non-trivial change:

```bash
./scripts/check.sh
```

Run this when runner/web entrypoints, routing, sockets, or dev boot flow changed:

```bash
./scripts/apply-dev-stack.sh
```

Run this to inspect current local status:

```bash
./scripts/status-dev-stack.sh
```

Run this to cleanly stop the local stack:

```bash
./scripts/stop-dev-stack.sh
```

## Human Review Is Mandatory When

- `packages/shared/src/core/orchestrator.ts` changes
- provider execution/auth behavior changes
- `packages/runner/src/index.ts` changes
- WebSocket or runner session/auth boundary changes
- `scripts/**` changes execution semantics
- `package.json` changes validation or workflow entrypoints

## Review Checklist

- Did the change stay in the intended plane?
- Are deterministic checks sufficient for the change?
- Was live dev apply run when runtime entrypoints changed?
- Did trusted local origin bootstrap still work from both the runner-served UI and the official dev web origin?
- Did the change make WSL execution safer or more fragile?
- Were README and harness docs updated when entrypoints changed?
