# Project Merge And XSS Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent project metadata loss during project saves and insight reruns, and sanitize rendered run markdown before injecting it into the browser DOM.

**Architecture:** Fix the destructive update behavior at the storage layer so partial project updates preserve existing metadata regardless of caller. Keep the web save flow defensive by sending a merged project payload for its current PUT path, and isolate markdown-to-safe-HTML rendering behind a small utility that can be validated independently of the full page component.

**Tech Stack:** TypeScript, Node `node:test`, React, Vite, `marked`

---

### Task 1: Lock Down Project Merge Semantics In Storage

**Files:**
- Modify: `packages/shared/src/core/storage.ts`
- Test: `packages/shared/src/test/storage.test.ts`

**Step 1: Write the failing tests**

Add storage regressions that prove:
- `updateProjectInfo()` preserves existing optional metadata when the input omits those fields.
- `updateProjectInfo()` still clears a field when the caller explicitly passes an empty string or empty array.

**Step 2: Run the targeted shared tests to verify failure**

Run: `./scripts/with-node.sh ./node_modules/typescript/lib/tsc.js -p packages/shared/tsconfig.json && ./scripts/with-node.sh --test packages/shared/dist/test/storage.test.js`

Expected: the new merge-preservation test fails before the implementation change.

**Step 3: Write the minimal implementation**

Update `packages/shared/src/core/storage.ts` so `updateProjectInfo()`:
- starts from the stored project values for optional fields,
- only overwrites a field when the corresponding key is actually present in the input object,
- still treats explicit empty string / empty array inputs as intentional clears after sanitization,
- preserves existing OpenDART metadata unless the corp-code input was explicitly changed.

**Step 4: Run the targeted shared tests again**

Run: `./scripts/with-node.sh ./node_modules/typescript/lib/tsc.js -p packages/shared/tsconfig.json && ./scripts/with-node.sh --test packages/shared/dist/test/storage.test.js`

Expected: the storage tests pass.

### Task 2: Harden The Web Project Save Payload

**Files:**
- Modify: `packages/web/src/pages/ProjectsPage.tsx`

**Step 1: Update the project save payload**

Change the `onUpdateProject()` call in `handleSaveInfo()` so the outgoing PUT body starts from `project.record` and only overrides the editable fields from the modal.

**Step 2: Verify the typecheck still passes**

Run: `./scripts/with-node.sh ./node_modules/typescript/lib/tsc.js -p packages/web/tsconfig.json --noEmit`

Expected: PASS.

### Task 3: Sanitize Rendered Run Markdown

**Files:**
- Create: `packages/web/src/markdown.ts`
- Modify: `packages/web/src/pages/RunsPage.tsx`
- Modify: `packages/web/package.json`
- Modify: `package-lock.json`
- Test: `packages/shared/src/test/storage.test.ts` only if no lightweight web test harness can be added without unrelated setup changes; otherwise add a focused web-side test file.

**Step 1: Add a testable safe-render helper**

Extract markdown rendering into a small helper that:
- calls `marked.parse()` with the existing options,
- sanitizes the resulting HTML before returning it.

**Step 2: Add the sanitizer dependency**

Add `dompurify` (and `@types/dompurify` only if required by the installed type surface) to the web package dependency metadata.

**Step 3: Wire the helper into `RunsPage.tsx`**

Replace the direct `marked.parse()` + `dangerouslySetInnerHTML` path with the sanitized helper output.

**Step 4: Run the web typecheck**

Run: `./scripts/with-node.sh ./node_modules/typescript/lib/tsc.js -p packages/web/tsconfig.json --noEmit`

Expected: PASS.

### Task 4: Full Validation

**Files:**
- No code changes expected

**Step 1: Run the required TypeScript checks**

Run:
- `./scripts/with-node.sh ./node_modules/typescript/lib/tsc.js -p packages/web/tsconfig.json --noEmit`
- `./scripts/with-node.sh ./node_modules/typescript/lib/tsc.js -p packages/shared/tsconfig.json --noEmit`

Expected: PASS.

**Step 2: Run the repository check**

Run: `./scripts/check.sh`

Expected: PASS.

**Step 3: Close out**

Report:
- what changed,
- which commands were run,
- that `check` was run,
- that `apply-dev-stack` was not needed unless runtime boot flow changed,
- any remaining manual review risk around markdown sanitization policy.
