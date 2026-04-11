# Orchestrator Phase 1 Leaf Split Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the designated leaf helpers out of `packages/shared/src/core/orchestrator.ts` without changing helper bodies or prompt strings, validating after each extraction.

**Architecture:** Keep `ReviewOrchestrator` and call sites in `orchestrator.ts` intact. For each step, cut the requested declarations into a new module, add the minimal imports needed for the moved code, import the moved symbols back into `orchestrator.ts`, then run the required TypeScript compile and orchestrator tests before continuing.

**Tech Stack:** TypeScript, Jest, repo shell entrypoints under `scripts/`

---

### Task 1: Phase 1 leaf extraction sequence

**Files:**
- Create: `packages/shared/src/core/orchestrator/chatEvents.ts`
- Create: `packages/shared/src/core/orchestrator/notionRequest.ts`
- Create: `packages/shared/src/core/orchestrator/realtimeSections.ts`
- Create: `packages/shared/src/core/orchestrator/continuation.ts`
- Create: `packages/shared/src/core/orchestrator/participants.ts`
- Create: `packages/shared/src/core/orchestrator/prompts/languageRules.ts`
- Modify: `packages/shared/src/core/orchestrator.ts`
- Modify: `docs/development/NAVIGATION.md`

**Step 1: Extract `chatEvents.ts`**

Move `applyChatEvent`, `chatSpeakerLabel`, and `providerLabel`, then run:

```bash
./scripts/with-node.sh ./node_modules/typescript/lib/tsc.js -p packages/shared/tsconfig.json --noEmit
./scripts/with-npm.sh run test -- --testPathPattern=orchestrator
```

**Step 2: Extract `notionRequest.ts`**

Move the Notion request types and helpers, preserving bodies exactly. If a moved helper depends on another local helper, satisfy that dependency with the smallest safe shared import and re-run the same validation commands.

**Step 3: Extract `realtimeSections.ts`**

Move the base realtime section definitions and builder, preserving logic and validating again.

**Step 4: Extract `continuation.ts`**

Move the continuation helpers and `truncateContinuationText`, then validate again.

**Step 5: Extract `participants.ts`**

Move the participant interface and builders plus `turnLabel`, then validate again.

**Step 6: Extract `prompts/languageRules.ts`**

Move the Korean language rule builders, validate again, then update navigation docs for the new source files and finish with:

```bash
./scripts/check.sh
```
