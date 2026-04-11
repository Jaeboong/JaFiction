# Overview And Providers Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the Overview and Providers pages so they match the design HTML and approved rounded mockups as literally as possible without changing product behavior.

**Architecture:** Treat the design HTML as the source of truth for typography, spacing, panel structure, and visual hierarchy. Keep data flow and API contracts unchanged, but allow DOM reshaping where needed so the live React screens can mirror the mock layout instead of merely borrowing its color palette.

**Tech Stack:** React, TypeScript, Vite, plain CSS

---

### Task 1: Shared CSS foundation and imports

**Files:**
- Modify: `packages/web/src/main.tsx`
- Modify: `packages/web/src/styles.css`
- Create: `packages/web/src/styles/base.css`
- Create: `packages/web/src/styles/shell.css`
- Create: `packages/web/src/styles/primitives.css`

**Steps:**
1. Add a `packages/web/src/styles/` directory for split stylesheet files.
2. Move global reset, root tokens, shared shell layout, shared button/input/card primitives, and footer/header scaffolding out of `styles.css` into the new files.
3. Update `main.tsx` to import the new shared CSS files before the remaining stylesheet.
4. Trim `styles.css` so it no longer owns the moved global concerns.
5. Smoke-check that unchanged pages still render with the shared foundation in place.

### Task 2: Overview redesign

**Files:**
- Modify: `packages/web/src/pages/OverviewPage.tsx`
- Modify: `packages/web/src/components/AgentEffortSection.tsx`
- Create: `packages/web/src/styles/overview.css`

**Steps:**
1. Import `overview.css` from `OverviewPage.tsx`.
2. Restyle the Overview page around rounded surfaces, stronger header hierarchy, and cleaner stat / rubric / storage panels aligned with the new HTML reference.
3. Update `AgentEffortSection` only as needed to fit the new Overview visual language.
4. Keep all copy, controls, and save behavior unchanged.

### Task 3: Providers redesign

**Files:**
- Modify: `packages/web/src/pages/ProvidersPage.tsx`
- Modify: `packages/web/src/components/AgentDefaultsSummary.tsx`
- Create: `packages/web/src/styles/providers.css`

**Steps:**
1. Import `providers.css` from `ProvidersPage.tsx`.
2. Restyle the Providers sidebar, status cards, form surfaces, Notion panel, and action layout to match the rounded workspace direction.
3. Update `AgentDefaultsSummary` only as needed to fit the new Providers visual language.
4. Keep all provider actions and form behavior unchanged.

### Task 4: Integration and validation

**Files:**
- Review: `packages/web/src/App.tsx`
- Review: `packages/web/src/pages/OverviewPage.tsx`
- Review: `packages/web/src/pages/ProvidersPage.tsx`
- Review: `packages/web/src/components/AgentDefaultsSummary.tsx`
- Review: `packages/web/src/components/AgentEffortSection.tsx`
- Review: `packages/web/src/styles.css`
- Review: `packages/web/src/styles/*.css`

**Steps:**
1. Verify that shared and page-scoped CSS ownership stayed separated.
2. Resolve any naming or cascade collisions found during integration.
3. Run `./scripts/check.sh`.
4. If shared shell changes visibly affect runtime boot behavior, decide whether `./scripts/apply-dev-stack.sh` is also required.
5. Summarize what changed, what was validated, and any remaining manual review points.
