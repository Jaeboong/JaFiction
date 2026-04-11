import * as fs from "node:fs/promises";
import * as path from "node:path";
import http from "node:http";
import cors from "cors";
import express from "express";
import { WebSocketServer } from "ws";
import { resolveNodeRuntime, redactSecrets } from "@jafiction/shared";
import { createRunnerContext, type RunnerContext } from "./runnerContext";
import { createInsightsRouter } from "./routes/insightsRouter";
import { createConfigRouter } from "./routes/configRouter";
import { createOpenDartRouter } from "./routes/openDartRouter";
import { createProfileRouter } from "./routes/profileRouter";
import { createProjectsRouter } from "./routes/projectsRouter";
import { createProvidersRouter } from "./routes/providersRouter";
import { createRunInterventionRouter, createRunsRouter } from "./routes/runsRouter";
import { createSessionAuth } from "./security/sessionAuth";
import { loadDeviceToken, saveDeviceToken } from "./hosted/deviceTokenStore";
import { startHostedOutboundClient } from "./hosted/outboundClient";
import { claimPairingCode } from "./hosted/pairingClient";
import { createRpcDispatcher } from "./hosted/rpcDispatcher";
import { startEventForwarding } from "./hosted/eventForwarder";

export async function createRunnerServer(ctx: RunnerContext): Promise<{
  app: express.Express;
  close(): Promise<void>;
  server: http.Server;
  port: number;
}> {
  const port = await ctx.config().getPort();
  const sessionAuth = createSessionAuth({
    sessionToken: ctx.sessionToken,
    runnerPort: port
  });
  const app = express();
  const server = http.createServer(app);
  const stateWss = new WebSocketServer({ noServer: true });
  const runWss = new WebSocketServer({ noServer: true });

  stateWss.on("connection", (socket) => {
    (ctx as unknown as { addStateSocket(socket: import("ws").WebSocket): void }).addStateSocket(socket);
    socket.send(JSON.stringify(ctx.snapshot()));
  });

  runWss.on("connection", (socket, request) => {
    const runId = request.url?.split("/").at(-1)?.split("?")[0];
    if (!runId) {
      socket.close();
      return;
    }
    (ctx as unknown as { addRunSocket(runId: string, socket: import("ws").WebSocket): void }).addRunSocket(runId, socket);
  });

  server.on("upgrade", (request, socket, head) => {
    try {
      const authResult = sessionAuth.authorizeAuthenticatedRequest(request);
      if (!authResult.ok) {
        socket.write(`HTTP/1.1 ${authResult.status} ${statusText(authResult.status)}\r\nConnection: close\r\n\r\n`);
        socket.destroy();
        return;
      }

      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname === "/ws/state") {
        stateWss.handleUpgrade(request, socket, head, (ws) => stateWss.emit("connection", ws, request));
        return;
      }

      if (url.pathname.startsWith("/ws/runs/")) {
        runWss.handleUpgrade(request, socket, head, (ws) => runWss.emit("connection", ws, request));
        return;
      }

      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
    } catch {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      socket.destroy();
    }
  });

  app.use(cors({
    origin(origin, callback) {
      if (!origin || sessionAuth.isTrustedOrigin(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true
  }));
  app.use(express.json({ limit: "20mb" }));
  app.use(express.urlencoded({ extended: true }));

  app.get("/api/session", (request, response) => {
    const authResult = sessionAuth.authorizeSessionBootstrap(request);
    if (!authResult.ok) {
      response.status(authResult.status ?? 403).json({
        error: authResult.error ?? "forbidden_origin",
        message: authResult.message ?? "Runner requests must originate from an approved local JaFiction UI."
      });
      return;
    }

    response.append("Set-Cookie", sessionAuth.sessionCookie());
    response.json({
      state: ctx.snapshot(),
      storageRoot: ctx.storageRoot
    });
  });

  app.use("/api", (request, response, next) => {
    if (request.path === "/session") {
      next();
      return;
    }

    const authResult = sessionAuth.authorizeAuthenticatedRequest(request);
    if (!authResult.ok) {
      response.status(authResult.status ?? 401).json({
        error: authResult.error ?? "unauthorized",
        message: authResult.message ?? "Authenticate with /api/session before calling the runner."
      });
      return;
    }
    next();
  });

  app.get("/api/status", (_request, response) => {
    response.json({
      ok: true,
      runState: ctx.runSessions.snapshot(),
      storageRoot: ctx.storageRoot
    });
  });

  app.get("/api/state", (_request, response) => {
    response.json(ctx.snapshot());
  });

  app.use("/api/providers", createProvidersRouter(ctx));
  app.use("/api/config", createConfigRouter(ctx));
  app.use("/api/profile", createProfileRouter(ctx));
  app.use("/api/projects", createProjectsRouter(ctx));
  app.use("/api/projects/:projectSlug/insights", createInsightsRouter(ctx));
  app.use("/api/projects/:projectSlug/runs", createRunsRouter(ctx));
  app.use("/api/opendart", createOpenDartRouter(ctx));
  app.use("/api/runs", createRunInterventionRouter(ctx));

  const webDist = path.resolve(__dirname, "../../web/dist");
  if (await exists(webDist)) {
    app.use(express.static(webDist));
    app.get("*", async (_request, response, next) => {
      try {
        response.sendFile(path.join(webDist, "index.html"));
      } catch (error) {
        next(error);
      }
    });
  }

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : String(error);
    response.status(500).json({ error: "internal_error", message });
  });

  return {
    app,
    close: async () => {
      for (const client of stateWss.clients) {
        client.terminate();
      }
      for (const client of runWss.clients) {
        client.terminate();
      }

      await Promise.all([
        new Promise<void>((resolve) => stateWss.close(() => resolve())),
        new Promise<void>((resolve) => runWss.close(() => resolve()))
      ]);

      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
    server,
    port
  };
}

async function main(): Promise<void> {
  // Resolve once at boot so getNodeRuntime() is always safe later.
  // Exits immediately on failure — a broken Node runtime makes the runner inoperable.
  try {
    resolveNodeRuntime();
  } catch (error) {
    process.stderr.write(`[runner] Failed to resolve Node runtime: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }

  const mode = process.env["JAFICTION_MODE"] ?? "local";

  if (mode === "pair") {
    await mainPair();
  } else if (mode === "hosted") {
    await mainHosted();
  } else {
    await mainLocal();
  }
}

async function mainLocal(): Promise<void> {
  const ctx = await createRunnerContext();
  const { server, port } = await createRunnerServer(ctx);
  server.listen(port, () => {
    console.log(`JaFiction runner listening on http://localhost:${port}`);
  });
}

async function mainPair(): Promise<void> {
  const backendUrl = process.env["JAFICTION_BACKEND_URL"];
  const pairingCode = process.env["JAFICTION_PAIRING_CODE"];

  if (!backendUrl || !pairingCode) {
    process.stderr.write(
      [
        "[runner] Pairing mode requires both environment variables to be set:",
        "  JAFICTION_BACKEND_URL  — e.g. https://yourbackend.example.com",
        "  JAFICTION_PAIRING_CODE — the 8-character code shown in the web UI",
        "",
        "Example:",
        "  JAFICTION_MODE=pair \\",
        "  JAFICTION_BACKEND_URL=https://yourbackend.example.com \\",
        "  JAFICTION_PAIRING_CODE=ABCD1234 \\",
        "  ./scripts/with-npm.sh run -w packages/runner start",
      ].join("\n") + "\n"
    );
    process.exit(1);
  }

  let result: Awaited<ReturnType<typeof claimPairingCode>>;
  try {
    result = await claimPairingCode({ backendUrl, code: pairingCode });
  } catch (err) {
    process.stderr.write(
      `[runner] Pairing failed: ${err instanceof Error ? err.message : String(err)}\n`
    );
    process.exit(1);
  }

  await saveDeviceToken(result.token);
  console.log(`[runner] Device paired successfully!`);
  console.log(`[runner]   Device ID : ${result.deviceId}`);
  console.log(`[runner]   User ID   : ${result.userId}`);
  console.log(`[runner] Token saved. You can now run the runner with JAFICTION_MODE=hosted.`);
}

async function mainHosted(): Promise<void> {
  const backendUrl = process.env["JAFICTION_BACKEND_URL"];
  if (!backendUrl) {
    process.stderr.write(
      "[runner] JAFICTION_BACKEND_URL is not set. Set it to the backend WSS base URL and try again.\n"
    );
    process.exit(1);
  }

  const deviceToken = await loadDeviceToken();
  if (!deviceToken) {
    process.stderr.write(
      "[runner] No device token found. Run the pairing flow (Phase 5) to register this runner with the backend.\n"
    );
    process.exit(1);
  }

  // Phase 9: all hosted-mode logs funnel through redactSecrets to scrub any
  // accidental API keys / bearer tokens / device tokens that land in meta.
  const safeMeta = (meta?: Record<string, unknown>): unknown =>
    meta === undefined ? "" : redactSecrets(meta);
  const logger = {
    info: (msg: string, meta?: Record<string, unknown>) => console.log(redactSecrets(msg), safeMeta(meta)),
    warn: (msg: string, meta?: Record<string, unknown>) => console.warn(redactSecrets(msg), safeMeta(meta)),
    error: (msg: string, meta?: Record<string, unknown>) => console.error(redactSecrets(msg), safeMeta(meta))
  };

  const ctx = await createRunnerContext();

  const dispatcher = createRpcDispatcher({ runnerContext: ctx, logger });

  const client = startHostedOutboundClient({
    backendUrl,
    deviceToken,
    runnerContext: ctx,
    onRpc: dispatcher,
    logger
  });

  const disposeForwarding = startEventForwarding(client, ctx);

  console.log(`[runner] hosted mode — connecting to ${backendUrl}`);

  process.on("SIGINT", () => {
    console.log("[runner] SIGINT received — shutting down");
    disposeForwarding();
    void client.close().then(() => process.exit(0));
  });
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function statusText(status?: number): string {
  if (status === 401) {
    return "Unauthorized";
  }
  if (status === 403) {
    return "Forbidden";
  }
  return "Error";
}

