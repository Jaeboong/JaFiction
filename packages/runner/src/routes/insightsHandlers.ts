import {
  collectCompanyContext,
  collectCompanySourceBundle,
  type CompanySourceManifest,
  type CompanyAnalysisPhaseResult,
  generateCompanyAnalysisPhase,
  generateSupportingInsightPhase,
  fetchAndExtractJobPosting,
  isJobPostingFetchError,
  OpenDartCompanyResolution,
  type OpenDartCandidate,
  projectInsightArtifactDefinitions,
  type ProjectInsightInput,
  type ProjectInsightWorkspaceState
} from "@jasojeon/shared";
import { createWebSearchProviderFromEnv, getServerDartApiKey, RunnerContext } from "../runnerContext";

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
  // insightStatus:"generating" 을 즉시 클라이언트에 push 해야
  // ProjectsPage 의 sawGeneratingStatusRef 가 세트된다.
  // 이 push 없이 finally 에서만 push 하면 클라이언트가 generating 을 본 적 없어
  // "ready" snapshot 을 수신해도 낙관적 잠금이 해제되지 않는다.
  await ctx.stateStore.refreshProjects(input.projectSlug);
  await ctx.pushState();

  // --- collectCompanyContext (다중 소스 수집) ---
  const skipDartRequested = project.openDartSkipRequested === true;
  const openDartApiKey = skipDartRequested ? undefined : getServerDartApiKey();
  const webSearchConfig = await ctx.config().getWebSearchConfig();
  const webProvider = webSearchConfig.enabled
    ? await createWebSearchProviderFromEnv(ctx.config())
    : undefined;
  const companyContext = await collectCompanyContext({
    project,
    hints: {
      companyName: project.companyName,
      roleName: project.roleName,
      keywords: project.keywords
    },
    storageRoot: ctx.storageRoot,
    dartApiKey: openDartApiKey,
    webProvider,
    webCacheTtlDays: webSearchConfig.cacheTtlDays
  });

  if (!skipDartRequested && companyContext.reviewNeeded?.reason === "openDartAmbiguous") {
    await storage.updateProject({
      ...project,
      openDartCandidates: [...companyContext.reviewNeeded.candidates],
      insightStatus: "reviewNeeded",
      insightLastError: "OpenDART 회사 매칭 후보를 선택한 뒤 다시 생성하세요."
    });
    return;
  }

  // dart resolution 이 resolved 이면 corpCode 등 persist
  const dartResolution = skipDartRequested
    ? ({
        status: "unavailable",
        notices: ["dart: skipped by user"]
      } satisfies OpenDartCompanyResolution)
    : companyContext.sources.dart?.resolution;
  if (dartResolution?.status === "resolved") {
    project = await storage.updateProject({
      ...project,
      openDartCorpCode: dartResolution.match.corpCode,
      openDartCorpName: dartResolution.match.corpName,
      openDartStockCode: dartResolution.match.stockCode,
      openDartCandidates: undefined
    });
  }

  if (dartResolution) {
    await storage.saveProjectInsightJson(input.projectSlug, "company-enrichment.json", dartResolution);
  }

  await storage.saveProjectInsightJson(input.projectSlug, "company-context-manifest.json", {
    collectedAt: companyContext.collectedAt,
    companyName: companyContext.companyName,
    coverage: companyContext.coverage,
    webNotes: companyContext.sources.web.notes
  });

  // legacy companyResolution 어댑터 (Stage D 이전까지 companySources / generateCompanyAnalysisPhase 호환용)
  const companyResolution: OpenDartCompanyResolution | undefined = dartResolution;

  const companySourceBundle = await collectCompanySourceBundle(project, companyResolution);
  await storage.saveProjectInsightJson(input.projectSlug, "company-source-manifest.json", companySourceBundle.manifest);
  await storage.saveProjectInsightJson(input.projectSlug, "company-source-snippets.json", companySourceBundle.snippets);

  const preferences = await storage.getPreferences();
  const agentDefaults = await ctx.config().getAgentDefaults();
  const insightAnalystConfig = agentDefaults["insight_analyst"];
  const insightPreferredProviderId = insightAnalystConfig?.providerId ?? preferences.lastCoordinatorProvider;
  const insightModelOverride = insightAnalystConfig && !insightAnalystConfig.useProviderDefaults
    ? insightAnalystConfig.modelOverride || undefined
    : undefined;
  const insightEffortOverride = insightAnalystConfig && !insightAnalystConfig.useProviderDefaults
    ? insightAnalystConfig.effortOverride || undefined
    : undefined;

  // --- Phase 1: 기업 분석 ---
  let companyPhase: CompanyAnalysisPhaseResult;
  try {
    companyPhase = await generateCompanyAnalysisPhase(
      ctx.registry(),
      ctx.storageRoot,
      project,
      companyResolution,
      companySourceBundle,
      insightPreferredProviderId,
      insightModelOverride,
      insightEffortOverride,
      companyContext
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await storage.updateProject({
      ...project,
      insightStatus: "error",
      insightLastError: `기업 분석 실패: ${message}`
    });
    return;
  }

  const generatedNote = `Generated by Jasojeon insight pre-pass using ${companyPhase.providerId}. Regenerate to refresh source-backed insights.`;

  // Phase 1 결과 즉시 저장 (Phase 2 실패해도 보존)
  await storage.saveOrUpdateProjectGeneratedDocument(input.projectSlug, "company-insight.md", companyPhase.companyInsight, generatedNote);
  await storage.saveProjectInsightJson(input.projectSlug, "company-profile.json", companyPhase.companyProfile);

  // --- Phase 2: 직무/전략/문항 분석 ---
  try {
    const supportingArtifacts = await generateSupportingInsightPhase(
      ctx.registry(),
      ctx.storageRoot,
      project,
      companyPhase,
      insightModelOverride,
      insightEffortOverride
    );

    await storage.saveOrUpdateProjectGeneratedDocument(input.projectSlug, "job-insight.md", supportingArtifacts["job-insight.md"], generatedNote);
    await storage.saveOrUpdateProjectGeneratedDocument(input.projectSlug, "application-strategy.md", supportingArtifacts["application-strategy.md"], generatedNote);
    await storage.saveOrUpdateProjectGeneratedDocument(input.projectSlug, "question-analysis.md", supportingArtifacts["question-analysis.md"], generatedNote);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await storage.updateProject({
      ...project,
      insightStatus: "error",
      insightLastError: `직무/전략 분석 실패 (기업 분석은 저장됨): ${message}`
    });
    return;
  }

  await storage.saveProjectInsightJson(input.projectSlug, "insight-sources.json", {
    generatedAt: new Date().toISOString(),
    providerId: companyPhase.providerId,
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
  const asBoolean = (value: unknown): boolean | undefined => typeof value === "boolean" ? value : undefined;
  const asOpenDartCandidate = (value: unknown): OpenDartCandidate | undefined => {
    if (!isRecord(value)) {
      return undefined;
    }

    const corpCode = typeof value["corpCode"] === "string" ? value["corpCode"] : undefined;
    const corpName = typeof value["corpName"] === "string" ? value["corpName"] : undefined;
    const stockCode = typeof value["stockCode"] === "string" ? value["stockCode"] : undefined;

    if (!corpCode || !corpName) {
      return undefined;
    }

    return {
      corpCode,
      corpName,
      stockCode
    };
  };
  const asOpenDartCandidates = (value: unknown): OpenDartCandidate[] | undefined => {
    if (value === null || value === undefined) {
      return undefined;
    }
    if (!Array.isArray(value)) {
      return undefined;
    }

    const candidates = value
      .map((item) => asOpenDartCandidate(item))
      .filter((candidate): candidate is OpenDartCandidate => Boolean(candidate));
    return candidates.length > 0 ? candidates : undefined;
  };
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
  if (hasField("openDartCandidates")) {
    input["openDartCandidates"] = asOpenDartCandidates(body["openDartCandidates"]);
  }
  if (hasField("openDartSkipRequested")) {
    input["openDartSkipRequested"] = asBoolean(body["openDartSkipRequested"]);
  }

  return input;
}

function buildJobPostingFallbackMessage(error: unknown): string {
  if (isJobPostingFetchError(error)) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
