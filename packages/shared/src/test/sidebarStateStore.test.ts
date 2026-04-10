import * as assert from "node:assert/strict";
import test from "node:test";
import { SidebarStateStore } from "../controller/sidebarStateStore";
import { ProjectRecord } from "../core/types";

function createProject(slug: string, companyName: string): ProjectRecord {
  return {
    slug,
    companyName,
    rubric: "- fit",
    pinnedDocumentIds: [],
    createdAt: "2026-03-31T00:00:00.000Z",
    updatedAt: "2026-03-31T00:00:00.000Z"
  };
}

test("sidebar state store refreshes only the targeted project slice", async () => {
  const projectRecords = [createProject("alpha", "Alpha"), createProject("beta", "Beta")];
  const counters = {
    listProjects: 0,
    profileDocuments: 0,
    preferences: 0,
    providers: 0,
    documents: { alpha: 0, beta: 0 },
    runs: { alpha: 0, beta: 0 }
  };

  const storage = {
    storageRoot: "/workspace/.forjob",
    ensureInitialized: async () => undefined,
    listProfileDocuments: async () => {
      counters.profileDocuments += 1;
      return [];
    },
    listProjects: async () => {
      counters.listProjects += 1;
      return projectRecords;
    },
    getPreferences: async () => {
      counters.preferences += 1;
      return {};
    },
    getProject: async (projectSlug: string) => projectRecords.find((project) => project.slug === projectSlug),
    listProjectDocuments: async (projectSlug: "alpha" | "beta") => {
      counters.documents[projectSlug] += 1;
      return [];
    },
    readDocumentRawContent: async () => undefined,
    listRuns: async (projectSlug: "alpha" | "beta") => {
      counters.runs[projectSlug] += 1;
      return [];
    },
    readOptionalRunArtifact: async () => undefined
  };

  const registry = {
    listRuntimeStates: async () => {
      counters.providers += 1;
      return [];
    },
    refreshRuntimeState: async () => {
      throw new Error("not used");
    }
  };

  const store = new SidebarStateStore({
    workspaceRoot: "/workspace",
    storage: storage as never,
    registry,
    agentDefaults: async () => ({
      finalizer: {
        providerId: "claude",
        useProviderDefaults: false,
        modelOverride: "",
        effortOverride: "high"
      }
    }),
    extensionVersion: "0.1.0"
  });

  await store.initialize();

  assert.equal(counters.documents.alpha, 1);
  assert.equal(counters.documents.beta, 1);
  assert.equal(counters.runs.alpha, 1);
  assert.equal(counters.runs.beta, 1);

  await store.refreshProjects("alpha");

  assert.equal(counters.listProjects, 2);
  assert.equal(counters.documents.alpha, 2);
  assert.equal(counters.documents.beta, 1);
  assert.equal(counters.runs.alpha, 2);
  assert.equal(counters.runs.beta, 1);
  assert.equal(store.snapshot().extensionVersion, "0.1.0");
  assert.equal(store.snapshot().agentDefaults.finalizer?.effortOverride, "high");
});

test("sidebar state store hydrates saved essay answer content into project view models", async () => {
  const projectRecords: ProjectRecord[] = [
    {
      ...createProject("alpha", "Alpha"),
      essayQuestions: ["지원 동기를 작성해주세요."],
      essayAnswerStates: [
        {
          questionIndex: 0,
          status: "completed",
          documentId: "doc-answer",
          completedAt: "2026-04-08T00:00:00.000Z"
        }
      ]
    }
  ];

  const storage = {
    storageRoot: "/workspace/.forjob",
    ensureInitialized: async () => undefined,
    listProfileDocuments: async () => [],
    listProjects: async () => projectRecords,
    getPreferences: async () => ({}),
    getProject: async () => projectRecords[0],
    listProjectDocuments: async () => [
      {
        id: "doc-answer",
        scope: "project" as const,
        projectSlug: "alpha",
        title: "essay-answer-q1.md",
        sourceType: "text" as const,
        rawPath: ".forjob/projects/alpha/context/raw/doc-answer.txt",
        normalizedPath: ".forjob/projects/alpha/context/normalized/doc-answer.md",
        pinnedByDefault: true,
        extractionStatus: "normalized" as const,
        createdAt: "2026-04-08T00:00:00.000Z"
      }
    ],
    readDocumentRawContent: async () => "완료된 답안",
    listRuns: async () => [],
    readOptionalRunArtifact: async () => undefined
  };

  const store = new SidebarStateStore({
    workspaceRoot: "/workspace",
    storage: storage as never,
    registry: {
      listRuntimeStates: async () => [],
      refreshRuntimeState: async () => {
        throw new Error("not used");
      }
    },
    extensionVersion: "0.1.0"
  });

  await store.initialize();

  assert.equal(store.snapshot().projects[0]?.essayAnswerStates[0]?.content, "완료된 답안");
});
