# Reviewer Card Tolerant Parser Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move reviewer-card parsing into `packages/shared` so the web UI reuses the tolerant realtime reviewer parsing rules and no longer drops valid Claude plain-text `Challenge` sections.

**Architecture:** Add a shared parser that reuses the existing realtime reviewer section scanner and challenge normalization helpers, then export it through `packages/shared/src/index.ts`. Update the web `ReviewerCard` component to consume the shared parser and keep only rendering/status-tone logic locally.

**Tech Stack:** TypeScript, Node test runner, React, shared workspace exports

---

### Task 1: Lock the regression with shared parser tests

**Files:**
- Modify: `packages/shared/src/test/orchestrator.test.ts`

**Steps:**
1. Add failing tests for reviewer-card parsing that cover plain-text preamble, inline `because` reason handling, missing challenge body, and bare ticket IDs.
2. Run the focused shared test command to confirm the new assertions fail before implementation.

### Task 2: Implement the shared reviewer-card parser

**Files:**
- Modify: `packages/shared/src/core/orchestrator/parsing/responseParsers.ts`
- Modify: `packages/shared/src/index.ts`

**Steps:**
1. Add a parser that returns `{ miniDraft, challenges, crossFeedback, status }`.
2. Reuse the tolerant section scanning and challenge normalization helpers already used by realtime reviewer parsing.
3. Export the new parser through the shared package root.

### Task 3: Switch the web card to the shared parser and verify

**Files:**
- Modify: `packages/web/src/components/ReviewerCard.tsx`

**Steps:**
1. Replace the local parser implementation with the shared parser import.
2. Keep the component responsible only for display concerns.
3. Run focused shared tests, then `./scripts/check.sh`.
