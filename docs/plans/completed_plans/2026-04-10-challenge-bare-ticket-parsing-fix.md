# Challenge Bare Ticket Parsing Fix

**Goal:** Accept reviewer `Challenge:` headers that omit square brackets around an existing ticket ID, while keeping the bracketed form canonical in prompts and preserving downstream reviewer-summary behavior.

**Files:**
- Modify: `packages/shared/src/core/orchestrator/parsing/responseParsers.ts`
- Modify: `packages/shared/src/core/orchestrator/prompts/realtimePrompts.ts`
- Modify: `packages/shared/src/test/orchestrator.test.ts`

**Plan:**
1. Add orchestrator-facing tests for bare ticket IDs so the regression is reproducible before implementation.
2. Replace duplicated `Challenge` header parsing with one shared helper that accepts both `[ticketId] action` and `ticketId action`, and recover the ticket prefix when the trailing token is a known section-outcome token.
3. Tighten the realtime reviewer prompt so the canonical output explicitly says ticket IDs must stay bracketed and are not placeholders.
4. Run the requested shared-package compile, orchestrator tests, and full `check`.
