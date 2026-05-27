import * as crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { and, eq, isNull, sql } from "drizzle-orm";
import { mergeSyncSets, ProjectRecordSchema, SyncDocumentSchema, SyncSetSchema, type SyncDocument, type SyncProject, type SyncSet } from "@jasojeon/shared";
import type { Db } from "../db/client";
import { device_users, devices, synced_documents, synced_projects } from "../db/schema";
import type { Env } from "../env";
import { decrypt, encrypt, isSyncEncryptionConfigured } from "../crypto/atRest";

type SyncEncryptionEnv = Pick<Env, "SYNC_ENCRYPTION_KEY">;

interface SyncDocumentPayload {
  readonly title: string;
  readonly sourceType: string;
  readonly pinnedByDefault: boolean;
  readonly note?: string;
  readonly projectSlug?: string;
  readonly contentBase64: string;
}

export interface SyncStore {
  findUserIdByDeviceTokenHash(tokenHash: string): Promise<string | undefined>;
  mergeUserSyncSet(userId: string, incoming: SyncSet, env: SyncEncryptionEnv): Promise<SyncSet>;
  clearUserSyncSet(userId: string): Promise<void>;
}

export interface SyncDeps {
  readonly db?: Db;
  readonly syncStore?: SyncStore;
  readonly env: Env;
}

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function authToken(request: FastifyRequest): string | undefined {
  const authHeader = request.headers["authorization"];
  if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
    return undefined;
  }
  const token = authHeader.slice("Bearer ".length).trim();
  return token.length > 0 ? token : undefined;
}

async function requireDevice(store: SyncStore, request: FastifyRequest): Promise<string | undefined> {
  const token = authToken(request);
  if (!token) {
    return undefined;
  }
  return store.findUserIdByDeviceTokenHash(sha256Hex(token));
}

function documentPayload(document: SyncDocument): SyncDocumentPayload {
  const payload: SyncDocumentPayload = {
    title: document.title,
    sourceType: document.sourceType,
    pinnedByDefault: document.pinnedByDefault,
    contentBase64: document.contentBase64
  };
  if (document.note !== undefined) {
    return document.projectSlug !== undefined
      ? { ...payload, note: document.note, projectSlug: document.projectSlug }
      : { ...payload, note: document.note };
  }
  return document.projectSlug !== undefined ? { ...payload, projectSlug: document.projectSlug } : payload;
}

function decryptJson(buffer: Buffer, env: SyncEncryptionEnv): unknown {
  return JSON.parse(decrypt(buffer, env).toString("utf8"));
}

function encryptJson(value: unknown, env: SyncEncryptionEnv): Buffer {
  return encrypt(Buffer.from(JSON.stringify(value), "utf8"), env);
}

function projectSlugHash(document: SyncDocument): string {
  return document.projectSlug === undefined ? "" : sha256Hex(document.projectSlug);
}

function toStoredDocument(document: SyncDocument, env: SyncEncryptionEnv): {
  readonly scope: "profile" | "project";
  readonly project_slug_hash: string;
  readonly content_sha256: string;
  readonly created_at_iso: string;
  readonly enc_payload: Buffer;
} {
  return {
    scope: document.scope,
    project_slug_hash: projectSlugHash(document),
    content_sha256: document.contentSha256,
    created_at_iso: document.createdAt,
    enc_payload: encryptJson(documentPayload(document), env)
  };
}

function fromStoredDocument(row: {
  readonly scope: string;
  readonly content_sha256: string;
  readonly created_at_iso: string;
  readonly enc_payload: Buffer;
}, env: SyncEncryptionEnv): SyncDocument {
  const payload = decryptJson(row.enc_payload, env);
  const parsedPayload = SyncDocumentSchema.pick({
    title: true,
    sourceType: true,
    pinnedByDefault: true,
    note: true,
    projectSlug: true,
    contentBase64: true
  }).parse(payload);
  return SyncDocumentSchema.parse({
    scope: row.scope,
    contentSha256: row.content_sha256,
    createdAt: row.created_at_iso,
    ...parsedPayload
  });
}

function toStoredProject(project: SyncProject, env: SyncEncryptionEnv): {
  readonly slug_hash: string;
  readonly record_updated_at: Date;
  readonly enc_record: Buffer;
} {
  return {
    slug_hash: sha256Hex(project.slug),
    record_updated_at: new Date(project.updatedAt),
    enc_record: encryptJson(project.record, env)
  };
}

function fromStoredProject(row: {
  readonly record_updated_at: Date;
  readonly enc_record: Buffer;
}, env: SyncEncryptionEnv): SyncProject {
  const record = ProjectRecordSchema.parse(decryptJson(row.enc_record, env));
  return {
    slug: record.slug,
    record,
    updatedAt: row.record_updated_at.toISOString()
  };
}

function verifyContentHashes(set: SyncSet): boolean {
  return set.documents.every((document) => {
    const content = Buffer.from(document.contentBase64, "base64");
    return crypto.createHash("sha256").update(content).digest("hex") === document.contentSha256;
  });
}

export function createDrizzleSyncStore(db: Db): SyncStore {
  return {
    async findUserIdByDeviceTokenHash(tokenHash) {
      const rows = await db
        .select({ userId: device_users.user_id })
        .from(devices)
        .innerJoin(device_users, eq(device_users.device_id, devices.id))
        .where(and(eq(devices.token_hash, tokenHash), isNull(devices.revoked_at)))
        .limit(1);
      return rows[0]?.userId;
    },

    async mergeUserSyncSet(userId, incoming, env) {
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);

        const documentRows = await tx
          .select({
            scope: synced_documents.scope,
            content_sha256: synced_documents.content_sha256,
            created_at_iso: synced_documents.created_at_iso,
            enc_payload: synced_documents.enc_payload
          })
          .from(synced_documents)
          .where(eq(synced_documents.user_id, userId));
        const projectRows = await tx
          .select({
            record_updated_at: synced_projects.record_updated_at,
            enc_record: synced_projects.enc_record
          })
          .from(synced_projects)
          .where(eq(synced_projects.user_id, userId));

        const stored: SyncSet = {
          documents: documentRows.map((row) => fromStoredDocument(row, env)),
          projects: projectRows.map((row) => fromStoredProject(row, env))
        };
        const merged = mergeSyncSets(stored, incoming);

        for (const document of merged.documents) {
          const storedDocument = toStoredDocument(document, env);
          await tx
            .insert(synced_documents)
            .values({ user_id: userId, ...storedDocument })
            .onConflictDoUpdate({
              target: [
                synced_documents.user_id,
                synced_documents.scope,
                synced_documents.project_slug_hash,
                synced_documents.content_sha256
              ],
              set: {
                created_at_iso: storedDocument.created_at_iso,
                enc_payload: storedDocument.enc_payload
              }
            });
        }

        for (const project of merged.projects) {
          const storedProject = toStoredProject(project, env);
          await tx
            .insert(synced_projects)
            .values({ user_id: userId, ...storedProject })
            .onConflictDoUpdate({
              target: [synced_projects.user_id, synced_projects.slug_hash],
              set: {
                record_updated_at: storedProject.record_updated_at,
                enc_record: storedProject.enc_record
              }
            });
        }

        return merged;
      });
    },

    async clearUserSyncSet(userId) {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
        await tx.delete(synced_documents).where(eq(synced_documents.user_id, userId));
        await tx.delete(synced_projects).where(eq(synced_projects.user_id, userId));
      });
    }
  };
}

function resolveStore(deps: SyncDeps): SyncStore {
  if (deps.syncStore !== undefined) {
    return deps.syncStore;
  }
  if (deps.db === undefined) {
    throw new Error("registerSync requires db or syncStore");
  }
  return createDrizzleSyncStore(deps.db);
}

export async function registerSync(app: FastifyInstance, deps: SyncDeps): Promise<void> {
  const store = resolveStore(deps);

  app.post("/api/sync", async (request, reply) => {
    if (!isSyncEncryptionConfigured(deps.env)) {
      return reply.code(503).send({ error: "sync_disabled" });
    }

    const userId = await requireDevice(store, request);
    if (userId === undefined) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const parsed = SyncSetSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_sync_payload" });
    }
    if (!verifyContentHashes(parsed.data)) {
      return reply.code(400).send({ error: "invalid_sync_payload" });
    }

    const merged = await store.mergeUserSyncSet(userId, parsed.data, deps.env);
    return reply.code(200).send(merged);
  });

  app.delete("/api/sync", async (request, reply) => {
    if (!isSyncEncryptionConfigured(deps.env)) {
      return reply.code(503).send({ error: "sync_disabled" });
    }

    const userId = await requireDevice(store, request);
    if (userId === undefined) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    await store.clearUserSyncSet(userId);
    return reply.code(200).send({ ok: true });
  });
}
