import { main } from "./index";

// build.ts --local 플래그로 빌드 시 --define으로 주입됨. 기본값은 prod URL.
const DEFAULT_BACKEND_URL =
  (typeof process.env["JASOJEON_DEFAULT_BACKEND_URL"] === "string" && process.env["JASOJEON_DEFAULT_BACKEND_URL"])
    ? process.env["JASOJEON_DEFAULT_BACKEND_URL"]
    : "https://xn--9l4b13i8j.com";

const subcommand = process.argv[2] ?? "start";

async function runStart(): Promise<void> {
  if (!process.env["JASOJEON_BACKEND_URL"] && !process.env["JASOJEON_BACKEND_URLS"]) {
    process.env["JASOJEON_BACKEND_URL"] = DEFAULT_BACKEND_URL;
  }
  await main();
}

async function runInstall(): Promise<void> {
  const exePath = process.execPath;
  const platform = process.platform;

  if (platform === "win32") {
    const { installWindowsService } = await import("./service/windows");
    await installWindowsService(exePath);
  } else if (platform === "darwin") {
    const { installMacService } = await import("./service/mac");
    await installMacService(exePath);
  } else {
    const { installLinuxService } = await import("./service/linux");
    await installLinuxService(exePath);
  }

  process.stdout.write(
    "[jasojeon-runner] Service installed and started in the background.\n" +
    "[jasojeon-runner] Open the web UI to connect your device.\n"
  );
}

async function runUninstall(): Promise<void> {
  const platform = process.platform;

  if (platform === "win32") {
    const { uninstallWindowsService } = await import("./service/windows");
    await uninstallWindowsService();
  } else if (platform === "darwin") {
    const { uninstallMacService } = await import("./service/mac");
    await uninstallMacService();
  } else {
    const { uninstallLinuxService } = await import("./service/linux");
    await uninstallLinuxService();
  }

  process.stdout.write("[jasojeon-runner] Service uninstalled.\n");
}

function runStatus(): void {
  const platform = process.platform;
  const backendUrl =
    process.env["JASOJEON_BACKEND_URL"] ??
    process.env["JASOJEON_BACKEND_URLS"] ??
    DEFAULT_BACKEND_URL;

  process.stdout.write(`[jasojeon-runner] Platform: ${platform}\n`);
  process.stdout.write(`[jasojeon-runner] Backend URL: ${backendUrl}\n`);
  process.stdout.write(`[jasojeon-runner] Executable: ${process.execPath}\n`);
}

async function dispatch(): Promise<void> {
  switch (subcommand) {
    case "start":
      await runStart();
      break;
    case "install":
      await runInstall();
      break;
    case "uninstall":
      await runUninstall();
      break;
    case "status":
      runStatus();
      break;
    default:
      process.stderr.write(`[jasojeon-runner] Unknown subcommand: ${subcommand}\n`);
      process.stderr.write("Usage: jasojeon-runner [start|install|uninstall|status]\n");
      process.exit(1);
  }
}

void dispatch().catch((error: unknown) => {
  process.stderr.write(
    `[jasojeon-runner] Fatal: ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exit(1);
});
