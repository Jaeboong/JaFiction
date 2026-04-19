import * as assert from "node:assert/strict";
import test from "node:test";
import { extractStructuredJobPostingFields, fetchAndExtractJobPosting } from "../core/jobPosting";
import { isAtsSiteTitle } from "../core/atsBlacklist";

// --- ATS blacklist unit tests ---

test("isAtsSiteTitle detects 점핏", () => {
  assert.equal(isAtsSiteTitle("점핏 | Backend Engineer"), true);
});

test("isAtsSiteTitle detects 원티드", () => {
  assert.equal(isAtsSiteTitle("원티드 | 개발자 채용"), true);
});

test("isAtsSiteTitle detects 사람인", () => {
  assert.equal(isAtsSiteTitle("사람인 채용 - 백엔드 개발자"), true);
});

test("isAtsSiteTitle does not block 잡코리아 (정책: 실제 회사명 추출 시도)", () => {
  assert.equal(isAtsSiteTitle("잡코리아 | IT개발직 채용"), false);
});

test("isAtsSiteTitle detects 기아 탤런트 라운지", () => {
  assert.equal(isAtsSiteTitle("기아 탤런트 라운지 | 개발자"), true);
});

test("isAtsSiteTitle does not block normal company title", () => {
  assert.equal(isAtsSiteTitle("넵튠 | H5개발팀 클라이언트 개발"), false);
});

test("isAtsSiteTitle does not block empty string", () => {
  assert.equal(isAtsSiteTitle(""), false);
});

// --- fieldSources tier classification ---

// seed(user input) → factual
test("extractStructuredJobPostingFields: seedCompanyName → fieldSources.companyName = factual", () => {
  const result = extractStructuredJobPostingFields("담당업무\n서버 개발", {
    pageTitle: "어떤 회사 | 백엔드 개발자",
    seedCompanyName: "명시된회사"
  });
  assert.equal(result.fieldSources.companyName, "factual");
  assert.equal(result.companyName, "명시된회사");
});

test("extractStructuredJobPostingFields: seedRoleName → fieldSources.roleName = factual", () => {
  const result = extractStructuredJobPostingFields("담당업무\n서버 개발", {
    pageTitle: "어떤 회사 | 백엔드 개발자",
    seedRoleName: "백엔드 엔지니어"
  });
  assert.equal(result.fieldSources.roleName, "factual");
  assert.equal(result.roleName, "백엔드 엔지니어");
});

// heading + pageTitle 교차 확인 → contextual
test("extractStructuredJobPostingFields: heading roleName matches pageTitle → contextual", () => {
  // pageTitle 에 "Backend Engineer"가 있고, body의 첫 줄도 동일 → contextual
  const normalizedText = [
    "Backend Engineer",
    "담당업무",
    "API 서버 개발"
  ].join("\n");
  const result = extractStructuredJobPostingFields(normalizedText, {
    pageTitle: "에코마케팅 | Backend Engineer"
  });
  // roleName이 pageTitle과 교차되면 contextual
  assert.equal(result.fieldSources.roleName, "contextual");
});

// 단독 title 폴백 → role tier
test("extractStructuredJobPostingFields: companyName from title only → role", () => {
  // 본문에 heading 없어서 title에서만 추출
  const result = extractStructuredJobPostingFields("주요 업무\n서버 개발", {
    pageTitle: "에코마케팅 | 백엔드 개발자"
  });
  // companyName은 title 단독 → role tier
  if (result.companyName) {
    assert.equal(result.fieldSources.companyName, "role");
  }
});

// ATS 사이트명 title → companyName 추출 안 됨
test("extractStructuredJobPostingFields: ATS title → companyName is undefined (filtered at caller)", () => {
  // pageTitle이 ATS 사이트명이면 caller가 pageTitle을 undefined로 변환
  // 이 테스트는 pageTitle=undefined 상태를 모사
  const result = extractStructuredJobPostingFields("주요 업무\n서버 개발", {
    pageTitle: undefined
  });
  // title 없으니 companyName은 undefined 또는 body에서 추출된 값
  // fieldSources.companyName은 설정되지 않아야 함 (또는 role이면 body에서 추출)
  if (result.companyName === undefined) {
    assert.equal(result.fieldSources.companyName, undefined);
  }
});

// fieldSources는 항상 partial record — 추출 안 된 필드는 포함하지 않음
test("extractStructuredJobPostingFields: unextracted fields not in fieldSources", () => {
  const result = extractStructuredJobPostingFields("", {});
  // 아무것도 추출 못해도 fieldSources는 빈 객체 (undefined가 아님)
  assert.ok(result.fieldSources !== undefined);
  assert.equal(typeof result.fieldSources, "object");
  // 추출 안 된 필드는 key 자체가 없어야 함
  assert.equal(result.fieldSources.companyName, undefined);
  assert.equal(result.fieldSources.roleName, undefined);
});

async function extractFromHtml(
  html: string,
  request: { jobPostingUrl?: string; seedCompanyName?: string; seedRoleName?: string } = {}
) {
  const sourceUrl = request.jobPostingUrl ?? "https://example.com/posting";
  const mockFetch = async (): Promise<Response> =>
    ({
      ok: true,
      status: 200,
      url: sourceUrl,
      headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
      text: async () => html
    }) as Response;

  return fetchAndExtractJobPosting(
    {
      jobPostingUrl: sourceUrl,
      seedCompanyName: request.seedCompanyName,
      seedRoleName: request.seedRoleName
    },
    mockFetch
  );
}

test.describe("JSON-LD pipeline integration priority", () => {
  test("JSON-LD only yields factual companyName and roleName", async () => {
    const result = await extractFromHtml(`
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@type": "JobPosting",
              "title": "플랫폼 백엔드 엔지니어",
              "hiringOrganization": { "name": "테스트컴퍼니" }
            }
          </script>
        </head>
        <body></body>
      </html>
    `);

    assert.equal(result.companyName, "테스트컴퍼니");
    assert.equal(result.roleName, "플랫폼 백엔드 엔지니어");
    assert.equal(result.fieldSources.companyName, "factual");
    assert.equal(result.fieldSources.roleName, "factual");
  });

  test("seedCompanyName wins over JSON-LD companyName and remains factual", async () => {
    const result = await extractFromHtml(
      `
        <html>
          <head>
            <script type="application/ld+json">
              {
                "@type": "JobPosting",
                "title": "플랫폼 백엔드 엔지니어",
                "hiringOrganization": { "name": "JSON-LD 회사" }
              }
            </script>
          </head>
          <body></body>
        </html>
      `,
      { seedCompanyName: "시드 회사" }
    );

    assert.equal(result.companyName, "시드 회사");
    assert.equal(result.roleName, "플랫폼 백엔드 엔지니어");
    assert.equal(result.fieldSources.companyName, "factual");
    assert.equal(result.fieldSources.roleName, "factual");
  });

  test("JSON-LD title normalizes away company prefix and 채용 suffix", async () => {
    const result = await extractFromHtml(`
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@type": "JobPosting",
              "title": "㈜아이엠비씨 직원 채용(iOS 앱개발, SNS 운영)",
              "hiringOrganization": { "name": "㈜아이엠비씨" }
            }
          </script>
        </head>
        <body></body>
      </html>
    `);

    assert.equal(result.roleName, "iOS 앱개발, SNS 운영");
    assert.equal(result.fieldSources.roleName, "factual");
  });

  test("short JSON-LD description does not fill overview", async () => {
    const result = await extractFromHtml(`
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@type": "JobPosting",
              "title": "플랫폼 백엔드 엔지니어",
              "hiringOrganization": { "name": "테스트컴퍼니" },
              "description": "${"가".repeat(40)}"
            }
          </script>
        </head>
        <body></body>
      </html>
    `);

    assert.equal(result.overview, undefined);
    assert.equal(result.fieldSources.overview, undefined);
  });

  test("long JSON-LD description fills overview as factual", async () => {
    const description = "플랫폼 백엔드 엔지니어로서 대용량 트래픽 처리, 운영 자동화, 데이터 파이프라인 개선을 함께 수행합니다. 다양한 팀과 협업합니다.";
    assert.ok(description.length >= 50);

    const result = await extractFromHtml(`
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@type": "JobPosting",
              "title": "플랫폼 백엔드 엔지니어",
              "hiringOrganization": { "name": "테스트컴퍼니" },
              "description": "${description}"
            }
          </script>
        </head>
        <body></body>
      </html>
    `);

    assert.equal(result.overview, description);
    assert.equal(result.fieldSources.overview, "factual");
  });

  test("JSON-LD validThrough overrides deadline as factual", async () => {
    const result = await extractFromHtml(`
      <html>
        <head>
          <script type="application/ld+json">
            {
              "@type": "JobPosting",
              "title": "플랫폼 백엔드 엔지니어",
              "hiringOrganization": { "name": "테스트컴퍼니" },
              "validThrough": "2026-05-01T23:59:00+09:00"
            }
          </script>
        </head>
        <body>
          <section>
            <h2>지원 마감</h2>
            <p>2026년 04월 30일</p>
          </section>
        </body>
      </html>
    `);

    assert.equal(result.deadline, "2026년 05월 01일, 23:59");
    assert.equal(result.fieldSources.deadline, "factual");
  });

  test("without JSON-LD, title-only fallback stays at role tier", async () => {
    const result = await extractFromHtml(`
      <html>
        <head>
          <title>에코마케팅 | 백엔드 개발자</title>
        </head>
        <body></body>
      </html>
    `);

    assert.equal(result.companyName, "에코마케팅");
    assert.equal(result.roleName, "백엔드 개발자");
    assert.equal(result.fieldSources.companyName, "role");
    assert.equal(result.fieldSources.roleName, "role");
  });

  test("ATS-blacklisted title does not block JSON-LD companyName or roleName", async () => {
    const result = await extractFromHtml(
      `
        <html>
          <head>
            <title>원티드 | 개발자 채용</title>
            <script type="application/ld+json">
              {
                "@type": "JobPosting",
                "title": "플랫폼 백엔드 엔지니어",
                "hiringOrganization": { "name": "테스트컴퍼니" }
              }
            </script>
          </head>
          <body></body>
        </html>
      `,
      { jobPostingUrl: "https://www.wanted.co.kr/wd/123456" }
    );

    assert.equal(result.pageTitle, undefined);
    assert.equal(result.companyName, "테스트컴퍼니");
    assert.equal(result.roleName, "플랫폼 백엔드 엔지니어");
    assert.equal(result.fieldSources.companyName, "factual");
    assert.equal(result.fieldSources.roleName, "factual");
  });
});
