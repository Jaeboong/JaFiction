# Drafter Brief Block Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the realtime drafter's heading-heavy coordinator ledger block with a flat prose-only coordinator brief so the drafter stops mirroring coordinator labels in Korean output.

**Architecture:** Keep the existing coordinator and reviewer ledger builders unchanged. Add one drafter-only brief builder in `promptBlocks.ts`, switch only `buildRealtimeSectionDrafterPrompt` to consume it, and lock the new contract with targeted orchestrator prompt tests.

**Tech Stack:** TypeScript, Node test runner, shared orchestrator prompt builders

---

### Task 1: Add the drafter-only brief block builder

**Files:**
- Modify: `packages/shared/src/core/orchestrator/prompts/promptBlocks.ts`
- Test: `packages/shared/src/test/orchestrator.test.ts`

**Step 1: Write the failing test**

Add a prompt-block assertion that the drafter brief:
- uses `<coordinator-brief>`
- excludes `###` and `## `
- excludes `sectionDraft` content

**Step 2: Run test to verify it fails**

Run: `./scripts/with-npm.sh run test -- packages/shared/src/test/orchestrator.test.ts`

Expected: FAIL because `buildDrafterBriefBlock` does not exist yet.

**Step 3: Write minimal implementation**

Add `buildDrafterBriefBlock(ledger?: DiscussionLedger)` after `buildDrafterLedgerBlock` and format the brief as flat lines only.

**Step 4: Run test to verify it passes**

Run: `./scripts/with-npm.sh run test -- packages/shared/src/test/orchestrator.test.ts`

Expected: PASS for the new brief-builder assertions.

### Task 2: Swap the realtime drafter prompt to the new brief format

**Files:**
- Modify: `packages/shared/src/core/orchestrator/prompts/realtimePrompts.ts`
- Test: `packages/shared/src/test/orchestrator.test.ts`

**Step 1: Write the failing test**

Update drafter prompt assertions so they require:
- `<coordinator-brief>`
- no `### Current Focus`
- no `### Previous Draft`
- stricter anti-label instruction text

**Step 2: Run test to verify it fails**

Run: `./scripts/with-npm.sh run test -- packages/shared/src/test/orchestrator.test.ts`

Expected: FAIL because the drafter prompt still uses `<coordinator-context>`.

**Step 3: Write minimal implementation**

Replace the realtime drafter prompt's `buildDrafterLedgerBlock` usage with `buildDrafterBriefBlock`, remove any redundant wrapping, and tighten the prompt instructions against reproducing coordinator labels.

**Step 4: Run test to verify it passes**

Run: `./scripts/with-npm.sh run test -- packages/shared/src/test/orchestrator.test.ts`

Expected: PASS for the updated drafter prompt assertions.

### Task 3: Run repo validation

**Files:**
- Validate: `packages/shared/src/core/orchestrator/prompts/promptBlocks.ts`
- Validate: `packages/shared/src/core/orchestrator/prompts/realtimePrompts.ts`
- Validate: `packages/shared/src/test/orchestrator.test.ts`

**Step 1: Run the official validation**

Run: `./scripts/check.sh`

Expected: PASS across repo checks.

**Step 2: Review failures if any**

If validation fails, inspect the first failing test or type error, patch minimally, and rerun `./scripts/check.sh`.
