# P0 검증 계획 — CDP 자동화 E2E + 3-layer 통합

**Status:** pending execution (Chunk 5/6/7 완료 대기)
**목적:** P0 리팩터 합격 판정 + 다음 스테이지(P1) 진입 승인
**실행 주체:** Claude (분석 + 최종 평가) + Sonnet 에이전트 (CDP 실행 + 수집) + 사용자 (환경 사전 기동)

---

## 1. 검증 구조 — 3 Layer

| Layer | 수단 | 잡는 이슈 | 실행 주체 |
|---|---|---|---|
| **L1** 자동 단위/통합 | `./scripts/check.sh` | 코드 레벨 회귀, 타입 오류, unit 테스트 | Claude |
| **L2** 정량 파이프라인 | `bun run scripts/fetch-posting-fixtures.ts --force` | 파서 tier 분류 / misidentification 카운트 변화 | Claude |
| **L3** CDP 자동화 E2E | CDP MCP로 실제 브라우저 조작 + UI 상태 수집 | UX 회귀 / 배너·배지 / 생성 버튼 상태 / 수동 수정 경로 | Sonnet 에이전트 → Claude 분석 |

**세 Layer 전부 통과해야 P0 합격 선언.**

## 2. 사전 요구사항 (사용자가 기동)

### 사용자 수행
- **Docker compose 기동** — Postgres + Redis + backend (`docker compose up -d` 또는 `./scripts/start-dev-backend.sh`)

### Claude 수행 (CDP 실행 직전)
- **러너 재빌드 + 실행** — `./scripts/start-dev-runner.sh` (shared + runner 소스 수정 반영)
- **웹 dev server 실행** — `./scripts/apply-dev-stack.sh`
- **또는 통합** — `./scripts/dev-stack.sh` (canonical: infra + backend + runner + web 한 번)
- **포트 확인** — dev-stack.sh 출력에서 web 포트 파악 후 CDP 세션에 전달

참고: `shared` 코드 수정 → runner·web 모두 영향. dev-stack.sh는 빌드까지 포함하므로 이걸로 충분.

## 3. 실행 순서

```
[이미 완료]
  Chunk 1 ✓  Source Tier 타입
  Chunk 2+3 ✓ 스키마 확장 + 파서 tier + ATS 블랙리스트
  Chunk 4 + 4.1 ✓ Runner handler guard + replace hotfix

[진행 중]
  Chunk 5    Web UI 경고 + 생성 차단 + 수동 수정 해제

[대기]
  Chunk 6    Golden fixture 도입
  Chunk 7    fixture 재측정 (L2)

[이 문서 범위]
  L1: check.sh       — Chunk 7 내에서 실행
  L2: fixture 재측정  — Chunk 7 내에서 실행
  L3: CDP 자동화     — L1/L2 통과 후
```

## 4. L3 — CDP 자동화 E2E 상세

### 4.1 URL 세트

**확보 시점**: 사용자가 Chunk 6 완료 시점 전후로 제공 (수십 개 예상)
**저장**: `docs/plans/2026-04-17-posting-parser-p0-verification/urls.txt`
**포맷**: 기존 fixture `urls.txt` 와 동일 (각 URL 위에 `# <카테고리> | <회사> | <직무> | <마감>` 메타 코멘트)
**재사용**: 기존 75 fixture URL 재사용 OK. 새 URL 보강 가능.

**도메인 다양성 권장**:
- 정상(P0 목표 — 배너 없음): greetinghr, jobkorea, idis
- 오인식 대상(P0 목표 — 배너 O, 차단 O): jumpit, wanted, kia, posco, lg, recruiter.co.kr
- SPA 경계: careerlink (nextData 있지만 빈 body)
- 에러: 인증서(kpf), 만료(dongjin), 404

### 4.2 실행 흐름 per URL (공고 분석 시나리오)

```
1. /projects 진입 → "새 지원서" 클릭
2. 공고 URL 입력 필드에 <url> 입력
3. "공고 분석" 버튼 클릭
4. 결과 로드 대기:
   - DOM 시그널: .projects-analysis-banner 또는 .projects-analysis-error 출현
   - 최대 15초 timeout
5. 상태 수집 (evaluate_script):
   - companyName input value
   - roleName input value
   - 경고 배너 존재 여부 + 메시지 텍스트
   - 필드별 ⚠️ 배지 개수 + 어느 필드
   - 생성 버튼 disabled 여부 + 툴팁 텍스트
   - warnings 리스트 내용
6. Console errors, Network request failures 수집
7. 전체 페이지 스크린샷 (screenshots/<idx>_<domain>.png)
8. 프로젝트 삭제 or 뒤로 (다음 URL 영향 차단)
```

### 4.3 수동 수정 시나리오 (분리된 세트, 5~10건 선정)

오인식 대상 URL 중 5~10건에 대해:

```
1. 위 4.2 흐름 수행 → 배너 존재 확인
2. companyName input 에 "테스트회사" 입력
3. roleName input 에 "테스트직무" 입력
4. 저장/blur 트리거
5. 상태 재수집:
   - 배너 사라졌는지
   - 생성 버튼 활성화됐는지
   - jobPostingFieldConfidence 가 factual로 승격됐는지 (API 상태 직접 확인 or UI 간접 확인)
6. 스크린샷 (before / after 페어)
```

### 4.4 expectation 카탈로그 (자동 판정 기준)

**도메인 그룹 기반 기본 규칙**:

| 도메인 그룹 | 기대 배너 | 기대 생성 버튼 | 기대 companyName tier |
|---|---|---|---|
| `greetinghr`, `jobkorea`, `careers.idis.co.kr` | ✗ 없음 | enabled | `factual` |
| `jumpit`, `wanted` (JSON-LD 활용 전), `kia`, `posco`, `lg`, `recruiter.co.kr` | ✓ 있음 | disabled | undefined or `role` |
| 에러(만료/404/인증서) | — | 에러 UI | — |

**URL별 override**: `urls.txt` 코멘트 확장으로 예외 지정 가능 (예: `# EXPECT: banner=true, generate=disabled`).

**주의 — P0 단계 특수성**:
- 이번 P0는 "오인식 차단"만 검증. 점핏/원티드 등의 **실제 파싱 성공은 P1~P3 이후** 기대.
- 즉 jumpit URL이 "생성 버튼 disabled + 배너 표시"면 **pass**. 실제 필드 추출 성공은 아직 불필요.

### 4.5 결과 구조

```
docs/plans/2026-04-17-posting-parser-p0-verification/
├── urls.txt                  # 입력 URL + expectation 메타
├── results.json              # 실측 상태 per URL
│    [
│      {
│        "url": "...",
│        "expected": {...},
│        "actual": {
│          "companyName": "...",
│          "roleName": "...",
│          "warningBannerVisible": true,
│          "fieldBadges": ["companyName", "roleName"],
│          "generateButtonDisabled": true,
│          "generateButtonTooltip": "...",
│          "consoleErrors": [],
│          "networkErrors": []
│        },
│        "screenshotPath": "screenshots/001_jumpit.png",
│        "verdict": "pass" | "fail" | "inconclusive",
│        "diffs": [...]
│      }
│    ]
├── manual-edit-results.json  # 수동 수정 시나리오 결과 (before/after)
├── screenshots/              # <idx>_<domain>.png
├── manual-edit-screenshots/  # <idx>_before.png, <idx>_after.png
├── console-logs/             # <idx>.txt (console + network)
└── report.md                 # Sonnet 에이전트가 작성하는 초벌 집계
```

**최종 분석 리포트**: `report-claude.md` — Claude가 분석 후 작성 (도메인별 집계 + 이슈 분류 + 다음 단계 제안).

## 5. 판정 규칙

### 5.1 자동 판정 (per URL)

- **Pass**: expected vs actual 의 모든 assertion 일치 + 치명적 에러 없음
- **Fail**: 하나라도 assertion 불일치 또는 unhandled exception
- **Inconclusive**: 네트워크 차단, 타임아웃 등 환경 이슈 → 재시도 1회

### 5.2 Claude 최종 평가 (정성)

자동 판정 위에 제가 다음을 평가:
- 메시지 카피 자연스러움
- 배지 레이아웃 깨짐 여부 (스크린샷 직시)
- UX 흐름 (수동 수정 후 전환 자연스러운지)
- 저장소 convention 일관성

## 6. 이슈 분류·처리 정책

| 등급 | 기준 | 처리 |
|---|---|---|
| Critical | 기존 데이터 손상, 기존 성공(greetinghr/jobkorea) 회귀 | 즉시 rollback, P0 재설계 |
| Major | 새 기능 오작동 (차단 실패, 해제 실패, 배너 미노출) | P0.x hotfix chunk → 재검증 |
| Minor | UX 거슬림 (문구, 배지 위치, 색상 등) | 사용자 판단: 즉시 고칠지 vs P4 후속 |
| Low | 스타일·cosmetic | 후속 ticket |

## 7. P0 합격 선언 조건

모두 충족:
- [ ] L1: `./scripts/check.sh` 100% pass, 회귀 0
- [ ] L2: fixture `misidentification ≤ 5` + `success 8건 회귀 0`
- [ ] L3: expectation 자동 판정 pass rate `≥ 90%` + Critical/Major 이슈 0
- [ ] 수동 수정 시나리오: 5~10건 중 80% 이상 배너 해제 정상 동작
- [ ] 사용자 최종 승인 (report-claude.md 검토)

## 8. 실행 주체 분담

| 역할 | 주체 |
|---|---|
| Docker 기동 | 사용자 (미리) |
| dev-stack.sh 기동 | Claude |
| L1, L2 실행 | Claude (직접 Bash) |
| L3 CDP 실행 | **Sonnet 에이전트** (CDP MCP 허용) |
| L3 결과 분석 | Claude |
| 이슈 분류 | Claude 초안 → 사용자 승인 |
| Hotfix 위임 | Claude → Sonnet |

## 9. 다음 스테이지 결정 흐름

```
L1/L2/L3 전부 pass
  ├─ Critical/Major 0      → P1 (JSON-LD 파서) 착수 승인
  ├─ Minor 몇 건            → 즉시 고칠지 vs P4 분리 판단 후 P1 진입
  └─ Critical/Major 발견    → hotfix chunk → 재검증 루프 (최대 2회)
                              3회 초과 시 P0 설계 재검토
```

## 10. 알려진 제약 / 주의사항

- **점핏/원티드/kia 등 SPA는 여전히 실패가 정상** — P0에서는 "오인식 차단"만 검증. 실제 파싱 성공은 P1~P3 범위. 수동 수정 시나리오로 실제 생성 플로우는 확인 가능.
- **OCI 백엔드 영향 없음** — P0 변경은 shared + runner + web. backend 수정 없음. 로컬 docker compose backend로 검증 충분.
- **러너 바이너리 재빌드 필수** — shared 수정 영향으로. dev-stack.sh 가 자동 처리 추정이지만 로그로 확인 필요.
- **CDP MCP Chromium**: 이 세션에 연결된 Chromium 인스턴스 사용. 시스템 Chrome과 별도.
- **스크린샷 gitignore**: verification 디렉토리도 fetched/ 처럼 `screenshots/` / `manual-edit-screenshots/` 는 `.gitignore` 추가 필요 (크기·저작권).

## 11. 미확정 항목 (사용자 확답 필요)

1. [ ] URL 세트: 개수 + 새 URL 제공할지 fixture 재사용할지 (Chunk 6 완료 시점에 확정)
2. [ ] 수동 수정 시나리오 대상 URL: 5~10건 선정 기준 (오인식 대상 도메인 모두 vs 대표 3~5개)
3. [ ] Minor 이슈 정책: 즉시 고칠지 기본값 / 별도 ticket 기본값 중 선호

## 12. 추적 링크

- Parent refactor plan: `docs/plans/2026-04-17-posting-parser-refactor.md`
- P0 세부 플랜: `docs/plans/2026-04-17-posting-parser-p0-field-confidence.md`
- Fixture(L2): `docs/plans/2026-04-17-posting-parser-fixtures/`
- 이 문서: `docs/plans/2026-04-17-posting-parser-p0-verification.md`
- 검증 결과: `docs/plans/2026-04-17-posting-parser-p0-verification/` (실행 시 생성)
