import {
  CallProviderTestPayload,
  CallProviderTestResult,
  SaveProviderConfigPayload,
  SaveProviderConfigResult,
  SaveProviderApiKeyPayload,
  SaveProviderApiKeyResult,
  NotionConnectPayload,
  NotionConnectResult,
  NotionDisconnectPayload,
  NotionDisconnectResult,
  ProviderId,
  providerIds
} from "@jafiction/shared";
import { RunnerContext } from "../runnerContext";

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
    await ctx.registry().testProvider(providerId);
    await ctx.stateStore.refreshProvider(providerId);
  });
  runtimeState = await ctx.registry().refreshRuntimeState(providerId);
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

// notion_connect: save token then connect MCP (claude provider is canonical for Notion)
const NOTION_PROVIDER: ProviderId = "claude";

export async function notionConnect(
  ctx: RunnerContext,
  payload: NotionConnectPayload
): Promise<NotionConnectResult> {
  await ctx.runBusy("Notion MCP를 연결하는 중...", async () => {
    await ctx.registry().saveNotionToken(payload.token);
    await ctx.registry().connectNotionMcp(NOTION_PROVIDER);
    await ctx.stateStore.refreshProvider(NOTION_PROVIDER);
  });
  return { ok: true };
}

export async function notionDisconnect(
  ctx: RunnerContext,
  _payload: NotionDisconnectPayload
): Promise<NotionDisconnectResult> {
  await ctx.runBusy("Notion MCP 연결을 해제하는 중...", async () => {
    await ctx.registry().disconnectNotionMcp(NOTION_PROVIDER);
    await ctx.stateStore.refreshProvider(NOTION_PROVIDER);
  });
  return { ok: true };
}
