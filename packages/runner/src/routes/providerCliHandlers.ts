import {
  checkProviderStatus,
  checkAllProviderStatus,
  startProviderAuth,
  submitProviderAuthCode,
} from "../providers";
import type { ProviderId } from "../providers";

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
  _ctx: unknown,
  payload: { providerId: string }
): Promise<unknown> {
  return startProviderAuth(payload.providerId as ProviderId);
}

export async function submitProviderCliCode(
  _ctx: unknown,
  payload: { providerId: string; code: string }
): Promise<unknown> {
  return submitProviderAuthCode(payload.providerId as ProviderId, payload.code);
}
