# P2 Chunk 0.5 — 다음 세션 시작 프롬프트

**작성일**: 2026-04-19
**현재 상태**:
- 브랜치: `feat/p2-posting-parser-adapters`
- HEAD: `9ced079` (Chunk 0 어댑터 인프라 커밋 + push 완료)
- plan: `docs/plans/2026-04-19-posting-parser-p2-major-adapters.md` (§5 Chunk 0.5 개괄)
- 원격 sync: OCI jhserver 까지 완료

---

## 다음 세션에 Claude 에게 던질 프롬프트 (복붙용)

```
P2 Chunk 0.5 — Puppeteer Fetcher 인프라 구현을 Codex 에 위임해서 진행해.

## 현재 상태
- 브랜치: feat/p2-posting-parser-adapters (HEAD 9ced079)
- Chunk 0 어댑터 인프라는 이미 완료·커밋됨
- Plan: docs/plans/2026-04-19-posting-parser-p2-major-adapters.md §5 Chunk 0.5 참조

## Chunk 0.5 범위 (plan §5 기반)

### 신규 파일
1. packages/shared/src/core/jobPosting/fetcher/types.ts
   - JobPostingFetcher 인터페이스: `fetch(url: string): Promise<{ html: string; status: number; finalUrl: string }>`
2. packages/shared/src/core/jobPosting/fetcher/staticFetcher.ts
   - 현재 packages/shared/src/core/jobPosting.ts 내부의 `fetch()` 호출 경로를 이 모듈로 분리
   - StaticFetcher 클래스로 JobPostingFetcher 구현
3. packages/runner/src/jobPosting/puppeteerFetcher.ts
   - PuppeteerFetcher 클래스 (runner 전용, shared 로 import 불가 — runner 만 무거운 의존성)
   - puppeteer.launch / page.goto / networkidle 대기 / page.content() 추출
   - 타임아웃 15초, 실패 시 에러 throw
4. packages/runner/src/jobPosting/fetcherRouter.ts (또는 jobPosting.ts 내부)
   - Host 화이트리스트 기반 라우팅
   - SPA_HOSTS = ["jumpit.saramin.co.kr", "www.jobplanet.co.kr", "rememberapp.co.kr", ...] (확정은 Chunk 5/6 에서)
   - Feature flag: process.env.PUPPETEER_ENABLED === "true" 또는 RunnerConfig 에 옵션 추가
   - SPA 호스트 && 플래그 on → PuppeteerFetcher, 그 외 → StaticFetcher
   - Puppeteer 실패 시 StaticFetcher 로 fallback + warning 방출

### 수정 파일
- packages/shared/src/core/jobPosting.ts
  - fetchAndExtractJobPosting 이 하드코드 `fetch()` 하는 부분을 JobPostingFetcher 주입 구조로 변경
  - 기본 fetcher = StaticFetcher (기존 동작 유지)
  - runner 쪽에서 라우터 주입
- packages/runner/src/jobPosting/* 또는 runner index — 라우터 주입 지점 추가
- packages/runner/package.json — puppeteer 의존성 추가

### 신규 테스트
- packages/shared/src/test/jobPosting.fetcher.test.ts (StaticFetcher 단위 테스트, 기존 goldens 회귀 없는지 확인)
- packages/runner/src/test/puppeteerFetcher.test.ts (mock 기반, 실제 Chrome 안 띄움)

### 성공 기준
- Puppeteer 꺼진 환경 (기본): 기존 6 goldens 전부 PASS, factual 비율 43.8% 유지
- Puppeteer 켜진 환경: jumpit 1건 end-to-end 추출 성공 (fixture 미리 수집한 URL)
- runner 번들 크기 기록 (before/after)

## 의존성 결정 사항
- **puppeteer 정식 패키지** 사용 (Chromium 번들 포함, ~150MB) — 사용자 2026-04-19 승인
- puppeteer-core 아님 (환경 의존성 회피)

## 진행 방법

### Step 1: Opus Plan 에이전트에게 Chunk 0.5 상세 구현 plan 작성 위임
- 위 개괄을 Codex 가 바로 돌릴 수 있는 수준으로 구체화
- API 시그니처, 테스트 케이스별 assert, 라우팅 로직 psuedocode
- 이미 plan §5 Chunk 0.5 에 개괄 있으니 "그걸 구체화" 라고 지시

### Step 2: Claude 가 plan 검토 후 Codex 위임
- **companion --background 금지** (메모리: feedback_codex_delegation.md)
- 올바른 호출:
  ```
  COMPANION=$(find ~/.claude/plugins -name "codex-companion.mjs" | head -1)
  PROMPT=$(cat /c/Users/cbkjh/AppData/Local/Temp/codex_prompt_p2_chunk0.5.txt)
  # Claude 의 Bash 도구에서:
  #   command: node "$COMPANION" task --write --effort xhigh "$PROMPT" 2>&1 | tail -50
  #   run_in_background: true
  #   timeout: 1800000
  ```
- docs/logs/codex.txt 템플릿 복사 + session ID 즉시 박음

### Step 3: Codex 완료 후 Sonnet 에이전트가 검증 + 커밋
- check.sh (runner EBUSY 7건은 기존 Windows 이슈로 무시)
- 커밋 메시지 형식: feat(shared,runner): P2 Chunk 0.5 — JobPostingFetcher 인터페이스 + PuppeteerFetcher
- push + codex.txt 삭제

## 주의사항
- Puppeteer 번들 때문에 npm install 시간이 평소보다 오래 걸릴 수 있음 (Chromium 다운로드)
- runner 쪽 코드만 puppeteer 쓸 것 (shared 는 절대 import 금지)
- macOS/Linux runner 에서도 동작해야 함 (Windows 만 테스트 말 것)

위 내용 기반으로 Opus Plan 에이전트에 상세 구현 plan 위임부터 시작해.
```

---

## 참조 파일
- P2 master plan: `docs/plans/2026-04-19-posting-parser-p2-major-adapters.md`
- P0+P1 handoff: `docs/plans/2026-04-19-posting-parser-p0-p1-handoff.md`
- Chunk 0 커밋: `9ced079`
- Codex 위임 메모리: `feedback_codex_delegation.md` (2026-04-19 업데이트)
- Codex resume 메모리: `feedback_codex_resume_flags.md`
- Codex intervention 메모리: `feedback_codex_intervention.md`

## 현재까지 커밋 히스토리 (feat/p2-posting-parser-adapters)
```
9ced079 feat(shared): P2 Chunk 0 — SiteAdapter 인프라 (어댑터 0개, 기존 동작 무변화)
62b0bdc docs(plans): P2 메이저 공고 사이트 전용 어댑터 plan 확정
```
