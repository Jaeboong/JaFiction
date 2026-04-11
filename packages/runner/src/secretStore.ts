import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { ProviderSecretStore } from "@jasojeon/shared";

interface SecretPayload {
  iv: string;
  tag: string;
  content: string;
}

interface FileSecretStoreOptions {
  env?: NodeJS.ProcessEnv;
  keyFilePath?: string;
  legacySeed?: string;
  randomBytes?: (size: number) => Buffer;
}

export class FileSecretStore implements ProviderSecretStore {
  private cache?: Record<string, string>;
  private primaryKey?: Buffer;

  constructor(
    private readonly filePath: string,
    private readonly options: FileSecretStoreOptions = {}
  ) {}

  async initialize(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await this.ensureSecretsLoaded();
  }

  async get(key: string): Promise<string | undefined> {
    const secrets = await this.readSecrets();
    return secrets[key];
  }

  async store(key: string, value: string): Promise<void> {
    const secrets = await this.readSecrets();
    secrets[key] = value;
    await this.writeSecrets(secrets);
  }

  async delete(key: string): Promise<void> {
    const secrets = await this.readSecrets();
    delete secrets[key];
    await this.writeSecrets(secrets);
  }

  private async readSecrets(): Promise<Record<string, string>> {
    if (this.cache) {
      return { ...this.cache };
    }

    return this.ensureSecretsLoaded();
  }

  private async ensureSecretsLoaded(): Promise<Record<string, string>> {
    if (this.cache) {
      return { ...this.cache };
    }

    const primaryKey = await this.resolvePrimaryKey();
    if (!(await exists(this.filePath))) {
      await this.writeSecretsWithKey({}, primaryKey);
      return {};
    }

    const encrypted = await readPayload(this.filePath);
    try {
      this.cache = decrypt(encrypted, primaryKey);
      return { ...this.cache };
    } catch {
      const legacyKey = deriveKey(this.options.legacySeed ?? legacySeed());
      if (!sameKey(primaryKey, legacyKey)) {
        try {
          const migratedSecrets = decrypt(encrypted, legacyKey);
          this.cache = migratedSecrets;
          await this.writeSecretsWithKey(migratedSecrets, primaryKey);
          return { ...migratedSecrets };
        } catch {
          // Fall through to the hardened failure path below.
        }
      }

      throw new Error("Unable to decrypt runner secrets with the configured local key material.");
    }
  }

  private async writeSecrets(secrets: Record<string, string>): Promise<void> {
    const primaryKey = await this.resolvePrimaryKey();
    await this.writeSecretsWithKey(secrets, primaryKey);
  }

  private async writeSecretsWithKey(secrets: Record<string, string>, key: Buffer): Promise<void> {
    this.cache = { ...secrets };
    await fs.writeFile(this.filePath, `${JSON.stringify(encrypt(secrets, key), null, 2)}\n`, "utf8");
  }

  private async resolvePrimaryKey(): Promise<Buffer> {
    if (this.primaryKey) {
      return this.primaryKey;
    }

    const passphrase = this.options.env?.JASOJEON_SECRET_PASSPHRASE?.trim();
    if (passphrase) {
      this.primaryKey = deriveKey(passphrase);
      return this.primaryKey;
    }

    const keyFilePath = this.options.keyFilePath ?? path.join(path.dirname(this.filePath), "secret.key");
    await fs.mkdir(path.dirname(keyFilePath), { recursive: true });

    if (!(await exists(keyFilePath))) {
      const encodedKey = (this.options.randomBytes ?? crypto.randomBytes)(32).toString("base64");
      await fs.writeFile(keyFilePath, `${encodedKey}\n`, {
        encoding: "utf8",
        mode: 0o600
      });
    }

    await fs.chmod(keyFilePath, 0o600);
    const encodedKey = (await fs.readFile(keyFilePath, "utf8")).trim();
    if (!encodedKey) {
      throw new Error("Runner secret key file is empty.");
    }

    this.primaryKey = deriveKey(encodedKey);
    return this.primaryKey;
  }
}

function encrypt(value: Record<string, string>, key: Buffer): SecretPayload {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const content = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final()
  ]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    content: content.toString("base64")
  };
}

function decrypt(payload: SecretPayload, key: Buffer): Record<string, string> {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.content, "base64")),
    decipher.final()
  ]);
  return JSON.parse(decrypted.toString("utf8")) as Record<string, string>;
}

function deriveKey(seed: string): Buffer {
  return crypto.createHash("sha256").update(seed).digest();
}

function legacySeed(): string {
  return `${os.userInfo().username}:${os.homedir()}:jasojeon-local`;
}

async function readPayload(filePath: string): Promise<SecretPayload> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as SecretPayload;
  } catch {
    throw new Error("Runner secret store file is unreadable.");
  }
}

function sameKey(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
