# App Notice Exit Animation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add enter/exit notice animations in the web app without changing unrelated app behavior, and delay notice removal until the exit animation completes.

**Architecture:** Keep the single-notice model in `packages/web/src/App.tsx`, but extend the notice view state with a leaving flag and centralize all removal paths through one delayed-dismiss helper. Update `packages/web/src/styles.css` so `.app-notice` matches the existing card radius and plays explicit in/out keyframe animations.

**Tech Stack:** TypeScript, React 19, CSS, repo validation via `./scripts/check.sh`

---

### Task 1: Add delayed notice dismissal state

**Files:**
- Modify: `packages/web/src/App.tsx`

**Steps:**
1. Extend the local notice state so the rendered notice can track whether it is leaving.
2. Replace direct `setActionNotice(undefined)` removal with a single helper that marks the current notice as leaving.
3. Keep auto-dismiss timing and notice replacement behavior consistent by clearing prior timers before scheduling a new one.
4. Remove the notice from state after the 200ms exit-animation window.

### Task 2: Add notice motion styles

**Files:**
- Modify: `packages/web/src/styles.css`

**Steps:**
1. Reuse the existing 4px card radius for `.app-notice`.
2. Add `app-notice-in` and `app-notice-out` keyframes with the requested timing and transforms.
3. Apply the enter animation by default and the exit animation on `.app-notice.is-leaving`.

### Task 3: Validate the change

**Files:**
- Modify only if validation exposes a type or build issue.

**Steps:**
1. Run `./scripts/check.sh`.
2. If the repo check fails, fix only issues caused by this change.
