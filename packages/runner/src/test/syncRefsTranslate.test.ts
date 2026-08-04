import * as assert from "node:assert/strict";
import test from "node:test";

import type { ProjectRecord } from "@jasojeon/shared";
import { projectRefsToLocalIds, projectRefsToSha256 } from "../routes/syncHandlers";

function makeProject(profileDocumentIds: readonly string[]): ProjectRecord {
  return {
    slug: "acme",
    companyName: "Acme",
    rubric: "",
    pinnedDocumentIds: [],
    experienceRefs: {
      profileDocumentIds: [...profileDocumentIds],
      githubRepos: ["owner/repo"],
      notionDirective: "use notion"
    },
    createdAt: "2026-05-27T00:00:00.000Z",
    updatedAt: "2026-05-27T00:00:00.000Z",
    postingReviewReasons: [],
    jobPostingFieldConfidence: {}
  };
}

test("sync refs translation round-trips profile document ids through sha256 values", () => {
  const localProject = makeProject(["doc-a", "doc-b"]);
  const idToSha = new Map([
    ["doc-a", "sha-a"],
    ["doc-b", "sha-b"]
  ]);
  const shaToId = new Map([
    ["sha-a", "doc-a-local"],
    ["sha-b", "doc-b-local"]
  ]);

  const wireProject = projectRefsToSha256(localProject, idToSha);
  assert.deepEqual(wireProject.experienceRefs.profileDocumentIds, ["sha-a", "sha-b"]);
  assert.deepEqual(wireProject.experienceRefs.githubRepos, ["owner/repo"]);
  assert.equal(wireProject.experienceRefs.notionDirective, "use notion");

  const appliedProject = projectRefsToLocalIds(wireProject, shaToId);
  assert.deepEqual(appliedProject.experienceRefs.profileDocumentIds, ["doc-a-local", "doc-b-local"]);
  assert.deepEqual(localProject.experienceRefs.profileDocumentIds, ["doc-a", "doc-b"]);
});

test("sync refs translation drops missing profile document mappings", () => {
  const localProject = makeProject(["doc-a", "missing-doc", "doc-b"]);
  const idToSha = new Map([
    ["doc-a", "sha-a"],
    ["doc-b", "sha-b"]
  ]);
  const shaToId = new Map([
    ["sha-a", "doc-a-local"]
  ]);

  const wireProject = projectRefsToSha256(localProject, idToSha);
  assert.deepEqual(wireProject.experienceRefs.profileDocumentIds, ["sha-a", "sha-b"]);

  const appliedProject = projectRefsToLocalIds(wireProject, shaToId);
  assert.deepEqual(appliedProject.experienceRefs.profileDocumentIds, ["doc-a-local"]);
});
