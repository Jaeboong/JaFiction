import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const SERVICE_NAME = "jasojeon-runner";
const SERVICE_FILENAME = `${SERVICE_NAME}.service`;

function serviceFilePath(): string {
  return path.join(os.homedir(), ".config", "systemd", "user", SERVICE_FILENAME);
}

function buildServiceContent(exePath: string): string {
  return `[Unit]
Description=Jasojeon Runner

[Service]
ExecStart="${exePath}" start
Restart=on-failure

[Install]
WantedBy=default.target
`;
}

export async function installLinuxService(exePath: string): Promise<void> {
  const target = serviceFilePath();
  const serviceDir = path.dirname(target);

  fs.mkdirSync(serviceDir, { recursive: true });
  fs.writeFileSync(target, buildServiceContent(exePath), { encoding: "utf-8" });

  try {
    execSync("systemctl --user daemon-reload", { stdio: "pipe" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[jasojeon-runner] Failed to reload systemd user daemon: ${msg}`);
  }

  try {
    execSync(`systemctl --user enable --now ${SERVICE_NAME}`, { stdio: "pipe" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[jasojeon-runner] Failed to enable/start systemd user service: ${msg}`);
  }

  process.stdout.write(`[jasojeon-runner] systemd user service "${SERVICE_NAME}" installed: ${target}\n`);
}

export async function uninstallLinuxService(): Promise<void> {
  try {
    execSync(`systemctl --user disable --now ${SERVICE_NAME}`, { stdio: "pipe" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[jasojeon-runner] Warning: systemctl disable failed: ${msg}\n`);
  }

  const target = serviceFilePath();
  if (fs.existsSync(target)) {
    fs.unlinkSync(target);
  }

  process.stdout.write(`[jasojeon-runner] systemd user service "${SERVICE_NAME}" removed.\n`);
}
