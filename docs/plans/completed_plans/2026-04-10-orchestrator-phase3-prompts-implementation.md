# Orchestrator Phase 3 Prompt Builder Split Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the prompt builder helpers out of `packages/shared/src/core/orchestrator.ts` into dedicated prompt modules without changing function bodies or prompt string literals, validating after each extraction step.

**Architecture:** Keep `ReviewOrchestrator` and all orchestrator call sites intact. Extract the lowest-level prompt block helpers first into `promptBlocks.ts`, then move Deep Feedback prompt builders into `deepFeedbackPrompts.ts`, then move Realtime prompt builders into `realtimePrompts.ts`, adding only the imports required by the moved declarations.

**Tech Stack:** TypeScript, Jest, repo shell entrypoints under `scripts/`

---

### Task 1: Extract shared prompt blocks (A3)

**Files:**
- Create: `packages/shared/src/core/orchestrator/prompts/promptBlocks.ts`
- Modify: `packages/shared/src/core/orchestrator.ts`

**Step 1: Move the requested generic block builders**

Extract `buildPrompt`, `finalizePromptMetrics`, `sumPromptBlockChars`, `escapeRegExp`, `buildSessionSnapshotBlock`, `buildBindingDirectiveBlock`, `buildUserGuidanceBlock`, `buildDiscussionLedgerBlock`, `buildChallengeTicketBlock`, and `buildValidSectionKeysBlock` into `promptBlocks.ts`, preserving code and string literals exactly. Then run:

```bash
./scripts/with-node.sh ./node_modules/typescript/lib/tsc.js -p packages/shared/tsconfig.json --noEmit
./scripts/with-npm.sh run test -- --testPathPattern=orchestrator
```

### Task 2: Extract Deep Feedback prompts (A1)

**Files:**
- Create: `packages/shared/src/core/orchestrator/prompts/deepFeedbackPrompts.ts`
- Modify: `packages/shared/src/core/orchestrator.ts`

**Step 2: Move the deep-mode prompt builders**

Extract the requested Deep Feedback prompt builders, `getPerspectiveInstruction`, and the Deep-mode-only prompt block helpers into `deepFeedbackPrompts.ts`, wiring imports from `promptBlocks.ts`, `languageRules.ts`, `responseParsers.ts`, `continuation.ts`, and `participants.ts`. Then run:

```bash
./scripts/with-node.sh ./node_modules/typescript/lib/tsc.js -p packages/shared/tsconfig.json --noEmit
./scripts/with-npm.sh run test -- --testPathPattern=orchestrator
```

### Task 3: Extract Realtime prompts (A2)

**Files:**
- Create: `packages/shared/src/core/orchestrator/prompts/realtimePrompts.ts`
- Modify: `packages/shared/src/core/orchestrator.ts`
- Modify: `docs/development/NAVIGATION.md`

**Step 3: Move the realtime-mode prompt builders and finalize**

Extract the requested realtime prompt builders and their supporting block helpers into `realtimePrompts.ts`, importing from `promptBlocks.ts`, `languageRules.ts`, `discussionLedger.ts`, `convergenceEvaluator.ts`, `responseParsers.ts`, and `notionRequest.ts`. Update `NAVIGATION.md` to list the new prompt modules, then run:

```bash
./scripts/with-node.sh ./node_modules/typescript/lib/tsc.js -p packages/shared/tsconfig.json --noEmit
./scripts/with-npm.sh run test -- --testPathPattern=orchestrator
./scripts/check.sh
```
