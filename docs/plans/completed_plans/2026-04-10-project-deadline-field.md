# Project Deadline Field Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a project deadline field to the application/project basic info flow and have job-posting analysis extract and normalize that deadline into project metadata.

**Architecture:** Extend the shared project and job-posting extraction types with a `deadline` string field, normalize extracted deadline text into the agreed display/storage format, and thread that field through storage, runner routes, and the web project screens. Keep the representation as a normalized string rather than introducing a richer date model so the change stays consistent with the current schema and persistence design.

**Tech Stack:** TypeScript, React, Zod, Express routes, shared storage layer

---

### Task 1: Add deadline to shared project and extraction models

**Files:**
- Modify: `packages/shared/src/core/jobPosting.ts`
- Modify: `packages/shared/src/core/types.ts`
- Modify: `packages/shared/src/core/schemas.ts`

**Step 1: Extend extraction and project types**

Add `deadline?: string` to the job-posting extraction result, project input type, and project record type.

**Step 2: Add deadline normalization/extraction support**

Implement deadline extraction in the job-posting parser for posting sections such as 모집 기간, 마감, and 접수 기간, and normalize the result to the agreed string format.

**Step 3: Add schema support**

Update the shared schemas so persisted project records can store and load `deadline`.

### Task 2: Persist and expose deadline through runner and storage

**Files:**
- Modify: `packages/shared/src/core/storage.ts`
- Modify: `packages/runner/src/routes/projectsRouter.ts`
- Modify: `packages/runner/src/routes/insightsRouter.ts`

**Step 1: Persist deadline on create/update**

Thread `deadline` through project creation and partial updates, preserving existing values when omitted and clearing them when explicitly emptied.

**Step 2: Include deadline when analysis updates project metadata**

Ensure project analysis/update flows copy extracted `deadline` into stored project metadata.

### Task 3: Surface deadline in project creation and info editing UI

**Files:**
- Modify: `packages/web/src/pages/ProjectsPage.tsx`

**Step 1: Add deadline to create-project state and payload**

Show the extracted deadline in the create flow, allow manual edits, and include it in the create payload.

**Step 2: Add deadline to project basic info view/edit**

Display deadline in read mode and editable mode for existing projects, and include it in the update payload.

### Task 4: Add regression coverage and validate

**Files:**
- Modify: `packages/shared/src/test/jobPosting.test.ts`
- Modify: `packages/shared/src/test/storage.test.ts`

**Step 1: Add extraction coverage**

Add tests for deadline extraction and normalization, including missing year and missing time cases.

**Step 2: Add storage/update coverage**

Add tests covering create/update persistence and partial-update preservation/clearing for `deadline`.

**Step 3: Run targeted validation**

Run targeted shared/runner/web validation so the new field compiles and the updated tests pass.

