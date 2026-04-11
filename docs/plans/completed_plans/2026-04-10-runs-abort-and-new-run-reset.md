# Runs Abort And New-Run Reset Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Runs page abort control reliably stop the active run and reset new-run UI state before starting a replacement run.

**Architecture:** Tighten the abort path at the runner/shared boundary so an abort request updates active-session state and is reflected to the web UI without waiting for stale derived state. In the web layer, treat "new run" as its own presentation mode and gate restart-through-abort behind the existing `window.confirm` pattern.

**Tech Stack:** TypeScript, React, Express, shared controller/orchestrator state, node:test

---

### Task 1: Lock down the failing behavior

**Files:**
- Modify: `packages/runner/src/test/runsRouter.test.ts`
- Modify: `packages/shared/src/test/runSessionManager.test.ts`

**Step 1: Add a router-level abort regression test**

Assert that aborting the addressed active run updates runner state hooks in addition to aborting the signal.

**Step 2: Add shared-session abort regression coverage**

Assert paused-session aborts expose an aborting state rather than leaving the session visually running until teardown.

### Task 2: Fix abort state propagation

**Files:**
- Modify: `packages/shared/src/controller/runSessionManager.ts`
- Modify: `packages/runner/src/routes/runsRouter.ts`

**Step 1: Update `RunSessionManager.abort`**

Move the active session into an explicit aborting/running-terminal state that still preserves the session until orchestrator teardown completes.

**Step 2: Push the new snapshot from the abort route**

After a successful abort request, sync `stateStore` and `pushState()` so the web client stops rendering the run as active immediately.

### Task 3: Reset new-run presentation and confirm restart

**Files:**
- Modify: `packages/web/src/pages/RunsPage.tsx`

**Step 1: Split "selected run" from "new run" mode**

Use `selectedRunId === undefined` as the source of truth for button and badge rendering.

**Step 2: Keep draft/new-run visuals neutral**

Show `실행 시작` and a neutral status badge in new-run mode even when another live run exists.

**Step 3: Add confirm-before-restart**

On new-run start, if an active run exists, ask:
`현재 실행 중인 작업이 있습니다. 중단하고 새 실행을 시작하시겠습니까?`

If confirmed, abort the existing run, wait for the runner state to become idle, then start the new run.

### Task 4: Validate

**Files:**
- Modify only if tests require snapshots or type fixes.

**Step 1: Run requested type checks**

Run:
`./scripts/with-node.sh ./node_modules/typescript/lib/tsc.js -p packages/web/tsconfig.json --noEmit`

Run:
`./scripts/with-node.sh ./node_modules/typescript/lib/tsc.js -p packages/shared/tsconfig.json --noEmit`

**Step 2: Run repository checks**

Run:
`./scripts/check.sh`
