# Codex And Gemini Streaming Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Runs execution feed show progressively updating Codex and Gemini agent messages instead of only finalized text when provider stdout supports incremental output.

**Architecture:** Keep the change scoped to the provider execution and stream parsing layer used by the existing run feed WebSocket events. Reuse the current `chat-message-started` / `delta` / `completed` event model so the UI and orchestrator can stay behaviorally unchanged while Codex and Gemini emit better incremental text.

**Tech Stack:** TypeScript, Node.js child process streaming, React run feed, node:test

---

### Task 1: Lock streaming expectations with tests

**Files:**
- Modify: `packages/shared/src/test/providerStreaming.test.ts`
- Review: `packages/shared/src/core/providerStreaming.ts`

**Steps:**
1. Add a failing test that proves Codex `output_text.delta` events append incrementally and do not duplicate final text when the completion event arrives.
2. Add a failing test that proves Gemini line-delimited JSON output can emit `chat-message-started`, multiple `chat-message-delta` events, and `chat-message-completed`.
3. Keep the assertions at the `RunEvent` layer so the tests describe user-visible run feed behavior rather than internal parser details.

### Task 2: Implement Codex and Gemini incremental parsing

**Files:**
- Modify: `packages/shared/src/core/providerStreaming.ts`
- Modify: `packages/shared/src/core/providerOptions.ts`
- Review: `packages/shared/src/core/providers.ts`

**Steps:**
1. Refine the Codex parser so `output_text.done` or `message.completed` final events complete the active message without re-appending text that already arrived through deltas.
2. Add Gemini stdout buffering and JSON-line parsing so incremental response records can emit run-feed chat events as they arrive.
3. Keep the existing fallback path that synthesizes a full message from final stdout when no incremental chat events were emitted.
4. Update Gemini CLI args only if needed to request a stream-friendly output format without changing the final parsed response contract.

### Task 3: Validate end-to-end compatibility

**Files:**
- Review: `packages/web/src/pages/RunsPage.tsx`
- Review: `packages/runner/src/ws/runHub.ts`
- Review: `packages/shared/src/core/orchestrator.ts`

**Steps:**
1. Verify the existing run feed event application logic still consumes the new provider events without UI changes.
2. Run the targeted shared tests for provider streaming.
3. Run `./scripts/check.sh`.
4. Because this changes provider execution behavior, run `./scripts/apply-dev-stack.sh` and `./scripts/status-dev-stack.sh` for a local smoke check.
5. Summarize what changed, what commands ran, and any remaining manual verification risk.
