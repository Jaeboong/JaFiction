import {
  OpendartSaveKeyPayload,
  OpendartSaveKeyResult,
  OpendartTestPayload,
  OpendartTestResult,
  OpendartDeleteKeyPayload,
  OpendartDeleteKeyResult,
  OpenDartClient
} from "@jasojeon/shared";
import { getServerDartApiKey, RunnerContext } from "../runnerContext";

// OpenDART API 키는 이제 서버 env(DART_API_KEY)로 관리됩니다.
// 아래 핸들러들은 RPC 스키마 하위 호환을 위해 유지하되,
// 사용자별 키 저장/삭제 로직은 no-op으로 처리합니다.

export async function opendartSaveKey(
  _ctx: RunnerContext,
  _payload: OpendartSaveKeyPayload
): Promise<OpendartSaveKeyResult> {
  // 서버 env 기반으로 전환됨 — 사용자 입력 키는 저장하지 않습니다.
  return { ok: true };
}

export async function opendartDeleteKey(
  _ctx: RunnerContext,
  _payload: OpendartDeleteKeyPayload
): Promise<OpendartDeleteKeyResult> {
  // 서버 env 기반으로 전환됨 — 삭제할 사용자 키가 없습니다.
  return { ok: true };
}

export async function opendartTest(
  ctx: RunnerContext,
  payload: OpendartTestPayload
): Promise<OpendartTestResult> {
  const apiKey = getServerDartApiKey();
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
