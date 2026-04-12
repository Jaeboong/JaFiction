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

  async logout(): Promise<ProviderAuthResult> {
    const configDir = getGeminiConfigDir();
    const oauthCredsPath = path.join(configDir, "oauth_creds.json");
    const accountsPath = path.join(configDir, "google_accounts.json");

    try {
      if (fs.existsSync(oauthCredsPath)) {
        fs.unlinkSync(oauthCredsPath);
      }
      if (fs.existsSync(accountsPath)) {
        fs.unlinkSync(accountsPath);
      }
      return { success: true, message: "Gemini 로그아웃 완료." };
    } catch {
      return { success: false, message: "로그아웃에 실패했습니다." };
    }
  },

  async startAuth(command?: string): Promise<ProviderAuthResult> {
    const bin = command ?? await resolveCommand("gemini");
    if (!bin) {
      return { success: false, message: "Gemini CLI가 설치되어 있지 않습니다." };
    }

    // 이미 인증된 경우 바로 성공 반환
    if (fs.existsSync(path.join(getGeminiConfigDir(), "oauth_creds.json"))) {
      return { success: true, message: "Gemini 인증 완료." };
    }

    // gemini auth login → 백그라운드로 spawn → 즉시 반환
    // 프론트엔드에서 폴링으로 인증 완료를 감지
    // RPC 30초 타임아웃보다 OAuth 플로우가 길 수 있으므로 블로킹하지 않음
    const useShell = bin.endsWith(".cmd");
    const child = spawn(bin, ["auth", "login"], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: useShell,
      detached: true,
    });

    // "Y/n" 프롬프트에 자동 응답
    child.stdin.write("Y\n");
    child.stdin.end();

    // 부모 프로세스 종료 시 자식도 정리
    child.unref();

    // 브라우저가 열릴 시간을 잠깐 대기 (3초)
    await new Promise((r) => setTimeout(r, 3000));

    // 이미 인증 완료됐을 수 있음 (기존 세션 재사용 등)
    if (fs.existsSync(path.join(getGeminiConfigDir(), "oauth_creds.json"))) {
      return { success: true, message: "Gemini 인증 완료." };
    }

    // 아직 미완료 — 프론트엔드에서 폴링하도록 안내
    return { success: false, message: "브라우저에서 Google 인증을 완료해주세요. 완료 후 테스트 버튼을 눌러 확인하세요." };
  },
};
