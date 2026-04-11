import * as os from "node:os";
import * as path from "node:path";

import { FileSecretStore } from "../secretStore";

// Namespace key used in FileSecretStore for the hosted device token.
// Phase 5 pairing code will call saveDeviceToken after a successful exchange.
const DEVICE_TOKEN_KEY = "hosted.deviceToken";

// Resolve the same secrets.enc path that createRunnerContext uses.
function resolveSecretsPath(): string {
  const storageRoot = path.join(os.homedir(), ".jafiction");
  return path.join(storageRoot, "secrets.enc");
}

function makeStore(): FileSecretStore {
  return new FileSecretStore(resolveSecretsPath());
}

export async function loadDeviceToken(): Promise<string | undefined> {
  const store = makeStore();
  await store.initialize();
  return store.get(DEVICE_TOKEN_KEY);
}

export async function saveDeviceToken(token: string): Promise<void> {
  const store = makeStore();
  await store.initialize();
  await store.store(DEVICE_TOKEN_KEY, token);
}

export async function clearDeviceToken(): Promise<void> {
  const store = makeStore();
  await store.initialize();
  await store.delete(DEVICE_TOKEN_KEY);
}
