import {
  collectCompanySourceBundle,
  type CompanySourceManifest,
  generateInsightArtifacts,
  fetchAndExtractJobPosting,
  isJobPostingFetchError,
  OpenDartClient,
  OpenDartCompanyResolution,
  projectInsightArtifactDefinitions,
  type ProjectInsightInput,
  type ProjectInsightWorkspaceState
} from "@jasojeon/shared";
import { openDartSecretKey, RunnerContext } from "../runnerContext";

// ---------------------------------------------------------------------------
// Insights service logic
//
// This is the hosted-mode handler layer for the three insight entry points
// (analyze_posting, analyze_insights, generate_insights, get_project_insights).
// The long-running LLM ops call these with `runInBackground: true` so the
// caller can return a jobId immediately and let the state_snapshot event
// deliver the final result.
// ---------------------------------------------------------------------------

export interface AnalyzeProjectInsightsInput {
  readonly projectSlug: string;
  readonly patch?: Record<string, unknown>;
}

export async function analyzeProjectInsightsService(
  ctx: RunnerContext,
  input: AnalyzeProjectInsightsInput
): Promise<void> {
  const storage = ctx.storage();
  const baseProject = input.patch
    ? await storage.updateProjectInfo(input.projectSlug, buildProjectInput(input.patch))
    : await storage.getProject(input.projectSlug);

  try {
    const extraction = await fetchAndExtractJobPosting({
      jobPostingUrl: baseProject.jobPostingUrl,
      jobPostingText: baseProject.jobPostingText,
      seedCompanyName: baseProject.companyName,
      seedRoleName: baseProject.roleName
    });

    await storage.saveProjectInsightJson(input.projectSlug, "job-extraction.json", extraction);
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

export async function generateProjectInsightsService(
  ctx: RunnerContext,
  input: AnalyzeProjectInsightsInput
): Promise<void> {
  const storage = ctx.storage();
  let project = input.patch
    ? await storage.updateProjectInfo(input.projectSlug, buildProjectInput(input.patch))
    : await storage.getProject(input.projectSlug);

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
      await storage.saveProjectInsightJson(input.projectSlug, "job-extraction.json", extraction);
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
      await storage.saveProjectInsightJson(input.projectSlug, "company-enrichment.json", companyResolution);

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
      await storage.saveProjectInsightJson(input.projectSlug, "company-enrichment.json", {
        status: "error",
        message
      });
    }
  }

  const companySourceBundle = await collectCompanySourceBundle(project, companyResolution);
  await storage.saveProjectInsightJson(input.projectSlug, "company-source-manifest.json", companySourceBundle.manifest);
  await storage.saveProjectInsightJson(input.projectSlug, "company-source-snippets.json", companySourceBundle.snippets);

  const preferences = await storage.getPreferences();
  const generated = await generateInsightArtifacts(
    ctx.registry(),
    ctx.storageRoot,
    project,
    companyResolution,
    companySourceBundle,
    preferences.lastCoordinatorProvider
  );
  const generatedNote = `Generated by Jasojeon insight pre-pass using ${generated.providerId}. Regenerate to refresh source-backed insights.`;

  await storage.saveOrUpdateProjectGeneratedDocument(input.projectSlug, "company-insight.md", generated.artifacts["company-insight.md"], generatedNote);
  await storage.saveOrUpdateProjectGeneratedDocument(input.projectSlug, "job-insight.md", generated.artifacts["job-insight.md"], generatedNote);
  await storage.saveOrUpdateProjectGeneratedDocument(input.projectSlug, "application-strategy.md", generated.artifacts["application-strategy.md"], generatedNote);
  await storage.saveOrUpdateProjectGeneratedDocument(input.projectSlug, "question-analysis.md", generated.artifacts["question-analysis.md"], generatedNote);
  await storage.saveProjectInsightJson(input.projectSlug, "company-profile.json", generated.companyProfile);
  await storage.saveProjectInsightJson(input.projectSlug, "insight-sources.json", {
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

export async function buildInsightWorkspaceStateService(
  ctx: RunnerContext,
  projectSlug: string
): Promise<ProjectInsightWorkspaceState> {
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

function buildProjectInput(body: Record<string, unknown>): ProjectInsightInput {
  const asString = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;
  const asStringArray = (value: unknown): string[] | undefined => Array.isArray(value)
    ? value.map((item) => String(item)).filter(Boolean)
    : undefined;
  const hasField = (field: string): boolean => Object.prototype.hasOwnProperty.call(body, field);
  const input: ProjectInsightInput = {
    companyName: String(body.companyName ?? "")
  };

  const stringFields = [
    "roleName",
    "deadline",
    "overview",
    "mainResponsibilities",
    "qualifications",
    "preferredQualifications",
    "benefits",
    "hiringProcess",
    "insiderView",
    "otherInfo",
    "jobPostingUrl",
    "jobPostingText",
    "openDartCorpCode"
  ] as const;
  for (const field of stringFields) {
    if (hasField(field)) {
      input[field] = asString(body[field]);
    }
  }
  if (hasField("keywords")) {
    input["keywords"] = asStringArray(body["keywords"]);
  }
  if (hasField("essayQuestions")) {
    input["essayQuestions"] = asStringArray(body["essayQuestions"]);
  }

  return input;
}

function buildJobPostingFallbackMessage(error: unknown): string {
  if (isJobPostingFetchError(error)) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}
