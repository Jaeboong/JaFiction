# Discussion Ledger Persistence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist `DiscussionLedger` snapshots per run so the Runs page can restore coordinator ledger cards after WebSocket replay expires or the page is revisited later.

**Architecture:** Add a `RunLedgerEntry` persistence path beside existing `chat-messages.json` storage in the shared run repository. Update the runner `/:runId/messages` fallback API to return both persisted chat messages and persisted ledgers, then rebuild the web `ledgerMap` from that payload when the WebSocket delivers no replay.

**Tech Stack:** TypeScript, Express, React, shared filesystem storage, node:test

---

### Task 1: Lock down the persistence contract

**Files:**
- Modify: `packages/shared/src/test/storage.test.ts`
- Modify: `packages/runner/src/test/runsRouter.test.ts`

**Step 1: Add shared storage coverage**

Write a test that saves a `RunLedgerEntry[]` through `ForJobStorage`, reloads it, and asserts the persisted `DiscussionLedger` fields survive round-trip JSON storage.

**Step 2: Add runner fallback payload coverage**

Write a route test for `GET /api/projects/:projectSlug/runs/:runId/messages` that seeds both chat messages and ledger entries, then asserts the JSON response includes both `messages` and `ledgers`.

### Task 2: Extend shared run persistence

**Files:**
- Modify: `packages/shared/src/core/types.ts`
- Modify: `packages/shared/src/core/storageInterfaces.ts`
- Modify: `packages/shared/src/core/runRepository.ts`
- Modify: `packages/shared/src/core/storage.ts`

**Step 1: Add `RunLedgerEntry` domain type**

Define the persisted ledger envelope next to other run chat/event types so shared, runner, and web layers import a single source of truth.

**Step 2: Add repository and storage methods**

Mirror the existing `saveRunChatMessages` / `loadRunChatMessages` shape with `saveRunLedgers` / `loadRunLedgers`, storing data in `chat-ledgers.json`.

### Task 3: Persist ledgers from run events and expose them over HTTP

**Files:**
- Modify: `packages/runner/src/routes/runsRouter.ts`

**Step 1: Accumulate ledger updates during `startRun`**

Track `discussion-ledger-updated` events in a local `Map`, keyed by participant/round/message identity, and write the current ledger snapshot array to storage whenever a ledger event arrives.

**Step 2: Expand the messages fallback route**

Load `chat-messages.json` and `chat-ledgers.json` in parallel and return both arrays from `GET /:runId/messages`.

### Task 4: Restore ledger state in the web fallback path

**Files:**
- Modify: `packages/web/src/api/client.ts`
- Modify: `packages/web/src/pages/RunsPage.tsx`

**Step 1: Return the expanded payload from `RunnerClient.getRunMessages`**

Change the client API type from `RunChatMessage[]` to `{ messages, ledgers }`.

**Step 2: Rebuild `ledgerMap` during HTTP fallback**

When the WebSocket provides no buffered events, set messages as before and also rebuild a fresh `Map<string, DiscussionLedger>` using `buildLedgerMapKey(entry.participantId, entry.round, entry.messageId)`.

### Task 5: Validate

**Files:**
- Modify only if type or test fixes are required.

**Step 1: Run targeted tests**

Run:
`./scripts/with-npm.sh run test -- packages/shared/src/test/storage.test.ts packages/runner/src/test/runsRouter.test.ts`

**Step 2: Run repository checks**

Run:
`./scripts/check.sh`
