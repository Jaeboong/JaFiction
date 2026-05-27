import * as assert from "node:assert/strict";
import test from "node:test";
import { mergeSyncSets } from "../core/syncMerge";
import type { SyncDocument, SyncProject, SyncSet } from "../core/syncTypes";
import type { ProjectRecord } from "../core/types";

const emptyRefs = {
  profileDocumentIds: [],
  githubRepos: [],
  notionDirective: null
};

function projectRecord(slug: string, patch: Partial<ProjectRecord> = {}): ProjectRecord {
  const createdAt = "2026-05-01T00:00:00.000Z";
  return {
    slug,
    companyName: "",
    rubric: "",
    pinnedDocumentIds: [],
    experienceRefs: emptyRefs,
    createdAt,
    updatedAt: createdAt,
    postingReviewReasons: [],
    jobPostingFieldConfidence: {},
    ...patch
  };
}

function syncProject(slug: string, updatedAt: string, patch: Partial<ProjectRecord> = {}): SyncProject {
  return {
    slug,
    updatedAt,
    record: projectRecord(slug, { updatedAt, ...patch })
  };
}

function syncDocument(patch: Partial<SyncDocument> = {}): SyncDocument {
  return {
    scope: "profile",
    contentSha256: "a".repeat(64),
    title: "First",
    sourceType: "text",
    pinnedByDefault: false,
    createdAt: "2026-05-01T00:00:00.000Z",
    contentBase64: Buffer.from("content").toString("base64"),
    ...patch
  };
}

function normalize(set: SyncSet): SyncSet {
  return mergeSyncSets({ documents: [], projects: [] }, set);
}

test("mergeSyncSets is order independent and sorts outputs deterministically", () => {
  const a: SyncSet = {
    documents: [
      syncDocument({ contentSha256: "b".repeat(64), title: "B" })
    ],
    projects: [
      syncProject("zeta", "2026-05-01T00:00:00.000Z", { companyName: "Zeta" })
    ]
  };
  const b: SyncSet = {
    documents: [
      syncDocument({ contentSha256: "a".repeat(64), title: "A" })
    ],
    projects: [
      syncProject("alpha", "2026-05-01T00:00:00.000Z", { companyName: "Alpha" })
    ]
  };

  assert.deepStrictEqual(mergeSyncSets(a, b), mergeSyncSets(b, a));
  assert.deepStrictEqual(
    mergeSyncSets(a, b).documents.map((document) => document.contentSha256),
    ["a".repeat(64), "b".repeat(64)]
  );
  assert.deepStrictEqual(
    mergeSyncSets(a, b).projects.map((project) => project.slug),
    ["alpha", "zeta"]
  );
});

test("mergeSyncSets deduplicates documents by scope, project slug, and sha256", () => {
  const older = syncDocument({
    contentSha256: "c".repeat(64),
    title: "Old title",
    pinnedByDefault: false,
    createdAt: "2026-05-01T00:00:00.000Z"
  });
  const newer = syncDocument({
    contentSha256: "c".repeat(64),
    title: "New title",
    sourceType: "upload",
    note: "new note",
    pinnedByDefault: true,
    createdAt: "2026-05-02T00:00:00.000Z"
  });

  const merged = mergeSyncSets(
    { documents: [older], projects: [] },
    { documents: [newer], projects: [] }
  );

  assert.equal(merged.documents.length, 1);
  assert.deepStrictEqual(merged.documents[0], {
    ...newer,
    pinnedByDefault: true
  });
});

test("mergeSyncSets uses pinned OR and latest createdAt metadata for document collisions", () => {
  const pinnedOlder = syncDocument({
    title: "Pinned old title",
    pinnedByDefault: true,
    createdAt: "2026-05-01T00:00:00.000Z"
  });
  const unpinnedNewer = syncDocument({
    title: "Unpinned new title",
    sourceType: "generated",
    note: "new note",
    pinnedByDefault: false,
    createdAt: "2026-05-03T00:00:00.000Z"
  });

  const merged = mergeSyncSets(
    { documents: [pinnedOlder], projects: [] },
    { documents: [unpinnedNewer], projects: [] }
  );

  assert.equal(merged.documents[0]?.pinnedByDefault, true);
  assert.equal(merged.documents[0]?.title, "Unpinned new title");
  assert.equal(merged.documents[0]?.sourceType, "generated");
  assert.equal(merged.documents[0]?.note, "new note");
});

test("mergeSyncSets fills empty project fields from the other side", () => {
  const sparse = syncProject("alpha", "2026-05-01T00:00:00.000Z", {
    companyName: "",
    roleName: "",
    keywords: [],
    essayQuestions: []
  });
  const filled = syncProject("alpha", "2026-05-02T00:00:00.000Z", {
    companyName: "Filled Company",
    roleName: "Backend",
    keywords: ["sync"],
    essayQuestions: ["Question"]
  });

  const merged = mergeSyncSets(
    { documents: [], projects: [sparse] },
    { documents: [], projects: [filled] }
  );

  assert.equal(merged.projects[0]?.record.companyName, "Filled Company");
  assert.equal(merged.projects[0]?.record.roleName, "Backend");
  assert.deepStrictEqual(merged.projects[0]?.record.keywords, ["sync"]);
  assert.deepStrictEqual(merged.projects[0]?.record.essayQuestions, ["Question"]);
});

test("mergeSyncSets takes latest updatedAt project values when both sides are filled", () => {
  const older = syncProject("alpha", "2026-05-01T00:00:00.000Z", {
    companyName: "Older Company",
    roleName: "Older Role",
    keywords: ["old"]
  });
  const newer = syncProject("alpha", "2026-05-03T00:00:00.000Z", {
    companyName: "Newer Company",
    roleName: "Newer Role",
    keywords: ["new"]
  });

  const merged = mergeSyncSets(
    { documents: [], projects: [older] },
    { documents: [], projects: [newer] }
  );

  assert.equal(merged.projects[0]?.updatedAt, "2026-05-03T00:00:00.000Z");
  assert.equal(merged.projects[0]?.record.companyName, "Newer Company");
  assert.equal(merged.projects[0]?.record.roleName, "Newer Role");
  assert.deepStrictEqual(merged.projects[0]?.record.keywords, ["new"]);
});

test("mergeSyncSets is idempotent against normalized input", () => {
  const set: SyncSet = {
    documents: [
      syncDocument({ contentSha256: "d".repeat(64), title: "D" }),
      syncDocument({ contentSha256: "c".repeat(64), title: "C" })
    ],
    projects: [
      syncProject("beta", "2026-05-01T00:00:00.000Z"),
      syncProject("alpha", "2026-05-01T00:00:00.000Z")
    ]
  };

  assert.deepStrictEqual(mergeSyncSets(set, set), normalize(set));
});
