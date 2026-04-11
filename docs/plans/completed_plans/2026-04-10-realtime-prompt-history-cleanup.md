# Realtime Prompt History Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce duplicated or misleading realtime prompt context by filtering persisted chat history, removing coordinator turns from generic realtime history, stripping prompt-time ledger headings, removing the coordinator-reference fallback to the current ledger, and locking the behavior with regressions.

**Architecture:** Keep the change inside shared orchestrator and prompt-building code. First tighten persisted chat-message snapshots so fallback history cannot reload incomplete turns, then simplify realtime prompt assembly so reviewers and coordinators see only intentional reference blocks instead of repeated ledger/coordinator payloads.

**Tech Stack:** TypeScript, Node test runner, shared orchestrator prompt builders

---

### Task 1: Filter persisted chat history

**Files:**
- Modify: `packages/shared/src/core/orchestrator.ts`

**Steps:**
1. Filter persisted `chat-messages.json` writes to completed messages only.
2. Preserve user-visible completed messages and avoid saving in-flight partial turns.
3. Run `./scripts/check.sh`.

### Task 2: Remove coordinator turns from generic realtime history

**Files:**
- Modify: `packages/shared/src/core/orchestrator/prompts/realtimePrompts.ts`

**Steps:**
1. Update generic realtime history construction so completed coordinator turns are excluded.
2. Keep dedicated coordinator-reference blocks as the only coordinator carry-over.
3. Run `./scripts/check.sh`.

### Task 3: Remove prompt-time ledger headings

**Files:**
- Modify: `packages/shared/src/core/orchestrator/prompts/promptBlocks.ts`
- Modify: `packages/shared/src/core/orchestrator/prompts/realtimePrompts.ts`

**Steps:**
1. Allow prompt-time ledger blocks without an outer heading.
2. Switch realtime prompt call sites that embed ledger blocks inline to the headingless form.
3. Run `./scripts/check.sh`.

### Task 4: Remove coordinator-reference fallback to current ledger

**Files:**
- Modify: `packages/shared/src/core/orchestrator/prompts/realtimePrompts.ts`

**Steps:**
1. Stop synthesizing a coordinator reference from the current ledger when no prior coordinator turn exists.
2. Keep coordinator references sourced only from real previous coordinator output.
3. Run `./scripts/check.sh`.

### Task 5: Add regression coverage

**Files:**
- Modify: `packages/shared/src/test/orchestrator.test.ts`

**Steps:**
1. Add regressions for persisted chat filtering and cleaned realtime reviewer prompt context.
2. Assert the removed duplicate context no longer appears while intended reference blocks remain.
3. Run `./scripts/check.sh`.
