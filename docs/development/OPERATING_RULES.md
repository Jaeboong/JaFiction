# Jasojeon Development Harness Operating Rules

## Dev Automation

One command brings up the full hosted dev loop (Postgres, Redis, backend, runner, web):

```bash
./scripts/dev-stack.sh
```

One command tears it all down (add `--all` to also stop containers):

```bash
./scripts/stop-dev-stack.sh
```

**First-run pairing flow**: On a clean checkout, `dev-stack.sh` will:
1. Create `packages/backend/.env.dev` from the template and exit — fill in `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `COOKIE_SECRET`, then re-run.
2. On the next run, detect no device token and prompt for a pairing code. Open the backend URL, sign in, go to Settings → Devices → Add device, and paste the 8-character code. The runner pairs once and subsequent runs are non-interactive.

To skip individual components: `--no-backend`, `--no-runner`, `--no-web`, `--no-infra`. To skip the type-check gate: `--skip-check`.

---

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

Since Stage 11.7 (hosted-mode retirement of local mode) the runner no longer
runs an inbound HTTP server. The canonical entrypoint is:

```bash
./scripts/dev-stack.sh        # runner in hosted outbound mode + web vite
./scripts/status-dev-stack.sh
```

`./scripts/apply-dev-stack.sh` remains as a web-only restart helper; it
assumes the backend and runner are already running.

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
./scripts/dev-stack.sh
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
- `packages/runner/src/hosted/**` changes
- WebSocket or runner session/auth boundary changes
- `scripts/**` changes execution semantics
- `package.json` changes validation or workflow entrypoints

## Review Checklist

- Did the change stay in the intended plane?
- Are deterministic checks sufficient for the change?
- Was live dev apply run when runtime entrypoints changed?
- Did the hosted outbound runner reconnect cleanly after a backend restart?
- Did the change make WSL execution safer or more fragile?
- Were README and harness docs updated when entrypoints changed?
