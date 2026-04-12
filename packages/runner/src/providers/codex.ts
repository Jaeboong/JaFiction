import { spawn, execFile } from "node:child_process";
import type { ProviderAuthHandler, ProviderStatus, ProviderAuthResult } from "./types";
import { resolveCommand } from "./resolve";

export const codexHandler: ProviderAuthHandler = {
  async checkStatus(): Promise<ProviderStatus> {
    const bin = await resolveCommand("codex");
    if (!bin) {
      return { installed: false, authenticated: false };
    }

    try {
      const output = await execAsync(bin, ["login", "status"]);
      const trimmed = output.trim();
      // "Logged in using ChatGPT" or "Logged in using API key"
      const loggedIn = trimmed.toLowerCase().startsWith("logged in");
      return {
        installed: true,
        authenticated: loggedIn,
        detail: loggedIn ? trimmed : undefined,
      };
    } catch {
      return { installed: true, authenticated: false };
    }
  },

  async startAuth(command?: string): Promise<ProviderAuthResult> {
    const bin = command ?? await resolveCommand("codex");
    if (!bin) {
      return { success: false, message: "Codex CLI가 설치되어 있지 않습니다." };
    }

    // codex login → 브라우저 열림 → ChatGPT OAuth 자동 콜백
    return new Promise<ProviderAuthResult>((resolve) => {
      const child = spawn(bin, ["login"], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      const timeout = setTimeout(() => {
        child.kill();
        resolve({ success: false, message: "인증 응답 대기 시간 초과." });
      }, 120_000);

      child.on("close", (exitCode) => {
        clearTimeout(timeout);
        if (exitCode === 0) {
          resolve({ success: true, message: "Codex 인증 완료." });
        } else {
          resolve({ success: false, message: "Codex 인증에 실패했습니다." });
        }
      });
    });
  },
  async logout(command?: string): Promise<ProviderAuthResult> {
    const bin = command ?? await resolveCommand("codex");
    if (!bin) {
      return { success: false, message: "Codex CLI가 설치되어 있지 않습니다." };
    }

    return new Promise<ProviderAuthResult>((resolve) => {
      const child = spawn(bin, ["logout"], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      const timeout = setTimeout(() => {
        child.kill();
        resolve({ success: false, message: "로그아웃 응답 대기 시간 초과." });
      }, 15_000);

      child.on("close", (exitCode) => {
        clearTimeout(timeout);
        if (exitCode === 0) {
          resolve({ success: true, message: "Codex 로그아웃 완료." });
        } else {
          resolve({ success: false, message: "로그아웃에 실패했습니다." });
        }
      });
    });
  },
};

function execAsync(bin: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args as string[], { timeout: 10_000 }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}
