# Drafter Preamble Suppression Plan

**Goal:** Prevent drafter preamble-only chat blocks from surfacing in persisted chat history or the live completed-event stream when no `## Section Draft` body exists yet.

**Scope:**
- Update `packages/shared/src/core/orchestrator.ts` to blank completed drafter messages without a parsed section draft and suppress forwarding their completed event to the UI callback.
- Update `packages/web/src/pages/RunsPage.tsx` to skip rendering drafter chat messages whose stored content is empty.
- Add a regression test covering persisted blank drafter preamble messages and skipped forwarded completion events.

**Validation:**
- Run `./scripts/check.sh`
