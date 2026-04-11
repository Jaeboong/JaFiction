import { Router } from "express";
import {
  collectCompanySourceBundle,
  type CompanySourceManifest,
  generateInsightArtifacts,
  fetchAndExtractJobPosting,
  isJobPostingFetchError,
  OpenDartClient,
  OpenDartCompanyResolution,
  projectInsightArtifactDefinitions,
  type ProjectInsightWorkspaceState
} from "@jafiction/shared";
import { openDartSecretKey, RunnerContext } from "../runnerContext";

export function createInsightsRouter(ctx: RunnerContext): Router {
  const router = Router({ mergeParams: true });

  router.post("/analyze", async (request, response, next) => {
    try {
      const { projectSlug } = request.params as { projectSlug: string };
      await ctx.runBusy("지원 공고를 분석하는 중...", async () => {
        await analyzeProjectInsights(ctx, projectSlug, request.body as Record<string, unknown>);
        await ctx.stateStore.refreshProjects(projectSlug);
      });
      response.json(await ctx.storage().getProject(projectSlug));
    } catch (error) {
      next(error);
    }
  });

  router.post("/generate", async (request, response, next) => {
    try {
      const { projectSlug } = request.params as { projectSlug: string };
      await ctx.runBusy("인사이트 문서를 생성하는 중...", async () => {
        await generateProjectInsights(ctx, projectSlug, request.body as Record<string, unknown>);
        await ctx.stateStore.refreshProjects(projectSlug);
      });
      response.json(await buildInsightWorkspaceState(ctx, projectSlug));
    } catch (error) {
      next(error);
    }
  });

  router.get("/", async (request, response, next) => {
    try {
      const { projectSlug } = request.params as { projectSlug: string };
      response.json(await buildInsightWorkspaceState(ctx, projectSlug));
    } catch (error) {
      next(error);
    }
  });

  return router;
}

async function analyzeProjectInsights(
  ctx: RunnerContext,
  projectSlug: string,
  body: Record<string, unknown>
): Promise<void> {
  const storage = ctx.storage();
  const baseProject = await storage.updateProjectInfo(projectSlug, buildProjectInput(body));

  try {
    const extraction = await fetchAndExtractJobPosting({
      jobPostingUrl: baseProject.jobPostingUrl,
      jobPostingText: baseProject.jobPostingText,
      seedCompanyName: baseProject.companyName,
      seedRoleName: baseProject.roleName
    });

    await storage.saveProjectInsightJson(projectSlug, "job-extraction.json", extraction);
    await storage.updateProject({
      ...baseProject,
      companyName: extraction.companyName || baseProject.companyName,
      roleName: extraction.roleName || baseProject.roleName,
      deadline: extraction.deadline || baseProject.deadline,
      mainResponsibilities: extraction.mainResponsibilities || baseProject.mainResponsibilities,
      qualifications: extraction.qualifications || baseProject.qualifications,
      preferredQualifications: extraction.preferredQualifications || baseProject.preferredQualifications,
      keywords: extraction.keywords.length > 0 ? extraction.keywords : baseProject.keywords,
      jobPostingText: extraction.normalizedText,
      postingAnalyzedAt: extraction.fetchedAt,
      jobPostingManualFallback: false,
      insightStatus: "reviewNeeded",
      insightLastError: extraction.warnings.length > 0 ? extraction.warnings.join(" ") : undefined,
      openDartCandidates: undefined
    });
  } catch (error) {
    await storage.updateProject({
      ...baseProject,
      jobPostingManualFallback: true,
      insightStatus: "reviewNeeded",
      insightLastError: buildJobPostingFallbackMessage(error)
    });
  }
}

async function generateProjectInsights(
  ctx: RunnerContext,
  projectSlug: string,
  body: Record<string, unknown>
): Promise<void> {
  const storage = ctx.storage();
  let project = await storage.updateProjectInfo(projectSlug, buildProjectInput(body));

  if (!project.essayQuestions?.length) {
    throw new Error("인사이트를 생성하려면 에세이 질문을 한 개 이상 입력하세요.");
  }

  if (!project.jobPostingText?.trim() && !project.jobPostingUrl?.trim()) {
    throw new Error("인사이트를 생성하려면 지원 공고 URL 또는 수동 입력 공고 텍스트가 필요합니다.");
  }

  if (!project.jobPostingText?.trim() && project.jobPostingUrl?.trim()) {
    try {
      const extraction = await fetchAndExtractJobPosting({
        jobPostingUrl: project.jobPostingUrl,
        seedCompanyName: project.companyName,
        seedRoleName: project.roleName
      });
      await storage.saveProjectInsightJson(projectSlug, "job-extraction.json", extraction);
      project = await storage.updateProject({
        ...project,
        companyName: extraction.companyName || project.companyName,
        roleName: extraction.roleName || project.roleName,
        deadline: extraction.deadline || project.deadline,
        mainResponsibilities: extraction.mainResponsibilities || project.mainResponsibilities,
        qualifications: extraction.qualifications || project.qualifications,
        preferredQualifications: extraction.preferredQualifications || project.preferredQualifications,
        keywords: extraction.keywords.length > 0 ? extraction.keywords : project.keywords,
        jobPostingText: extraction.normalizedText,
        postingAnalyzedAt: extraction.fetchedAt,
        jobPostingManualFallback: false
      });
    } catch (error) {
      await storage.updateProject({
        ...project,
        jobPostingManualFallback: true,
        insightStatus: "reviewNeeded",
        insightLastError: buildJobPostingFallbackMessage(error)
      });
      return;
    }
  }

  project = await storage.updateProject({
    ...project,
    insightStatus: "generating",
    insightLastError: undefined
  });

  let companyResolution: OpenDartCompanyResolution | undefined;
  const openDartApiKey = await ctx.secrets().get(openDartSecretKey);
  if (openDartApiKey) {
    try {
      const openDart = new OpenDartClient(ctx.storageRoot, openDartApiKey);
      companyResolution = await openDart.resolveAndFetchCompany(project.companyName, project.openDartCorpCode);
      await storage.saveProjectInsightJson(projectSlug, "company-enrichment.json", companyResolution);

      if (companyResolution.status === "ambiguous") {
        await storage.updateProject({
          ...project,
          openDartCandidates: companyResolution.candidates,
          insightStatus: "reviewNeeded",
          insightLastError: "OpenDART 회사 매칭 후보를 선택한 뒤 다시 생성하세요."
        });
        return;
      }

      if (companyResolution.status === "resolved") {
        project = await storage.updateProject({
          ...project,
          openDartCorpCode: companyResolution.match.corpCode,
          openDartCorpName: companyResolution.match.corpName,
          openDartStockCode: companyResolution.match.stockCode,
          openDartCandidates: undefined
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      companyResolution = {
        status: "unavailable",
        notices: [`OpenDART enrichment failed: ${message}`]
      };
      await storage.saveProjectInsightJson(projectSlug, "company-enrichment.json", {
        status: "error",
        message
      });
    }
  }

  const companySourceBundle = await collectCompanySourceBundle(project, companyResolution);
  await storage.saveProjectInsightJson(projectSlug, "company-source-manifest.json", companySourceBundle.manifest);
  await storage.saveProjectInsightJson(projectSlug, "company-source-snippets.json", companySourceBundle.snippets);

  const preferences = await storage.getPreferences();
  const generated = await generateInsightArtifacts(
    ctx.registry(),
    ctx.storageRoot,
    project,
    companyResolution,
    companySourceBundle,
    preferences.lastCoordinatorProvider
  );
  const generatedNote = `Generated by JaFiction insight pre-pass using ${generated.providerId}. Regenerate to refresh source-backed insights.`;

  await storage.saveOrUpdateProjectGeneratedDocument(projectSlug, "company-insight.md", generated.artifacts["company-insight.md"], generatedNote);
  await storage.saveOrUpdateProjectGeneratedDocument(projectSlug, "job-insight.md", generated.artifacts["job-insight.md"], generatedNote);
  await storage.saveOrUpdateProjectGeneratedDocument(projectSlug, "application-strategy.md", generated.artifacts["application-strategy.md"], generatedNote);
  await storage.saveOrUpdateProjectGeneratedDocument(projectSlug, "question-analysis.md", generated.artifacts["question-analysis.md"], generatedNote);
  await storage.saveProjectInsightJson(projectSlug, "company-profile.json", generated.companyProfile);
  await storage.saveProjectInsightJson(projectSlug, "insight-sources.json", {
    generatedAt: new Date().toISOString(),
    providerId: generated.providerId,
    openDartStatus: companyResolution?.status ?? "notAttempted",
    companySourceCoverage: companySourceBundle.manifest.coverage,
    companyName: project.companyName,
    roleName: project.roleName,
    essayQuestions: project.essayQuestions
  });
  await storage.updateProject({
    ...project,
    jobPostingManualFallback: false,
    insightStatus: "ready",
    insightLastGeneratedAt: new Date().toISOString(),
    insightLastError:
      companyResolution?.status === "notFound" || companyResolution?.status === "unavailable"
        ? companyResolution.notices.join(" ")
        : undefined
  });
}

async function buildInsightWorkspaceState(ctx: RunnerContext, projectSlug: string): Promise<ProjectInsightWorkspaceState> {
  const storage = ctx.storage();
  const project = await storage.getProject(projectSlug);
  const documents = await storage.listProjectDocuments(projectSlug);
  const companySourceManifest = await storage.readProjectInsightJson<CompanySourceManifest>(projectSlug, "company-source-manifest.json");

  const views = await Promise.all(projectInsightArtifactDefinitions.map(async (item) => {
    const document = documents.find((candidate) => candidate.title === item.fileName);
    const preview = document
      ? await storage.readDocumentPreviewContent(document)
      : { content: "", previewSource: "none" as const };
    return {
      key: item.key,
      tabLabel: item.tabLabel,
      title: item.tabLabel,
      fileName: item.fileName,
      content: preview.content,
      available: Boolean(preview.content.trim())
    };
  }));

  return {
    projectSlug: project.slug,
    companyName: project.companyName,
    roleName: project.roleName,
    jobPostingUrl: project.jobPostingUrl,
    postingAnalyzedAt: project.postingAnalyzedAt,
    insightLastGeneratedAt: project.insightLastGeneratedAt,
    openDartCorpName: project.openDartCorpName,
    openDartStockCode: project.openDartStockCode,
    companySourceManifest,
    documents: views
  };
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
    mainResponsibilities?: string;
    qualifications?: string;
    preferredQualifications?: string;
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
  if (hasField("mainResponsibilities")) {
    input.mainResponsibilities = asString(body.mainResponsibilities);
  }
  if (hasField("qualifications")) {
    input.qualifications = asString(body.qualifications);
  }
  if (hasField("preferredQualifications")) {
    input.preferredQualifications = asString(body.preferredQualifications);
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

function buildJobPostingFallbackMessage(error: unknown): string {
  if (isJobPostingFetchError(error)) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
