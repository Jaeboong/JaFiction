# Jasojeon 아키텍처 설계서

> ForJob VS Code Extension → 웹 UI + 로컬 러너 재설계

---

## 1. 상황 요약

ForJob는 VS Code Extension 기반의 로컬 오케스트레이터다. 핵심 실행 흐름은:


VS Code Webview (UI)
└─ ForJobController (VS Code shell)
├─ ProviderRegistry → child_process.spawn(codex/claude/gemini)
├─ ReviewOrchestrator → OrchestratorGateway 인터페이스
└─ ForJobStorage → 로컬 파일시스템


**코드 분석 결과 발견된 핵심 사실:**

- `ReviewOrchestrator` (`orchestrator.ts:134`)는 `OrchestratorGateway` 인터페이스 뒤에 숨겨져 있어 실행 주체 교체 가능
- `ContextCompiler` (`contextCompiler.ts:20`)는 `DocumentContentReader` 인터페이스만 의존 → VS Code 무관
- `ForJobStorage` (`storage.ts:53`)는 순수 Node.js fs 기반 → VS Code 무관, 그대로 이식 가능
- `ProviderRegistry` (`providers.ts:37`)는 `vscode.SecretStorage` + `vscode.workspace.getConfiguration` 직접 의존 → **교체 필요**
- `providerStreaming.ts`, `notionMcp.ts`, `schemas.ts`, `types.ts`, `storageInterfaces.ts` → 모두 VS Code 무관, 그대로 재사용

---

## 2. 아키텍처 옵션 비교

### 옵션 A: 서버 워커형 SaaS (❌ 비권장)


브라우저 → 클라우드 서버 → CLI 실행 (서버 측 터미널)


**문제:**
- 사용자별 서버 프로세스 격리 필요 (복잡도 폭발)
- 사용자별 CLI 로그인 상태(codex/claude/gemini)를 서버에 보관해야 함
- Notion MCP OAuth 토큰을 서버가 관리해야 함
- 사용자 로컬 워크스페이스/파일 구조 UX가 사라짐
- 운영 비용 높음 (사용자당 상시 프로세스)

### 옵션 B: 하이브리드형 (⚠️ 조건부)


브라우저 → 클라우드 API (계정/동기화만) + 로컬 러너 (실행)


**조건:** 향후 팀 공유/클라우드 백업 기능이 필요해지면 이 방향으로 점진 확장.
현재 시점에서는 클라우드 레이어의 복잡도 대비 이득이 적음.

### 옵션 C: 웹 UI + 로컬 러너 (✅ 권장)


브라우저 ←→ localhost HTTP + WebSocket ←→ 로컬 러너 프로세스
├─ ReviewOrchestrator
├─ ProviderRegistry (CLI 실행)
└─ ForJobStorage (로컬 파일)


**이유:**
- CLI 인증 상태를 사용자 로컬에서 그대로 활용
- Notion MCP도 로컬 CLI에 붙은 상태 그대로 유지
- 로컬 파일 기반 워크스페이스 UX 유지
- 운영 부담 없음 (서버 불필요 또는 최소화)
- 핵심 오케스트레이션 코어를 재사용할 수 있는 가장 자연스러운 구조

---

## 3. 권장안 상세 설계: 웹 UI + 로컬 러너

### 3.1 시스템 컨텍스트


┌─────────────────────────────────────────────────────────┐
│ 사용자 로컬 머신 │
│ │
│ ┌──────────────┐ HTTP/WS ┌───────────────────┐ │
│ │ 브라우저 │ ◄─────────────► │ Jasojeon Runner │ │
│ │ (웹 UI) │ localhost:포트 │ (Node.js 프로세스) │ │
│ └──────────────┘ └─────────┬─────────┘ │
│ │ │
│ ┌────────▼────────┐ │
│ │ 로컬 CLI │ │
│ │ codex / claude │ │
│ │ / gemini │ │
│ └────────┬────────┘ │
│ │ │
│ ┌────────▼────────┐ │
│ │ 로컬 파일시스템 │ │
│ │ ~/.jasojeon/ │ │
│ └─────────────────┘ │
└─────────────────────────────────────────────────────────┘
(선택적)
┌──────────┐
│ 클라우드 │ 계정/백업만
└──────────┘


### 3.2 프로세스 구조 (Jasojeon)


packages/
shared/ ← ForJob 코어 재사용 (VS Code 무관 모듈들)
types.ts
schemas.ts
storageInterfaces.ts
orchestrator.ts
contextCompiler.ts
providerStreaming.ts
notionMcp.ts (파싱 로직만)
providerOptions.ts
providerCommandResolver.ts
storage.ts ← ForJobStorage 이식 (fs 기반)
manifestStore.ts
runRepository.ts
storagePaths.ts

runner/ ← 로컬 러너 (Node.js HTTP + WebSocket 서버)
src/
index.ts ← Express + WebSocket 서버 진입점
runnerConfig.ts ← YAML/JSON 설정 로드 (vscode.getConfiguration 대체)
secretStore.ts ← keytar 또는 ~/.jasojeon/secrets.enc (vscode.SecretStorage 대체)
providerRegistry.ts ← VS Code 의존성 제거한 ProviderRegistry 구현
routes/
projectsRouter.ts
runsRouter.ts
documentsRouter.ts
providersRouter.ts
ws/
runStream.ts ← RunEvent를 WebSocket으로 스트리밍
runQueue.ts ← 실행 큐 (동시 실행 1개 제한)

web/ ← 브라우저 UI (React + Vite)
src/
api/ ← Runner HTTP/WS 클라이언트
pages/
ProjectsPage.tsx
RunPage.tsx
ProvidersPage.tsx
components/


### 3.3 경계 정의

| 레이어 | 책임 | 통신 |
|--------|------|------|
| **웹 UI** | 렌더링, 사용자 입력, 실행 스트림 표시 | localhost HTTP REST + WebSocket |
| **로컬 러너** | CLI 실행, 파일 접근, 시크릿 관리, 오케스트레이션 | 로컬 프로세스 |
| **공유 코어** | 타입/스키마, 오케스트레이터, 컴파일러, 스토리지 | import |

### 3.4 데이터 저장 전략


~/.jasojeon/ ← storageRoot
profile/
raw/ ← 원본 파일 (PDF, PPTX 등)
normalized/ ← 정규화된 텍스트
manifest.json
projects/
{slug}/
project.json
documents/raw/
documents/normalized/
manifest.json
runs/
{runId}/
record.json
events.ndjson
turns.json
artifacts/
providers/
statuses.json
preferences.json
runner.yaml ← 러너 설정 (포트, provider 커맨드 등)
secrets.enc ← 암호화된 API 키 저장소 (keytar 사용 권장)


`ForJobStorage`는 `workspaceRoot`를 `~/.jasojeon`으로 바꾸면 **그대로 동작**.

### 3.5 CLI 인증/시크릿 관리 전략

**현재:** `vscode.SecretStorage` (OS keychain 위임)

**Jasojeon 러너:**
- 1순위: `keytar` npm 패키지 → OS native keychain (macOS Keychain, Windows Credential Manager, libsecret)
- 2순위: `~/.jasojeon/secrets.enc` (AES-256, passphrase는 환경변수 또는 초기 설정 시 입력)

```typescript
// packages/runner/src/secretStore.ts
export interface SecretStore {
  get(key: string): Promise<string | undefined>;
  store(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

// keytar 구현체 → vscode.SecretStorage와 동일한 인터페이스
export class KeytarSecretStore implements SecretStore { ... }

ProviderRegistry의 SecretStore 타입 (Pick<vscode.SecretStorage, "get" | "store" | "delete">)과 시그니처가 동일하므로 어댑터 없이 교체 가능.

관리 대상 시크릿:
- provider API 키: `jasojeon.apiKey.{providerId}`
- OpenDART API 키: `jasojeon.apiKey.openDart` (기존 forJob과 동일한 패턴으로 통합)

3.6 Notion MCP 처리 전략
현재: 로컬 CLI에 MCP 설정 → CLI 실행 시 자동 연결

Jasojeon: 동일. 사용자가 로컬에서 claude mcp add notion ... 등으로 설정 → 러너가 CLI 실행 시 그 설정 그대로 사용.

notionMcp.ts의 파싱 로직 (parseClaudeNotionStatus 등) → 그대로 재사용
Notion MCP 상태 조회: 러너가 CLI mcp list 실행 → 결과 반환
연결 플랜 표시: buildNotionConnectPlan 로직 그대로 재사용
3.7 실행 스트리밍 구조
Runner
  └─ ReviewOrchestrator.run(request, onEvent)
       └─ onEvent(RunEvent)
            └─ wsRunStream.emit(runId, event)   ← /ws/runs/:runId
                   │
                   ▼
              브라우저 WebSocket 수신
                   │
                   ▼
              React 상태 업데이트 → UI 렌더링

RunEvent 타입 그대로 사용. WS 메시지 = { runId, event: RunEvent }.

실행 큐: 동시 실행 1개. 큐에 쌓인 실행 요청은 대기 상태로 UI에 표시.

**상태 동기화 채널 (pushState 대체):**

VS Code에서 `pushState()`로 전체 `SidebarState`를 webview에 푸시하던 패턴을 WebSocket 두 번째 채널로 대체:

```
WS /ws/runs/:runId   ← 실행 스트리밍 (RunEvent)
WS /ws/state         ← 상태 변경 브로드캐스트 (SidebarState)
```

상태 변경이 발생하는 시점마다 Runner가 `/ws/state`로 최신 `SidebarState` 스냅샷을 전송.
브라우저는 수신 시 전체 상태를 교체 (diff 없음, 기존 pushState 패턴과 동일).

3.8 문서 업로드/정규화 흐름
브라우저 → multipart/form-data POST /api/documents
Runner
  1. ForJobStorage.importProfileUpload(fileName, bytes)
  2. ContextExtractor.extract(filePath) → normalized text
  3. manifest.json 업데이트
  4. 응답: ContextDocument

ContextExtractor (contextExtractor.ts)는 VS Code 무관 → 그대로 재사용.

3.9 인사이트 생성 구조
insights.ts:12에 InsightGateway 인터페이스가 존재하며, 이 역시 OrchestratorGateway와 동일한 패턴:

// insights.ts — 이미 게이트웨이 추상화 존재
export interface InsightGateway {
  listRuntimeStates(): Promise<ProviderRuntimeState[]>;
  execute(providerId, prompt, options): Promise<{ text: string }>;
  getApiKey(providerId): Promise<string | undefined>;
}

러너에서 ProviderRegistry가 두 인터페이스를 모두 구현. generateInsightArtifacts() 함수 그대로 재사용.

인사이트 생성 흐름:

POST /api/projects/:slug/insights/analyze  → fetchAndExtractJobPosting() + updateProject()
POST /api/projects/:slug/insights/generate → collectCompanySourceBundle() + generateInsightArtifacts()

companySources.ts, companySourceCoverage.ts, companySourceModel.ts, companyInsightArtifacts.ts 모두 VS Code 무관 → 그대로 재사용.

openDart.ts는 순수 HTTP 클라이언트(Node.js fs + fetch) → 러너에서 그대로 실행. API 키는 SecretStore에 저장.

3.10 RunSessionManager (개입 인터럽트 구조)
runSessionManager.ts의 waitForIntervention() / submitIntervention() 구조를 러너에서 재구현:

브라우저 → POST /api/runs/:id/intervention { message }
Runner
  └─ RunSessionManager.submitIntervention(message)
       └─ resolves Promise → Orchestrator 다음 라운드 진행

RunSessionManager 클래스 자체는 VS Code 무관 → 그대로 이식 가능.

3.11 SidebarStateStore → 경미한 수정 후 재사용
sidebarStateStore.ts는 vscode import가 없으나 `ProviderRegistry` 타입을 import해 간접 의존이 있음.

수정 방법: `storageInterfaces.ts`에 narrow interface 추가 후 교체:

```typescript
// storageInterfaces.ts에 추가
export interface ProviderStateReader {
  listRuntimeStates(options?: { refresh?: boolean }): Promise<ProviderRuntimeState[]>;
  refreshRuntimeState(providerId: ProviderId): Promise<ProviderRuntimeState>;
}

// sidebarStateStore.ts 변경
// import { ProviderRegistry } from "../core/providers";  ← 제거
import { ProviderStateReader } from "../core/storageInterfaces";  // ← 추가

interface StateStoreOptions {
  registry?: ProviderStateReader;  // Pick<ProviderRegistry, ...> → ProviderStateReader
  ...
}
```

이름 변경(RunnerStateService)은 선택사항. 핵심은 vscode 간접 의존 제거.
GET /api/state 응답: `buildSnapshot()` 결과 그대로 반환.

3.12 RunnerContext 인터페이스
VS Code의 `ControllerContext`에 대응하는 러너 공통 컨텍스트. 각 라우터 팩토리에 주입:

```typescript
// packages/runner/src/runnerContext.ts
export interface RunnerContext {
  storage(): ForJobStorage;
  registry(): ProviderRegistry;
  orchestrator(): ReviewOrchestrator;
  secrets(): SecretStore;
  pushState(): Promise<void>;    // /ws/state 브로드캐스트
  runBusy(): boolean;            // 실행 중 여부 조회
}
```

이 인터페이스를 기준으로 각 라우터(`projectsRouter`, `runsRouter` 등)가 팩토리 함수로 작성됨:
```typescript
export function createProjectsRouter(ctx: RunnerContext): Router { ... }
```

3.13 전체 API 메시지 → REST 매핑
webviewProtocol.ts는 순수 Zod 스키마 파일로, vscode 무관 → shared/에 그대로 가져감.
이 스키마를 기준으로 Runner REST 엔드포인트를 완성:

기존 메시지 타입	REST 엔드포인트
testProvider	POST /api/providers/:id/test
setAuthMode, setProviderModel, setProviderEffort	PUT /api/providers/:id/config
saveApiKey, clearApiKey	POST/DELETE /api/providers/:id/apikey
checkNotionMcp	GET /api/providers/:id/notion
connectNotionMcp, disconnectNotionMcp	POST /api/providers/:id/notion/connect
pickProfileFiles (vscode.window.showOpenDialog)	웹 UI에서 <input type=file>로 처리
uploadProfileFiles, uploadProjectFiles	POST /api/profile/documents (multipart)
saveProfileText, saveProjectText	POST /api/profile/documents (JSON body)
toggleProfilePinned	PATCH /api/profile/documents/:id
openProfileDocumentPreview	GET /api/profile/documents/:id/preview
createProject, updateProjectInfo	POST/PUT /api/projects/:slug
deleteProject	DELETE /api/projects/:slug
loadProjectDocumentEditor, updateProjectDocument	GET/PUT /api/projects/:slug/documents/:id
saveOpenDartApiKey, clearOpenDartApiKey, testOpenDartConnection	POST/DELETE/POST /api/opendart/...
analyzeProjectInsights, generateProjectInsights	POST /api/projects/:slug/insights/analyze, generate
openInsightWorkspace	GET /api/projects/:slug/insights (UI 화면 전환)
runReview	POST /api/projects/:slug/runs
submitRoundIntervention	POST /api/runs/:id/intervention
openArtifact	GET /api/projects/:slug/runs/:id/artifacts/:fileName
loadRunContinuation	GET /api/projects/:slug/runs/:id/continuation
continueRunDiscussion	POST /api/projects/:slug/runs/:id/continue
completeEssayQuestion	POST /api/projects/:slug/essay/:index/complete
4. 모듈 마이그레이션 표

| 파일 | 방향 | 비고 |
|------|------|------|
| **core/ 순수 모듈** | | |
| types.ts | 그대로 가져감 | VS Code 무관 |
| schemas.ts | 그대로 가져감 | VS Code 무관 |
| storageInterfaces.ts | 그대로 + 추가 | `ProviderStateReader` narrow interface 추가 |
| orchestrator.ts | 그대로 가져감 | OrchestratorGateway 인터페이스 덕분에 완전 재사용 |
| contextCompiler.ts | 그대로 가져감 | DocumentContentReader만 의존 |
| providerStreaming.ts | 그대로 가져감 | 순수 로직 |
| notionMcp.ts | 그대로 가져감 | 파싱 로직 순수 |
| storage.ts | 그대로 가져감 | storageRootName에 절대경로(`os.homedir()`) 전달 |
| manifestStore.ts | 그대로 가져감 | 순수 fs 로직 |
| runRepository.ts | 그대로 가져감 | 순수 fs 로직 |
| storagePaths.ts | 그대로 가져감 | 절대경로 이미 지원 (isAbsolute 분기 존재) |
| providerOptions.ts | 그대로 가져감 | 순수 로직 |
| providerCommandResolver.ts | 그대로 가져감 | 순수 로직 |
| utils.ts | 그대로 가져감 | 순수 유틸 |
| roleAssignments.ts | 그대로 가져감 | 순수 로직 |
| viewModels.ts | 그대로 가져감 | 스키마 정의 |
| webviewProtocol.ts | **그대로 가져감** | 순수 Zod 스키마만 포함, 전달 로직 없음 |
| contextExtractor.ts | 그대로 가져감 | 순수 fs + pdf-parse/jszip |
| companyInsightArtifacts.ts | 그대로 가져감 | 순수 로직 |
| companySourceCoverage.ts | 그대로 가져감 | 순수 로직 |
| companySourceModel.ts | 그대로 가져감 | 순수 로직 |
| companySources.ts | 그대로 가져감 | fetch 사용 |
| insights.ts | 그대로 가져감 | InsightGateway 인터페이스로 추상화됨 |
| jobPosting.ts | 그대로 가져감 | fetch 사용 |
| openDart.ts | 그대로 가져감 | HTTP API 클라이언트, 순수 fetch/fs |
| essayQuestionWorkflow.ts | 그대로 가져감 | 순수 로직 |
| **core/ vscode 의존 (1개)** | | |
| providers.ts | 어댑터 교체 | SecretStore + RunnerConfig + **ProviderStore** 주입 |
| **controller/** | | |
| runSessionManager.ts | 그대로 가져감 | vscode 무관 확인됨 |
| sidebarStateStore.ts | 경미한 수정 | `ProviderRegistry` import → `ProviderStateReader` interface |
| controllerContext.ts | 새로 작성 | `RunnerContext` 인터페이스로 대체 |
| forJobController.ts | 버림 | VS Code 진입점 |
| **controller/handlers/** | | |
| essayQuestionHandlers.ts | 라우터로 이식 | vscode 무관, 로직 재사용 |
| insightHandlers.ts | 라우터로 이식 | vscode 무관, 로직 재사용 |
| insightWorkspaceState.ts | 라우터로 이식 | vscode 무관, 로직 재사용 |
| openDartHandlers.ts | 라우터로 이식 + 수정 | `ctx.context.secrets` → `SecretStore` |
| profileHandlers.ts | 라우터로 이식 + 수정 | vscode.window.showOpenDialog 제거 |
| projectHandlers.ts | 라우터로 이식 + 수정 | vscode import 제거 |
| providerHandlers.ts | 라우터로 이식 + 수정 | vscode import 제거 |
| runHandlers.ts | 라우터로 이식 + 수정 | vscode import 제거 |
| **webview/** | | |
| sidebar.ts, sidebarTemplate.ts, insightWorkspace.ts | 버림 | VS Code Webview shell |
| sidebarScript.ts 외 12개 | 참조 후 React 재작성 | 화면 구조/인터랙션 설계 참고 |
5. 러너 구현 핵심 (ProviderRegistry 어댑터)
```typescript
// packages/runner/src/providerRegistry.ts
// vscode.SecretStorage 제거, vscode.workspace.getConfiguration 제거
// 실제 생성자 시그니처: (context: vscode.ExtensionContext, storage: ProviderStore)
// → 교체 후:

import type { SecretStore } from "./secretStore";
import type { RunnerConfig } from "./runnerConfig";
import type { ProviderStore } from "@jasojeon/shared";  // storageInterfaces.ts

export class ProviderRegistry {
  constructor(
    private readonly config: RunnerConfig,   // vscode.getConfiguration 대체
    private readonly secrets: SecretStore,   // vscode.SecretStorage 대체
    private readonly storage: ProviderStore  // 기존 두 번째 인자 유지
  ) {}

  getAuthMode(providerId): AuthMode {
    return this.config.get(`providers.${providerId}.authMode`, "cli");
  }

  async getApiKey(providerId): Promise<string | undefined> {
    return this.secrets.get(`jasojeon.apiKey.${providerId}`);
  }
  // ...
}
```

변경 최소화: 핵심 `execute()`, `runProcess()`, `buildEnvironment()` 함수는 VS Code 무관 → 그대로 복사.

6. 러너 HTTP API 구조
GET  /api/status
GET  /api/projects
POST /api/projects
GET  /api/projects/:slug
GET  /api/projects/:slug/documents
POST /api/projects/:slug/documents
GET  /api/projects/:slug/runs
POST /api/projects/:slug/runs
GET  /api/projects/:slug/runs/:id

GET  /api/profile/documents
POST /api/profile/documents
POST /api/profile/documents/upload

GET  /api/providers
POST /api/providers/:id/test
PUT  /api/providers/:id/config
POST /api/providers/:id/apikey
GET  /api/providers/:id/notion

WS   /ws/runs/:runId
WS   /ws/state

7. 리스크 / 오픈 질문

| 항목 | 리스크 | 완화 방안 |
|------|--------|-----------|
| 러너 설치/시작 UX | 사용자가 터미널에서 jasojeon 실행해야 함 | 초기엔 수동, 이후 native app wrapper (Tauri/Electron-lite) 고려 |
| 포트 충돌 | localhost 포트 기본값 충돌 | 기본 포트 + 자동 fallback 포트 탐지 |
| keytar 플랫폼 지원 | Linux libsecret 미설치 | 파일 기반 시크릿 폴백 구현 |
| CORS | 브라우저 → localhost 요청 | Runner에서 특정 origin 허용 또는 file:// 앱으로 배포 |
| **localhost 인증** | **같은 머신의 다른 프로세스/탭이 Runner API에 접근 가능** | **세션 토큰(랜덤 64바이트)을 Runner 시작 시 생성, 모든 HTTP/WS 요청에 Bearer 토큰 요구** |
| 대용량 파일 스트리밍 | PDF 업로드 느림 | chunked upload, 진행 표시 |
| 러너 업데이트 | 버전 불일치 시 UI 깨짐 | API 버전 헤더, 호환성 체크 |
오픈 질문:

러너 배포 방식: npm global install vs Tauri standalone app?
../Jasojeon 디렉토리 기준 monorepo 구조로 시작?
웹 UI 프레임워크: React (현 webview 코드 참고) vs 다른 선택?
essayQuestionWorkflow.ts, companyInsightArtifacts.ts 등 ForJob 특화 기능을 Jasojeon에 그대로 포함할지?
8. 다음 단계 (구현 순서)
monorepo 구조 초기화 — ../Jasojeon 기준, pnpm workspaces 또는 npm workspaces
packages/shared 구성 — ForJob 코어 모듈 이식 (VS Code 무관 파일 전체)
packages/runner 뼈대 — Express + WS 서버, runnerConfig.ts, SecretStore 구현
ProviderRegistry 어댑터 — vscode 의존 제거, SecretStore/RunnerConfig 인터페이스로 교체
ForJobStorage 이식 — workspaceRoot = ~/.jasojeon, 스토리지 초기화
핵심 API 라우터 — providers, profile, projects, runs, opendart, insights
WS 스트리밍 — RunEvent → WebSocket (/ws/runs/:runId)
RunSessionManager 이식 — 개입 인터럽트 구조
packages/web 뼈대 — React + Vite, Runner HTTP/WS 클라이언트
주요 화면 구현 — 프로바이더 설정, 프로필, 프로젝트 목록, 실행 화면(스트림), 인사이트
9. 테스트 전략
packages/shared: 기존 ForJob 테스트 (src/test/) 이식 가능한 것 이식
packages/runner: 각 라우터에 대한 통합 테스트 (supertest)
packages/runner: ReviewOrchestrator + mock OrchestratorGateway 유닛 테스트
packages/web: React Testing Library 컴포넌트 테스트
E2E: runner 실행 → 브라우저 → 실행 흐름 전체 (cypress 또는 playwright, 선택적)