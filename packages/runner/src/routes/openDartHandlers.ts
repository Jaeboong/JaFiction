import {
  OpendartSaveKeyPayload,
  OpendartSaveKeyResult,
  OpendartTestPayload,
  OpendartTestResult,
  OpendartDeleteKeyPayload,
  OpendartDeleteKeyResult,
  OpenDartClient
} from "@jasojeon/shared";
import { openDartSecretKey, RunnerContext } from "../runnerContext";

export async function opendartSaveKey(
  ctx: RunnerContext,
  payload: OpendartSaveKeyPayload
): Promise<OpendartSaveKeyResult> {
  const apiKey = payload.key.trim();
  if (!apiKey) {
    throw Object.assign(new Error("OpenDART API 키는 비워둘 수 없습니다."), { code: "invalid_input" });
  }
  await ctx.runBusy("OpenDART API 키를 저장하는 중...", async () => {
    await ctx.secrets().store(openDartSecretKey, apiKey);
    await ctx.stateStore.refreshOpenDartConfigured();
  });
  return { ok: true };
}

export async function opendartDeleteKey(
  ctx: RunnerContext,
  _payload: OpendartDeleteKeyPayload
): Promise<OpendartDeleteKeyResult> {
  await ctx.runBusy("OpenDART API 키를 삭제하는 중...", async () => {
    await ctx.secrets().delete(openDartSecretKey);
    await ctx.stateStore.refreshOpenDartConfigured();
  });
  return { ok: true };
}

export async function opendartTest(
  ctx: RunnerContext,
  payload: OpendartTestPayload
): Promise<OpendartTestResult> {
  const apiKey = await ctx.secrets().get(openDartSecretKey);
  if (!apiKey) {
    return { ok: false, sample: undefined };
  }
  const client = new OpenDartClient(ctx.storageRoot, apiKey);
  const result = await client.testConnection();
  ctx.stateStore.setOpenDartConnectionState({
    status: result.ok ? "healthy" : "unhealthy",
    lastCheckAt: new Date().toISOString(),
    lastError: result.ok ? undefined : result.message
  });
  await ctx.stateStore.refreshOpenDartConfigured();
  await ctx.pushState();

  let sample: string | undefined;
  if (result.ok && payload.corpName) {
    try {
      const resolved = await client.resolveAndFetchCompany(payload.corpName, undefined);
      sample = JSON.stringify(resolved).slice(0, 500);
    } catch {
      // best-effort sample
    }
  }

  return { ok: result.ok, sample };
}
