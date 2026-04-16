import { execFileSync } from "node:child_process";

export const IS_WIN = process.platform === "win32";
export const IS_LINUX = process.platform === "linux";
export const IS_WSL = IS_LINUX && /microsoft/i.test(process.release?.name ?? "");

export function hasNvm(): boolean {
  try {
    execFileSync("nvm", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function hasCommand(bin: string): boolean {
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    execFileSync(cmd, [bin], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
