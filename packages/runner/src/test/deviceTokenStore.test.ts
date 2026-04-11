import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { FileSecretStore } from "../secretStore";

// We test the device token store logic directly by exercising FileSecretStore
// with the same namespace key the store uses, avoiding process.env / homedir coupling.

const DEVICE_TOKEN_KEY = "hosted.deviceToken";

async function makeStoreInTemp(dir: string): Promise<FileSecretStore> {
  const filePath = path.join(dir, "secrets.enc");
  const keyFilePath = path.join(dir, "secret.key");
  const store = new FileSecretStore(filePath, {
    keyFilePath,
    randomBytes: () => Buffer.alloc(32, 42)
  });
  await store.initialize();
  return store;
}

test("deviceTokenStore: save and load round-trip", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jafiction-dts-"));
  try {
    const store = await makeStoreInTemp(dir);
    assert.equal(await store.get(DEVICE_TOKEN_KEY), undefined);

    await store.store(DEVICE_TOKEN_KEY, "tok-abc-123");
    assert.equal(await store.get(DEVICE_TOKEN_KEY), "tok-abc-123");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("deviceTokenStore: persists across store re-instantiation", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jafiction-dts-"));
  const filePath = path.join(dir, "secrets.enc");
  const keyFilePath = path.join(dir, "secret.key");
  try {
    const first = new FileSecretStore(filePath, { keyFilePath, randomBytes: () => Buffer.alloc(32, 99) });
    await first.initialize();
    await first.store(DEVICE_TOKEN_KEY, "persisted-token");

    // Re-open — key file already exists, so randomBytes is irrelevant.
    const second = new FileSecretStore(filePath, { keyFilePath });
    await second.initialize();
    assert.equal(await second.get(DEVICE_TOKEN_KEY), "persisted-token");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("deviceTokenStore: clear removes the token", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jafiction-dts-"));
  try {
    const store = await makeStoreInTemp(dir);
    await store.store(DEVICE_TOKEN_KEY, "to-be-deleted");
    await store.delete(DEVICE_TOKEN_KEY);
    assert.equal(await store.get(DEVICE_TOKEN_KEY), undefined);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("deviceTokenStore: other keys are unaffected by token operations", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jafiction-dts-"));
  try {
    const store = await makeStoreInTemp(dir);
    await store.store("some.other.key", "unrelated-value");
    await store.store(DEVICE_TOKEN_KEY, "my-token");
    await store.delete(DEVICE_TOKEN_KEY);

    assert.equal(await store.get("some.other.key"), "unrelated-value");
    assert.equal(await store.get(DEVICE_TOKEN_KEY), undefined);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
