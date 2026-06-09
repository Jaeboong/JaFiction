# Gemini run 무출력 — 근본 원인 & 수정 플랜

> 작성: 2026-06-10 · 대상: develop · 후속: `docs/plans/2026-06-10-handoff-local-runner-gemini.md`

---

## 1. 결론 (핸드오프 가설 정정)

핸드오프 1순위 가설(**파서가 `status:"error"` result 프레임을 삼킴**)은 **이번 무출력의 원인이 아니다**.
실측 결과 Gemini는 stream-json을 **한 줄도 내지 않는다**.

**진짜 원인: Gemini CLI 0.45.2의 trusted-directory 게이트.**

- 러너는 모든 run을 cwd `~/.jasojeon`(= `storage.storageRoot`, `orchestrator.ts:1609` / `providers.ts:410`)에서 spawn한다.
- Gemini CLI 0.45.2는 신뢰되지 않은 디렉터리에서 headless 실행을 거부한다.
- 러너는 `GEMINI_CLI_TRUST_WORKSPACE` / `--skip-trust` 중 무엇도 주지 않는다 (코드 전체에 부재).

### 실측 (cwd = `~/.jasojeon`, 러너와 동일 인자)

| 조건 | exit | stdout | stderr |
|------|------|--------|--------|
| `gemini -m auto -p ... --output-format stream-json` | **55** | **(빈 문자열)** | `Gemini CLI is not running in a trusted directory...` |
| `GEMINI_CLI_TRUST_WORKSPACE=true gemini -m auto -p ... --output-format stream-json` | **0** | 정상 stream-json (`init`→`message`(user)→`message`(assistant)→`result status:"success"`) | (무해) |

→ env 하나로 완전 해소됨을 **검증 완료**.

## 2. 부수 사실 (재조사 불필요)

- 저장된 모델 값은 stale 아님: `runner.json` 의 모든 agentDefaults `modelOverride: "auto"`, `providers.gemini.model: ""`. 전송 인자는 `-m auto`. (핸드오프 3-1 stale 가설 기각)
- `@napi-rs/canvas`: run 경로에 없음. bun 빌드 transitive 경고일 뿐. (핸드오프 2순위 기각)
- 에러 가시성 인프라는 존재: provider reject → `runProcess` close 핸들러가 비정상 exit 시 reject (`providers.ts:800-802`) → orchestrator가 `turn-failed` 이벤트 emit (`orchestrator.ts:1650-1659`). realtime 경로도 turn `.error` 검사 후 throw. **즉 이벤트 레이어상 완전 침묵은 아님** — UI가 `turn-failed`를 렌더하지 않는다면 그건 web-plane 별건(아래 5번).

## 3. 수정 (product / shared)

`packages/shared/src/core/providers.ts` 의 `buildEnvironment` (line 524):

- `withCommandDirectoryInPath` 직후, **CLI 모드 조기 return(line 531-532) 이전에** gemini 일 때 `env.GEMINI_CLI_TRUST_WORKSPACE = "true"` 주입.
- 이유 주석 1줄: trust 게이트는 신뢰 안 되는 repo 파일의 tool call 실행을 막는 장치인데, 여기 cwd는 사용자 repo가 아니라 러너 **자체 storage root(`~/.jasojeon`)** 이므로 우회가 안전. gemini 한정으로 스코프.

```ts
const env = withCommandDirectoryInPath(process.env, command);
// Gemini CLI 0.45.2+ refuses headless execution outside a "trusted" directory.
// The runner always spawns in its own storage root (~/.jasojeon) — never
// user-supplied repo content — so bypassing the trust gate is safe here.
if (providerId === "gemini") {
  env.GEMINI_CLI_TRUST_WORKSPACE = "true";
}
if (authMode !== "apiKey" || !apiKey) {
  return env;
}
```

> 검증한 변형은 **env 주입**이다. `--skip-trust` 플래그 변형은 미검증이므로 쓰지 말 것.

## 4. 테스트 (TDD)

`packages/shared/src/test/providers.test.ts` (없으면 적절한 기존 스위트):

1. `buildEnvironment("gemini", "cli", undefined, <cmd>)` → 반환 env에 `GEMINI_CLI_TRUST_WORKSPACE === "true"`.
2. `buildEnvironment("claude", ...)` / `("codex", ...)` → `GEMINI_CLI_TRUST_WORKSPACE` 미설정(undefined) — gemini 한정 회귀 방지.
3. apiKey 모드의 gemini 에서도 trust env 가 살아있는지(조기 return 이전 주입 보장).

> `buildEnvironment` 가 모듈 외부에 export 안 돼 있으면, 테스트 가능하도록 named export 추가(default export 금지). 그게 부담이면 `executePrompt` 레벨에서 spawn env 를 관측하는 테스트로 대체.

## 5. 스코프 밖 — 별도 팔로업 (이번 PR 미포함)

- **파서 `status:"error"` 미표면화** (`providerStreaming.ts:236`): result 핸들러가 `status` 미검사. 모델 404/quota 등 exit 0 + error result 프레임 케이스에서 여전히 조용히 삼킴 = latent 버그. trust 수정과 독립. shared core 회귀 위험 있어 별도 PR + 전용 테스트로.
- **UI `turn-failed` 렌더링**: 실패 이벤트가 web UI에 사용자 친화적으로 보이는지 확인 필요(스택 구동 요함). web-plane.

## 6. 검증 & 배포

- `./scripts/check.sh` (typecheck + 빌드 + 테스트).
- 배포: develop push → deploy-dev.yml 이 backend Docker `runner-bin` 스테이지에서 exe 재빌드 → `/api/runner/download` 서빙. **사용자는 새 exe 재다운로드 후 실행해야 반영됨.**
- 작업 규약: 모든 변경 develop commit + `git push origin develop`.
