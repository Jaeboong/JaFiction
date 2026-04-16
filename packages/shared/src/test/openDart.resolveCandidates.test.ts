import * as assert from "node:assert/strict";
import test from "node:test";
import { resolveCompanyCandidates, type CorpCodeEntry } from "../core/openDart";

test("resolveCompanyCandidates filters token fragments from fuzzy matches", () => {
  const entries: CorpCodeEntry[] = [
    { corpCode: "001", corpName: "더케이", modifyDate: "20260401" },
    { corpCode: "002", corpName: "케이", modifyDate: "20260401" },
    { corpCode: "003", corpName: "원", modifyDate: "20260401" },
    { corpCode: "004", corpName: "더케이교직원나라서비스", modifyDate: "20260401" }
  ];

  const resolution = resolveCompanyCandidates(entries, "더케이교직원나라");

  assert.equal(resolution.status, "resolved");
  if (resolution.status !== "resolved") {
    return;
  }

  assert.equal(resolution.match.corpCode, "004");
  assert.equal(resolution.match.corpName, "더케이교직원나라서비스");
});

test("resolveCompanyCandidates dedupes identical corp names and prefers listed companies", () => {
  const entries: CorpCodeEntry[] = [
    { corpCode: "001", corpName: "에코마케팅", modifyDate: "20260401" },
    { corpCode: "002", corpName: "에코마케팅", stockCode: "230360", modifyDate: "20260301" }
  ];

  const resolution = resolveCompanyCandidates(entries, "에코마케팅");

  assert.equal(resolution.status, "resolved");
  if (resolution.status !== "resolved") {
    return;
  }

  assert.equal(resolution.match.corpCode, "002");
  assert.equal(resolution.match.stockCode, "230360");
});

test("resolveCompanyCandidates prefers the latest modifyDate when deduping unlisted duplicates", () => {
  const entries: CorpCodeEntry[] = [
    { corpCode: "001", corpName: "테스트컴퍼니", modifyDate: "20240101" },
    { corpCode: "002", corpName: "테스트컴퍼니", modifyDate: "20260401" }
  ];

  const resolution = resolveCompanyCandidates(entries, "테스트컴퍼니");

  assert.equal(resolution.status, "resolved");
  if (resolution.status !== "resolved") {
    return;
  }

  assert.equal(resolution.match.corpCode, "002");
});
