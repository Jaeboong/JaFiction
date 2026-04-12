import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const PLIST_LABEL = "com.jasojeon.runner";
const PLIST_FILENAME = `${PLIST_LABEL}.plist`;

function plistPath(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", PLIST_FILENAME);
}

function buildPlistContent(exePath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${exePath}</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
`;
}

export async function installMacService(exePath: string): Promise<void> {
  const target = plistPath();
  const launchAgentsDir = path.dirname(target);

  fs.mkdirSync(launchAgentsDir, { recursive: true });
  fs.writeFileSync(target, buildPlistContent(exePath), { encoding: "utf-8" });

  const uid = process.getuid?.() ?? 0;

  try {
    execSync(`launchctl bootstrap gui/${uid} "${target}"`, { stdio: "pipe" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[jasojeon-runner] Failed to bootstrap LaunchAgent: ${msg}`);
  }

  process.stdout.write(`[jasojeon-runner] macOS LaunchAgent registered: ${target}\n`);
}

export async function uninstallMacService(): Promise<void> {
  const target = plistPath();
  const uid = process.getuid?.() ?? 0;

  try {
    execSync(`launchctl bootout gui/${uid} "${target}"`, { stdio: "pipe" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[jasojeon-runner] Warning: launchctl bootout failed: ${msg}\n`);
  }

  if (fs.existsSync(target)) {
    fs.unlinkSync(target);
  }

  process.stdout.write(`[jasojeon-runner] macOS LaunchAgent removed: ${target}\n`);
}
