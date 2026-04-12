import { spawn, execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { ProviderAuthHandler, ProviderStatus, ProviderAuthResult } from "./types";
import { resolveCommand } from "./resolve";

// claude auth login 진행 중인 프로세스 (코드 입력 대기)
let pendingAuthProcess: ChildProcess | null = null;

export const claudeHandler: ProviderAuthHandler = {
  async checkStatus(): Promise<ProviderStatus> {
    const bin = await resolveCommand("claude");
    if (!bin) {
      return { installed: false, authenticated: false };
    }

    try {
      const output = await execAsync(bin, ["auth", "status"]);
      const parsed = JSON.parse(output);
      return {
        installed: true,
        authenticated: parsed.loggedIn === true,
        email: parsed.email,
        detail: parsed.subscriptionType,
      };
    } catch {
      return { installed: true, authenticated: false };
    }
  },

  async startAuth(): Promise<ProviderAuthResult> {
    const bin = await resolveCommand("claude");
    if (!bin) {
      return { success: false, message: "Claude CLI가 설치되어 있지 않습니다." };
    }

    // 이미 진행 중인 프로세스가 있으면 종료
    if (pendingAuthProcess) {
      pendingAuthProcess.kill();
      pendingAuthProcess = null;
    }

    return new Promise<ProviderAuthResult>((resolve) => {
      const child = spawn(bin, ["auth", "login"], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      pendingAuthProcess = child;
      let stdout = "";
      let stderr = "";

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      // URL이 출력될 때까지 최대 10초 대기
      const timeout = setTimeout(() => {
        resolve({
          success: false,
          message: "인증 URL을 가져오지 못했습니다.",
        });
      }, 10_000);

      const checkForUrl = setInterval(() => {
        const combined = stdout + stderr;
        const urlMatch = combined.match(/(https:\/\/claude\.com\/[^\s]+)/);
        if (urlMatch) {
          clearInterval(checkForUrl);
          clearTimeout(timeout);
          resolve({
            success: true,
            authUrl: urlMatch[1],
            message: "브라우저에서 인증 후 코드를 입력하세요.",
          });
        }
      }, 200);

      child.on("close", () => {
        clearInterval(checkForUrl);
        clearTimeout(timeout);
        pendingAuthProcess = null;
      });
    });
  },

  async submitCode(code: string): Promise<ProviderAuthResult> {
    if (!pendingAuthProcess || !pendingAuthProcess.stdin) {
      return { success: false, message: "진행 중인 인증 프로세스가 없습니다." };
    }

    return new Promise<ProviderAuthResult>((resolve) => {
      const child = pendingAuthProcess!;

      const timeout = setTimeout(() => {
        resolve({ success: false, message: "인증 응답 대기 시간 초과." });
        pendingAuthProcess = null;
      }, 15_000);

      child.on("close", (exitCode) => {
        clearTimeout(timeout);
        pendingAuthProcess = null;
        if (exitCode === 0) {
          resolve({ success: true, message: "Claude 인증 완료." });
        } else {
          resolve({ success: false, message: "인증에 실패했습니다. 코드를 확인하세요." });
        }
      });

      child.stdin!.write(code + "\n");
      child.stdin!.end();
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
