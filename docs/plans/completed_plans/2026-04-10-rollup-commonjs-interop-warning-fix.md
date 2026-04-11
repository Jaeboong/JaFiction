# Rollup CommonJS Interop Warning Fix

**Goal:** Remove the Vite/Rollup warning about `parseReviewerCardContent` from `@jafiction/shared` without changing the runner's CommonJS runtime contract.

**Root Cause:** `packages/shared` currently emits CommonJS only, and the workspace-linked package resolves to `packages/shared/dist/index.js` outside `node_modules`. The web app only needed the reviewer-card parser at runtime, but importing it through the package root forced Rollup into CommonJS named-export interop on the full shared entrypoint.

**Minimal Fix Direction:** Keep `packages/shared` as CommonJS for runner compatibility, extract the reviewer-card parser into a browser-safe shared source module, and point the web app at that source module through a dedicated alias instead of the CommonJS package root.

### Task 1: Capture the current package wiring

**Files:**
- Inspect: `packages/shared/package.json`
- Inspect: `packages/shared/tsconfig.json`
- Inspect: `packages/web/vite.config.ts`
- Inspect: `packages/web/tsconfig.json`

**Steps:**
1. Confirm `shared` is CommonJS-only and does not publish dual exports.
2. Confirm `web` resolves `@jafiction/shared` through the workspace package and only uses the dist declarations for types.
3. Reproduce the warning with the official web build command.

### Task 2: Limit the fix to the web bundler

**Files:**
- Modify: `packages/web/vite.config.ts`

**Steps:**
1. Move the reviewer-card parser into a browser-safe shared module with no Node-only dependencies.
2. Point the web app at that dedicated module instead of the CommonJS package root.
3. Avoid changing the `shared` package output format so runner imports remain stable.

### Task 3: Rebuild and apply the dev stack

**Steps:**
1. Re-run the official web build command and confirm the warning is gone.
2. Run `./scripts/check.sh`.
3. Run `./scripts/apply-dev-stack.sh` and confirm the stack comes up cleanly, or record any sandbox limitation if localhost binding is blocked.
