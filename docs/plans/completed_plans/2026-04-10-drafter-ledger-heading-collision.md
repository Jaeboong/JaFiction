# Drafter Ledger Heading Collision Implementation Plan

**Goal:** Eliminate the drafter prompt's heading namespace collision so prior ledger content does not anchor or bleed into the drafter's required `## Section Draft` output.

**Scope:**
- Add a drafter-only ledger block builder in `packages/shared/src/core/orchestrator/prompts/promptBlocks.ts`.
- Switch `buildRealtimeSectionDrafterPrompt` in `packages/shared/src/core/orchestrator/prompts/realtimePrompts.ts` to the new block.
- Add a regression test in `packages/shared/src/test/orchestrator.test.ts`.
- Validate with `./scripts/check.sh`.

**Steps:**
1. Add `buildDrafterLedgerBlock` with `<coordinator-context>` wrapping and renamed headings.
2. Update the realtime drafter prompt import and ledger block usage.
3. Add a prompt-level regression test that checks the new headings and rejects the old `Section Draft:` inline field.
4. Run `./scripts/check.sh`.
