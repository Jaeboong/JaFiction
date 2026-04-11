# Runs Manual Completion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep run sessions alive after finalizer round completion and add explicit user-controlled complete/resume actions in the Runs page header.

**Architecture:** Separate round completion from session teardown in the runner/session flow, then expose a user-controlled completed/resume state through project essay answer state and the Runs page header actions. The UI should treat finalizer output as a round boundary only, while true completion becomes an explicit user action.

**Tech Stack:** TypeScript, React, shared controller/state models, runner routes

---

### Task 1: Trace and refactor session teardown rules

**Files:**
- Modify: `packages/shared/src/controller/runSessionManager.ts`
- Modify: `packages/runner/src/routes/runsRouter.ts`
- Inspect: `packages/shared/src/core/orchestrator.ts`

**Step 1: Identify the exact teardown path**

Confirm where `run-completed`, `awaiting-user-input`, abort, and failure currently converge into unconditional `finish(sessionId)`.

**Step 2: Split round completion from final teardown**

Adjust the runner/session flow so finalizer round completion no longer auto-closes the active session, while abort/failure and explicit user completion still can.

**Step 3: Preserve paused/input-ready behavior**

Ensure the session can remain available for additional user input after the round boundary.

### Task 2: Add explicit user-controlled complete/resume semantics

**Files:**
- Modify: `packages/shared/src/core/storage.ts`
- Modify: `packages/shared/src/core/viewModels.ts`
- Modify: `packages/runner/src/routes/projectsRouter.ts` or `packages/runner/src/routes/runsRouter.ts` as appropriate
- Modify: any minimal shared type/schema files needed

**Step 1: Reuse completed question state as explicit user completion**

Keep completed state driven by user action rather than reviewer approval or finalizer output.

**Step 2: Add a resume path**

Implement an endpoint or route action that clears the completed state and returns the question/session to an active state.

**Step 3: Refresh state correctly**

Make sure sidebar/project/run state updates correctly after complete and resume actions.

### Task 3: Add header actions for complete and resume

**Files:**
- Modify: `packages/web/src/pages/RunsPage.tsx`
- Modify: `packages/web/src/styles/runs.css`

**Step 1: Add a fixed header completion action**

Place a `고정`-meaning completion button in the Runs header action group, to the left of the execution action.

**Step 2: Swap completed action to resume**

When the question is user-completed, replace that action with `재개`.

**Step 3: Update visual state**

Switch user-completed runs to a gray completed presentation distinct from green round completion.

### Task 4: Add regression coverage and validate

**Files:**
- Modify: relevant tests in `packages/shared/src/test/`
- Modify: relevant tests in `packages/runner/src/test/`

**Step 1: Add session lifecycle coverage**

Test that round completion does not automatically destroy the active session, while abort/failure/user completion still do.

**Step 2: Add complete/resume coverage**

Test explicit completion and resume transitions for question/session state.

**Step 3: Run validation**

Run targeted tests and repo validation, then run the appropriate dev-stack command if runner/web boot behavior changes.
