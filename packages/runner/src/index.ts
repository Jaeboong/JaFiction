import { redactSecrets } from "@jasojeon/shared";
import { createRunnerContext, fetchAndCacheDartApiKey } from "./runnerContext";
import {
  clearDeviceToken,
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
import { getOrCreateRunnerInstanceId } from "./hosted/runnerInstanceId";
import { acquireInstanceLock } from "./hosted/instanceLock";
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

export async function main(): Promise<void> {
  const backendUrls = parseBackendUrls();
  if (backendUrls.length === 0) {
    process.stderr.write(
      "[runner] JASOJEON_BACKEND_URL (or JASOJEON_BACKEND_URLS) is not set. Set it to the backend base URL and try again.\n"
    );
    process.exit(1);
  }

  // Load or create the stable runner instance ID before taking the lock
  // so a disk error here doesn't leave an uncleaned lock behind.
  const runnerInstanceId = await getOrCreateRunnerInstanceId();

  // Acquire single-instance lock (last-wins). Returns a cleanup function.
  const releaseLock = await acquireInstanceLock();

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
      connectToBackend({ backendUrl: url, ctx, logger, runnerInstanceId }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[runner][${url}] Skipping backend: ${msg}\n`);
        return null;
      })
    )
  );

  const clients = results.filter((c): c is OutboundClientHandle => c !== null);
  if (clients.length === 0) {
    await releaseLock();
    process.stderr.write("[runner] No backends could be connected. Exiting.\n");
    process.exit(1);
  }

  const shutdown = (signal: "SIGINT" | "SIGTERM") => {
    console.log(`[runner] ${signal} received — shutting down`);
    void Promise.all([
      releaseLock(),
      ...clients.map((client) => client.close()),
      ctx.jobPostingFetcher?.close?.() ?? Promise.resolve()
    ]).then(() => process.exit(0));
  };

  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
}

async function pairAndPersist(opts: {
  backendUrl: string;
  logger: Logger;
  forceReclaim?: boolean;
  runnerInstanceId?: string;
}): Promise<{ deviceToken: string; deviceId: string }> {
  const { backendUrl, logger, forceReclaim, runnerInstanceId } = opts;

  let deviceToken = forceReclaim ? undefined : await loadDeviceToken(backendUrl);
  let deviceId = forceReclaim ? undefined : await loadDeviceId(backendUrl);

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
    claim = await registerClaim({ backendUrl, deviceId, runnerInstanceId });
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

  return { deviceToken, deviceId: deviceId ?? "" };
}

function startInnerClient(opts: {
  backendUrl: string;
  deviceToken: string;
  ctx: RunnerContext;
  logger: Logger;
  onAuthFailure: (reason: string) => void;
}): { inner: OutboundClientHandle; dispose: () => void } {
  const { backendUrl, deviceToken, ctx, logger, onAuthFailure } = opts;
  const hostedCtx: RunnerContext = { ...ctx, backendUrl, deviceToken };
  const dispatcher = createRpcDispatcher({ runnerContext: hostedCtx, logger });
  const inner = startHostedOutboundClient({
    backendUrl,
    deviceToken,
    runnerContext: hostedCtx,
    onRpc: dispatcher,
    onAuthFailure,
    logger,
  });
  const disposeForwarding = startEventForwarding(inner, hostedCtx);
  return { inner, dispose: () => { disposeForwarding(); } };
}

async function connectToBackend(opts: {
  backendUrl: string;
  ctx: RunnerContext;
  logger: Logger;
  runnerInstanceId?: string;
}): Promise<OutboundClientHandle> {
  const { backendUrl, ctx, logger, runnerInstanceId } = opts;

  let selfHealAttempted = false;
  let permanentlyClosed = false;

  const initialPair = await pairAndPersist({ backendUrl, logger, forceReclaim: false, runnerInstanceId });

  // backend 에서 DART_API_KEY fetch (실패해도 runner 는 정상 부팅)
  await fetchAndCacheDartApiKey(backendUrl, initialPair.deviceToken).catch((err: unknown) => {
    process.stderr.write(
      `[runner][${backendUrl}] DART_API_KEY fetch failed: ${err instanceof Error ? err.message : String(err)}\n`
    );
  });

  const onAuthFailure = (reason: string): void => {
    void handleSelfHeal(reason);
  };

  async function handleSelfHeal(reason: string): Promise<void> {
    if (permanentlyClosed) return;
    if (selfHealAttempted) {
      logger.error(`[runner][${backendUrl}] self-heal failed twice (reason=${reason}) — giving up on this backend`);
      permanentlyClosed = true;
      currentDispose();
      return;
    }
    selfHealAttempted = true;
    logger.warn(`[runner][${backendUrl}] device token revoked — clearing and re-pairing`);
    await clearDeviceToken(backendUrl);
    currentDispose();
    await currentInner.close().catch(() => {});
    let repaired: { deviceToken: string; deviceId: string };
    try {
      repaired = await pairAndPersist({ backendUrl, logger, forceReclaim: true, runnerInstanceId });
    } catch (err) {
      logger.error(`[runner][${backendUrl}] re-pairing failed`, { error: String(err) });
      permanentlyClosed = true;
      return;
    }
    await fetchAndCacheDartApiKey(backendUrl, repaired.deviceToken).catch(() => {});
    const next = startInnerClient({ backendUrl, deviceToken: repaired.deviceToken, ctx, logger, onAuthFailure });
    currentInner = next.inner;
    currentDispose = next.dispose;
    logger.info(`[runner][${backendUrl}] self-heal complete — new outbound client started`);
  }

  const first = startInnerClient({ backendUrl, deviceToken: initialPair.deviceToken, ctx, logger, onAuthFailure });
  let currentInner: OutboundClientHandle = first.inner;
  let currentDispose: () => void = first.dispose;

  console.log(`[runner] hosted mode — connecting to ${backendUrl}`);

  const wrapper: OutboundClientHandle = {
    close: async () => {
      permanentlyClosed = true;
      currentDispose();
      await currentInner.close();
    },
    isConnected: () => currentInner.isConnected(),
    sendEvent: (env) => currentInner.sendEvent(env),
  };
  return wrapper;
}

if (require.main === module) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
