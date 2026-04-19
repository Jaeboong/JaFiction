import * as assert from "node:assert/strict";
import test from "node:test";
import {
  buildCompanyAnalysisPrompt,
  buildSupportingInsightPrompt,
  parseCompanyAnalysisResponse,
  parseSupportingInsightResponse
} from "../core/companyInsightArtifacts";
import { CompanySourceBundle } from "../core/companySourceModel";
import { chooseInsightProvider, generateInsightArtifacts } from "../core/insights";
import { OpenDartCompanyResolution } from "../core/openDart";
import {
  hasProjectInsightDocuments,
  isProjectInsightDocumentTitle,
  projectInsightArtifactDefinitions
} from "../core/projectInsights";
import { ProjectRecord, ProviderRuntimeState } from "../core/types";

function createProjectRecord(): ProjectRecord {
  return {
    slug: "eco-marketing",
    companyName: "에코마케팅",
    roleName: "Java Backend Engineer",
    mainResponsibilities: "운영 자동화 서비스 구현",
    qualifications: "Java, Spring Boot 경험",
    preferredQualifications: "Kafka 운영 경험",
    keywords: ["Java", "Spring Boot", "Kafka"],
    jobPostingUrl: "https://company.example/jobs/eco",
    jobPostingText: "주요 업무\n운영 자동화 서비스 구현",
    essayQuestions: ["지원 동기를 작성해주세요."],
    rubric: "- fit",
    pinnedDocumentIds: [],
    postingReviewReasons: [],
    jobPostingFieldConfidence: {},
    createdAt: "2026-04-07T00:00:00.000Z",
    updatedAt: "2026-04-07T00:00:00.000Z"
  };
}

function createProviderState(providerId: "codex" | "claude" | "gemini", authStatus: ProviderRuntimeState["authStatus"]): ProviderRuntimeState {
  return {
    providerId,
    command: providerId,
    authMode: "cli",
    hasApiKey: false,
    configuredModel: undefined,
    configuredEffort: undefined,
    capabilities: {
      supportsEffort: true,
      modelOptions: [],
      effortOptions: []
    },
    installed: true,
    authStatus
  };
}

function createCompanyResolution(): OpenDartCompanyResolution {
  return {
    status: "resolved",
    match: {
      corpCode: "00126380",
      corpName: "에코마케팅",
      stockCode: "230360"
    },
    overview: {
      corpName: "에코마케팅",
      corpCode: "00126380",
      stockCode: "230360",
      ceoName: "김철수",
      homepageUrl: "https://company.example"
    },
    financials: [
      {
        year: 2025,
        fsDivision: "CFS",
        revenue: 448812712000
      }
    ],
    notices: []
  };
}

function createCompanySourceBundle(): CompanySourceBundle {
  return {
    manifest: {
      collectedAt: "2026-04-08T10:00:00.000Z",
      companyName: "에코마케팅",
      sources: [
        {
          id: "open-dart-overview",
          tier: "official",
          kind: "openDartOverview",
          label: "OpenDART 기업개황",
          status: "available"
        },
        {
          id: "official-homepage",
          tier: "official",
          kind: "officialHomepage",
          label: "공식 홈페이지",
          status: "fetched",
          url: "https://company.example"
        },
        {
          id: "official-hiring",
          tier: "official",
          kind: "officialHiring",
          label: "공식 채용 페이지",
          status: "fetched",
          url: "https://company.example/jobs/eco"
        }
      ],
      coverage: {
        summaryLabel: "OpenDART + 공식 홈페이지 + 공식 채용",
        sourceTypes: ["OpenDART", "공식 홈페이지", "공식 채용"],
        omissions: ["최근 방향성을 뒷받침할 공식 IR/보도/기술 자료가 제한적입니다."],
        coverageNote: "일부 공식 소스를 확보했지만 누락된 축은 문서 안에서 제한적으로만 해석해야 합니다.",
        externalEnrichmentUsed: false
      }
    },
    snippets: [
      {
        sourceId: "official-homepage",
        sourceKind: "officialHomepage",
        sectionLabel: "business-model",
        text: "광고 성과와 커머스 성장을 연결하는 디지털 플랫폼 기업입니다.",
        confidence: "high"
      },
      {
        sourceId: "official-hiring",
        sourceKind: "officialHiring",
        sectionLabel: "role-context",
        text: "개발 조직은 광고 데이터 플랫폼을 고도화합니다.",
        confidence: "high"
      }
    ]
  };
}

test("insight provider selection prefers requested healthy provider", () => {
  const selected = chooseInsightProvider(
    [
      createProviderState("codex", "healthy"),
      createProviderState("claude", "healthy"),
      createProviderState("gemini", "missing")
    ],
    "claude"
  );

  assert.equal(selected?.providerId, "claude");
});

test("project insight definitions keep stable order and titles", () => {
  assert.deepEqual(
    projectInsightArtifactDefinitions.map((artifact) => artifact.fileName),
    ["company-insight.md", "job-insight.md", "application-strategy.md", "question-analysis.md"]
  );
  assert.equal(isProjectInsightDocumentTitle("company-insight.md"), true);
  assert.equal(isProjectInsightDocumentTitle("notes.md"), false);
  assert.equal(
    hasProjectInsightDocuments([
      { title: "notes.md" },
      { title: "company-insight.md" }
    ]),
    true
  );
  assert.equal(
    hasProjectInsightDocuments([
      { title: "notes.md" },
      { title: "resume.md" }
    ]),
    false
  );
});

test("parseCompanyAnalysisResponse keeps deterministic coverage and strips fenced json", () => {
  const parsed = parseCompanyAnalysisResponse(
    `
<<<FILE: company-profile.json>>>
\`\`\`json
{"oneLineDefinition":"디지털 플랫폼 기업","businessModel":["광고 수익"],"businessStructure":["광고","커머스"],"growthDirection":["AI 고도화"],"financialTakeaways":["수익성 확인"],"officialDirection":["플랫폼 강화"],"roleRelevance":["백엔드 안정성"],"essayAngles":["광고와 커머스 연결","데이터 기반 최적화","플랫폼 확장"],"interviewQuestions":["플랫폼 투자 우선순위는?"]}
\`\`\`
<<<END FILE>>>
<<<FILE: company-insight.md>>>
# 기업 분석
<<<END FILE>>>
    `,
    "에코마케팅",
    createCompanySourceBundle().manifest.coverage
  );

  assert.equal(parsed.companyProfile.companyName, "에코마케팅");
  assert.equal(parsed.companyProfile.coverage.summaryLabel, "OpenDART + 공식 홈페이지 + 공식 채용");
  assert.equal(parsed.companyProfile.essayAngles.length, 3);
  assert.equal(parsed.companyInsight, "# 기업 분석");
});

test("parseSupportingInsightResponse extracts the three non-company artifacts", () => {
  const artifacts = parseSupportingInsightResponse(`
<<<FILE: job-insight.md>>>
# Job
<<<END FILE>>>
<<<FILE: application-strategy.md>>>
# Strategy
<<<END FILE>>>
<<<FILE: question-analysis.md>>>
# Questions
<<<END FILE>>>
  `);

  assert.equal(artifacts["job-insight.md"], "# Job");
  assert.equal(artifacts["application-strategy.md"], "# Strategy");
  assert.equal(artifacts["question-analysis.md"], "# Questions");
});

test("generateInsightArtifacts runs dedicated company analysis before supporting docs", async () => {
  const prompts: string[] = [];
  const generated = await generateInsightArtifacts(
    {
      async listRuntimeStates() {
        return [createProviderState("codex", "healthy")];
      },
      async getApiKey() {
        return undefined;
      },
      async execute(providerId, prompt) {
        prompts.push(prompt);
        assert.equal(providerId, "codex");
        if (prompts.length === 1) {
          return {
            text: `
<<<FILE: company-profile.json>>>
{"oneLineDefinition":"디지털 플랫폼 기업","businessModel":["광고 성과 기반 수익"],"businessStructure":["광고","커머스"],"growthDirection":["AI 기반 최적화"],"financialTakeaways":["수익성 방어"],"officialDirection":["플랫폼 고도화"],"roleRelevance":["백엔드 안정성"],"essayAngles":["광고와 커머스 연결","플랫폼 확장","데이터 기반 의사결정"],"interviewQuestions":["향후 플랫폼 투자 우선순위는?"]}
<<<END FILE>>>
<<<FILE: company-insight.md>>>
# Company Insight
<<<END FILE>>>
            `
          };
        }

        return {
          text: `
<<<FILE: job-insight.md>>>
# Job
<<<END FILE>>>
<<<FILE: application-strategy.md>>>
# Strategy
<<<END FILE>>>
<<<FILE: question-analysis.md>>>
# Questions
<<<END FILE>>>
          `
        };
      }
    },
    "/workspace",
    createProjectRecord(),
    createCompanyResolution(),
    createCompanySourceBundle(),
    "codex"
  );

  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /Company Analysis Pre-pass/);
  assert.match(prompts[0], /Company Source Manifest JSON/);
  assert.match(prompts[1], /Company Profile JSON/);
  assert.match(prompts[1], /Company Insight Markdown/);
  assert.equal(generated.providerId, "codex");
  assert.equal(generated.companyProfile.coverage.summaryLabel, "OpenDART + 공식 홈페이지 + 공식 채용");
  assert.equal(generated.artifacts["company-insight.md"], "# Company Insight");
  assert.equal(generated.artifacts["job-insight.md"], "# Job");
});

test("prompt builders embed company bundle and follow-up context explicitly", () => {
  const project = createProjectRecord();
  const companyResolution = createCompanyResolution();
  const companySourceBundle = createCompanySourceBundle();
  const companyPrompt = buildCompanyAnalysisPrompt(project, companyResolution, companySourceBundle);
  const followUpPrompt = buildSupportingInsightPrompt(
    project,
    {
      generatedAt: "2026-04-08T10:00:00.000Z",
      companyName: "에코마케팅",
      oneLineDefinition: "디지털 플랫폼 기업",
      businessModel: ["광고 성과 기반 수익"],
      businessStructure: ["광고", "커머스"],
      growthDirection: ["AI 기반 최적화"],
      financialTakeaways: ["수익성 방어"],
      officialDirection: ["플랫폼 고도화"],
      roleRelevance: ["백엔드 안정성"],
      essayAngles: ["광고와 커머스 연결", "플랫폼 확장", "데이터 기반 의사결정"],
      interviewQuestions: ["향후 플랫폼 투자 우선순위는?"],
      coverage: companySourceBundle.manifest.coverage
    },
    "# Company Insight"
  );

  assert.match(companyPrompt, /company-profile\.json/);
  assert.match(companyPrompt, /에코마케팅/);
  assert.match(companyPrompt, /공식 홈페이지/);
  assert.match(followUpPrompt, /Company Profile JSON/);
  assert.match(followUpPrompt, /# Company Insight/);
});

test("buildCompanyAnalysisPrompt contains Source Tier Rules block (Stage D regression guard)", () => {
  const project = createProjectRecord();
  const companyResolution = createCompanyResolution();
  const companySourceBundle = createCompanySourceBundle();
  const prompt = buildCompanyAnalysisPrompt(project, companyResolution, companySourceBundle);

  assert.match(prompt, /Source Tier Rules/, "should contain Source Tier Rules heading");
  assert.match(prompt, /FACTUAL/, "should mention FACTUAL tier");
  assert.match(prompt, /CONTEXTUAL/, "should mention CONTEXTUAL tier");
  assert.match(prompt, /ROLE/, "should mention ROLE tier");
  assert.match(prompt, /factual ≻ contextual ≻ role/, "should contain conflict resolution rule");
  assert.match(prompt, /출처와 근거 강도/, "should reference source evidence section");
});

test("buildCompanyAnalysisPrompt includes web snippets when companyContext provided", () => {
  const project = createProjectRecord();
  const companyResolution = createCompanyResolution();
  const companySourceBundle = createCompanySourceBundle();

  const mockContext = {
    collectedAt: "2026-04-15T00:00:00.000Z",
    companyName: "에코마케팅",
    sources: {
      dart: undefined,
      web: {
        providerId: "naver" as const,
        fetchedAt: "2026-04-15T00:00:00.000Z",
        entries: [],
        snippets: [
          {
            sourceId: "web-search-0",
            sourceKind: "webNews" as const,
            sectionLabel: "growth-direction" as const,
            text: "[최신 뉴스] 에코마케팅 AI 플랫폼 출시",
            confidence: "medium" as const,
            publishedAt: "2026-03-01T00:00:00.000Z",
            sourceTier: "contextual" as const
          }
        ],
        notes: []
      },
      posting: {
        companyName: "에코마케팅",
        keywords: [],
        snippets: []
      }
    },
    coverage: companySourceBundle.manifest.coverage
  };

  const prompt = buildCompanyAnalysisPrompt(project, companyResolution, companySourceBundle, mockContext);

  assert.match(prompt, /Web\/News Source Snippets JSON/, "should include web snippets section");
  assert.match(prompt, /tier=contextual/, "should label web snippets as contextual");
  assert.match(prompt, /에코마케팅 AI 플랫폼 출시/, "should contain web snippet content");
});
