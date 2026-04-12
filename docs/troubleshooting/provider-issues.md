# 프로바이더 트러블슈팅

실제 개발 중 발생한 이슈 목록과 해결 방법.

---

## 이슈 1: 연결/해제 후 UI가 새로고침해야 반영됨

**증상**  
프로바이더 connect/disconnect 후 VALID/NEEDS ATTENTION 상태가 UI에 즉시 반영되지 않음. 페이지 새로고침 후에야 반영됨.

**원인**  
`startProviderCliAuth` RPC 핸들러에서 인증 완료 후 `testProvider`를 호출하지 않아 러너의 `runtimeStateCache`가 갱신되지 않음.  
이후 `get_state`가 캐시된 이전 상태를 그대로 반환.

**해결**  
`providerCliHandlers.ts`의 `startProviderCliAuth`에 `testProvider` + `stateStore.refreshProvider` 호출 추가.  
기존 `callProviderLogout` 패턴과 동일하게 맞춤.

**관련 파일**  
- `packages/runner/src/routes/providerCliHandlers.ts`

---

## 이슈 2: Gemini "연결" 클릭 시 아무 반응 없음 (RPC 타임아웃)

**증상**  
"연결 중..." 토스트 표시 후 30초 대기 → 에러 또는 무반응.

**원인**  
Gemini `startAuth`가 CLI 프로세스 종료까지 최대 120초 블로킹.  
백엔드 `deviceHub.sendRpc` 기본 타임아웃(30초)이 먼저 만료됨.

**해결**  
Gemini `startAuth`를 논블로킹으로 변경:

- `detached: true`로 CLI spawn
- 3초 대기 후 즉시 `{ success: false, message }` 반환
- 프론트엔드에서 5초 간격, 최대 24회 폴링으로 인증 완료 감지

**관련 파일**  
- `packages/runner/src/providers/gemini.ts`
- `packages/web/src/App.tsx`

---

## 이슈 3: Gemini CLI `.cmd` 래퍼 spawn 실패

**증상**  
Gemini "연결" 클릭 시 CLI가 실행되지 않음.

**원인 1**  
`resolveProviderCommand`가 npm global 경로(`AppData\Roaming\npm`)를 탐색하지 않음 → `gemini` 명령을 찾지 못함.

**원인 2**  
Windows `.cmd` 파일은 `shell: true` 없이 `child_process.spawn`/`bun.spawn` 불가 (bun 바이너리 실행 환경).

**해결**  
1. `providerCommandResolver.ts`에 npm global `.cmd` 경로 후보 추가
2. `gemini.ts`에서 resolve된 커맨드 경로가 `.cmd`로 끝나면 `shell: true` 옵션 적용

**관련 파일**  
- `packages/shared/src/core/providerCommandResolver.ts`
- `packages/runner/src/providers/gemini.ts`

---

## 이슈 4: Gemini CLI 0.37.1 인증 메커니즘 변경

**증상**  
`gemini auth login` 실행 시 "Y/n" 프롬프트 표시 → stdin 입력 없으면 진행 불가.

**원인**  
Gemini CLI 0.37.1부터 `~/.gemini/settings.json`에 `security.auth.selectedType` 값이 있어야 함.  
유효 값: `"oauth-personal"` (Google OAuth)

**해결**  
1. `~/.gemini/settings.json`에 아래 내용 작성:

```json
{
  "security": {
    "auth": {
      "selectedType": "oauth-personal"
    }
  }
}
```

2. `startAuth`에서 spawn 시 stdin에 `"Y\n"` 자동 전송

**관련 파일**  
- `~/.gemini/settings.json`
- `packages/runner/src/providers/gemini.ts`

---

## 이슈 5: Claude Code 테스트 24–28초 소요

**증상**  
"테스트" 버튼 클릭 후 24–28초 대기.

**원인**  
1. `loadProviderCapabilities`가 Claude CLI 바이너리(약 232 MB)를 통째로 읽어 모델 이름 파싱
2. `callProviderTest`에서 `testProvider` + `refreshRuntimeState`로 바이너리를 2회 읽음

**해결**  
1. `loadProviderCapabilities`에 TTL 5분 메모리 캐시 추가 (`providerOptions.ts`)
2. `callProviderTest`에서 `refreshRuntimeState` → `getCachedRuntimeState` 로 변경 (`providersHandlers.ts`)

**결과**: 24–28초 → **0.5–0.9초**

**관련 파일**  
- `packages/shared/src/core/providerOptions.ts`
- `packages/shared/src/core/providers.ts`
- `packages/runner/src/routes/providersHandlers.ts`

---

## 이슈 6: Codex disconnect 후 UI에 VALID 남아있음

**증상**  
연결 해제 후에도 VALID 표시가 유지됨. 새로고침 후에야 올바른 상태 표시.

**원인**  
`callProviderLogout`에서 로그아웃 후 `testProvider`를 호출하지 않아 `runtimeStateCache` 미갱신.

**해결**  
`callProviderLogout`에 `testProvider` + `stateStore.refreshProvider` 호출 추가.

**관련 파일**  
- `packages/runner/src/routes/providerCliHandlers.ts`

---

## 이슈 7: Claude Notion 토큰 저장 시 404 에러

**증상**  
프로바이더 탭에서 Claude의 Notion Integration Token을 입력하고 "연결하기" 클릭 시 404 에러. 토큰이 저장되지 않음.

**원인**  
`App.tsx`의 `onSaveNotionToken`이 REST `POST /api/providers/${providerId}/notion-token`을 호출했으나, 이 엔드포인트는 hosted 모드 백엔드에 존재하지 않음 (로컬 모드 전용 라우트였음).

네트워크 로그:
```
POST http://localhost:4124/api/providers/claude/notion-token [404]
{"message":"Route POST:/api/providers/claude/notion-token not found"}
```

**해결**  
REST fetch를 RPC 기반으로 교체:
- `onSaveNotionToken` → `client.connectNotion(providerId, token)` (RPC `notion_connect`에 token 포함)
- `onDeleteNotionToken` → `client.disconnectNotion(providerId)` (RPC `notion_disconnect`)

`NotionConnectPayload`는 이미 `token` 필드를 지원하고, 핸들러(`notionConnect`)가 `saveNotionToken()` 호출을 포함하므로 추가 백엔드 변경 불필요.

**관련 파일**  
- `packages/web/src/App.tsx` (`onSaveNotionToken`, `onDeleteNotionToken`)
- `packages/web/src/api/client.ts` (`connectNotion`에 token 파라미터 추가)

---

## 이슈 8: Notion 연결 400 에러 — "Unrecognized key 'provider'"

**증상**  
프로바이더별 Notion 연결/해제 시 400 에러: `Unrecognized key(s) in object: 'provider'`.

**원인**  
`NotionConnectPayloadSchema`와 `NotionDisconnectPayloadSchema`에 `.strict()`가 적용되어 있으나 `provider` 필드가 정의되지 않았음. 프론트엔드가 `{ provider: "claude" }` 등을 보내면 strict 검증에서 거부됨.

**해결**  
두 스키마에 `provider: ProviderIdSchema.optional()` 필드 추가.

**관련 파일**  
- `packages/shared/src/core/hostedRpc.ts`

---

## 이슈 9: Codex `mcp login` RPC 타임아웃 (무한 블로킹)

**증상**  
Codex Notion 연결 시 RPC 응답이 오지 않음. 30초 후 타임아웃.

**원인**  
`runNotionPlan()`이 `runProcess()`로 `codex mcp login`을 실행했으나, 이 명령은 브라우저 OAuth 콜백을 대기하는 interactive 프로세스. `runProcess`는 프로세스 종료까지 블로킹하므로 RPC가 영원히 대기.

**해결**  
`runNotionPlan()`에서 `mcp login` 스텝을 감지하면 `detached: true, stdio: "ignore"`로 spawn하고 `child.unref()` 후 즉시 다음 스텝으로 진행.

**관련 파일**  
- `packages/shared/src/core/providers.ts` (`runNotionPlan`)

---

## 이슈 10: Gemini `mcp list` 빈 출력 (CLI v0.37.1)

**증상**  
Gemini Notion 연결 후 상태 체크에서 "Notion MCP is not configured" 표시. 실제로는 `~/.gemini/settings.json`에 정상 설정됨.

**원인**  
Gemini CLI v0.37.1의 `gemini mcp list` 명령이 설정이 있어도 빈 문자열을 반환하는 버그.

**해결**  
`parseGeminiNotionStatus()`에서 CLI 출력이 비었을 때 `checkGeminiSettingsFile()` fallback 추가. `~/.gemini/settings.json`에서 `mcpServers` 항목을 직접 읽고, `~/.gemini/mcp-oauth-tokens.json`에서 OAuth 토큰 존재 여부도 확인.

**관련 파일**  
- `packages/shared/src/core/notionMcpGemini.ts`

---

## 이슈 11: Windows에서 프로바이더 CLI 실행 시 CMD 창 깜빡임

**증상**  
Notion 연결/해제, 테스트, 인증 등 CLI 호출 시 CMD 콘솔 창이 잠깐 나타났다 사라짐.

**원인**  
`child_process.spawn`이 Windows에서 기본적으로 새 콘솔 창을 생성함.

**해결**  
모든 `spawn` 호출에 `windowsHide: true` 옵션 추가.

적용 위치:
- `packages/shared/src/core/providers.ts` — `runProcess()`, `runNotionPlan()` detached spawn
- `packages/shared/src/core/notionOAuth.ts` — `spawnBrowser()`

---

## 이슈 12: 테스트 파일 모듈 로딩으로 24초 소요

**증상**  
`hostedRpc.test.ts`의 Claude Notion 상태 체크 테스트가 24초 소요.

**원인**  
`require("../core/notionMcpClaude")`로 동적 모듈 로드 시 매번 전체 의존 체인(`providers.ts` → `child_process` → `spawn`)이 초기화됨.

**해결**  
`require()` 동적 로드를 파일 상단의 정적 `import`로 변경. 모듈이 테스트 시작 시 한 번만 로드되어 0.5~0.78초로 단축.

```typescript
// Before (24초)
const { parseClaudeNotionStatus } = require("../core/notionMcpClaude");

// After (0.78초)
import { parseClaudeNotionStatus } from "../core/notionMcpClaude";
```

**관련 파일**  
- `packages/shared/src/test/hostedRpc.test.ts`
