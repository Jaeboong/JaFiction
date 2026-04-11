# Jasojeon Web Runner Harness Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Jasojeon-specific repository harness plane, stable Node/npm wrappers, and a web/runner development apply harness that replaces the old extension install/deploy harness idea.

**Architecture:** Keep the current product runtime under `packages/` unchanged as much as possible, then add a separate harness plane at the repo root under `docs/development/`, `tools/`, `scripts/`, and `.github/`. Make every harness entrypoint bypass broken WSL npm shims by resolving a usable `node` binary first and then invoking real CLI JS entrypoints or direct shell scripts.

**Tech Stack:** Bash, TypeScript, node:test, Vite, tsx, Express, WebSocket

---

### Task 1: Establish the harness plane

**Files:**
- Create: `docs/development/ARCHITECTURE.md`
- Create: `docs/development/OPERATING_RULES.md`
- Create: `.github/pull_request_template.md`
- Modify: `README.md`

**Step 1:** Write the harness-vs-product boundary for Jasojeon.

**Step 2:** Document deterministic validation vs live dev apply rules.

**Step 3:** Document the official command entrypoints as `scripts/*`, not raw `npm`.

**Step 4:** Add reviewer guidance for web/runner high-risk paths and local smoke evidence.

### Task 2: Add deterministic harness validators

**Files:**
- Create: `tools/validate-doc-links.ts`
- Create: `tsconfig.tools.json`
- Modify: `package.json`
- Modify: `.gitignore`

**Step 1:** Add a deterministic markdown link validator that checks `README.md`, `.github/`, and `docs/development/`.

**Step 2:** Compile harness tools into a dedicated output directory.

**Step 3:** Expose a docs validation command and a local deterministic `check` command.

### Task 3: Add stable Node/npm wrappers

**Files:**
- Create: `scripts/with-node.sh`
- Create: `scripts/with-npm.sh`

**Step 1:** Resolve a usable Linux `node` binary without trusting broken PATH shims blindly.

**Step 2:** Find a real `npm-cli.js` installation and run it through `with-node.sh`.

**Step 3:** Print actionable failure messages when neither a usable `node` nor `npm-cli.js` can be found.

### Task 4: Add deterministic build/test harness scripts

**Files:**
- Create: `scripts/build-all.sh`
- Create: `scripts/test-all.sh`
- Create: `scripts/check.sh`
- Modify: `package.json`

**Step 1:** Replace nested workspace `npm run -w` dependency inside root scripts with shell entrypoints.

**Step 2:** Build shared, runner, and web through direct CLI JS entrypoints or safe package script invocation.

**Step 3:** Run the shared test suite, runner typecheck, web build, and docs validator from one deterministic check script.

### Task 5: Add dev apply/start/stop/status harness scripts

**Files:**
- Create: `scripts/start-dev-runner.sh`
- Create: `scripts/start-dev-web.sh`
- Create: `scripts/stop-dev-stack.sh`
- Create: `scripts/status-dev-stack.sh`
- Create: `scripts/apply-dev-stack.sh`
- Modify: `.gitignore`
- Modify: `package.json`

**Step 1:** Create a `.harness/` working area for logs and pid files.

**Step 2:** Start the runner in watch mode in the background and persist pid/log metadata.

**Step 3:** Start the web Vite dev server in the background and persist pid/log metadata.

**Step 4:** Stop stale processes safely before replacing them.

**Step 5:** Verify runner and web status through pid checks plus HTTP endpoint checks.

**Step 6:** Define `apply-dev-stack.sh` as `check -> restart stack -> verify status`.

### Task 6: Validate and finalize

**Files:**
- Modify: `docs/plans/2026-04-08-web-runner-harness-engineering.md`

**Step 1:** Run `./scripts/check.sh`.

**Step 2:** Run `./scripts/apply-dev-stack.sh`.

**Step 3:** Run `./scripts/status-dev-stack.sh`.

**Step 4:** Record outcomes, skipped items, and any environment-specific follow-up in the final summary.
