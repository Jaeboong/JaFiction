import * as os from "node:os";
import * as path from "node:path";

import { FileSecretStore } from "../secretStore";

// Resolve the same secrets.enc path that createRunnerContext uses.
function resolveSecretsPath(): string {
  const storageRoot = path.join(os.homedir(), ".jasojeon");
  return path.join(storageRoot, "secrets.enc");
}

function makeStore(): FileSecretStore {
  return new FileSecretStore(resolveSecretsPath());
}

function makeKeys(backendUrl: string): { tokenKey: string; idKey: string } {
  const hostname = new URL(backendUrl).hostname;
  return {
    tokenKey: `hosted.${hostname}.deviceToken`,
    idKey: `hosted.${hostname}.deviceId`,
  };
}

export async function loadDeviceToken(backendUrl: string): Promise<string | undefined> {
  const store = makeStore();
  await store.initialize();
  return store.get(makeKeys(backendUrl).tokenKey);
}

export async function saveDeviceToken(backendUrl: string, token: string): Promise<void> {
  const store = makeStore();
  await store.initialize();
  await store.store(makeKeys(backendUrl).tokenKey, token);
}

export async function loadDeviceId(backendUrl: string): Promise<string | undefined> {
  const store = makeStore();
  await store.initialize();
  return store.get(makeKeys(backendUrl).idKey);
}

export async function saveDeviceId(backendUrl: string, deviceId: string): Promise<void> {
  const store = makeStore();
  await store.initialize();
  await store.store(makeKeys(backendUrl).idKey, deviceId);
}

export async function clearDeviceToken(backendUrl: string): Promise<void> {
  const store = makeStore();
  await store.initialize();
  const { tokenKey, idKey } = makeKeys(backendUrl);
  await store.delete(tokenKey);
  await store.delete(idKey);
}
