# Part B Convergence And Quality Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add deferred-close handling, opaque challenge ticket ids, stricter Korean formal-tone guidance, section-role boundary prompting, and reviewer convergence controls to realtime orchestration.

**Architecture:** Keep the changes inside `packages/shared/src/core/orchestrator.ts` plus the supporting shared types and schemas. Extend the existing ledger and prompt-builder flow instead of refactoring the realtime loop, and prove each behavior with focused `orchestrator.test.ts` cases before implementation.

**Tech Stack:** TypeScript, Zod, Node test runner, shared orchestrator realtime workflow

---

### Task 1: Lock the target tests

**Files:**
- Modify: `packages/shared/src/test/orchestrator.test.ts`
- Read: `packages/shared/src/core/orchestrator.ts`

**Step 1: Add failing coverage for the new prompt and flow expectations**

Add or extend focused realtime tests for:
- opaque `t-...-hash` challenge ticket ids
- `Valid Section Keys` prompt block exposure
- formal-speech rule injection in the four prompt builders
- `Section Role Boundary` prompt block rendering
- majority `REVISE` and minority summary propagation into the next coordinator prompt
- third consecutive `REVISE` round convergence notice and escalation to `awaiting-user-input`
- `deferred-close` causing current-section tickets to move to deferred and hand off

**Step 2: Run only the orchestrator tests to confirm at least one new assertion fails**

Run: `./scripts/with-npm.sh run test -- --testPathPattern=orchestrator`

Expected: FAIL on the newly added assertions before implementation.

### Task 2: Extend shared types and schemas

**Files:**
- Modify: `packages/shared/src/core/types.ts`
- Modify: `packages/shared/src/core/schemas.ts`

**Step 1: Add `deferred-close` to `SectionOutcome`**

Update the union type and any helper test types that mirror it.

**Step 2: Add section-boundary metadata types**

Introduce optional section-definition metadata with:
- `responsibilities?: readonly string[]`
- `deferredTo?: readonly string[]`

Keep the addition narrow and reusable by prompt helpers.

**Step 3: Update the Zod enum**

Extend `SectionOutcomeSchema` with `deferred-close`.

### Task 3: Implement ticket and prompt changes

**Files:**
- Modify: `packages/shared/src/core/orchestrator.ts`

**Step 1: Replace `buildChallengeTicketId()`**

Use `createHash("sha1")` and emit opaque ids in the form `t-${normalizedSection}-${hash}`.

**Step 2: Add reusable prompt helper blocks**

Add helpers for:
- formal-speech guidance
- valid section keys
- section role boundary
- reviewer verdict summary
- convergence notice

**Step 3: Inject the prompt blocks**

Update:
- `buildRealtimeCoordinatorDiscussionPrompt()`
- `buildRealtimeCoordinatorRedirectPrompt()`
- `buildRealtimeReviewerPrompt()`
- `buildRealtimeSectionDrafterPrompt()`

Make the role-boundary block conditional when there is no meaningful section metadata.

### Task 4: Implement realtime convergence behavior

**Files:**
- Modify: `packages/shared/src/core/orchestrator.ts`

**Step 1: Aggregate reviewer verdicts after each reviewer round**

Count `APPROVE`, `REVISE`, and `BLOCK` over the completed reviewers in that round.

**Step 2: Enforce majority semantics**

Rules:
- any `BLOCK` stays blocking
- `REVISE` majority keeps revising
- `APPROVE` majority passes a coordinator signal

**Step 3: Track consecutive per-section revise rounds**

Reset on section handoff/closure and increment only when the round outcome is still `REVISE`-majority without `BLOCK`.

**Step 4: Handle `deferred-close`**

When selected, mark remaining current-section `REVISE` challenges as `deferred`, rebuild ledger views, and hand off to the next section when available.

**Step 5: Escalate after the third consecutive revise round**

Inject the convergence notice into the next coordinator prompt and, when escalation is chosen, update the run to `awaiting-user-input` before prompting the user.

### Task 5: Validate

**Files:**
- No additional edits expected

**Step 1: Run shared package typecheck**

Run: `./scripts/with-node.sh ./node_modules/typescript/lib/tsc.js -p packages/shared/tsconfig.json --noEmit`

**Step 2: Run web package typecheck**

Run: `./scripts/with-node.sh ./node_modules/typescript/lib/tsc.js -p packages/web/tsconfig.json --noEmit`

**Step 3: Run orchestrator tests**

Run: `./scripts/with-npm.sh run test -- --testPathPattern=orchestrator`

**Step 4: Run repo check**

Run: `./scripts/check.sh`

**Step 5: Close out with exact validation status**

Report:
- what changed
- every command run
- whether `check` ran
- whether `apply-dev-stack` was skipped
- any remaining manual review or risk
