import type { ProviderId, ProviderAuthHandler, ProviderStatus, ProviderAuthResult } from "./types";
import { claudeHandler } from "./claude";
import { codexHandler } from "./codex";
import { geminiHandler } from "./gemini";

export type { ProviderId, ProviderStatus, ProviderAuthResult };

const handlers: Record<ProviderId, ProviderAuthHandler> = {
  claude: claudeHandler,
  codex: codexHandler,
  gemini: geminiHandler,
};

export async function checkProviderStatus(
  providerId: ProviderId
): Promise<ProviderStatus> {
  return handlers[providerId].checkStatus();
}

export async function checkAllProviderStatus(): Promise<
  Record<ProviderId, ProviderStatus>
> {
  const [claude, codex, gemini] = await Promise.all([
    handlers.claude.checkStatus(),
    handlers.codex.checkStatus(),
    handlers.gemini.checkStatus(),
  ]);
  return { claude, codex, gemini };
}

export async function startProviderAuth(
  providerId: ProviderId
): Promise<ProviderAuthResult> {
  return handlers[providerId].startAuth();
}

export async function submitProviderAuthCode(
  providerId: ProviderId,
  code: string
): Promise<ProviderAuthResult> {
  const handler = handlers[providerId];
  if (!handler.submitCode) {
    return { success: false, message: `${providerId}는 코드 입력이 필요하지 않습니다.` };
  }
  return handler.submitCode(code);
}
