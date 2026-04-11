import { Router } from "express";
import multer from "multer";
import { fetchAndExtractJobPosting } from "@jasojeon/shared";
import { RunnerContext } from "../runnerContext";

const upload = multer({ storage: multer.memoryStorage() });

export function createProjectsRouter(ctx: RunnerContext): Router {
  const router = Router();

  router.post("/analyze-posting", async (request, response, next) => {
    try {
      const payload = buildJobPostingAnalysisInput(request.body as Record<string, unknown>);
      if (!payload.jobPostingUrl) {
        throw new Error("채용 공고 URL을 입력하세요.");
      }

      let extraction;
      await ctx.runBusy("지원 공고를 분석하는 중...", async () => {
        extraction = await fetchAndExtractJobPosting(payload);
      });
      response.json(extraction);
    } catch (error) {
      next(error);
    }
  });

  router.get("/", async (_request, response, next) => {
    try {
      response.json(await ctx.storage().listProjects());
    } catch (error) {
      next(error);
    }
  });

  router.post("/", async (request, response, next) => {
    try {
      const payload = buildProjectInput(request.body as Record<string, unknown>);
      let slug = "";
      await ctx.runBusy("프로젝트를 만드는 중...", async () => {
        const project = await ctx.storage().createProject(payload);
        slug = project.slug;
        await ctx.stateStore.refreshProjects();
      });
      response.status(201).json(await ctx.storage().getProject(slug));
    } catch (error) {
      next(error);
    }
  });

  router.get("/:projectSlug", async (request, response, next) => {
    try {
      response.json(await ctx.storage().getProject(String(request.params.projectSlug)));
    } catch (error) {
      next(error);
    }
  });

  router.put("/:projectSlug", async (request, response, next) => {
    try {
      const projectSlug = String(request.params.projectSlug);
      const payload = buildProjectInput(request.body as Record<string, unknown>);
      await ctx.runBusy("프로젝트 정보를 업데이트하는 중...", async () => {
        await ctx.storage().updateProjectInfo(projectSlug, payload);
        await ctx.stateStore.refreshProjects(projectSlug);
      });
      response.json(await ctx.storage().getProject(projectSlug));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:projectSlug", async (request, response, next) => {
    try {
      const projectSlug = String(request.params.projectSlug);
      await ctx.runBusy("프로젝트를 삭제하는 중...", async () => {
        await ctx.storage().deleteProject(projectSlug);
        await ctx.stateStore.refreshProjects();
      });
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get("/:projectSlug/documents", async (request, response, next) => {
    try {
      response.json(await ctx.storage().listProjectDocuments(String(request.params.projectSlug)));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:projectSlug/documents", async (request, response, next) => {
    try {
      const projectSlug = String(request.params.projectSlug);
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
      await ctx.runBusy("프로젝트 텍스트를 저장하는 중...", async () => {
        const document = await ctx.storage().saveProjectTextDocument(
          projectSlug,
          title,
          content ?? "",
          Boolean(pinnedByDefault),
          note
        );
        documentId = document.id;
        await ctx.stateStore.refreshProjects(projectSlug);
      });

      response.status(201).json(await ctx.storage().getProjectDocument(projectSlug, documentId));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:projectSlug/documents/upload", upload.array("files"), async (request, response, next) => {
    try {
      const projectSlug = String(request.params.projectSlug);
      const files = request.files as Express.Multer.File[] | undefined;
      if (!files?.length) {
        throw new Error("업로드할 파일이 없습니다.");
      }

      await ctx.runBusy("프로젝트 파일을 가져오는 중...", async () => {
        for (const file of files) {
          const fileName = Buffer.from(file.originalname, "latin1").toString("utf8");
          await ctx.storage().importProjectUpload(projectSlug, fileName, file.buffer);
        }
        await ctx.stateStore.refreshProjects(projectSlug);
      });

      response.status(201).json(await ctx.storage().listProjectDocuments(projectSlug));
    } catch (error) {
      next(error);
    }
  });

  router.get("/:projectSlug/documents/:documentId", async (request, response, next) => {
    try {
      const projectSlug = String(request.params.projectSlug);
      const documentId = String(request.params.documentId);
      const document = await ctx.storage().getProjectDocument(projectSlug, documentId);
      response.json({
        projectSlug,
        documentId: document.id,
        title: document.title,
        note: document.note || "",
        pinnedByDefault: document.pinnedByDefault,
        sourceType: document.sourceType,
        content: (await ctx.storage().readDocumentRawContent(document)) || "",
        contentEditable: ["text", "txt", "md"].includes(document.sourceType)
      });
    } catch (error) {
      next(error);
    }
  });

  router.put("/:projectSlug/documents/:documentId", async (request, response, next) => {
    try {
      const projectSlug = String(request.params.projectSlug);
      const documentId = String(request.params.documentId);
      const { title, note, pinnedByDefault, content } = request.body as {
        title?: string;
        note?: string;
        pinnedByDefault?: boolean;
        content?: string;
      };
      await ctx.runBusy("프로젝트 문서를 업데이트하는 중...", async () => {
        const current = await ctx.storage().getProjectDocument(projectSlug, documentId);
        await ctx.storage().updateProjectDocument(projectSlug, documentId, {
          title: title ?? current.title,
          note,
          pinnedByDefault: pinnedByDefault ?? current.pinnedByDefault,
          content
        });
        await ctx.stateStore.refreshProjects(projectSlug);
      });
      response.json(await ctx.storage().getProjectDocument(projectSlug, documentId));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:projectSlug/documents/:documentId", async (request, response, next) => {
    try {
      const projectSlug = String(request.params.projectSlug);
      const documentId = String(request.params.documentId);
      await ctx.runBusy("프로젝트 문서를 삭제하는 중...", async () => {
        await ctx.storage().deleteProjectDocument(projectSlug, documentId);
        await ctx.stateStore.refreshProjects(projectSlug);
      });
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.patch("/:projectSlug/documents/:documentId/pinned", async (request, response, next) => {
    try {
      const projectSlug = String(request.params.projectSlug);
      const documentId = String(request.params.documentId);
      await ctx.runBusy("문서 기본 포함 상태를 업데이트하는 중...", async () => {
        await ctx.storage().setProjectDocumentPinned(projectSlug, documentId, Boolean(request.body?.pinned));
        await ctx.stateStore.refreshProjects(projectSlug);
      });
      response.json(await ctx.storage().getProjectDocument(projectSlug, documentId));
    } catch (error) {
      next(error);
    }
  });

  router.put("/:projectSlug/rubric", async (request, response, next) => {
    try {
      const projectSlug = String(request.params.projectSlug);
      const rubric = String(request.body?.rubric ?? "");
      await ctx.runBusy("평가 기준을 저장하는 중...", async () => {
        await ctx.storage().updateProjectRubric(projectSlug, rubric);
        await ctx.stateStore.refreshProjects(projectSlug);
      });
      response.json(await ctx.storage().getProject(projectSlug));
    } catch (error) {
      next(error);
    }
  });

  router.put("/:projectSlug/essay-draft/:questionIndex", async (request, response, next) => {
    try {
      const projectSlug = String(request.params.projectSlug);
      const questionIndex = Number.parseInt(String(request.params.questionIndex), 10);
      const draft = request.body?.draft;
      if (!Number.isInteger(questionIndex) || questionIndex < 0) {
        throw new Error("유효한 문항 인덱스가 필요합니다.");
      }
      if (typeof draft !== "string") {
        throw new Error("저장할 초안 텍스트가 필요합니다.");
      }

      await ctx.runBusy("초안을 저장하는 중...", async () => {
        const project = await ctx.storage().getProject(projectSlug);
        const question = project.essayQuestions?.[questionIndex];
        if (!question) {
          throw new Error("선택한 문항을 찾을 수 없습니다.");
        }

        await ctx.storage().saveCompletedEssayAnswer(projectSlug, questionIndex, question, draft);
        await ctx.stateStore.refreshProjects(projectSlug);
        await ctx.pushState();
      });

      response.json({ questionIndex });
    } catch (error) {
      next(error);
    }
  });

  router.get("/:projectSlug/runs", async (request, response, next) => {
    try {
      response.json(await ctx.storage().listRuns(String(request.params.projectSlug)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/:projectSlug/runs/:runId", async (request, response, next) => {
    try {
      const projectSlug = String(request.params.projectSlug);
      const runId = String(request.params.runId);
      response.json(await ctx.storage().getRun(projectSlug, runId));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:projectSlug/runs/:runId", async (request, response, next) => {
    try {
      const projectSlug = String(request.params.projectSlug);
      const runId = String(request.params.runId);
      await ctx.runBusy("실행 기록을 삭제하는 중...", async () => {
        await ctx.storage().deleteRun(projectSlug, runId);
        await ctx.stateStore.refreshProjects(projectSlug);
      });
      response.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  router.get("/:projectSlug/runs/:runId/artifacts/:fileName", async (request, response, next) => {
    try {
      const projectSlug = String(request.params.projectSlug);
      const runId = String(request.params.runId);
      const fileName = String(request.params.fileName);
      const content = await ctx.storage().readOptionalRunArtifact(projectSlug, runId, fileName);
      if (typeof content !== "string") {
        response.status(404).json({ error: "artifact_not_found" });
        return;
      }
      response.type(fileName.endsWith(".json") ? "application/json" : "text/plain").send(content);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

function buildProjectInput(body: Record<string, unknown>) {
  const asString = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;
  const asStringArray = (value: unknown): string[] | undefined => Array.isArray(value)
    ? value.map((item) => String(item)).filter(Boolean)
    : undefined;
  const hasField = (field: string): boolean => Object.prototype.hasOwnProperty.call(body, field);
  const input: {
    companyName: string;
    roleName?: string;
    deadline?: string;
    overview?: string;
    mainResponsibilities?: string;
    qualifications?: string;
    preferredQualifications?: string;
    benefits?: string;
    hiringProcess?: string;
    insiderView?: string;
    otherInfo?: string;
    keywords?: string[];
    jobPostingUrl?: string;
    jobPostingText?: string;
    essayQuestions?: string[];
    openDartCorpCode?: string;
  } = {
    companyName: String(body.companyName ?? "")
  };

  if (hasField("roleName")) {
    input.roleName = asString(body.roleName);
  }
  if (hasField("deadline")) {
    input.deadline = asString(body.deadline);
  }
  if (hasField("overview")) {
    input.overview = asString(body.overview);
  }
  if (hasField("mainResponsibilities")) {
    input.mainResponsibilities = asString(body.mainResponsibilities);
  }
  if (hasField("qualifications")) {
    input.qualifications = asString(body.qualifications);
  }
  if (hasField("preferredQualifications")) {
    input.preferredQualifications = asString(body.preferredQualifications);
  }
  if (hasField("benefits")) {
    input.benefits = asString(body.benefits);
  }
  if (hasField("hiringProcess")) {
    input.hiringProcess = asString(body.hiringProcess);
  }
  if (hasField("insiderView")) {
    input.insiderView = asString(body.insiderView);
  }
  if (hasField("otherInfo")) {
    input.otherInfo = asString(body.otherInfo);
  }
  if (hasField("keywords")) {
    input.keywords = asStringArray(body.keywords);
  }
  if (hasField("jobPostingUrl")) {
    input.jobPostingUrl = asString(body.jobPostingUrl);
  }
  if (hasField("jobPostingText")) {
    input.jobPostingText = asString(body.jobPostingText);
  }
  if (hasField("essayQuestions")) {
    input.essayQuestions = asStringArray(body.essayQuestions);
  }
  if (hasField("openDartCorpCode")) {
    input.openDartCorpCode = asString(body.openDartCorpCode);
  }

  return input;
}

function buildJobPostingAnalysisInput(body: Record<string, unknown>) {
  const asString = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;
  return {
    jobPostingUrl: asString(body.jobPostingUrl),
    jobPostingText: asString(body.jobPostingText),
    seedCompanyName: asString(body.companyName),
    seedRoleName: asString(body.roleName)
  };
}
