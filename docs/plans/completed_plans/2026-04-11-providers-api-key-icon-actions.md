# Providers API Key Icon Actions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the ProvidersPage API key `show` and `clear` text buttons with accessible icon buttons while preserving current behavior.

**Architecture:** Update the existing API key action controls in `ProvidersPage.tsx` to reuse the page's established icon-button pattern. Keep behavior local to the page, add inline SVG icons without introducing dependencies, and preserve current save/clear flow and button state semantics.

**Tech Stack:** React, TypeScript, CSS

---

### Task 1: Swap API key action labels for icon buttons

**Files:**
- Modify: `packages/web/src/pages/ProvidersPage.tsx`
- Modify: `packages/web/src/styles/providers.css`

**Step 1: Inspect the existing ProvidersPage action row**

Run: `sed -n '240,360p' packages/web/src/pages/ProvidersPage.tsx`
Expected: existing API key action row shows `Show` and `Clear` text buttons.

**Step 2: Replace the buttons with icon-button variants**

Update the API key action row to:
- use `providers-icon-button`
- keep `type="button"`
- use dynamic Eye/EyeOff inline SVG for visibility toggle
- use an X icon for clear
- add `title` and `aria-label` strings in Korean

**Step 3: Keep the clear action on the danger button style**

Ensure the clear button keeps `providers-danger-button` so the existing danger color system is preserved.

**Step 4: Verify icon sizing and alignment**

Run: `sed -n '340,420p' packages/web/src/styles/providers.css`
Expected: API key action row aligns 30px icon buttons cleanly next to the field.

**Step 5: Run repository validation**

Run: `./scripts/check.sh`
Expected: validation completes successfully.
