import {
  checkProviderStatus,
  checkAllProviderStatus,
  startProviderAuth,
  submitProviderAuthCode,
  logoutProvider,
} from "../providers";
import type { ProviderId } from "../providers";
import type { RunnerContext } from "../runnerContext";
import { ensureProviderCli } from "../providers/resolve";

export async function checkProviderCliStatus(
  _ctx: unknown,
  payload: { providerId?: string }
): Promise<unknown> {
  if (payload.providerId) {
    const status = await checkProviderStatus(payload.providerId as ProviderId);
    return { [payload.providerId]: status };
  }
  return checkAllProviderStatus();
}

export async function startProviderCliAuth(
  ctx: RunnerContext,
  payload: { providerId: string }
): Promise<unknown> {
  const providerId = payload.providerId as ProviderId;

  // CLI 미설치 시 자동 설치 시도
  const status = await checkProviderStatus(providerId);
  if (status.installed === false) {
    const updateProgress = (msg: string) => {
      ctx.stateStore.setBusyMessage(msg);
      void ctx.pushState();
    };
    try {
      await ensureProviderCli(providerId, updateProgress);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, message: `CLI 설치 실패: ${message}` };
    }
  }

  const command = await ctx.registry().getCommand(providerId);
  const result = await startProviderAuth(providerId, command);
  // 인증 후 auth 상태 재확인하여 캐시 갱신 (get_state가 최신 상태를 반환하도록)
  await ctx.registry().testProvider(providerId);
  if (ctx.stateStore) {
    await ctx.stateStore.refreshProvider(providerId);
  }
  return result;
}

export async function submitProviderCliCode(
  _ctx: unknown,
  payload: { providerId: string; code: string }
): Promise<unknown> {
  return submitProviderAuthCode(payload.providerId as ProviderId, payload.code);
}

export async function callProviderLogout(
  ctx: RunnerContext,
  payload: { providerId: string }
): Promise<{ ok: boolean; message?: string }> {
  const providerId = payload.providerId as ProviderId;
  const command = await ctx.registry().getCommand(providerId);
  const result = await logoutProvider(providerId, command);
  // 로그아웃 후 auth 상태 재확인하여 저장 (캐시된 "healthy" 상태를 갱신)
  await ctx.registry().testProvider(providerId);
  if (ctx.stateStore) {
    await ctx.stateStore.refreshProvider(providerId);
  }
  return { ok: result.success, message: result.message };
}
