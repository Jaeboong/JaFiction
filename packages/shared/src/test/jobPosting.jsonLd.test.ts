import * as assert from "node:assert/strict";
import test from "node:test";
import {
  extractJsonLdJobPosting,
  normalizeEmploymentType,
  normalizeJobPostingRoleName,
  normalizeValidThroughIso,
  stripJobPostingDescriptionHtml
} from "../core/jobPosting/jsonLd";

test("extractJsonLdJobPosting returns undefined when the html has no JSON-LD block", () => {
  assert.equal(extractJsonLdJobPosting("<html><body><h1>No schema</h1></body></html>"), undefined);
});

test("extractJsonLdJobPosting maps a single JobPosting object", () => {
  const html = `
    <html>
      <head>
        <script data-source="fixture" TYPE="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "JobPosting",
            "title": "플랫폼 백엔드 엔지니어",
            "hiringOrganization": { "@type": "Organization", "name": "테스트컴퍼니" },
            "description": "<p>안녕하세요<br/>반갑습니다</p>&amp;amp;",
            "datePosted": "2026-04-19",
            "validThrough": "2026-05-01T23:59:00+09:00",
            "employmentType": "FULL_TIME",
            "jobLocation": {
              "@type": "Place",
              "address": {
                "@type": "PostalAddress",
                "addressLocality": "서울",
                "streetAddress": "강남구 테헤란로 1"
              }
            },
            "baseSalary": {
              "@type": "MonetaryAmount",
              "currency": "KRW",
              "value": {
                "@type": "QuantitativeValue",
                "minValue": 5000,
                "maxValue": 7000,
                "unitText": "MONTH"
              }
            }
          }
        </script>
      </head>
    </html>
  `;

  assert.deepEqual(extractJsonLdJobPosting(html), {
    title: "플랫폼 백엔드 엔지니어",
    companyName: "테스트컴퍼니",
    description: "안녕하세요\n반갑습니다&amp;",
    datePosted: "2026-04-19",
    validThrough: "2026-05-01T23:59:00+09:00",
    employmentType: "FULL_TIME",
    locationText: "서울 강남구 테헤란로 1",
    baseSalaryText: "KRW 5000 ~ 7000 / MONTH",
    sourceTier: "factual"
  });
});

test("extractJsonLdJobPosting matches when @type is an array containing JobPosting", () => {
  const html = `
    <script type="application/ld+json">
      {
        "@type": ["JobPosting", "WebPage"],
        "title": "Data Engineer",
        "hiringOrganization": { "name": "Array Corp" }
      }
    </script>
  `;

  assert.deepEqual(extractJsonLdJobPosting(html), {
    title: "Data Engineer",
    companyName: "Array Corp",
    description: undefined,
    datePosted: undefined,
    validThrough: undefined,
    employmentType: undefined,
    locationText: undefined,
    baseSalaryText: undefined,
    sourceTier: "factual"
  });
});

test("extractJsonLdJobPosting finds JobPosting inside a top-level array", () => {
  const html = `
    <script type="application/ld+json">
      [
        { "@type": "WebPage", "name": "Landing" },
        { "@type": "JobPosting", "title": "Frontend Engineer", "hiringOrganization": { "name": "Array Wrapper" } }
      ]
    </script>
  `;

  const result = extractJsonLdJobPosting(html);
  assert.equal(result?.title, "Frontend Engineer");
  assert.equal(result?.companyName, "Array Wrapper");
  assert.equal(result?.sourceTier, "factual");
});

test("extractJsonLdJobPosting finds JobPosting inside an @graph wrapper", () => {
  const html = `
    <script type="application/ld+json">
      {
        "@graph": [
          { "@type": "Organization", "name": "Graph Corp" },
          { "@type": "JobPosting", "title": "QA Engineer", "hiringOrganization": { "name": "Graph Corp" } }
        ]
      }
    </script>
  `;

  const result = extractJsonLdJobPosting(html);
  assert.equal(result?.title, "QA Engineer");
  assert.equal(result?.companyName, "Graph Corp");
});

test("extractJsonLdJobPosting skips invalid JSON-LD blocks and uses the next valid block", () => {
  const html = `
    <script type="application/ld+json">{ invalid json }</script>
    <script type="application/ld+json">
      { "@type": "JobPosting", "title": "Site Reliability Engineer", "hiringOrganization": { "name": "Fallback Corp" } }
    </script>
  `;

  const result = extractJsonLdJobPosting(html);
  assert.equal(result?.title, "Site Reliability Engineer");
  assert.equal(result?.companyName, "Fallback Corp");
});

test("stripJobPostingDescriptionHtml converts paragraphs and breaks into normalized lines", () => {
  assert.equal(
    stripJobPostingDescriptionHtml("<p>안녕하세요<br/>반갑습니다</p>&amp;amp;"),
    "안녕하세요\n반갑습니다&amp;"
  );
});

test("normalizeJobPostingRoleName removes org prefix and extracts the parenthesized role", () => {
  assert.equal(
    normalizeJobPostingRoleName("㈜아이엠비씨 직원 채용(iOS 앱개발, SNS 운영)", "㈜아이엠비씨"),
    "iOS 앱개발, SNS 운영"
  );
});

test("normalizeJobPostingRoleName removes the trailing 채용 suffix", () => {
  assert.equal(
    normalizeJobPostingRoleName("소프트웨어 개발자 채용", "㈜네오정보시스템"),
    "소프트웨어 개발자"
  );
});

test("normalizeJobPostingRoleName keeps a plain title unchanged when there is no company prefix", () => {
  assert.equal(normalizeJobPostingRoleName("Backend Engineer"), "Backend Engineer");
});

test("normalizeJobPostingRoleName unwraps a title enclosed only by parentheses", () => {
  assert.equal(normalizeJobPostingRoleName("(데이터 엔지니어)"), "데이터 엔지니어");
});

test("normalizeEmploymentType maps known employment type tokens", () => {
  assert.equal(normalizeEmploymentType("FULL_TIME"), "정규직");
  assert.equal(normalizeEmploymentType("intern"), "인턴");
  assert.equal(normalizeEmploymentType("foo"), undefined);
});

test("normalizeValidThroughIso formats date-time and date-only values and rejects invalid input", () => {
  assert.equal(normalizeValidThroughIso("2026-05-01T23:59:00+09:00"), "2026년 05월 01일, 23:59");
  assert.equal(normalizeValidThroughIso("2026-05-01"), "2026년 05월 01일");
  assert.equal(normalizeValidThroughIso("not-an-iso"), undefined);
});
