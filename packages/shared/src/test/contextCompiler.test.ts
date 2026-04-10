import * as assert from "node:assert/strict";
import test from "node:test";
import { ContextCompiler } from "../core/contextCompiler";
import { cleanupTempWorkspace, createStorage, createTempWorkspace } from "./helpers";

test("context compiler includes pinned and selected documents only", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject(
    {
      companyName: "Shinhan Bank",
      roleName: "Backend",
      mainResponsibilities: "검색 색인(Indexing) 및 데이터 처리 파이프라인 개발",
      qualifications: "문제 해결 과정에서 원인을 논리적으로 분석하고 개선해 본 경험",
      preferredQualifications: "금융 도메인 또는 대용량 트랜잭션 경험",
      keywords: ["Java", "Spring Boot", "Kafka"]
    }
  );
  const compiler = new ContextCompiler(storage);

  const pinnedProfile = await storage.saveProfileTextDocument("Profile pinned", "Always include me", true);
  await storage.saveProfileTextDocument("Profile hidden", "Do not include me");
  const selectedProfile = await storage.saveProfileTextDocument("Profile selected", "Select me");

  const pinnedProject = await storage.saveProjectTextDocument(project.slug, "Project pinned", "Project default", true);
  await storage.saveProjectTextDocument(project.slug, "Project hidden", "Do not include me");
  const selectedProject = await storage.saveProjectTextDocument(project.slug, "Project selected", "Select me too");

  const compiled = await compiler.compile({
    project: await storage.getProject(project.slug),
    profileDocuments: await storage.listProfileDocuments(),
    projectDocuments: await storage.listProjectDocuments(project.slug),
    selectedDocumentIds: [selectedProfile.id, selectedProject.id],
    question: "Why this company?",
    draft: "Because I am interested."
  });

  assert.match(compiled.markdown, /Always include me/);
  assert.match(compiled.markdown, /Project default/);
  assert.match(compiled.markdown, /Select me/);
  assert.match(compiled.markdown, /## Main Responsibilities/);
  assert.match(compiled.markdown, /검색 색인\(Indexing\) 및 데이터 처리 파이프라인 개발/);
  assert.match(compiled.markdown, /## Qualifications/);
  assert.match(compiled.markdown, /문제 해결 과정에서 원인을 논리적으로 분석하고 개선해 본 경험/);
  assert.match(compiled.markdown, /## Preferred Qualifications/);
  assert.match(compiled.markdown, /금융 도메인 또는 대용량 트랜잭션 경험/);
  assert.match(compiled.markdown, /## Job Keywords/);
  assert.match(compiled.markdown, /Java/);
  assert.match(compiled.markdown, /Spring Boot/);
  assert.doesNotMatch(compiled.markdown, /Do not include me/);
  assert.ok(compiled.includedDocuments.some((document) => document.id === pinnedProfile.id));
  assert.ok(compiled.includedDocuments.some((document) => document.id === pinnedProject.id));
});

test("context compiler applies full, compact, and minimal prompt profiles", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Kurly", "Backend");
  const compiler = new ContextCompiler(storage);

  const documentBody = `핵심 요약 문장. ${"세부 근거 ".repeat(220)} COMPACT_TAIL_SHOULD_DISAPPEAR`;
  const draft = `도입 문장. ${"지원 동기와 경험 ".repeat(260)} DRAFT_TAIL_SHOULD_DISAPPEAR`;
  const profileDocument = await storage.saveProfileTextDocument("Profile digest", documentBody, true);

  const baseRequest = {
    project: await storage.getProject(project.slug),
    profileDocuments: await storage.listProfileDocuments(),
    projectDocuments: await storage.listProjectDocuments(project.slug),
    selectedDocumentIds: [profileDocument.id],
    question: "Why Kurly?",
    draft
  };

  const full = await compiler.compile({
    ...baseRequest,
    profile: "full"
  });
  const compact = await compiler.compile({
    ...baseRequest,
    profile: "compact"
  });
  const minimal = await compiler.compile({
    ...baseRequest,
    profile: "minimal"
  });

  assert.match(full.markdown, /COMPACT_TAIL_SHOULD_DISAPPEAR/);
  assert.match(full.markdown, /DRAFT_TAIL_SHOULD_DISAPPEAR/);

  assert.match(compact.markdown, /Prompt digest/);
  assert.doesNotMatch(compact.markdown, /COMPACT_TAIL_SHOULD_DISAPPEAR/);
  assert.match(compact.markdown, /## Current Draft/);

  assert.match(minimal.markdown, /## Current Draft Excerpt/);
  assert.match(minimal.markdown, /Document bodies omitted in minimal profile/);
  assert.doesNotMatch(minimal.markdown, /COMPACT_TAIL_SHOULD_DISAPPEAR/);
  assert.doesNotMatch(minimal.markdown, /DRAFT_TAIL_SHOULD_DISAPPEAR/);
});

test("context compiler automatically includes generated insight documents pinned by default", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject("Eco Marketing", "Backend");
  await storage.saveOrUpdateProjectGeneratedDocument(
    project.slug,
    "company-insight.md",
    "# Company Insight\n공식 공시 기반 요약",
    "generated",
    true
  );

  const compiler = new ContextCompiler(storage);
  const compiled = await compiler.compile({
    project: await storage.getProject(project.slug),
    profileDocuments: await storage.listProfileDocuments(),
    projectDocuments: await storage.listProjectDocuments(project.slug),
    selectedDocumentIds: [],
    question: "지원 동기를 작성해주세요.",
    draft: ""
  });

  assert.match(compiled.markdown, /company-insight\.md/);
  assert.match(compiled.markdown, /공식 공시 기반 요약/);
});

test("context compiler automatically includes completed essay answers saved as project documents", async (t) => {
  const workspaceRoot = await createTempWorkspace();
  t.after(async () => cleanupTempWorkspace(workspaceRoot));

  const storage = await createStorage(workspaceRoot);
  const project = await storage.createProject({
    companyName: "Eco Marketing",
    roleName: "Backend",
    essayQuestions: ["지원 동기를 작성해주세요."]
  });
  await storage.saveCompletedEssayAnswer(
    project.slug,
    0,
    "지원 동기를 작성해주세요.",
    "완료된 문항 답안입니다."
  );

  const compiler = new ContextCompiler(storage);
  const compiled = await compiler.compile({
    project: await storage.getProject(project.slug),
    profileDocuments: await storage.listProfileDocuments(),
    projectDocuments: await storage.listProjectDocuments(project.slug),
    selectedDocumentIds: [],
    question: "지원 동기를 작성해주세요.",
    draft: "작성 중 초안"
  });

  assert.match(compiled.markdown, /essay-answer-q1\.md/);
  assert.match(compiled.markdown, /완료된 문항 답안입니다/);
});
