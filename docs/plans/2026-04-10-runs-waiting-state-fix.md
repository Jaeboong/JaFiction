# Runs Waiting-State Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix Runs page status mapping so `awaiting-user-input` renders as a dedicated blue waiting state and move the recent-run status dot above the delete button.

**Architecture:** Limit behavior changes to the web layer. Add a dedicated `waiting` visual state in `RunsPage.tsx`, wire `awaiting-user-input` events and records to it, and extend `runs.css` with a matching blue variant while leaving existing running, failed, and terminal colors intact. Rework the history card layout with absolute positioning instead of changing the component structure.

**Tech Stack:** TypeScript, React, CSS

---

### Task 1: Add the waiting visual mapping

**Files:**
- Modify: `packages/web/src/formatters.ts`
- Modify: `packages/web/src/pages/RunsPage.tsx`

**Step 1: Update formatter tone**

Change `statusToneForRunStatus("awaiting-user-input")` from warning to info so the generic run status tone matches the intended blue waiting state.

**Step 2: Add an explicit `waiting` visual state**

Extend the `RunVisualState` union, map paused/live awaiting states to `waiting`, and return `waiting` for persisted `awaiting-user-input` records.

**Step 3: Update labels**

Render `waiting` as `입력 대기 중` so the active badge and live indicator match the new state.

### Task 2: Reposition the history dot

**Files:**
- Modify: `packages/web/src/styles/runs.css`

**Step 1: Add the waiting blue selectors**

Add `waiting` variants for the history dot, page status badge, and live indicator.

**Step 2: Move the dot and delete button**

Use absolute positioning on the history card so the dot sits at the top-right and the delete button sits below it without overlapping card content.

### Task 3: Validate

**Files:**
- Modify only if validation reveals type or style regressions.

**Step 1: Run repository checks**

Run:
`./scripts/check.sh`
