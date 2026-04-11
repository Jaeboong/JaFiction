# Runs Page UI Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move run lifecycle controls into the conversation header, add question selection and draft save flows to the composer, and expose a runner endpoint for essay draft persistence.

**Architecture:** Keep the existing `RunsPage` composition, but move run action gating to the page level so `RunControlPanel` can render the correct header action for the selected project and live run state. Reuse the existing essay answer persistence path by adding a lightweight draft-save route in `projectsRouter`, then thread a matching client method and `App` callback into `RunsPage`.

**Tech Stack:** React, TypeScript, Express, existing JaFiction runner/client/view-model contracts, CSS in `packages/web/src/styles/runs.css`

---

### Task 1: Re-map current run control state at the page boundary

**Files:**
- Modify: `packages/web/src/pages/RunsPage.tsx`

**Step 1:**
Identify the existing `RunComposerPanel` start/abort/complete conditions and extract the shared booleans needed by both panels.

**Step 2:**
Lift the run-start orchestration into `RunsPage` so the composer no longer owns the footer action buttons.

**Step 3:**
Pass the derived control props into `RunControlPanel`, including new-run mode, project/live-run state, and the start/abort/complete handlers.

**Step 4:**
Keep the existing run-state safeguards intact, including active-run replacement confirmation and idle-session waiting.

### Task 2: Redesign the composer question and draft inputs

**Files:**
- Modify: `packages/web/src/pages/RunsPage.tsx`
- Modify: `packages/web/src/styles/runs.css`

**Step 1:**
Add `selectedQuestionIndex` state to `RunComposerPanel` and initialize it from the selected run, fallback question, or the first available essay question.

**Step 2:**
Replace the editable question textarea with a read-only question display and insert the new question dropdown under the project selector.

**Step 3:**
Load the draft field from `essayAnswerStates[selectedQuestionIndex]` when the question selection changes, while preserving selected-run behavior.

**Step 4:**
Add the draft save button, local saving state, and disabled rules that prevent empty or invalid saves.

### Task 3: Add the header-side run action affordance

**Files:**
- Modify: `packages/web/src/pages/RunsPage.tsx`
- Modify: `packages/web/src/styles/runs.css`

**Step 1:**
Extend `RunControlPanel` props to receive all control data required for the header action button and guide text.

**Step 2:**
Render `.runs-header-right` in the conversation card header, including the guidance text when no run is selected and there is no live run for the selected project.

**Step 3:**
Render the correct play/stop/check action button using the same conditions that previously lived at the bottom of the composer.

### Task 4: Add essay draft persistence in the runner and client

**Files:**
- Modify: `packages/runner/src/routes/projectsRouter.ts`
- Modify: `packages/web/src/api/client.ts`
- Modify: `packages/web/src/App.tsx`

**Step 1:**
Add `PUT /api/projects/:projectSlug/essay-draft/:questionIndex` in `projectsRouter`, validating the project, question index, and request body before calling `saveCompletedEssayAnswer`.

**Step 2:**
Refresh project state and push the updated snapshot after saving so the web view receives the updated draft content.

**Step 3:**
Add `saveEssayDraft` to `RunnerClient`.

**Step 4:**
Wire a new `onSaveDraft` callback through `App` into `RunsPage`, using the existing `runAction` toast pattern.

### Task 5: Validate and clean up

**Files:**
- Modify: `packages/web/src/pages/RunsPage.tsx`
- Modify: `packages/web/src/styles/runs.css`
- Modify: `packages/runner/src/routes/projectsRouter.ts`
- Modify: `packages/web/src/api/client.ts`
- Modify: `packages/web/src/App.tsx`

**Step 1:**
Run `./scripts/check.sh`.

**Step 2:**
Fix any TypeScript, lint, or test issues surfaced by the check script.

**Step 3:**
Verify the new Runs page flow still supports:
- selecting a question
- loading/saving a draft
- starting a run
- aborting a live run
- completing a paused live run
