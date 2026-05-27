import * as crypto from "node:crypto";
import type { Env } from "../env";

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_HEX_LENGTH = 64;

type SyncEncryptionEnv = Pick<Env, "SYNC_ENCRYPTION_KEY">;

function keyFromEnv(env: SyncEncryptionEnv): Buffer {
  const keyHex = env.SYNC_ENCRYPTION_KEY;
  if (!keyHex || !/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error("SYNC_ENCRYPTION_KEY must be a 64-character hex string");
  }
  return Buffer.from(keyHex, "hex");
}

export function isSyncEncryptionConfigured(env: { readonly SYNC_ENCRYPTION_KEY?: string }): boolean {
  return typeof env.SYNC_ENCRYPTION_KEY === "string" &&
    env.SYNC_ENCRYPTION_KEY.length === KEY_HEX_LENGTH &&
    /^[0-9a-fA-F]+$/.test(env.SYNC_ENCRYPTION_KEY);
}

export function encrypt(plain: Buffer, env: SyncEncryptionEnv): Buffer {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyFromEnv(env), iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

export function decrypt(blob: Buffer, env: SyncEncryptionEnv): Buffer {
  if (blob.length < IV_BYTES + TAG_BYTES) {
    throw new Error("Encrypted sync payload is too short");
  }
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = blob.subarray(IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyFromEnv(env), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
