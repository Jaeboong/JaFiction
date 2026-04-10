import * as assert from "node:assert/strict";
import test from "node:test";
import {
  extractStructuredJobPostingFields,
  fetchAndExtractJobPosting,
  isJobPostingFetchError,
  normalizeJobPostingHtml,
  normalizeJobPostingText
} from "../core/jobPosting";

test("job posting extraction normalizes html and maps structured sections", async () => {
  const html = `
    <html>
      <head><title>에코마케팅 | Java Backend Engineer</title></head>
      <body>
        <section>
          <h2>주요 업무</h2>
          <ul>
            <li>자사 물류 및 운영 시스템 백엔드 개발</li>
            <li>광고 매체 API 연동 시스템 설계</li>
          </ul>
        </section>
        <section>
          <h2>자격 요건</h2>
          <ul>
            <li>Java, Spring Boot 기반 개발 경험</li>
            <li>MySQL 또는 NoSQL 이해</li>
          </ul>
        </section>
        <section>
          <h2>우대 사항</h2>
          <ul>
            <li>Kafka 운영 경험</li>
          </ul>
        </section>
      </body>
    </html>
  `;

  const normalized = normalizeJobPostingHtml(html);
  assert.match(normalized, /주요 업무/);
  assert.match(normalized, /자격 요건/);

  const structured = extractStructuredJobPostingFields(normalized, {
    pageTitle: "에코마케팅 | Java Backend Engineer"
  });
  assert.equal(structured.companyName, "에코마케팅");
  assert.equal(structured.roleName, "Java Backend Engineer");
  assert.match(structured.mainResponsibilities || "", /자사 물류 및 운영 시스템 백엔드 개발/);
  assert.match(structured.qualifications || "", /Java, Spring Boot 기반 개발 경험/);
  assert.match(structured.preferredQualifications || "", /Kafka 운영 경험/);
  assert.ok(structured.keywords.includes("Java"));
  assert.ok(structured.keywords.includes("Spring Boot"));
});

test("job posting extraction supports manual text fallback without fetch", async () => {
  const result = await fetchAndExtractJobPosting(
    {
      seedCompanyName: "에코마케팅",
      seedRoleName: "Java Backend Engineer",
      jobPostingText: normalizeJobPostingText(`
        주요 업무
        운영 자동화 서비스 구현

        자격 요건
        Java 개발 경험
      `)
    },
    async () => {
      throw new Error("fetch should not be called for manual text");
    }
  );

  assert.equal(result.source, "manual");
  assert.equal(result.companyName, "에코마케팅");
  assert.equal(result.roleName, "Java Backend Engineer");
  assert.match(result.mainResponsibilities || "", /운영 자동화 서비스 구현/);
  assert.match(result.qualifications || "", /Java 개발 경험/);
});

test("job posting extraction captures response diagnostics for non-ok responses", async () => {
  await assert.rejects(
    () => fetchAndExtractJobPosting(
      {
        jobPostingUrl: "https://careers.example.com/jobs/blocked"
      },
      async () => new Response(
        "<html><body><h1>Access denied</h1><p>bot traffic blocked</p></body></html>",
        {
          status: 500,
          statusText: "Internal Server Error",
          headers: {
            "content-type": "text/html; charset=utf-8",
            "x-request-id": "req-123",
            "set-cookie": "session=secret"
          }
        }
      )
    ),
    (error: unknown) => {
      assert.equal(isJobPostingFetchError(error), true);
      if (!isJobPostingFetchError(error)) {
        return false;
      }

      assert.equal(error.diagnostics.failureKind, "http");
      assert.equal(error.diagnostics.status, 500);
      assert.equal(error.diagnostics.statusText, "Internal Server Error");
      assert.equal(error.diagnostics.requestUrl, "https://careers.example.com/jobs/blocked");
      assert.equal(error.diagnostics.responseHeaders?.["x-request-id"], "req-123");
      assert.equal(error.diagnostics.responseHeaders?.["set-cookie"], "[redacted]");
      assert.match(error.diagnostics.bodySnippet || "", /Access denied/);
      assert.match(error.message, /500/);
      return true;
    }
  );
});

test("job posting extraction wraps network errors with request diagnostics", async () => {
  await assert.rejects(
    () => fetchAndExtractJobPosting(
      {
        jobPostingUrl: "https://careers.example.com/jobs/network"
      },
      async () => {
        throw new Error("socket hang up");
      }
    ),
    (error: unknown) => {
      assert.equal(isJobPostingFetchError(error), true);
      if (!isJobPostingFetchError(error)) {
        return false;
      }

      assert.equal(error.diagnostics.failureKind, "network");
      assert.equal(error.diagnostics.requestUrl, "https://careers.example.com/jobs/network");
      assert.match(error.diagnostics.requestHeaders["user-agent"], /^ForJob\/0\.1\.\d+ \(\+https:\/\/github\.com\/Jaeboong\/CoordinateAI\)$/);
      assert.equal(error.diagnostics.responseHeaders, undefined);
      assert.equal(error.diagnostics.bodySnippet, undefined);
      assert.match(error.message, /네트워크 오류/);
      return true;
    }
  );
});

test("job posting extraction sends browser-like locale headers for pages that break on wildcard language", async () => {
  let observedHeaders: Record<string, string> | undefined;
  const result = await fetchAndExtractJobPosting(
    {
      jobPostingUrl: "https://careers.example.com/jobs/locale"
    },
    async (_url, init) => {
      observedHeaders = (init?.headers as Record<string, string> | undefined);
      return new Response(`
        <html>
          <head><title>에코마케팅 | Java Backend Engineer</title></head>
          <body>
            <h2>주요 업무</h2>
            <p>운영 자동화 시스템 개발</p>
            <h2>자격 요건</h2>
            <p>Java 개발 경험</p>
          </body>
        </html>
      `, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8"
        }
      });
    }
  );

  const headerEntries = Object.fromEntries(Object.entries(observedHeaders || {}));
  assert.equal(headerEntries["accept-language"], "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7");
  assert.match(headerEntries.accept || "", /text\/html/);
  assert.equal(result.source, "url");
});

test("job posting extraction prefers detail html first line as role name when it appears before any section heading", async () => {
  const html = `
    <html>
      <head><title>[개발자 공개 채용]백엔드(Python, Java) 신입/경력 채용</title></head>
      <body>
        <h2>💻백엔드 개발자(Python, Java) 는,</h2>
        <p>단순한 시스템 유지보수를 넘어 전사 부서의 업무를 자동화 솔루션으로 혁신합니다.</p>
        <h3>■ 주요 업무</h3>
        <ul><li>자사 물류 서비스 개발 및 유지보수</li></ul>
        <h3>■ 지원 자격</h3>
        <ul><li>Java, Spring Boot 개발 경험</li></ul>
      </body>
    </html>
  `;

  const normalized = normalizeJobPostingHtml(html);
  const structured = extractStructuredJobPostingFields(normalized, {
    pageTitle: "[개발자 공개 채용]백엔드(Python, Java) 신입/경력 채용"
  });

  assert.equal(structured.roleName, "백엔드 개발자(Python, Java)");
  assert.match(structured.mainResponsibilities || "", /자사 물류 서비스 개발 및 유지보수/);
});

test("job posting extraction falls back to page title when detail lines begin with a section heading", async () => {
  const html = `
    <html>
      <head><title>에코마케팅 | Java Backend Engineer</title></head>
      <body>
        <h2>주요 업무</h2>
        <ul><li>자사 물류 및 운영 시스템 백엔드 개발</li></ul>
        <h2>자격 요건</h2>
        <ul><li>Java, Spring Boot 기반 개발 경험</li></ul>
      </body>
    </html>
  `;

  const normalized = normalizeJobPostingHtml(html);
  const structured = extractStructuredJobPostingFields(normalized, {
    pageTitle: "에코마케팅 | Java Backend Engineer"
  });

  assert.equal(structured.roleName, "Java Backend Engineer");
});

test("job posting extraction captures benefits, hiring process, insider view, and other info sections", async () => {
  const html = `
    <html>
      <head><title>에코마케팅 | Java Backend Engineer</title></head>
      <body>
        <h2>담당 업무</h2>
        <ul><li>자사 물류 서비스 개발</li></ul>
        <h2>자격 요건</h2>
        <ul><li>Java, Spring Boot 개발 경험</li></ul>
        <h2>복리후생</h2>
        <ul>
          <li>4대 보험 및 퇴직금</li>
          <li>유연근무제 운영</li>
        </ul>
        <h2>채용 절차</h2>
        <ul>
          <li>서류 전형</li>
          <li>실무 면접</li>
          <li>임원 면접</li>
        </ul>
        <h2>재직자 시각</h2>
        <ul>
          <li>빠르게 성장하는 팀입니다</li>
        </ul>
        <h2>기타 정보</h2>
        <ul>
          <li>근무지: 서울특별시 송파구</li>
          <li>업무 시간: 주 5일, 10:00 ~ 19:00</li>
          <li>지원 서류: 이력서(필수), 포트폴리오(필수)</li>
        </ul>
      </body>
    </html>
  `;

  const normalized = normalizeJobPostingHtml(html);
  const structured = extractStructuredJobPostingFields(normalized, {
    pageTitle: "에코마케팅 | Java Backend Engineer"
  });

  assert.match(structured.benefits || "", /4대 보험 및 퇴직금/);
  assert.match(structured.benefits || "", /유연근무제 운영/);
  assert.match(structured.hiringProcess || "", /서류 전형/);
  assert.match(structured.hiringProcess || "", /실무 면접/);
  assert.match(structured.insiderView || "", /빠르게 성장하는 팀입니다/);
  assert.match(structured.otherInfo || "", /근무지/);
  assert.match(structured.otherInfo || "", /업무 시간/);
});

test("job posting extraction prefers GreetingHR structured detail html and selects role-targeted qualifications", async () => {
  const detailHtml = `
    <p><strong>■ 주요 업무</strong></p>
    <ul>
      <li>자사 물류 서비스 및 내부 운영 시스템 개발 및 유지보수</li>
      <li>광고 매체 운영 및 관리 시스템 백엔드 개발</li>
    </ul>
    <h3>지원 분야 1. Python</h3>
    <p><strong>■ 지원 자격</strong></p>
    <ul>
      <li>Django 프로젝트 경험</li>
      <li>MongoDB 이해</li>
    </ul>
    <h3>지원 분야 2. Java</h3>
    <p><strong>■ 지원 자격</strong></p>
    <ul>
      <li>Java, Spring Boot, JPA(Hibernate) 프로젝트 경험</li>
      <li>MySQL, Redis 활용 경험</li>
    </ul>
    <p><strong>📢 지원 자격(공통)</strong></p>
    <ul>
      <li>Restful API 설계 및 개발 경험</li>
      <li>AWS(EC2, S3, RDS) 사용 경험</li>
    </ul>
    <p><strong>✈️ 우대 사항(공통)</strong></p>
    <ul>
      <li>Kafka 관심 또는 경험</li>
      <li>Test 코드 작성 경험</li>
    </ul>
  `;

  const nextData = JSON.stringify({
    props: {
      pageProps: {
        dehydratedState: {
          queries: [
            {
              queryKey: ["career", "getOpeningById", { openingId: 209705, workspaceId: 5400 }],
              state: {
                data: {
                  data: {
                    groupInfo: { name: "에코마케팅" },
                    openingsInfo: {
                      title: "[개발자 공개 채용]백엔드(Python, Java) 신입/경력 채용",
                      detail: detailHtml
                    }
                  }
                }
              }
            }
          ]
        }
      }
    }
  });

  const html = `
    <html>
      <head>
        <title>Old fallback title</title>
        <script id="__NEXT_DATA__" type="application/json">${nextData}</script>
      </head>
      <body>
        <nav>전형 안내</nav>
        <main>이 영역은 structured detail보다 우선되면 안 됩니다.</main>
      </body>
    </html>
  `;

  const result = await fetchAndExtractJobPosting(
    {
      jobPostingUrl: "https://echomarketing.career.greetinghr.com/ko/o/209705",
      seedRoleName: "백엔드 개발자(Java)"
    },
    async () => new Response(html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8"
      }
    })
  );

  assert.equal(result.pageTitle, "[개발자 공개 채용]백엔드(Python, Java) 신입/경력 채용");
  assert.equal(result.companyName, "에코마케팅");
  assert.equal(result.roleName, "백엔드 개발자(Java)");
  assert.match(result.mainResponsibilities || "", /자사 물류 서비스 및 내부 운영 시스템 개발 및 유지보수/);
  assert.match(result.qualifications || "", /Java, Spring Boot, JPA/);
  assert.match(result.qualifications || "", /Restful API 설계 및 개발 경험/);
  assert.doesNotMatch(result.qualifications || "", /Django 프로젝트 경험/);
  assert.match(result.preferredQualifications || "", /Kafka 관심 또는 경험/);
  assert.equal(result.warnings.length, 0);
  assert.doesNotMatch(result.normalizedText, /전형 안내/);
});
