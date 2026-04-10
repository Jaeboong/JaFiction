# Run Status Indicator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the Runs page's coarse blue status dots with phase-aware indicators that distinguish active CLI execution, active waiting, round-complete waiting, failed runs, and fully fixed finished runs.

**Follow-up note (2026-04-09):** Persisted `running` records can survive a hot-reload or runner restart after the active terminal disappears. The Runs page must treat any `running` record without a matching live session as a stale failed run so the UI does not incorrectly show `대기 중`.

**Architecture:** Keep the change inside the existing Runs page and styles. Derive the live run phase from the current active run id, session state, and run WebSocket events so the page can color the selected run header, history dots, and live indicator without changing persisted run records or runner APIs.

**Tech Stack:** React, TypeScript, WebSocket run events, plain CSS

---

### Task 1: Lock the approved state model in code

**Files:**
- Modify: `packages/web/src/pages/RunsPage.tsx`
- Review: `packages/shared/src/core/types.ts`
- Review: `packages/shared/src/core/viewModels.ts`

**Steps:**
1. Add a Runs-page-local visual state model that maps to the approved semantics: yellow for active CLI execution, blue for active waiting, green for round-complete waiting, red for failure, and gray for fully fixed completion.
2. Derive the active live state from `runState` plus `turn-started`, `turn-completed`, `turn-failed`, `awaiting-user-input`, `user-input-received`, `run-completed`, and `run-failed` events.
3. Keep persisted `RunRecord.status` values unchanged and layer the richer visual state on top only in the UI.
4. Reclassify stale `running` records to the failed visual state when there is no matching live session for that run id.

### Task 2: Apply the visual state across the Runs page

**Files:**
- Modify: `packages/web/src/pages/RunsPage.tsx`
- Modify: `packages/web/src/styles/runs.css`

**Steps:**
1. Update the selected run header badge to use the new visual state label and color classes.
2. Update recent run history dots so the currently live run reflects the richer state while older completed and failed runs keep deterministic colors.
3. Update the control-card live indicator so it reflects the same current live phase instead of a generic blue "실시간" badge.

### Task 3: Validate behavior and finish

**Files:**
- Review: `packages/web/src/pages/RunsPage.tsx`
- Review: `packages/web/src/styles/runs.css`

**Steps:**
1. Run `./scripts/check.sh`.
2. Run `./scripts/apply-dev-stack.sh`.
3. Run `./scripts/status-dev-stack.sh`.
4. Summarize the new color semantics, the commands run, and any remaining manual smoke-check risk.
