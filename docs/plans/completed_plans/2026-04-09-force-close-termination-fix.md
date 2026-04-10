# Force-Close Termination Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stop realtime force-close runs from extending into an extra handoff loop after the forced handoff already succeeded.

**Architecture:** Keep the abort and handoff flow intact. Adjust only the realtime termination inference so a fully approved follow-up section can finalize when the coordinator did not explicitly ask for another handoff, even if historical deferred notes remain in the ledger.

**Tech Stack:** TypeScript, Node.js, shared orchestrator test harness

---

### Task 1: Reproduce the force-close mismatch

**Files:**
- Review: `packages/shared/src/test/orchestrator.test.ts`
- Review: `packages/shared/src/core/orchestrator.ts`

**Steps:**
1. Read the `realtime intervention force-close directives defer open challenges and hand off immediately` test.
2. Trace the force-close path through `handleImmediateRealtimeIntervention()`, ticket/ledger helpers, and the realtime loop termination checks.
3. Confirm the loop extends because deferred ledger notes are still treated as a future handoff target after the follow-up section is already approved.

### Task 2: Apply the minimal termination fix

**Files:**
- Modify: `packages/shared/src/core/orchestrator.ts`

**Steps:**
1. Limit the fix to the realtime termination decision path.
2. Preserve explicit coordinator outcomes such as `handoff-next-section`.
3. Allow finalization only for the implicit case where the current section is ready, all reviewers approve, and the coordinator did not explicitly request another handoff.

### Task 3: Validate the fix

**Files:**
- Review: `packages/shared/src/core/orchestrator.ts`
- Review: `packages/shared/src/test/orchestrator.test.ts`

**Steps:**
1. Run the targeted shared orchestrator test.
2. Run the requested repo check with `./scripts/check.sh`.
3. Report whether `apply-dev-stack` was skipped and why.
