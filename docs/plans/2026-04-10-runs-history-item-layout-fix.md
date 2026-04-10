# Runs History Item Layout Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align the recent-runs history item so the status dot stays inline with the company name, the delete button sits on the same row as the relative timestamp, and the item height shrinks to fit its content.

**Architecture:** Keep the change scoped to the RunsPage UI layer. Update the history item markup in `packages/web/src/pages/RunsPage.tsx` and replace the old absolute-positioned history controls in `packages/web/src/styles/runs.css` with a compact inline grid layout.

**Tech Stack:** React, TypeScript, CSS

---

### Task 1: Restructure the history item markup

**Files:**
- Modify: `packages/web/src/pages/RunsPage.tsx`

**Step 1: Move the company name into the top row with the status dot**

Keep the company name and visual-state dot in the same `.runs-history-topline` container so they align on a single row.

**Step 2: Give the timestamp a dedicated hook**

Add a `runs-history-time` class to the relative timestamp so the bottom row can be styled without affecting unrelated `<small>` elements.

### Task 2: Replace the absolute-positioned layout with a compact inline layout

**Files:**
- Modify: `packages/web/src/styles/runs.css`

**Step 1: Convert the item shell to a two-column grid**

Lay out the selectable content and delete button in the same grid so the delete control can align with the bottom metadata row instead of floating independently.

**Step 2: Compress vertical spacing**

Reduce history-item padding and row gaps so each item height follows its content instead of reserving extra empty space.

**Step 3: Keep hover-only delete visibility**

Preserve the current hover reveal and allow `:focus-within` to expose the delete button for keyboard access.

### Task 3: Validate the change

**Files:**
- Modify: none

**Step 1: Run repository validation**

Run: `./scripts/check.sh`

**Step 2: Review final scope**

Confirm the diff stays limited to the two RunsPage UI files plus this plan document.
