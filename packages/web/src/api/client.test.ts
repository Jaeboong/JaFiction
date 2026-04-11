/**
 * client.test.ts — shape-wrap unit tests for RunnerClient in hosted mode.
 *
 * The hosted write ops for Provider / Notion / OpenDART return `{ok: true}`,
 * but the RunnerClient method signatures expose a ProviderRuntimeState (the
 * pre-hosted contract). The `refetchProviderRuntimeState` helper bridges
 * this by calling `get_state` after each write and extracting the matching
 * slice. These tests pin that behavior by stubbing `fetch` and asserting
 * both the op dispatch and the follow-up `get_state` refetch.
 */
import { describe, it, beforeEach, vi, type Mock } from "vitest";
import { strict as assert } from "node:assert";
import { RunnerClient } from "./client";
import type { ProviderRuntimeState, SidebarState } from "@jasojeon/shared";

const PROVIDER_RUNTIME: ProviderRuntimeState = {
  providerId: "claude",
  name: "Claude",
  available: true,
  authMode: "cli",
  authStatus: "healthy",
  command: "claude",
  model: "claude-sonnet-4",
  effort: "medium",
  notionMcpConfigured: true,
  notionMcpConnected: true,
  notionMcpMessage: "ok"
} as unknown as ProviderRuntimeState;

const SIDEBAR_STATE: SidebarState = {
  workspaceOpened: true,
  extensionVersion: "test",
  openDartConfigured: false,
  providers: [PROVIDER_RUNTIME],
  profileDocuments: [],
  projects: [],
  preferences: {},
  agentDefaults: {},
  runState: { status: "idle" },
  defaultRubric: ""
} as unknown as SidebarState;

function mockRpcFetch(): Mock {
  return vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const op = body.op as string;
    const id = body.id as string;
    if (op === "get_state") {
      return new Response(JSON.stringify({ v: 1, id, ok: true, result: SIDEBAR_STATE }), { status: 200 });
    }
    // Every write op under test returns {ok: true}
    return new Response(JSON.stringify({ v: 1, id, ok: true, result: { ok: true } }), { status: 200 });
  });
}

describe("RunnerClient shape-wrap (hosted)", () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: Mock;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = mockRpcFetch();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  const restore = () => {
    globalThis.fetch = originalFetch;
  };

  it("saveProviderApiKey returns a ProviderRuntimeState, not {ok:true}", async () => {
    const client = new RunnerClient("http://hosted.test");
    try {
      const result = await client.saveProviderApiKey("claude", "sk-test-123");
      assert.equal(result.providerId, "claude");
      // Must NOT be the raw {ok:true} envelope.
      assert.notEqual((result as unknown as { ok?: boolean }).ok, true);
      // Two POSTs: one for the write op, one for the get_state refetch.
      assert.equal(fetchMock.mock.calls.length, 2);
      const firstOp = JSON.parse(String(fetchMock.mock.calls[0]![1].body)).op;
      const secondOp = JSON.parse(String(fetchMock.mock.calls[1]![1].body)).op;
      assert.equal(firstOp, "save_provider_api_key");
      assert.equal(secondOp, "get_state");
    } finally {
      restore();
    }
  });

  it("testProvider returns a ProviderRuntimeState extracted from get_state", async () => {
    const client = new RunnerClient("http://hosted.test");
    try {
      const result = await client.testProvider("claude");
      assert.equal(result.providerId, "claude");
      assert.equal(result.authStatus, "healthy");
    } finally {
      restore();
    }
  });

  it("checkNotion returns a ProviderRuntimeState", async () => {
    const client = new RunnerClient("http://hosted.test");
    try {
      const result = await client.checkNotion("claude");
      assert.equal(result.providerId, "claude");
    } finally {
      restore();
    }
  });

  it("connectNotion rejects when hosted and no token supplied", async () => {
    const client = new RunnerClient("http://hosted.test");
    try {
      await assert.rejects(() => client.connectNotion("claude"), /Notion 토큰/);
    } finally {
      restore();
    }
  });

  it("connectNotion hosted path sends token in notion_connect payload", async () => {
    const client = new RunnerClient("http://hosted.test");
    try {
      const result = await client.connectNotion("claude", { token: "secret_abc1234567", dbId: "db-1" });
      assert.equal(result.providerId, "claude");
      const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
      assert.equal(body.op, "notion_connect");
      assert.equal(body.payload.token, "secret_abc1234567");
      assert.equal(body.payload.dbId, "db-1");
    } finally {
      restore();
    }
  });

  it("clearProviderApiKey hosted path resolves without returning a body", async () => {
    const client = new RunnerClient("http://hosted.test");
    try {
      const result = await client.clearProviderApiKey("claude");
      assert.equal(result, undefined);
      const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
      assert.equal(body.op, "clear_provider_api_key");
    } finally {
      restore();
    }
  });

  it("saveAgentDefaults hosted path dispatches save_agent_defaults", async () => {
    const client = new RunnerClient("http://hosted.test");
    try {
      await client.saveAgentDefaults({});
      const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
      assert.equal(body.op, "save_agent_defaults");
    } finally {
      restore();
    }
  });

  // ---------------------------------------------------------------------------
  // Stage 11.4 — run lifecycle parity (hosted branch + expanded result shapes)
  // ---------------------------------------------------------------------------
  it("deleteRun hosted path dispatches delete_run with slug+runId", async () => {
    const client = new RunnerClient("http://hosted.test");
    try {
      const result = await client.deleteRun("alpha", "run-42");
      assert.equal(result, undefined);
      const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
      assert.equal(body.op, "delete_run");
      assert.equal(body.payload.slug, "alpha");
      assert.equal(body.payload.runId, "run-42");
    } finally {
      restore();
    }
  });

  it("resumeRun hosted path returns expanded {runId, resumedFromRunId}", async () => {
    const client = new RunnerClient("http://hosted.test");
    // Override: the handler returns the new 11.4 shape.
    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      const req = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          v: 1,
          id: req.id,
          ok: true,
          result: { runId: "run-42", resumedFromRunId: "run-42" }
        }),
        { status: 200 }
      );
    });
    try {
      const result = await client.resumeRun("alpha", "run-42", "다시 시작");
      assert.equal(result.runId, "run-42");
      assert.equal(result.resumedFromRunId, "run-42");
      const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
      assert.equal(body.op, "resume_run");
      assert.equal(body.payload.runId, "run-42");
      assert.equal(body.payload.message, "다시 시작");
    } finally {
      restore();
    }
  });

  it("resumeRun hosted path omits message when empty", async () => {
    const client = new RunnerClient("http://hosted.test");
    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      const req = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          v: 1,
          id: req.id,
          ok: true,
          result: { runId: "run-1", resumedFromRunId: "run-1" }
        }),
        { status: 200 }
      );
    });
    try {
      await client.resumeRun("alpha", "run-1");
      const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
      assert.equal(body.payload.runId, "run-1");
      assert.equal(body.payload.message, undefined);
    } finally {
      restore();
    }
  });

  it("submitIntervention hosted path returns expanded {outcome, runId, nextRunId?}", async () => {
    const client = new RunnerClient("http://hosted.test");
    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      const req = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          v: 1,
          id: req.id,
          ok: true,
          result: { outcome: "continuation", runId: "run-1", nextRunId: "run-2" }
        }),
        { status: 200 }
      );
    });
    try {
      const result = await client.submitIntervention("run-1", "계속 진행해주세요");
      assert.equal(result.outcome, "continuation");
      assert.equal(result.runId, "run-1");
      assert.equal(result.nextRunId, "run-2");
      const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
      assert.equal(body.op, "submit_intervention");
      assert.equal(body.payload.runId, "run-1");
      assert.equal(body.payload.text, "계속 진행해주세요");
    } finally {
      restore();
    }
  });

  it("submitIntervention hosted path handles {outcome, runId} without nextRunId", async () => {
    const client = new RunnerClient("http://hosted.test");
    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      const req = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          v: 1,
          id: req.id,
          ok: true,
          result: { outcome: "queued", runId: "run-1" }
        }),
        { status: 200 }
      );
    });
    try {
      const result = await client.submitIntervention("run-1", "wait");
      assert.equal(result.outcome, "queued");
      assert.equal(result.nextRunId, undefined);
    } finally {
      restore();
    }
  });

  // ---------------------------------------------------------------------------
  // Stage 11.8 — profile document hosted parity
  // ---------------------------------------------------------------------------
  const MINIMAL_PROFILE_DOC = {
    id: "pdoc-1",
    scope: "profile",
    title: "이력서",
    sourceType: "text",
    rawPath: "raw/pdoc-1.md",
    pinnedByDefault: false,
    extractionStatus: "normalized",
    createdAt: "2026-04-11T00:00:00.000Z"
  };

  it("listProfileDocuments dispatches profile_list_documents and unwraps", async () => {
    const client = new RunnerClient("http://hosted.test");
    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      const req = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({ v: 1, id: req.id, ok: true, result: { documents: [MINIMAL_PROFILE_DOC] } }),
        { status: 200 }
      );
    });
    try {
      const docs = await client.listProfileDocuments();
      assert.equal(docs.length, 1);
      assert.equal(docs[0]!.title, "이력서");
      const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
      assert.equal(body.op, "profile_list_documents");
    } finally {
      restore();
    }
  });

  it("saveProfileTextDocument dispatches with payload and returns unwrapped document", async () => {
    const client = new RunnerClient("http://hosted.test");
    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      const req = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({ v: 1, id: req.id, ok: true, result: { document: MINIMAL_PROFILE_DOC } }),
        { status: 200 }
      );
    });
    try {
      const doc = await client.saveProfileTextDocument({
        title: "이력서",
        content: "내용",
        note: "2026",
        pinnedByDefault: true
      });
      assert.equal(doc.id, "pdoc-1");
      const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
      assert.equal(body.op, "profile_save_text_document");
      assert.equal(body.payload.title, "이력서");
      assert.equal(body.payload.note, "2026");
      assert.equal(body.payload.pinnedByDefault, true);
    } finally {
      restore();
    }
  });

  it("setProfileDocumentPinned dispatches profile_set_document_pinned", async () => {
    const client = new RunnerClient("http://hosted.test");
    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      const req = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({ v: 1, id: req.id, ok: true, result: { document: { ...MINIMAL_PROFILE_DOC, pinnedByDefault: true } } }),
        { status: 200 }
      );
    });
    try {
      const doc = await client.setProfileDocumentPinned("pdoc-1", true);
      assert.equal(doc.pinnedByDefault, true);
      const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
      assert.equal(body.op, "profile_set_document_pinned");
      assert.equal(body.payload.documentId, "pdoc-1");
      assert.equal(body.payload.pinned, true);
    } finally {
      restore();
    }
  });

  it("getProfileDocumentPreview dispatches profile_get_document_preview", async () => {
    const client = new RunnerClient("http://hosted.test");
    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      const req = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          v: 1, id: req.id, ok: true, result: {
            documentId: "pdoc-1",
            title: "이력서",
            note: "",
            sourceType: "text",
            extractionStatus: "normalized",
            rawPath: "raw/pdoc-1.md",
            normalizedPath: "",
            previewSource: "normalized",
            content: "hello"
          }
        }),
        { status: 200 }
      );
    });
    try {
      const preview = await client.getProfileDocumentPreview("pdoc-1");
      assert.equal(preview.content, "hello");
      assert.equal(preview.previewSource, "normalized");
      const body = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
      assert.equal(body.op, "profile_get_document_preview");
      assert.equal(body.payload.documentId, "pdoc-1");
    } finally {
      restore();
    }
  });

  it("testOpenDartConnection maps hosted {ok,sample} to {ok,message}", async () => {
    const client = new RunnerClient("http://hosted.test");
    // Override mock to return a sample string.
    fetchMock.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      const req = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({ v: 1, id: req.id, ok: true, result: { ok: true, sample: "삼성전자 corp payload" } }),
        { status: 200 }
      );
    });
    try {
      const result = await client.testOpenDartConnection();
      assert.equal(result.ok, true);
      assert.equal(result.message, "삼성전자 corp payload");
    } finally {
      restore();
    }
  });
});
