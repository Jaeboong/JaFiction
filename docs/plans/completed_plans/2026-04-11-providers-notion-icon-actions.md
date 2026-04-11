# Providers Notion Icon Actions Implementation Plan

**Goal:** Replace the Notion section text actions on `ProvidersPage` with compact icon-only controls that keep the existing provider button styling and loading semantics.

**Files:**
- Modify: `packages/web/src/pages/ProvidersPage.tsx`
- Modify: `packages/web/src/styles/providers.css`

### Task 1: Swap the Notion action controls to icon buttons

Render inline SVG icons for refresh, connect, and disconnect directly in `ProvidersPage`. Keep the existing action handlers and `hasPendingProviderAction` disabled behavior unchanged.

### Task 2: Match the existing tooltip and button patterns

Use the page’s existing `title` plus `aria-label` pattern instead of introducing a custom tooltip system. Add a dedicated icon-button class in `providers.css` so the controls render as 30px square buttons while preserving the existing secondary and danger color tokens.

### Task 3: Keep loading feedback on the icons

Apply the pending state to the icon button itself instead of using `ButtonBusyLabel`, and dim the SVG while the matching Notion action is in flight.

### Task 4: Validate the change

Run: `./scripts/check.sh`
