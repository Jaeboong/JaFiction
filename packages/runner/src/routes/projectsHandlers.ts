import {
  GetProjectPayload,
  GetProjectResult,
  ListProjectsPayload,
  ListProjectsResult,
  SaveProjectPayload,
  SaveProjectResult,
  UploadDocumentPayload,
  UploadDocumentResult,
  DeleteDocumentPayload,
  DeleteDocumentResult
} from "@jafiction/shared";
import { RunnerContext } from "../runnerContext";

export async function listProjects(
  ctx: RunnerContext,
  _payload: ListProjectsPayload
): Promise<ListProjectsResult> {
  const projects = await ctx.storage().listProjects();
  return { projects };
}

export async function getProject(
  ctx: RunnerContext,
  payload: GetProjectPayload
): Promise<GetProjectResult> {
  return ctx.storage().getProject(payload.slug);
}

export async function saveProject(
  ctx: RunnerContext,
  payload: SaveProjectPayload
): Promise<SaveProjectResult> {
  const { slug, patch } = payload;
  await ctx.runBusy("프로젝트 정보를 업데이트하는 중...", async () => {
    // updateProjectInfo requires companyName; fetch current value as fallback
    const current = await ctx.storage().getProject(slug);
    await ctx.storage().updateProjectInfo(slug, {
      companyName: patch.companyName ?? current.companyName,
      ...patch
    });
    await ctx.stateStore.refreshProjects(slug);
  });
  return ctx.storage().getProject(slug);
}

export async function uploadDocument(
  ctx: RunnerContext,
  payload: UploadDocumentPayload
): Promise<UploadDocumentResult> {
  const { slug, filename, contentBase64 } = payload;
  const buffer = Buffer.from(contentBase64, "base64");
  let documentId = "";
  await ctx.runBusy("프로젝트 파일을 가져오는 중...", async () => {
    await ctx.storage().importProjectUpload(slug, filename, buffer);
    await ctx.stateStore.refreshProjects(slug);
  });
  const documents = await ctx.storage().listProjectDocuments(slug);
  const match = documents.find((doc) => doc.title === filename || doc.title.endsWith(filename));
  documentId = match?.id ?? documents[documents.length - 1]?.id ?? "";
  return { docId: documentId };
}

export async function deleteDocument(
  ctx: RunnerContext,
  payload: DeleteDocumentPayload
): Promise<DeleteDocumentResult> {
  const { slug, docId } = payload;
  await ctx.runBusy("프로젝트 문서를 삭제하는 중...", async () => {
    await ctx.storage().deleteProjectDocument(slug, docId);
    await ctx.stateStore.refreshProjects(slug);
  });
  return { ok: true };
}
