# 2026-04-17 — 공고 파서 fixture 수집 (Recon Stage)

**Status:** in_progress
**Owner:** 김재환 (via Codex)
**예상 소요:** 15~25분 (Codex 백그라운드)

---

## 왜 이 단계가 필요한가

`packages/shared/src/core/jobPosting.ts`의 `fetchAndExtractJobPosting()`이 현재 GreetingHR 전용 `__NEXT_DATA__` 경로에만 최적화되어, 다른 ATS 공고에서 필드 추출 실패율이 높다(사용자 제보). 리팩터 방향(adapter registry / JSON-LD / DOM block layer / ML 레이어 등)을 확정하기 전에 **실측 데이터로 ATS 분포·실패 패턴·JSON-LD 커버리지를 확정**한다.

이 단계는 **리팩터 설계의 입력**이며, 완료 후 결과를 근거로 `docs/plans/2026-04-xx-posting-parser-refactor.md`를 작성한다.

## 가설 (검증 대상)

- H1: GreetingHR은 사용자 실제 공고의 < 5% 차지. 다른 ATS가 주력.
- H2: 점핏(sarmin.co.kr/jumpit), 원티드, 리크루터닷코 계열 3개가 실측 분포 상위.
- H3: Greenhouse/Lever/Workday/Ashby 같은 해외 ATS는 무시해도 될 만큼 적다.
- H4: JSON-LD `JobPosting` 스키마는 자사 채용 페이지에 상당 비율 존재 → 저비용 승리 가능.
- H5: 상당수 사이트가 SPA 구조 → 정적 fetch만으로는 근본적으로 파싱 불가.

## 범위

- 사용자 제공 실사용 URL 약 75건 (중복 포함)
- 입력 파일: `docs/plans/2026-04-17-posting-parser-fixtures/urls.txt`

## 산출물

```
docs/plans/2026-04-17-posting-parser-fixtures/
├── urls.txt                    # 입력 (raw, 각 URL 위에 # 메타 코멘트)
├── fetched/<domain>_<n>.html   # HTML 원본 (.gitignore)
├── results.json                # URL별 파서 결과 + 구조 메타
└── report.md                   # 도메인별 실패 패턴 리포트 (커밋)
```

`.gitignore` 업데이트: `docs/plans/2026-04-17-posting-parser-fixtures/fetched/`

## 수집 대상 메타 (URL별)

- **HTTP**: status, Content-Type, 최종 URL(리다이렉트 후), 응답 바이트 수
- **파서 결과** (`fetchAndExtractJobPosting` 재사용):
  - 성공 / 부분실패 / 완전실패 분류
  - 추출된 companyName / roleName / keywords / mainResponsibilities / qualifications / deadline 등
  - urls.txt의 기대 메타(회사명·직무·마감)와 대조 → 정확성 검증
  - 누락·오추출된 필드 목록
- **구조 신호**:
  - `<script type="application/ld+json">` 유무 + JobPosting schema 포함 여부 + 추출된 핵심 필드
  - `__NEXT_DATA__` / `__NUXT__` / `window.__INITIAL_STATE__` / `window.__APOLLO_STATE__` 유무
  - `<title>`, `og:title`, `og:description`
  - `<body>` 초기 텍스트 길이 (SPA 여부 추정)
- **도메인 그룹**: 자동 분류 (jumpit / wanted / recruiter.co.kr / careerlink / jobkorea / greetinghr / kia / posco / lg / 기타 자사)

## 다음 단계 (이 작업 완료 후)

1. report.md 검토 → H1~H5 검증 결과 확정
2. 도메인 실측 분포로 adapter 우선순위 확정
3. JSON-LD 커버리지로 cheap-win 규모 산정
4. SPA 비중으로 헤드리스 렌더링 필요 여부 판단
5. `docs/plans/2026-04-xx-posting-parser-refactor.md` 작성 (adapter / DOM layer / schema 마이그레이션 / ML 도입 순서 확정)

## 제약

- CDP MCP / 브라우저 자동화 도구 사용 금지
- fetch throttle: 도메인당 2초 간격
- timeout 20초, User-Agent 지정 (일반 브라우저 UA)
- 차단·404·만료 URL도 메타로 기록 (정보 가치 있음)
- 만료된 공고가 많을 수 있음(오늘 2026-04-17 기준 04/13~04/16 마감 공고 다수)
