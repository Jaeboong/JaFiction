import * as assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import type { AddressInfo } from "node:net";
import { RunSessionManager } from "@jafiction/shared";
import WebSocket from "ws";
import { createRunnerServer } from "../index";
import type { RunnerContext } from "../runnerContext";
import { createSessionAuth, resolveTrustedOrigins, runnerSessionCookieName } from "../security/sessionAuth";

test("trusted origins include runner and official dev-web loopback origins", () => {
  const trustedOrigins = resolveTrustedOrigins({ runnerPort: 4123, devWebPort: 4124 });

  assert.ok(trustedOrigins.includes("http://127.0.0.1:4123"));
  assert.ok(trustedOrigins.includes("http://localhost:4123"));
  assert.ok(trustedOrigins.includes("http://127.0.0.1:4124"));
});

test("trusted local origin can bootstrap a cookie-backed session without leaking a bearer token", async (t) => {
  const harness = await startHarness();
  t.after(() => harness.close());

  const response = await fetch(`${harness.baseUrl}/api/session`, {
    headers: {
      Origin: "http://127.0.0.1:4124"
    }
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:4124");
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");

  const payload = await response.json() as { token?: string; state: { extensionVersion: string }; storageRoot: string };
  assert.equal(payload.token, undefined);
  assert.equal(payload.state.extensionVersion, "test-version");
  assert.equal(payload.storageRoot, "/tmp/jafiction-storage");

  const setCookie = response.headers.get("set-cookie");
  assert.match(setCookie ?? "", new RegExp(`${runnerSessionCookieName}=`));
  assert.match(setCookie ?? "", /HttpOnly/);
  assert.match(setCookie ?? "", /SameSite=Strict/);
});

test("arbitrary origins cannot bootstrap or reuse a runner session", async (t) => {
  const harness = await startHarness();
  t.after(() => harness.close());

  const bootstrapResponse = await fetch(`${harness.baseUrl}/api/session`, {
    headers: {
      Origin: "http://evil.example"
    }
  });
  assert.equal(bootstrapResponse.status, 403);

  const sessionResponse = await fetch(`${harness.baseUrl}/api/session`, {
    headers: {
      Origin: "http://127.0.0.1:4124"
    }
  });
  const cookie = requireCookie(sessionResponse);

  const stateResponse = await fetch(`${harness.baseUrl}/api/state`, {
    headers: {
      Origin: "http://evil.example",
      Cookie: cookie
    }
  });
  assert.equal(stateResponse.status, 403);
});

test("authenticated api requests require the bootstrap cookie", async (t) => {
  const harness = await startHarness();
  t.after(() => harness.close());

  const missingCookieResponse = await fetch(`${harness.baseUrl}/api/state`, {
    headers: {
      Origin: "http://127.0.0.1:4124"
    }
  });
  assert.equal(missingCookieResponse.status, 401);

  const bootstrapResponse = await fetch(`${harness.baseUrl}/api/session`, {
    headers: {
      Origin: "http://127.0.0.1:4124"
    }
  });
  const cookie = requireCookie(bootstrapResponse);

  const stateResponse = await fetch(`${harness.baseUrl}/api/state`, {
    headers: {
      Origin: "http://127.0.0.1:4124",
      Cookie: cookie
    }
  });
  assert.equal(stateResponse.status, 200);
});

test("websocket upgrades fail when origin or cookie validation fails", async (t) => {
  const harness = await startHarness();
  t.after(() => harness.close());

  const bootstrapResponse = await fetch(`${harness.baseUrl}/api/session`, {
    headers: {
      Origin: "http://127.0.0.1:4124"
    }
  });
  const cookie = requireCookie(bootstrapResponse);

  const badOriginError = await connectWebSocketExpectingFailure(`${harness.wsBaseUrl}/ws/state`, {
    cookie,
    origin: "http://evil.example"
  });
  assert.match(badOriginError.message, /unexpected server response: 403/i);

  const missingCookieError = await connectWebSocketExpectingFailure(`${harness.wsBaseUrl}/ws/state`, {
    origin: "http://127.0.0.1:4124"
  });
  assert.match(missingCookieError.message, /unexpected server response: 401/i);

  const { message, socket } = await connectWebSocketAndReadFirstMessage(`${harness.wsBaseUrl}/ws/state`, {
    cookie,
    origin: "http://127.0.0.1:4124"
  });
  assert.match(message, /test-version/);
  socket.terminate();
});

test("same-origin style requests without Origin can still authenticate via the session cookie", async () => {
  const auth = createSessionAuth({
    sessionToken: "session-token",
    runnerPort: 4123,
    devWebPort: 4124
  });

  assert.deepEqual(
    auth.authorizeAuthenticatedRequest({
      headers: {
        cookie: `${runnerSessionCookieName}=session-token`,
        "sec-fetch-site": "same-origin"
      }
    }),
    { ok: true }
  );
});

async function startHarness(): Promise<{
  baseUrl: string;
  close(): Promise<void>;
  wsBaseUrl: string;
}> {
  const ctx = createTestContext();
  const { close, server } = await createRunnerServer(ctx);

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const wsBaseUrl = `ws://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    wsBaseUrl,
    close
  };
}

function createTestContext(): RunnerContext {
  const runSessions = new RunSessionManager();
  const snapshot = {
    workspaceOpened: true,
    extensionVersion: "test-version",
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

  return {
    workspaceRoot: "/tmp/jafiction-workspace",
    storageRoot: "/tmp/jafiction-storage",
    stateStore: {
      setRunState: () => undefined,
      refreshProjects: async () => undefined,
      refreshPreferences: async () => undefined
    } as unknown as RunnerContext["stateStore"],
    runSessions,
    sessionToken: "test-session-token",
    storage: () => missingDependency("storage"),
    registry: () => missingDependency("registry"),
    orchestrator: () => missingDependency("orchestrator"),
    config: () => ({
      getPort: async () => 4123
    }) as RunnerContext["config"] extends () => infer TResult ? TResult : never,
    secrets: () => missingDependency("secrets"),
    snapshot: () => snapshot as RunnerContext["snapshot"] extends () => infer TResult ? TResult : never,
    pushState: async () => undefined,
    emitRunEvent: () => undefined,
    clearRunBuffer: () => undefined,
    addStateSocket: () => undefined,
    addRunSocket: () => undefined,
    runBusy: async (_message: string, work: () => Promise<void>) => {
      await work();
    },
    refreshAll: async () => undefined
  } as unknown as RunnerContext;
}

function missingDependency(name: string): never {
  throw new Error(`${name} should not be used in this test.`);
}

function requireCookie(response: Response): string {
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  return cookie.split(";")[0];
}

async function connectWebSocketAndReadFirstMessage(
  url: string,
  options: {
    cookie?: string;
    origin: string;
  }
): Promise<{ message: string; socket: WebSocket }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, {
      headers: options.cookie ? { Cookie: options.cookie } : undefined,
      origin: options.origin
    });

    socket.once("message", (message) => {
      resolve({
        message: message.toString(),
        socket
      });
    });
    socket.once("error", (error) => {
      socket.terminate();
      reject(error);
    });
    socket.once("unexpected-response", (_request, response) => {
      socket.terminate();
      reject(new Error(`Unexpected server response: ${response.statusCode}`));
    });
  });
}

async function connectWebSocketExpectingFailure(
  url: string,
  options: {
    cookie?: string;
    origin: string;
  }
): Promise<Error> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, {
      headers: options.cookie ? { Cookie: options.cookie } : undefined,
      origin: options.origin
    });

    socket.once("open", () => {
      socket.terminate();
      reject(new Error("Expected websocket connection to fail."));
    });
    socket.once("error", (error) => {
      socket.terminate();
      resolve(error);
    });
    socket.once("unexpected-response", (_request, response) => {
      socket.terminate();
      resolve(new Error(`Unexpected server response: ${response.statusCode}`));
    });
  });
}
