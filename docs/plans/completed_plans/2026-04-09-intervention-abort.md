# Realtime Intervention Abort Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make realtime user intervention preempt the active agent turn immediately, then resolve the next step through an intervention-only coordinator pass instead of waiting for the full round to finish.

**Architecture:** Keep the external `submitIntervention()` API unchanged and move the behavioral change behind `RunSessionManager` plus `ReviewOrchestrator`. A queued realtime intervention will now trigger the session abort controller, the orchestrator will capture a partial snapshot of completed work, and then a dedicated intervention coordinator prompt will decide whether to accept, redirect, or clarify before the main round loop resumes.

**Tech Stack:** TypeScript, Node.js, existing shared orchestrator/storage/runtime abstractions

---

### Task 1: Lock down realtime intervention session semantics with tests

**Files:**
- Modify: `packages/shared/src/test/runSessionManager.test.ts`

**Steps:**
1. Add a test that verifies realtime `submitIntervention()` still returns `"queued"` while also aborting the active session signal immediately.
2. Add a test that verifies deep feedback keeps the old queue-only behavior during active execution.
3. Keep the paused-session resume behavior unchanged and covered by existing tests.

### Task 2: Lock down intervention-mode orchestrator behavior with tests

**Files:**
- Modify: `packages/shared/src/test/orchestrator.test.ts`

**Steps:**
1. Add a realtime test where a reviewer turn is aborted mid-round after a queued intervention and assert the run does not fail.
2. Assert that the orchestrator runs a dedicated intervention coordinator turn and that completed turns before the abort remain persisted.
3. Add coverage for the coordinator outputs:
   - `redirect` restarts the next round with the new direction.
   - `clarify` emits `awaiting-user-input` and waits again.
   - forced section close directives defer open challenges and hand off immediately.

### Task 3: Add internal intervention state and partial snapshot handling

**Files:**
- Modify: `packages/shared/src/controller/runSessionManager.ts`
- Modify: `packages/shared/src/core/types.ts`
- Modify: `packages/shared/src/core/schemas.ts`

**Steps:**
1. Extend internal session state so realtime queued interventions can be marked as abort-triggering without changing the public API.
2. Introduce orchestrator-side types that distinguish user-intervention aborts from full run aborts.
3. Define a partial snapshot shape that can capture completed turns, user directive text, open challenges, and current section state for the intervention coordinator.

### Task 4: Implement realtime intervention-mode coordinator flow

**Files:**
- Modify: `packages/shared/src/core/orchestrator.ts`

**Steps:**
1. Detect queued realtime intervention messages during active agent execution and treat the resulting abort as an intervention transition, not a terminal run abort.
2. Preserve completed turns, chat messages, ledger state, and a partial snapshot artifact before resuming.
3. Add `buildInterventionCoordinatorPrompt()` and parse its outputs into `accept`, `redirect`, or `clarify`.
4. Inject user intervention text into the coordinator brief as `[USER DIRECTIVE - 최우선 지시]`.
5. Recognize force-close directives such as `넘어가`, `확정`, `/close` and convert current open challenges to deferred before handing off the next section immediately.
6. Keep `deepFeedback` pause behavior unchanged.

### Task 5: Compile and validate

**Files:**
- Review: `packages/shared/src/controller/runSessionManager.ts`
- Review: `packages/shared/src/core/orchestrator.ts`
- Review: `packages/shared/src/core/types.ts`
- Review: `packages/shared/src/core/schemas.ts`
- Review: `packages/shared/src/test/runSessionManager.test.ts`
- Review: `packages/shared/src/test/orchestrator.test.ts`

**Steps:**
1. Run targeted shared tests for `runSessionManager` and `orchestrator`.
2. Run a TypeScript compile / repository check path sufficient to verify the shared package changes.
3. If runtime behavior or entrypoints are affected beyond shared logic, decide whether `./scripts/apply-dev-stack.sh` is required.
