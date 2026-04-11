import * as assert from "node:assert/strict";
import test from "node:test";
import {
  RpcRequestSchema,
  RpcResponseSchema,
  EventEnvelopeSchema,
  OP_NAMES,
  EVENT_NAMES,
  assertNever,
  GetStatePayloadSchema,
  ListProjectsPayloadSchema,
  GetProjectPayloadSchema,
  SaveProjectPayloadSchema,
  UploadDocumentPayloadSchema,
  DeleteDocumentPayloadSchema,
  ListRunsPayloadSchema,
  GetRunMessagesPayloadSchema,
  StartRunPayloadSchema,
  ResumeRunPayloadSchema,
  AbortRunPayloadSchema,
  CompleteRunPayloadSchema,
  SubmitInterventionPayloadSchema,
  CallProviderTestPayloadSchema,
  SaveProviderConfigPayloadSchema,
  SaveProviderApiKeyPayloadSchema,
  NotionConnectPayloadSchema,
  NotionDisconnectPayloadSchema,
  OpendartSaveKeyPayloadSchema,
  OpendartTestPayloadSchema,
  ReadFilePayloadSchema,
  WriteFilePayloadSchema,
  ListWorkspaceFilesPayloadSchema,
  GetStateResultSchema,
  ListProjectsResultSchema,
  GetProjectResultSchema,
  StartRunResultSchema,
  ListWorkspaceFilesResultSchema,
  WriteFileResultSchema,
  ReadFileResultSchema,
  GetAgentDefaultsPayloadSchema,
  GetAgentDefaultsResultSchema,
  StateSnapshotEventPayloadSchema,
  RunEventPayloadSchema,
  InterventionRequestPayloadSchema,
  RunFinishedPayloadSchema
} from "../core/hostedRpc";

// ---------------------------------------------------------------------------
// Minimal valid fixtures
// ---------------------------------------------------------------------------
const MINIMAL_PROJECT = {
  slug: "alpha",
  companyName: "Alpha Corp",
  rubric: "- fit",
  pinnedDocumentIds: [],
  createdAt: "2026-04-11T00:00:00.000Z",
  updatedAt: "2026-04-11T00:00:00.000Z"
};

const MINIMAL_RUN_RECORD = {
  id: "run-1",
  projectSlug: "alpha",
  question: "지원 동기를 작성해주세요.",
  draft: "초안 내용",
  reviewMode: "deepFeedback",
  coordinatorProvider: "claude",
  reviewerProviders: ["codex"],
  rounds: 1,
  maxRoundsPerSection: 1,
  selectedDocumentIds: [],
  status: "completed",
  startedAt: "2026-04-11T00:00:00.000Z"
};

const MINIMAL_SIDEBAR_STATE = {
  workspaceOpened: true,
  extensionVersion: "0.1.0",
  openDartConfigured: false,
  providers: [],
  profileDocuments: [],
  projects: [],
  preferences: {},
  agentDefaults: {},
  runState: { status: "idle" },
  defaultRubric: "- fit"
};

const MINIMAL_RUN_EVENT = {
  timestamp: "2026-04-11T00:00:00.000Z",
  type: "run-started"
};

// ---------------------------------------------------------------------------
// Envelope-level tests
// ---------------------------------------------------------------------------

test("RpcRequest: wrong version is rejected", () => {
  const result = RpcRequestSchema.safeParse({
    v: 2,
    id: "req-1",
    op: "get_state",
    payload: {}
  });
  assert.equal(result.success, false);
});

test("RpcRequest: unknown op is rejected", () => {
  const result = RpcRequestSchema.safeParse({
    v: 1,
    id: "req-1",
    op: "delete_everything",
    payload: {}
  });
  assert.equal(result.success, false);
});

test("RpcRequest: missing id is rejected", () => {
  const result = RpcRequestSchema.safeParse({
    v: 1,
    op: "get_state",
    payload: {}
  });
  assert.equal(result.success, false);
});

test("RpcRequest: extra field on envelope is rejected (.strict)", () => {
  const result = RpcRequestSchema.safeParse({
    v: 1,
    id: "req-1",
    op: "get_state",
    payload: {},
    extra: "field"
  });
  assert.equal(result.success, false);
});

test("RpcResponse ok=true round-trips", () => {
  const raw = { v: 1, id: "req-1", ok: true, result: { foo: "bar" } };
  const parsed = RpcResponseSchema.parse(raw);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.id, "req-1");
  const reparsed = RpcResponseSchema.safeParse(parsed);
  assert.equal(reparsed.success, true);
});

test("RpcResponse ok=false round-trips", () => {
  const raw = { v: 1, id: "req-1", ok: false, error: { code: "not_found", message: "Not found" } };
  const parsed = RpcResponseSchema.parse(raw);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) {
    assert.equal(parsed.error.code, "not_found");
  }
});

test("RpcResponse: wrong version is rejected", () => {
  const result = RpcResponseSchema.safeParse({
    v: 2,
    id: "req-1",
    ok: true,
    result: {}
  });
  assert.equal(result.success, false);
});

// ---------------------------------------------------------------------------
// Per-op round-trip tests
// ---------------------------------------------------------------------------

test("get_state: valid request round-trips", () => {
  const req = RpcRequestSchema.parse({ v: 1, id: "r1", op: "get_state", payload: {} });
  assert.equal(req.op, "get_state");
  const reparsed = RpcRequestSchema.safeParse(req);
  assert.equal(reparsed.success, true);
});

test("get_state: extra payload field rejected", () => {
  const result = GetStatePayloadSchema.safeParse({ unexpected: true });
  assert.equal(result.success, false);
});

test("get_state: result parses sidebar state", () => {
  const result = GetStateResultSchema.parse(MINIMAL_SIDEBAR_STATE);
  assert.equal(result.workspaceOpened, true);
});

test("list_projects: valid request and result round-trip", () => {
  const req = RpcRequestSchema.parse({ v: 1, id: "r2", op: "list_projects", payload: {} });
  assert.equal(req.op, "list_projects");
  const resultPayload = ListProjectsResultSchema.parse({ projects: [MINIMAL_PROJECT] });
  assert.equal(resultPayload.projects.length, 1);
  assert.equal(resultPayload.projects[0]?.slug, "alpha");
});

test("list_projects: extra payload field rejected", () => {
  const result = ListProjectsPayloadSchema.safeParse({ filter: "all" });
  assert.equal(result.success, false);
});

test("get_project: requires slug", () => {
  const ok = RpcRequestSchema.safeParse({ v: 1, id: "r3", op: "get_project", payload: { slug: "alpha" } });
  assert.equal(ok.success, true);
  const fail = RpcRequestSchema.safeParse({ v: 1, id: "r3", op: "get_project", payload: {} });
  assert.equal(fail.success, false);
});

test("get_project: result round-trips", () => {
  const result = GetProjectResultSchema.parse(MINIMAL_PROJECT);
  assert.equal(result.slug, "alpha");
});

test("save_project: requires slug and patch", () => {
  const ok = RpcRequestSchema.safeParse({
    v: 1, id: "r4", op: "save_project",
    payload: { slug: "alpha", patch: { companyName: "Beta" } }
  });
  assert.equal(ok.success, true);
  const missingPatch = RpcRequestSchema.safeParse({
    v: 1, id: "r4", op: "save_project",
    payload: { slug: "alpha" }
  });
  assert.equal(missingPatch.success, false);
});

test("save_project: patch extra field rejected", () => {
  const result = SaveProjectPayloadSchema.safeParse({
    slug: "alpha",
    patch: { companyName: "Beta", hackField: true }
  });
  assert.equal(result.success, false);
});

test("upload_document: requires slug, filename, contentBase64", () => {
  const ok = RpcRequestSchema.safeParse({
    v: 1, id: "r5", op: "upload_document",
    payload: { slug: "alpha", filename: "resume.pdf", contentBase64: "AAAA" }
  });
  assert.equal(ok.success, true);
  const fail = RpcRequestSchema.safeParse({
    v: 1, id: "r5", op: "upload_document",
    payload: { slug: "alpha" }
  });
  assert.equal(fail.success, false);
});

test("upload_document: extra field rejected", () => {
  const result = UploadDocumentPayloadSchema.safeParse({
    slug: "alpha",
    filename: "resume.pdf",
    contentBase64: "AAAA",
    extra: true
  });
  assert.equal(result.success, false);
});

test("delete_document: requires slug and docId", () => {
  const ok = RpcRequestSchema.safeParse({
    v: 1, id: "r6", op: "delete_document",
    payload: { slug: "alpha", docId: "doc-1" }
  });
  assert.equal(ok.success, true);
  const fail = RpcRequestSchema.safeParse({
    v: 1, id: "r6", op: "delete_document",
    payload: { slug: "alpha" }
  });
  assert.equal(fail.success, false);
});

test("list_runs: requires slug", () => {
  const ok = RpcRequestSchema.safeParse({ v: 1, id: "r7", op: "list_runs", payload: { slug: "alpha" } });
  assert.equal(ok.success, true);
  const fail = RpcRequestSchema.safeParse({ v: 1, id: "r7", op: "list_runs", payload: {} });
  assert.equal(fail.success, false);
});

test("list_runs: result round-trips", () => {
  const result = require("../core/hostedRpc").ListRunsResultSchema.parse({ runs: [MINIMAL_RUN_RECORD] });
  assert.equal(result.runs.length, 1);
});

test("get_run_messages: requires runId, cursor optional", () => {
  const ok = RpcRequestSchema.safeParse({
    v: 1, id: "r8", op: "get_run_messages",
    payload: { runId: "run-1" }
  });
  assert.equal(ok.success, true);
  const withCursor = RpcRequestSchema.safeParse({
    v: 1, id: "r8", op: "get_run_messages",
    payload: { runId: "run-1", cursor: "tok-1" }
  });
  assert.equal(withCursor.success, true);
  const fail = GetRunMessagesPayloadSchema.safeParse({});
  assert.equal(fail.success, false);
});

test("start_run: requires all mandatory fields", () => {
  const ok = RpcRequestSchema.safeParse({
    v: 1, id: "r9", op: "start_run",
    payload: {
      slug: "alpha",
      question: "q",
      draft: "d",
      reviewMode: "deepFeedback",
      coordinatorProvider: "claude",
      reviewerProviders: ["codex"],
      rounds: 1,
      selectedDocumentIds: []
    }
  });
  assert.equal(ok.success, true);
  // Missing rounds
  const fail = StartRunPayloadSchema.safeParse({
    slug: "alpha",
    question: "q",
    draft: "d",
    reviewMode: "deepFeedback",
    coordinatorProvider: "claude",
    reviewerProviders: [],
    selectedDocumentIds: []
  });
  assert.equal(fail.success, false);
});

test("start_run: result has runId", () => {
  const result = StartRunResultSchema.parse({ runId: "run-42" });
  assert.equal(result.runId, "run-42");
});

test("resume_run: requires runId", () => {
  const ok = RpcRequestSchema.safeParse({ v: 1, id: "r10", op: "resume_run", payload: { runId: "run-1" } });
  assert.equal(ok.success, true);
  const fail = ResumeRunPayloadSchema.safeParse({});
  assert.equal(fail.success, false);
});

test("abort_run: requires runId, reason optional", () => {
  const ok = RpcRequestSchema.safeParse({ v: 1, id: "r11", op: "abort_run", payload: { runId: "run-1" } });
  assert.equal(ok.success, true);
  const withReason = RpcRequestSchema.safeParse({
    v: 1, id: "r11", op: "abort_run",
    payload: { runId: "run-1", reason: "user cancelled" }
  });
  assert.equal(withReason.success, true);
  const fail = AbortRunPayloadSchema.safeParse({});
  assert.equal(fail.success, false);
});

test("complete_run: requires runId", () => {
  const ok = RpcRequestSchema.safeParse({ v: 1, id: "r12", op: "complete_run", payload: { runId: "run-1" } });
  assert.equal(ok.success, true);
  const fail = CompleteRunPayloadSchema.safeParse({});
  assert.equal(fail.success, false);
});

test("submit_intervention: requires runId and text", () => {
  const ok = RpcRequestSchema.safeParse({
    v: 1, id: "r13", op: "submit_intervention",
    payload: { runId: "run-1", text: "계속해주세요" }
  });
  assert.equal(ok.success, true);
  const fail = SubmitInterventionPayloadSchema.safeParse({ runId: "run-1" });
  assert.equal(fail.success, false);
});

test("call_provider_test: requires valid provider", () => {
  const ok = RpcRequestSchema.safeParse({
    v: 1, id: "r14", op: "call_provider_test",
    payload: { provider: "claude" }
  });
  assert.equal(ok.success, true);
  const fail = CallProviderTestPayloadSchema.safeParse({ provider: "unknown-llm" });
  assert.equal(fail.success, false);
});

test("save_provider_config: requires provider and config object", () => {
  const ok = RpcRequestSchema.safeParse({
    v: 1, id: "r15", op: "save_provider_config",
    payload: { provider: "gemini", config: { model: "gemini-2.0" } }
  });
  assert.equal(ok.success, true);
  const fail = SaveProviderConfigPayloadSchema.safeParse({ provider: "gemini" });
  assert.equal(fail.success, false);
});

test("save_provider_config: config extra field rejected", () => {
  const result = SaveProviderConfigPayloadSchema.safeParse({
    provider: "claude",
    config: { hackField: true }
  });
  assert.equal(result.success, false);
});

test("save_provider_api_key: requires provider and non-empty key", () => {
  const ok = RpcRequestSchema.safeParse({
    v: 1, id: "r16", op: "save_provider_api_key",
    payload: { provider: "claude", key: "sk-abc123" }
  });
  assert.equal(ok.success, true);
  const emptyKey = SaveProviderApiKeyPayloadSchema.safeParse({ provider: "claude", key: "" });
  assert.equal(emptyKey.success, false);
  const missingProvider = SaveProviderApiKeyPayloadSchema.safeParse({ key: "sk-abc123" });
  assert.equal(missingProvider.success, false);
});

test("notion_connect: requires token and dbId", () => {
  const ok = RpcRequestSchema.safeParse({
    v: 1, id: "r17", op: "notion_connect",
    payload: { token: "secret_token", dbId: "db-uuid" }
  });
  assert.equal(ok.success, true);
  const emptyToken = NotionConnectPayloadSchema.safeParse({ token: "", dbId: "db-uuid" });
  assert.equal(emptyToken.success, false);
  const missingDb = NotionConnectPayloadSchema.safeParse({ token: "tok" });
  assert.equal(missingDb.success, false);
});

test("notion_disconnect: empty payload accepted", () => {
  const ok = RpcRequestSchema.safeParse({ v: 1, id: "r18", op: "notion_disconnect", payload: {} });
  assert.equal(ok.success, true);
  const withExtra = NotionDisconnectPayloadSchema.safeParse({ extra: true });
  assert.equal(withExtra.success, false);
});

test("opendart_save_key: requires non-empty key", () => {
  const ok = RpcRequestSchema.safeParse({
    v: 1, id: "r19", op: "opendart_save_key",
    payload: { key: "dart-key-abc" }
  });
  assert.equal(ok.success, true);
  const fail = OpendartSaveKeyPayloadSchema.safeParse({ key: "" });
  assert.equal(fail.success, false);
});

test("opendart_test: corpName is optional", () => {
  const noCorpName = RpcRequestSchema.safeParse({ v: 1, id: "r20", op: "opendart_test", payload: {} });
  assert.equal(noCorpName.success, true);
  const withCorpName = RpcRequestSchema.safeParse({
    v: 1, id: "r20", op: "opendart_test",
    payload: { corpName: "삼성전자" }
  });
  assert.equal(withCorpName.success, true);
  const withExtra = OpendartTestPayloadSchema.safeParse({ corpName: "삼성전자", hack: true });
  assert.equal(withExtra.success, false);
});

test("read_file: requires path", () => {
  const ok = RpcRequestSchema.safeParse({ v: 1, id: "r21", op: "read_file", payload: { path: "docs/README.md" } });
  assert.equal(ok.success, true);
  const fail = ReadFilePayloadSchema.safeParse({});
  assert.equal(fail.success, false);
  const result = ReadFileResultSchema.parse({ contentBase64: "SGVsbG8=" });
  assert.equal(result.contentBase64, "SGVsbG8=");
});

test("write_file: requires path and contentBase64", () => {
  const ok = RpcRequestSchema.safeParse({
    v: 1, id: "r22", op: "write_file",
    payload: { path: "docs/README.md", contentBase64: "SGVsbG8=" }
  });
  assert.equal(ok.success, true);
  const fail = WriteFilePayloadSchema.safeParse({ path: "docs/README.md" });
  assert.equal(fail.success, false);
  const result = WriteFileResultSchema.parse({ ok: true, bytes: 5 });
  assert.equal(result.ok, true);
  assert.equal(result.bytes, 5);
});

test("list_workspace_files: subdir optional, entries in result", () => {
  const noSubdir = RpcRequestSchema.safeParse({ v: 1, id: "r23", op: "list_workspace_files", payload: {} });
  assert.equal(noSubdir.success, true);
  const withSubdir = RpcRequestSchema.safeParse({
    v: 1, id: "r23", op: "list_workspace_files",
    payload: { subdir: "docs" }
  });
  assert.equal(withSubdir.success, true);
  const result = ListWorkspaceFilesResultSchema.parse({
    entries: [{ path: "docs/README.md", name: "README.md", isDirectory: false, sizeBytes: 1024 }]
  });
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0]?.isDirectory, false);
});

test("get_agent_defaults: valid request and result round-trip", () => {
  const req = RpcRequestSchema.safeParse({
    v: 1, id: "r24", op: "get_agent_defaults", payload: {}
  });
  assert.equal(req.success, true);

  const result = GetAgentDefaultsResultSchema.parse({ agentDefaults: {} });
  assert.deepEqual(result.agentDefaults, {});
});

test("get_agent_defaults: extra payload field rejected", () => {
  assert.equal(GetAgentDefaultsPayloadSchema.safeParse({ role: "coordinator" }).success, false);
});

// ---------------------------------------------------------------------------
// Event envelope round-trips
// ---------------------------------------------------------------------------

test("EventEnvelope state_snapshot round-trips", () => {
  const envelope = EventEnvelopeSchema.parse({
    v: 1,
    event: "state_snapshot",
    payload: { state: MINIMAL_SIDEBAR_STATE }
  });
  assert.equal(envelope.event, "state_snapshot");
  if (envelope.event === "state_snapshot") {
    assert.equal(envelope.payload.state.workspaceOpened, true);
  }
  const reparsed = EventEnvelopeSchema.safeParse(envelope);
  assert.equal(reparsed.success, true);
});

test("EventEnvelope run_event round-trips", () => {
  const envelope = EventEnvelopeSchema.parse({
    v: 1,
    event: "run_event",
    payload: { runId: "run-1", event: MINIMAL_RUN_EVENT }
  });
  assert.equal(envelope.event, "run_event");
  if (envelope.event === "run_event") {
    assert.equal(envelope.payload.runId, "run-1");
    assert.equal(envelope.payload.event.type, "run-started");
  }
});

test("EventEnvelope intervention_request round-trips", () => {
  const envelope = EventEnvelopeSchema.parse({
    v: 1,
    event: "intervention_request",
    payload: { runId: "run-1", prompt: "계속 진행할까요?" }
  });
  assert.equal(envelope.event, "intervention_request");
  if (envelope.event === "intervention_request") {
    assert.equal(envelope.payload.prompt, "계속 진행할까요?");
  }
});

test("EventEnvelope run_finished round-trips with optional summary", () => {
  const noSummary = EventEnvelopeSchema.parse({
    v: 1,
    event: "run_finished",
    payload: { runId: "run-1", status: "completed" }
  });
  assert.equal(noSummary.event, "run_finished");
  const withSummary = EventEnvelopeSchema.parse({
    v: 1,
    event: "run_finished",
    payload: { runId: "run-1", status: "aborted", summary: "User cancelled." }
  });
  if (withSummary.event === "run_finished") {
    assert.equal(withSummary.payload.summary, "User cancelled.");
  }
  // Invalid status
  const fail = RunFinishedPayloadSchema.safeParse({ runId: "run-1", status: "unknown-status" });
  assert.equal(fail.success, false);
});

test("EventEnvelope: unknown event name is rejected", () => {
  const result = EventEnvelopeSchema.safeParse({
    v: 1,
    event: "hack_event",
    payload: {}
  });
  assert.equal(result.success, false);
});

test("EventEnvelope: wrong version is rejected", () => {
  const result = EventEnvelopeSchema.safeParse({
    v: 2,
    event: "state_snapshot",
    payload: { state: MINIMAL_SIDEBAR_STATE }
  });
  assert.equal(result.success, false);
});

test("EventEnvelope: extra envelope field rejected (.strict)", () => {
  const result = EventEnvelopeSchema.safeParse({
    v: 1,
    event: "run_finished",
    payload: { runId: "run-1", status: "completed" },
    extraField: true
  });
  assert.equal(result.success, false);
});

// ---------------------------------------------------------------------------
// Exhaustive union compile-time test
// ---------------------------------------------------------------------------

test("OP_NAMES exhaustiveness via switch", () => {
  // This test proves at compile-time that every OpName is handled.
  // If a new op is added to OP_NAMES but not the switch, TypeScript will error.
  const count = OP_NAMES.reduce<number>((acc, op) => {
    // Type is narrowed to never in the default branch, proving exhaustiveness.
    switch (op) {
      case "get_state": return acc + 1;
      case "list_projects": return acc + 1;
      case "get_project": return acc + 1;
      case "save_project": return acc + 1;
      case "upload_document": return acc + 1;
      case "delete_document": return acc + 1;
      case "list_runs": return acc + 1;
      case "get_run_messages": return acc + 1;
      case "start_run": return acc + 1;
      case "resume_run": return acc + 1;
      case "abort_run": return acc + 1;
      case "complete_run": return acc + 1;
      case "submit_intervention": return acc + 1;
      case "call_provider_test": return acc + 1;
      case "save_provider_config": return acc + 1;
      case "save_provider_api_key": return acc + 1;
      case "notion_connect": return acc + 1;
      case "notion_disconnect": return acc + 1;
      case "opendart_save_key": return acc + 1;
      case "opendart_test": return acc + 1;
      case "read_file": return acc + 1;
      case "write_file": return acc + 1;
      case "list_workspace_files": return acc + 1;
      case "get_agent_defaults": return acc + 1;
      default: return assertNever(op);
    }
  }, 0);

  assert.equal(count, 24);
  assert.equal(OP_NAMES.length, 24);
});

test("EVENT_NAMES exhaustiveness via switch", () => {
  const count = EVENT_NAMES.reduce<number>((acc, ev) => {
    switch (ev) {
      case "state_snapshot": return acc + 1;
      case "run_event": return acc + 1;
      case "intervention_request": return acc + 1;
      case "run_finished": return acc + 1;
      default: return assertNever(ev);
    }
  }, 0);

  assert.equal(count, 4);
  assert.equal(EVENT_NAMES.length, 4);
});

// ---------------------------------------------------------------------------
// Payload strict rejection — all empty-payload ops reject extra fields
// ---------------------------------------------------------------------------

test("get_state payload rejects extra fields", () => {
  assert.equal(GetStatePayloadSchema.safeParse({ op: "get_state" }).success, false);
});

test("list_projects payload rejects extra fields", () => {
  assert.equal(ListProjectsPayloadSchema.safeParse({ page: 1 }).success, false);
});

test("notion_disconnect payload rejects extra fields", () => {
  assert.equal(require("../core/hostedRpc").NotionDisconnectPayloadSchema.safeParse({ force: true }).success, false);
});
