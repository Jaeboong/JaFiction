# 2026-04-17 — 공고 파서 리팩터 (측정 게이트 기반)

**Status:** draft (API 조사 결과 대기 중 — P3 분기 영향)
**Scope:** 국내(한국) 채용 공고 전용
**Driving data:** `docs/plans/2026-04-17-posting-parser-fixtures/` (75 URL 실측)

---

## 1. 배경

recon 결과 — 자세한 내용은 `2026-04-17-posting-parser-fixtures/report.md`.

- **진짜 성공률 10.7%** (8/75)
- **오인식(misidentification) 32건 (43%)** — `<title>` 폴백이 "점핏/원티드/기아 탤런트 라운지" 같은 **사이트명**을 공고 회사/직무로 인식하여 LLM에 garbage 전달. 빈 값보다 치명적.
- **28% SPA** — 정적 fetch로 근본 불가 (실질적으로 48% 영향)
- **JSON-LD 커버리지 20%** — wanted 91%, jobkorea 100% 미활용

현재 파서(`packages/shared/src/core/jobPosting.ts`)는 GreetingHR `__NEXT_DATA__` 경로에만 최적화돼 있음. 아키텍처 개편 필요.

## 2. 설계 원칙

1. **측정 게이트 기반 단계 진행**: `ship → measure on 75-URL fixture → decide next`. 각 스테이지 완료 조건이 fixture 측정치로 정의됨. 통과 못하면 다음 스테이지로 진행하지 않는다.
2. **Source Tier Rules 어휘 재사용**: 기존 `companyInsightArtifacts.ts:101`의 `factual ≻ contextual ≻ role` 계층을 공고 파서 `fieldConfidence`에도 동일 어휘로 매핑. 다운스트림 프롬프트가 두 번째 taxonomy를 학습할 필요 없도록.
3. **국내 전용**: 해외 ATS(Greenhouse/Lever/Workday/Ashby/LinkedIn) 불포함. 관련 로직 도입 금지.
4. **`<title>` 단독 폴백은 자동 low-confidence**: ATS 사이트명 블랙리스트는 *accelerator*일 뿐, 기본 방어선은 "단일 출처 폴백 = weakest tier" 규칙. 새 ATS 추가로 깨지지 않음.

## 3. 아키텍처 결정

### A1. Puppeteer 위치: `packages/runner`

Runner는 Stage 11.7 이후 **항상 사용자 로컬 머신**에서만 동작하는 hosted-mode outbound 컴포넌트(`docs/development/ARCHITECTURE.md:21-25`). OCI 백엔드에는 runner가 없다. → Chromium footprint는 사용자 데스크탑 수준에서 수용 가능. 서버풀링 불필요.

- `packages/shared/src/core/jobPosting/fetcher.ts` — `JobPostingFetcher` 인터페이스 정의 (fetching 추상화)
- `packages/shared/src/core/jobPosting/parser.ts` — HTML 문자열만 받아 파싱 (fetching 모름)
- `packages/runner/src/posting/puppeteerFetcher.ts` — Puppeteer 구현, runner 부팅 시 주입
- **`shared`에는 Chromium·DOM 파서 의존성 들이지 않음** — web 번들에 영향 X, 향후 cloud 모드 재도입 시에도 재사용 가능

### A2. `fieldConfidence` → Source Tier 매핑

각 추출 필드에 tier 태그:

| Tier | 출처 예 | 신뢰도 |
|---|---|---|
| `factual` | JSON-LD `JobPosting` / `__NEXT_DATA__` detail payload / 공식 API | 최상 — 그대로 downstream 투입 |
| `contextual` | HTML regex with ≥2 corroborating signals, og:meta + body heading 일치 | 중간 — reviewNeeded 플래그 옵션 |
| `role` (weakest) | `<title>` 단독, 단일 heuristic, ATS 사이트명 흔적 | 최하 — **downstream 기본 거부**, UI 경고 노출 |

저장 위치:
- `JobPostingExtractionResult.fieldSources: Record<FieldKey, SourceTier>` (신규)
- `ProjectRecord.jobPostingFieldConfidence: Record<FieldKey, SourceTier>` (신규)

### A3. Fetch 인터페이스

```ts
// packages/shared/src/core/jobPosting/fetcher.ts
export interface JobPostingFetcher {
  readonly capabilities: readonly ("static" | "spa-render")[];
  fetch(url: string, opts?: FetchOpts): Promise<FetchedHtml>;
}

export interface FetchedHtml {
  html: string;
  finalUrl: string;
  status: number;
  contentType?: string;
  fetchedAt: string;
  /** Puppeteer 사용 여부 등 provenance */
  method: "static" | "spa-render";
}
```

Parser는 `analyzeJobPostingHtml(html: string, sourceUrl: string): JobPostingExtractionResult` 형태로 노출.

## 4. 스테이지

### P0 — 오인식 방어 + `fieldConfidence` 스키마 (1~2일)

**세부 플랜**: [`2026-04-17-posting-parser-p0-field-confidence.md`](./completed_plans/2026-04-17-posting-parser-p0-field-confidence.md)

**목표**: 오인식 32건 → ≤ 5건 (fixture 측정)

**작업**:

1. `JobPostingExtractionResult`에 `fieldSources: Record<string, SourceTier>` 추가
2. `ProjectRecord`에 `jobPostingFieldConfidence` 추가 (기존 값은 마이그레이션 시 `unknown` 처리)
3. 파서에 "폴백 출처 규칙" 도입:
   - `<title>` 단독에서 추출된 필드 → 자동 `role`
   - HTML heading regex 단독 → `role` 또는 `contextual` (corroboration 개수에 따라)
   - JSON-LD / `__NEXT_DATA__` → `factual`
4. **ATS 사이트명 블랙리스트 (accelerator)**:
   - "점핏", "원티드", "사람인", "기아 탤런트 라운지", "잡코리아" 등 패턴이 `<title>`에서 나올 때 companyName/roleName 추출 자체를 건너뜀
   - 블랙리스트 매칭 시 `warnings`에 "unusable fallback title detected"
5. Runner 측 `analyze_posting` / `analyze_insights` RPC에서 모든 필드가 `role` tier면 `insightStatus` 를 `reviewNeeded`(사유: `lowConfidenceExtraction`) 강제
6. Web UI: 공고분석 결과 패널에서 `role` tier 필드에 ⚠️ 뱃지 + 툴팁 ("자동 감지 신뢰도 낮음 — 수동 확인 필요")
7. `insightsHandlers.generateProjectInsightsService` — `role` tier only 상태에선 LLM 호출 거부

**게이트**: `scripts/fetch-posting-fixtures.ts --force` 재실행 → `results.json`의 `classification=partial (misidentification)` ≤ 5. 통과하면 P1.

**위험**: 기존 프로젝트의 `confidence` 필드 부재 — 기본값 `unknown` 으로 마이그레이션, 생성일 분기로 새 레코드만 엄격 적용.

---

### P1 — JSON-LD JobPosting 파서 (1~2일)

**목표**: +15건 성공 (wanted 10 + jobkorea 4 + `other_corporate` 1)

**작업**:

1. `packages/shared/src/core/jobPosting/sources/jsonLd.ts` 신규
2. `<script type="application/ld+json">` 순회 → JSON.parse 후 `@type === "JobPosting"` (또는 `@graph` 내 검색)
3. 필드 매핑:
   - `title` → `roleName`
   - `hiringOrganization.name` → `companyName`
   - `description` → `mainResponsibilities` (길이 ≥ 200) / `overview` (짧은 경우)
   - `validThrough` → `deadline` (ISO → 한국어 정규화)
   - `jobLocation.address` → `locationText`
   - `employmentType` → `employmentType`
4. `fieldSources.*` = `factual`
5. 파이프라인 배치: `extractEmbeddedJobPostingSource()` 앞단에 JSON-LD 레이어 삽입. JSON-LD 성공 시 나머지 경로 스킵 (단 keywords 수집은 계속)
6. wanted `/company/16049` 케이스(JSON-LD 없음, 업스테이지 회사 페이지)는 P2에서 별도 처리 — **이건 사실 공고가 아니라 회사 페이지. fixture 오수집일 수 있음**. P2에서 handling 방향 결정.

**게이트**:
- wanted 11건 중 최소 10건 `success` 분류 + `companyName`/`roleName` 정답
- jobkorea 성공률 유지 (75% → 75%+)
- greetinghr 2건 회귀 없음
- misidentification 추가 발생 0건

---

### P2 — `__NEXT_DATA__` 쿼리 구조 확장 (1일)

**목표**: +3~5건 (careerlink, wanted JSON-LD 폴백 일부, 기타 Next.js 기반 페이지)

**배경**: fixture grep 결과, careerlink 3건은 `__NEXT_DATA__` 존재하나 **queryKey 패턴이 greetinghr의 `getOpeningById`와 완전히 다름** (현재 grep 0건 매칭). 쿼리 shape 조사 후 별도 어댑터 필요.

**작업**:

1. 기존 `extractEmbeddedJobPostingSource()` (`jobPosting.ts:686-721`)를 어댑터 패턴으로 분할:
   - `packages/shared/src/core/jobPosting/sources/nextData/greetingHr.ts` (기존 로직)
   - `packages/shared/src/core/jobPosting/sources/nextData/careerlink.ts` (신규)
   - `packages/shared/src/core/jobPosting/sources/nextData/index.ts` (registry + dispatcher)
2. careerlink `__NEXT_DATA__` shape 조사 (P2 착수 시 fixture 3건에서 JSON 구조 파악)
3. adapter registry 호스트 매칭:
   - `*.greetinghr.com` → greetinghr adapter
   - `*.careerlink.kr` → careerlink adapter
4. JSON-LD 실패한 wanted `/company/` 페이지 — **공고가 아닌 회사 페이지로 판정하여 `expired`/별도 분류** 반환 (인사이트 생성 진입 차단)
5. `fieldSources.*` = `factual`

**게이트**:
- careerlink 3건 중 최소 2건 `success` (1건은 `expired` 200 케이스이므로 제외 가능)
- greetinghr 2건 회귀 없음
- wanted/jumpit 등 다른 도메인 회귀 없음

---

### P3 — 헤드리스 렌더링 인터페이스 + 구현 (3~5일)

**목표**: +36건 (jumpit 17 + recruiter_co_kr 9 + kia 6 + posco 3 + lg 1)

**결정 (2026-04-17)**: **P3b (Puppeteer 주력) + 사람인 오픈API는 선택적 보조**

API 조사 결과 요약:
- 사람인 공식 오픈 API 존재(`GET https://oapi.saramin.co.kr/job-search?access-key=...&id=...`). 다만:
  - **점핏(jumpit.saramin.co.kr) 공고 포함 여부 문서에 미명시** — 불확실성 큼 (문의 필요: `api@saramin.co.kr`)
  - 일 500회 rate limit (개인 사용자 기준은 충분, 서비스 전체 확장에는 제약)
  - 계정 + 이용신청 승인 절차 필요, 개인 발급 가능 여부 불명확
  - 상업용 이용 불명확 (saramin.co.kr 이용약관 제19조: 사전동의 없는 영리 이용 금지 조항)
- 점핏 `robots.txt`: `/position` Disallow 아님 → 크롤링 기술적 허용
- 점핏 HTML은 **완전 순수 SPA** — 내부 API는 JS 번들 안에 있어 정적 추출 불가

**결론**: Puppeteer가 점핏·recruiter.co.kr·kia 등 36건을 모두 커버할 수 있고, API 의존성(승인/제한/포함여부)이 없어 더 안정적. 사람인 API는 P3 완료 후 "사람인 그룹 도메인만 API 우선" 보조 어댑터로 검토 가능 — 문서 확인·승인 절차가 끝나야 진입.

#### P3 공통 — Fetcher 인터페이스 도입

1. `JobPostingFetcher` 인터페이스 확정 (§A3)
2. 기존 `fetchAndExtractJobPosting()` 내부 fetch 로직을 `StaticHttpFetcher` 클래스로 추출
3. parser와 fetcher 분리:
   - parser: HTML string → `JobPostingExtractionResult`
   - fetcher: URL → `FetchedHtml` (HTML string)
4. runner 부팅 시 fetcher registry 구성:
   - `StaticHttpFetcher` (기본)
   - `PuppeteerFetcher` (신규, P3b 시)
   - 호스트 라우팅: known-SPA 리스트는 Puppeteer 우선, 그 외 HTTP 우선
5. 프로덕트 단에서 바뀌는 것: `fetchAndExtractJobPosting` signature가 `{ jobPostingUrl }` 받으면 내부에서 fetcher 선택

#### P3a — 사람인 오픈 API 보조 어댑터 (조건부, P3b 이후)

**진입 조건** (모두 충족 시만):
1. `api@saramin.co.kr` 문의로 **점핏 공고 포함 여부** 확인됨 (포함이어야 진행)
2. 상업용 이용 승인 또는 서비스 카테고리가 약관상 허용
3. 일 500회 제한이 실사용에 충분 (사용자당 하루 수 건 수준)

**작업**:
1. 사람인 오픈 API 키 발급 (사용자/운영자 계정으로 1회성)
2. `packages/runner/src/posting/sources/saraminApi.ts` 어댑터 구현
3. `jumpit.saramin.co.kr/position/:id` URL → API 호출로 우선 대체 (Puppeteer 폴백 유지)
4. `fieldSources.*` = `factual`
5. rate limit 카운터 구현, 초과 시 Puppeteer로 자동 폴백

#### P3b — Puppeteer 구현

1. `packages/runner/src/posting/puppeteerFetcher.ts`:
   - Chromium singleton 관리 (launch once, reuse pages, cleanup on shutdown)
   - `puppeteer-core` + 시스템 Chrome 감지 우선. 없으면 bundled Chromium 다운로드
   - 페이지당 timeout 30초
   - User-Agent 지정, 리소스 차단 (이미지/폰트 차단으로 속도 개선)
   - `networkidle0` 대기, `window.__NEXT_DATA__` 또는 body length 기반 렌더 완료 감지
2. robots.txt 준수 레이어 (서브에이전트 조사 결과 반영)
3. 호스트 화이트리스트 (국내 ATS만): `jumpit.saramin.co.kr`, `*.recruiter.co.kr`, `career.kia.com`, `recruit.posco.com`, `careers.lg.com` 등
4. 렌더 후 HTML을 parser에 넘김 → 기존 레이어(JSON-LD / `__NEXT_DATA__` / HTML 헤딩) 재사용
5. Feature flag `POSTING_HEADLESS_ENABLED` (runnerConfig) — 기본 true, 장애 시 즉시 off 가능

**게이트**:
- jumpit 17건 중 ≥15건 `success`
- recruiter_co_kr 9건 중 ≥7건 `success`
- kia 6건 중 ≥4건 `success`
- 정적 fetcher로 성공 중인 케이스 회귀 0건

**비용**:
- Chromium 다운로드: runner 설치 시 1회, ~150MB
- 런타임 메모리: Chromium 프로세스 ~200MB peak
- 사용자 로컬 실행이므로 서버 풀링·큐 불필요 (A1 근거)

---

### P4 — 정확도 미세 개선 + 회귀 보호 (1~2일)

1. roleName 추출 정밀화 — jobkorea partial 1건 및 일반 heuristic 개선
2. **fixture → golden test 승격**:
   - 현재 `success` 분류 8건(greetinghr 2 + jobkorea 3 + idis 3) + P0~P3 완료 후 추가 성공분을 `packages/shared/src/test/goldens/posting/` 로 복사
   - snapshot 테스트: 각 golden에 대해 `companyName` / `roleName` / `normalizedText.length` / `fieldSources` 가 불변
   - CI에서 PR마다 실행
3. fixture 재수집 스크립트 (`scripts/fetch-posting-fixtures.ts`) 를 semi-regularly 갱신하여 데이터 신선도 유지

## 5. Regression Goldens (스테이지 무관 공통 장치)

**원칙**: 현재 `success` 8건은 **must-not-break** 기준선. 각 스테이지 진입 전 이 8건이 통과해야 함.

- 대상: `greetinghr` 2 + `jobkorea` 3 (48896788, 48898459, 48910001) + `careers.idis.co.kr` 3
- 저장: `packages/shared/src/test/goldens/posting/<domain>_<idx>.html` + `expected.json` (companyName, roleName, normalizedText 길이 범위)
- 테스트: `packages/shared/src/test/jobPosting.goldens.test.ts` 신규
- P0 착수 전 최초 스냅샷 동결

## 6. 측정 도구 (반복 사용)

각 스테이지 종료 시:

```bash
bun run scripts/fetch-posting-fixtures.ts --force
# 결과 비교
diff docs/plans/2026-04-17-posting-parser-fixtures/results.json{,.baseline}
```

`report.md` 는 스테이지별 재생성 — 성공률 추이 표를 plan appendix에 누적.

## 7. 미해결 질문 (사용자 확인 필요)

1. **Runner 번들 크기 증가 승인**: Puppeteer Chromium ~150MB (설치 시 1회 다운로드). 사용자 업데이트 경험에 영향. OK?
2. **P0 블랙리스트 보강**: 현재 제안 (`점핏 / 원티드 / 사람인 / 기아 탤런트 라운지 / 잡코리아`) 외에 추가 패턴 있으면 알려주세요.
3. **fixture 보강**: 현재 75건 중 `other_corporate` 19건이 이질적 혼합 버킷. 대응 우선순위가 높은 기업이 있으면 추가 URL 제공 요청.
4. **P3b 시 TLS 인증서 이슈**: `kpf.plusrecruit.co.kr` 인증서 검증 실패. 해당 도메인만 우회(`rejectUnauthorized: false`)할 정책 OK? 또는 해당 도메인 out-of-scope?

## 8. 위험 / 롤백 경로

| 위험 | 완화 |
|---|---|
| P0 스키마 변경 마이그레이션 누락 | 기본값 `unknown` 주입, 기존 레코드 무결성 유지 |
| P1 JSON-LD false positive (설명 짧거나 부정확) | 최소 길이/필드 검증, `fieldSources`로 downstream 재검토 가능 |
| P3 Puppeteer 안정성 (페이지 깨짐, timeout) | Feature flag `POSTING_HEADLESS_ENABLED` 즉시 off, HTTP fetcher 폴백 |
| Puppeteer 다운로드 실패(오프라인) | runner 부팅 시 PuppeteerFetcher 등록 실패 → HTTP fetcher만 사용 (warning만 표시) |
| 국내 ATS가 헤드리스 차단 강화 | robots.txt 확인 레이어, 차단된 도메인은 수동 입력 유도 UI |

## 9. 의존성 (외부)

- [x] 점핏/사람인 공식 API 조사 결과 (2026-04-17 완료) — P3b 주력 결정, P3a는 조건부 보조
- [x] advisor 아키텍처 판단 (2026-04-17 수락)
- [ ] 사용자 승인: Puppeteer 번들 (~150MB), fieldConfidence 스키마 변경, 블랙리스트 범위, TLS 예외 정책
- [ ] (P3a 진입 시에만) 사람인 `api@saramin.co.kr` 문의 결과 — 점핏 공고 포함 여부 + 상업용 승인

## 10. 추적 링크

- Recon: `docs/plans/2026-04-17-posting-parser-fixtures.md`
- Results: `docs/plans/2026-04-17-posting-parser-fixtures/results.json`
- Report: `docs/plans/2026-04-17-posting-parser-fixtures/report.md`
- Current parser: `packages/shared/src/core/jobPosting.ts`
- Existing Source Tier: `packages/shared/src/core/companyInsightArtifacts.ts:101`
- Runner arch: `docs/development/ARCHITECTURE.md:21-25`
