# 핸드오프 — 로컬 러너 Gemini 실행 무출력 문제 진단

> 작성: 2026-06-10 · 대상: **사용자 로컬 머신(Windows)에서 도는 로컬 에이전트**
> 목적: Gemini 프로바이더로 실행(run)을 돌렸을 때 **출력이 전혀 안 뜨는** 문제의 러너측 원인 규명.

---

## 0. TL;DR

- 백엔드/연결/배포는 **모두 정상**으로 확인됨. 문제는 **러너(이 머신)에서의 Gemini 실행 단계**다.
- 가장 유력: **Gemini CLI가 stream-json으로 에러 결과를 뱉는데, 러너 스트림 처리기가 그걸 삼켜서 UI에 아무것도 안 뜬다.**
- 로컬 에이전트가 해야 할 핵심: **실제 run 중 Gemini CLI의 stdout(stream-json) 원문을 캡처**해서 `status:"error"`인지/무슨 에러인지 확인.

---

## 1. 이미 해결/확인된 것 (재조사 금지)

| 항목 | 상태 | 근거 |
|------|------|------|
| 러너 기동 스크립트 `$9` 누락 crash-loop | ✅ 수정·배포 (`6aa3048`) | `--watch` 뒤 entrypoint 경로 누락 → 무한 재시작이었음 |
| Gemini 모델 드롭다운 하드코딩 → stale 위험 | ✅ 수정·배포 (`a5f33f6`) | 안정 alias(`auto/pro/flash/flash-lite`)로 교체. **드롭다운에 alias 보임 확인됨** = 새 exe 적용됨 |
| 백엔드 도커 로그 | ✅ 에러 0건 | 모든 `/api/rpc` 200. `start_run`/`call_provider_test`/`notion_check` 성공 |
| `[deviceHub] frame missing {type} wrapper — dropped (ping)` 경고 | ⚪ **무해한 노이즈** | `runnerSocket.ts:96-97`이 ping→pong 정상 응답. deviceHub 두 번째 리스너가 같은 ping을 보고 경고만 남기는 것. 연결은 7분+ 유지됨. **추적 금지** |

`gemini -m {auto,pro,flash,flash-lite}` 가 CLI에서 정상 해석됨도 별도 검증 완료.

---

## 2. 미해결 문제 (이번 진단 대상)

실행 탭에서 **coordinatorProvider=gemini, reviewerProviders=[gemini×3], reviewMode=realtime** 로 run을 돌리면:
- 러너 콘솔 로그상 `rpc:start_run:ok` 까지는 정상.
- 그런데 **UI에 에이전트 대화/출력이 전혀 안 뜬다** ("그 로그가 안떠").
- 백엔드엔 에러 없음 → 실패는 러너측 프로바이더 실행 단계.

관측된 부수 경고(원인일 수도, 아닐 수도):
```
Warning: Cannot load "@napi-rs/canvas" package: Cannot find module '@napi-rs/canvas'
  from 'B:\~BUN\root\jasojeon-runner-windows.exe'
```
→ bun 컴파일 단일 exe에 네이티브 모듈 `@napi-rs/canvas`가 안 들어감. 문서 처리(PDF→이미지 등) 경로에서 쓰이면 run이 거기서 깨질 수 있음. **2순위 용의자.**

---

## 3. 핵심 기술 사실 + 파일 포인터

### 3-1. Gemini 실행 인자 (shared)
`packages/shared/src/core/providerOptions.ts` → `buildProviderArgs("gemini", ...)`:
```
gemini [-m <model>] -p <prompt> --output-format stream-json
```
- `model`이 설정돼 있으면 `-m <model>` 을 **무조건** 붙인다. 승인 플래그(`--approval-mode`/`-y`)는 **안 붙는다**.
- **저장된 모델 값 주의**: 드롭다운이 alias로 바뀌었어도, 과거에 저장된 `gemini-2.5-pro` 같은 값이 설정에 남아 있으면 그게 전송될 수 있다. → run 전 드롭다운에서 alias 하나를 **다시 선택·저장**했는지 확인.

### 3-2. ⭐ 에러를 삼키는 지점 (1순위 용의자)
`packages/shared/src/core/providerStreaming.ts:236`
```ts
if (eventType === "result" && this.activeMessageIds.has(this.syntheticMessageId)) {
  await this.emitChatEvent("chat-message-completed", ...);
}
```
- Gemini가 에러 시 내보내는 프레임: `{"type":"result","status":"error","error":{...}}` (model 404 등에서 실측됨).
- 이 핸들러는 **`status`를 검사하지 않는다.** 게다가 에러면 직전 `message`(assistant) 프레임이 없어 `activeMessageIds`가 비어 있음 → 이 `if`가 false → **완료 이벤트도, 에러 이벤트도 전혀 안 나간다.**
- 결과: run이 조용히 무출력. **"로그가 안떠"와 정확히 일치.**
- 즉, 가설: *Gemini CLI가 어떤 이유로 에러 result를 뱉고 → 러너가 그걸 삼킨다.* 진짜 에러 원인(모델? 인증? 도구 승인? canvas?)을 알려면 **CLI stdout 원문**을 봐야 한다.

### 3-3. 실행 경로 / 관련 파일
- 런 오케스트레이션: `packages/shared/src/core/orchestrator.ts`
- 러너 RPC 핸들러(start_run 등): `packages/runner/src/routes/runsHandlers.ts`, `packages/runner/src/hosted/rpcDispatcher.ts`
- 프로바이더 spawn/실행: `packages/shared/src/core/providers.ts` (`runProcess`, `createProviderStreamProcessor` 사용)
- 스트림 파서: `packages/shared/src/core/providerStreaming.ts`
- Gemini 인증/상태: `packages/runner/src/providers/gemini.ts`

---

## 4. 로컬 에이전트가 할 일 (우선순위 순)

### A. ⭐ 실제 run 중 Gemini CLI stdout(stream-json) 원문 캡처
가장 결정적. 두 방법 중 택:
1. **러너를 소스에서 dev 모드로 실행**해 상세 로그 확보:
   ```
   git pull origin develop
   ./scripts/start-dev-runner.sh --foreground   # 또는 packages/runner dev 스크립트
   ```
   run을 재현하고, provider 실행 부분의 stdout 로그를 본다. (필요하면 `providers.ts`의 provider spawn 지점에 임시 `console.error(rawStdout)` 추가 후 재현.)
2. **Gemini CLI를 러너와 동일 인자로 수동 실행**해 재현:
   ```
   gemini -m <설정된 모델 또는 alias> -p "테스트 프롬프트" --output-format stream-json
   ```
   출력에 `{"type":"result","status":"error",...}` 가 있으면 그 `error` 내용이 진짜 원인.

확인 포인트:
- `status:"error"` 인가? `error.message`/`code`(예: 404, 인증, quota)는?
- 아니면 정상 출력인데 러너가 파싱을 못 하나? (이 경우 3-2가 진짜 버그)

### B. 모델 설정값 검증
- 실제 전송되는 `-m` 값이 무엇인지 확인(저장된 stale 값 가능성). alias로 재선택 후 재현 비교.

### C. `@napi-rs/canvas` 경로 영향 확인
- 코드에서 `@napi-rs/canvas` 사용처를 찾아(`grep -rn "@napi-rs/canvas" packages/`), 문서 처리/이미지 변환이 run 경로에 끼는지 확인.
- 이번 run은 `selectedDocumentIds` 4개 사용 → 문서 처리가 canvas를 요구하면 거기서 throw 가능.
- bun 단일 exe에 네이티브 모듈을 어떻게 번들/사이드카로 넣는지(`packages/runner/build.ts`) 점검.

### D. 결론 도출
- 원인이 (1) CLI 에러(모델/인증/quota), (2) 러너 스트림 처리기의 에러 미표면화(3-2), (3) canvas 누락 중 무엇인지 특정.
- **(2)가 사실이면 shared 수정 필요**: `result` 핸들러가 `status:"error"`일 때 사용자에게 보이는 에러 이벤트(`chat-message-...` 또는 run error)를 emit하도록. (지금은 조용히 삼킴 = UX 최악.) 단, 표면화만으론 근본 에러는 안 사라지니 (1)/(3)도 함께 규명.

---

## 5. 작업 규약 (반드시 준수)

- **모든 변경은 `develop`에 commit + `git push origin develop`.** 서버 deploy-dev.yml이 `git reset --hard origin/develop` 하므로 uncommitted 방치 금지.
- 작업 시작 전 `git pull origin develop`.
- shared/runner 수정 시 **러너 재빌드 + 기존 프로세스 종료**를 한 세트로. (배포본 exe는 backend Docker `runner-bin` 스테이지에서 재빌드되어 `/api/runner/download`로 서빙됨 → 사용자가 재다운로드해야 반영.)
- 비-trivial 변경 후 `./scripts/check.sh`.
- 고위험 경로: `packages/shared/src/core/**`, `packages/runner/src/**`.
- TypeScript: `any` 금지, `as`로 오류 무마 금지.

---

## 6. 참고 — 토폴로지

- dev 러너 = **사용자 로컬(Windows) 머신**. OCI 백엔드 배포와 별개 경로.
- 러너 exe 다운로드: `GET /api/runner/download?os=windows` (백엔드 컨테이너가 `packages/runner/dist-bin/`에서 서빙).
- 백엔드/웹: 자소전.shop (OCI). develop push → deploy-dev.yml 자동 배포.
- 러너는 `wss://자소전.shop/runner/ws` 로 아웃바운드 연결. RPC는 backend가 `POST /api/rpc` 받아 WS로 러너에 중계.
