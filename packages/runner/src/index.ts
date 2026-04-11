import { resolveNodeRuntime, redactSecrets } from "@jasojeon/shared";
import { createRunnerContext } from "./runnerContext";
import { loadDeviceToken, saveDeviceToken } from "./hosted/deviceTokenStore";
import { startHostedOutboundClient } from "./hosted/outboundClient";
import { autoClaimDevice } from "./hosted/pairingClient";
import { createRpcDispatcher } from "./hosted/rpcDispatcher";
import { startEventForwarding } from "./hosted/eventForwarder";

async function main(): Promise<void> {
  try {
    resolveNodeRuntime();
  } catch (error) {
    process.stderr.write(`[runner] Failed to resolve Node runtime: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }

  await mainHosted();
}

async function mainHosted(): Promise<void> {
  const backendUrl = process.env["JASOJEON_BACKEND_URL"];
  if (!backendUrl) {
    process.stderr.write(
      "[runner] JASOJEON_BACKEND_URL is not set. Set it to the backend base URL and try again.\n"
    );
    process.exit(1);
  }

  let deviceToken = await loadDeviceToken();

  if (!deviceToken) {
    console.log("[runner] No device token found — starting auto-claim flow.");
    let result: Awaited<ReturnType<typeof autoClaimDevice>>;
    try {
      result = await autoClaimDevice({ backendUrl });
    } catch (err) {
      process.stderr.write(
        `[runner] Auto-claim failed: ${err instanceof Error ? err.message : String(err)}\n`
      );
      process.exit(1);
    }
    await saveDeviceToken(result.token);
    console.log(`[runner] Device paired! Device ID: ${result.deviceId}`);
    deviceToken = result.token;
  }

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
