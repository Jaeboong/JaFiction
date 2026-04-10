import { Router } from "express";
import multer from "multer";
import { RunnerContext } from "../runnerContext";

const upload = multer({ storage: multer.memoryStorage() });

export function createProfileRouter(ctx: RunnerContext): Router {
  const router = Router();

  router.get("/documents", async (_request, response, next) => {
    try {
      response.json(await ctx.storage().listProfileDocuments());
    } catch (error) {
      next(error);
    }
  });

  router.post("/documents", async (request, response, next) => {
    try {
      const { title, content, note, pinnedByDefault } = request.body as {
        title?: string;
        content?: string;
        note?: string;
        pinnedByDefault?: boolean;
      };
      if (!title?.trim()) {
        throw new Error("문서 제목이 필요합니다.");
      }

      let documentId = "";
      await ctx.runBusy("프로필 텍스트를 저장하는 중...", async () => {
        const document = await ctx.storage().saveProfileTextDocument(title, content ?? "", Boolean(pinnedByDefault), note);
        documentId = document.id;
        await ctx.stateStore.refreshProfileDocuments();
      });

      response.status(201).json(await ctx.storage().getProfileDocument(documentId));
    } catch (error) {
      next(error);
    }
  });

  router.post("/documents/upload", upload.array("files"), async (request, response, next) => {
    try {
      const files = request.files as Express.Multer.File[] | undefined;
      if (!files?.length) {
        throw new Error("업로드할 파일이 없습니다.");
      }

      await ctx.runBusy("프로필 파일을 가져오는 중...", async () => {
        for (const file of files) {
          const fileName = Buffer.from(file.originalname, "latin1").toString("utf8");
          await ctx.storage().importProfileUpload(fileName, file.buffer);
        }
        await ctx.stateStore.refreshProfileDocuments();
      });

      response.status(201).json(await ctx.storage().listProfileDocuments());
    } catch (error) {
      next(error);
    }
  });

  router.patch("/documents/:documentId", async (request, response, next) => {
    try {
      const { pinned } = request.body as { pinned?: boolean };
      await ctx.runBusy("기본 포함 상태를 업데이트하는 중...", async () => {
        await ctx.storage().setProfileDocumentPinned(String(request.params.documentId), Boolean(pinned));
        await ctx.stateStore.refreshProfileDocuments();
      });
      response.json(await ctx.storage().getProfileDocument(String(request.params.documentId)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/documents/:documentId/preview", async (request, response, next) => {
    try {
      const document = await ctx.storage().getProfileDocument(String(request.params.documentId));
      const preview = await ctx.storage().readDocumentPreviewContent(document);
      response.json({
        documentId: document.id,
        title: document.title,
        note: document.note || "",
        sourceType: document.sourceType,
        extractionStatus: document.extractionStatus,
        rawPath: document.rawPath,
        normalizedPath: document.normalizedPath || "",
        previewSource: preview.previewSource,
        content: preview.content
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
