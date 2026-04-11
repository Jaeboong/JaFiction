# DiscussionLedger Persistence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist run discussion ledgers to disk so completed or re-opened runs can restore ledger cards even after the RunHub replay buffer expires.

**Architecture:** Add a first-class `RunLedgerEntry` type and `chat-ledgers.json` artifact in the shared storage layer, then make the runner upsert ledger updates into that artifact as `discussion-ledger-updated` events stream through. Extend the run history HTTP fallback to return both messages and ledgers, and hydrate the web `ledgerMap` from the persisted entries using the same `participantId:round:messageId` key that live updates already use.

**Tech Stack:** TypeScript, Node.js filesystem persistence, Express router handlers, React state hydration, node:test.

---

### Task 1: Add failing coverage for persisted ledgers

**Files:**
- Modify: `packages/shared/src/test/storage.test.ts`
- Modify: `packages/runner/src/test/runsRouter.test.ts`

**Step 1: Write the failing storage test**

Add a test that saves `RunLedgerEntry[]` through `ForJobStorage`, reloads it, and asserts the artifact round-trips with the expected ledger payload.

**Step 2: Write the failing runner route test**

Seed `chat-messages.json` and persisted ledgers for a run, call `GET /api/projects/:projectSlug/runs/:runId/messages`, and assert the response includes both arrays.

**Step 3: Run the focused tests to verify they fail**

Run: `./scripts/with-npm.sh run test -- packages/shared/src/test/storage.test.ts packages/runner/src/test/runsRouter.test.ts`

Expected: compile or assertion failure because ledger persistence APIs and route payload are not implemented yet.

### Task 2: Add shared ledger persistence APIs

**Files:**
- Modify: `packages/shared/src/core/types.ts`
- Modify: `packages/shared/src/core/storageInterfaces.ts`
- Modify: `packages/shared/src/core/runRepository.ts`
- Modify: `packages/shared/src/core/storage.ts`

**Step 1: Add the `RunLedgerEntry` type**

Define the persisted ledger entry shape next to the existing run/chat domain types so runner and web can share it.

**Step 2: Extend the storage interfaces**

Add `saveRunLedgers` and `loadRunLedgers` to the run store interface using `RunLedgerEntry[]`.

**Step 3: Implement repository persistence**

Persist ledgers into `chat-ledgers.json`, following the same validation and optional-load pattern already used for `chat-messages.json`.

**Step 4: Delegate through `ForJobStorage`**

Expose the new methods by forwarding to `RunRepository`.

### Task 3: Persist ledgers from runner events and expose them over HTTP

**Files:**
- Modify: `packages/runner/src/routes/runsRouter.ts`

**Step 1: Add a ledger entry merge helper**

Introduce a small helper that builds the `participantId:round:messageId` key and merges existing plus incoming entries into a deterministic array.

**Step 2: Persist `discussion-ledger-updated` events**

Inside the run event sink, when a ledger update arrives with a resolved message id, load existing ledgers, upsert the current entry, and write the merged result back through storage.

**Step 3: Extend the history endpoint**

Load chat messages and ledgers in parallel and return `{ messages, ledgers }`.

### Task 4: Restore ledgers in the web fallback path

**Files:**
- Modify: `packages/web/src/api/client.ts`
- Modify: `packages/web/src/pages/RunsPage.tsx`

**Step 1: Update the API client contract**

Change `getRunMessages` to return both `messages` and `ledgers`.

**Step 2: Hydrate `ledgerMap` from persisted ledgers**

In `RunFeed`, update the fallback request handling to rebuild the `Map<string, DiscussionLedger>` from the returned entries while preserving the existing message hydration behavior.

**Step 3: Keep types aligned**

Update prop signatures and imports so the new response shape flows through without `any`.

### Task 5: Verify and close out

**Files:**
- Modify if needed: `docs/development/NAVIGATION.md` only if any new tracked source file is added or removed

**Step 1: Run focused tests**

Run: `./scripts/with-npm.sh run test -- packages/shared/src/test/storage.test.ts packages/runner/src/test/runsRouter.test.ts`

Expected: PASS

**Step 2: Run full repo validation**

Run: `./scripts/check.sh`

Expected: PASS

**Step 3: Summarize validation and residual risk**

Report the changed files, commands run, whether `check` ran, whether `apply-dev-stack` was skipped, and any manual verification still worth doing for ledger rendering after page reload.
