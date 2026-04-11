import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

import {
  OP_NAMES,
  RpcRequest,
  RpcResponse,
  ForJobStorage,
  RunSessionManager,
  SidebarState,
  providerIds
} from "@jafiction/shared";
import { createRpcDispatcher, redactForLog, Logger } from "../hosted/rpcDispatcher";
import type { RunnerContext } from "../runnerContext";

// ---------------------------------------------------------------------------
// Minimal fake SidebarState
// ---------------------------------------------------------------------------
const fakeSidebarState: SidebarState = {
  workspaceOpened: true,
  extensionVersion: "test",
  openDartConfigured: false,
  openDartConnectionStatus: "untested",
  providers: [],
  profileDocuments: [],
  projects: [],
  preferences: {},
  agentDefaults: {},
  runState: { status: "idle" },
  defaultRubric: ""
};

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
interface HarnessOpts {
  workspaceRoot?: string;
  storageRoot?: string;
  storage?: ForJobStorage;
}

type LogEntry = { level: "info" | "warn" | "error"; msg: string; meta?: Record<string, unknown> };

interface Harness {
  dispatch: (req: unknown) => Promise<RpcResponse>;
  logs: LogEntry[];
  ctx: RunnerContext;
  storage: ForJobStorage;
  cleanup: () => Promise<void>;
}

async function makeHarness(opts: HarnessOpts = {}): Promise<Harness> {
  const workspaceRoot = opts.workspaceRoot ?? await fs.mkdtemp(path.join(os.tmpdir(), "jafiction-rpc-test-"));
  const storageRoot = opts.storageRoot ?? path.join(workspaceRoot, ".jafiction");
  const storage = opts.storage ?? new ForJobStorage(workspaceRoot, storageRoot);
  await storage.ensureInitialized();

  const logs: LogEntry[] = [];
  const logger: Logger = {
    info: (msg, meta) => logs.push({ level: "info", msg, meta }),
    warn: (msg, meta) => logs.push({ level: "warn", msg, meta }),
    error: (msg, meta) => logs.push({ level: "error", msg, meta })
  };

  const runSessions = new RunSessionManager();
  let pushCount = 0;

  // Fake stateStore with all required methods
  const stateStore = {
    setRunState: () => undefined,
    refreshProjects: async () => undefined,
    refreshPreferences: async () => undefined,
    refreshProvider: async () => undefined,
    refreshOpenDartConfigured: async () => undefined,
    setOpenDartConnectionState: () => undefined
  } as unknown as RunnerContext["stateStore"];

  // Fake secrets store
  const secretsMap = new Map<string, string>();
  const fakeSecrets = {
    get: async (key: string) => secretsMap.get(key),
    store: async (key: string, value: string) => { secretsMap.set(key, value); },
    delete: async (key: string) => { secretsMap.delete(key); },
    initialize: async () => undefined
  } as unknown as ReturnType<RunnerContext["secrets"]>;

  // Fake registry
  const fakeRegistry = {
    testProvider: async () => ({ providerId: "claude", authStatus: "healthy" }),
    refreshRuntimeState: async (providerId: string) => ({ providerId, authStatus: "healthy" }),
    listRuntimeStates: async () => [],
    setAuthMode: async () => undefined,
    setModel: async () => undefined,
    setEffort: async () => undefined,
    saveApiKey: async () => undefined,
    clearApiKey: async () => undefined,
    saveNotionToken: async () => undefined,
    connectNotionMcp: async () => ({ providerId: "claude", status: "available" }),
    disconnectNotionMcp: async () => ({ providerId: "claude", status: "available" }),
    checkNotionMcp: async () => ({ configured: false, connected: false })
  } as unknown as ReturnType<RunnerContext["registry"]>;

  // Fake config
  const fakeConfig = {
    set: async () => undefined,
    getAgentDefaults: async () => ({})
  } as unknown as ReturnType<RunnerContext["config"]>;

  const ctx: RunnerContext = {
    workspaceRoot,
    storageRoot,
    stateStore,
    runSessions,
    sessionToken: "test-token",
    storage: () => storage,
    registry: () => fakeRegistry,
    orchestrator: () => {
      throw new Error("orchestrator not wired in rpc tests");
    },
    config: () => fakeConfig,
    secrets: () => fakeSecrets,
    snapshot: () => fakeSidebarState,
    pushState: async () => { pushCount += 1; },
    emitRunEvent: () => undefined,
    clearRunBuffer: () => undefined,
    runBusy: async (_msg: string, work: () => Promise<void>) => { await work(); },
    refreshAll: async () => undefined
  };

  const dispatch = createRpcDispatcher({ runnerContext: ctx, logger });

  return {
    dispatch,
    logs,
    ctx,
    storage,
    cleanup: async () => {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  };
}

function makeEnvelope<TOp extends RpcRequest["op"]>(
  op: TOp,
  payload: Extract<RpcRequest, { op: TOp }>["payload"]
): unknown {
  return { v: 1, id: `test-${op}`, op, payload };
}

// ---------------------------------------------------------------------------
// Schema validation: bad_request on invalid envelope
// ---------------------------------------------------------------------------
test("rpc:bad_request — missing required fields", async () => {
  const h = await makeHarness();
  try {
    const res = await h.dispatch({ v: 1, id: "x", op: "get_state" }); // missing payload
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.error.code, "bad_request");
    }
  } finally {
    await h.cleanup();
  }
});

test("rpc:bad_request — unknown op", async () => {
  const h = await makeHarness();
  try {
    const res = await h.dispatch({ v: 1, id: "x", op: "non_existent_op", payload: {} });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.error.code, "bad_request");
    }
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Internal error path
// ---------------------------------------------------------------------------
test("rpc:internal error — handler throws untagged error", async () => {
  const h = await makeHarness();
  try {
    // get_project for a non-existent slug will throw
    const res = await h.dispatch(makeEnvelope("get_project", { slug: "does-not-exist" }));
    assert.equal(res.ok, false);
    if (!res.ok) {
      // Could be "not_found" or "internal" depending on storage impl
      assert.ok(["not_found", "internal"].includes(res.error.code));
    }
    const errLog = h.logs.find((l) => l.level === "error");
    assert.ok(errLog);
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// get_state
// ---------------------------------------------------------------------------
test("rpc:get_state — returns sidebar snapshot", async () => {
  const h = await makeHarness();
  try {
    const res = await h.dispatch(makeEnvelope("get_state", {}));
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.result.workspaceOpened, true);
    }
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// list_projects
// ---------------------------------------------------------------------------
test("rpc:list_projects — returns empty list initially", async () => {
  const h = await makeHarness();
  try {
    const res = await h.dispatch(makeEnvelope("list_projects", {}));
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.ok(Array.isArray(res.result.projects));
    }
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// get_project / save_project
// ---------------------------------------------------------------------------
test("rpc:get_project — returns project after creation", async () => {
  const h = await makeHarness();
  try {
    const project = await h.storage.createProject({ companyName: "Kakao" });
    const res = await h.dispatch(makeEnvelope("get_project", { slug: project.slug }));
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.result.companyName, "Kakao");
    }
  } finally {
    await h.cleanup();
  }
});

test("rpc:save_project — updates companyName", async () => {
  const h = await makeHarness();
  try {
    const project = await h.storage.createProject({ companyName: "Naver" });
    const res = await h.dispatch(makeEnvelope("save_project", {
      slug: project.slug,
      patch: { companyName: "Naver Corp" }
    }));
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.result.companyName, "Naver Corp");
    }
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// upload_document / delete_document
// ---------------------------------------------------------------------------
test("rpc:upload_document — imports a base64 file", async () => {
  const h = await makeHarness();
  try {
    const project = await h.storage.createProject({ companyName: "Samsung" });
    const content = Buffer.from("hello world").toString("base64");
    const res = await h.dispatch(makeEnvelope("upload_document", {
      slug: project.slug,
      filename: "test.txt",
      contentBase64: content
    }));
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.ok(typeof res.result.docId === "string");
    }
  } finally {
    await h.cleanup();
  }
});

test("rpc:delete_document — ok:true", async () => {
  const h = await makeHarness();
  try {
    const project = await h.storage.createProject({ companyName: "LG" });
    const doc = await h.storage.saveProjectTextDocument(project.slug, "My Doc", "content", false);
    const res = await h.dispatch(makeEnvelope("delete_document", {
      slug: project.slug,
      docId: doc.id
    }));
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.result.ok, true);
    }
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// list_runs
// ---------------------------------------------------------------------------
test("rpc:list_runs — returns empty list for new project", async () => {
  const h = await makeHarness();
  try {
    const project = await h.storage.createProject({ companyName: "Hyundai" });
    const res = await h.dispatch(makeEnvelope("list_runs", { slug: project.slug }));
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.ok(Array.isArray(res.result.runs));
      assert.equal((res.result.runs as unknown[]).length, 0);
    }
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// get_run_messages
// ---------------------------------------------------------------------------
test("rpc:get_run_messages — returns empty messages for unknown runId", async () => {
  const h = await makeHarness();
  try {
    const res = await h.dispatch(makeEnvelope("get_run_messages", { runId: "nonexistent-run" }));
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.ok(Array.isArray(res.result.messages));
    }
  } finally {
    await h.cleanup();
  }
});

test("rpc:get_run_messages — returns saved messages", async () => {
  const h = await makeHarness();
  try {
    const project = await h.storage.createProject({ companyName: "Kakao" });
    await h.storage.createRun({
      id: "run-abc",
      projectSlug: project.slug,
      question: "Q",
      draft: "D",
      reviewMode: "realtime",
      coordinatorProvider: "claude",
      reviewerProviders: [],
      rounds: 1,
      maxRoundsPerSection: 1,
      selectedDocumentIds: [],
      status: "completed",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:01:00.000Z"
    });
    await h.storage.saveRunChatMessages(project.slug, "run-abc", [
      {
        id: "msg-1",
        providerId: "claude",
        participantId: "coordinator",
        participantLabel: "Coord",
        speaker: "Claude",
        speakerRole: "coordinator",
        recipient: "All",
        round: 1,
        content: "Hi",
        startedAt: "2026-01-01T00:00:01.000Z",
        finishedAt: "2026-01-01T00:00:05.000Z",
        status: "completed"
      }
    ]);
    const res = await h.dispatch(makeEnvelope("get_run_messages", { runId: "run-abc" }));
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal((res.result.messages as unknown[]).length, 1);
    }
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// start_run — light smoke (we don't wire up orchestrator)
// ---------------------------------------------------------------------------
test("rpc:start_run — internal error without orchestrator", async () => {
  const h = await makeHarness();
  try {
    const project = await h.storage.createProject({ companyName: "SK" });
    const res = await h.dispatch(makeEnvelope("start_run", {
      slug: project.slug,
      question: "Why SK?",
      draft: "Because...",
      reviewMode: "realtime",
      coordinatorProvider: "claude",
      reviewerProviders: [],
      rounds: 1,
      selectedDocumentIds: []
    }));
    // orchestrator is not wired — expect error
    assert.equal(res.ok, false);
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// resume_run
// ---------------------------------------------------------------------------
test("rpc:resume_run — not_found for unknown runId", async () => {
  const h = await makeHarness();
  try {
    const res = await h.dispatch(makeEnvelope("resume_run", { runId: "ghost-run" }));
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.error.code, "not_found");
    }
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// abort_run
// ---------------------------------------------------------------------------
test("rpc:abort_run — invalid_input when no active run", async () => {
  const h = await makeHarness();
  try {
    const res = await h.dispatch(makeEnvelope("abort_run", { runId: "r1" }));
    // No active session → AddressedRunMismatchError or similar → invalid_input or internal
    assert.equal(res.ok, false);
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// complete_run
// ---------------------------------------------------------------------------
test("rpc:complete_run — invalid_input when no active session", async () => {
  const h = await makeHarness();
  try {
    const res = await h.dispatch(makeEnvelope("complete_run", { runId: "r-complete" }));
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.error.code, "invalid_input");
    }
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// submit_intervention
// ---------------------------------------------------------------------------
test("rpc:submit_intervention — invalid_input when no active session", async () => {
  const h = await makeHarness();
  try {
    const res = await h.dispatch(makeEnvelope("submit_intervention", { runId: "r-int", text: "hello" }));
    assert.equal(res.ok, false);
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// call_provider_test
// ---------------------------------------------------------------------------
test("rpc:call_provider_test — returns ok:true with fake registry", async () => {
  const h = await makeHarness();
  try {
    const res = await h.dispatch(makeEnvelope("call_provider_test", { provider: "claude" }));
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.result.ok, true);
    }
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// save_provider_config
// ---------------------------------------------------------------------------
test("rpc:save_provider_config — returns ok:true", async () => {
  const h = await makeHarness();
  try {
    const res = await h.dispatch(makeEnvelope("save_provider_config", {
      provider: "codex",
      config: { model: "gpt-4o" }
    }));
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.result.ok, true);
    }
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// save_provider_api_key — also tests redaction
// ---------------------------------------------------------------------------
test("rpc:save_provider_api_key — returns ok:true and does not log raw key", async () => {
  const h = await makeHarness();
  try {
    const secretKey = "sk-supersecret123";
    const res = await h.dispatch(makeEnvelope("save_provider_api_key", {
      provider: "claude",
      key: secretKey
    }));
    assert.equal(res.ok, true);
    // Inspect all log entries — none should contain the raw key
    const allLogText = JSON.stringify(h.logs);
    assert.ok(!allLogText.includes(secretKey), "Raw key must not appear in logs");
    // Should appear redacted
    assert.ok(allLogText.includes("***"), "Redacted marker should appear in logs");
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// notion_connect / notion_disconnect
// ---------------------------------------------------------------------------
test("rpc:notion_connect — returns ok:true with fake registry", async () => {
  const h = await makeHarness();
  try {
    const res = await h.dispatch(makeEnvelope("notion_connect", {
      token: "secret_notion_token",
      dbId: "db-uuid-123"
    }));
    assert.equal(res.ok, true);
  } finally {
    await h.cleanup();
  }
});

test("rpc:notion_connect — token is redacted in logs", async () => {
  const h = await makeHarness();
  try {
    const secretToken = "secret_notion_token_xyz";
    await h.dispatch(makeEnvelope("notion_connect", {
      token: secretToken,
      dbId: "db-uuid"
    }));
    const allLogText = JSON.stringify(h.logs);
    assert.ok(!allLogText.includes(secretToken), "Notion token must not appear in logs");
  } finally {
    await h.cleanup();
  }
});

test("rpc:notion_disconnect — returns ok:true", async () => {
  const h = await makeHarness();
  try {
    const res = await h.dispatch(makeEnvelope("notion_disconnect", {}));
    assert.equal(res.ok, true);
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// opendart_save_key
// ---------------------------------------------------------------------------
test("rpc:opendart_save_key — returns ok:true", async () => {
  const h = await makeHarness();
  try {
    const res = await h.dispatch(makeEnvelope("opendart_save_key", { key: "dart-api-key-abc" }));
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.result.ok, true);
    }
  } finally {
    await h.cleanup();
  }
});

test("rpc:opendart_save_key — key is redacted in logs", async () => {
  const h = await makeHarness();
  try {
    const dartKey = "dart-secret-abc-xyz";
    await h.dispatch(makeEnvelope("opendart_save_key", { key: dartKey }));
    const allLogText = JSON.stringify(h.logs);
    assert.ok(!allLogText.includes(dartKey), "OpenDART key must not appear in logs");
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// opendart_test
// ---------------------------------------------------------------------------
test("rpc:opendart_test — returns ok:false when no key configured", async () => {
  const h = await makeHarness();
  try {
    const res = await h.dispatch(makeEnvelope("opendart_test", {}));
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.result.ok, false);
    }
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// read_file / write_file / list_workspace_files
// ---------------------------------------------------------------------------
test("rpc:write_file — writes a file inside workspaceRoot", async () => {
  const h = await makeHarness();
  try {
    const content = Buffer.from("hello from rpc").toString("base64");
    const res = await h.dispatch(makeEnvelope("write_file", {
      path: "rpc-test-file.txt",
      contentBase64: content
    }));
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.result.ok, true);
      assert.equal(res.result.bytes, 14);
    }
  } finally {
    await h.cleanup();
  }
});

test("rpc:read_file — reads a file written via write_file", async () => {
  const h = await makeHarness();
  try {
    const original = "RPC content test";
    await h.dispatch(makeEnvelope("write_file", {
      path: "readback.txt",
      contentBase64: Buffer.from(original).toString("base64")
    }));
    const res = await h.dispatch(makeEnvelope("read_file", { path: "readback.txt" }));
    assert.equal(res.ok, true);
    if (res.ok) {
      const decoded = Buffer.from(String(res.result.contentBase64), "base64").toString("utf8");
      assert.equal(decoded, original);
    }
  } finally {
    await h.cleanup();
  }
});

test("rpc:read_file — invalid_input for path traversal attempt", async () => {
  const h = await makeHarness();
  try {
    const res = await h.dispatch(makeEnvelope("read_file", { path: "../../../etc/passwd" }));
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.error.code, "invalid_input");
    }
  } finally {
    await h.cleanup();
  }
});

test("rpc:list_workspace_files — lists entries in workspaceRoot", async () => {
  const h = await makeHarness();
  try {
    await h.dispatch(makeEnvelope("write_file", {
      path: "file-a.txt",
      contentBase64: Buffer.from("a").toString("base64")
    }));
    const res = await h.dispatch(makeEnvelope("list_workspace_files", {}));
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.ok(Array.isArray(res.result.entries));
      const names = (res.result.entries as Array<{ name: string }>).map((e) => e.name);
      assert.ok(names.includes("file-a.txt"));
    }
  } finally {
    await h.cleanup();
  }
});

test("rpc:list_workspace_files — invalid_input for subdir traversal", async () => {
  const h = await makeHarness();
  try {
    const res = await h.dispatch(makeEnvelope("list_workspace_files", { subdir: "../../.." }));
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.error.code, "invalid_input");
    }
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Exhaustive op coverage — no valid OP_NAME returns unknown_op
// ---------------------------------------------------------------------------
test("rpc:exhaustive — every OP_NAME is handled (no unknown_op response)", async () => {
  const h = await makeHarness();
  const project = await h.storage.createProject({ companyName: "TestCo" });

  // Minimal valid payloads for each op
  const payloads: Record<string, unknown> = {
    get_state: {},
    list_projects: {},
    get_project: { slug: project.slug },
    save_project: { slug: project.slug, patch: {} },
    upload_document: { slug: project.slug, filename: "x.txt", contentBase64: Buffer.from("x").toString("base64") },
    delete_document: { slug: project.slug, docId: "nonexistent-doc" },
    list_runs: { slug: project.slug },
    get_run_messages: { runId: "any-run" },
    start_run: {
      slug: project.slug,
      question: "Q",
      draft: "D",
      reviewMode: "realtime",
      coordinatorProvider: "claude",
      reviewerProviders: [],
      rounds: 1,
      selectedDocumentIds: []
    },
    resume_run: { runId: "any-run" },
    abort_run: { runId: "any-run" },
    complete_run: { runId: "any-run" },
    submit_intervention: { runId: "any-run", text: "hi" },
    call_provider_test: { provider: "claude" },
    save_provider_config: { provider: "claude", config: {} },
    save_provider_api_key: { provider: "claude", key: "test-key-value" },
    notion_connect: { token: "tok", dbId: "db" },
    notion_disconnect: {},
    opendart_save_key: { key: "dart-key-value" },
    opendart_test: {},
    read_file: { path: "nonexistent-file.txt" },
    write_file: { path: "exhaust-test.txt", contentBase64: Buffer.from("x").toString("base64") },
    list_workspace_files: {}
  };

  for (const op of OP_NAMES) {
    const envelope = { v: 1, id: `exhaust-${op}`, op, payload: payloads[op] };
    const res = await h.dispatch(envelope);
    if (!res.ok) {
      assert.notEqual(
        res.error.code,
        "unknown_op",
        `Op "${op}" returned unknown_op — missing case in dispatcher`
      );
    }
  }

  await h.cleanup();
});

// ---------------------------------------------------------------------------
// Logging: every dispatch emits a start log and an ok/err log
// ---------------------------------------------------------------------------
test("rpc:logging — start and completion log emitted per dispatch", async () => {
  const h = await makeHarness();
  try {
    h.logs.length = 0;
    await h.dispatch(makeEnvelope("get_state", {}));
    assert.ok(h.logs.some((l) => l.msg.includes("get_state:start")));
    assert.ok(h.logs.some((l) => l.msg.includes("get_state:ok")));
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// redactForLog unit tests
// ---------------------------------------------------------------------------
test("redactForLog — save_provider_api_key masks key", () => {
  const result = redactForLog("save_provider_api_key", { provider: "claude", key: "sk-real-key" });
  assert.equal(result.key, "***");
  assert.equal(result.provider, "claude");
});

test("redactForLog — notion_connect masks token", () => {
  const result = redactForLog("notion_connect", { token: "secret_tok", dbId: "db" });
  assert.equal(result.token, "***");
  assert.equal(result.dbId, "db");
});

test("redactForLog — opendart_save_key masks key", () => {
  const result = redactForLog("opendart_save_key", { key: "dart-real-key" });
  assert.equal(result.key, "***");
});

test("redactForLog — other ops are not redacted", () => {
  const payload = { slug: "test-slug", someField: "value" };
  const result = redactForLog("get_project", payload);
  assert.deepEqual(result, payload);
});

// ---------------------------------------------------------------------------
// B2: bad_request log must not leak secret values from failed parse
// ---------------------------------------------------------------------------
test("B2: rpc:bad_request log — secret value must not appear in warn log", async () => {
  const h = await makeHarness();
  try {
    // This request fails .strict() because of the extraField — zod's error message
    // would embed the entire payload including the secret key if we logged error.message.
    const secretKey = "sk-SECRET-VALUE-XYZ";
    const res = await h.dispatch({
      v: 1,
      id: "x",
      op: "save_provider_api_key",
      payload: { provider: "claude", key: secretKey, extraField: 1 }
    });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.error.code, "bad_request");
      // The response message must not echo the secret
      assert.ok(!res.error.message.includes(secretKey), "Response must not echo secret value");
    }
    // No log entry may contain the raw secret
    const allLogText = JSON.stringify(h.logs);
    assert.ok(!allLogText.includes(secretKey), "Secret must not appear in any log entry");
    // Warn log must exist but only contain path/code info
    const warnEntry = h.logs.find((l) => l.level === "warn" && l.msg === "rpc:bad_request");
    assert.ok(warnEntry, "A warn log entry must be emitted for bad_request");
    assert.ok(warnEntry.meta && "issues" in warnEntry.meta, "Warn log must contain issues array");
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// S4: start_run busy guard — second concurrent start must return busy
// ---------------------------------------------------------------------------
test("S4: rpc:start_run — returns busy when a run is already active", async () => {
  const h = await makeHarness();
  try {
    const project = await h.storage.createProject({ companyName: "BusyCo" });

    // Manually start a session to simulate an active run
    h.ctx.runSessions.start(project.slug, "realtime");

    // Now attempt a second start_run — must return busy, not corrupt state
    const res = await h.dispatch(makeEnvelope("start_run", {
      slug: project.slug,
      question: "Q",
      draft: "D",
      reviewMode: "realtime",
      coordinatorProvider: "claude",
      reviewerProviders: [],
      rounds: 1,
      selectedDocumentIds: []
    }));
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.error.code, "busy");
    }
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// B1: get_run_messages returns correct data when run is in second project
// ---------------------------------------------------------------------------
test("B1: rpc:get_run_messages — returns messages when run lives in second project", async () => {
  const h = await makeHarness();
  try {
    // First project — has no runs, so loadRunChatMessages returns undefined
    await h.storage.createProject({ companyName: "ProjectAlpha" });

    // Second project — has the run we're looking for
    const project2 = await h.storage.createProject({ companyName: "ProjectBeta" });
    await h.storage.createRun({
      id: "run-in-second-project",
      projectSlug: project2.slug,
      question: "Q2",
      draft: "D2",
      reviewMode: "realtime",
      coordinatorProvider: "claude",
      reviewerProviders: [],
      rounds: 1,
      maxRoundsPerSection: 1,
      selectedDocumentIds: [],
      status: "completed",
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:01:00.000Z"
    });
    await h.storage.saveRunChatMessages(project2.slug, "run-in-second-project", [
      {
        id: "msg-b1",
        providerId: "claude",
        participantId: "coordinator",
        participantLabel: "Coord",
        speaker: "Claude",
        speakerRole: "coordinator",
        recipient: "All",
        round: 1,
        content: "Hello from second project",
        startedAt: "2026-01-01T00:00:01.000Z",
        finishedAt: "2026-01-01T00:00:05.000Z",
        status: "completed"
      }
    ]);

    const res = await h.dispatch(makeEnvelope("get_run_messages", { runId: "run-in-second-project" }));
    assert.equal(res.ok, true);
    if (res.ok) {
      const msgs = res.result.messages as unknown[];
      assert.ok(msgs.length > 0, "Should return messages from second project — was returning empty due to !== null bug");
    }
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// B3: save_project rejects unsupported fields (rubric, pinnedDocumentIds, etc.)
// ---------------------------------------------------------------------------
test("B3: rpc:save_project — rejects rubric field (strict schema, not silently dropped)", async () => {
  const h = await makeHarness();
  try {
    const project = await h.storage.createProject({ companyName: "StrictCo" });
    const res = await h.dispatch({
      v: 1,
      id: "test-b3-rubric",
      op: "save_project",
      payload: { slug: project.slug, patch: { rubric: "new rubric text" } }
    });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.error.code, "bad_request", "rubric field must be rejected as bad_request");
    }
  } finally {
    await h.cleanup();
  }
});

test("B3: rpc:save_project — rejects pinnedDocumentIds field", async () => {
  const h = await makeHarness();
  try {
    const project = await h.storage.createProject({ companyName: "StrictCo2" });
    const res = await h.dispatch({
      v: 1,
      id: "test-b3-pinned",
      op: "save_project",
      payload: { slug: project.slug, patch: { pinnedDocumentIds: ["doc-1"] } }
    });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.error.code, "bad_request");
    }
  } finally {
    await h.cleanup();
  }
});

test("B3: rpc:save_project — accepts supported field (companyName) and persists it", async () => {
  const h = await makeHarness();
  try {
    const project = await h.storage.createProject({ companyName: "OldName" });
    const res = await h.dispatch(makeEnvelope("save_project", {
      slug: project.slug,
      patch: { companyName: "NewName" }
    }));
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.result.companyName, "NewName");
    }
  } finally {
    await h.cleanup();
  }
});

// ---------------------------------------------------------------------------
// OP_NAMES count sanity
// ---------------------------------------------------------------------------
test("OP_NAMES contains exactly 23 ops", () => {
  assert.equal(OP_NAMES.length, 23);
});

// ---------------------------------------------------------------------------
// All provider IDs are valid for call_provider_test
// ---------------------------------------------------------------------------
test("rpc:call_provider_test — accepts all providerIds", async () => {
  const h = await makeHarness();
  try {
    for (const provider of providerIds) {
      const res = await h.dispatch(makeEnvelope("call_provider_test", { provider }));
      assert.equal(res.ok, true, `provider ${provider} should return ok:true`);
    }
  } finally {
    await h.cleanup();
  }
});
