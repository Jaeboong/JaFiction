# Claude Writing Indicator Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore the feed typing indicator for Claude runs by separating the first `chat-message-started` event from the first visible text delta.

**Architecture:** Keep the fix in `packages/shared/src/core/providerStreaming.ts` so the runner emits the same event model for Claude that the UI already handles for Codex and Gemini. Avoid UI fallback changes unless the provider-level timing fix proves insufficient.

**Tech Stack:** TypeScript, Node test runner, shared stream processor, repo validation via `./scripts/check.sh`

---

### Task 1: Update Claude stream start behavior

**Files:**
- Modify: `packages/shared/src/core/providerStreaming.ts`

**Step 1: Confirm the current Claude branch behavior**

Read the `claude` branch in `StreamProcessor.handleStdout()` and verify that the first non-empty chunk emits both `chat-message-started` and `chat-message-delta` in the same call.

**Step 2: Apply the minimal provider fix**

Change the `claude` branch so the first `handleStdout()` call always emits `chat-message-started`, marks `plainStreamStarted = true`, and returns early when the cleaned chunk is whitespace-only.

**Step 3: Keep delta emission content-only**

Emit `chat-message-delta` only when `cleaned.trim()` is non-empty so whitespace-only chunks do not create empty content updates.

### Task 2: Add regression coverage

**Files:**
- Modify: `packages/shared/src/test/providerStreaming.test.ts`

**Step 1: Add a failing whitespace-first regression test**

Cover the Claude case where the first stdout chunk is whitespace-only and the next chunk contains visible text. Assert that the first call emits only `chat-message-started` and the second call emits the first `chat-message-delta`.

**Step 2: Preserve existing Claude stream expectations**

Keep the existing plain-text Claude streaming test passing so the fix does not regress ordinary chunked text streaming.

### Task 3: Validate with official entrypoint

**Files:**
- None

**Step 1: Run repo validation**

Run `./scripts/check.sh --write`.

**Step 2: Review failures carefully**

If validation fails, confirm whether the failure is related to this change before making any additional edits.
