# Finalizer Insert-to-Draft Plan

## Goal

Add an insert-to-draft action to the finalizer card so a completed final draft can replace the composer draft textarea content from the run feed without lifting `draft` state into `RunsPage`.

## Steps

1. Register a draft insertion handler from `RunComposerPanel` up to `RunsPage` and forward an `onInsertFinalDraft` callback down through `RunControlPanel`, `RunFeed`, and `RunFeedMessage`.
2. Update `FinalDraftCard` to render a bottom-right icon button only after streaming completes and visible content exists, then invoke the forwarded handler with the finalizer body.
3. Add button and tooltip styles in `runs.css`, keeping the current finalizer-card visual language intact.
4. Validate with `./scripts/check.sh`.
