import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decrypt, encrypt, isSyncEncryptionConfigured } from "../crypto/atRest";
import type { Env } from "../env";

const env: Pick<Env, "SYNC_ENCRYPTION_KEY"> = {
  SYNC_ENCRYPTION_KEY: "a".repeat(64)
};

describe("at-rest sync encryption", () => {
  it("round-trips plaintext and does not emit plaintext ciphertext", () => {
    const plain = Buffer.from("sync private payload", "utf8");
    const encrypted = encrypt(plain, env);
    assert.notDeepEqual(encrypted, plain);
    assert.ok(encrypted.length > plain.length);
    assert.deepEqual(decrypt(encrypted, env), plain);
  });

  it("reports whether the sync encryption key is configured", () => {
    assert.equal(isSyncEncryptionConfigured(env), true);
    assert.equal(isSyncEncryptionConfigured({ SYNC_ENCRYPTION_KEY: undefined }), false);
  });
});
