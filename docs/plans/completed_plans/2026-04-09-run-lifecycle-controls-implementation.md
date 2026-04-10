# Run Lifecycle Controls Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make a run appear in the recent-runs list immediately on start, support user-driven abort with a persisted `aborted` status, switch the Runs page primary action between start/abort/complete based on live state, and let complete fix the current essay question.

**Architecture:** Extend the shared run lifecycle model first so `aborted` is a first-class persisted state and provider execution can be cancelled safely. Then wire runner routes for abort and question completion, refresh sidebar project runs as soon as a run id is created, and update the Runs page to derive the right button/action from the active live session while keeping completed essay answers in project storage.

**Tech Stack:** TypeScript, Zod, Node child-process execution, Express routes, React, WebSocket run events, plain CSS

---

### Task 1: Document and lock the lifecycle model

**Files:**
- Modify: `packages/shared/src/core/types.ts`
- Modify: `packages/shared/src/core/schemas.ts`
- Modify: `packages/shared/src/core/viewModels.ts`
- Modify: `packages/web/src/formatters.ts`
- Test: `packages/shared/src/test/webviewProtocol.test.ts`

**Steps:**
1. Add `aborted` to the persisted `RunStatus` model and expose a matching event for aborted run termination.
2. Extend any affected schemas and view models so runner/web state accepts the new lifecycle values.
3. Update shared labels/tones so aborted runs render as a distinct gray completion state instead of being conflated with failure.
4. Add schema coverage proving `RunRecordSchema` and run events accept `aborted`.

### Task 2: Make active sessions cancellable without corrupting the next run

**Files:**
- Modify: `packages/shared/src/controller/runSessionManager.ts`
- Modify: `packages/shared/src/core/types.ts`
- Modify: `packages/shared/src/core/providers.ts`
- Modify: `packages/shared/src/core/orchestrator.ts`
- Modify: `packages/shared/src/core/runRepository.ts`
- Test: `packages/shared/src/test/runSessionManager.test.ts`
- Test: `packages/shared/src/test/orchestrator.test.ts`

**Steps:**
1. Give `RunSessionManager` a per-session identity so `finish()` and abort completion only clear the session that started the work.
2. Add abort support to prompt execution options and kill provider child processes when the active session is cancelled.
3. Teach the orchestrator to distinguish abort from failure, persist `aborted`, emit a run-aborted event, and preserve chat/review artifacts on cancellation.
4. Flush buffered run logs when a run is aborted and add tests that prove abort does not wipe out a newer session.

### Task 3: Persist draft checkpoints needed for question completion

**Files:**
- Modify: `packages/shared/src/core/orchestrator.ts`
- Modify: `packages/shared/src/core/storageInterfaces.ts`
- Modify: `packages/shared/src/core/storage.ts`
- Test: `packages/shared/src/test/orchestrator.test.ts`
- Review: `packages/shared/src/test/storage.test.ts`

**Steps:**
1. Persist realtime draft checkpoints before paused intervention boundaries so the latest draft is available even when the discussion has not finalized naturally.
2. Expose the completed-answer save path through the run storage interface used by the runner.
3. Add or extend tests that prove a paused realtime run can still surface the latest draft for completion.

### Task 4: Add runner endpoints for immediate run insertion, abort, and completion

**Files:**
- Modify: `packages/runner/src/routes/runsRouter.ts`
- Modify: `packages/runner/src/runnerContext.ts`
- Review: `packages/shared/src/controller/sidebarStateStore.ts`

**Steps:**
1. Refresh project runs immediately after the new run id is discovered so the recent-runs list updates before the run finishes.
2. Add an abort endpoint that cancels the active session, persists `aborted`, and returns the run id/status cleanly.
3. Add a completion endpoint that loads the latest continuation context, saves the current essay answer as completed, refreshes project/sidebar state, and, when the run is paused, resumes the orchestrator with `/done` so the run can close normally.
4. Avoid double-emitting synthetic run-failed events when the run ended by abort rather than error.

### Task 5: Update the Runs page controls and recent-runs behavior

**Files:**
- Modify: `packages/web/src/api/client.ts`
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/pages/RunsPage.tsx`
- Modify: `packages/web/src/styles/runs.css`

**Steps:**
1. Add client methods for aborting a run and completing the current question.
2. Update the Runs page primary action so it shows `실행 시작`, `중단`, or `완료` based on the selected project’s live run/session state.
3. Make aborted runs render with the gray finished color family but a distinct `중단됨` label, while fully fixed runs keep the fixed/completed label.
4. Keep the start button available again after an abort by ensuring the runner session returns to idle and the web page derives controls from the refreshed live state.

### Task 6: Validate end to end

**Files:**
- Review: `packages/shared/src/test/*.ts`
- Review: `packages/web/src/pages/RunsPage.tsx`
- Review: `packages/runner/src/routes/runsRouter.ts`

**Steps:**
1. Run targeted shared tests for the changed lifecycle/session/orchestrator coverage.
2. Run `./scripts/check.sh`.
3. Run `./scripts/apply-dev-stack.sh`.
4. Run `./scripts/status-dev-stack.sh`.
5. Manually verify one run starts into 최근 실행 immediately, can be aborted, can be restarted, and a paused round can be marked complete into a fixed essay answer.
