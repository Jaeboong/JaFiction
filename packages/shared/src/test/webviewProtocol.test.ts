import * as assert from "node:assert/strict";
import test from "node:test";
import { DiscussionLedgerSchema, RunRecordSchema } from "../core/schemas";
import { ExtensionToWebviewMessageSchema, WebviewToExtensionMessageSchema } from "../core/webviewProtocol";

test("webview message schema rejects invalid payloads", () => {
  assert.throws(
    () => WebviewToExtensionMessageSchema.parse({
      type: "runReview",
      projectSlug: "alpha",
      question: "question",
      draft: "draft",
      reviewMode: "deepFeedback",
      coordinatorProvider: "unknown",
      reviewerProviders: ["claude"],
      rounds: 1,
      selectedDocumentIds: []
    }),
    /Invalid enum value/
  );

  assert.throws(
    () => WebviewToExtensionMessageSchema.parse({
      type: "uploadProjectFiles",
      files: [{ fileName: "resume.txt", contentBase64: "ZGF0YQ==" }]
    }),
    /projectSlug/
  );
});

test("webview message schema accepts review mode on run and continuation payloads", () => {
  const runMessage = WebviewToExtensionMessageSchema.parse({
    type: "runReview",
    projectSlug: "alpha",
    projectQuestionIndex: 1,
    question: "question",
    draft: "draft",
    reviewMode: "realtime",
    roleAssignments: [
      {
        role: "section_coordinator",
        providerId: "claude",
        useProviderDefaults: true
      },
      {
        role: "section_drafter",
        providerId: "codex",
        useProviderDefaults: false,
        modelOverride: "gpt-5.4",
        effortOverride: "medium"
      }
    ],
    coordinatorProvider: "claude",
    reviewerProviders: ["codex", "codex"],
    rounds: 1,
    maxRoundsPerSection: 3,
    selectedDocumentIds: []
  });

  assert.equal(runMessage.type, "runReview");
  assert.equal(runMessage.reviewMode, "realtime");
  assert.equal(runMessage.projectQuestionIndex, 1);
  assert.equal(runMessage.maxRoundsPerSection, 3);
  assert.deepEqual(runMessage.reviewerProviders, ["codex", "codex"]);
  assert.equal(runMessage.roleAssignments?.length, 2);
  assert.equal(runMessage.roleAssignments?.[1]?.modelOverride, "gpt-5.4");

  const continuationMessage = ExtensionToWebviewMessageSchema.parse({
    type: "continuationPreset",
    payload: {
      projectSlug: "alpha",
      runId: "run-1",
      projectQuestionIndex: 1,
      question: "question",
      draft: "draft",
      reviewMode: "deepFeedback",
      notionRequest: "",
      roleAssignments: [
        {
          role: "fit_reviewer",
          providerId: "gemini",
          useProviderDefaults: true
        }
      ],
      coordinatorProvider: "claude",
      reviewerProviders: ["codex", "gemini"],
      selectedDocumentIds: []
    }
  });

  assert.equal(continuationMessage.type, "continuationPreset");
  assert.equal(continuationMessage.payload.reviewMode, "deepFeedback");
  assert.equal(continuationMessage.payload.projectQuestionIndex, 1);
  assert.equal(continuationMessage.payload.maxRoundsPerSection, 1);
  assert.equal(continuationMessage.payload.roleAssignments?.[0]?.role, "fit_reviewer");

  const continueMessage = WebviewToExtensionMessageSchema.parse({
    type: "continueRunDiscussion",
    projectSlug: "alpha",
    runId: "run-1",
    message: "이 final draft에서 협업 문단만 더 날카롭게 다듬어줘"
  });

  assert.equal(continueMessage.type, "continueRunDiscussion");
  assert.equal(continueMessage.runId, "run-1");

  const clientErrorMessage = WebviewToExtensionMessageSchema.parse({
    type: "webviewClientError",
    source: "insightWorkspace",
    message: "Cannot read properties of undefined",
    stack: "TypeError: Cannot read properties of undefined",
    href: "vscode-webview://forjob",
    phase: "window.error"
  });

  assert.equal(clientErrorMessage.type, "webviewClientError");
  assert.equal(clientErrorMessage.source, "insightWorkspace");

  const completeQuestionMessage = WebviewToExtensionMessageSchema.parse({
    type: "completeEssayQuestion",
    projectSlug: "alpha",
    questionIndex: 1,
    question: "협업 경험을 작성해주세요.",
    answer: "서비스 장애를 줄이기 위해 협업한 경험입니다.",
    runId: "run-1"
  });

  assert.equal(completeQuestionMessage.type, "completeEssayQuestion");
  assert.equal(completeQuestionMessage.questionIndex, 1);
  assert.equal(completeQuestionMessage.runId, "run-1");
});

test("run record schema accepts legacy and role-based run payloads", () => {
  const legacyRecord = RunRecordSchema.parse({
    id: "run-legacy",
    projectSlug: "alpha",
    projectQuestionIndex: 0,
    question: "question",
    draft: "draft",
    reviewMode: "deepFeedback",
    coordinatorProvider: "claude",
    reviewerProviders: ["codex"],
    rounds: 1,
    selectedDocumentIds: [],
    status: "completed",
    startedAt: "2026-04-02T00:00:00.000Z"
  });

  assert.equal(legacyRecord.id, "run-legacy");
  assert.equal(legacyRecord.projectQuestionIndex, 0);
  assert.equal(legacyRecord.maxRoundsPerSection, 1);
  assert.equal(legacyRecord.roleAssignments, undefined);

  const roleBasedRecord = RunRecordSchema.parse({
    ...legacyRecord,
    id: "run-role-based",
    maxRoundsPerSection: 3,
    roleAssignments: [
      {
        role: "section_coordinator",
        providerId: "claude"
      },
      {
        role: "section_drafter",
        providerId: "codex",
        useProviderDefaults: false,
        modelOverride: "gpt-5.4"
      }
    ]
  });

  assert.equal(roleBasedRecord.roleAssignments?.length, 2);
  assert.equal(roleBasedRecord.maxRoundsPerSection, 3);
  assert.equal(roleBasedRecord.roleAssignments?.[0]?.useProviderDefaults, true);
  assert.equal(roleBasedRecord.roleAssignments?.[1]?.modelOverride, "gpt-5.4");

  const abortedRecord = RunRecordSchema.parse({
    ...legacyRecord,
    id: "run-aborted",
    status: "aborted",
    finishedAt: "2026-04-02T00:10:00.000Z"
  });

  assert.equal(abortedRecord.status, "aborted");
  assert.equal(abortedRecord.finishedAt, "2026-04-02T00:10:00.000Z");
});

test("extension message schema accepts discussion ledger events and artifact flags", () => {
  const ledgerEvent = ExtensionToWebviewMessageSchema.parse({
    type: "runEvent",
    payload: {
      timestamp: "2026-04-02T00:00:00.000Z",
      type: "discussion-ledger-updated",
      providerId: "claude",
      participantId: "coordinator",
      participantLabel: "Claude coordinator",
      round: 2,
      speakerRole: "coordinator",
      message: "성과 문장을 먼저 수습합니다.",
      discussionLedger: {
        currentFocus: "성과 문장을 먼저 수습합니다.",
        miniDraft: "결제 안정화 경험을 문장 앞에 배치합니다.",
        acceptedDecisions: ["성과 수치를 앞단에 둔다"],
        openChallenges: ["회사 적합도 근거가 아직 약하다"],
        deferredChallenges: ["마지막 포부 문단을 더 구체화한다"],
        targetSection: "지원 동기 1문단",
        targetSectionKey: "supporting-motivation",
        sectionOutcome: "handoff-next-section",
        tickets: [
          {
            id: "ticket-1",
            text: "회사 적합도 근거를 더 구체화한다",
            sectionKey: "supporting-motivation",
            sectionLabel: "지원 동기 1문단",
            severity: "blocking",
            status: "open",
            source: "coordinator",
            introducedAtRound: 2,
            lastUpdatedAtRound: 2,
            handoffPriority: 10,
            evidenceNeeded: "회사와의 연결 근거"
          },
          {
            id: "ticket-2",
            text: "마지막 포부 문단을 더 구체화한다",
            sectionKey: "future-impact",
            sectionLabel: "마지막 포부 문단",
            severity: "advisory",
            status: "deferred",
            source: "reviewer",
            introducedAtRound: 2,
            lastUpdatedAtRound: 2,
            handoffPriority: 3,
            closeCondition: "후속 문단에서 재검토"
          }
        ],
        updatedAtRound: 2
      }
    }
  });

  assert.equal(ledgerEvent.type, "runEvent");
  assert.equal(ledgerEvent.payload.type, "discussion-ledger-updated");
  assert.equal(ledgerEvent.payload.discussionLedger?.targetSection, "지원 동기 1문단");

  const legacyLedger = DiscussionLedgerSchema.parse({
    currentFocus: "현재 초점",
    miniDraft: "미니 초안",
    acceptedDecisions: ["합의"],
    openChallenges: ["보강 필요"],
    deferredChallenges: ["후속 과제"],
    targetSection: "지원 동기 1문단",
    updatedAtRound: 2
  });
  assert.equal(legacyLedger.tickets, undefined);

  const ticketLedger = DiscussionLedgerSchema.parse({
    ...legacyLedger,
    targetSectionKey: "supporting-motivation",
    sectionOutcome: "handoff-next-section",
    tickets: [
      {
        id: "ticket-1",
        text: "회사 적합도 근거를 더 구체화한다",
        sectionKey: "supporting-motivation",
        sectionLabel: "지원 동기 1문단",
        severity: "blocking",
        status: "open",
        source: "coordinator",
        introducedAtRound: 2,
        lastUpdatedAtRound: 2,
        handoffPriority: 10
      }
    ]
  });
  assert.equal(ticketLedger.sectionOutcome, "handoff-next-section");
  assert.equal(ticketLedger.tickets?.[0]?.id, "ticket-1");

  const abortedRunEvent = ExtensionToWebviewMessageSchema.parse({
    type: "runEvent",
    payload: {
      timestamp: "2026-04-02T00:00:00.000Z",
      type: "run-aborted",
      message: "Run aborted by user."
    }
  });
  assert.equal(abortedRunEvent.type, "runEvent");
  assert.equal(abortedRunEvent.payload.type, "run-aborted");

  const stateMessage = ExtensionToWebviewMessageSchema.parse({
    type: "state",
    payload: {
      workspaceOpened: true,
      extensionVersion: "0.1.0",
      openDartConfigured: false,
      providers: [],
      profileDocuments: [],
      projects: [
        {
          record: {
            projectSlug: "alpha",
            slug: "alpha",
            companyName: "Alpha",
            rubric: "- fit",
            pinnedDocumentIds: [],
            createdAt: "2026-04-02T00:00:00.000Z",
            updatedAt: "2026-04-02T00:00:00.000Z"
          },
          documents: [],
          runs: [
            {
              record: {
                id: "run-1",
                projectSlug: "alpha",
                question: "question",
                draft: "draft",
                reviewMode: "realtime",
                coordinatorProvider: "claude",
                reviewerProviders: ["codex"],
                rounds: 2,
                selectedDocumentIds: [],
                status: "completed",
                startedAt: "2026-04-02T00:00:00.000Z"
              },
              artifacts: {
                summary: false,
                improvementPlan: false,
                revisedDraft: true,
                finalChecks: true,
                discussionLedger: true,
                promptMetrics: false,
                notionBrief: false,
                chatMessages: false,
                events: true
              }
            }
          ]
        }
      ],
      preferences: {},
      agentDefaults: {},
      runState: { status: "idle" },
      defaultRubric: "- fit"
    }
  });

  assert.equal(stateMessage.type, "state");
  assert.equal(stateMessage.payload.projects[0]?.runs[0]?.artifacts.finalChecks, true);
  assert.equal(stateMessage.payload.projects[0]?.runs[0]?.artifacts.discussionLedger, true);
});

test("webview message schema accepts structured project fields", () => {
  const createProjectMessage = WebviewToExtensionMessageSchema.parse({
    type: "createProject",
    companyName: "g마켓",
    roleName: "검색 엔진 및 Backend 개발 및 운영",
    mainResponsibilities: "검색 색인(Indexing) 및 데이터 처리 파이프라인 개발",
    qualifications: "자료구조, 운영체제, 네트워크 등 CS 기초 지식에 대한 이해도 보유",
    preferredQualifications: "대용량 시스템 운영 경험",
    keywords: ["Java", "Spring Boot"],
    jobPostingUrl: "https://example.com/jobs/1",
    essayQuestions: ["지원 동기를 작성해주세요."],
    openDartCorpCode: "00126380"
  });

  assert.equal(createProjectMessage.type, "createProject");
  assert.equal(createProjectMessage.roleName, "검색 엔진 및 Backend 개발 및 운영");
  assert.equal(createProjectMessage.mainResponsibilities, "검색 색인(Indexing) 및 데이터 처리 파이프라인 개발");
  assert.equal(createProjectMessage.qualifications, "자료구조, 운영체제, 네트워크 등 CS 기초 지식에 대한 이해도 보유");
  assert.equal(createProjectMessage.preferredQualifications, "대용량 시스템 운영 경험");
  assert.deepEqual(createProjectMessage.keywords, ["Java", "Spring Boot"]);
  assert.equal(createProjectMessage.jobPostingUrl, "https://example.com/jobs/1");
  assert.deepEqual(createProjectMessage.essayQuestions, ["지원 동기를 작성해주세요."]);
  assert.equal(createProjectMessage.openDartCorpCode, "00126380");

  const updateProjectMessage = WebviewToExtensionMessageSchema.parse({
    type: "updateProjectInfo",
    projectSlug: "gmarket-search",
    companyName: "g마켓",
    roleName: "검색 엔진 및 Backend 개발 및 운영",
    mainResponsibilities: "검색 품질 향상을 위한 데이터 분석 및 개선 과제 수행",
    qualifications: "문제 해결 과정에서 원인을 논리적으로 분석하고 개선해 본 경험",
    jobPostingText: "주요 업무\n검색 품질 향상을 위한 데이터 분석",
    essayQuestions: ["협업 경험을 작성해주세요."]
  });

  assert.equal(updateProjectMessage.type, "updateProjectInfo");
  assert.equal(updateProjectMessage.projectSlug, "gmarket-search");
  assert.equal(updateProjectMessage.mainResponsibilities, "검색 품질 향상을 위한 데이터 분석 및 개선 과제 수행");
  assert.equal(updateProjectMessage.qualifications, "문제 해결 과정에서 원인을 논리적으로 분석하고 개선해 본 경험");
  assert.equal(updateProjectMessage.jobPostingText, "주요 업무\n검색 품질 향상을 위한 데이터 분석");
  assert.deepEqual(updateProjectMessage.essayQuestions, ["협업 경험을 작성해주세요."]);

  const analyzeMessage = WebviewToExtensionMessageSchema.parse({
    type: "analyzeProjectInsights",
    projectSlug: "gmarket-search",
    companyName: "g마켓",
    roleName: "백엔드 개발자",
    jobPostingUrl: "https://example.com/jobs/2"
  });
  assert.equal(analyzeMessage.type, "analyzeProjectInsights");
  assert.equal(analyzeMessage.jobPostingUrl, "https://example.com/jobs/2");

  const generateMessage = WebviewToExtensionMessageSchema.parse({
    type: "generateProjectInsights",
    projectSlug: "gmarket-search",
    companyName: "g마켓",
    roleName: "백엔드 개발자",
    essayQuestions: ["지원 동기를 작성해주세요."]
  });
  assert.equal(generateMessage.type, "generateProjectInsights");
  assert.deepEqual(generateMessage.essayQuestions, ["지원 동기를 작성해주세요."]);

  const previewRequest = WebviewToExtensionMessageSchema.parse({
    type: "openProfileDocumentPreview",
    documentId: "doc-1"
  });
  assert.equal(previewRequest.type, "openProfileDocumentPreview");

  const previewMessage = ExtensionToWebviewMessageSchema.parse({
    type: "profileDocumentPreview",
    payload: {
      documentId: "doc-1",
      title: "경력 요약",
      note: "핵심 버전",
      sourceType: "md",
      extractionStatus: "normalized",
      rawPath: ".forjob/profile/raw/career.txt",
      normalizedPath: ".forjob/profile/normalized/career.md",
      previewSource: "normalized",
      content: "# Career"
    }
  });
  assert.equal(previewMessage.type, "profileDocumentPreview");
  assert.equal(previewMessage.payload.previewSource, "normalized");
});

test("extension message schema requires typed sidebar state payload", () => {
  assert.throws(
    () => ExtensionToWebviewMessageSchema.parse({
      type: "state",
      payload: {
        workspaceOpened: true,
        extensionVersion: "0.1.0",
        openDartConfigured: false,
        providers: [],
        profileDocuments: [],
        projects: [],
        preferences: {},
        agentDefaults: {},
        defaultRubric: "- fit"
      }
    }),
    /runState/
  );
});
