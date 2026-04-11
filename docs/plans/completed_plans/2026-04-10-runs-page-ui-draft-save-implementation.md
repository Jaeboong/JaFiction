# Runs Page UI Draft Save Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move run lifecycle controls into the conversation header, add per-question draft selection and saving, and expose a runner endpoint for explicit draft persistence.

**Architecture:** Keep `RunsPage` as the state boundary for selected project, selected run, and live session state. Let `RunComposerPanel` own editable composer state with a local per-question draft cache, while `RunControlPanel` becomes responsible for rendering the header action affordance using props derived by the page. Persist saved drafts through a small `projectsRouter` endpoint that reuses `saveCompletedEssayAnswer`, then thread the matching client and `App` callback into the page.

**Tech Stack:** React, TypeScript, Express, shared JaFiction view models, plain CSS in `packages/web/src/styles/runs.css`

---

### Task 1: Add runner coverage for explicit essay draft saves

**Files:**
- Modify: `packages/runner/src/test/runsRouter.test.ts`
- Review: `packages/shared/src/core/storage.ts`

**Steps:**
1. Extend the runner harness test file with a case that saves a draft through the projects API and expects refreshed project state plus a pushed snapshot.
2. Assert that the saved answer is stored against the requested question index and that the document content matches the supplied draft.

### Task 2: Implement the draft-save API and client plumbing

**Files:**
- Modify: `packages/runner/src/routes/projectsRouter.ts`
- Modify: `packages/web/src/api/client.ts`
- Modify: `packages/web/src/App.tsx`

**Steps:**
1. Add `PUT /:projectSlug/essay-draft/:questionIndex` to `projectsRouter`, validate the body and question index, save the draft, refresh project state, and push the new snapshot.
2. Add `saveEssayDraft(projectSlug, questionIndex, draft)` to `RunnerClient`.
3. Pass a new `onSaveDraft` callback from `App` into `RunsPage` using the existing `runAction` notice flow.

### Task 3: Refactor composer state for question selection and cached drafts

**Files:**
- Modify: `packages/web/src/pages/RunsPage.tsx`
- Modify: `packages/web/src/styles/runs.css`

**Steps:**
1. Add question-selection state and a `Record<number, string>` draft cache to `RunComposerPanel`.
2. Reset the cache when the selected project changes.
3. Initialize question selection from the selected run, fallback question, or first essay question.
4. Persist the outgoing question draft into the cache before switching questions, then load the next question from cache or saved answer state.
5. Replace the editable question textarea with a read-only display block and add the new question dropdown plus draft save button.

### Task 4: Move lifecycle actions into the conversation header

**Files:**
- Modify: `packages/web/src/pages/RunsPage.tsx`
- Modify: `packages/web/src/styles/runs.css`

**Steps:**
1. Derive the existing start/abort/complete gating booleans in `RunsPage`.
2. Remove the footer action buttons from `RunComposerPanel`.
3. Extend `RunControlPanel` props so it can render the guide text and the correct header-side action button.
4. Keep the existing start, abort, and complete callbacks intact while preserving current confirmation and idle-wait behavior.

### Task 5: Validate the refactor

**Files:**
- Review: `packages/web/src/pages/RunsPage.tsx`
- Review: `packages/runner/src/routes/projectsRouter.ts`
- Review: `packages/web/src/App.tsx`
- Review: `packages/web/src/api/client.ts`

**Steps:**
1. Run targeted runner tests for the new route coverage.
2. Run `./scripts/check.sh`.
3. Fix any TypeScript, test, or lint issues until the check passes.
