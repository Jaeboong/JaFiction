import * as assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fetchAndExtractJobPosting } from "../core/jobPosting";

const goldensDir = path.join(__dirname, "../../src/test/goldens/posting");

interface GoldenExpected {
  companyName: string | null;
  roleName: string | null;
  normalizedTextMinLength: number;
  fieldSources: Record<string, string>;
  mustNotContain: readonly string[];
}

interface GoldenEntry {
  name: string;
  html: string;
  sourceUrl: string;
  expected: GoldenExpected;
}

function loadGoldens(): GoldenEntry[] {
  const htmlFiles = readdirSync(goldensDir).filter((f) => f.endsWith(".html"));
  return htmlFiles.map((htmlFile) => {
    const name = htmlFile.replace(/\.html$/, "");
    const htmlPath = path.join(goldensDir, htmlFile);
    const expectedPath = path.join(goldensDir, `${name}.expected.json`);
    const html = readFileSync(htmlPath, "utf8");
    const fixture = JSON.parse(readFileSync(expectedPath, "utf8")) as {
      sourceUrl: string;
      expected: GoldenExpected;
    };
    return {
      name,
      html,
      sourceUrl: fixture.sourceUrl,
      expected: fixture.expected
    };
  });
}

for (const g of loadGoldens()) {
  test(`golden: ${g.name}`, async () => {
    const html = g.html;
    const sourceUrl = g.sourceUrl;

    const mockFetch = async (): Promise<Response> => {
      return {
        ok: true,
        status: 200,
        url: sourceUrl,
        headers: new Headers({ "content-type": "text/html; charset=utf-8" }),
        text: async () => html
      } as Response;
    };

    const result = await fetchAndExtractJobPosting(
      { jobPostingUrl: sourceUrl },
      mockFetch
    );

    // companyName / roleName: null 기대값이면 undefined로 나와야 함 (P1 이전 jobkorea)
    if (g.expected.companyName === null) {
      assert.equal(
        result.companyName,
        undefined,
        `companyName should be undefined in ${g.name}`
      );
    } else {
      assert.equal(
        result.companyName,
        g.expected.companyName,
        `companyName mismatch in ${g.name}`
      );
    }

    if (g.expected.roleName === null) {
      assert.equal(
        result.roleName,
        undefined,
        `roleName should be undefined in ${g.name}`
      );
    } else {
      assert.equal(
        result.roleName,
        g.expected.roleName,
        `roleName mismatch in ${g.name}`
      );
    }

    assert.ok(
      result.normalizedText.length >= g.expected.normalizedTextMinLength,
      `normalizedText too short in ${g.name}: ${result.normalizedText.length} < ${g.expected.normalizedTextMinLength}`
    );

    assert.deepEqual(
      result.fieldSources,
      g.expected.fieldSources,
      `fieldSources mismatch in ${g.name}`
    );

    for (const forbidden of g.expected.mustNotContain) {
      assert.ok(
        !result.companyName?.includes(forbidden),
        `companyName contains forbidden "${forbidden}" in ${g.name}`
      );
      assert.ok(
        !result.roleName?.includes(forbidden),
        `roleName contains forbidden "${forbidden}" in ${g.name}`
      );
    }
  });
}
