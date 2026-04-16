import * as assert from "node:assert/strict";
import test from "node:test";
import { cleanupTempWorkspace, createStorage, createTempWorkspace } from "./helpers";

test("storage clears OpenDART candidates and skip flag when company name changes", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject({
    companyName: "더케이교직원나라(주)",
    essayQuestions: ["지원 동기를 작성해주세요."]
  });

  await storage.updateProject({
    ...project,
    openDartCorpCode: "00126380",
    openDartCorpName: "더케이교직원나라",
    openDartStockCode: "089590",
    openDartCandidates: [
      {
        corpCode: "00126380",
        corpName: "더케이교직원나라",
        stockCode: "089590"
      }
    ],
    openDartSkipRequested: true
  });

  const updated = await storage.updateProjectInfo(project.slug, {
    companyName: "에코마케팅"
  });

  assert.equal(updated.companyName, "에코마케팅");
  assert.equal(updated.openDartCandidates, undefined);
  assert.equal(updated.openDartSkipRequested, undefined);
  assert.equal(updated.openDartCorpCode, "00126380");
});

test("storage applies explicit OpenDART skip patch and candidate clear", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject({
    companyName: "NAVER",
    essayQuestions: ["지원 동기를 작성해주세요."]
  });

  await storage.updateProject({
    ...project,
    openDartCandidates: [
      {
        corpCode: "00126380",
        corpName: "NAVER",
        stockCode: "035420"
      }
    ]
  });

  const updated = await storage.updateProjectInfo(project.slug, {
    companyName: "NAVER",
    openDartCandidates: undefined,
    openDartSkipRequested: true
  });

  assert.equal(updated.openDartCandidates, undefined);
  assert.equal(updated.openDartSkipRequested, true);
});

test("storage preserves existing OpenDART candidates when corp code is selected directly", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject({
    companyName: "NAVER",
    essayQuestions: ["지원 동기를 작성해주세요."]
  });

  await storage.updateProject({
    ...project,
    openDartCandidates: [
      {
        corpCode: "00126380",
        corpName: "NAVER",
        stockCode: "035420"
      }
    ]
  });

  const updated = await storage.updateProjectInfo(project.slug, {
    companyName: "NAVER",
    openDartCorpCode: "00126380"
  });

  assert.deepEqual(updated.openDartCandidates, [
    {
      corpCode: "00126380",
      corpName: "NAVER",
      stockCode: "035420"
    }
  ]);
});
