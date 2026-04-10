# Reviewer Card Implementation Plan

**Goal:** Render completed reviewer-role messages on the Runs page as structured cards while preserving the existing raw message body for streaming output and parse failures.

## Tasks

1. Add `packages/web/src/components/ReviewerCard.tsx` with a line-based parser for `Mini Draft`, `Challenge`, `Cross-feedback`, and `Status`.
2. Gate `RunFeedMessage` in `packages/web/src/pages/RunsPage.tsx` so only completed `evidence_reviewer`, `fit_reviewer`, and `tone_reviewer` messages switch to the reviewer card.
3. Extend `packages/web/src/styles/runs.css` with reviewer-card styling that matches the coordinator card family, and update `docs/development/NAVIGATION.md` for the new component.
4. Validate with `./scripts/with-npm.sh run build:web` and `./scripts/docs-check.sh`.

## Validation Notes

- Do not run `./scripts/check.sh`.
- Do not run `./scripts/apply-dev-stack.sh`.
