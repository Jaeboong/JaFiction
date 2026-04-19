# Jasojeon Codebase Navigation

Use this document to find the right file quickly before reading or editing.  
For architectural rationale, see `ARCHITECTURE.md`. For workflow rules, see `OPERATING_RULES.md`.

---

## Task → Entry Point

| Task | Start here |
|------|-----------|
| AI 워크플로 로직 수정 | `packages/shared/src/core/orchestrator.ts` |
| 프로바이더(Claude/Gemini/Codex) 연동 | `packages/shared/src/core/providers.ts`, `providerStreaming.ts` |
| 타입 추가 / 변경 | `packages/shared/src/core/types.ts` |
| Zod 스키마 추가 / 변경 | `packages/shared/src/core/schemas.ts` |
| Runner HTTP API 라우트 추가 | `packages/runner/src/routes/` (아래 라우터 표 참고) |
| Runner 세션/CORS/WS 보안 경계 | `packages/runner/src/security/sessionAuth.ts`, `packages/runner/src/index.ts` |
| WebSocket 로직 | `packages/runner/src/ws/runHub.ts`, `stateHub.ts` |
| 실행 세션 상태 관리 | `packages/shared/src/controller/runSessionManager.ts` |
| 사이드바/UI 상태 | `packages/shared/src/controller/sidebarStateStore.ts` |
| 컨텍스트 빌드 (프롬프트 조립) | `packages/shared/src/core/contextCompiler.ts` |
| 프로젝트 저장 / 불러오기 | `packages/shared/src/core/storage.ts`, `storageInterfaces.ts` |
| 실행 기록(Run) CRUD | `packages/shared/src/core/runRepository.ts` |
| 자소서 문항 워크플로 | `packages/shared/src/core/essayQuestionWorkflow.ts` |
| Notion MCP 연동 | `packages/shared/src/core/notionMcp.ts` |
| OpenDart 연동 | `packages/shared/src/core/openDart.ts` |
| Web UI 진입점 | `packages/web/src/main.tsx`, `App.tsx` |
| Web API 호출 레이어 | `packages/web/src/api/client.ts` |
| Web 페이지 추가 | `packages/web/src/pages/` |
| Web 컴포넌트 추가 | `packages/web/src/components/` |
| 테스트 추가 / 수정 | `packages/shared/src/test/` |

---

## packages/shared/src/core/ — 파일별 역할

| 파일 | 역할 |
|------|------|
| `types.ts` | 전체 도메인 타입 및 const enum 정의 (ProviderId, RunStatus 등) |
| `schemas.ts` | Zod 스키마 — 외부 입력 경계 검증 |
| `orchestrator.ts` | 리뷰 라운드 실행, 개입 처리, 워크플로 코어 — **고위험** |
| `orchestrator/chatEvents.ts` | Run 이벤트를 채팅 메시지 뷰 모델로 누적하고 화자 라벨을 계산 |
| `orchestrator/notionRequest.ts` | Notion 사전 요청 정규화, request kind 결정, brief 압축 |
| `orchestrator/realtimeSections.ts` | realtime 섹션 기본 정의와 ledger 기반 섹션 목록 구성 |
| `orchestrator/continuation.ts` | continuation 컨텍스트 블록과 이전 대화 하이라이트 조립 |
| `orchestrator/participants.ts` | 역할 배정 기반 participant 빌더와 turn 라벨 계산 |
| `orchestrator/parsing/responseParsers.ts` | coordinator/finalizer/reviewer 응답 파싱과 discussion ledger Markdown 해석 |
| `orchestrator/discussion/discussionLedger.ts` | challenge ticket/ledger 정규화, handoff, deferred-close, intervention force-close 처리 |
| `orchestrator/discussion/convergenceEvaluator.ts` | reviewer verdict 집계와 realtime 섹션 종료/문서 종료 판단 |
| `orchestrator/prompts/languageRules.ts` | 한국어 응답·존댓말 규칙 프롬프트 블록 빌더 |
| `orchestrator/prompts/promptBlocks.ts` | 공통 프롬프트 조립 타입/메트릭과 재사용 블록 빌더 |
| `orchestrator/prompts/deepFeedbackPrompts.ts` | deep feedback 모드 프롬프트와 deep 전용 블록 빌더 |
| `orchestrator/prompts/realtimePrompts.ts` | realtime 모드 프롬프트와 realtime 전용 블록/참조 요약 빌더 |
| `providers.ts` | 프로바이더 목록, 인증 상태, 옵션 — **고위험** |
| `providerStreaming.ts` | 스트리밍 응답 파싱 및 이벤트 변환 |
| `providerOptions.ts` | 프로바이더별 모델·파라미터 옵션 |
| `providerCommandResolver.ts` | 프로바이더 CLI 명령 경로 해석 |
| `debugLogger.ts` | 드래프터 디버그 JSONL 로깅 유틸리티 |
| `contextCompiler.ts` | 프롬프트 컨텍스트 조립 (역할, 소스, 이력 포함) |
| `contextExtractor.ts` | 소스 파일에서 텍스트 추출 |
| `storage.ts` | 로컬 파일시스템 기반 저장소 구현 |
| `storageInterfaces.ts` | RunStore 등 저장소 인터페이스 정의 |
| `runRepository.ts` | Run 레코드 CRUD |
| `manifestStore.ts` | 프로젝트 매니페스트 저장 및 읽기 |
| `storagePaths.ts` | 저장소 경로 상수 |
| `roleAssignments.ts` | 에세이 역할(작성자/검토자 등) 배정 로직 |
| `essayQuestionWorkflow.ts` | 자소서 문항 상태 관리 워크플로 |
| `viewModels.ts` | UI로 노출되는 뷰모델 타입 |
| `jobPosting.ts` | 채용공고 파싱 및 모델, SiteAdapter 결과 병합 진입점 |
| `jobPosting/fetcher/types.ts` | 채용공고 fetcher 인터페이스와 fetcher 공통 에러 타입 |
| `jobPosting/fetcher/staticFetcher.ts` | 기본 HTTP fetch 기반 채용공고 fetcher와 브라우저형 요청 헤더 상수 |
| `jobPosting/adapters/types.ts` | 사이트별 채용공고 어댑터 인터페이스와 per-field tier 결과 타입 |
| `jobPosting/adapters/registry.ts` | SiteAdapter 등록/조회와 URL 기반 우선순위 매칭 |
| `jobPosting/adapters/signatureCheck.ts` | 사이트 시그니처 검증과 어댑터 tier 강등 헬퍼 |
| `jobPosting/crossValidate.ts` | company/role 후보 간 token overlap 교차검증과 factual 승격 헬퍼 |
| `jobPosting/companyHostnames.ts` | hostname 기반 회사명 힌트(staging) 매핑 |
| `companySourceModel.ts` | 회사 소스 도메인 모델 |
| `companySources.ts` | 회사 소스 집계 및 처리 |
| `jobPosting/jsonLd.ts` | JSON-LD `JobPosting` 스크립트 추출과 제목/설명/고용형태 정규화 유틸리티 |
| `companySourceCoverage.ts` | 소스 커버리지 계산 |
| `companyInsightArtifacts.ts` | 인사이트 아티팩트 생성 |
| `projectInsights.ts` | 프로젝트 단위 인사이트 집계 |
| `reviewerCard.ts` | 브라우저 안전 reviewer card 파서와 realtime reviewer section 스캐너 |
| `insights.ts` | 인사이트 공통 로직 |
| `notionMcp.ts` | Notion MCP 연동 |
| `notionOAuth.ts` | Gemini용 Notion MCP OAuth 등록, PKCE, 브라우저 인증, 토큰 저장 |
| `openDart.ts` | OpenDart API 연동 |
| `webviewProtocol.ts` | Webview ↔ 런너 메시지 프로토콜 정의 |
| `utils.ts` | ID 생성, 날짜 등 범용 유틸리티 |

---

## packages/shared/src/controller/ — 파일별 역할

| 파일 | 역할 |
|------|------|
| `runSessionManager.ts` | 활성 Run 세션 상태 및 개입 큐 관리 |
| `sidebarStateStore.ts` | 사이드바 UI 상태 (프로젝트 선택 등) |

---

## packages/runner/src/routes/ — 라우터 → 도메인

| 라우터 파일 | 담당 도메인 | 주요 역할 |
|------------|-----------|---------|
| `runsRouter.ts` | Run 실행 | Run 시작·중단·개입 처리 — **고위험** |
| `projectsRouter.ts` | 프로젝트 | 프로젝트 CRUD |
| `providersRouter.ts` | 프로바이더 | 인증 상태 확인, 프로바이더 설정 |
| `configRouter.ts` | 설정 | 런너 전역 설정 읽기/쓰기 |
| `profileRouter.ts` | 사용자 프로파일 | 프로파일 저장/불러오기 |
| `insightsRouter.ts` | 인사이트 | 인사이트 조회 및 생성 트리거 |
| `openDartRouter.ts` | OpenDart | 공시 데이터 프록시 |

---

## packages/runner/src/ — 기타 핵심 파일

| 파일 | 역할 |
|------|------|
| `index.ts` | Express + WebSocket 서버 부트스트랩 — **고위험** |
| `runnerContext.ts` | 런너 전역 컨텍스트 생성 및 상태 허브 연결 — **고위험** |
| `runnerConfig.ts` | 런너 설정 로드 |
| `security/sessionAuth.ts` | trusted local origin 해석, 세션 쿠키 파싱, HTTP/WS 인증 경계 |
| `secretStore.ts` | API 키 등 시크릿 저장소 |
| `ws/runHub.ts` | Run 이벤트 WebSocket 허브 |
| `ws/stateHub.ts` | 전역 상태 WebSocket 허브 |

---

## packages/web/src/ — 파일별 역할

| 파일 / 디렉토리 | 역할 |
|----------------|------|
| `main.tsx` | React 앱 진입점 |
| `App.tsx` | 라우팅, 레이아웃 루트 — **고위험** |
| `api/client.ts` | Runner HTTP/WebSocket 호출 레이어 — **고위험** |
| `pages/RunsPage.tsx` | Run 목록 및 실행 페이지 |
| `pages/ProjectsPage.tsx` | 프로젝트 목록 페이지 |
| `pages/ProvidersPage.tsx` | 프로바이더 설정 페이지 |
| `pages/OverviewPage.tsx` | 대시보드 개요 페이지 |
| `components/AgentDefaultsSummary.tsx` | 에이전트 기본값 요약 컴포넌트 |
| `components/AgentEffortSection.tsx` | 에이전트 노력 수준 섹션 |
| `components/ProjectInsightModal.tsx` | 프로젝트 인사이트 모달 |
| `components/ReviewerCard.tsx` | reviewer 응답을 구조화된 카드로 파싱·렌더링 |
| `formatters.ts` | 날짜·수치 포매터 |
| `agentDefaults.ts` | 에이전트 기본값 상수 |
| `insightDocuments.ts` | 인사이트 문서 유틸리티 |

---

## 테스트 위치

공용 도메인 테스트는 `packages/shared/src/test/`, runner 보안/라우터 테스트는 `packages/runner/src/test/` 에 있습니다.

| 테스트 파일 | 커버 대상 |
|------------|---------|
| `orchestrator.test.ts` | orchestrator.ts |
| `providerStreaming.test.ts` | providerStreaming.ts |
| `providerOptions.test.ts` | providerOptions.ts |
| `contextCompiler.test.ts` | contextCompiler.ts |
| `storage.test.ts` | storage.ts |
| `runSessionManager.test.ts` | runSessionManager.ts |
| `roleAssignments.test.ts` | roleAssignments.ts |
| `sidebarStateStore.test.ts` | sidebarStateStore.ts |
| `webviewProtocol.test.ts` | webviewProtocol.ts |
| `jobPosting.test.ts` | jobPosting.ts |
| `jobPosting.adapter.test.ts` | jobPosting 어댑터 registry/signature/merge 인프라 |
| `jobPosting.fetcher.test.ts` | StaticFetcher와 fetcher 공통 에러 계약 |
| `jobPosting.crossValidate.test.ts` | jobPosting/crossValidate.ts, cross-source factual 승격 규칙 |
| `jobPosting.jsonLd.test.ts` | jobPosting/jsonLd.ts |
| `companySources.test.ts` | companySources.ts |
| `insights.test.ts` | insights.ts |
| `openDart.test.ts` | openDart.ts |
| `notionMcp.test.ts` | notionMcp.ts |
| `notionOAuth.test.ts` | notionOAuth.ts |
| `providers.test.ts` | providers.ts |
| `helpers.ts` | 테스트 공통 헬퍼 (픽스처 등) |

Runner 테스트:

| 테스트 파일 | 커버 대상 |
|------------|---------|
| `packages/runner/src/test/sessionAuth.test.ts` | trusted origin allowlist, `/api/session`, cookie-backed API/WS auth |
| `packages/runner/src/test/secretStore.test.ts` | machine-local key init, legacy secret migration, copied blob failure |
| `packages/runner/src/test/runsRouter.test.ts` | addressed `runId` 409 regressions for intervention/abort |

---

## 데이터 흐름 요약

```
Web UI (packages/web)
  └─ api/client.ts
       └─ HTTP → Runner (packages/runner/src/index.ts)
                   ├─ routes/* → shared/core (orchestrator, storage, providers)
                   └─ ws/* → WebSocket 이벤트 push → Web UI
```

- 타입·스키마는 `packages/shared`에서 정의하고 runner·web 양쪽이 임포트합니다.
- 실행 상태는 `runnerContext.ts`가 소유하고 `runHub` / `stateHub`가 WebSocket으로 배포합니다.
- 저장소 구현(`storage.ts`)은 `storageInterfaces.ts` 인터페이스를 만족해야 합니다.
