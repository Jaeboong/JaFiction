# RunsPage Dropdown And History UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align RunsPage custom dropdown typography with existing field labels, replace selected-option checkmarks with filled accent styling, and move the history delete button to the bottom-right corner while preserving hover-only visibility.

**Architecture:** Keep the implementation local to the RunsPage UI layer. Use `packages/web/src/styles/runs.css` for typography, selection, and layout changes, and touch `packages/web/src/pages/RunsPage.tsx` only if the history item DOM needs a small structural adjustment for bottom-right button placement.

**Tech Stack:** React, TypeScript, CSS

---

### Task 1: Confirm the existing typography and history item structure

**Files:**
- Modify: `packages/web/src/styles/runs.css`
- Modify: `packages/web/src/pages/RunsPage.tsx`

**Step 1: Read the existing label and dropdown rules**

Confirm the current `font-size` used by `.runs-field-label`, `.runs-custom-select-trigger`, `.runs-custom-select-value`, and `.runs-custom-select-option`.

**Step 2: Read the history item layout**

Confirm whether `.runs-history-item` already provides a positioning context and whether the delete button can be moved with CSS alone.

### Task 2: Implement the dropdown style changes

**Files:**
- Modify: `packages/web/src/styles/runs.css`

**Step 1: Align typography**

Set `.runs-custom-select-trigger`, `.runs-custom-select-value`, and `.runs-custom-select-option` to the same font size used by `.runs-field-label`, while leaving `.runs-rounds-custom-select` overrides unchanged.

**Step 2: Replace selected-option checkmarks**

Update `.runs-custom-select-option.is-selected` to use the page accent blue background with white text, remove the checkmark pseudo-element, and ensure hover does not override the selected state.

### Task 3: Move the history delete button to the bottom-right corner

**Files:**
- Modify: `packages/web/src/styles/runs.css`
- Modify: `packages/web/src/pages/RunsPage.tsx` if needed

**Step 1: Preserve the current interaction model**

Keep the delete button hidden until hover on the history item.

**Step 2: Reposition the control**

Move the delete button to the lower-right corner using the current item container as the positioning context, adjusting item padding if needed so text and timestamp do not collide with the control.

### Task 4: Validate

**Files:**
- Modify: none

**Step 1: Run the repository validation entrypoint**

Run: `./scripts/check.sh`

**Step 2: Review the final diff**

Verify the change stays scoped to the targeted RunsPage UI files plus this plan document.
