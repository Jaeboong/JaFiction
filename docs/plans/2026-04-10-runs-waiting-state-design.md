# Runs Waiting-State Visual Design

**Goal:** Align the Runs page status colors with the intended scheme for `awaiting-user-input` and move the history status dot to the top-right corner above the delete control.

**Scope:** `packages/web/src/formatters.ts`, `packages/web/src/pages/RunsPage.tsx`, `packages/web/src/styles/runs.css`

## Design

1. Add a dedicated `waiting` visual state in `RunsPage.tsx`.
2. Map `awaiting-user-input` records and live events to `waiting` so they render with an explicit blue treatment instead of falling through to generic states.
3. Keep existing yellow `cli-running`, red `failed`, and gray terminal states unchanged.
4. Reposition the history dot with absolute positioning on the card container and move the delete button into the same right-side stack underneath it.

## Validation

- Run `./scripts/check.sh`
- Manually confirm recent-run cards show:
  - yellow for active running
  - blue for awaiting user input
  - red for failed
  - gray for terminal finished states
