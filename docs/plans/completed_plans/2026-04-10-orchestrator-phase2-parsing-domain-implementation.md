# Orchestrator Phase 2 Parsing/Domain Split Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the parsing and discussion-domain helpers out of `packages/shared/src/core/orchestrator.ts` without changing helper bodies or string literals, validating after each extraction batch.

**Architecture:** Keep `ReviewOrchestrator` and call sites in `orchestrator.ts` intact. For each step, cut the requested declarations into the target module, add only the imports needed for the moved code, import the moved symbols back into `orchestrator.ts`, then run the required compile and orchestrator tests before continuing.

**Tech Stack:** TypeScript, Jest, repo shell entrypoints under `scripts/`

---

### Task 1: Extract parsing + ledger helpers together

**Files:**
- Create: `packages/shared/src/core/orchestrator/parsing/responseParsers.ts`
- Create: `packages/shared/src/core/orchestrator/discussion/discussionLedger.ts`
- Modify: `packages/shared/src/core/orchestrator.ts`
- Modify: `packages/shared/src/core/orchestrator/realtimeSections.ts`

**Step 1: Extract `responseParsers.ts` + `discussionLedger.ts`**

Move the requested parsing and ledger helpers together so `extractDiscussionLedger` can consume the seeded ticket helpers without leaving a cycle. Preserve helper bodies exactly and switch `realtimeSections.ts` to import `getLedgerTickets` / `normalizeSectionKey` from the new discussion module. Then run:

```bash
./scripts/with-node.sh ./node_modules/typescript/lib/tsc.js -p packages/shared/tsconfig.json --noEmit
./scripts/with-npm.sh run test -- --testPathPattern=orchestrator
```

### Task 2: Extract convergence evaluator helpers

**Files:**
- Create: `packages/shared/src/core/orchestrator/discussion/convergenceEvaluator.ts`
- Modify: `packages/shared/src/core/orchestrator.ts`

**Step 2: Extract `convergenceEvaluator.ts`**

Move the realtime reviewer convergence helpers and the verdict summary type, preserving logic exactly, then run:

```bash
./scripts/with-node.sh ./node_modules/typescript/lib/tsc.js -p packages/shared/tsconfig.json --noEmit
./scripts/with-npm.sh run test -- --testPathPattern=orchestrator
```

### Task 3: Final validation + navigation update

**Files:**
- Modify: `docs/development/NAVIGATION.md`

Add the new orchestrator modules to the navigation table, then finish with:

```bash
./scripts/check.sh
```
