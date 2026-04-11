# Jasojeon 웹/러너 하네스 설계서

> `forJob`의 저장소 하네스를 Jasojeon 현재 구조에 맞게 변형하고, 기존 VSIX 설치 하네스를 웹 UI + 로컬 러너 개발 적용 하네스로 재정의하는 설계

---

## 1. 문제 정의

Jasojeon는 이미 `웹 UI + localhost 러너` 구조로 옮겨왔지만, 저장소 차원의 개발 하네스는 거의 없는 상태다.

현재 문제는 크게 두 가지다.

- 저장소 차원의 검증/운영 하네스 plane이 없다
- WSL 환경에서 `node`와 `npm` 경로가 자주 꼬여, 세션이 바뀔 때마다 같은 실수가 반복된다

특히 이번 세션에서 실제로 확인된 상태는 아래와 같다.

- `node`는 `/home/cbkjh0225/.local/bin/node`로 정상 실행된다
- `npm`은 `/home/cbkjh0225/.nvm/versions/node/v22.22.2/bin/npm`를 가리키지만
- 내부적으로 `\\wsl.localhost\Ubuntu\...` 경로를 참조하며 실패한다

즉, 사람이나 워커가 "이번엔 조심해서 올바른 node를 쓰자"로 해결할 문제가 아니다. 저장소가 아예 **안전한 실행 경로를 강제하는 하네스**를 가져야 한다.

---

## 2. 목표

- Jasojeon에 `forJob`식 저장소 하네스 plane을 도입하되 현재 웹/러너 구조에 맞게 변형한다
- 기존 VSIX 재설치 하네스 개념을 버리고, **웹 UI + 로컬 러너 개발 적용 하네스**로 교체한다
- WSL `node/npm` 문제를 하네스에서 흡수해, 세션마다 같은 삽질을 반복하지 않게 만든다
- 결정적 검증과 개발용 live apply를 분리해 운영한다

---

## 3. 현재 구조 진단

### 3.1 런타임 구조

현재 Jasojeon의 런타임 진입점은 이미 명확하다.

- `packages/web`: React + Vite 브라우저 UI
- `packages/runner`: Express + WebSocket 기반 localhost 러너
- `packages/shared`: 오케스트레이터, 스토리지, 스키마, 타입, 상태 모델

러너는 아래 진입점을 갖는다.

- `GET /api/session`
- `GET /api/status`
- `WS /ws/state`
- `WS /ws/runs/:runId`

즉, 개발 적용 하네스가 검증해야 할 실제 대상은 VS Code 확장 설치가 아니라 **로컬 dev 서버 2개와 러너 상태 채널**이다.

### 3.2 저장소 차원 구조

현재 루트에는 아래가 없다.

- `docs/development/`
- `tools/`
- `.github/`
- `scripts/`

또한 루트 `package.json`은 workspace 스크립트를 `npm run -w ...` 형태로 호출하고 있어, `npm` shim이 깨진 환경에서는 저장소 차원의 기본 명령 자체가 불안정하다.

---

## 4. 접근 옵션

### 옵션 A. 문서만 추가하고 기존 `npm run` 흐름 유지

- `docs/development/*`만 추가
- 실행은 계속 `npm run build`, `npm run dev:*`에 의존

장점

- 가장 작은 변경이다

단점

- 핵심 문제인 WSL `npm` 오류를 해결하지 못한다
- 세션이 바뀔 때마다 같은 실패가 반복된다

### 옵션 B. 저장소 하네스 plane + 안전 실행 래퍼 + 개발 적용 하네스 도입

- `forJob`식 하네스 plane 추가
- `with-node.sh`, `with-npm.sh` 같은 안전 래퍼 추가
- `start/stop/status/apply` 개발 하네스 추가
- 루트 검증 명령을 하네스 기반으로 재정의

장점

- 현재 문제를 구조적으로 해결한다
- WSL 환경 실수를 재발 방지할 수 있다
- 웹/러너 개발 루프를 표준화할 수 있다

단점

- 셸 스크립트와 운영 문서가 다소 늘어난다

### 옵션 C. 곧바로 실사용 빌드/배포형 하네스로 간다

- 웹을 항상 build
- 러너가 build 결과를 서빙
- 개발 적용도 배포형 흐름으로 고정

장점

- 실사용 형태와 가장 가깝다

단점

- 이번 요구인 "개발용 적용 하네스"에 비해 무겁다
- 빠른 반복 개발 루프를 해친다

### 권장안

**옵션 B를 권장한다.**

이번 요구는 배포 하네스보다 먼저 **개발자와 워커가 안정적으로 같은 방식으로 실행할 수 있는 제어면**을 만드는 것이 핵심이다.

---

## 5. 제안 아키텍처

### 5.1 두 개의 plane

Jasojeon 저장소를 아래 두 plane으로 나눈다.

1. Product plane
- `packages/shared/**`
- `packages/runner/**`
- `packages/web/**`

2. Development-harness plane
- `docs/development/**`
- `tools/**`
- `scripts/**`
- `.github/**`
- 루트 `package.json`

핵심 원칙은 `forJob`와 동일하다.

- 제품 동작을 바꾸는 코드와
- 저장소 운영/검증/개발 워크플로우를 바꾸는 코드를

같은 개념으로 다루지 않는다.

### 5.2 안전 실행 래퍼

하네스는 raw `npm`에 직접 의존하지 않는다.

도입 대상:

- `scripts/with-node.sh`
  - usable Linux `node` 바이너리를 찾는다
  - 찾은 `node`로 하위 명령을 실행한다

- `scripts/with-npm.sh`
  - 깨진 `npm` shim을 호출하지 않는다
  - 실제 `npm-cli.js`를 찾아 `with-node.sh`로 실행한다

이 구조의 핵심은 다음과 같다.

- shell에서 `npm` binary를 직접 실행하지 않는다
- 항상 "검증된 node + npm-cli.js" 조합으로만 `npm`을 호출한다

### 5.3 개발 적용 하네스

기존 `forJob`의 `deploy-wsl-extension.sh` 역할을 Jasojeon에서는 아래 흐름으로 치환한다.

```text
check -> runner dev restart -> web dev restart -> endpoint status 확인
```

도입 대상:

- `scripts/check.sh`
- `scripts/start-dev-runner.sh`
- `scripts/start-dev-web.sh`
- `scripts/stop-dev-stack.sh`
- `scripts/status-dev-stack.sh`
- `scripts/apply-dev-stack.sh`

### 5.4 프로세스 관리

개발 하네스는 백그라운드 프로세스를 명시적으로 관리한다.

저장 위치:

- `.harness/pids/runner.pid`
- `.harness/pids/web.pid`
- `.harness/logs/runner.log`
- `.harness/logs/web.log`

`status-dev-stack.sh`는 아래를 확인한다.

- pid 파일 존재 여부
- 해당 pid가 실제로 살아 있는지
- 러너 `/api/status` 응답
- 웹 dev 서버 포트 응답

### 5.5 검증 계층

결정적 검증과 live apply를 분리한다.

결정적 검증

- TypeScript build
- shared test suite
- runner typecheck
- web build
- 문서 링크 검증

Live apply

- runner dev 프로세스 기동
- web dev 프로세스 기동
- 로컬 endpoint/status 확인

required check에 live apply를 넣지 않는다.

---

## 6. 패키지/명령 구조

루트 `package.json`은 계속 유지하되, 내부 구현은 하네스 스크립트로 위임한다.

예시 명령:

- `npm run build`
- `npm run test`
- `npm run docs-check`
- `npm run smoke:local`
- `npm run dev:runner`
- `npm run dev:web`
- `npm run dev:apply`
- `npm run dev:status`
- `npm run dev:stop`

단, WSL 환경에서는 raw `npm run ...`보다 아래를 우선 문서화한다.

- `./scripts/with-npm.sh run build`
- `./scripts/with-npm.sh run dev:apply`
- 또는 `./scripts/*.sh` 직접 실행

즉, **공식 하네스 진입점은 `scripts/`**이고, `package.json`은 그에 대한 얇은 alias로만 둔다.

---

## 7. 문서/리뷰 scaffold

도입 대상:

- `docs/development/ARCHITECTURE.md`
- `docs/development/OPERATING_RULES.md`
- `.github/pull_request_template.md`
- `tools/validate-doc-links.ts`
- `tsconfig.tools.json`

초기 단계에서는 `forJob`의 `validate-agent-specs.ts` 같은 런타임 계약 검증은 가져오지 않는다.

이유:

- Jasojeon에는 아직 `agents/`와 같은 별도 runtime contract surface가 없다
- 지금 가장 필요한 것은 `docs/scripts/package` 수준의 하네스 안정화다

---

## 8. 검증 계획

구현 후 최소 검증은 아래 순서를 따른다.

1. `./scripts/check.sh`
2. `./scripts/apply-dev-stack.sh`
3. `./scripts/status-dev-stack.sh`

기대 결과:

- build/test/docs-check 통과
- runner dev 프로세스 정상 기동
- web dev 프로세스 정상 기동
- `/api/status` 정상 응답
- 웹 dev URL 정상 응답

---

## 9. 비범위

이번 작업에 포함하지 않는 것:

- 프로덕션 배포 하네스
- systemd/pm2 같은 상시 서비스 관리
- Docker 기반 개발 스택
- GitHub Actions workflow까지의 완전 자동화
- runtime contract validator의 과도한 확장

---

## 10. 결론

Jasojeon에서 필요한 하네스는 더 이상 VS Code 확장 재설치 하네스가 아니다.

필요한 것은 다음 두 가지다.

- 저장소 차원의 개발 하네스 plane
- WSL `node/npm` 문제를 우회하는 안전 실행/적용 하네스

따라서 `forJob`에서 가져올 것은 "VSIX 설치"가 아니라 "운영 모델과 검증 제어면"이며, Jasojeon에서는 이를 **웹 + 로컬 러너 개발 적용 하네스**로 변형해 도입한다.
