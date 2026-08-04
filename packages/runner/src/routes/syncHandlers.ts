import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  ContextDocument,
  ProjectRecord,
  SyncDisablePayload,
  SyncDisableResult,
  SyncDocument,
  SyncNowPayload,
  SyncNowResult,
  SyncProject,
  SyncSet,
  SyncSetSchema,
  SourceType
} from "@jasojeon/shared";
import { RunnerContext } from "../runnerContext";

interface LocalSyncDocuments {
  readonly documents: readonly SyncDocument[];
  readonly keys: ReadonlySet<string>;
  readonly profileIdToSha: ReadonlyMap<string, string>;
  readonly profileShaToId: Map<string, string>;
}

export function projectRefsToSha256(
  record: ProjectRecord,
  idToSha: ReadonlyMap<string, string>
): ProjectRecord {
  return {
    ...record,
    experienceRefs: {
      ...record.experienceRefs,
      profileDocumentIds: record.experienceRefs.profileDocumentIds.flatMap((documentId) => {
        const sha = idToSha.get(documentId);
        return sha ? [sha] : [];
      })
    }
  };
}

export function projectRefsToLocalIds(
  record: ProjectRecord,
  shaToId: ReadonlyMap<string, string>
): ProjectRecord {
  return {
    ...record,
    experienceRefs: {
      ...record.experienceRefs,
      profileDocumentIds: record.experienceRefs.profileDocumentIds.flatMap((sha) => {
        const documentId = shaToId.get(sha);
        return documentId ? [documentId] : [];
      })
    }
  };
}

export async function syncNow(
  ctx: RunnerContext,
  _payload: SyncNowPayload
): Promise<SyncNowResult> {
  const hosted = requireHostedSync(ctx);
  const storage = ctx.storage();
  const local = await collectLocalSyncDocuments(ctx);
  const projects = await storage.listProjects();
  const outgoing: SyncSet = SyncSetSchema.parse({
    documents: local.documents,
    projects: projects.map((record): SyncProject => ({
      slug: record.slug,
      record: projectRefsToSha256(record, local.profileIdToSha),
      updatedAt: record.updatedAt
    }))
  });

  const merged = await postSyncSet(hosted, outgoing);
  const localKeys = new Set(local.keys);
  const profileShaToId = new Map(local.profileShaToId);

  for (const document of merged.documents.filter((item) => item.scope === "profile")) {
    await importMergedDocument(ctx, document, localKeys, profileShaToId);
  }

  for (const document of merged.documents.filter((item) => item.scope === "project")) {
    await importMergedDocument(ctx, document, localKeys, profileShaToId);
  }

  for (const project of merged.projects) {
    await storage.updateProject(projectRefsToLocalIds(project.record, profileShaToId));
  }

  const lastSyncedAt = new Date().toISOString();
  await storage.setServerSyncState({ enabled: true, lastSyncedAt });
  await refreshSyncState(ctx);

  return {
    syncedDocuments: merged.documents.length,
    syncedProjects: merged.projects.length,
    lastSyncedAt
  };
}

export async function syncDisable(
  ctx: RunnerContext,
  _payload: SyncDisablePayload
): Promise<SyncDisableResult> {
  const hosted = requireHostedSync(ctx);
  const response = await fetch(`${hosted.backendUrl}/api/sync`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${hosted.deviceToken}`
    }
  });

  if (!response.ok) {
    throw new Error(`server sync disable failed with status ${response.status}`);
  }

  await ctx.storage().setServerSyncState({ enabled: false });
  await refreshSyncState(ctx);
  return { ok: true };
}

function requireHostedSync(ctx: RunnerContext): { readonly backendUrl: string; readonly deviceToken: string } {
  if (!ctx.backendUrl || !ctx.deviceToken) {
    throw new Error("server sync requires hosted mode");
  }

  return {
    backendUrl: ctx.backendUrl.replace(/\/$/, ""),
    deviceToken: ctx.deviceToken
  };
}

async function collectLocalSyncDocuments(ctx: RunnerContext): Promise<LocalSyncDocuments> {
  const storage = ctx.storage();
  const profileDocuments = await storage.listProfileDocuments();
  const projects = await storage.listProjects();
  const documents: SyncDocument[] = [];
  const keys = new Set<string>();
  const profileIdToSha = new Map<string, string>();
  const profileShaToId = new Map<string, string>();

  for (const document of profileDocuments) {
    const syncDocument = await toSyncDocument(ctx, document);
    documents.push(syncDocument);
    keys.add(documentKey(syncDocument));
    profileIdToSha.set(document.id, syncDocument.contentSha256);
    profileShaToId.set(syncDocument.contentSha256, document.id);
  }

  for (const project of projects) {
    const projectDocuments = await storage.listProjectDocuments(project.slug);
    for (const document of projectDocuments) {
      const syncDocument = await toSyncDocument(ctx, document);
      documents.push(syncDocument);
      keys.add(documentKey(syncDocument));
    }
  }

  return { documents, keys, profileIdToSha, profileShaToId };
}

async function toSyncDocument(ctx: RunnerContext, document: ContextDocument): Promise<SyncDocument> {
  const bytes = await fs.readFile(ctx.storage().resolveStoredPath(document.rawPath));
  const contentSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  return {
    scope: document.scope,
    projectSlug: document.projectSlug,
    contentSha256,
    title: document.title,
    sourceType: document.sourceType,
    pinnedByDefault: document.pinnedByDefault,
    note: document.note ?? undefined,
    createdAt: document.createdAt,
    contentBase64: bytes.toString("base64")
  };
}

async function postSyncSet(
  hosted: { readonly backendUrl: string; readonly deviceToken: string },
  syncSet: SyncSet
): Promise<SyncSet> {
  const response = await fetch(`${hosted.backendUrl}/api/sync`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${hosted.deviceToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(syncSet)
  });

  if (!response.ok) {
    throw new Error(`server sync failed with status ${response.status}`);
  }

  const body: unknown = await response.json();
  return SyncSetSchema.parse(body);
}

async function importMergedDocument(
  ctx: RunnerContext,
  document: SyncDocument,
  localKeys: Set<string>,
  profileShaToId: Map<string, string>
): Promise<void> {
  const key = documentKey(document);
  if (localKeys.has(key)) {
    return;
  }

  const bytes = Buffer.from(document.contentBase64, "base64");
  if (document.scope === "profile") {
    const imported = await ctx.storage().importProfileUpload(
      filenameFromDocument(document.title, document.sourceType),
      bytes,
      document.pinnedByDefault,
      document.note
    );
    profileShaToId.set(document.contentSha256, imported.id);
  } else {
    if (!document.projectSlug) {
      throw new Error("sync response missing project slug for project document");
    }
    await ctx.storage().importProjectUpload(
      document.projectSlug,
      filenameFromDocument(document.title, document.sourceType),
      bytes,
      document.pinnedByDefault,
      document.note
    );
  }

  localKeys.add(key);
}

function documentKey(document: Pick<SyncDocument, "scope" | "projectSlug" | "contentSha256">): string {
  return `${document.scope}\u0000${document.projectSlug ?? ""}\u0000${document.contentSha256}`;
}

function filenameFromDocument(title: string, sourceType: SourceType | string): string {
  const trimmedTitle = title.trim() || "document";
  if (path.extname(trimmedTitle)) {
    return trimmedTitle;
  }

  return `${trimmedTitle}${extensionForSourceType(sourceType)}`;
}

function extensionForSourceType(sourceType: SourceType | string): string {
  switch (sourceType) {
    case "md":
      return ".md";
    case "pdf":
      return ".pdf";
    case "pptx":
      return ".pptx";
    case "image":
      return ".png";
    case "other":
      return ".bin";
    case "text":
    case "txt":
    default:
      return ".txt";
  }
}

async function refreshSyncState(ctx: RunnerContext): Promise<void> {
  await Promise.all([
    ctx.stateStore.refreshProfileDocuments(),
    ctx.stateStore.refreshProjects(),
    ctx.stateStore.refreshPreferences()
  ]);
  await ctx.pushState();
}
