import { spawnSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const REG_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const REG_VALUE = "JasojeonRunner";

function getLogPath(exePath: string): string {
  return path.join(path.dirname(exePath), "jasojeon-runner.log");
}

export async function installWindowsService(exePath: string): Promise<void> {
  const command = `"${exePath}" start`;
  const logPath = getLogPath(exePath);

  // 1. 레지스트리에 로그인 시 자동 실행 등록 (관리자 권한 불필요)
  const installResult = spawnSync(
    "reg",
    ["add", REG_KEY, "/v", REG_VALUE, "/t", "REG_SZ", "/d", command, "/f"],
    { stdio: "pipe" }
  );
  if (installResult.status !== 0) {
    const stderr = installResult.stderr?.toString() ?? "";
    throw new Error(`[jasojeon-runner] Failed to register autostart: ${stderr}`);
  }

  // 2. 지금 바로 백그라운드로 실행 (로그 파일에 stdout/stderr 기록)
  const logFd = fs.openSync(logPath, "a");
  const child = spawn(exePath, ["start"], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  fs.closeSync(logFd);

  process.stdout.write(`[jasojeon-runner] Autostart registered and runner started in background.\n`);
  process.stdout.write(`[jasojeon-runner] Log: ${logPath}\n`);
}

export async function uninstallWindowsService(): Promise<void> {
  const uninstallResult = spawnSync(
    "reg",
    ["delete", REG_KEY, "/v", REG_VALUE, "/f"],
    { stdio: "pipe" }
  );
  if (uninstallResult.status !== 0) {
    const stderr = uninstallResult.stderr?.toString() ?? "";
    throw new Error(`[jasojeon-runner] Failed to remove autostart entry: ${stderr}`);
  }
  process.stdout.write(`[jasojeon-runner] Autostart entry removed.\n`);
}
