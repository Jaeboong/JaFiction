# 2026-04-19 — 공고 파서 P2: 메이저 한국 공고 사이트 전용 어댑터

**Status:** confirmed (2026-04-19, 모든 Open Questions 확정 — §8 참조)
**Scope:** 국내(한국) 메이저 공고 플랫폼 전용 어댑터 레이어 도입
**Precedents:**
- `docs/plans/completed_plans/2026-04-17-posting-parser-p0-field-confidence.md` — P0 신뢰도 인프라 (완료)
- `docs/plans/completed_plans/2026-04-19-posting-parser-p1-jsonld.md` — P1 JSON-LD 파이프라인 (완료, factual 27.3% → 43.8%)
- `docs/plans/2026-04-17-posting-parser-refactor.md` — 전체 리팩터 마스터 plan
  - 본 plan 의 Chunk 0 은 §3.A3 (Fetch 인터페이스), §P3 공통 (fetcher 분리) 의 *축소 버전* 을 포함
  - §P3b (Puppeteer) 의 취급 → 본 plan Open Question 1 (Path A vs B)
  - §P4 (goldens) 는 본 plan 의 각 Chunk success criteria 로 흡수됨
  - §P2 (careerlink `__NEXT_DATA__` 어댑터) 는 본 plan Chunk 3 에 흡수

**Driving data (2026-04-19 현재):**
- fixture 75건 factual 비율 43.8% (baseline)
- 필드별 factual (success 21건 기준): companyName 100%, roleName 76%, mainResponsibilities 43%, qualifications 0%, preferredQualifications 0%
- 실제 사용자 회귀 케이스: jobplanet `/job/search?posting_ids[]=1318470` title 태그 그대로 roleName 에 투입됨

---

## 목차

1. 배경 및 문제 정의
2. 설계 원칙
3. 아키텍처 결정
   - A1. 어댑터의 역할 (대체 아닌 증강)
   - A2. 3층 fallback 구조
   - A3. Per-field tier (어댑터 내부)
   - A4. Site signature check + 자동 강등
   - A5. 디렉토리 구조
4. 사이트 우선순위 + 실측 기반 스코프
5. Chunk 분할 (Path B 기준 — 기본안)
6. 측정 방법 및 게이트
7. 리스크
8. Open Questions (사용자 확정 필요)
9. 추적 링크

---

## 1. 배경 및 문제 정의

P1 완료 후 factual 43.8% 달성했으나, 다음이 한계로 드러남:

### 1.1 사용자 실측 회귀 (2026-04-19)

jobplanet URL `https://www.jobplanet.co.kr/job/search?posting_ids[]=1318470` 입력 시:
- `roleName = "Korea Webtoon Data Analyst (경력), 경기 채용, 4.3 기업 만족도, 170개 기업리뷰"` (title 태그 통째 투입)
- 주요업무/자격요건 섹션 미검출
- "네이버웹툰" companyName 으로 잡혔으나 tier 불명 (role 가능성)

### 1.2 구조적 gap

- `qualifications` / `preferredQualifications` factual 0% — 현재 파이프라인(JSON-LD → heading heuristic)으로는 승격 경로가 없음. **43.8% → 70% 목표의 병목은 이 두 필드**
- ATS 블랙리스트 정책이 wanted/jumpit/사람인 을 `role` tier 로 강제하지만, 정작 wanted 는 JSON-LD 91% 커버리지 → 현재 정책이 `factual → role` 로 오히려 다운그레이드시키는 역설
- jobplanet, 리멤버커리어, 링크드인 등은 아예 JSON-LD 부재 + SPA → 현재 파이프라인 완전 무력화

### 1.3 목표 반전

"ATS 블랙리스트로 모르는 사이트를 전부 `role` 강등" → **"알려진 사이트는 전용 어댑터로 factual 승격, 나머지만 기존 JSON-LD + blacklist fallback"**

단, 뒤집되 3층 방어선(§A2)은 유지해야 함 (모르는 사이트의 title-garbage 리그레션 방지).

---

## 2. 설계 원칙

1. **어댑터는 증강 레이어** — 기존 JSON-LD / cross-validate 파이프라인을 *대체* 하지 않고, per-site selector/hint 로 *보강*. wanted 처럼 JSON-LD 이미 완벽한 곳은 어댑터가 "이 URL 은 내가 인증하는 source 다" 라는 메타만 제공.
2. **Per-field tier** — 어댑터가 all-or-nothing factual 승격을 하지 않음. 필드별로 (a) DOM anchor 기반 추출 = factual, (b) heuristic fallback = contextual/role 중 적절히 방출.
3. **Site signature 검증** — 어댑터는 "이 사이트 HTML 구조가 내가 아는 모양인가" 체크 (특정 앵커 selector 존재). 실패 시 해당 어댑터의 모든 방출 tier 를 한 단계 강등.
4. **3층 fallback** — (1) 어댑터 → (2) 공용 JSON-LD + cross-validate + section heuristic → (3) ATS blacklist 최종 가드. 2 와 3 은 무조건 유지.
5. **측정 게이트 기반** — 각 Chunk 는 "이 어댑터가 어떤 필드의 factual 비율을 얼마만큼 끌어올리는가" 를 숫자로 명시. 실패 시 다음 Chunk 블로킹.
6. **Regression-free** — 기존 6 goldens (jobkorea 3 + greetinghr 2 + wanted 1) 는 매 Chunk 통과 조건. 어댑터 도입 부작용으로 파괴되면 revert.
7. **국내 전용 원칙 유지** — LinkedIn 은 기존 P0 §2 원칙과 충돌. Open Question 으로 격리.

---

## 3. 아키텍처 결정

### A1. 어댑터의 역할: 대체 아닌 증강

`SiteAdapter` 인터페이스는 *partial* 결과를 리턴. 기존 파이프라인이 이를 흡수.

```ts
// packages/shared/src/core/jobPosting/adapters/types.ts (제안, 실제 코드 작성은 Chunk 0 에서)
export interface SiteAdapterMatch {
  /** 이 어댑터가 처리 가능한 URL 인지 */
  canonicalUrl?: string;  // URL normalization (예: jobplanet search → detail redirect)
  siteKey: string;        // "wanted", "jobplanet" 등
}

export interface SiteAdapterResult {
  /** 어댑터가 추출한 필드와 각각의 tier.
   *  미포함 필드는 기존 파이프라인이 채움 */
  fields: Partial<Record<JobPostingFieldKey, { value: string; tier: SourceTier }>>;
  /** 사이트 signature 확인 결과. false 이면 모든 tier 강등 */
  signatureVerified: boolean;
  /** trusted source marker — fallback 파이프라인이 이 어댑터 결과를 우선 존중 */
  adapterTrust: "high" | "medium" | "low";
  warnings: string[];
}

export interface SiteAdapter {
  readonly siteKey: string;
  match(url: string): SiteAdapterMatch | undefined;
  extract(html: string, ctx: {
    url: string;
    jsonLdFields?: JsonLdJobPostingFields;
    normalizedText: string;
  }): SiteAdapterResult | undefined;
}
```

**wanted 의 경우**: JSON-LD 이미 완전 → 어댑터는 signature check + `adapterTrust: "high"` 만 제공. fields 는 거의 비어있음. 파이프라인은 JSON-LD factual 결과를 그대로 사용하되, "어댑터 승인" 이 있으므로 ATS blacklist 강등을 스킵.

**jobplanet 의 경우**: JSON-LD 없음 + title garbage → 어댑터가 DOM selector 로 roleName / qualifications 추출. signature check 로 HTML 구조 검증.

### A2. 3층 fallback 구조

```
파서 진입
  │
  ├─ 1층: 어댑터 매칭 시도
  │   └─ match(url) → SiteAdapterMatch
  │       └─ extract(html) → SiteAdapterResult (per-field tier)
  │           signature OK → 원본 tier 유지
  │           signature NG → 모든 tier 한 단계 강등, warning 추가
  │
  ├─ 2층: 공용 JSON-LD + cross-validate + heading heuristic (기존)
  │   └─ 어댑터가 안 채운 필드만 여기서 채움
  │   └─ 어댑터 결과와 충돌 시 어댑터 우선 (adapterTrust 기준)
  │
  └─ 3층: ATS blacklist 최종 가드
      └─ 어댑터 매칭 없고 + 2층도 실패 시
      └─ title 이 ATS 사이트명이면 companyName/roleName 버림 (현재 로직 유지)
      └─ 이 경우 fieldSources 는 `role` 에 머무름 → UI 수동 입력 유도
```

**핵심**: 현재 `isAtsSiteTitle` 은 "사이트명 하드코드" 방식. 이를 **어댑터 존재 여부 기반** 으로 뒤집음:
- `wanted` 어댑터 있음 → wanted title 은 blacklist 대상 아님
- `jobplanet` 어댑터 추가 → jobplanet title garbage 는 어댑터가 처리
- 어댑터 없는 신규 ATS (예: 2026 년에 생긴 새 채용 플랫폼) → blacklist 가 계속 방어

이는 P0 plan §2.4 "단일 출처 폴백 = weakest tier" 원칙과 정합적. 어댑터는 "단일 출처 + signature check" 이므로 factual 승격 가능.

### A3. Per-field tier (어댑터 내부)

어댑터는 필드별로 독립적 tier 결정:

| 추출 방법 | 기본 tier |
|---|---|
| DOM anchor (안정적 selector, e.g. `<div class="job_description">` heading) | `factual` |
| 정규식 + 다중 signal 교차 검증 | `contextual` |
| heuristic 단일 소스 | `role` |

예시 — jobplanet 어댑터:
- `roleName`: `<h2 class="posting-title">` 존재 + strip "(경력)" 접미사 → `factual`
- `qualifications`: `h3` 헤딩 "자격 요건" + 다음 `<ul>` 파싱 → `factual`
- `preferredQualifications`: 동일 패턴 but 헤딩 존재 불확실 → 발견 시 `factual`, 폴백 heading heuristic 은 `role`

### A4. Site signature check + 자동 강등

각 어댑터는 `signatureSelectors: string[]` 정의. 추출 전 "이 HTML 에 내가 기대하는 앵커 중 하나라도 있는가" 체크.

- 통과 → 원본 tier 유지
- 실패 (사이트 HTML 구조 변경) → 모든 tier 한 단계 강등 (factual → contextual, contextual → role)
- warnings 에 `"site_signature_mismatch:<siteKey>"` 추가 → 이후 goldens 테스트가 이를 포착

이는 "factual 배지를 단 garbage" 리스크를 차단. 사이트가 구조 변경하면 golden test 먼저 깨지고, 어댑터 수정 전까지 자동 강등됨.

### A5. 디렉토리 구조

```
packages/shared/src/core/jobPosting/
  jsonLd.ts                 (기존)
  crossValidate.ts          (기존)
  companyHostnames.ts       (기존, 유지 — 어댑터 구현 시 어댑터 내부 hint 로 흡수 가능)
  adapters/
    types.ts                  (SiteAdapter 인터페이스 + SiteAdapterResult)
    registry.ts               (URL → 어댑터 매칭 + 우선순위 정렬)
    signatureCheck.ts         (공용 signature 검증 헬퍼)
    wanted.ts
    jobkorea.ts
    greetinghr.ts
    careerlink.ts
    recruiter.ts              (recruiter.co.kr 계열)
    jobplanet.ts
    kia.ts                    (또는 corporate/ 아래 묶기 — Chunk 4 결정)
    posco.ts
    rememberapp.ts            (Puppeteer 필요 시 Chunk 6)
    jumpit.ts                 (Puppeteer 필요 시 Chunk 6)
    saramin.ts                (Puppeteer 필요 시 Chunk 6)
    linkedin.ts               (Open Question 결정 시 Chunk 7)
```

`atsBlacklist.ts` 는 유지하되, 적용 조건만 "어댑터 매칭 안 됐을 때" 로 축소.

---

## 4. 사이트 우선순위 + 실측 기반 스코프

현재 report.md 실측 + 한국 사용자 트래픽 추정 + 필드별 gap(`qualifications` 승격) 기여도 기준.

| 순위 | 사이트 | 현황 | 난이도 | SSR | 예상 factual 기여 | 비고 |
|---|---|---|---|---|---|---|
| 1 | wanted | JSON-LD 91%, blacklist 강등 중 | 낮음 | Yes | +0 (이미 factual), blacklist 해제로 UX 개선 | Chunk 0 인프라 검증용 |
| 2 | jobkorea | JSON-LD 100%, 이미 100% success | 낮음 | Yes | +0 유지, 어댑터 승격으로 회귀 방지 | goldens 정식화 |
| 3 | greetinghr | __NEXT_DATA__ 경로, 이미 100% | 낮음 | Yes | +0 유지 | goldens 정식화 |
| 4 | careerlink | __NEXT_DATA__ 존재, 0% success | 중간 | Yes (일부) | +2~3건 (3건 fixture 중) | P0 §P2 흡수 |
| 5 | recruiter.co.kr | 9건, 0% success, SSR 일부 | 중간 | 부분 | +4~6건 | 9개 서브도메인 (hlcompany, midas, glovis, keris, hyundai-wia, wins21, jejubank, kpta, hyundaiweld 등) |
| 6 | kia (career.kia.com) | 6건, 0% success | 중간 | Yes | +3~5건 | 기업 자체 페이지, 공통 JSON-LD 아직 없음 |
| 7 | posco (recruit.posco.com) | 3건, 0% success, bodyText 48 | 높음 | ? (SPA 의심) | +1~2건 | fixture 재측정 필요 |
| 8 | **jobplanet** | **fixture 미수집, 사용자 회귀 케이스** | 중간 | 불명확 | +1 + qualifications 승격 | **사용자 명시 요청**, Chunk 5 |
| 9 | jumpit.saramin | 17건, 12% success, SPA | 높음 | **No (SPA)** | +10~15건 but **Puppeteer 필수** | Path A/B 분기점 |
| 10 | saramin.co.kr | 부분 (hyundaiweld.saramin 포함) | 중간 | 일부 SPA | +2~3건 | saramin 서브도메인 패밀리 |
| 11 | rememberapp.co.kr | fixture 미수집 | 높음 | 추정 SPA | 미정 | fixture 수집 후 결정 |
| 12 | 기업 자체 (lg, 네이버, 카카오, 삼성) | lg 1건 실측, 나머지 미수집 | 혼합 | 혼합 | 실측 후 결정 | 공통 JSON-LD vs 개별 — Chunk 4 에서 실측 기반 결정 |
| 13 | linkedin.com/jobs | fixture 미수집 | **초고위험** | SPA + auth wall | 불명확 | **Open Question — 원칙 충돌** |

### 4.1 Puppeteer 필요 사이트 (정적 fetch 무력)

- **확정**: jumpit (17건 중 SPA 거의 전부), jobplanet (SPA 의심 — 실측 필요), rememberapp (추정), linkedin
- **부분**: recruiter.co.kr (일부 0 byte body), careerlink (일부 0 byte body), posco (48 byte body), kia (미확인 — fixture 수집 시 재검증)

### 4.2 fixture 수집 필요 건수

권장: **사이트당 5~10건**. 근거:
- 기존 fixture 3~4건 (careerlink, greetinghr, jobkorea) 은 자격요건/우대사항 분기 검증에 부족했음
- 10건은 네트워크 예산 과다 + 중복 패턴 소모 가능성
- **5건 최소, 10건 상한** 으로 사이트별 선택

사이트별 수집 전략:
- 기존 `docs/plans/2026-04-17-posting-parser-fixtures/urls.txt` 끝부분에 append
- 각 사이트 `# site=<siteKey> | company | role | deadline` 메타 코멘트
- 실제 fetch 는 `bun run scripts/fetch-posting-fixtures.ts --force` 재실행 (본 plan 범위 밖, 각 Chunk 실행 시점)
- SPA 사이트는 Puppeteer 가 우선 도입된 경우에만 수집 가능 (Path A)

### 4.3 golden 필요 건수

Chunk 별 success criteria 에 "어댑터 대표 fixture 2~3건 goldens 추가" 포함.
- 최소 2건: 필드 대부분 채워진 ideal 케이스 + 필드 부분 missing 케이스
- 이상 3건: ideal + partial + signature mismatch 시뮬레이션 (HTML 변형 fixture)

---

## 5. Chunk 분할 (Path B 기준 — 기본안)

**Path B = SSR 가능 사이트 먼저, SPA 는 Puppeteer 도입 후 별도 Chunk.**
**Path A (Puppeteer 선행) 선택 시 Chunk 6/7 을 Chunk 1.5 로 당겨 재배치.** Open Question 1 결정 후 확정.

각 Chunk 는 `goal / scope / files / test plan / success criteria` 포함. 예상 working day 는 1 사람 기준.

### Chunk 0 — 어댑터 인프라 구축 (사이트 어댑터 0개)

**Goal**: SiteAdapter 인터페이스 + registry + per-field tier 머지 + 파이프라인 통합 지점 도입. 기존 동작은 무변화.

**Scope**:
- `adapters/types.ts`, `adapters/registry.ts`, `adapters/signatureCheck.ts` 신규
- `jobPosting.ts` 의 `fetchAndExtractJobPosting` / `buildExtractionResult` 가 registry lookup → 어댑터 실행 → 결과 머지 순서로 재구성
- per-field tier merge 로직: 어댑터가 준 필드는 그 tier 로 확정, 안 준 필드는 2층 fallback 실행
- signature check 실패 시 tier 강등 로직

**Files (읽기/수정 대상)**:
- `packages/shared/src/core/jobPosting.ts` (수정 — 어댑터 훅 추가)
- `packages/shared/src/core/jobPosting/adapters/` (신규)
- `packages/shared/src/test/jobPosting.adapter.test.ts` (신규)
- `packages/shared/src/test/jobPosting.goldens.test.ts` (기존 — 변경 없음 기대)

**Test plan**:
- 신규 unit: registry 매칭 우선순위, signature 통과/실패 시 tier 강등
- 기존 6 goldens (jobkorea 3 + greetinghr 2 + wanted 1) 모두 PASS 유지
- fixture 재측정: factual 43.8% **변화 없음** (어댑터 0개이므로)

**Success criteria**:
- 기존 goldens 6건 회귀 0건
- fixture factual 비율 43.8% ± 0.5p
- 신규 unit test 추가 (≥ 8건)

**Implementation note (2026-04-19)**:
- empty registry 기반 SiteAdapter 인프라와 signature downgrade 헬퍼를 추가하고, `jobPosting.ts` 는 URL 경로에서만 어댑터를 조회/병합하도록 연결
- Chunk 0 범위에서는 사이트 구현체를 추가하지 않아 기존 extraction 동작과 goldens 를 그대로 유지

**예상 working day**: 1.5일

---

### Chunk 1 — wanted 어댑터 (인프라 end-to-end 검증)

**Goal**: wanted 를 ATS blacklist 에서 제거 + JSON-LD 를 factual 로 승격하는 어댑터로 전환. blacklist → 어댑터 아키텍처 검증.

**Scope**:
- `adapters/wanted.ts`: `match(url)` = `www.wanted.co.kr` 호스트 + `/wd/\d+` path 또는 JSON-LD 존재
- `extract()`: JSON-LD 파이프라인 결과에 signature check + `adapterTrust: "high"` 마커 부착. fields 는 비거나 JSON-LD 값 passthrough
- `atsBlacklist.ts`: "원티드" 패턴을 "어댑터 매칭 안 됐을 때만 적용" 으로 조건화
- `/company/:id` 경로 → 공고 아닌 회사 페이지 감지 → `expired` 분류 반환 (P0 plan §P2.4 잔여 작업)

**Test plan**:
- 기존 wanted golden 1건 (neptune_h5) factual 유지
- fixture wanted 11건 중 factual 승격 측정: companyName/roleName 이전 `role` → `factual`
- unit: `/company/16049` URL 이 `expired` 반환

**Success criteria**:
- wanted 11건 중 ≥ 9건 `success` 분류 (1건은 `/company/` 페이지 = expired 예외)
- wanted factual 필드 수 (success 기준) companyName/roleName 모두 `factual`
- 전체 factual 비율 ≥ 45% (43.8% + wanted roleName 승격분)
- 기존 goldens 6건 PASS

**예상 working day**: 1일

---

### Chunk 2 — jobkorea / greetinghr 어댑터 정식화

**Goal**: 현재 non-adapter 경로(__NEXT_DATA__ / JSON-LD heuristic)로 우연히 성공 중인 두 사이트를 어댑터로 승격. 구조 변경 시 자동 강등 얻기 위함.

**Scope**:
- `adapters/jobkorea.ts`: `www.jobkorea.co.kr/Recruit/GI_Read/\d+` 매칭. JSON-LD 파이프라인을 기본으로 사용 + signature selector (JobPosting script id 등)
- `adapters/greetinghr.ts`: `*.greetinghr.com/ko/o/\d+` 매칭. 기존 `extractEmbeddedJobPostingSource` 의 `__NEXT_DATA__` getOpeningById 로직을 어댑터로 이전
- `jobPosting.ts` 의 인라인 `extractEmbeddedJobPostingSource` 를 greetinghr 어댑터로 이동 (registry 기반 dispatcher)

**Test plan**:
- 기존 goldens 5건 (jobkorea 3 + greetinghr 2) factual 유지
- fixture: jobkorea 4건 / greetinghr 2건 100% success 유지

**Success criteria**:
- 기존 goldens 5건 PASS + fields 동일
- fixture factual 비율 ≥ 45% (Chunk 1 유지)
- 신규 adapter unit test 각 사이트당 ≥ 3건

**예상 working day**: 1일

---

### Chunk 3 — careerlink / recruiter.co.kr 어댑터

**Goal**: 현재 0% success 인 두 사이트 계열에 전용 어댑터 도입. P0 plan §P2 (careerlink `__NEXT_DATA__`) 흡수.

**Scope**:
- `adapters/careerlink.ts`:
  - `*.careerlink.kr/jobs/RC\d+` 매칭
  - `__NEXT_DATA__` 내 careerlink 고유 queryKey shape 분석 후 detail 추출
  - SSR 부분만 커버 (3건 중 `dongjin` = expired 200 제외)
- `adapters/recruiter.ts`:
  - `*.recruiter.co.kr/(app|career)/jobs?(?:notice)?/view/...` 또는 `jobs/\d+` 매칭
  - 서브도메인 리스트 (hlcompany, midas, glovis, keris, hyundai-wia, wins21, jejubank, kpta, hyundaiweld 등)
  - SSR 된 HTML 로부터 섹션 추출
  - 0 byte body 케이스는 Path A/B 분기: Path A 면 Puppeteer, Path B 면 skip + warning

**Fixture 작업**: 기존 3 (careerlink) + 9 (recruiter) 충분. 추가 수집 불필요.

**Test plan**:
- careerlink __NEXT_DATA__ shape 실측 후 selector 도출
- recruiter 서브도메인별 1~2건 signature 통과 확인
- goldens: careerlink 1건 + recruiter 2건 추가

**Success criteria**:
- careerlink 3건 중 ≥ 2건 `success` (dongjin expired 제외)
- recruiter 9건 중 ≥ 5건 `success` (Path B 기준, SSR 0-body 4건 제외)
- 전체 factual 비율 ≥ 52%
- 신규 goldens 3건

**예상 working day**: 2일

---

### Chunk 4 — 기업 자체 채용 페이지 (kia / posco / lg / corporate 실측 분기)

**Goal**: career.kia.com / recruit.posco.com / careers.lg.com 을 "개별 어댑터 vs 공통 JSON-LD fallback" 중 어느 전략이 유효한지 **실측 결정 후** 구현.

**Scope (전반부 — 결정)**:
- 각 사이트 현재 fixture (kia 6 + posco 3 + lg 1) 의 HTML 구조 재분석
- JSON-LD JobPosting 존재 여부 재확인 (report.md: kia 0%, posco 0%, lg 0% — 근본적으로 JSON-LD 전략 불가 가능성)
- SSR payload 구조 (__NEXT_DATA__ / __NUXT__ / React __INITIAL_STATE__)
- 필요 시 네이버/카카오/삼성 fixture 추가 (사용자 결정 시) — 본 Chunk 에서 2~3건 수집

**Scope (후반부 — 구현)**:
- 결정 A: JSON-LD schema 를 기업 자체 페이지 일부가 쓰면 → 공통 `corporateJsonLd.ts` 어댑터 + 호스트 화이트리스트
- 결정 B: 각자 고유 SSR shape → `adapters/kia.ts`, `adapters/posco.ts`, `adapters/lg.ts` 개별 구현
- 결정 C (혼합): 일부는 A, 일부는 B

**Test plan**:
- fixture 재측정으로 어댑터별 성공률 도출
- goldens: 각 성공 사이트당 1건

**Success criteria**:
- kia 6건 중 ≥ 3건 `success`
- posco 3건 중 ≥ 1건 `success` (3건 다 bodyText 48 이면 Puppeteer 의존 — Path B 기준 skip)
- lg 1건 success (or skip if SPA)
- 전체 factual 비율 ≥ 58%

**예상 working day**: 2.5일 (실측 분기로 가변)

---

### Chunk 5 — jobplanet 어댑터 (사용자 회귀 케이스)

**Goal**: 사용자가 명시적으로 보고한 회귀 케이스 해결. qualifications / preferredQualifications factual 승격 첫 사례.

**Scope (전반부 — fixture 수집 + 구조 분석)**:
- `https://www.jobplanet.co.kr/job/search?posting_ids[]=1318470` 이 search endpoint 인지 detail canonical 인지 확인
- canonical URL 패턴 도출 (예: `/jobs/\d+` 또는 `?posting_ids[]=\d+`)
- `match()` 에 URL normalization 포함 (사용자 입력 어떤 형태든 canonical 로 변환)
- fixture 5~7건 수집 (다양한 업종: IT/영업/디자인/마케팅)
- SSR 여부 검증:
  - SSR O → Path B 안에서 구현 가능
  - SSR X (SPA) → **Puppeteer 의존, Path A 또는 Chunk 6 으로 이동**
- HTML 구조 (posting-title, job_description, qualifications heading 등) selector 설계

**Scope (후반부 — 어댑터)**:
- `adapters/jobplanet.ts`:
  - `match()`: jobplanet 호스트 + posting_ids 파라미터 또는 detail path
  - `canonicalUrl()`: search → detail redirect
  - DOM selector 기반: roleName, companyName, qualifications, preferredQualifications, mainResponsibilities
  - signature selectors: 확정된 DOM anchor 2~3개
- title 태그 파싱 대신 `h1`/`h2.posting-title` 사용 → 사용자 케이스 해결

**Test plan**:
- goldens: jobplanet 2건 (ideal + partial-missing-optional-field)
- unit: URL normalization (search → detail)
- **회귀 테스트**: 사용자 제공 URL `posting_ids[]=1318470` 이 올바른 roleName "Korea Webtoon Data Analyst" 반환 (title garbage 제거)

**Success criteria**:
- jobplanet fixture 5건 중 ≥ 4건 `success`
- jobplanet success 건 중 **qualifications factual ≥ 3건** (qualifications 0% → 승격 첫 사례)
- 사용자 보고 URL 의 roleName 이 title-garbage 아닌 정상값
- 전체 factual 비율 ≥ 62%

**예상 working day**: 2일 (SPA 면 +2일 Puppeteer 의존)

---

### Chunk 6 — SPA 사이트: jumpit / saramin / rememberapp (Path A 전용 or Puppeteer 선행 후)

**⚠️ Precondition**: Open Question 1 에서 Path A (Puppeteer 선행) 또는 별도 Puppeteer chunk 완료 필수.

**Goal**: 정적 fetch 불가 SPA 사이트 3계열 어댑터 도입. 현재 factual 승격의 **가장 큰 수량적 기여처** (jumpit 17건).

**Scope**:
- (사전) P0 §P3b 의 `JobPostingFetcher` 인터페이스 + `PuppeteerFetcher` 구현. 본 plan 범위 밖 — **Open Question 1 결정 시 별도 chunk 또는 선행 plan**
- `adapters/jumpit.ts`: `jumpit.saramin.co.kr/position/\d+` 매칭. Puppeteer 렌더 후 DOM selector
- `adapters/saramin.ts`: `(www|*).saramin.co.kr/zf_user/jobs/...` 및 saramin 계열 서브도메인 (hyundaiweld.saramin.co.kr 등)
- `adapters/rememberapp.ts`: `rememberapp.co.kr/...` — fixture 수집 후 구조 파악

**Test plan**:
- goldens: jumpit 3 + saramin 2 + rememberapp 2 (총 7건)
- Puppeteer feature flag 꺼진 환경에서 graceful degradation

**Success criteria**:
- jumpit 17건 중 ≥ 12건 `success`
- saramin (hyundaiweld 등 포함) ≥ 2건 `success`
- rememberapp fixture 5건 중 ≥ 3건 `success`
- 전체 factual 비율 ≥ 72%

**예상 working day**: 3일 (+ Puppeteer infrastructure 가 별도 완료되어야 함)

---

### Chunk 7 — LinkedIn (취소 — 2026-04-19 사용자 결정)

**Status**: CANCELLED. Q2 답변: "국내 전용으로" → P0 plan §2.3 "국내 전용" 원칙 유지. LinkedIn 어댑터는 본 P2 scope 에서 제외.

---

### Chunk 0.5 — Puppeteer Fetcher 인프라 (Path A 반영)

**Goal**: `JobPostingFetcher` 인터페이스 + `PuppeteerFetcher` 구현. P0 plan §P3b 흡수. Path A 결정(2026-04-19)으로 Chunk 0 직후 선행.

**Scope**:
- `packages/shared/src/core/jobPosting/fetcher/types.ts` — `JobPostingFetcher` 인터페이스 (fetch(url) → { html, status, finalUrl })
- `packages/shared/src/core/jobPosting/fetcher/staticFetcher.ts` — 현재 `fetch()` 경로 분리
- `packages/runner/src/jobPosting/puppeteerFetcher.ts` — runner 에서만 로드 (shared 에는 interface 만)
- Host 화이트리스트 기반 라우팅: SPA 사이트만 Puppeteer, SSR 는 static
- Feature flag: `PUPPETEER_ENABLED` 환경변수 또는 config
- Graceful degradation: Puppeteer 실패 시 static 으로 fallback + warning

**의존성 추가**:
- `puppeteer` (번들 ~150MB, runner 로컬 전용이라 감내 — 사용자 2026-04-19 승인)
- 또는 `puppeteer-core` + 시스템 Chrome (번들 감소, 환경 의존성 증가)

**Test plan**:
- static fetch regression: 기존 모든 goldens 그대로 PASS
- Puppeteer mock test (실제 크롬 안 띄움)
- 실제 SPA fixture 1건 (jumpit 1건) end-to-end

**Success criteria**:
- Puppeteer 환경 활성화 시 jumpit 1건 정상 추출
- Puppeteer 꺼진 환경에서 기존 동작 regression 0
- runner 번들 크기 기록 (baseline 대비 +X MB)

**예상 working day**: 3일

---

### 전체 working day 합산 (Path A — 2026-04-19 확정)

- Chunk 0 (인프라): 1.5일
- Chunk 0.5 (Puppeteer): 3일
- Chunk 1~5: 8.5일 (jobplanet SPA 여도 Puppeteer 있으니 Chunk 5 내 2일 유지)
- Chunk 6 (SPA 본격): 3일 (Puppeteer infra 이미 있으니 어댑터 구현만)
- 버퍼 + 리뷰 + fixture 재측정: +3일
- **총 예상: 19 working days**

---

## 6. 측정 방법 및 게이트

### 6.1 fixture 측정

- 각 Chunk 종료 시 `bun run scripts/fetch-posting-fixtures.ts` (캐시 재파싱) 또는 `--force` (네트워크 재fetch)
- `urls.txt` 확장 원칙:
  - Chunk 5 (jobplanet): +5~7건
  - Chunk 6 (SPA): +jumpit 0 (기존 17 유지) / saramin +3 / rememberapp +5
  - Chunk 4 (corporate): 필요 시 네이버/카카오/삼성 +6
- 수집은 각 Chunk 실행 담당자가 수행. 본 plan 은 수집 URL 카테고리만 지정

### 6.2 factual 비율 게이트 (누적)

| Chunk | 목표 factual 비율 | 필드별 목표 |
|---|---|---|
| 0 | 43.8% (무변화) | 현상 유지 |
| 1 | ≥ 45% | wanted roleName factual 승격 |
| 2 | ≥ 45% (유지) | 회귀 0 |
| 3 | ≥ 52% | careerlink/recruiter mainResponsibilities factual 일부 |
| 4 | ≥ 58% | corporate companyName/roleName factual |
| 5 | ≥ 62% | **qualifications factual ≥ 3건 (첫 사례)** |
| 6 | ≥ 72% | jumpit/saramin 전반 승격 |
| 7 | ≥ 73% (소폭 개선) | LinkedIn |

**최종 목표: 72%+ (Chunk 6 완료 시점)**. 70% 근거:
- wanted 11 + jobkorea 4 + greetinghr 2 + careerlink 2 + recruiter 5 + corporate 5 + jobplanet 4 + jumpit 12 + saramin 2 + rememberapp 3 ≈ 50건 success (75건 중 67%)
- 각 success 건 평균 factual 필드 ≥ 3 (companyName/roleName/mainResponsibilities) → factual 비율 ~70%+
- qualifications factual 이 success 절반 이상이면 추가 +5~8p

### 6.3 goldens 회귀 방지

- 매 Chunk 통과 조건: 기존 goldens PASS + 신규 추가 goldens PASS
- goldens 총 수: 6 (초기) → 20+ (Chunk 7 완료)
- `jobPosting.goldens.test.ts` 에 어댑터별 snapshot 추가

### 6.4 필드별 projection

qualifications 0% → factual 승격 경로:
- jobplanet 어댑터 (Chunk 5): +3~4건
- jumpit 어댑터 (Chunk 6): +5~8건
- saramin 어댑터 (Chunk 6): +1~2건
- corporate (Chunk 4): +2~3건
- **총 기대: success 21건 중 qualifications factual 11~17건 (52~81%)**

preferredQualifications 도 유사 궤적.

---

## 7. 리스크

| 리스크 | 완화 |
|---|---|
| SSR 미지원 사이트 (jumpit/jobplanet/rememberapp/linkedin) — Puppeteer 필수 | Open Question 1 선제 결정. Path B 선택 시 Chunk 6/7 은 의존성 명시. |
| Puppeteer 런타임 비용 (~150MB chromium, ~200MB peak) | P0 §A1 결정대로 runner local only. 서버 배포 영향 없음. |
| 사이트 HTML 구조 변경 → 어댑터 silent failure → factual garbage | A4 signature check + golden test 회귀 보호. 실패 시 자동 tier 강등. |
| 레이트 리미트 / CAPTCHA / 봇 차단 (jumpit/linkedin 특히) | 호스트 화이트리스트 + 사용자당 요청 제한 + warning UI |
| JSON-LD schema 미준수 (jobplanet, kia 등) | 어댑터가 DOM selector 기반으로 대체 경로 제공. 공통 JSON-LD fallback 은 2층으로 유지. |
| 법적 고려 (robots.txt, TOS) | P0 §P3b 의 robots.txt 준수 레이어 재사용. LinkedIn 은 Open Question 으로 격리. |
| 어댑터 증식으로 인한 유지보수 부담 | Chunk 별 fixture + goldens 로 회귀 자동 포착. 사이트 구조 변경 시 goldens 가 먼저 깨져서 알림. |
| fixture 수집 네트워크 예산 | 사이트당 5~10건 상한, append-only, 중복 URL 은 기존 dedupe 로직 재사용 |
| 기존 `companyHostnames.ts` staging 정책과 어댑터 중복 | 어댑터 도입 시 hostname hint 기능을 어댑터 내부로 흡수, `HOSTNAME_COMPANY_HINTS` 는 deprecated 마커 |
| P0 의 lowConfidence guard (runner) 가 어댑터 변경 인지 못 함 | Chunk 0 에서 `fieldSources` 머지 경로만 변경, guard 로직은 동일 (factual 여부만 봄) → 자동 호환 |

---

## 8. Decisions Confirmed (2026-04-19)

모든 Open Questions 사용자 확정. 아래 결정은 본 plan 의 확정된 근거.

| Q | 결정 | 반영 위치 |
|---|---|---|
| Q1 Puppeteer | **도입 = Path A** — Chunk 0.5 로 선행 | §5 Chunk 0.5 신설 |
| Q2 LinkedIn | **국내 전용** — Chunk 7 취소 | §5 Chunk 7 cancelled |
| Q3 ATS blacklist | **3층 구조 유지** | §3 A2 유지 |
| Q4 corporate | **실측 기반 혼합 (C)** | §5 Chunk 4 |
| Q5 per-field tier | **adapter-declared** | §3 A3 유지 |
| Q6 signature 실패 | **tier 강등 + warning** | §3 A4 유지 |
| Q7 fixture 수집 | **사이트당 5~10건** | §4.2 유지 |
| Q8 fringe 사이트 | **Chunk 4 (corporate/other) 에 합류** | §5 Chunk 4 |

### 원본 질문 (참고용)

### Q1. Puppeteer 선행 여부 — Path A vs Path B

- **Path A**: Chunk 0 직후 Puppeteer infrastructure (P0 §P3b) 선행. 모든 Chunk 에서 SPA 사이트 가능. 초반 3일 리스크 집중.
- **Path B (본 plan 기본)**: SSR 가능 사이트 먼저 (Chunk 1~5). SPA 사이트(jumpit/rememberapp/jobplanet 가능성)는 Chunk 6 까지 대기. Puppeteer 도입은 Chunk 6 진입 전 별도 chunk 또는 선행 plan.
- **현재 P0 plan 상태**: §P3b "사용자 승인 대기 (Puppeteer 번들 ~150MB)"

질문: **Path A vs B 어느 쪽?** 또는 Puppeteer 번들 OK 여부만이라도 확답.

### Q2. LinkedIn 포함 여부 — 국내 전용 원칙 충돌

P0 plan §2.3 "국내 전용" 명시. LinkedIn 은 해외. 본 plan Chunk 7 은 조건부.

질문: **LinkedIn 어댑터 추가 OK?** No 면 Chunk 7 삭제.

### Q3. ATS 블랙리스트 정책

본 plan 제안: **3층 구조 유지** (어댑터 → JSON-LD → blacklist fallback). 완전 폐기 시 신규/알려지지 않은 사이트의 title-garbage 가 role tier 가드 없이 올라감.

질문: **3층 구조 OK?** 완전 폐기를 원하면 warning-only 로 대체하는 대안 가능.

### Q4. 기업 자체 채용 페이지 — 개별 vs 공통

Chunk 4 에서 실측 후 결정 예정. 사전 선호도 있으면 지정.

질문: **kia/posco/lg/(네이버/카카오/삼성) 전략 선호?**
- A: 공통 JSON-LD fallback 만 (어댑터 없음)
- B: 개별 어댑터 (사이트마다)
- C: 실측 기반 혼합 (**기본값**)

### Q5. 어댑터 per-field tier 정책

본 plan: **adapter-declared** (어댑터가 필드별로 factual/contextual/role 방출).

대안: **factual 고정** (어댑터 매칭 = 모든 필드 factual). 구현 단순하지만 brittle.

질문: **adapter-declared OK?**

### Q6. Signature check 실패 시 동작

본 plan: **모든 어댑터 필드 tier 한 단계 강등** + warning.

대안 A: 어댑터 결과 전체 폐기 + 2층 fallback
대안 B: 경고만 + tier 그대로 유지

질문: **강등 전략 OK?**

### Q7. fixture 수집 URL 수

본 plan: 사이트당 5~10건.

질문: **5건 vs 10건 vs 다른 값?** 네트워크 예산 우선순위.

### Q8 (보조). 추가 사이트

메이저 공고 사이트 중 본 plan 에 없는데 추가해야 할 곳?
- 잡플래닛 ✓
- 인크루트 (incruit.com) — 기존 fixture 1건 (IBK캐피탈)
- 한화인 (hanwhain.com) — 기존 fixture 2건
- 스카우트 (scout.co.kr) — 기존 fixture 1건
- 미래에셋커리어 (career.miraeasset.com) — 기존 fixture 1건
- notion.site 공고 — 기존 fixture 1건 (디지털대성)
- pearlabyss.com — 기존 fixture 1건

질문: **위 fringe 사이트들 Chunk 4 (corporate/other_corporate) 에 포함 or 별도 Chunk?**

---

## 9. 추적 링크

- P0 완료 plan: `docs/plans/completed_plans/2026-04-17-posting-parser-p0-field-confidence.md`
- P1 완료 plan: `docs/plans/completed_plans/2026-04-19-posting-parser-p1-jsonld.md`
- P0 handoff: `docs/plans/2026-04-19-posting-parser-p0-p1-handoff.md`
- P0 master plan (본 plan 이 §P2/§P3/§P4 흡수): `docs/plans/2026-04-17-posting-parser-refactor.md`
- fixture 결과: `docs/plans/2026-04-17-posting-parser-fixtures/results.json`
- fixture 리포트: `docs/plans/2026-04-17-posting-parser-fixtures/report.md`
- fixture URL 소스: `docs/plans/2026-04-17-posting-parser-fixtures/urls.txt`
- 현재 파서 엔트리: `packages/shared/src/core/jobPosting.ts`
- 현재 JSON-LD 모듈: `packages/shared/src/core/jobPosting/jsonLd.ts`
- 현재 cross-validate: `packages/shared/src/core/jobPosting/crossValidate.ts`
- 현재 ATS blacklist: `packages/shared/src/core/atsBlacklist.ts`
- 현재 hostname hints (staging): `packages/shared/src/core/jobPosting/companyHostnames.ts`
- 런타임 가드 (lowConfidenceExtraction): `packages/runner/src/routes/insightsHandlers.ts`
- 기존 goldens: `packages/shared/src/test/goldens/posting/`
- fixture 측정 스크립트: `scripts/fetch-posting-fixtures.ts`
