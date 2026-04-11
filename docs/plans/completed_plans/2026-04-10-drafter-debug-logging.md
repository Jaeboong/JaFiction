# Drafter Debug Logging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add opt-in JSONL instrumentation around drafter prompt assembly, raw responses, parsing, and chat-message sanitization so the coordinator-instruction contamination point can be traced without changing runtime behavior.

**Architecture:** Keep the logger isolated in a new shared utility that silently no-ops unless both `JASOJEON_DRAFTER_DEBUG=1` and `JASOJEON_DRAFTER_DEBUG_FILE` are set. Call that helper only at the existing drafter execution and chat-message persistence boundaries in `orchestrator.ts`, and wire the dev runner entrypoint to emit logs into `.harness/logs/drafter-debug.jsonl`.

**Tech Stack:** TypeScript, Node `fs`, shared orchestrator pipeline, bash harness scripts

---

### Task 1: Add the shared logger utility

**Files:**
- Create: `packages/shared/src/core/debugLogger.ts`

**Step 1: Create the JSONL logger**

Implement `logDrafterDebug(event, data)` so it appends one JSON object per line with an ISO timestamp.

**Step 2: Keep it strictly opt-in and non-throwing**

Gate logging on `JASOJEON_DRAFTER_DEBUG=1` plus a configured file path, and swallow all file-write errors.

### Task 2: Instrument the orchestrator capture points

**Files:**
- Modify: `packages/shared/src/core/orchestrator.ts`

**Step 1: Import the logger**

Add a direct import from `./debugLogger`.

**Step 2: Log the drafter prompt and raw response**

Add capture points immediately before and after both drafter `executeTurn()` calls for deep-cycle and realtime flows.

**Step 3: Log parsed drafter output and chat sanitization**

Record parser extraction output after `splitSectionDraftOutput()` and `extractSectionDraft()`. Record raw completed drafter chat content before sanitization inside `eventSink`, and record input/output previews inside `sanitizeStoredDrafterChatMessage()`.

### Task 3: Wire the dev runner and update navigation

**Files:**
- Modify: `scripts/start-dev-runner.sh`
- Modify: `docs/development/NAVIGATION.md`

**Step 1: Export drafter debug env vars**

Set the debug toggle and JSONL output path after `ensure_harness_dirs`, before foreground/background startup branches.

**Step 2: Preserve env vars in the background launch**

Prefix the background runner command with the same env vars so the detached process inherits them reliably.

**Step 3: Update file navigation**

Add `debugLogger.ts` to the shared core file map with its purpose.

### Task 4: Validate

**Files:**
- Modify: none

**Step 1: Run targeted build validation**

Run: `./scripts/with-npm.sh run build`

Expected: TypeScript packages build successfully with the new logger instrumentation.

**Step 2: Run deterministic checks**

Run: `./scripts/check.sh`

Expected: repo checks pass, or any failures are reported verbatim.
