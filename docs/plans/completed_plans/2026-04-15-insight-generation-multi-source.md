# 2026-04-15 · Insight Generation 다중 소스 파이프라인 리팩터

작성자: planner / 상태: Draft / 스테이지: 독립 (Stage 11.x 후행)

## 1. 목표 / 비목표

### 목표
- 인사이트 생성 파이프라인을 "DART 단일 소스" → "3-peer source aggregator (DART, Web/News, Posting)" 구조로 전환.
- 비상장/스타트업/해외법인에서도 인사이트 품질을 보장 (DART 없음을 "폴백 분기"가 아닌 "소스 부재"로 취급).
- WebSearchProvider 추상화를 도입해 Naver(기본)/Brave 구현을 config로 교체 가능하게 만든다.
- 회사명 단위 캐시(TTL 7일)를 도입해 재지원/재생성 시 외부 호출을 줄인다.
- LLM 합성 단계에 **source tier 규칙**을 명시해 DART 사실이 뉴스로 덮어써지지 않도록 한다.
- 기존 OpenDART `ambiguous` → `OpenDartCandidateModal` reviewNeeded 플로우는 그대로 유지한다.

### 비목표
- 공고 분석 로직 변경 (`packages/shared/src/core/jobPosting.ts`) — 파킹.
- 공고 분석 비동기 백그라운드화 — 파킹.
- `companyHints` 스키마 확장 / regex→LLM 보정 — 파킹.
- insight 프롬프트의 섹션 수 조정 — 본 스테이지에서는 소스 tier 지침만 추가.
- DART 캐시(OpenDartClient 내부 corpCodes 캐시) 재설계 — 현행 유지.

## 2. 현재 상태 분석 (file:line 기반)

### 2.1 진입점 & 단일 소스 분기
- `packages/runner/src/routes/insightsHandlers.ts:76` `generateProjectInsightsService` — 인사이트 생성의 단일 엔트리.
- `packages/runner/src/routes/insightsHandlers.ts:137-175` — DART API key가 있으면 `OpenDartClient.resolveAndFetchCompany`를 호출, 상태별 분기:
  - `:145` `ambiguous` → `openDartCandidates` 저장 + `insightStatus: "reviewNeeded"` 후 early return (이것이 핵심 중단/재개 패턴).
  - `:155` `resolved` → project에 corpCode 등 persist.
  - `:164` 예외 → `unavailable` notices를 쌓지만 계속 진행.
- `:177` `collectCompanySourceBundle(project, companyResolution)` — 현재 Web 수집 레이어. OpenDART `resolved.overview.homepageUrl`에서 anchor crawl로 회사 페이지를 긁는 **DART-seeded** 구조.
- `packages/shared/src/core/companySources.ts:56-73` — homepageUrl이 없으면 "officialHomepage missing"으로 기록하고 anchor crawl 자체를 건너뜀 → 비상장사는 실제로 수집되는 소스가 거의 없음.

### 2.2 LLM 합성
- `packages/shared/src/core/insights.ts:42` `generateCompanyAnalysisPhase` — 프롬프트에 `companyResolution`, `companySourceBundle`을 주입.
- `packages/shared/src/core/companyInsightArtifacts.ts:26-86` `buildCompanyAnalysisPrompt` — source tier 규칙 없음. "Use only the supplied source bundle"만 명시, 충돌 해결 규칙 없음.
- `companyInsightArtifacts.ts:88` `buildSupportingInsightPrompt` — job/strategy/question 아티팩트. 여기서는 소스 변경 영향이 거의 없음.

### 2.3 중단/재개 패턴 (반드시 유지)
- Shared: `packages/shared/src/core/types.ts`의 `ProjectRecord.openDartCandidates`, `insightStatus: "reviewNeeded"`.
- Protocol: `packages/shared/src/core/webviewProtocol.ts:261` `openDartCandidates` 메시지.
- Web UI:
  - `packages/web/src/pages/ProjectsPage.tsx:669` `handleGenerateInsights`가 `openDartCandidates?.length`면 모달 오픈하고 early return.
  - `packages/web/src/pages/ProjectsPage.tsx:725` `handleDartCandidateConfirm`에서 corpCode를 patch한 뒤 재생성.
  - `packages/web/src/components/OpenDartCandidateModal.tsx` — 선택 UI.

### 2.4 Company source 모델
- `packages/shared/src/core/companySourceModel.ts:1-11` `companySourceKinds` 배열. 현재 9종 (openDart 2종 + official 7종).
- `companySourceCoverage.ts:13-34` 커버리지 분류는 OpenDART/공식홈/공식채용/공식 IR·보도·기술의 4 category.

### 2.5 Config & Secrets
- `packages/runner/src/runnerContext.ts:32,55` `DART_API_KEY` 환경 변수 기반. 다른 외부 API key 패턴은 없음.
- `packages/runner/src/runnerConfig.ts:20-34` `RunnerConfig`는 providers/agentDefaults만 persist. 외부 search provider config가 들어갈 자리 없음 → 확장 필요.

### 2.6 Storage
- Insight JSON 저장: `storage.saveProjectInsightJson(slug, filename, data)` (예: `company-source-manifest.json`, `company-enrichment.json`). 회사 단위 캐시는 프로젝트 단위로 쓰이고 있어 **회사명 단위 캐시는 별도 디렉터리**가 필요.

## 3. 제안 아키텍처

### 3.1 데이터 흐름

```
generateProjectInsightsService
  │
  ├─ ensure posting extracted (unchanged)
  ├─ insightStatus = "generating" + push
  │
  └─ collectCompanyContext({ project, hints })   ← NEW facade
        │
        ├─ Promise.all([
        │    fetchDartSource(project)      // existing OpenDartClient resolve+fetch
        │    fetchWebSource(project)       // NEW (provider-backed)
        │    derivePostingSource(project)  // NEW (from jobPostingText, no fetch)
        │  ])
        │
        ├─ if dart.status === "ambiguous" → return { reviewNeeded: true, candidates }
        │     (caller handles openDartCandidates persist + early return)
        │
        └─ return { dart?, web, posting, coverage }
  │
  ├─ persist company-context-manifest.json
  ├─ generateCompanyAnalysisPhase(...context)
  ├─ generateSupportingInsightPhase(...)
  └─ insightStatus = "ready"
```

핵심 원칙: **DART는 분기가 아니라 소스 집합의 원소** (`sources.dart?`). `unavailable`/`notFound`면 그냥 배열에서 빠지고 `coverage.missing`에 기록된다. 단 `ambiguous`만큼은 사용자 상호작용이 필요하므로 reviewNeeded를 계속 끌어올린다.

### 3.2 모듈 경계

- `packages/shared/src/core/companyContext/index.ts` — `collectCompanyContext` 진입점 (얇은 orchestrator).
- `packages/shared/src/core/companyContext/dartSource.ts` — 기존 `OpenDartClient` 호출 래퍼, `{ status, payload }` 로 정규화.
- `packages/shared/src/core/companyContext/webSource.ts` — `WebSearchProvider` 사용, snippet 정규화, recency 필터.
- `packages/shared/src/core/companyContext/postingSource.ts` — `project.jobPostingText` + 기존 필드(`mainResponsibilities`, `qualifications`...)를 `PostingSourceSnippet[]`으로 구조화 (외부 호출 없음).
- `packages/shared/src/core/companyContext/cache.ts` — 회사명 키 기반 TTL 캐시 (읽기/쓰기/invalidate).
- `packages/shared/src/core/webSearch/provider.ts` — `WebSearchProvider` 인터페이스 + `createWebSearchProvider(config)` 팩토리.
- `packages/shared/src/core/webSearch/naverProvider.ts`
- `packages/shared/src/core/webSearch/braveProvider.ts`

### 3.3 WebSearchProvider 인터페이스

```ts
export interface WebSearchQuery {
  companyName: string;
  roleName?: string;
  keywords?: string[];
  maxResults?: number;     // default 10
  recencyMonths?: number;  // default 9
  locale?: "ko" | "en";    // default "ko"
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string; // ISO
  source: "news" | "web";
  providerRaw?: unknown;
}

export interface WebSearchProvider {
  readonly id: "naver" | "brave";
  search(query: WebSearchQuery): Promise<WebSearchResult[]>;
}
```

### 3.4 collectCompanyContext 반환 타입

```ts
export interface CompanyContextBundle {
  collectedAt: string;
  companyName: string;
  sources: {
    dart?: DartSourcePayload;        // resolved/notFound/unavailable만; ambiguous는 상위에서 reviewNeeded로 변환
    web: WebSourcePayload;           // 항상 present (에러 시 entries=[] + notes)
    posting: PostingSourcePayload;   // 항상 present
  };
  coverage: CompanySourceCoverage;   // 기존 타입 재사용 (확장)
  reviewNeeded?: {
    reason: "openDartAmbiguous";
    candidates: OpenDartCandidate[];
  };
}
```

## 4. 타입/스키마 변경

### 4.1 `packages/shared/src/core/companySourceModel.ts`
- `companySourceKinds`에 `webNews`, `webGeneral`, `postingDerived` 추가 (3종).
- `CompanySourceEntry.tier`를 `"official" | "web" | "posting"` 으로 확장.
- `CompanySourceSnippet`에 선택 필드 `publishedAt?: string`, `sourceTier: "factual" | "contextual" | "role"` 추가 (LLM 프롬프트에서 tier 규칙을 적용하기 위한 메타데이터).

### 4.2 WS 프로토콜 (`webviewProtocol.ts`)
- 이번 스테이지에서는 신규 메시지 **추가 없음**. `openDartCandidates` 메시지(`:261`)를 그대로 사용.
- 단, `SidebarStateSchema`가 `ProjectRecord`를 include하므로 `companySourceManifest` 형태 변경 시 백엔드 dump 호환성 검증 필요.

### 4.3 `ProjectRecord` (types.ts / schemas.ts / storage.ts)
- 변경 없음. `openDartCandidates`는 계속 기존 의미 그대로.
- 옵션: `companyContextCoverage?: CompanySourceCoverage` 같은 얇은 요약 필드를 추가하면 UI에서 "웹/뉴스 수집 성공 여부"를 바로 보여줄 수 있음. **권장: 추가 안 함** — `insight-sources.json` 파일로 충분히 보이며 스키마 변경 리스크를 피할 수 있음.

### 4.4 RunnerConfig 확장
- `RunnerConfigData`에 `webSearch?: { enabled: boolean; provider: "naver" | "brave"; cacheTtlDays: number }` 추가.
- 환경변수 우선순위: `NAVER_CLIENT_ID` / `NAVER_CLIENT_SECRET` / `BRAVE_API_KEY`는 `process.env`로만 읽는다 (secrets는 `runner.json`에 저장하지 않음 — 기존 `DART_API_KEY` 패턴과 일치).

## 5. 파일별 변경 목록

### 신규 (shared)
- `packages/shared/src/core/companyContext/index.ts` — `collectCompanyContext` 파사드.
- `packages/shared/src/core/companyContext/dartSource.ts`
- `packages/shared/src/core/companyContext/webSource.ts`
- `packages/shared/src/core/companyContext/postingSource.ts`
- `packages/shared/src/core/companyContext/cache.ts`
- `packages/shared/src/core/companyContext/types.ts`
- `packages/shared/src/core/webSearch/provider.ts`
- `packages/shared/src/core/webSearch/naverProvider.ts`
- `packages/shared/src/core/webSearch/braveProvider.ts`
- `packages/shared/src/core/webSearch/index.ts` (barrel)

### 신규 (shared tests)
- `packages/shared/src/test/webSearchProvider.test.ts`
- `packages/shared/src/test/companyContext.test.ts`
- `packages/shared/src/test/companyContextCache.test.ts`

### 수정 (shared)
- `packages/shared/src/core/companySourceModel.ts` — 신규 kinds/tier.
- `packages/shared/src/core/companySourceCoverage.ts` — 웹/posting 섹션 분류 추가.
- `packages/shared/src/core/companyInsightArtifacts.ts:26` — `buildCompanyAnalysisPrompt`에 source tier 규칙 블록 추가, 입력을 `CompanyContextBundle`로 전환.
- `packages/shared/src/core/insights.ts:42` — 파라미터를 `(companyResolution, companySourceBundle)` → `(companyContext: CompanyContextBundle)`로 교체. 기존 호출부 호환을 위해 adapter 유지 (stage별 green 달성).
- `packages/shared/src/core/companySources.ts` — `collectCompanySourceBundle` 은 내부적으로 **`collectCompanyContext`로 위임** (Stage A에서 shim, Stage B에서 삭제).
- `packages/shared/src/core/webviewProtocol.ts` — 변경 없음 (명시적 확인용 섹션).
- `packages/shared/src/core/index.ts` (barrel) — 신규 export.

### 수정 (runner)
- `packages/runner/src/routes/insightsHandlers.ts:137-177` — DART 직접 호출 블록을 `collectCompanyContext({ ... })`로 교체.
  - `ambiguous` 처리: `context.reviewNeeded?.reason === "openDartAmbiguous"`면 현재와 동일하게 `openDartCandidates` 저장 + early return.
  - `unavailable`/`notFound` 처리: 아무 early return 없이 계속 진행. notices는 `insight-sources.json`에만 기록.
- `packages/runner/src/runnerContext.ts:55` — `getServerDartApiKey` 옆에 `getWebSearchConfig()` / `createWebSearchProviderFromEnv()` 헬퍼 추가.
- `packages/runner/src/runnerConfig.ts:20-34` — `webSearch` config 필드 추가 + defaults.
- `packages/runner/src/routes/openDartHandlers.ts` — 변경 없음 (read-only 확인).

### 신규 (runner tests)
- `packages/runner/src/test/insightsHandlers.contextPipeline.test.ts`

### 수정 (web)
- `packages/web/src/pages/ProjectsPage.tsx` — 변경 없음. `handleGenerateInsights`/`handleDartCandidateConfirm`/`OpenDartCandidateModal`는 그대로 동작.
- `packages/web/src/components/OpenDartCandidateModal.tsx` — 변경 없음.

### 삭제
- 없음. (Stage B에서 `companySources.ts` shim을 제거할 때 주석 표기로 deprecation만 수행하고, 실제 삭제는 Stage C에서.)

### Config & docs
- `.env.production.example` — `DART_API_KEY`, `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `BRAVE_API_KEY` 예시 추가.
- `docs/development/ARCHITECTURE.md` — "인사이트 파이프라인" 섹션 갱신.
- `docs/plans/CURRENT_STAGE.md` — 본 스테이지 링크.

## 6. 단계별 구현 순서 (각 스테이지 green)

### Stage A · Shared 스켈레톤 + WebSearchProvider 인터페이스
- 신규 `webSearch/*`, `companyContext/types.ts` 추가.
- `WebSearchProvider` 인터페이스만 export.
- Naver/Brave provider는 빈 stub (throw "not implemented"). Unit test는 stub 인터페이스만 검증.
- `companySources.ts` / `insights.ts` 시그니처 유지. **파이프라인 변경 없음.**
- Exit: `./scripts/check.sh` green, 기능 회귀 zero.

### Stage B · `collectCompanyContext` + postingSource + dartSource 어댑터
- `collectCompanyContext` 파사드 구현. `web`은 빈 결과, `dart`/`posting`만 채움.
- `generateCompanyAnalysisPhase` 시그니처에 adapter 추가 (기존 호출부 계속 동작).
- `insightsHandlers.ts`에서 DART 블록을 `collectCompanyContext({ project, hints, webProvider: undefined })`로 전환.
  - 이때 기존 `collectCompanySourceBundle` 호출은 유지 (병행 동작)하여 프롬프트 입력은 기존 번들 + 신규 context 둘 다 전달. 프롬프트는 불변.
- Exit: check.sh green, 기존 DART 플로우/ambiguous 모달 회귀 없음, `company-context-manifest.json` 신규 파일 생성.

### Stage C · WebSearchProvider 실제 구현 + 캐시
- Naver provider + Brave provider + `createWebSearchProviderFromEnv` 실구현.
- `cache.ts` 구현 (TTL 7일, 회사명 기반 hash key, `storage.saveRaw/readRaw`에 해당하는 "company-context-cache" 디렉터리 생성 — 필요 시 `storageInterfaces.ts`에 신규 메서드).
- `webSource.ts`가 캐시→provider→normalize 순으로 동작.
- `webSearch.enabled=false`가 기본값 → 실제 외부 호출은 off.
- Exit: check.sh green, feature flag off 상태에서 회귀 없음. Unit test에서 mock provider로 캐시 hit/miss 검증.

### Stage D · LLM 프롬프트 source-tier 지침 + CompanyContextBundle 직접 주입
- `buildCompanyAnalysisPrompt`를 `CompanyContextBundle` 기반으로 재작성.
- insightsHandlers.ts에서 기존 `collectCompanySourceBundle` 제거 (shim만 남김).
- prompt snapshot test로 tier 규칙 블록 존재 검증.
- Exit: check.sh green, 수동 QA에서 `webSearch.enabled=true`로 켜서 비상장사 회사명으로 인사이트 생성 시 뉴스 인용 확인.

### Stage E · 레거시 정리 & 문서
- `collectCompanySourceBundle` shim 삭제, import 정리.
- `ARCHITECTURE.md` / `CURRENT_STAGE.md` 업데이트.
- `.env.production.example` 갱신.

각 스테이지는 commit 단위로 독립 빌드/테스트 통과 가능해야 하며, Stage D 이전까지는 feature flag default off로 프로덕션 회귀 리스크 zero.

## 7. Source Tier 프롬프트 설계

`buildCompanyAnalysisPrompt`에 아래 블록을 추가 (초안):

```
## Source Tier Rules (MUST follow)

You receive three source tiers. They have different authority levels.

1. FACTUAL (tier=factual) — OpenDART 공식 공시, 재무제표, 기업개황.
   - 회사명/대표/매출/설립연월/상장여부 등 "사실"은 이 tier가 최종 근거다.
   - 다른 tier와 충돌하면 factual이 항상 이긴다.
   - factual 데이터가 부재(dart source 없음)해도 추측으로 채우지 않는다.

2. CONTEXTUAL (tier=contextual) — 뉴스/웹 검색 결과 (최근 6~12개월).
   - 최근 이슈, 제품 출시, 업계 포지션, 회사 문화 시그널 서술에만 사용.
   - factual 숫자(매출/임직원 수)를 contextual snippet 기반으로 덮어쓰지 마라.
   - 인용 시 "~에 따르면 (news, <publishedAt>)" 형식으로 짧게 언급.
   - publishedAt이 9개월 이상 지났으면 "현재 유효한지 불확실" 표기.

3. ROLE (tier=role) — 공고 원문 + 사용자가 입력한 회사/직무 hints.
   - 직무 책임/자격요건/우대사항의 근거는 이 tier만 사용.
   - 회사 전반 사실을 이 tier에서 추론하지 마라 (공고는 자기소개용 마케팅 문구를 포함한다).

## Conflict resolution
- factual ≻ contextual ≻ role.
- 모든 tier에서 근거가 없으면 해당 섹션에 "출처 부족"을 명시하고 비워라. 절대 메꾸지 마라.

## Output requirements
- 각 아티팩트 섹션 말미의 "출처와 근거 강도" 블록에 tier별 근거 개수를 표기.
- factual 0건이면 "구조화된 공시 자료 없음 (비상장/해외법인/미확인)" 이라고 명기.
```

이 블록은 기존 10개 섹션 구조를 유지한 채 상단에 삽입한다 (`companyInsightArtifacts.ts:36` 근처).

## 8. Naver / Brave Provider 구현 세부

### 8.1 Naver Search API (기본)
- Endpoint: `https://openapi.naver.com/v1/search/news.json` (뉴스) + `/webkr.json` (웹).
- Auth headers: `X-Naver-Client-Id`, `X-Naver-Client-Secret`.
- Query params: `query`, `display` (max 100, 기본 20), `start`, `sort=date`.
- 응답: `items[]`에 `title/link/description/pubDate` (HTML 엔티티 포함) — `normalizeJobPostingText`로 sanitize 후 snippet.
- Recency 필터: `pubDate`를 Date 파싱 후 `recencyMonths` 기준 cutoff.
- 에러: 401/403 → `WebSearchError("unauthorized")`, 429 → `WebSearchError("quotaExceeded")`, 5xx → retry x2 (exponential backoff 500ms/1500ms), 그 외 → 단일 실패로 처리.
- 쿼리 구성: `"<companyName>" + optional roleName hint`. 1차는 뉴스, 빈 결과면 2차 web 검색 fallback.

### 8.2 Brave Search API
- Endpoint: `https://api.search.brave.com/res/v1/web/search`.
- Auth: `X-Subscription-Token`.
- Params: `q`, `count`, `freshness=pw/pm/py`.
- 응답: `web.results[]` + `news.results[]`. Brave는 freshness 필터가 서버측에 있어 `recencyMonths`→freshness 매핑 (1~3→pw, 4~6→pm, 7~12→py).
- 에러 처리는 Naver와 동일 구조.

### 8.3 공통
- Provider는 raw 응답 일부(`providerRaw`)를 유지해 디버그 JSON에 기록.
- Per-call timeout 10s (`AbortController`).
- 쿼리 결과는 dedupe (URL origin+pathname 기준).
- `companyContext/webSource.ts`에서 snippet 당 최대 길이 400자로 trim.

## 9. 캐시 레이어

### 9.1 저장 위치
**권장**: 파일 기반, `<storageRoot>/company-context-cache/<sha1(companyName)>.json`.
- 이유: DB 스키마 변경 없음, `storage.saveProjectInsightJson`과 같은 파일 I/O 패턴, 삭제/검사 간단.
- 대안: `storageInterfaces.ts`에 `getCompanyContextCache(key)` / `setCompanyContextCache(key, value)` 메서드 추가해 backend/runner에서 동일 추상화.

### 9.2 키 설계
- Key: `sha1(normalizedCompanyName + "|" + providerId)`.
- Value:
  ```json
  {
    "companyName": "...",
    "providerId": "naver",
    "fetchedAt": "2026-04-15T...",
    "expiresAt": "2026-04-22T...",
    "query": { ... },
    "results": [ ... ]
  }
  ```

### 9.3 TTL & Invalidation
- 기본 7일 (`webSearch.cacheTtlDays`).
- `expiresAt < now` → miss.
- 수동 invalidation: runner CLI는 본 스테이지에서 추가하지 않음. 파일 삭제로 처리.
- Provider 변경 시 key 일부에 providerId가 포함되므로 자동 분리.
- DART cache (corpCodes)는 별개 — 변경 없음.

### 9.4 캐시 정책
- Write-through: provider 성공 결과만 저장. 실패는 캐시하지 않음 (오류 박제 방지).
- 부분 실패 (빈 배열 반환)는 캐시하되 TTL을 24h로 축소 (재시도 친화) — 옵션, Stage C 추가.

## 10. Config 추가

### 10.1 runner.json
- `webSearch.enabled` — 기본 `false`.
- `webSearch.provider` — 기본 `"naver"`.
- `webSearch.cacheTtlDays` — 기본 `7`.

### 10.2 환경 변수
- `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET` — Naver provider 필수.
- `BRAVE_API_KEY` — Brave provider 필수.
- 존재하지 않으면 해당 provider는 `createWebSearchProviderFromEnv`가 `undefined` 반환 → `webSource.ts`는 빈 결과 + `notes: ["webSearch: provider credentials missing"]`.

### 10.3 Config 로더 수정 포인트
- `packages/runner/src/runnerConfig.ts:26` `defaultConfig()`에 `webSearch` 기본값 추가.
- `packages/runner/src/runnerContext.ts`에 `getWebSearchConfig(ctx)` + `createWebSearchProviderFromEnv(ctx)` 헬퍼.

## 11. 테스트 전략

### 11.1 Unit (shared)
- `webSearchProvider.test.ts` — Naver/Brave 응답 fixture → `WebSearchResult[]` 파싱 검증, recency 필터, 에러 매핑.
- `companyContext.test.ts` — `collectCompanyContext`에 mock provider 주입해 Promise.all 병렬 수집/부분 실패 격리 검증.
- `companyContextCache.test.ts` — TTL hit/miss/expiresAt boundary, provider-id 분리.

### 11.2 Integration (runner)
- `insightsHandlers.contextPipeline.test.ts` — `generateProjectInsightsService`를 fake storage/registry로 돌려:
  1. DART `resolved` + web stub → 정상 ready.
  2. DART `ambiguous` → `reviewNeeded` + `openDartCandidates` persist.
  3. DART `unavailable` + web stub → early return 없이 ready.
  4. DART 없음 + web 실패 → posting tier만으로 ready (coverage note에 표기).
- **실제 외부 호출 test는 하지 않음** — provider는 반드시 mock. 실호출은 로컬 수동 QA로만.

### 11.3 Regression
- 기존 `storage.test.ts:openDartCandidates`는 건드리지 않음.
- `./scripts/check.sh` 통과 + `./scripts/test-all.sh`의 기존 스위트 유지.
- Prompt snapshot test (Stage D) — `buildCompanyAnalysisPrompt` 출력 스냅샷으로 tier 블록 회귀 방지.

### 11.4 수동 QA 시나리오
1. 상장 대기업 (DART 있음) + `webSearch.enabled=false` → 기존 아티팩트와 diff 최소.
2. 상장 대기업 + `webSearch.enabled=true` + Naver → 뉴스 인용이 "최근 1~2년 성장축" 섹션에 등장.
3. 비상장 스타트업 + `enabled=true` → DART 소스 부재 명시 + 뉴스 기반 맥락 서술.
4. DART `ambiguous` → `OpenDartCandidateModal` 그대로 표시/선택 후 재생성.
5. Naver 키 없음 + `enabled=true` → 빈 web source, posting+DART만으로 ready (에러 아님).

## 12. 롤아웃 & Feature Flag

- Stage A~C는 `webSearch.enabled=false` 기본값 → 프로덕션 무영향.
- Stage D 머지 후:
  1. Dev 환경에서 `enabled=true` 로 1주 관찰.
  2. 로그/아티팩트 품질 확인 (`insight-sources.json`의 `contextual` 인용 수, 프롬프트 길이, LLM latency).
  3. QA 시나리오 4번이 깨지지 않는지 확인.
  4. Prod에 기본값 `true`로 전환.
- Kill switch: `runner.json`의 `webSearch.enabled=false`로 즉시 비활성화. 캐시 파일은 유지되지만 읽지 않음.

## 13. 리스크 & 완화책

1. **Naver/Brave 쿼터 초과** — 재지원이나 배치 생성 시 한도 소진.
   - 완화: 회사명 단위 캐시(7일), per-call timeout, 429 시 캐시 hit만 반환하고 provider 호출 중단, cacheTtlDays 증가로 운영 대응.

2. **Recency bias** — 뉴스가 오래된 이슈를 현재처럼 서술.
   - 완화: `publishedAt` 필터 + 프롬프트의 "9개월 이상 → 불확실 표기" 규칙 + snippet에 date 주입.

3. **Source tier 프롬프트 실패** — LLM이 tier 규칙을 무시하고 뉴스로 매출 숫자를 생성.
   - 완화: (a) tier 규칙을 프롬프트 상단에 배치, (b) factual 소스에 `tier=factual` 태그를 JSON에 명시, (c) Stage D에서 LLM 출력 파싱 시 "출처와 근거 강도" 섹션의 factual 카운트 0이면 숫자를 strip하는 post-process 가드 추가 검토 (옵션).

4. **캐시 일관성** — 회사가 인수/상장/리브랜드 되었는데 캐시 7일이 남아 과거 이슈 서술.
   - 완화: `regenerate` 액션에 "캐시 우회" 옵션을 UI에 노출하지 않는 대신, 파일 삭제 수동 절차를 `docs/development/OPERATING_RULES.md`에 추가. TTL 7일로 자연 만료.

5. **동명이회사 잔존 리스크** — `companyName`만 query → "현대" 같은 토큰에서 다른 회사 뉴스가 섞임.
   - 완화: (a) query에 roleName/업계 키워드 병합, (b) DART가 resolved면 `corpName`으로 검색, (c) Stage 제외 — 공고 hints 확장은 파킹. 본 스테이지에서는 리스크 문서화만.

6. **Provider 장애 전파** — Naver 다운 시 Promise.all 실패로 전체 중단.
   - 완화: `collectCompanyContext`는 per-source try/catch로 독립 실패, web 실패는 `notes`에만 기록. "fallback 분기 없음" 원칙과 양립.

7. **프롬프트 토큰 폭증** — snippet 수가 늘어 LLM cost 증가.
   - 완화: web snippet 최대 10개, 각 400자 trim, dedupe, recency 필터로 자연 한도.

## 14. 검증 체크리스트

### 14.1 자동
- `./scripts/check.sh` — lint + type + build.
- `./scripts/test-all.sh` — unit + integration.
- Stage별 독립 green 확인 (Stage A/B/C/D/E).

### 14.2 dev-stack 기동
- `./scripts/dev-stack.sh` 기동 후 브라우저에서:
  - 기존 프로젝트 (DART 있음) 인사이트 재생성 → 기존과 diff 미미.
  - 신규 프로젝트 (비상장사명 + 공고 URL) 생성 → 인사이트 ready.
  - DART ambiguous 케이스 생성 (검색어 여러 후보) → 모달 노출/선택/재생성 정상.

### 14.3 수동 QA 체크리스트
- [ ] `company-context-manifest.json` 파일 생성 확인.
- [ ] `company-source-cache/` 디렉터리에 캐시 JSON 쓰기 확인.
- [ ] `webSearch.enabled=false` 기본값에서 외부 HTTP 호출 0.
- [ ] 프롬프트에 "Source Tier Rules" 블록 포함 (`insight-sources.json` 또는 디버그 로그).
- [ ] `OpenDartCandidateModal` 선택 플로우 회귀 없음.
- [ ] `jobPosting.ts` 수정 없음 (파킹 경계 준수).
- [ ] `.env.production.example`에 신규 키 등록.

## 15. 파킹 항목과의 의존관계

본 스테이지가 남기는 **미래 스테이지(공고 분석 리팩터)가 충돌 없이 접목될 인터페이스 경계**:

1. `collectCompanyContext({ project, hints })` 의 `hints` 파라미터는 현재 `{ companyName, roleName, keywords }`만 받지만, 미래에 `companyHints?: { industry?, aliases?[], headquartersCountry? }`를 추가할 수 있게 **확장 가능한 객체 타입**으로 정의.
   - 권장: `CompanyContextHints`를 shared 타입으로 분리, 본 스테이지에서는 현재 필드만 사용.

2. `postingSource.ts`는 `project.jobPostingText` + `project.mainResponsibilities` 등 **현재 ProjectRecord 필드**만 읽는다. 공고 분석 리팩터가 `project.companyHints`를 추가해도 `postingSource`는 건드리지 않고 `collectCompanyContext`의 `hints` 인자에 전달되도록 경계 분리.

3. 공고 분석이 비동기화되면 `generateProjectInsightsService` 진입 시점에서 `postingAnalyzedAt`이 아직 없을 수 있음 → 본 스테이지의 early-exit 조건(`:89`)은 변경하지 않아 미래 스테이지에서도 동일한 가드가 유효.

4. `WebSearchQuery`는 `companyName/roleName/keywords`만 가진다. 미래에 `aliases?: string[]`를 추가하면 provider 구현체는 `companyName + aliases`를 OR-join 하면 되므로 인터페이스 bump 없이 확장 가능 — 단 Naver API가 OR 연산자를 부분 지원한다는 점을 문서화.

5. 캐시 키에 `providerId`만 포함하고 `hints`는 포함하지 않음 — hints가 변경되면 캐시를 invalidate 해야 할지 여부는 미래 스테이지 결정 사항. 본 스테이지에서는 **hints는 캐시 키에 포함하지 않음**을 명시 (단순성 > 일관성). 필요 시 Stage F에서 key bump.

---

## 부록 A · Trade-off 요약 및 권장안

| 결정 지점 | 옵션 | 권장 | 이유 |
|---|---|---|---|
| 캐시 저장소 | 파일 / SQLite / 메모리 | **파일** | 스키마 변경 없음, 기존 I/O 패턴 재사용 |
| Web tier UI 노출 | ProjectRecord 필드 / JSON only | **JSON only** | 스키마 bump 리스크 회피 |
| Shim vs. 즉시 교체 | 점진 / 일괄 | **Stage A~E 점진** | 각 스테이지 green |
| Provider 에러 시 동작 | throw / 빈 결과 | **빈 결과 + notes** | fallback 분기 제거 원칙 |
| 기본 provider | Naver / Brave | **Naver** | 한국어 회사명 품질, pubDate 필드 |
| recencyMonths 기본 | 6 / 9 / 12 | **9** | 뉴스 커버리지와 신선도 균형 |
| Snippet 최대 길이 | 200 / 400 / 800 | **400** | 토큰 예산 vs 문맥 보존 |
| 캐시 TTL 기본 | 3일 / 7일 / 14일 | **7일** | 재지원 주기 대응, 뉴스 신선도 한계 |

## 부록 B · 참고 파일 인덱스

- `packages/runner/src/routes/insightsHandlers.ts:76,137,145,155,177`
- `packages/shared/src/core/companySources.ts:45,56`
- `packages/shared/src/core/companySourceModel.ts:1,13`
- `packages/shared/src/core/companyInsightArtifacts.ts:26`
- `packages/shared/src/core/insights.ts:42`
- `packages/shared/src/core/openDart.ts:42,69`
- `packages/shared/src/core/webviewProtocol.ts:261`
- `packages/web/src/pages/ProjectsPage.tsx:669,725`
- `packages/web/src/components/OpenDartCandidateModal.tsx`
- `packages/runner/src/runnerContext.ts:32,55`
- `packages/runner/src/runnerConfig.ts:20-34`
- (read-only) `packages/shared/src/core/jobPosting.ts` — 수정 금지
