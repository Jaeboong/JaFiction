import {
  CallProviderTestPayload,
  CallProviderTestResult,
  SaveProviderConfigPayload,
  SaveProviderConfigResult,
  SaveProviderApiKeyPayload,
  SaveProviderApiKeyResult,
  ClearProviderApiKeyPayload,
  ClearProviderApiKeyResult,
  NotionConnectPayload,
  NotionConnectResult,
  NotionDisconnectPayload,
  NotionDisconnectResult,
  NotionCheckPayload,
  NotionCheckResult,
  ProviderId,
  providerIds
} from "@jasojeon/shared";
import { RunnerContext } from "../runnerContext";
import { ensureProviderCli } from "../providers/resolve";

function requireProviderId(value: string): ProviderId {
  if (!providerIds.includes(value as ProviderId)) {
    throw Object.assign(new Error(`지원하지 않는 providerId입니다: ${value}`), { code: "invalid_input" });
  }
  return value as ProviderId;
}

export async function callProviderTest(
  ctx: RunnerContext,
  payload: CallProviderTestPayload
): Promise<CallProviderTestResult> {
  const providerId = requireProviderId(payload.provider);
  let runtimeState: Awaited<ReturnType<ReturnType<RunnerContext["registry"]>["refreshRuntimeState"]>> | undefined;
  await ctx.runBusy("도구 연결을 확인하는 중...", async () => {
    const state = await ctx.registry().testProvider(providerId);

    if (state.installed === false) {
      // CLI 미설치 → 자동 설치 시도
      const updateProgress = (msg: string) => {
        ctx.stateStore.setBusyMessage(msg);
        void ctx.pushState();
      };

      try {
        await ensureProviderCli(providerId, updateProgress);
      } catch (err) {
        // 설치 실패 — 에러 로그 후 testProvider 결과 그대로 반환
        console.error(`[ensureProviderCli] ${providerId} 자동 설치 실패:`, err);
        await ctx.stateStore.refreshProvider(providerId);
        return;
      }

      // 설치 성공 → 재테스트
      updateProgress("연결 확인 중...");
      await ctx.registry().testProvider(providerId);
    }

    await ctx.stateStore.refreshProvider(providerId);
    // testProvider가 이미 캐시를 갱신했으므로 캐시에서 가져옴
    // refreshRuntimeState는 바이너리를 다시 읽어 느림 (Claude 232MB)
    runtimeState = await ctx.registry().getCachedRuntimeState(providerId);
  });
  if (!runtimeState) {
    runtimeState = await ctx.registry().refreshRuntimeState(providerId);
  }
  return {
    ok: runtimeState.authStatus === "healthy",
    stdoutExcerpt: undefined,
    runtimeState
  };
}

export async function saveProviderConfig(
  ctx: RunnerContext,
  payload: SaveProviderConfigPayload
): Promise<SaveProviderConfigResult> {
  const providerId = requireProviderId(payload.provider);
  const { authMode, model, effort, command } = payload.config;
  await ctx.runBusy("프로바이더 설정을 저장하는 중...", async () => {
    if (typeof authMode === "string") {
      await ctx.registry().setAuthMode(providerId, authMode);
    }
    if (typeof model === "string") {
      await ctx.registry().setModel(providerId, model);
    }
    if (typeof effort === "string") {
      await ctx.registry().setEffort(providerId, effort);
    }
    if (typeof command === "string") {
      await ctx.config().set(`providers.${providerId}.command`, command.trim());
    }
    await ctx.stateStore.refreshProvider(providerId);
  });
  return { ok: true };
}

export async function saveProviderApiKey(
  ctx: RunnerContext,
  payload: SaveProviderApiKeyPayload
): Promise<SaveProviderApiKeyResult> {
  const providerId = requireProviderId(payload.provider);
  const apiKey = payload.key.trim();
  if (!apiKey) {
    throw Object.assign(new Error("API 키를 입력하세요."), { code: "invalid_input" });
  }
  await ctx.runBusy("API 키를 저장하는 중...", async () => {
    await ctx.registry().saveApiKey(providerId, apiKey);
    await ctx.stateStore.refreshProvider(providerId);
  });
  return { ok: true };
}

export async function clearProviderApiKey(
  ctx: RunnerContext,
  payload: ClearProviderApiKeyPayload
): Promise<ClearProviderApiKeyResult> {
  const providerId = requireProviderId(payload.provider);
  await ctx.runBusy("API 키를 삭제하는 중...", async () => {
    await ctx.registry().clearApiKey(providerId);
    await ctx.stateStore.refreshProvider(providerId);
  });
  return { ok: true };
}

export async function notionCheck(
  ctx: RunnerContext,
  payload: NotionCheckPayload
): Promise<NotionCheckResult> {
  const providerId = requireProviderId(payload.provider);
  await ctx.runBusy("Notion MCP 상태를 확인하는 중...", async () => {
    await ctx.registry().checkNotionMcp(providerId);
    await ctx.stateStore.refreshProvider(providerId);
  });
  return { ok: true };
}

export async function notionConnect(
  ctx: RunnerContext,
  payload: NotionConnectPayload
): Promise<NotionConnectResult> {
  const providerId = payload.provider ? requireProviderId(payload.provider) : "claude" as ProviderId;
  await ctx.runBusy("Notion MCP를 연결하는 중...", async () => {
    if (payload.token) {
      await ctx.registry().saveNotionToken(payload.token);
    }
    await ctx.registry().connectNotionMcp(providerId);
    await ctx.registry().checkNotionMcp(providerId);
    await ctx.stateStore.refreshProvider(providerId);
  });
  return { ok: true };
}

export async function notionDisconnect(
  ctx: RunnerContext,
  payload: NotionDisconnectPayload
): Promise<NotionDisconnectResult> {
  const providerId = payload.provider ? requireProviderId(payload.provider) : "claude" as ProviderId;
  await ctx.runBusy("Notion MCP 연결을 해제하는 중...", async () => {
    await ctx.registry().disconnectNotionMcp(providerId);
    await ctx.stateStore.refreshProvider(providerId);
  });
  return { ok: true };
}
