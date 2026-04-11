# App Tab Indicator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the header tab underline pseudo-element with a sliding indicator that animates between active tabs.

**Architecture:** Keep the existing header tab buttons, but move the underline into a dedicated absolute-positioned indicator inside `.app-tabs`. Measure the active button relative to the tab container in React, store `left` and `width` in state, and drive the animation through CSS transitions on `transform` and `width`.

**Tech Stack:** React, TypeScript, CSS

---

### Task 1: Add measured sliding tab indicator

**Files:**
- Modify: `packages/web/src/App.tsx`
- Modify: `packages/web/src/styles.css`

**Step 1: Inspect the current tab markup**

Run: `sed -n '240,340p' packages/web/src/App.tsx`
Expected: duplicated header tab navs render `.app-tab` buttons directly inside `.app-tabs`.

**Step 2: Add tab refs and indicator state**

Update `App.tsx` to:
- track the tab container and active tab button with refs
- measure the active tab in `useLayoutEffect`
- reset the indicator width to `0` when no header tab is active
- render a dedicated `.app-tab-indicator` element inside `.app-tabs`

**Step 3: Replace the pseudo-element underline**

Update `packages/web/src/styles.css` to:
- make `.app-tabs` `position: relative`
- remove `.app-tab.is-active::after`
- add `.app-tab-indicator` with absolute positioning and animated `transform` + `width`

**Step 4: Run repository validation**

Run: `./scripts/check.sh`
Expected: repository checks pass.
