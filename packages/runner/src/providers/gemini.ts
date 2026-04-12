import { spawn, execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { ProviderAuthHandler, ProviderStatus, ProviderAuthResult } from "./types";
import { resolveCommand } from "./resolve";

function getGeminiConfigDir(): string {
  return path.join(os.homedir(), ".gemini");
}

export const geminiHandler: ProviderAuthHandler = {
  async checkStatus(): Promise<ProviderStatus> {
    const bin = await resolveCommand("gemini");
    if (!bin) {
      return { installed: false, authenticated: false };
    }

    const configDir = getGeminiConfigDir();
    const oauthCredsPath = path.join(configDir, "oauth_creds.json");
    const accountsPath = path.join(configDir, "google_accounts.json");

    // oauth_creds.json 존재 여부로 인증 확인
    const hasOauth = fs.existsSync(oauthCredsPath);
    if (!hasOauth) {
      return { installed: true, authenticated: false };
    }

    // google_accounts.json에서 이메일 추출
    let email: string | undefined;
    try {
      const raw = fs.readFileSync(accountsPath, "utf-8");
      const parsed = JSON.parse(raw);
      email = parsed.active;
    } catch {
      // 파일 없거나 파싱 실패 — 인증은 됐지만 이메일은 모름
    }

    return {
      installed: true,
      authenticated: true,
      email,
    };
  },

  async startAuth(): Promise<ProviderAuthResult> {
    const bin = await resolveCommand("gemini");
    if (!bin) {
      return { success: false, message: "Gemini CLI가 설치되어 있지 않습니다." };
    }

    // gemini 첫 실행 시 자동으로 브라우저 열림 → Google OAuth → 자동 콜백
    // --prompt "exit" 으로 인증만 하고 바로 종료
    return new Promise<ProviderAuthResult>((resolve) => {
      const child = spawn(bin, ["--prompt", "exit"], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      const timeout = setTimeout(() => {
        child.kill();
        resolve({ success: false, message: "인증 응답 대기 시간 초과." });
      }, 120_000);

      child.on("close", (exitCode) => {
        clearTimeout(timeout);
        // exitCode와 무관하게 oauth_creds.json 생성 여부로 판단
        const hasOauth = fs.existsSync(path.join(getGeminiConfigDir(), "oauth_creds.json"));
        if (hasOauth) {
          resolve({ success: true, message: "Gemini 인증 완료." });
        } else if (exitCode === 0) {
          resolve({ success: true, message: "Gemini 인증 완료." });
        } else {
          resolve({ success: false, message: "Gemini 인증에 실패했습니다." });
        }
      });
    });
  },
};
