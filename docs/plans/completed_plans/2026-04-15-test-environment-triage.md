# 2026-04-15 · 테스트 환경 분리 (Test Environment Triage)

작성자: planner / 상태: Draft / 스테이지: harness 정리

## 목표
로컬 Windows 개발 환경에서 `./scripts/test-all.sh` 실행 시 나타나는 10개 pre-existing 실패를 **0으로 만든다**. Linux CI의 ground truth와 일치시키고, 개발자가 "이건 원래 실패해" 같은 관성을 갖지 않게 한다.

## 비목표
- CI OS matrix 구성 — 별도 harness 스테이지
- 새 테스트 프레임워크 도입 — `node:test` 유지
- 실패 테스트 삭제

## 정책 — 3가지 분류 및 처방

### 분류 1: **플랫폼 특화** — 특정 OS에서만 의미 있음
처방: **`node:test`의 skip 옵션**으로 플랫폼 가드. 신규 유틸 `packages/shared/src/test/_helpers/env.ts` 도입.

```ts
export const IS_WIN = process.platform === "win32";
export const IS_LINUX = process.platform === "linux";
export const IS_WSL = IS_LINUX && /microsoft/i.test(process.release?.name ?? "");

test("returns npm.cmd and npx.cmd on Windows",
  { skip: !IS_WIN ? "Windows 전용" : false },
  () => { ... });
```

**규칙**: skip reason 문자열 필수.

### 분류 2: **환경 의존** — 외부 바이너리/설치 필요
처방: **프리체크 + skip**.

```ts
export function hasNvm(): boolean {
  try { execFileSync("nvm", ["--version"], { stdio: "ignore" }); return true; }
  catch { return false; }
}
export function hasCommand(bin: string): boolean { /* which/where */ }
```

### 분류 3: **진짜 버그** — 코드 레벨 race condition
처방: **코드 수정**. skip 금지. 대표: **`#257` EPERM concurrent rename**.
- `packages/shared/src/core/utils.ts` `writeJsonFile`의 atomic rename이 Windows에서 동시 호출 시 `EPERM`.
- 수정: tempfile → rename 경로에 **exponential backoff retry** 3회 (10ms/30ms/100ms), 실패 시 throw.

## 10개 실패 초기 분류 (에이전트가 검증·재분류)

| # | 테스트명 일부 | 파일 | 초기 분류 | 비고 |
|---|---|---|---|---|
| 120 | does not skip .exe realpath on Windows | `nodeRuntimeResolver.test.ts:130` | 진단 필요 | "on Windows" 이름이지만 Windows에서 실패 → 버그 의심 |
| 121 | returns npm.cmd and npx.cmd on Windows | `nodeRuntimeResolver.test.ts:148` | 진단 필요 | 위와 동일 |
| 122 | caches result so second call returns | `nodeRuntimeResolver.test.ts:167` | 진단 필요 | 120/121과 연쇄 가능 |
| 148 | orchestrator routes role assignments | `orchestrator.test.ts` | 진단 필요 | 플랫폼 가드 아닐 가능성 |
| 208 | prefers the newest nvm-installed CLI | `providers.test.ts` | 2 | `hasNvm()` 가드 |
| 210 | runtime environment prepends...PATH | `providers.test.ts` | 1 | Linux PATH 구분자 전용 |
| 211 | runtime environment moves command dir | `providers.test.ts` | 1 | 210과 동일 |
| 212 | RunAbortedError when aborted | `providers.test.ts` | 진단 필요 | 타이밍 flaky 가능성 |
| 213 | gemini notion connect runs OAuth | `providers.test.ts` | 진단 필요 | mock 누락 의심 |
| 257 | writeJsonFile stays readable during concurrent | `storage.test.ts:497` | **3 (버그)** | `utils.ts` retry 추가 |

**중요**: 120~122는 "on Windows" 이름이라 Windows에서 통과해야 하는데 실제로 실패. 버그 가능성 높음. 에이전트가 반드시 실제 파일 읽고 원인 진단.

## 작업 순서

1. **진단 라운드**: 10개 각각의 실제 원인 파악. mock 여부, expect 값, 실패 에러 메시지.
2. **분류 확정**: 진단 기반 재조정.
3. **env.ts 유틸 작성**: `IS_WIN`, `IS_LINUX`, `IS_WSL`, `hasNvm()`, `hasCommand()`.
4. **분류 1/2 적용**: skip 가드 + reason 필수.
5. **분류 3 수정**: 코드 레벨 버그 수정 (`writeJsonFile` 등).
6. **검증**: `./scripts/test-all.sh` → 0 fail.

## 파일별 변경 예상

**신규**
- `packages/shared/src/test/_helpers/env.ts`

**수정 (진단 결과에 따라)**
- `packages/shared/src/test/nodeRuntimeResolver.test.ts`
- `packages/shared/src/test/providers.test.ts`
- `packages/shared/src/test/orchestrator.test.ts`
- `packages/shared/src/test/storage.test.ts`
- `packages/shared/src/core/utils.ts` (writeJsonFile retry)

## 리스크 & 완화

1. **skip 남용** — 진짜 버그를 가리는 위험. 완화: skip reason 의무화 + 분류 3 후보는 진단 필수.
2. **retry 로직이 다른 버그 마스킹** — 설정 파일 손상 은폐 가능. 완화: retry 후 실패 시 throw + 경고 로그.
3. **과도한 OS 분기** — product 코드 오염. 완화: 분기는 테스트 헬퍼와 `utils.ts`만 허용.

## 검증 체크리스트
- [ ] 로컬 Windows에서 `./scripts/test-all.sh` → 0 fail
- [ ] WSL에서 `./scripts/test-all.sh` → 0 fail
- [ ] 신규 skip 가드 모두 reason 문자열 포함
- [ ] `writeJsonFile` retry unit test로 EPERM 시나리오 재현
- [ ] `docs/development/OPERATING_RULES.md`에 플랫폼 가드 규칙 1~2줄 추가
