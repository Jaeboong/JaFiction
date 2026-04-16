import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { FileSecretStore } from "../secretStore";

const IS_WIN = process.platform === "win32";

test("file secret store initializes a machine-local key file with strict permissions", { skip: IS_WIN ? "Windows 파일 시스템은 Unix chmod 0o600 permission model을 지원하지 않음" : false }, async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jasojeon-secret-store-"));
  const filePath = path.join(tempDir, "secrets.enc");
  const keyFilePath = path.join(tempDir, "secret.key");

  try {
    const store = new FileSecretStore(filePath, {
      keyFilePath,
      randomBytes: () => Buffer.alloc(32, 7)
    });

    await store.initialize();
    await store.store("codex", "top-secret");

    assert.equal(await store.get("codex"), "top-secret");

    const keyStat = await fs.stat(keyFilePath);
    assert.equal(keyStat.mode & 0o777, 0o600);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("file secret store reuses the same machine-local key across restarts", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jasojeon-secret-store-"));
  const filePath = path.join(tempDir, "secrets.enc");
  const keyFilePath = path.join(tempDir, "secret.key");

  try {
    const firstStore = new FileSecretStore(filePath, {
      keyFilePath,
      randomBytes: () => Buffer.alloc(32, 9)
    });
    await firstStore.initialize();
    await firstStore.store("claude", "persisted-value");

    const secondStore = new FileSecretStore(filePath, { keyFilePath });
    await secondStore.initialize();

    assert.equal(await secondStore.get("claude"), "persisted-value");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("file secret store migrates legacy predictable-seed secrets into a hardened machine key", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jasojeon-secret-store-"));
  const filePath = path.join(tempDir, "secrets.enc");
  const keyFilePath = path.join(tempDir, "secret.key");
  const legacySeed = "legacy-user:/legacy/home:jasojeon-local";

  try {
    const legacyStore = new FileSecretStore(filePath, {
      env: { JASOJEON_SECRET_PASSPHRASE: legacySeed },
      keyFilePath,
      legacySeed
    });
    await legacyStore.initialize();
    await legacyStore.store("gemini", "legacy-secret");

    const beforeMigration = await fs.readFile(filePath, "utf8");
    await fs.rm(keyFilePath, { force: true });

    const migratedStore = new FileSecretStore(filePath, {
      keyFilePath,
      legacySeed,
      randomBytes: () => Buffer.alloc(32, 5)
    });
    await migratedStore.initialize();

    assert.equal(await migratedStore.get("gemini"), "legacy-secret");
    assert.equal(await fs.access(keyFilePath).then(() => true, () => false), true);

    const afterMigration = await fs.readFile(filePath, "utf8");
    assert.notEqual(afterMigration, beforeMigration);

    const reopenedStore = new FileSecretStore(filePath, { keyFilePath, legacySeed: "wrong-legacy-seed" });
    await reopenedStore.initialize();
    assert.equal(await reopenedStore.get("gemini"), "legacy-secret");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("file secret store fails closed when the encrypted blob is copied without its machine key", async () => {
  const sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "jasojeon-secret-source-"));
  const targetDir = await fs.mkdtemp(path.join(os.tmpdir(), "jasojeon-secret-target-"));

  try {
    const sourceFilePath = path.join(sourceDir, "secrets.enc");
    const sourceKeyFilePath = path.join(sourceDir, "secret.key");
    const sourceStore = new FileSecretStore(sourceFilePath, {
      keyFilePath: sourceKeyFilePath,
      randomBytes: () => Buffer.alloc(32, 3)
    });
    await sourceStore.initialize();
    await sourceStore.store("openDart", "copied-secret");

    const targetFilePath = path.join(targetDir, "secrets.enc");
    const targetKeyFilePath = path.join(targetDir, "secret.key");
    await fs.copyFile(sourceFilePath, targetFilePath);

    const copiedStore = new FileSecretStore(targetFilePath, {
      keyFilePath: targetKeyFilePath,
      legacySeed: "different-legacy-seed",
      randomBytes: () => Buffer.alloc(32, 4)
    });

    await assert.rejects(
      copiedStore.initialize(),
      /Unable to decrypt runner secrets with the configured local key material\./
    );
  } finally {
    await fs.rm(sourceDir, { recursive: true, force: true });
    await fs.rm(targetDir, { recursive: true, force: true });
  }
});
