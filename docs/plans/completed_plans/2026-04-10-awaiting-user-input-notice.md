# Awaiting User Input Notice Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show a one-time warning notice when a live run first emits `awaiting-user-input` over WebSocket.

**Architecture:** Keep the change in the web layer. Reuse `App.tsx`'s existing action notice state, add a narrow callback prop to `RunsPage.tsx`, and fire it only when `reduceLiveRunVisualState()` handles the first live `awaiting-user-input` event for the current run. Do not emit notices when loading an already-paused run from persisted state, and do not change the existing deep-feedback notice path.

**Tech Stack:** TypeScript, React, CSS

---

### Task 1: Wire the notice callback

**Files:**
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/pages/RunsPage.tsx`

**Step 1: Extend notice tone support**

Add a `warning` action notice tone in `App.tsx` and reuse `showActionNotice()` for the new run-blocked message.

**Step 2: Trigger once per live run**

Add an `onAwaitingUserInput` prop to `RunsPage`, track whether the current live run has already emitted the notice, and invoke the callback only on the first `awaiting-user-input` WebSocket event.

**Step 3: Keep persisted waiting runs silent**

Reset the per-run flag when the live run changes, but do not emit a notice when the page loads into an already paused or `awaiting-user-input` state from `SidebarState`.

### Task 2: Style the warning notice

**Files:**
- Modify: `packages/web/src/styles.css`

**Step 1: Add warning notice styling**

Add a warning badge and, if needed, a warning notice accent so the new notice renders in the existing app notice stack without affecting pending/success/error behavior.

### Task 3: Validate

**Files:**
- Modify only if validation reveals a type or style regression.

**Step 1: Run repository checks**

Run:
`./scripts/check.sh`
