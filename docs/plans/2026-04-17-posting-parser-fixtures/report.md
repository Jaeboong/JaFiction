# 공고 파서 Fixture 수집 리포트

생성일시: 2026-04-19T07:46:48.194Z

## 총괄 통계

| 분류 | 건수 | 비율 |
|------|------|------|
| success | 21 | 28.0% |
| partial | 50 | 66.7% |
| total_failure | 2 | 2.7% |
| blocked | 0 | 0.0% |
| expired | 1 | 1.3% |
| error | 1 | 1.3% |
| **합계** | **75** | 100% |

- 총 URL: 75
- 고유 URL: 70

## 도메인 그룹별 성공률

| 도메인 그룹 | 샘플 수 | success | partial | total_failure | blocked/expired | error | 성공률 |
|-------------|---------|---------|---------|---------------|-----------------|-------|--------|
| other_corporate | 19 | 4 | 14 | 0 | 0 | 1 | 21% |
| jumpit | 17 | 2 | 15 | 0 | 0 | 0 | 12% |
| wanted | 11 | 9 | 2 | 0 | 0 | 0 | 82% |
| recruiter_co_kr | 9 | 0 | 9 | 0 | 0 | 0 | 0% |
| kia | 6 | 0 | 6 | 0 | 0 | 0 | 0% |
| jobkorea | 4 | 4 | 0 | 0 | 0 | 0 | 100% |
| posco | 3 | 0 | 3 | 0 | 0 | 0 | 0% |
| careerlink | 3 | 0 | 0 | 2 | 1 | 0 | 0% |
| greetinghr | 2 | 2 | 0 | 0 | 0 | 0 | 100% |
| lg | 1 | 0 | 1 | 0 | 0 | 0 | 0% |

## JSON-LD JobPosting 커버리지

전체: **15/75 (20%)**

| 도메인 그룹 | 샘플 수 | JSON-LD 존재 | 커버리지 |
|-------------|---------|-------------|---------|
| other_corporate | 19 | 1 | 5% |
| jumpit | 17 | 0 | 0% |
| wanted | 11 | 10 | 91% |
| recruiter_co_kr | 9 | 0 | 0% |
| kia | 6 | 0 | 0% |
| jobkorea | 4 | 4 | 100% |
| posco | 3 | 0 | 0% |
| careerlink | 3 | 0 | 0% |
| greetinghr | 2 | 0 | 0% |
| lg | 1 | 0 | 0% |

## SSR Payload 유형 분포

| 유형 | 건수 | 비율 |
|------|------|------|
| none | 56 | 74.7% |
| nextData | 18 | 24.0% |
| nuxt | 0 | 0.0% |
| initialState | 0 | 0.0% |
| apolloState | 0 | 0.0% |

## SPA 후보 URL 목록 (body 텍스트 < 500자)

| URL | 도메인 그룹 | body 텍스트 길이 | 분류 |
|-----|-------------|-----------------|------|
| https://recruit.posco.com/h22a01-front/H22A1001.html?id=609000 | posco | 48 | partial |
| https://hlcompany.recruiter.co.kr/app/jobnotice/view?systemKindCode=MRS2&jobnoticeSn=250304 | recruiter_co_kr | 98 | partial |
| https://recruit.kbanknow.com/Recruit/RecruitView/250627 | other_corporate | 46 | partial |
| https://midas.recruiter.co.kr/career/jobs/106460 | recruiter_co_kr | 0 | partial |
| https://recruit.posco.com/h22a01-front/H22A1001.html?id=609000 | posco | 48 | partial |
| https://hyundaiweld.saramin.co.kr/apply_site/recruit/view | other_corporate | 446 | partial |
| https://glovis.recruiter.co.kr/career/jobs/105909 | recruiter_co_kr | 0 | partial |
| https://recruit.posco.com/h22a01-front/H22A1001.html?id=609000 | posco | 48 | partial |
| https://keris.recruiter.co.kr/app/jobnotice/view?systemKindCode=MRS2&jobnoticeSn=250774 | recruiter_co_kr | 301 | partial |
| https://keris.recruiter.co.kr/app/jobnotice/view?systemKindCode=MRS2&jobnoticeSn=250776 | recruiter_co_kr | 301 | partial |
| https://seasoned-oregano-ae8.notion.site/IT-336fd7779e9d80f9b0f7f0435ee515fe | other_corporate | 88 | partial |
| https://dongjin.careerlink.kr/jobs/RC20260403026668 | careerlink | 0 | expired |
| https://careers.lg.com/apply/detail?id=1001576 | lg | 0 | partial |
| https://hyundai-wia.recruiter.co.kr/career/jobs/105662 | recruiter_co_kr | 0 | partial |
| https://www.hanwhain.com/portal/apply/recruit/detail?rtSeq=18568 | other_corporate | 99 | partial |
| https://imbc.careerlink.kr/jobs/RC20260403026692 | careerlink | 0 | total_failure |
| https://kac.careerlink.kr/jobs/RC20260326026238 | careerlink | 0 | total_failure |
| https://kpta.recruiter.co.kr/app/jobnotice/view?systemKindCode=MRS2&jobnoticeSn=250155 | recruiter_co_kr | 453 | partial |
| https://wins21.recruiter.co.kr/career/jobs/105993 | recruiter_co_kr | 0 | partial |
| https://www.hanwhain.com/portal/apply/recruit/detail?rtSeq=18568 | other_corporate | 99 | partial |
| https://jejubank.recruiter.co.kr/career/jobs/105612 | recruiter_co_kr | 0 | partial |

## P1 Gate §7.2 — factual 비율 판정

**베이스라인**: 30/110 = 27.3% (Chunk 3+4, 52b410c)
**Chunk 3.5 결과**: 46/105 = **43.8%**
**Gate 기준**: ≥ 40%
**판정**: **PASS** (43.8% ≥ 40%)

### 필드별 factual 건수 (success 21건 기준)

| 필드 | factual 건수 | 비율 |
|------|-------------|------|
| companyName | 21 | 100% |
| roleName | 16 | 76% |
| mainResponsibilities | 9 | 43% |
| qualifications | 0 | 0% |
| preferredQualifications | 0 | 0% |

### 도메인 그룹별 factual 내역 (success 건)

| 도메인 그룹 | success | factual 합계 | 필드별 (cn/rn/mr/q/pq) |
|-------------|---------|-------------|------------------------|
| wanted | 9 | 27/45 (60%) | F/F/F/-/-, F/F/F/-/-, F/F/F/-/-, F/F/F/-/-, F/F/F/-/-, F/F/F |
| other_corporate | 4 | 5/20 (25%) | F/F/-/-/-, F/-/-/-/-, F/-/-/-/-, F/-/-/-/- |
| jobkorea | 4 | 8/20 (40%) | F/F/-/-/-, F/F/-/-/-, F/F/-/-/-, F/F/-/-/- |
| jumpit | 2 | 2/10 (20%) | F/-/-/-/-, F/-/-/-/- |
| greetinghr | 2 | 4/10 (40%) | F/F/-/-/-, F/F/-/-/- |

## 가설 검증

### H1: GreetingHR 비중 < 5%
- GreetingHR URL: 2/75 (2.7%)
- 결과: **참** — GreetingHR 비중이 2.7%로 5% 미만임

### H2: jumpit / wanted / recruiter_co_kr이 상위 도메인인지
- 상위 5 도메인 그룹: other_corporate(19), jumpit(17), wanted(11), recruiter_co_kr(9), kia(6)
- 결과: **참** — 상위 3 도메인 중 jumpit/wanted/recruiter_co_kr 포함 여부

### H4: JSON-LD JobPosting 커버리지
- JSON-LD JobPosting 발견: 15/75 (20%)

### H5: SPA 비중
- SPA 후보: 21/75 (28.0%)

## Adapter 우선순위 제안 (실측 기반)

커버리지 내림차순으로 정렬:

1. **other_corporate** — 19개 샘플, 성공률 21%
1. **jumpit** — 17개 샘플, 성공률 12%
1. **wanted** — 11개 샘플, 성공률 82%
1. **recruiter_co_kr** — 9개 샘플, 성공률 0%
1. **kia** — 6개 샘플, 성공률 0%
1. **jobkorea** — 4개 샘플, 성공률 100%
1. **posco** — 3개 샘플, 성공률 0%
1. **careerlink** — 3개 샘플, 성공률 0%
1. **greetinghr** — 2개 샘플, 성공률 100%
1. **lg** — 1개 샘플, 성공률 0%

## 문제 URL 목록 (404/차단/타임아웃)

| URL | 분류 | HTTP 상태 | 오류 메시지 |
|-----|------|-----------|------------|
| https://kpf.plusrecruit.co.kr/#/recruitment/detail/34 | error | - | fetch failed |
| https://dongjin.careerlink.kr/jobs/RC20260403026668 | expired | 200 | - |

## 다음 단계 권고

1. SPA 후보 사이트(21건)는 Puppeteer/Playwright 기반 렌더링 어댑터 검토 필요
2. JSON-LD 미지원 도메인(60건)에 대한 HTML 구조 분석 어댑터 개발 우선화
3. 차단된 도메인(0건)에 대해 Referer/Cookie 처리 또는 공식 API 확인
4. total_failure(2건) 케이스의 HTML을 직접 확인하여 파서 개선 포인트 식별
5. 상위 도메인(jumpit, wanted, recruiter_co_kr) 전용 어댑터를 먼저 구현하여 커버리지 극대화