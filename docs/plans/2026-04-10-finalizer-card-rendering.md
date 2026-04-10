# Finalizer Card Rendering Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Render completed `finalizer` output as a document-style card instead of the discussion-ledger message body path.

**Architecture:** Keep the existing drafter, coordinator, reviewer, and deep-feedback branches intact. Add a finalizer-only rendering branch in `RunsPage.tsx` that trims the raw body and injects trimmed markdown HTML into a dedicated card wrapper, then add finalizer-only document spacing rules in `runs.css`.

**Tech Stack:** React, TypeScript, marked, CSS

---

### Task 1: Isolate the finalizer render path

**Files:**
- Modify: `packages/web/src/pages/RunsPage.tsx`

**Step 1: Keep the existing visibility helper narrow**

Limit content cleanup to completed `finalizer` messages by reusing the current visible-content helper and `trimEnd()` on the raw text only for that role.

**Step 2: Add a dedicated finalizer card branch**

Inside `RunFeedMessage`, detect `finalizer` role messages before the generic markdown body branch and render them through a local `FinalDraftCard` helper, while leaving the completed-only raw trimming in the visible-content helper.

**Step 3: Trim injected HTML**

Ensure the dedicated card uses `renderMarkdown()` output that is trimmed before `dangerouslySetInnerHTML` so trailing block whitespace does not create an empty footer gap.

### Task 2: Add document-style finalizer spacing

**Files:**
- Modify: `packages/web/src/styles/runs.css`

**Step 1: Add a finalizer-only card selector**

Create a `.runs-finalizer-card` block or `.runs-feed-message-body.is-final-draft` variant without changing coordinator, drafter, reviewer, or streaming styles.

**Step 2: Tighten document spacing**

Use slightly denser line-height and paragraph/list spacing than the discussion ledger body, while keeping `white-space: pre-wrap` and existing code block readability.

**Step 3: Remove trailing bottom gaps**

Zero or minimize the last `p`, `ul`, and `ol` bottom margin inside the finalizer card only.

### Task 3: Validate

**Files:**
- Validate: `packages/web/src/pages/RunsPage.tsx`
- Validate: `packages/web/src/styles/runs.css`

**Step 1: Run the official validation**

Run: `./scripts/check.sh`

Expected: PASS across repo checks.

**Step 2: Review failures if any**

If validation fails, patch only the reported regression and rerun `./scripts/check.sh`.
