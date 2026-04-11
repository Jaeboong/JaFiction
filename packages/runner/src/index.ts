import { resolveNodeRuntime, redactSecrets } from "@jasojeon/shared";
import { createRunnerContext } from "./runnerContext";
import {
  loadDeviceId,
  loadDeviceToken,
  saveDeviceId,
  saveDeviceToken,
} from "./hosted/deviceTokenStore";
import { startHostedOutboundClient } from "./hosted/outboundClient";
import type { OutboundClientHandle } from "./hosted/outboundClient";
import {
  pollClaim,
  pollClaimNonBlocking,
  registerClaim,
  resolveDeviceId,
} from "./hosted/pairingClient";
import { createRpcDispatcher } from "./hosted/rpcDispatcher";
import { startEventForwarding } from "./hosted/eventForwarder";
import type { RunnerContext } from "./runnerContext";
import type { Logger } from "./hosted/outboundClient";

function parseBackendUrls(): string[] {
  const multi = process.env["JASOJEON_BACKEND_URLS"];
  if (multi) {
    return multi.split(",").map((u) => u.trim()).filter(Boolean);
  }
  const single = process.env["JASOJEON_BACKEND_URL"];
  if (single) {
    return [single];
  }
  return [];
}

async function main(): Promise<void> {
  try {
    resolveNodeRuntime();
  } catch (error) {
    process.stderr.write(`[runner] Failed to resolve Node runtime: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }

  const backendUrls = parseBackendUrls();
  if (backendUrls.length === 0) {
    process.stderr.write(
      "[runner] JASOJEON_BACKEND_URL (or JASOJEON_BACKEND_URLS) is not set. Set it to the backend base URL and try again.\n"
    );
    process.exit(1);
  }

  const safeMeta = (meta?: Record<string, unknown>): unknown =>
    meta === undefined ? "" : redactSecrets(meta);
  const logger: Logger = {
    info: (msg: string, meta?: Record<string, unknown>) => console.log(redactSecrets(msg), safeMeta(meta)),
    warn: (msg: string, meta?: Record<string, unknown>) => console.warn(redactSecrets(msg), safeMeta(meta)),
    error: (msg: string, meta?: Record<string, unknown>) => console.error(redactSecrets(msg), safeMeta(meta))
  };

  const ctx = await createRunnerContext();

  // 각 백엔드별 페어링 + 연결을 병렬로 시작.
  // 한 백엔드가 오프라인이거나 페어링 실패해도 다른 백엔드 연결은 계속 진행.
  const results = await Promise.all(
    backendUrls.map((url) =>
      connectToBackend({ backendUrl: url, ctx, logger }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[runner][${url}] Skipping backend: ${msg}\n`);
        return null;
      })
    )
  );

  const clients = results.filter((c): c is OutboundClientHandle => c !== null);
  if (clients.length === 0) {
    process.stderr.write("[runner] No backends could be connected. Exiting.\n");
    process.exit(1);
  }

  process.on("SIGINT", () => {
    console.log("[runner] SIGINT received — shutting down");
    void Promise.all(clients.map((c) => c.close())).then(() => process.exit(0));
  });
}

async function connectToBackend(opts: {
  backendUrl: string;
  ctx: RunnerContext;
  logger: Logger;
}): Promise<OutboundClientHandle> {
  const { backendUrl, ctx, logger } = opts;

  let deviceToken = await loadDeviceToken(backendUrl);
  let deviceId = await loadDeviceId(backendUrl);

  if (deviceToken && !deviceId) {
    try {
      deviceId = await resolveDeviceId({ backendUrl, deviceToken });
      if (deviceId) {
        await saveDeviceId(backendUrl, deviceId);
      }
    } catch (err) {
      process.stderr.write(
        `[runner][${backendUrl}] Failed to resolve existing device ID: ${err instanceof Error ? err.message : String(err)}\n`
      );
    }
  }

  let claim: Awaited<ReturnType<typeof registerClaim>> | undefined;

  try {
    claim = await registerClaim({ backendUrl, deviceId });
  } catch (err) {
    if (!deviceToken) {
      throw new Error(`Auto-claim failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    process.stderr.write(
      `[runner][${backendUrl}] Device claim registration skipped: ${err instanceof Error ? err.message : String(err)}\n`
    );
  }

  if (!deviceToken) {
    console.log(`[runner][${backendUrl}] No device token found — starting auto-claim flow.`);
    if (!claim) {
      throw new Error("Auto-claim failed: missing claim registration");
    }
    console.log(`[runner][${backendUrl}] Waiting for approval (claim ${claim.claimId.slice(0, 8)}...)`);
    console.log(`[runner][${backendUrl}] Open the web UI, log in, and click Connect.`);
    let result: Awaited<ReturnType<typeof pollClaim>>;
    try {
      result = await pollClaim({
        backendUrl,
        claimId: claim.claimId,
        pollToken: claim.pollToken,
      });
    } catch (err) {
      throw new Error(`Auto-claim failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (result.status !== "approved") {
      throw new Error("Auto-claim failed: unexpected authorization response");
    }
    await saveDeviceToken(backendUrl, result.token);
    await saveDeviceId(backendUrl, result.deviceId);
    console.log(`[runner][${backendUrl}] Device paired! Device ID: ${result.deviceId}`);
    deviceToken = result.token;
    deviceId = result.deviceId;
  } else if (claim) {
    void pollClaimNonBlocking({
      backendUrl,
      claimId: claim.claimId,
      pollToken: claim.pollToken,
    }).then(async (result) => {
      if (result.status === "authorized" && result.deviceId !== deviceId) {
        await saveDeviceId(backendUrl, result.deviceId);
      }
    }).catch(() => {});
  }

  const dispatcher = createRpcDispatcher({ runnerContext: ctx, logger });

  const client = startHostedOutboundClient({
    backendUrl,
    deviceToken,
    runnerContext: ctx,
    onRpc: dispatcher,
    logger,
  });

  const disposeForwarding = startEventForwarding(client, ctx);

  console.log(`[runner] hosted mode — connecting to ${backendUrl}`);

  // close() 호출 시 이벤트 포워딩도 함께 정리.
  const originalClose = client.close.bind(client);
  client.close = () => {
    disposeForwarding();
    return originalClose();
  };

  return client;
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
