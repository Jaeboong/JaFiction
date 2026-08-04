# filings-retrieval

DART 사업보고서 원문(document.xml)을 수집·파싱·청킹하는 파이프라인 (P0 recon).
plan: `docs/plans/2026-07-04-dart-filings-rag.md` §4 P0.

## 구성

```
filings_retrieval/        파이썬 패키지
  dart_client.py          corpCode 해석 + list.json/document.xml 수집 (캐시 우선, 2초 throttle)
  document_parser.py      zip → 본문 XML 선택 → 새니타이즈 → 섹션 트리 파싱
  chunker.py              A7 제외 + 500~800자 청킹 (표는 행 단위 "헤더: 값" 직렬화)
  models.py               dataclass 모델
eval/
  fetch_fixtures.py       fixture 하니스 — results.json / report.md 전량 재생성
  fixtures/corps.txt      대상 20개사 (커밋됨)
  fixtures/raw/           원문 zip 캐시 + manifest.json (gitignored)
  goldens/                리노공업·클래시스 섹션 트리 스냅샷 (커밋됨)
  results.json, report.md 게이트 산출물 (커밋됨)
tests/                    pytest
```

## 설치 (Python 3.10+)

```bash
cd services/filings-retrieval
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## 실행

```bash
# 캐시 모드 — eval/fixtures/raw/ 가 채워져 있으면 네트워크·API 키 불필요
.venv/bin/python eval/fetch_fixtures.py

# 재수집 — DART_API_KEY 환경변수 필요 (env로만 읽음, 키 부재 시 명시 에러)
DART_API_KEY=... .venv/bin/python eval/fetch_fixtures.py --force

# 골든 스냅샷 재생성 (파서 의도 변경 시에만)
.venv/bin/python eval/fetch_fixtures.py --regen-goldens

# 테스트
.venv/bin/pytest
```

## 게이트 (P0)

- 회사별: text_acceptance_rate ≥ 0.90 && SECTION-1 식별 ≥ 5 && 섹션 트리 깊이 ≥ 2
- 전체: 20곳 중 ≥ 18곳 통과 && 파싱 성공 전 건에서 "사업의 내용" 대분류 식별
- 판정은 `eval/report.md` 상단에 자동 기록된다.

## 주의

- DART API 네트워크 호출은 캐시 미스 + `--force` 경로에서만 발생한다 (요청당 2초 throttle,
  일일 쿼터 보호). 키는 `DART_API_KEY` env 전용 — 코드/출력에 남기지 않는다.
- 원문 XML은 strict XML이 아니다 (미이스케이프 `&`/`<` 의사마크업/속성 따옴표 결함).
  `document_parser.sanitize_xml`의 검증된 체인 적용 후 strict 파싱하며, recover는 안전망.
  침묵 부분손실은 `text_preservation_rate`로 감지한다.
