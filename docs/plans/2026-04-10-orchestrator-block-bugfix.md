# Orchestrator BLOCK Bugfix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the realtime `BLOCK` branch so awaiting-user-input runs are not overwritten to `completed`, and a coordinator synthesis failure falls back to an awaiting-user-input question instead of failing the whole run.

**Architecture:** Keep the fix inside `packages/shared/src/core/orchestrator.ts` and the existing realtime reviewer packet model. Guard the epilogue completion write with the persisted run status, and wrap only the BLOCK synthesis turn in local fallback handling that derives a user question from reviewer packets. Lock both regressions with focused orchestrator tests and leave `deepFeedback` untouched.

**Tech Stack:** TypeScript, shared orchestrator runtime, Node test runner

---

### Task 1: Add regression coverage for the BLOCK branch

**Files:**
- Modify: `packages/shared/src/test/orchestrator.test.ts`

**Step 1: Extend the existing realtime BLOCK test**

Assert that the returned run status remains `awaiting-user-input` after the BLOCK branch exits, while the finalizer is still skipped.

**Step 2: Add a synthesis failure fallback test**

Simulate a failed `realtime-round-1-coordinator-block-synthesis` turn and assert that:
- the run does not fail
- `awaiting-user-input` is emitted
- the fallback prompt includes reviewer labels and blocking reasons

**Step 3: Run the targeted orchestrator test file**

Run: `./scripts/with-npm.sh run test -- packages/shared/src/test/orchestrator.test.ts`

Expected: the new BLOCK assertions fail before the production fix is applied.

### Task 2: Fix the realtime BLOCK branch

**Files:**
- Modify: `packages/shared/src/core/orchestrator.ts`

**Step 1: Preserve awaiting-user-input in the epilogue**

Before the final `completed` update, check the current run status and skip the overwrite when it is already `awaiting-user-input`.

**Step 2: Add BLOCK synthesis fallback handling**

Wrap the BLOCK synthesis turn in `try/catch`. On failure, build the fallback question from reviewer packets using:
- `{reviewer_label}: {blocking_reason}`
- `{reviewer_label}: 추가 검토가 필요합니다.` when no blocking reason is available

Then pass that fallback message to `handleRealtimeAwaitingUserInput()` with `markAwaitingStatus: true`.

**Step 3: Keep the change isolated**

Do not change the `deepFeedback` branch or unrelated realtime convergence logic.

### Task 3: Verify the fix

**Files:**
- Modify: `packages/shared/src/core/orchestrator.ts`
- Modify: `packages/shared/src/test/orchestrator.test.ts`

**Step 1: Re-run the targeted orchestrator test file**

Run: `./scripts/with-npm.sh run test -- packages/shared/src/test/orchestrator.test.ts`

Expected: PASS

**Step 2: Run repository validation**

Run: `./scripts/check.sh`

Expected: PASS, or capture any sandbox-specific limitation if the check script cannot complete in this environment.
