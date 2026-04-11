import {
  GetStatePayload,
  GetStateResult,
  GetAgentDefaultsPayload,
  GetAgentDefaultsResult,
  SaveAgentDefaultsPayload,
  SaveAgentDefaultsResult
} from "@jasojeon/shared";
import { RunnerContext } from "../runnerContext";

export async function getState(
  ctx: RunnerContext,
  _payload: GetStatePayload
): Promise<GetStateResult> {
  return ctx.snapshot();
}

export async function getAgentDefaults(
  ctx: RunnerContext,
  _payload: GetAgentDefaultsPayload
): Promise<GetAgentDefaultsResult> {
  const agentDefaults = await ctx.config().getAgentDefaults();
  return { agentDefaults };
}

export async function saveAgentDefaults(
  ctx: RunnerContext,
  payload: SaveAgentDefaultsPayload
): Promise<SaveAgentDefaultsResult> {
  await ctx.runBusy("에이전트 배정을 저장하는 중...", async () => {
    await ctx.config().setAgentDefaults(payload.agentDefaults);
    await ctx.stateStore.refreshAgentDefaults();
  });
  return { ok: true };
}
