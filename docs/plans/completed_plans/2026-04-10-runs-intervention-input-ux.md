# Runs Intervention Input UX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Runs page intervention input stay enabled whenever the viewed run is the active conversation, support Enter-to-send, and allow `Shift+Enter` / `Alt+Enter` line breaks with auto-growing height.

**Architecture:** Keep the change local to the Runs page control panel. Rework the intervention composer in `RunsPage.tsx` so enable/disable and submit behavior follow live-session semantics rather than the current narrow `canIntervene` gate, and update `runs.css` so the composer can expand vertically as the user adds lines.

**Tech Stack:** React, TypeScript, CSS, existing runner/web state models

---

### Task 1: Update Runs intervention composer behavior

**Files:**
- Modify: `packages/web/src/pages/RunsPage.tsx`
- Modify: `packages/web/src/styles/runs.css`

**Step 1: Inspect current intervention composer logic**

Confirm the current `RunControlPanel` composer state, disabled conditions, and send handler in `packages/web/src/pages/RunsPage.tsx`.

**Step 2: Rework enable/disable and submit conditions**

Update the composer so it is disabled only when the run has not started, when the active session has been stopped and no longer exists, or when the selected run is not the active conversation. Keep paused and running live sessions interactive.

**Step 3: Add keyboard submit and multiline behavior**

Convert the intervention bar into a local submit flow that sends on plain `Enter`, ignores `Enter` during IME composition, and inserts line breaks on `Shift+Enter` and `Alt+Enter`.

**Step 4: Auto-grow the input as lines are added**

Change the intervention input to a multiline control that grows by one visual line as content wraps or line breaks are added, while preserving the existing card layout.

**Step 5: Validate the updated behavior**

Run targeted build validation for the web package so the updated `RunsPage` and styles type-check and bundle cleanly.

