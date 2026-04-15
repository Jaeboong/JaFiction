import * as assert from "node:assert/strict";
import test from "node:test";
import { collectCompanyContext } from "../core/companyContext";
import type { WebSearchProvider, WebSearchResult } from "../core/webSearch/provider";
import type { ProjectRecord } from "../core/types";

function createProject(overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  return {
    slug: "test-company",
    companyName: "테스트기업",
    roleName: "백엔드 개발자",
    mainResponsibilities: "서버 개발 및 유지보수",
    qualifications: "Node.js 3년 이상",
    preferredQualifications: "AWS 경험",
    keywords: ["Node.js", "AWS"],
    jobPostingUrl: "https://company.example/jobs/1",
    jobPostingText: "주요 업무\n서버 개발",
    essayQuestions: ["지원 동기를 작성해주세요."],
    rubric: "- fit",
    pinnedDocumentIds: [],
    createdAt: "2026-04-15T00:00:00.000Z",
    updatedAt: "2026-04-15T00:00:00.000Z",
    ...overrides
  };
}

function createMockWebProvider(results: readonly WebSearchResult[] = []): WebSearchProvider {
  return {
    id: "naver",
    async search(): Promise<readonly WebSearchResult[]> {
      return results;
    }
  };
}

// --- dart=skipped, web=empty → posting만으로 ready ---
test("collectCompanyContext: no dart, no web → posting tier only", async () => {
  const project = createProject();
  const result = await collectCompanyContext({
    project,
    hints: { companyName: project.companyName, roleName: project.roleName },
    // dartApiKey 없음 → dart skipped
    webProvider: undefined
  });

  assert.strictEqual(result.companyName, "테스트기업");
  assert.strictEqual(result.reviewNeeded, undefined);
  assert.strictEqual(result.sources.dart, undefined);
  assert.strictEqual(result.sources.web.entries.length, 0);
  assert.ok(result.sources.posting.snippets.length > 0, "should have posting snippets");
  assert.ok(result.coverage.sourceTypes.includes("공고 파생"));
});

// --- dart=skipped, web provider 제공 → web snippets 포함 ---
test("collectCompanyContext: mock web provider returns snippets", async () => {
  const project = createProject();
  const mockProvider = createMockWebProvider([
    {
      title: "테스트기업 신제품 출시",
      url: "https://news.example.com/1",
      snippet: "테스트기업이 신제품을 출시했습니다.",
      publishedAt: new Date().toISOString(),
      source: "news"
    }
  ]);

  const result = await collectCompanyContext({
    project,
    hints: { companyName: project.companyName, roleName: project.roleName },
    webProvider: mockProvider
  });

  assert.strictEqual(result.sources.web.entries.length, 1);
  assert.ok(result.sources.web.snippets.length > 0);
  assert.ok(result.coverage.sourceTypes.includes("웹/뉴스"));
  assert.strictEqual(result.coverage.externalEnrichmentUsed, true);
});

// --- web provider 실패해도 posting tier로 ready ---
test("collectCompanyContext: web provider error does not abort pipeline", async () => {
  const project = createProject();
  const failingProvider: WebSearchProvider = {
    id: "naver",
    async search(): Promise<readonly WebSearchResult[]> {
      throw new Error("network failure");
    }
  };

  const result = await collectCompanyContext({
    project,
    hints: { companyName: project.companyName },
    webProvider: failingProvider
  });

  assert.strictEqual(result.reviewNeeded, undefined);
  assert.strictEqual(result.sources.web.entries.length, 0);
  assert.ok(result.sources.web.notes.some((n) => n.includes("network failure")));
  // posting 소스는 여전히 있어야 함
  assert.ok(result.sources.posting.snippets.length > 0);
});

// --- postingSource 구조 검증 ---
test("derivePostingSource builds snippets from project fields", async () => {
  const { derivePostingSource } = await import("../core/companyContext/postingSource");
  const project = createProject();

  const result = derivePostingSource(project);

  assert.strictEqual(result.companyName, "테스트기업");
  assert.ok(result.snippets.length >= 2, "should have at least mainResponsibilities + qualifications");
  assert.ok(result.snippets.every((s) => s.sourceTier === "role"), "all snippets should be role tier");
});

// --- 빈 프로젝트 (jobPostingText만 있을 때) ---
test("derivePostingSource uses jobPostingText when structured fields are empty", async () => {
  const { derivePostingSource } = await import("../core/companyContext/postingSource");
  const project = createProject({
    mainResponsibilities: undefined,
    qualifications: undefined,
    preferredQualifications: undefined,
    jobPostingText: "주요 업무\n서버 개발 및 유지보수\n자격요건\nNode.js 경험"
  });

  const result = derivePostingSource(project);
  assert.ok(result.snippets.length > 0, "should extract from jobPostingText");
});
