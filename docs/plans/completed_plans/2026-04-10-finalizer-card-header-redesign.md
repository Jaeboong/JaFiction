# Finalizer Card Header Redesign Plan

## Goal

Move the finalizer insert action into a conditional header row that also shows the selected run question, while keeping draft insertion limited to the finalizer body content.

## Steps

1. Thread `runQuestion` from `RunControlPanel` through `RunFeed` and `RunFeedMessage` into `FinalDraftCard`.
2. Replace the footer action area in `FinalDraftCard` with a conditional header row that renders the question on the left and the insert icon button on the right.
3. Update `runs.css` so the new header visually matches nearby status rows and remove the obsolete footer action styles.
4. Validate with `./scripts/check.sh`; note that the repo does not currently expose a dedicated web component test harness for this screen.
