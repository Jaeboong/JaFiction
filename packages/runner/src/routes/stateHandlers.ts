import { GetStatePayload, GetStateResult } from "@jafiction/shared";
import { RunnerContext } from "../runnerContext";

export async function getState(
  ctx: RunnerContext,
  _payload: GetStatePayload
): Promise<GetStateResult> {
  return ctx.snapshot();
}
