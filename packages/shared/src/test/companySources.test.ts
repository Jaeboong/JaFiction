import * as assert from "node:assert/strict";
import test from "node:test";
import { collectCompanySourceBundle } from "../core/companySources";
import { OpenDartCompanyResolution } from "../core/openDart";
import { ProjectRecord } from "../core/types";

function createProjectRecord(): ProjectRecord {
  return {
    slug: "eco-marketing",
    companyName: "에코마케팅",
    roleName: "Backend Engineer",
    jobPostingUrl: "https://company.example/careers/backend",
    mainResponsibilities: "플랫폼 개발",
    qualifications: "TypeScript",
    rubric: "- fit",
    pinnedDocumentIds: [],
    createdAt: "2026-04-08T00:00:00.000Z",
    updatedAt: "2026-04-08T00:00:00.000Z"
  };
}

function createResolution(homepageUrl = "https://company.example"): OpenDartCompanyResolution {
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
      homepageUrl,
      irUrl: `${homepageUrl}/ir`,
      establishedAt: "20030101"
    },
    financials: [
      {
        year: 2025,
        fsDivision: "CFS",
        revenue: 448812712000,
        operatingIncome: 45446620000,
        netIncome: 17687230000
      }
    ],
    notices: []
  };
}

test("collectCompanySourceBundle gathers official-first sources and coverage", async () => {
  const bundle = await collectCompanySourceBundle(
    createProjectRecord(),
    createResolution(),
    async (input) => {
      const url = new URL(String(input));
      const pages: Record<string, string> = {
        "https://company.example/": `
          <html><head><title>에코마케팅</title></head><body>
            <a href="/company">회사소개</a>
            <a href="/business">사업소개</a>
            <a href="/news">보도자료</a>
          </body></html>
        `,
        "https://company.example/company": `
          <html><body><h1>회사소개</h1><p>에코마케팅은 광고 성과와 커머스 성장을 연결하는 디지털 플랫폼 기업입니다.</p></body></html>
        `,
        "https://company.example/business": `
          <html><body><h1>사업소개</h1><p>광고, 커머스, 브랜드 운영 서비스를 제공합니다.</p><p>AI 기반 최적화와 글로벌 확장을 추진합니다.</p></body></html>
        `,
        "https://company.example/careers/backend": `
          <html><body><h1>채용</h1><p>개발 조직은 광고 데이터 플랫폼을 고도화합니다.</p></body></html>
        `,
        "https://company.example/ir": `
          <html><body><h1>IR</h1><p>신규 사업 투자와 수익성 개선 방향을 공유합니다.</p></body></html>
        `,
        "https://company.example/news": `
          <html><body><h1>보도자료</h1><p>신규 브랜드 협업과 해외 시장 확장 소식을 발표했습니다.</p></body></html>
        `
      };
      return new Response(pages[url.toString()] ?? "", { status: pages[url.toString()] ? 200 : 404 });
    }
  );

  assert.match(bundle.manifest.coverage.summaryLabel, /OpenDART/);
  assert.match(bundle.manifest.coverage.summaryLabel, /공식 홈페이지/);
  assert.match(bundle.manifest.coverage.summaryLabel, /공식 채용/);
  assert.equal(bundle.manifest.sources.find((source) => source.kind === "officialHomepage")?.status, "fetched");
  assert.equal(bundle.manifest.sources.find((source) => source.kind === "officialHiring")?.status, "fetched");
  assert.equal(bundle.manifest.sources.find((source) => source.kind === "officialIr")?.status, "fetched");
  assert.equal(bundle.manifest.sources.find((source) => source.kind === "officialPress")?.status, "fetched");
  assert.ok(bundle.snippets.some((snippet) => snippet.sectionLabel === "business-model"));
  assert.ok(bundle.snippets.some((snippet) => snippet.sectionLabel === "growth-direction"));
  assert.ok(bundle.snippets.some((snippet) => snippet.sectionLabel === "role-context"));
  assert.ok(bundle.snippets.some((snippet) => snippet.sectionLabel === "financial"));
});

test("collectCompanySourceBundle degrades gracefully when homepage fetch fails", async () => {
  const bundle = await collectCompanySourceBundle(
    createProjectRecord(),
    createResolution(),
    async (input) => {
      const url = new URL(String(input));
      if (url.toString() === "https://company.example/") {
        return new Response("gateway timeout", { status: 504 });
      }
      if (url.toString() === "https://company.example/careers/backend") {
        return new Response("<html><body><p>채용 페이지</p></body></html>", { status: 200 });
      }
      if (url.toString() === "https://company.example/ir") {
        return new Response("<html><body><p>IR 페이지</p></body></html>", { status: 200 });
      }
      return new Response("", { status: 404 });
    }
  );

  assert.equal(bundle.manifest.sources.find((source) => source.kind === "officialHomepage")?.status, "failed");
  assert.equal(bundle.manifest.sources.find((source) => source.kind === "officialHiring")?.status, "fetched");
  assert.ok(bundle.manifest.coverage.omissions.some((item) => /공식 홈페이지/.test(item)));
  assert.ok(bundle.manifest.coverage.coverageNote.length > 0);
});
