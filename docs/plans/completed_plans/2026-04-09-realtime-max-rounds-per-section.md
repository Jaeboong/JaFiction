# Realtime Max Rounds Per Section Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the realtime orchestrator stop, hand off, or wait for user input based on a configurable per-section round cap instead of the hardcoded 4-round safety limit.

**Architecture:** Add `maxRoundsPerSection` to the run request/record schemas with a default of `1` for backward compatibility. Thread that value through the run start and continuation paths, update realtime orchestration branching to use it, and expose a bounded numeric input in the run composer UI.

**Tech Stack:** TypeScript, Zod, React, Express

---

### Task 1: Add the execution setting to shared types and schemas

**Files:**
- Modify: `packages/shared/src/core/types.ts`
- Modify: `packages/shared/src/core/schemas.ts`
- Modify: `packages/shared/src/core/webviewProtocol.ts`
- Test: `packages/shared/src/test/webviewProtocol.test.ts`

**Step 1:** Add `maxRoundsPerSection` to `RunRequest` and `RunRecord`.

**Step 2:** Add Zod validation with `number`, integer, `min(1)`, and default `1` where persisted data or incoming requests should tolerate omission.

**Step 3:** Extend continuation payload schemas so the value survives continuation flows.

**Step 4:** Update protocol tests to cover the new field and legacy defaulting behavior.

### Task 2: Replace the hardcoded realtime safety checkpoint

**Files:**
- Modify: `packages/shared/src/core/orchestrator.ts`
- Test: `packages/shared/src/test/orchestrator.test.ts`

**Step 1:** Replace the `round % 4 === 0` logic with `round % maxRoundsPerSection === 0`.

**Step 2:** Apply the new rule after the round cap is reached:
- if there is no blocking reviewer status, close the section by handoff/final/section close without forcing user input
- if there is a blocking reviewer status, keep the existing pause-for-user-input flow

**Step 3:** Add tests for:
- configurable pause when the cap is reached with `BLOCK`
- configurable auto-close/handoff/final progression when the cap is reached without `BLOCK`

### Task 3: Thread the setting through runner routes and UI

**Files:**
- Modify: `packages/runner/src/routes/runsRouter.ts`
- Modify: `packages/web/src/pages/RunsPage.tsx`

**Step 1:** Accept `maxRoundsPerSection` from the run start request with safe fallback to `1`.

**Step 2:** Preserve the value when creating continuation runs and when returning continuation presets.

**Step 3:** Add a number input near the existing run parameters UI with label `섹션당 최대 라운드`, `min=1`, `max=10`, and send the parsed value on run start.

### Task 4: Verify web build

**Files:**
- No source changes expected

**Step 1:** Run `npm run build:web`.

**Step 2:** If build fails, fix type/schema/UI regressions until it passes.
