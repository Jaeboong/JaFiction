import { resolveNodeRuntime, redactSecrets } from "@jasojeon/shared";
import { createRunnerContext } from "./runnerContext";
import { loadDeviceToken, saveDeviceToken } from "./hosted/deviceTokenStore";
import { startHostedOutboundClient } from "./hosted/outboundClient";
import { claimPairingCode } from "./hosted/pairingClient";
import { createRpcDispatcher } from "./hosted/rpcDispatcher";
import { startEventForwarding } from "./hosted/eventForwarder";

async function main(): Promise<void> {
  // Resolve once at boot so getNodeRuntime() is always safe later.
  // Exits immediately on failure — a broken Node runtime makes the runner inoperable.
  try {
    resolveNodeRuntime();
  } catch (error) {
    process.stderr.write(`[runner] Failed to resolve Node runtime: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }

  const mode = process.env["JASOJEON_MODE"] ?? "hosted";

  if (mode === "pair") {
    await mainPair();
    return;
  }

  await mainHosted();
}

async function mainPair(): Promise<void> {
  const backendUrl = process.env["JASOJEON_BACKEND_URL"];
  const pairingCode = process.env["JASOJEON_PAIRING_CODE"];

  if (!backendUrl || !pairingCode) {
    process.stderr.write(
      [
        "[runner] Pairing mode requires both environment variables to be set:",
        "  JASOJEON_BACKEND_URL  — e.g. https://yourbackend.example.com",
        "  JASOJEON_PAIRING_CODE — the 8-character code shown in the web UI",
        "",
        "Example:",
        "  JASOJEON_MODE=pair \\",
        "  JASOJEON_BACKEND_URL=https://yourbackend.example.com \\",
        "  JASOJEON_PAIRING_CODE=ABCD1234 \\",
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
  console.log(`[runner] Token saved. You can now run the runner with JASOJEON_MODE=hosted.`);
}

async function mainHosted(): Promise<void> {
  const backendUrl = process.env["JASOJEON_BACKEND_URL"];
  if (!backendUrl) {
    process.stderr.write(
      "[runner] JASOJEON_BACKEND_URL is not set. Set it to the backend WSS base URL and try again.\n"
    );
    process.exit(1);
  }

  const deviceToken = await loadDeviceToken();
  if (!deviceToken) {
    process.stderr.write(
      "[runner] No device token found. Run the pairing flow (JASOJEON_MODE=pair) to register this runner with the backend.\n"
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
