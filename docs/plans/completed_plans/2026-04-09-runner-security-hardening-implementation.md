# Runner Security Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the localhost trust boundary around the runner, replace the predictable secret-store fallback, and bind user intervention requests to the addressed run so stale tabs cannot mutate the wrong session.

**Architecture:** Move runner authentication away from a cross-origin-readable bearer-token bootstrap and toward a trusted-origin, cookie-backed local session. Keep the dev-stack experience working for the official Vite origin by making the allowlist explicit and testable, then harden `FileSecretStore` with machine-local key material plus legacy migration, and finally make intervention routing run-specific at the session-manager boundary.

**Tech Stack:** TypeScript, Express, WebSocket (`ws`), Node `crypto`, React, Node test runner, local harness scripts

---

### Task 1: Add a testable runner security boundary

**Files:**
- Create: `packages/runner/src/security/sessionAuth.ts`
- Create: `packages/runner/src/test/sessionAuth.test.ts`
- Modify: `packages/runner/src/index.ts`
- Modify: `packages/runner/src/runnerContext.ts`
- Modify: `packages/runner/package.json`
- Modify: `packages/runner/tsconfig.json`
- Modify: `scripts/test-all.sh`
- Review: `scripts/start-dev-runner.sh`
- Review: `scripts/start-dev-web.sh`

**Steps:**
1. Extract trusted-origin resolution and session-auth parsing into `packages/runner/src/security/sessionAuth.ts` so the runner no longer hardcodes `cors({ origin: true })` or token query-string checks inside `index.ts`.
2. Define a trusted-origin allowlist that covers the runner’s own origin plus the official dev-web origin (`http://127.0.0.1:4124` by default, with an env override for custom harness ports) and rejects arbitrary browser origins.
3. Change `/api/session` so it sets or refreshes an `HttpOnly` session cookie and returns only bootstrap state payload (`state`, `storageRoot`) instead of the long-lived bearer token.
4. Change authenticated HTTP requests and WebSocket upgrades to require both a valid local session cookie and a trusted `Origin` header when the request comes from a browser context.
5. Add runner tests proving that a trusted local origin can bootstrap, an arbitrary origin receives 403, `/api/session` no longer leaks the bearer token, and WebSocket upgrades fail when origin or cookie validation fails.
6. Update `scripts/test-all.sh`, `packages/runner/package.json`, and `packages/runner/tsconfig.json` so runner unit tests compile and run as part of the deterministic test suite.

### Task 2: Migrate the web client to cookie-backed runner auth

**Files:**
- Modify: `packages/web/src/api/client.ts`
- Modify: `packages/web/src/App.tsx`
- Review: `packages/web/src/pages/RunsPage.tsx`

**Steps:**
1. Update `RunnerClient.bootstrap()` to call `/api/session` with `credentials: "include"` and consume a token-free payload.
2. Remove `Authorization: Bearer ...` headers from JSON and form-data requests and replace them with cookie-backed `fetch(..., { credentials: "include" })`.
3. Remove the `?token=` query-string from WebSocket URLs and rely on the same cookie-backed session used by HTTP.
4. Keep the current runner base-url override UX intact in `App.tsx`, but surface a clear bootstrap error when the chosen origin is not in the runner allowlist.
5. Manually verify both official startup modes still work: runner-served static web and the Vite dev server started by `./scripts/apply-dev-stack.sh`.

### Task 3: Replace the predictable secret-store fallback and migrate existing installs

**Files:**
- Modify: `packages/runner/src/secretStore.ts`
- Create: `packages/runner/src/test/secretStore.test.ts`
- Review: `packages/runner/src/runnerContext.ts`
- Review: `README.md`

**Steps:**
1. Replace the `username:homedir:jasojeon-local` fallback with an explicit secure key source order: `JASOJEON_SECRET_PASSPHRASE` first, otherwise a machine-local random key file under `~/.jasojeon/`.
2. Create the machine-local key file with strict permissions, load it deterministically on later boots, and fail closed if the runner cannot obtain secure key material.
3. Add one-time migration logic: if an existing `secrets.enc` only decrypts with the legacy predictable seed, immediately mint the new machine key and re-encrypt with the hardened key source.
4. Add tests for fresh initialization, legacy-secret migration, repeated reads with the machine key, and failure when the encrypted blob is copied without the matching key material.
5. Document the new secret-key behavior in the README if contributors need to preserve or rotate local secrets deliberately.

### Task 4: Bind interventions to the addressed run id

**Files:**
- Modify: `packages/shared/src/controller/runSessionManager.ts`
- Modify: `packages/runner/src/routes/runsRouter.ts`
- Modify: `packages/shared/src/test/runSessionManager.test.ts`
- Create: `packages/runner/src/test/runsRouter.test.ts`

**Steps:**
1. Extend `RunSessionManager.submitIntervention()` to accept the addressed `runId` and reject mismatches once the active session has a concrete run id.
2. Pass the route param from `POST /api/runs/:runId/intervention` into the session manager instead of discarding it.
3. Return HTTP 409 for stale or misaddressed intervention requests and include the currently active run id in the error payload so the UI can recover cleanly.
4. Preserve the current single-active-run rule, but add regression coverage proving a stale tab cannot resume or queue messages into a different active run.
5. Keep `/abort` behavior run-specific as well, so both intervention and abort operations share the same addressed-run invariant.

### Task 5: Document and validate the hardened flow end to end

**Files:**
- Modify: `README.md`
- Modify: `docs/development/ARCHITECTURE.md`
- Modify: `docs/development/OPERATING_RULES.md`
- Review: `docs/development/NAVIGATION.md`

**Steps:**
1. Update docs to describe the trusted local-origin model, cookie-backed runner bootstrap, and hardened local secret-key behavior without reintroducing raw-token guidance.
2. Confirm whether `docs/development/NAVIGATION.md` needs an entry for any newly added high-value runner test files or security helper modules; update it only if a file’s primary role needs to be discoverable.
3. Run targeted runner tests after each security slice, then run the full deterministic suite:
   Run: `./scripts/check.sh`
   Expected: shared tests pass, runner tests pass, runner typecheck passes, web build passes, docs-check passes.
4. Run the local stack smoke test because runner boot, auth, and WebSocket entrypoints changed:
   Run: `./scripts/apply-dev-stack.sh`
   Run: `./scripts/status-dev-stack.sh`
   Expected: runner and web are both healthy on their official localhost origins.
5. Manually verify three scenarios in a browser:
   - The official Jasojeon web UI can bootstrap and use HTTP + WebSocket normally.
   - A different origin cannot read `/api/session` or issue authenticated API calls.
   - A stale run tab receives a 409 instead of mutating the current active run.
