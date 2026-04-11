import {
  GetStatePayload,
  GetStateResult,
  GetAgentDefaultsPayload,
  GetAgentDefaultsResult
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
