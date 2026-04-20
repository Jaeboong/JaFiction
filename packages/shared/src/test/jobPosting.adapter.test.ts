import * as assert from "node:assert/strict";
import test from "node:test";
import { fetchAndExtractJobPosting } from "../core/jobPosting";
import { findMatchingAdapter, registerSiteAdapter, resetAdaptersForTesting } from "../core/jobPosting/adapters/registry";
import { downgradeTier, verifySignature } from "../core/jobPosting/adapters/signatureCheck";
import type { SiteAdapter } from "../core/jobPosting/adapters/types";

test("site adapter infrastructure", async (t) => {
  await t.test("findMatchingAdapter returns undefined when no adapters are registered", () => {
    resetAdaptersForTesting();
    assert.equal(findMatchingAdapter("https://adapter.example/jobs/1"), undefined);
  });

  await t.test("registerSiteAdapter stores adapter and matches by url", () => {
    resetAdaptersForTesting();
    registerSiteAdapter(createMockAdapter("alpha", (url) =>
      url.includes("adapter-alpha.example")
        ? {
            siteKey: "alpha"
          }
        : undefined
    ));

    const matched = findMatchingAdapter("https://adapter-alpha.example/jobs/1");
    assert.equal(matched?.adapter.siteKey, "alpha");
    assert.equal(matched?.match.siteKey, "alpha");
  });

  await t.test("findMatchingAdapter returns the first matching adapter in registration order", () => {
    resetAdaptersForTesting();
    registerSiteAdapter(createMockAdapter("first", (url) => url.includes("adapter-order.example") ? { siteKey: "first" } : undefined));
    registerSiteAdapter(createMockAdapter("second", (url) => url.includes("adapter-order.example") ? { siteKey: "second" } : undefined));

    const matched = findMatchingAdapter("https://adapter-order.example/jobs/1");
    assert.equal(matched?.adapter.siteKey, "first");
    assert.equal(matched?.match.siteKey, "first");
  });

  await t.test("adapter fields keep their original tier when signature verification passes", async () => {
    resetAdaptersForTesting();
    registerSiteAdapter(createMockAdapter("signature-pass", (url) =>
      url.includes("signature-pass.example")
        ? { siteKey: "signature-pass" }
        : undefined,
    (html) => ({
      fields: {
        companyName: {
          value: "어댑터 회사",
          tier: "factual"
        }
      },
      signatureVerified: verifySignature(html, [".site-signature"]),
      adapterTrust: "medium",
      warnings: []
    })));

    const result = await extractFromHtml(`
      <html>
        <head><title>정상 회사 | 백엔드 엔지니어</title></head>
        <body><div class="site-signature">ok</div></body>
      </html>
    `, "https://signature-pass.example/jobs/1");

    assert.equal(result.companyName, "어댑터 회사");
    assert.equal(result.fieldSources.companyName, "factual");
  });

  await t.test("adapter fields downgrade by one tier when signature verification fails", async () => {
    resetAdaptersForTesting();
    registerSiteAdapter(createMockAdapter("signature-fail", (url) =>
      url.includes("signature-fail.example")
        ? { siteKey: "signature-fail" }
        : undefined,
    (html) => ({
      fields: {
        companyName: {
          value: "어댑터 회사",
          tier: "factual"
        },
        roleName: {
          value: "어댑터 역할",
          tier: "contextual"
        },
        qualifications: {
          value: "TypeScript 경험",
          tier: "role"
        }
      },
      signatureVerified: verifySignature(html, [".missing-signature"]),
      adapterTrust: "medium",
      warnings: []
    })));

    const result = await extractFromHtml(`
      <html>
        <head><title>정상 회사 | 백엔드 엔지니어</title></head>
        <body><div class="different-signature">nope</div></body>
      </html>
    `, "https://signature-fail.example/jobs/1");

    assert.equal(result.fieldSources.companyName, "contextual");
    assert.equal(result.fieldSources.roleName, "role");
    assert.equal(result.fieldSources.qualifications, "role");
    assert.ok(result.warnings.includes("site_signature_mismatch:signature-fail"));
  });

  await t.test("downgradeTier demotes factual to contextual to role and keeps role stable", () => {
    resetAdaptersForTesting();
    assert.equal(downgradeTier("factual"), "contextual");
    assert.equal(downgradeTier("contextual"), "role");
    assert.equal(downgradeTier("role"), "role");
  });

  await t.test("adapter fields override conflicting JSON-LD values when adapter trust is high", async () => {
    resetAdaptersForTesting();
    registerSiteAdapter(createMockAdapter("high-trust", (url) =>
      url.includes("high-trust.example")
        ? { siteKey: "high-trust" }
        : undefined,
    (html) => ({
      fields: {
        companyName: {
          value: "어댑터 회사",
          tier: "contextual"
        },
        roleName: {
          value: "어댑터 역할",
          tier: "factual"
        }
      },
      signatureVerified: verifySignature(html, ["#signature"]),
      adapterTrust: "high",
      warnings: []
    })));

    const result = await extractFromHtml(`
      <html>
        <head>
          <title>정상 회사 | JSON 역할</title>
          <script type="application/ld+json">
            {
              "@type": "JobPosting",
              "title": "JSON 역할",
              "hiringOrganization": { "name": "JSON 회사" }
            }
          </script>
        </head>
        <body><div id="signature">ok</div></body>
      </html>
    `, "https://high-trust.example/jobs/1");

    assert.equal(result.companyName, "어댑터 회사");
    assert.equal(result.roleName, "어댑터 역할");
    assert.equal(result.fieldSources.companyName, "contextual");
    assert.equal(result.fieldSources.roleName, "factual");
  });

  await t.test("adapter warnings merge into the final warnings list", async () => {
    resetAdaptersForTesting();
    registerSiteAdapter(createMockAdapter("warning-merge", (url) =>
      url.includes("warning-merge.example")
        ? { siteKey: "warning-merge" }
        : undefined,
    () => ({
      fields: {},
      signatureVerified: true,
      adapterTrust: "low",
      warnings: ["adapter_warning"]
    })));

    const result = await extractFromHtml(`
      <html>
        <head><title>정상 회사 | 백엔드 엔지니어</title></head>
        <body>
          <section>
            <h2>주요 업무</h2>
            <p>API 서버 개발</p>
          </section>
        </body>
      </html>
    `, "https://warning-merge.example/jobs/1");

    assert.ok(result.warnings.includes("adapter_warning"));
    assert.ok(result.warnings.includes("자격요건 섹션을 명확히 찾지 못했습니다."));
  });

  await t.test("adapter-provided company or role fields bypass ATS title filtering", async () => {
    resetAdaptersForTesting();
    registerSiteAdapter(createMockAdapter("ats-identity", (url) =>
      url.includes("www.wanted.co.kr")
        ? { siteKey: "ats-identity" }
        : undefined,
    () => ({
      fields: {
        companyName: {
          value: "테스트컴퍼니",
          tier: "factual"
        },
        roleName: {
          value: "플랫폼 백엔드 엔지니어",
          tier: "factual"
        }
      },
      signatureVerified: true,
      adapterTrust: "medium",
      warnings: []
    })));

    const result = await extractFromHtml(`
      <html>
        <head><title>원티드 | 개발자 채용</title></head>
        <body></body>
      </html>
    `, "https://www.wanted.co.kr/wd/123456");

    assert.equal(result.pageTitle, "원티드 | 개발자 채용");
    assert.equal(result.companyName, "테스트컴퍼니");
    assert.equal(result.roleName, "플랫폼 백엔드 엔지니어");
  });

  await t.test("high-trust adapter with verified signature bypasses ATS title filtering even without identity fields", async () => {
    resetAdaptersForTesting();
    registerSiteAdapter(createMockAdapter("ats-high-trust", (url) =>
      url.includes("www.wanted.co.kr")
        ? { siteKey: "ats-high-trust" }
        : undefined,
    (html) => ({
      fields: {},
      signatureVerified: verifySignature(html, [".ats-signature"]),
      adapterTrust: "high",
      warnings: []
    })));

    const result = await extractFromHtml(`
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
        <body><div class="ats-signature">ok</div></body>
      </html>
    `, "https://www.wanted.co.kr/wd/654321");

    assert.equal(result.pageTitle, "원티드 | 개발자 채용");
    assert.equal(result.companyName, "테스트컴퍼니");
    assert.equal(result.roleName, "플랫폼 백엔드 엔지니어");
    assert.equal(result.fieldSources.companyName, "factual");
    assert.equal(result.fieldSources.roleName, "factual");
  });
});

function createMockAdapter(
  siteKey: string,
  match: SiteAdapter["match"],
  extract?: SiteAdapter["extract"]
): SiteAdapter {
  return {
    siteKey,
    match,
    extract: extract ?? (() => undefined)
  };
}

async function extractFromHtml(html: string, jobPostingUrl = "https://adapter.example/jobs/1") {
  const mockFetch = async (): Promise<Response> =>
    ({
      ok: true,
      status: 200,
      url: jobPostingUrl,
      headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
      text: async () => html
    }) as Response;

  return fetchAndExtractJobPosting(
    {
      jobPostingUrl
    },
    mockFetch
  );
}
