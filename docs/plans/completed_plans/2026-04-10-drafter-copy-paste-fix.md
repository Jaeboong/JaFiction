# Drafter Copy Paste Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent drafter copy-paste leakage by sanitizing persisted drafter chat messages and matching the live Runs page rendering path to the same `Section Draft` body.

**Architecture:** Keep review-turn sanitizing as-is for `review-turns.json`, and add a separate chat-message sanitizing step at the shared event persistence boundary so `chat-messages.json` only stores the drafter body after `## Section Draft`. Mirror that rule in `RunsPage.tsx` for live deltas and completed message rendering, and align coordinator role comparisons with the actual runtime role value from participants.

**Tech Stack:** TypeScript, React, Node test runner, shared orchestrator parsing modules

---

### Task 1: Patch shared chat-message persistence

**Files:**
- Modify: `packages/shared/src/core/orchestrator.ts`

**Step 1: Keep review-turn sanitizing unchanged**

Leave `sanitizeStoredDrafterTurn()` in place so `review-turns.json` keeps using the existing drafter-only extraction path.

**Step 2: Sanitize completed drafter chat messages at the event sink**

At the `chatMessages` accumulation boundary, detect `chat-message-completed` events whose `speakerRole` is the drafter runtime role (`"drafter"` from `participants.ts`). Re-read the accumulated message content, extract the body under `## Section Draft`, and replace the stored message content only when that extraction succeeds.

**Step 3: Preserve fallback behavior**

If no `## Section Draft` heading is present, leave the original chat content untouched so existing fallback behavior remains intact.

### Task 2: Patch Runs page rendering

**Files:**
- Modify: `packages/web/src/pages/RunsPage.tsx`

**Step 1: Add a drafter display filter**

Introduce a helper that strips everything before `## Section Draft`, removes the heading itself, and returns only the body for drafter messages. If the heading is missing, return the original content.

**Step 2: Apply it to both live and completed UI paths**

Use the helper when appending `chat-message-delta` content so live drafter output updates correctly even if the heading arrives mid-stream. Reuse the same helper when rendering completed messages loaded from storage.

**Step 3: Fix coordinator role matching**

Replace stale `"section_coordinator"` comparisons with the actual runtime role value (`"coordinator"`), while keeping label text mappings intact.

### Task 3: Add regression coverage and validate

**Files:**
- Modify: `packages/shared/src/test/orchestrator.test.ts`

**Step 1: Add persisted chat-message regression coverage**

Verify `chat-messages.json` stores only the drafter `Section Draft` body, not the preceding ledger headings, while `review-turns.json` behavior remains intact.

**Step 2: Run validation**

Run: `./scripts/check.sh`

Expected: repo checks pass, or any failure is reported with cause.
