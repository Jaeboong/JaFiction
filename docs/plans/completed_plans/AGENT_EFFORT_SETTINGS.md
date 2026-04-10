# 에이전트 모델 에포트 설정 기능 설계서

> forJob에서 역할별 에포트/모델 오버라이드를 웹 UI의 개요·설정 탭으로 이식

---

## 1. 목표 및 배경

### 1.1 현재 상태

forJob VS Code Extension은 역할(role)별로 프로바이더·모델·에포트를 개별 설정할 수 있는 `RoleAssignment` 구조를 갖추고 있었다. JaFiction으로 재설계하면서 공유 타입(`packages/shared`)에는 해당 구조가 그대로 남아 있고, 러너의 실행 파이프라인도 `RunRequest.roleAssignments`를 처리할 수 있지만, **웹 UI에서 이를 설정하는 화면이 없다.**

현재 웹 UI에서 프로바이더 레벨의 모델·에포트는 설정 가능하지만 (ProvidersPage), 역할별 개별 설정은 불가능하다.

### 1.2 요구사항

- 7개 에이전트 역할 각각에 대해 **프로바이더·모델·에포트**를 개별 지정할 수 있어야 한다.
- 설정은 **개요(Overview) 탭** 및 **프로바이더(설정) 탭**에서 접근 가능해야 한다.
- 설정값은 **전역 기본값(global default)** 으로 저장되어, 실행 시마다 별도 지정 없이 자동 적용된다.
- 기존 `RunRequest.roleAssignments` 및 오케스트레이터 파이프라인을 변경하지 않는다.

---

## 2. 도메인 모델

### 2.1 기존 타입 (변경 없음)

```typescript
// packages/shared/src/core/types.ts (기존)
export const essayRoleIds = [
  "context_researcher",
  "section_coordinator",
  "section_drafter",
  "fit_reviewer",
  "evidence_reviewer",
  "voice_reviewer",
  "finalizer"
] as const;
export type EssayRoleId = (typeof essayRoleIds)[number];

export interface RoleAssignment {
  role: EssayRoleId;
  providerId: ProviderId;
  useProviderDefaults: boolean;
  modelOverride?: string;
  effortOverride?: string;
}
```

### 2.2 신규 타입: AgentDefaultConfig

```typescript
// packages/shared/src/core/types.ts 에 추가
export interface AgentDefaultConfig {
  providerId: ProviderId;
  useProviderDefaults: boolean;    // true이면 model/effort는 무시
  modelOverride: string;           // "" = 프로바이더 기본값
  effortOverride: string;          // "" = 프로바이더 기본값
}

export type AgentDefaults = Partial<Record<EssayRoleId, AgentDefaultConfig>>;
```

> **설계 결정**: `Record<EssayRoleId, ...>` 대신 `Partial`을 사용해서 저장되지 않은 역할은 프로바이더 기본값으로 폴백한다. 이렇게 하면 새 역할이 추가돼도 하위 호환이 유지된다.

### 2.3 역할별 한국어 레이블

```typescript
export const essayRoleLabels: Record<EssayRoleId, string> = {
  context_researcher:  "컨텍스트 연구원",
  section_coordinator: "섹션 코디네이터",
  section_drafter:     "섹션 작성자",
  fit_reviewer:        "적합성 리뷰어",
  evidence_reviewer:   "근거 리뷰어",
  voice_reviewer:      "어조 리뷰어",
  finalizer:           "완성자"
};
```

---

## 3. 데이터 저장 전략

### 3.1 RunnerConfig 확장

```typescript
// packages/runner/src/runnerConfig.ts

interface RunnerConfigData {
  port: number;
  providers: Record<ProviderId, ProviderConfigRecord>;
  agentDefaults: Partial<Record<EssayRoleId, AgentDefaultConfigRecord>>;  // ← 신규
}

interface AgentDefaultConfigRecord {
  providerId: string;             // 검증 후 ProviderId로 캐스팅
  useProviderDefaults: boolean;
  modelOverride: string;
  effortOverride: string;
}
```

`defaultConfig()`에서 `agentDefaults: {}` 빈 객체로 초기화.

`sanitizeConfig()`에 `agentDefaults` 필드 검증 로직 추가:
```typescript
agentDefaults: essayRoleIds.reduce((acc, roleId) => {
  const candidate = raw.agentDefaults?.[roleId];
  if (!candidate) return acc;
  if (!providerIds.includes(candidate.providerId as ProviderId)) return acc;
  acc[roleId] = {
    providerId: candidate.providerId as ProviderId,
    useProviderDefaults: Boolean(candidate.useProviderDefaults),
    modelOverride: typeof candidate.modelOverride === "string" ? candidate.modelOverride : "",
    effortOverride: typeof candidate.effortOverride === "string" ? candidate.effortOverride : ""
  };
  return acc;
}, {} as Partial<Record<EssayRoleId, AgentDefaultConfigRecord>>)
```

### 3.2 저장 파일 경로

기존 `~/.jafiction/config.json`에 `agentDefaults` 필드가 추가된다. 별도 파일 분리 없음.

---

## 4. API 설계

### 4.1 신규 엔드포인트

| Method | Path | 설명 |
|--------|------|------|
| `GET`  | `/api/config/agent-defaults` | 전역 에이전트 기본값 조회 |
| `PUT`  | `/api/config/agent-defaults` | 전역 에이전트 기본값 전체 저장 |

> **설계 결정**: 역할별 PATCH 대신 전체 PUT 방식을 선택. 저장 단위가 7개 항목으로 작고, 화면에서 한번에 저장하는 패턴이 자연스럽기 때문.

### 4.2 GET /api/config/agent-defaults

```
Response 200:
{
  "agentDefaults": {
    "context_researcher": {
      "providerId": "claude",
      "useProviderDefaults": false,
      "modelOverride": "",
      "effortOverride": "high"
    },
    "finalizer": {
      "providerId": "codex",
      "useProviderDefaults": false,
      "modelOverride": "",
      "effortOverride": "medium"
    }
    // 나머지 역할은 키 없음 = 프로바이더 기본값 사용
  }
}
```

### 4.3 PUT /api/config/agent-defaults

```
Request body:
{
  "agentDefaults": {
    "context_researcher": { "providerId": "claude", "useProviderDefaults": false, "modelOverride": "", "effortOverride": "high" },
    "section_coordinator": { "providerId": "codex", "useProviderDefaults": true, "modelOverride": "", "effortOverride": "" }
    // 생략된 역할 = 기본값 키 삭제 (프로바이더 기본값으로 폴백)
  }
}

Response 200: { "ok": true }
```

### 4.4 SidebarState에 agentDefaults 포함

```typescript
// packages/shared/src/core/types.ts 의 SidebarState 확장
export interface SidebarState {
  // ... 기존 필드 ...
  agentDefaults: AgentDefaults;  // ← 신규
}
```

`stateHub` / `buildSnapshot()`에서 `agentDefaults`를 `RunnerConfig`에서 읽어 포함시킨다.

---

## 5. RunRequest 통합 흐름

### 5.1 에이전트 기본값 → roleAssignments 변환

RunsPage에서 실행을 시작할 때 `agentDefaults`를 `roleAssignments`로 변환하여 payload에 포함한다.

```typescript
// 변환 헬퍼 (packages/shared/src/core/roleAssignments.ts 에 추가 또는 web에서 인라인)
function buildRoleAssignmentsFromDefaults(
  agentDefaults: AgentDefaults
): RoleAssignment[] {
  return essayRoleIds
    .filter((roleId) => roleId in agentDefaults)
    .map((roleId) => {
      const config = agentDefaults[roleId]!;
      return {
        role: roleId,
        providerId: config.providerId,
        useProviderDefaults: config.useProviderDefaults,
        modelOverride: config.modelOverride || undefined,
        effortOverride: config.effortOverride || undefined
      };
    });
}
```

RunComposerPanel에서 startRun 호출 시:
```typescript
const payload = {
  question,
  draft,
  coordinatorProvider,
  reviewerProviders,
  rounds,
  roleAssignments: buildRoleAssignmentsFromDefaults(state.agentDefaults)
};
```

### 5.2 기존 파이프라인 (변경 없음)

```
RunRequest.roleAssignments
  └─ resolveRoleAssignments()      ← packages/shared, 변경 없음
       └─ orchestrator.ts          ← 변경 없음
            └─ participant.assignment.effortOverride
                 └─ PromptExecutionOptions.effortOverride
                      └─ buildProviderArgs() → --effort flag
```

---

## 6. UI 설계

### 6.1 개요(Overview) 탭: 신규 섹션 "에이전트 에포트"

**OverviewPage 사이드바 메뉴에 항목 추가:**

```typescript
// OverviewSection 타입 확장
type OverviewSection = "dashboard" | "rubric" | "storage" | "agent-effort";  // ← 추가

const sectionLabels: Record<OverviewSection, string> = {
  // ...기존...
  "agent-effort": "에이전트 에포트"
};
```

**사이드바 버튼:**
```
대시보드
기본 평가 기준
저장소 상태
에이전트 에포트  ← 신규
```

**에이전트 에포트 섹션 UI (`AgentEffortSection` 컴포넌트):**

각 역할을 카드로 표시하고, 역할별 설정을 인라인으로 편집:

```
┌─────────────────────────────────────────────────────────┐
│  에이전트 에포트                                          │
│  역할별 기본 프로바이더와 에포트를 설정합니다.              │
│  실행 시 roleAssignments에 자동 반영됩니다.               │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  컨텍스트 연구원                                          │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────┐ │
│  │ 프로바이더   │  │ 모델          │  │ 에포트       │ │
│  │ [claude  ▼] │  │ [기본값 사용 ]│  │ [high    ▼] │ │
│  └──────────────┘  └───────────────┘  └──────────────┘ │
│  □ 프로바이더 기본값 사용                                 │
│                                                         │
│  섹션 코디네이터                                          │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────┐ │
│  │ [codex   ▼] │  │ [           ] │  │ [medium  ▼] │ │
│  └──────────────┘  └───────────────┘  └──────────────┘ │
│  □ 프로바이더 기본값 사용                                 │
│                                                         │
│  ... (7개 역할 전체)                                     │
│                                                         │
│  [설정 저장]                                             │
└─────────────────────────────────────────────────────────┘
```

**동작 규칙:**
- "프로바이더 기본값 사용" 체크 시 모델/에포트 셀렉터 비활성화
- 에포트 옵션은 선택된 `providerId`의 `capabilities.effortOptions`를 기준으로 동적 렌더링
- 저장 버튼은 페이지 전체를 한번에 `PUT /api/config/agent-defaults`로 전송
- 저장 성공 시 `state.agentDefaults` 갱신은 WS /ws/state 브로드캐스트로 자동 반영

### 6.2 프로바이더(설정) 탭: 에이전트 배정 요약 패널

ProvidersPage 하단(또는 별도 사이드바 항목)에 현재 에이전트 기본값을 읽기 전용 요약 표로 표시하고, "에이전트 에포트 편집"으로 개요 탭 에이전트 에포트 섹션으로 이동하는 링크 버튼을 제공한다.

```
┌──────────────────────────────────────────┐
│  에이전트 기본값 요약                       │
│                                          │
│  역할           프로바이더  에포트          │
│  ─────────────────────────────────────── │
│  컨텍스트 연구원  claude    high           │
│  섹션 코디네이터  codex     medium         │
│  섹션 작성자      gemini    (기본값)        │
│  ...                                     │
│                                          │
│  [에이전트 에포트 편집 →]                  │
└──────────────────────────────────────────┘
```

> **설계 결정**: ProvidersPage는 프로바이더 레벨 설정의 홈이므로 에이전트 설정의 **편집 화면은 개요 탭**에 두고, 프로바이더 탭에서는 현황 요약 + 링크만 제공한다. 동일 설정 UI를 두 곳에 중복 구현하지 않는다.

---

## 7. 컴포넌트 구조

```
packages/web/src/
  pages/
    OverviewPage.tsx          ← OverviewSection에 "agent-effort" 추가
    ProvidersPage.tsx         ← AgentDefaultsSummary 컴포넌트 추가
  components/
    AgentEffortSection.tsx    ← 신규: 편집 가능한 역할별 에포트 설정 폼
    AgentDefaultsSummary.tsx  ← 신규: 읽기 전용 요약 테이블
  api/
    client.ts                 ← getAgentDefaults(), saveAgentDefaults() 메서드 추가
```

### 7.1 AgentEffortSection props

```typescript
interface AgentEffortSectionProps {
  providers: ProviderRuntimeState[];
  agentDefaults: AgentDefaults;
  onSave(agentDefaults: AgentDefaults): Promise<void>;
}
```

### 7.2 AgentDefaultsSummary props

```typescript
interface AgentDefaultsSummaryProps {
  providers: ProviderRuntimeState[];
  agentDefaults: AgentDefaults;
  onEditClick(): void;  // 개요 탭 에이전트 에포트 섹션으로 이동
}
```

---

## 8. 러너 변경 사항

### 8.1 신규 라우터: configRouter.ts

```typescript
// packages/runner/src/routes/configRouter.ts
export function createConfigRouter(ctx: RunnerContext): Router {
  const router = Router();

  // GET /api/config/agent-defaults
  router.get("/agent-defaults", async (_req, res, next) => {
    try {
      const agentDefaults = await ctx.config().getAgentDefaults();
      res.json({ agentDefaults });
    } catch (error) {
      next(error);
    }
  });

  // PUT /api/config/agent-defaults
  router.put("/agent-defaults", async (req, res, next) => {
    try {
      const payload = req.body?.agentDefaults;
      await ctx.config().setAgentDefaults(payload);
      await ctx.pushState();
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
```

### 8.2 RunnerConfig 신규 메서드

```typescript
// packages/runner/src/runnerConfig.ts 에 추가
async getAgentDefaults(): Promise<AgentDefaults> {
  const config = await this.readConfig();
  return config.agentDefaults ?? {};
}

async setAgentDefaults(raw: unknown): Promise<void> {
  const config = await this.readConfig();
  config.agentDefaults = sanitizeAgentDefaults(raw);
  this.cache = config;
  await this.writeConfig(config);
}
```

### 8.3 index.ts 라우터 등록

```typescript
app.use("/api/config", createConfigRouter(ctx));
```

### 8.4 buildSnapshot() 수정

```typescript
// SidebarState에 agentDefaults 포함
agentDefaults: await ctx.config().getAgentDefaults()
```

---

## 9. 클라이언트 API 메서드 추가

```typescript
// packages/web/src/api/client.ts 에 추가

async getAgentDefaults(): Promise<AgentDefaults> {
  const res = await this.fetch("/api/config/agent-defaults");
  const data = await res.json() as { agentDefaults: AgentDefaults };
  return data.agentDefaults;
}

async saveAgentDefaults(agentDefaults: AgentDefaults): Promise<void> {
  await this.fetch("/api/config/agent-defaults", {
    method: "PUT",
    body: JSON.stringify({ agentDefaults })
  });
}
```

> `saveAgentDefaults`는 직접 호출 후 응답 대기 — 상태 갱신은 WS /ws/state로 자동 수신.

---

## 10. 구현 순서

| # | 작업 | 파일 |
|---|------|------|
| 1 | `AgentDefaultConfig`, `AgentDefaults` 타입 추가 | `packages/shared/src/core/types.ts` |
| 2 | `essayRoleLabels` 상수 추가 | `packages/shared/src/core/types.ts` |
| 3 | `RunnerConfig` 확장 (`agentDefaults` 필드 + 메서드) | `packages/runner/src/runnerConfig.ts` |
| 4 | `configRouter.ts` 신규 작성 | `packages/runner/src/routes/configRouter.ts` |
| 5 | `index.ts` 라우터 등록 + `buildSnapshot`에 `agentDefaults` 포함 | `packages/runner/src/index.ts` |
| 6 | `client.ts` API 메서드 추가 | `packages/web/src/api/client.ts` |
| 7 | `AgentEffortSection.tsx` 컴포넌트 작성 | `packages/web/src/components/AgentEffortSection.tsx` |
| 8 | `AgentDefaultsSummary.tsx` 컴포넌트 작성 | `packages/web/src/components/AgentDefaultsSummary.tsx` |
| 9 | `OverviewPage.tsx`: 섹션 추가 + props 확장 | `packages/web/src/pages/OverviewPage.tsx` |
| 10 | `ProvidersPage.tsx`: 요약 패널 추가 | `packages/web/src/pages/ProvidersPage.tsx` |
| 11 | `App.tsx`: onSaveAgentDefaults 핸들러 + props 전달 | `packages/web/src/App.tsx` |
| 12 | `RunsPage.tsx`: startRun 시 `buildRoleAssignmentsFromDefaults` 적용 | `packages/web/src/pages/RunsPage.tsx` |

---

## 11. 엣지 케이스 및 결정 사항

| 케이스 | 처리 |
|--------|------|
| `agentDefaults`에 없는 역할 | `roleAssignments`에 포함하지 않음 → 오케스트레이터가 프로바이더 기본값 사용 |
| 프로바이더가 `healthy`가 아닌 역할에 배정됨 | 런타임 오류는 기존과 동일하게 오케스트레이터에서 처리. UI에서 경고 표시(비정상 연결 프로바이더 선택 시 `warning` 스타일) |
| `useProviderDefaults: true`인 역할 | `modelOverride`, `effortOverride`는 저장하되 빈 문자열로 강제 정규화 |
| 프로바이더가 `supportsEffort: false` (gemini) | 에포트 셀렉터 숨김 (ProvidersPage와 동일 처리 패턴) |
| RunsPage에서 직접 override | `RunsPage`에 별도 역할별 override UI를 추가하지 않는다 — 전역 기본값만 사용. 필요 시 다음 단계에서 확장. |

---

## 12. 비고: forJob와의 차이

| 항목 | forJob | JaFiction (이번 설계) |
|------|--------|----------------------|
| 설정 위치 | 실행 설정 모달 내 (per-run) | 개요 탭 전역 기본값 (global default) |
| 저장소 | VS Code workspace config | `~/.jafiction/config.json` |
| 적용 범위 | 해당 실행 1회만 | 이후 모든 실행에 자동 적용 |
| UI 진입 | 실행 직전 고급 설정 | 개요 탭 → 에이전트 에포트 섹션 |

forJob의 per-run override 패턴은 RunsPage를 통해 나중에 추가할 수 있도록 설계를 열어둔다 (`RunRequest.roleAssignments`가 이미 이를 지원함).
