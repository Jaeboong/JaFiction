# Run Streaming Writing Indicator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show a clear inline `작성 중...` indicator in the Runs page chat feed while an agent message is still streaming.

**Architecture:** Keep the change inside the existing Runs page rendering layer. Reuse the current `RunChatMessage.status === "streaming"` signal, add a small header badge plus an inline placeholder when the message body is still empty, and leave the WebSocket/event model unchanged.

**Tech Stack:** React, TypeScript, plain CSS

---

### Task 1: Add inline writing indicators to streaming chat messages

**Files:**
- Modify: `packages/web/src/pages/RunsPage.tsx`

**Steps:**
1. Detect streaming messages in `RunFeedMessage`.
2. Add a compact `작성 중...` status badge next to the speaker metadata while streaming.
3. Show `(작성 중...)` inside the message bubble when a streaming message has no visible content yet.
4. Keep the existing cursor indicator for streaming messages that already have content.

### Task 2: Style the streaming badge and placeholder

**Files:**
- Modify: `packages/web/src/styles/runs.css`

**Steps:**
1. Add a small pill style for the streaming status badge in the message header.
2. Add muted placeholder styling for the empty streaming bubble text.
3. Preserve existing feed spacing and avoid changing completed-message visuals.

### Task 3: Validate the UI change

**Files:**
- Review: `packages/web/src/pages/RunsPage.tsx`
- Review: `packages/web/src/styles/runs.css`

**Steps:**
1. Run `./scripts/with-node.sh ./node_modules/typescript/lib/tsc.js -p ./packages/web/tsconfig.json`.
2. Run `./scripts/check.sh`.
3. Run `./scripts/apply-dev-stack.sh`.
4. Run `./scripts/status-dev-stack.sh`.
5. Smoke-check the Runs page at `http://localhost:4124` and confirm a streaming message shows the new writing indicator.
