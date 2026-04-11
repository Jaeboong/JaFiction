# Same Run Resume Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `재개` reopen the same run record and keep the conversation history in place while removing the start button from completed sessions.

**Architecture:** Extend the run lifecycle so the orchestrator can reuse an existing run record instead of always creating a new one. Seed resumed runs with previously persisted chat messages and review turns, then update the Runs page header logic so completed sessions expose only the resume action.

**Tech Stack:** TypeScript, Express, shared storage/repository layer, React, plain CSS, Node test runner

---

### Task 1: Add run metadata for in-place resume

**Files:**
- Modify: `packages/shared/src/core/types.ts`
- Modify: `packages/shared/src/core/schemas.ts`

**Step 1: Write the failing test**

Use the resume route/storage tests in:

- `packages/runner/src/test/runsRouter.test.ts`

Add assertions for same-`runId` resume response and persisted resume metadata.

**Step 2: Run test to verify it fails**

Run: `./scripts/with-npm.sh run test -- packages/runner/src/test/runsRouter.test.ts`

Expected: FAIL because resume still creates a new run ID and no resume metadata exists.

**Step 3: Write minimal implementation**

- Add `lastResumedAt?: string` to `RunRecord`
- Add `existingRunId?: string` to `RunRequest`
- Update Zod schemas to accept the new fields

**Step 4: Run test to verify schema/type wiring passes**

Run: `./scripts/with-npm.sh run test -- packages/runner/src/test/runsRouter.test.ts`

Expected: Test still fails later in route logic, but no schema/type errors remain.

### Task 2: Reuse an existing run record on resume

**Files:**
- Modify: `packages/runner/src/routes/runsRouter.ts`
- Modify: `packages/shared/src/core/orchestrator.ts`
- Modify: `packages/shared/src/core/storageInterfaces.ts`
- Modify: `packages/shared/src/core/storage.ts`
- Modify: `packages/shared/src/core/runRepository.ts`

**Step 1: Write the failing test**

Extend:

- `packages/runner/src/test/runsRouter.test.ts`

Assert that:

- `POST /resume` returns the original `runId`
- the run record stays in place and gets updated for active execution
- existing chat history/turn artifacts are preserved on subsequent persistence

**Step 2: Run test to verify it fails**

Run: `./scripts/with-npm.sh run test -- packages/runner/src/test/runsRouter.test.ts`

Expected: FAIL because `startContinuationRun()` returns a new run ID and persistence overwrites old artifacts.

**Step 3: Write minimal implementation**

- Add repository/storage loaders for existing `review-turns.json`
- Let the orchestrator accept `existingRunId` and update that run instead of creating a new one
- Seed chat messages and review turns from stored artifacts before appending new output
- Update the `resume` route to reopen the essay answer and start the same run ID again

**Step 4: Run targeted tests**

Run: `./scripts/with-npm.sh run test -- packages/runner/src/test/runsRouter.test.ts`

Expected: PASS for same-run resume coverage.

### Task 3: Keep session manager and UI aligned with the new lifecycle

**Files:**
- Modify: `packages/web/src/api/client.ts`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/pages/RunsPage.tsx`
- Modify: `packages/web/src/styles/runs.css`
- Review: `packages/shared/src/controller/runSessionManager.ts`
- Test: `packages/shared/src/test/runSessionManager.test.ts`

**Step 1: Write the failing test or assertion target**

Add or update route/UI-facing expectations so completed sessions:

- keep the selected run ID on resume
- do not show the start action
- show only the resume action

If no web test harness exists here, keep the assertions concentrated in route/state tests and verify UI conditions manually from the component logic.

**Step 2: Run the relevant tests**

Run: `./scripts/with-npm.sh run test -- packages/shared/src/test/runSessionManager.test.ts packages/runner/src/test/runsRouter.test.ts`

Expected: FAIL until lifecycle assumptions are updated.

**Step 3: Write minimal implementation**

- Make `client.resumeRun()` return the same `runId`
- Keep `selectedRunId` unchanged after resume
- Change Runs header action gating so pinned/completed runs show only `재개`
- Replace the resume icon SVG with a cleaner return/play mark

**Step 4: Run targeted tests again**

Run: `./scripts/with-npm.sh run test -- packages/shared/src/test/runSessionManager.test.ts packages/runner/src/test/runsRouter.test.ts`

Expected: PASS

### Task 4: Run repo validation

**Files:**
- Review only

**Step 1: Run deterministic checks**

Run: `./scripts/check.sh`

Expected: PASS

**Step 2: Run dev apply only if startup/runtime entrypoints were affected**

Run: `./scripts/apply-dev-stack.sh`

Expected: Only needed if the end-to-end local stack behavior changed beyond route/component logic.

**Step 3: Summarize remaining risk**

- Confirm existing run history still renders in order after resume
- Confirm completed sessions no longer expose the start button
