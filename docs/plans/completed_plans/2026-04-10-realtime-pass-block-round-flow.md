# Realtime PASS/BLOCK Round Flow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Change only the realtime single-round orchestration branch to `coordinator -> drafter -> reviewers -> (BLOCK => coordinator synthesis + awaiting-user-input, PASS/REVISE only => finalizer)`.

**Architecture:** Keep the existing realtime participants, discussion ledger structure, multi-section handoff utilities, and deep feedback flow intact. Update the realtime reviewer contract to `PASS | REVISE | BLOCK`, add parser helpers for normalized reviewer packets, add prompt builders for coordinator BLOCK synthesis and finalizer integration, then replace only the realtime post-review branching logic in `orchestrator.ts`.

**Tech Stack:** TypeScript, shared orchestrator prompt/parsing helpers, Node test runner

---

### Task 1: Lock the new realtime branch with failing tests

**Files:**
- Modify: `packages/shared/src/test/orchestrator.test.ts`

**Step 1: Replace the old convergence-focused realtime tests**

Remove or rewrite the old realtime tests that assert:
- deferred-close handoff
- section close on REVISE-majority
- BLOCK hold without coordinator synthesis
- convergence notice escalation

**Step 2: Add the new BLOCK branch test**

Add a realtime test that proves:
- execution order is `coordinator -> drafter -> reviewers -> coordinator(block synthesis)`
- one `BLOCK` verdict prevents finalizer execution
- the BLOCK synthesis turn uses a distinct coordinator message scope
- `awaiting-user-input` is emitted and run status is observable as `awaiting-user-input` during the callback

**Step 3: Add the new PASS/REVISE branch test**

Add a realtime test that proves:
- `PASS` and `REVISE` only reviewer outcomes call the finalizer exactly once
- the finalizer prompt includes the drafter section draft and reviewer feedback
- no coordinator convergence turn runs after reviewers

**Step 4: Run the targeted test file and confirm failure**

Run: `./scripts/with-npm.sh run test -- packages/shared/src/test/orchestrator.test.ts`

Expected: FAIL because orchestrator still runs the old convergence loop and the prompt contract still says `APPROVE`.

### Task 2: Normalize reviewer verdict parsing and feedback packets

**Files:**
- Modify: `packages/shared/src/core/orchestrator/parsing/responseParsers.ts`
- Modify: `packages/shared/src/core/reviewerCard.ts`
- Modify: `packages/web/src/components/ReviewerCard.tsx`

**Step 1: Make `PASS` the canonical realtime reviewer status**

Update parser logic so:
- `PASS` is the canonical status
- `APPROVE` is still accepted as an alias and normalized to `PASS`
- missing status still falls back to `REVISE`

**Step 2: Add a normalized reviewer feedback packet helper**

Create a helper that returns per-reviewer packets with:
- reviewer label/id
- normalized status
- mini draft text
- challenge or objection summary
- cross-feedback summary

This packet will feed both coordinator BLOCK synthesis and finalizer prompts.

**Step 3: Reflect the new status in reviewer card parsing/UI**

Change reviewer card parsing and badge tone mapping from `APPROVE` to `PASS`.

### Task 3: Rewrite only the realtime prompt contract needed for the new branch

**Files:**
- Modify: `packages/shared/src/core/orchestrator/prompts/realtimePrompts.ts`

**Step 1: Update reviewer instructions to `PASS | REVISE | BLOCK`**

Prompt contract changes:
- reviewers output `Status: PASS`, `Status: REVISE`, or `Status: BLOCK`
- `PASS` means finalizer may keep the draft as-is except for compatible reviewer notes
- `REVISE` means the finalizer may absorb the requested change
- `BLOCK` means user input is required

**Step 2: Add a coordinator BLOCK synthesis prompt**

Create a realtime prompt that:
- consumes the current draft/ledger plus normalized reviewer packets
- synthesizes blocking reasons
- outputs exactly one user question for `handleRealtimeAwaitingUserInput`

**Step 3: Rewrite the realtime finalizer prompt**

Change the finalizer prompt so it:
- starts from the drafter section draft
- preserves PASS reviewer keep-points
- integrates REVISE reviewer requests
- assumes no BLOCK reviewer feedback remains

**Step 4: Remove old convergence-only prompt fragments that no longer apply**

Delete or stop using reviewer verdict summary / convergence notice fragments that only supported the old repeated coordinator loop.

### Task 4: Replace the realtime post-review branch in orchestrator

**Files:**
- Modify: `packages/shared/src/core/orchestrator.ts`

**Step 1: Keep the round skeleton unchanged through reviewers**

Retain:
- coordinator initial brief turn
- drafter turn
- reviewer turn execution
- existing intervention handling

**Step 2: Implement the BLOCK branch**

After collecting reviewer turns:
- if any normalized packet is `BLOCK`, run coordinator synthesis once
- pass the synthesized question into `handleRealtimeAwaitingUserInput(..., { markAwaitingStatus: true })`
- stop the realtime loop after the escalation path
- do not invoke finalizer

**Step 3: Implement the PASS/REVISE branch**

If every reviewer packet is `PASS` or `REVISE`:
- skip convergence / devil’s advocate / weak-consensus / section outcome routing
- run finalizer once
- store the finalizer output as the realtime revised draft
- finish the run

**Step 4: Leave unrelated realtime infrastructure untouched**

Do not modify:
- multi-section handoff helpers
- `DiscussionLedger` schema/parsing
- `SectionOutcome` types/utilities
- deep feedback flow

### Task 5: Validate with official entrypoints

**Files:**
- Validate: `packages/shared/src/core/orchestrator.ts`
- Validate: `packages/shared/src/core/orchestrator/prompts/realtimePrompts.ts`
- Validate: `packages/shared/src/core/orchestrator/parsing/responseParsers.ts`
- Validate: `packages/shared/src/core/reviewerCard.ts`
- Validate: `packages/web/src/components/ReviewerCard.tsx`
- Validate: `packages/shared/src/test/orchestrator.test.ts`

**Step 1: Run targeted realtime tests**

Run: `./scripts/with-npm.sh run test -- packages/shared/src/test/orchestrator.test.ts`

**Step 2: Run repo-wide deterministic checks**

Run: `./scripts/check.sh`

**Step 3: Do not run dev apply unless startup/routing behavior changes outside test execution**

This task changes shared orchestrator runtime behavior but not runner/web boot wiring, so `./scripts/apply-dev-stack.sh` is only needed if deterministic validation suggests a startup-path regression.
