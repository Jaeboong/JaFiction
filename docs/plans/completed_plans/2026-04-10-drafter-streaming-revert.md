# Drafter Streaming Revert Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore live drafter streaming while keeping completed-message sanitizing for preamble-only outputs.

**Architecture:** Revert the shared orchestrator back to immediate event forwarding and keep the drafter sanitizing rule only at completed-message persistence time. Move the preamble suppression to the Runs page display path so streaming messages stay hidden until `## Section Draft` appears, then render only the body after that header.

**Tech Stack:** TypeScript, React, Node test runner, shared orchestrator parsing

---

### Task 1: Revert shared drafter buffering

**Files:**
- Modify: `packages/shared/src/core/orchestrator.ts`
- Test: `packages/shared/src/test/orchestrator.test.ts`

**Step 1: Remove the drafter event buffer**

Delete the `drafterEventBuffer` map and the helper that buffered drafter started/delta events until completion.

**Step 2: Keep completed-message sanitizing only**

At the event sink, sanitize the stored message only for `chat-message-completed`, persist the event, and suppress forwarding only when the sanitized drafter content becomes `""`.

**Step 3: Update regression coverage**

Adjust the existing orchestrator regression to assert that drafter preamble `started` and `delta` events are forwarded immediately while the preamble `completed` event stays suppressed.

### Task 2: Apply UI-side streaming filtering

**Files:**
- Modify: `packages/web/src/pages/RunsPage.tsx`

**Step 1: Keep raw drafter content in local message state**

Stop filtering drafter deltas while accumulating `messages` so split headers and later body text can be interpreted from the full streamed content.

**Step 2: Filter only at render time**

Add a message-content helper that:
- hides drafter messages while `status === "streaming"` and `## Section Draft` has not appeared
- strips everything before `## Section Draft` once it appears
- skips completed drafter messages whose content is `""`

### Task 3: Validate

**Step 1: Run deterministic repo checks**

Run: `./scripts/check.sh`

Expected: shared tests, runner tests, web build, and docs checks pass.
