# 2026-07-04 — DART 사업보고서 원문 RAG (문항별 근거 검색)

**Status:** draft (미해결 질문 §7 사용자 확정 대기)
**Scope:** OpenDART 공시서류 원문(document.xml)을 청킹·임베딩해 서버 공유 인덱스로 만들고, 자소서 run 시작 시 문항 기반 검색 결과를 드래프터/리뷰어 프롬프트에 근거 블록으로 주입한다.
**Driving data:** 없음 — P0이 recon 역할을 겸한다. P0 산출물(`services/filings-retrieval/eval/fixtures/`의 results.json/report.md)이 이후 스테이지의 driving data가 된다.
**Precedents:** [2026-04-17 posting-parser-refactor](./2026-04-17-posting-parser-refactor.md) (fixture 게이트 방법론), [2026-04-09 convergence-quality-improvements](./completed_plans/2026-04-09-convergence-quality-improvements.md) (테스트-우선 오케스트레이터 변경)

> 적대적 검증 이력: 초안을 3개 렌즈(코드 사실 대조 / 관례 적합성 / 실현성)로 비판 검증해 critical 1·major 8·minor 다수를 반영함 (2026-07-04). 주요 반영: 인덱싱 처리량 게이트 신설, [DART:] 인용 마커 제거, 게이트웨이 per-run 주입, A/B를 드래프터 턴 단위 오프라인 평가로 재설계.

---

## 1. 배경

### 현 상태

- DART 연동은 정형 필드 3종만 사용한다: `corpCode.xml`(회사명 해석), `company.json`(회사개황), `fnlttSinglAcntAll.json`(재무제표 수치) — `packages/shared/src/core/openDart.ts:131-219`. **사업보고서 원문(document.xml)은 미사용.**
- 회사 인사이트는 인사이트 생성 시점에 question-agnostic으로 1회 합성되어(`packages/shared/src/core/insights.ts:43-102`) pinned 프로젝트 문서로 저장되고, ContextCompiler가 `## Project Context`에 실어 나른다(`packages/shared/src/core/contextCompiler.ts:118-161`). 요약은 손실 압축이라 특정 문항("신사업 기여 방안" 등)에 필요한 디테일이 요약 단계에서 소실된다.
- 자소서에 실제로 필요한 정성 서사(사업의 내용, 신규 사업, 연구개발활동, 리스크 요인)는 사업보고서 원문에만 있고, 수백 페이지라 "전체 주입" 패턴으로는 사용 불가능하다.

### 문제 치환

"초안에 회사 특이적 근거가 부족하다"를 다음의 측정 가능한 문제로 치환한다:

1. **수집/파싱** (P0): 임의 상장사의 최신 사업보고서 원문을 섹션 트리로 파싱할 수 있는가 → 텍스트 수용률·섹션 식별 수·트리 깊이로 측정.
2. **검색 품질** (P1): 문항 텍스트로 관련 섹션 청크를 찾을 수 있는가 → 라벨셋 recall@5(신뢰구간 포함) / 형태소 BM25 베이스라인 대비.
3. **인덱싱 처리량** (P1): 서버(ARM 4코어 공유)에서 회사당 time-to-ready가 운영 가능한 수준인가.
4. **제품 효과** (P3): 근거 주입이 초안의 grounded-claim 수/비율을 올리는가 → 드래프터 턴 단위 paired A/B.

---

## 2. 설계 원칙

1. **ship → measure → decide**: 각 스테이지는 fixture/라벨셋 재측정 수치 게이트를 통과해야 다음으로 진행한다 (posting-parser 방법론 답습).
2. **기존 통로 재사용**: 주입은 Notion 프리패스 선례(run 시작 1회 리서치 → 프로필별 압축 → 프롬프트 블록 주입, `packages/shared/src/core/orchestrator.ts:372-412`)를 따른다. 새 주입 채널을 발명하지 않는다.
3. **compiled-context 불가침**: 검색 결과는 compiled context에 끼워 넣지 않는다(캐시 키 `${profile}::${draft}` 파손 방지, `orchestrator.ts:465-466`). notionBrief처럼 프롬프트 빌더의 별도 파라미터로 전달한다.
4. **조용한 실패 금지**: 인덱스 미준비/서비스 다운/키 부재 시 run은 기존 동작으로 진행하되, 상태를 notices로 명시 전파한다 (DART 키 조용한 스킵 갭의 재발 방지).
5. **서버 단일키 모델 유지**: DART_API_KEY는 서버 env 소유. 사용자 키 UI를 재도입하지 않는다.
6. **최종 산출물 무오염**: 검색 근거는 초안 본문에 인용 마커를 남기지 않는다. 드래프터 출력 규칙("no labels" — `packages/shared/src/core/orchestrator/prompts/deepFeedbackPrompts.ts:163`, "Korean essay prose only" — `orchestrator/prompts/realtimePrompts.ts:730`)과 charLimit(`contextCompiler.ts:110`)을 침범하지 않는다.
7. **plane 정합**: 신규 최상위 `services/`는 현 plane 표(CLAUDE.md, `docs/development/ARCHITECTURE.md`)에 없다 → P0에서 CLAUDE.md·AGENTS.md·ARCHITECTURE.md의 plane 정의에 `services/**`(Product; 단 `services/*/eval/**`은 하네스 성격)를 등재하는 문서 갱신을 포함한다.

---

## 3. 아키텍처 결정

### A1. 인덱스는 서버 공유 (러너 로컬 아님)

사업보고서 코퍼스는 회사 단위·사용자 무관 데이터다. 러너 로컬(사용자 Windows 머신)에 두면 (a) 사용자마다 임베딩 수단(모델 배포 또는 API 키)이 필요하고, (b) 같은 회사를 사용자마다 중복 인덱싱하며(DART 쿼터 낭비), (c) 머신 변경 시 재구축된다. OCI 서버(ARM64 4코어 공유, RAM 18Gi 가용, 디스크 62G 여유)에 1회 인덱싱해 전 사용자가 공유한다.

### A2. 검색 서비스 = Python FastAPI 컨테이너 `filings-retrieval`

- 담당: document.xml 수집 → XML 파싱·섹션 분리·청킹 → 임베딩 → 인덱스 저장 → 검색 API.
- 배포: `docker-compose.dev.yml`에 service 블록 추가 (backend와 동일 네트워크, 외부 미노출 — nginx 변경 불필요). env는 루트 `.env.dev`의 `DART_API_KEY` 재사용 + 내부 호출 보호용 `FILINGS_SERVICE_TOKEN`(공유 시크릿 헤더) 신설.
- **빌드 비용**: deploy가 `build --no-cache`이므로 PyTorch aarch64 휠 재설치가 매 배포에 반복된다 → 의존성을 미리 구운 베이스 이미지(별도 태그, 의존성 변경 시에만 재빌드)를 `FROM`으로 사용. 모델 가중치는 named volume + 기동 시 다운로드.
- **동시성**: `/ensure`는 장시간 CPU 작업 → corpCode 단위 락 + 단일 인덱싱 워커 큐(동시 1건). compose `cpus` 제한으로 backend 보호.
- ARM64 네이티브 빌드 필수 (backend Dockerfile의 multi-arch 선례).

### A3. 벡터 저장 = 서비스 내장 SQLite (pgvector 아님, v1 한정)

현 postgres:16-alpine에는 pgvector가 없고, 이미지 교체(pgvector/pgvector:pg16)는 alpine→debian collation 차이로 기존 볼륨 호환 리스크가 있다. v1은 검색 서비스가 자체 SQLite 파일(named volume)에 청크+벡터를 소유해 기존 DB를 건드리지 않는다.

- 검색은 회사 단위 파티션(청크 수백 개)이므로 brute-force 코사인으로 충분하다. sqlite-vec은 pre-1.0(유지보수 공백 이력)이라 **numpy brute-force를 기본**, sqlite-vec은 선택 최적화로 둔다.
- 스키마에 `embedding_model`, `chunker_version` 컬럼 포함. 모델/청커 변경 시 해당 인덱스를 `absent`로 강등해 재인덱싱한다 (차원 불일치 사고 방지).
- **최신성 TTL**: `ready`여도 30일 경과 시 ensure가 list.json을 재조회 → 신규 rcept_no(연차 갱신·기재정정) 발견 시 재인덱싱.

### A4. 데이터 흐름

```
[인덱싱]  insightsHandlers (러너, corpCode 확정 직후 — packages/runner/src/routes/insightsHandlers.ts:201-209)
            └─ POST /api/runner/filings/ensure {corpCode}     (러너→백엔드 HTTP, deviceToken Bearer — runnerDartKey.ts:32-58 선례)
                 └─ backend → http://filings-retrieval:8100/ensure   (내부 프록시, FILINGS_SERVICE_TOKEN 헤더)
                      └─ service: list.json?pblntf_ty=A&pblntf_detail_ty=A001&last_reprt_at=Y 로 최신 사업보고서 rcept_no 조회
                         → document.xml zip 수신 → 파싱·청킹·임베딩 → SQLite 저장
                         → 상태: absent | indexing | ready | failed

[검색]    ReviewOrchestrator.run 시작 시 1회 (러너 프로세스 내부, Notion 프리패스와 같은 위치)
            └─ FilingsEvidenceGateway.search({corpCode, queries, topK})
                 └─ POST /api/runner/filings/search (러너→백엔드→service)
            └─ status=absent이면 ensure를 fire-and-forget으로 kick (기존 프로젝트 백필 — 다음 run부터 ready)
            └─ 결과를 run 아티팩트 filings-evidence.json으로 저장 (notion-brief.md 선례)
            └─ 프롬프트 빌더에 별도 파라미터로 전달
```

- **게이트웨이 주입 시점 (초안 검증에서 정정)**: backendUrl/deviceToken은 러너 부팅 시가 아니라 백엔드 연결별 hostedCtx에 존재하고(`packages/runner/src/index.ts:184`), `JASOJEON_BACKEND_URLS`로 다중 백엔드가 가능하다(`index.ts:26`). 따라서 게이트웨이는 runnerContext 생성 시가 아니라 **run을 dispatch한 백엔드의 hostedCtx로 runsHandlers에서 per-run 생성**해 `orchestrator.run`의 신규 옵션 파라미터로 전달한다(`packages/runner/src/routes/runsHandlers.ts:412`의 호출부 시그니처 변경). 검색 인덱스는 항상 해당 run을 중계한 백엔드의 것을 쓴다.
- 쿼리 구성(v1, 결정론적): `request.question` 전문 + `question + roleName` 2건, LLM 쿼리 플래닝은 P4.
- 백엔드 라우트 `packages/backend/src/routes/runnerFilings.ts` 신규: 단순 프록시. `FILINGS_SERVICE_URL` env는 **optional로 추가**(EnvSchema는 required 키 누락 시 loadEnv throw — `packages/backend/src/env.ts:21-30`), 미설정 시 501 응답으로 백엔드 부팅 무영향. compose의 backend `environment` 블록은 명시 나열식이므로 `FILINGS_SERVICE_URL`·`FILINGS_SERVICE_TOKEN` 매핑 추가 필요.
- 검색은 러너→백엔드 방향 HTTP이므로 DeviceHub RPC 30초 타임아웃과 무관. 러너 측 타임아웃 5초, 실패 시 근거 블록 없이 진행 + notices.

### A5. 프롬프트 주입 = "Available Evidence" 지위 부여, 인용 마커 없음

드래프터에는 "brief/ledger 밖 증거 발명 금지" 지시가 강하므로(`orchestrator/prompts/deepFeedbackPrompts.ts:161`, `orchestrator/prompts/realtimePrompts.ts:728`) 블록 헤더에서 근거 지위를 명시적으로 부여한다. **초안 본문에 인용 마커를 요구하지 않는다** (원칙 6 — 드래프터 출력 규칙과의 충돌 및 최종 초안 오염 방지):

```
## Company Filings Evidence (DART)
아래는 {회사명} {reportName}에서 발췌한 실제 공시 내용이다. Available Evidence로 취급하라.
[드래프터] 회사 관련 서술은 이 블록의 사실 범위 안에서, 인용 표식 없이 자연스럽게 녹여 써라.
          이 블록에 없는 회사 사실을 발명하지 마라.
[리뷰어]   초안의 회사 특이적 주장을 이 블록과 대조해, 근거 없는/과장된 주장을 지적하라.

### [1] II. 사업의 내용 > 7. 신규 사업 (score 0.83)
{청크 본문}
```

- 주입 지점 (notionBrief 파라미터 패턴 답습):
  - deep 드래프터 `buildSectionDrafterPrompt` (`orchestrator.ts:661-667`) — **top-6 청크 × ≤800자, 블록 총 ≤5,500자** (P3 예산 게이트와 정합하도록 사전 확정; 상한 변경은 A/B 재측정 조건)
  - deep 리뷰어 `buildDeepReviewerPrompt` sections 배열 (`orchestrator/prompts/deepFeedbackPrompts.ts:213-249`) — evidence(technical) 렌즈에 대조 지시
  - realtime 드래프터 `buildRealtimeSectionDrafterPrompt` (`orchestrator.ts:1228-1236`) — compact 압축 (≤2,500자)
  - realtime 리뷰어 `buildRealtimeReviewerPrompt` — minimal 프로필이므로 ≤1,200자 상한
- 프로필별 압축은 `compressNotionBrief`(`orchestrator/notionRequest.ts:43-79`) 패턴의 `compressFilingsEvidence`로.
- tier: 청크는 factual (사업보고서 공시) — 기존 taxonomy(`companyInsightArtifacts.ts:101-126`) 정합.
- `PromptMetrics`에 `filingsEvidenceChars` 필드 추가 (`orchestrator/prompts/promptBlocks.ts:55-66`).

### A6. feature flag

- 러너: env `FILINGS_RAG_ENABLED`, **기본 false** (`runnerContext.ts:122`의 `PUPPETEER_ENABLED` 선례). plan-구현 간 이름/기본값 드리프트 금지 — 이 이름 그대로 구현한다.
- 미상장/corpCode 미확정 프로젝트: 검색 자체를 스킵, 기존 동작과 완전 동일.

### A7. 인덱싱 범위 = 서술 섹션 한정

재무제표 본문·감사보고서 첨부는 인덱싱하지 않는다 (수치는 기존 `fnlttSinglAcntAll` 정형 API가 이미 커버). 대상은 서술 대분류(회사의 개요, 사업의 내용 전체, 이사의 경영진단 등)로 한정해 회사당 청크 수를 수천→수백 규모로 줄인다 — ARM CPU 인덱싱 처리량(P1 게이트)의 1차 완화책.

### 공유 인터페이스 스케치 (`packages/shared/src/core/filingsEvidence/types.ts`)

```ts
export interface FilingsSearchRequest {
  readonly corpCode: string;
  readonly queries: readonly string[];
  readonly topK: number;
}

export interface FilingsChunk {
  readonly rceptNo: string;
  readonly reportName: string;      // 예: "사업보고서 (2025.12)"
  readonly sectionPath: readonly string[]; // 예: ["II. 사업의 내용", "7. 신규 사업"]
  readonly text: string;
  readonly score: number;
}

export type FilingsIndexStatus = "absent" | "indexing" | "ready" | "failed" | "unavailable";

export interface FilingsSearchResult {
  readonly status: FilingsIndexStatus;
  readonly chunks: readonly FilingsChunk[];
  readonly notices: readonly string[];
}

export interface FilingsEvidenceGateway {
  ensureIndexed(corpCode: string): Promise<FilingsIndexStatus>;
  search(request: FilingsSearchRequest): Promise<FilingsSearchResult>;
}
```

shared는 인터페이스만 정의하고, 러너가 hostedCtx 기반 HTTP 구현체를 per-run 주입한다 (A4).

---

## 4. 스테이지

### P0 — 수집·파싱 recon (Python, 서비스 단독)

**목표**: 상장사 20곳(KOSPI 대형 8 / KOSDAQ 중견 6 / 금융 3 / IT·플랫폼 3)의 최신 사업보고서를 원문으로 받아 섹션 트리로 파싱한다.

**작업**:
1. `services/filings-retrieval/` 스캐폴드 (FastAPI 없이 파이프라인 모듈 + 평가 스크립트 먼저) + **plane 문서 갱신**(원칙 7: CLAUDE.md·AGENTS.md·ARCHITECTURE.md에 services/** 등재) + **.gitignore 갱신** (`services/filings-retrieval/eval/fixtures/raw/`, `__pycache__/`, `*.pyc`, `.venv/`, `.pytest_cache/` — 모델·인덱스는 named volume이라 리포 밖).
2. `list.json?pblntf_ty=A&pblntf_detail_ty=A001&last_reprt_at=Y`로 최신 사업보고서 rcept_no 조회([기재정정] 정정본 우선 규칙 포함) → `document.xml` zip 수신 → 인코딩(EUC-KR/UTF-8 혼재)·다중 파일·비정형 XML(미이스케이프 엔티티 → 복구 파싱) 처리 → 섹션 트리 파싱 → A7 범위로 청킹(섹션 경로 메타 + 500~800자, 표는 행 단위 직렬화).
3. fixture 하니스: `eval/fetch_fixtures.py` — corp 목록은 `eval/fixtures/corps.txt`(메타 코멘트 포맷은 posting `urls.txt` 관례), 원문 zip/XML은 gitignore, `results.json` + `report.md`는 커밋. **경로는 서비스 디렉토리 내 고정** — plan 날짜 디렉토리 하드코딩 함정(posting 스크립트 파손 전례) 회피.
4. 파싱 골든: 소형 회사 2곳의 섹션 트리 스냅샷을 `eval/goldens/`에 커밋 (pytest).

**게이트** (조작적 정의 — results.json에 회사별 기록, report.md에서 판정):
- 20곳 중 ≥18곳에서: 원문 텍스트의 ≥90%가 청크에 수용 && 대분류 섹션 ≥5개 식별 && 섹션 트리 깊이 ≥2
- "사업의 내용" 대분류는 파싱 성공 건 전부에서 식별
- 통과하면 P1.

**위험**: DART 원문 XML 스키마 편차(회사·연도별), zip 내 다중 문서, 일일 쿼터(fixture 수집 throttle 2초/건).

### P1 — 인덱싱·검색 품질 + 처리량

**목표**: 검색이 라벨셋 기준을 통과하고, 형태소 BM25 베이스라인을 이기고, 서버에서 인덱싱이 운영 가능한 속도로 돈다.

**작업**:
1. 임베딩 2후보 벤치: `BAAI/bge-m3` vs `intfloat/multilingual-e5-small`. **품질 평가는 개발 머신에서, 지연·처리량은 서버에서 실측** (서버 4코어로 2모델×20사 전량 임베딩은 시간상 불가할 수 있음). ONNX int8 양자화 + batch 추론을 1급 완화책으로 함께 벤치.
2. 라벨셋: **100개 이상** (회사, 실전형 문항) 쌍에 관련 섹션 경로를 주석(LLM 초벌 + 사람 검수) → `eval/labeled_queries.json` 커밋. **hit 정의: 라벨된 섹션 경로에 속한 청크가 top-5 내 1개 이상.**
3. BM25 베이스라인은 **kiwipiepy 형태소 토크나이즈** 적용 (조사·복합명사 붕괴로 인한 허수아비 비교 방지). 동일 라벨셋 paired 비교.
4. 인덱스(A3 스키마) + 검색 구현, `eval/run_eval.py`가 recall@5(95% CI 포함) / MRR / 지연을 `report.md`로 재생성. 지연은 쿼리당 10회 반복(총 1,000+ 샘플)으로 p95 산출.

**게이트**:
- 선택 모델 recall@5 점추정 ≥ 0.80 **및 95% CI 하한 ≥ 0.70**
- paired 비교에서 BM25 대비 recall@5 우위 (동률이면 dense 채택 근거 재검토)
- 단건 쿼리 p95 < 1.0s (서버, WAN 마진 확보용으로 초안 1.5s에서 강화)
- **인덱싱 처리량: 회사당 time-to-ready ≤ 30분 (서버 실측, A7 범위 기준)** — 미달 시 e5-small/int8/배치 크기로 재측정, 그래도 미달이면 아키텍처 재논의(외부 임베딩 API 등, §7 Q2)
- 통과하면 P2.

**위험**: ARM CPU에서 bge-m3 추론 지연·처리량(A7 범위 축소 + int8로 완화, 그래도 병목이면 e5-small), 한국어 공시 문체와 다국어 모델의 정합.

### P2 — 배포·연동 (백엔드 프록시 + 러너 게이트웨이)

**목표**: dev 서버에 서비스가 뜨고, 러너가 인덱싱 트리거·검색 round-trip에 성공한다.

**작업**:
1. FastAPI 서비스화 (`/ensure`, `/search`, `/status`, 공유 시크릿 검증, corpCode 락+단일 워커 큐) + Dockerfile(의존성 베이스 이미지 분리, arm64) + `docker-compose.dev.yml` service 블록·backend environment 매핑(`FILINGS_SERVICE_URL`, `FILINGS_SERVICE_TOKEN`)·named volume + **aarch64 컨테이너에서 로드·검색 스모크 테스트**.
2. 백엔드 프록시 라우트 `runnerFilings.ts` (deviceToken 인증, optional env, 미설정 시 501).
3. 러너 `FilingsEvidenceGateway` HTTP 구현(hostedCtx per-run 생성) + `FILINGS_RAG_ENABLED` flag + `insightsHandlers` corpCode 확정 직후 fire-and-forget ensure + **search 시 status=absent이면 ensure kick** (기존 프로젝트 백필).
4. 실패 분류: 서비스 에러는 `classifyInsightFailure` 규약(원문은 로그, UI에는 분류 메시지)을 따른다.
5. 서비스 pytest 게이트: `scripts/check-filings.sh` 신설(조용한 skip 없음 — python 부재 시 명시 실패). `check.sh`는 TS-only 유지. **CI(test.yml)에 Python 셋업 + pytest job 추가로 PR 게이트에서는 무조건 실행.** OPERATING_RULES.md 커버리지 목록 갱신 포함.

**게이트**: dev에서 회사 1곳 ensure → ready (P1 처리량 상한 내), 러너(사용자 로컬)에서 검색 round-trip < 3s (WAN 왕복 포함 예산), `./scripts/check.sh` + `./scripts/check-filings.sh` + CI 통과, 기존 posting/인사이트 golden 무회귀. 통과하면 P3.

**위험**: 4코어 공유 — compose `cpus` 제한. deploy 시간 증가 — 베이스 이미지 분리로 완화.

### P3 — 오케스트레이터 주입 + 드래프터 턴 A/B

**목표**: 근거 블록이 초안의 grounded-claim을 올리고, 수렴 품질을 해치지 않는다.

**작업**:
1. (TDD) `orchestrator.test.ts`에 실패 테스트 먼저: gateway 주입 시 드래프터/리뷰어 프롬프트에 블록 포함, 미주입·flag off·status!=ready 시 미포함 + notices, 초안 본문에 마커 부재.
2. run 시작 1회 검색 + `filings-evidence.json` 아티팩트 + `compressFilingsEvidence` + 4개 빌더 파라미터 배선 + `filingsEvidenceChars` 계측.
3. **A/B는 드래프터 턴 단위 오프라인 평가로 격리** (full-run A/B는 LLM 비결정성·클러스터 효과·비용으로 검정력 부족 — 초안 검증 지적 반영): `scripts/eval-filings-ab.ts`가 실제 프롬프트 빌더를 재사용해(posting fixture 하니스가 실제 파서를 재사용하는 선례) 동일 (회사, 문항) × {블록 有/無} 드래프터 턴을 provider CLI로 실행. 5사 × 10문항 × 반복 3 = 300 턴.
4. 판정(비맹검·환각인용 편향 제거): LLM judge에 초안과 **해당 회사의 검색 청크 원문**을 함께 제공, 회사 특이적 주장별로 "청크로 뒷받침되는가"를 채점(마커 없음 → 자연 blind). grounded 주장 **절대 수와 비율을 병행 보고**, 사람 검수는 표본 20%.
5. 통합 스모크: flag on full-run 3사×3문항 — BLOCK/REVISE 분포·prompt-metrics·마커 오염을 관찰(통계 판정 아님 — 표본상 무리, 관찰 항목으로만).

**게이트**:
- 드래프터 턴 paired 비교(Wilcoxon signed-rank)에서 grounded 주장 수 증가 p < 0.05 & 중앙값 개선
- 프롬프트 예산 상한 준수 (A5 확정치 — deep 드래프터 블록 ≤5,500자, realtime 리뷰어 ≤1,200자; 변경 시 A/B 재측정)
- 통합 스모크에서 초안 마커 오염 0건, BLOCK 급증 등 이상 징후 없음
- 통과하면 P4 진입 여부 논의.

**위험**: 드래프터가 블록을 무시(지시 충돌) — A5 지위 부여로 완화, A/B에서 검출. judge 채점 신뢰도 — 사람 검수 20%로 캘리브레이션.

### P4 — 에이전틱 재검색 (조건부, 기본 비범위)

**목표**: 단발 검색의 miss를 LLM 쿼리 플래닝 + 충분성 루프로 줄인다.

**작업**: researcher 프리패스 확장(검색 쿼리 생성 → 결과 충분성 자평 → 재질의 ≤2회), coordinator의 미사용 옵션 `Next Owner: context_researcher`(`orchestrator/prompts/deepFeedbackPrompts.ts:281` — 현재 루프가 재호출하지 않는 dead 경로) 활성화로 섹션 전환 시 재검색.

**게이트**: P3 대비 grounded 주장 수 추가 개선 & run 시작 지연 +≤20s. **진입 조건**: P3 게이트 통과 + 사용자 승인.

---

## 5. Regression Goldens

- 기존 `goldens/posting/` 6쌍 + 인사이트 플로우: 매 스테이지 must-not-break (P2 게이트에 포함).
- 신규 파싱 골든은 `services/filings-retrieval/eval/goldens/`에 격리 — 기존 posting golden 테스트의 디렉토리 자동 로드(`jobPosting.goldens.test.ts:25`)와 간섭 없음.
- P3 완료 시 A/B 대조 턴의 `filings-evidence.json` 1건을 주입 회귀 fixture로 동결.

## 6. 측정 도구

| 도구 | 위치 | 재실행 |
|------|------|--------|
| 원문 수집·파싱 fixture | `services/filings-retrieval/eval/fetch_fixtures.py` | 스테이지 종료마다 `--force`, report.md 전량 재생성 |
| 검색 품질·처리량 평가 | `services/filings-retrieval/eval/run_eval.py` | 라벨셋 append-only, 모델/청킹 변경 시 재실행 |
| 드래프터 턴 A/B | `scripts/eval-filings-ab.ts` | P3, 프롬프트 블록/예산 변경 시 |
| 프롬프트 예산 | 기존 `prompt-metrics.json` + `filingsEvidenceChars` | P3 스모크 run마다 |
| TS 게이트 | `./scripts/check.sh` (변경 없음, TS-only) | 매 변경 |
| Python 게이트 | `./scripts/check-filings.sh` (신설, 명시 실패) + CI pytest job | services/ 변경마다, PR 게이트 |

## 7. 미해결 질문 (사용자 확인 필요)

1. **인덱스 위치**: 서버 공유 인덱스 + Python 컨테이너(A1/A2 제안) 승인? 대안은 러너 로컬(사용자별 임베딩 수단 필요 — 비권장).
2. **임베딩 모델**: P1 벤치로 bge-m3 vs e5-small 결정(제안). ARM CPU 처리량이 둘 다 미달하면 외부 임베딩 API 허용 여부? (새 키·비용 발생)
3. **벡터 저장**: 서비스 내장 SQLite + numpy brute-force(A3 제안) vs pgvector 이미지 교체(볼륨 호환 리스크 감수)?
4. **인덱싱 대상**: 최신 사업보고서(A001) 1개년, 서술 섹션 한정(A7 제안) 동의? vs 반기·분기 포함 / 복수 연도?
5. **P4 에이전틱 재검색**: v1 비범위(제안) 동의?
6. **prod 미러링**: dev 전용 시작(제안, prod는 휴면) 동의?
7. **웹 UI 인덱싱 상태 표시**: v1 비범위(제안) — notices 텍스트로만 노출?

확정 시 Status를 confirmed로 갱신하고 날짜 박힌 `Decisions Confirmed` 섹션을 추가한다 (p2-major-adapters plan 관례).

## 8. 위험 / 롤백

| 위험 | 완화 | 롤백 |
|------|------|------|
| 검색 서비스 다운/미배포 | 러너 5초 타임아웃, 근거 블록 없이 진행 + notices | `FILINGS_RAG_ENABLED=false` |
| ARM CPU 인덱싱 처리량 부족 | A7 범위 축소 + int8/batch, P1 처리량 게이트로 선검증 | e5-small 강등 (인덱스 재구축 절차는 A3 버전 필드로 통제) |
| DART 일일 쿼터 소진 | rcept_no 단위 원문 캐시 + 30일 TTL 재조회, fixture throttle | ensure 중단, 기존 인덱스로 서빙 |
| 프롬프트 예산 초과(특히 realtime minimal) | 프로필별 압축 + 문자 상한 + filingsEvidenceChars 계측 | 블록 주입 대상에서 realtime 리뷰어 제외 |
| 드래프터가 블록 무시 / 초안 마커 오염 | A5 지위 부여·마커 금지 설계, P3 A/B·스모크로 검출 | 블록 문구 반복 개선 (게이트 재측정) |
| 원문 XML 스키마 편차·비정형 XML | P0 fixture 20곳 + 복구 파싱, 실패 유형 분류 | 파싱 실패 회사는 status=failed로 명시 |
| sqlite-vec pre-1.0 성숙도 | numpy brute-force 기본(A3), sqlite-vec은 선택 | numpy 경로 유지 |
| ensure 폭주로 4코어 고갈 | corpCode 락 + 단일 워커 큐 + compose cpus 제한 | 서비스 컨테이너만 중지 (원칙 4에 따라 notices 전파) |
| 기존 Postgres 안정성 | v1은 기존 DB 무접촉(A3) | — |

## 9. 의존성

- [x] DART_API_KEY 서버 `.env.dev` 존재
- [x] OCI 서버 자원 확인 (ARM64 4코어 / RAM 18Gi 가용 / 디스크 62G)
- [ ] §7 미해결 질문 사용자 확정
- [ ] P0 fixture corp 20곳 목록 선정
- [ ] P1 라벨셋 100+ 주석 (LLM 초벌 + 사람 검수)
- [ ] OpenDART 일일 쿼터 실측 확인 (공식 20,000건/일 — 실측 검증)

## 10. 추적 / 라이프사이클

- 마스터 plan: 이 문서. **P0 착수 시 `CURRENT_STAGE.md` '현재 진행 중' 표에 등재** (완료 시가 아님 — 관례 정정).
- §7 확정 시: Status → confirmed + `Decisions Confirmed (날짜)` 섹션 추가.
- 스테이지 세부 plan: 스테이지 착수 시 분화 (관례).
- 완료 시 `completed_plans/` 이동 — **이동 시 Precedents 상대 링크 재작성 후 `./scripts/check.sh`(validate-doc-links) 재실행** (링크 파손 전례 방지).
