# Reviewer Output Format Update

**Goal:** Reformat realtime reviewer output so verdict tokens stay on header lines only, while user-visible explanations render as natural Korean body text on following lines.

## Tasks

1. Update `packages/shared/src/core/orchestrator.ts` so `buildRealtimeReviewerPrompt()` instructs the exact new multiline reviewer format in Korean.
2. Update the reviewer-response consumers in `packages/shared/src/core/orchestrator.ts` that summarize challenge and cross-feedback sections so the new multiline format is parsed correctly.
3. Update `packages/web/src/components/ReviewerCard.tsx` so the card parser reads header lines, extracts verdicts from headers, and treats following lines as body text until the next header.
4. Adjust targeted orchestrator tests for the new prompt/output format.
5. Validate with `./scripts/check.sh`.

## Notes

- `ReviewerCard` only needs to support the new format.
- Internal orchestrator parsing may remain tolerant if that reduces regression risk, but new prompt generation must emit the new format.
