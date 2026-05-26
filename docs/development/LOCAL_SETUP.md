# Local Development Setup

> 이 문서는 로컬 dev 환경 초기 세팅 절차와 자주 묻는 운영 사항을 담는다.
> Claude/에이전트는 환경 관련 질문 전에 이 문서를 먼저 읽어야 한다.

---

## 1. .env.dev 생성

스크립트가 자동으로 `packages/backend/.env.dev.example` → `.env.dev` 복사를 시도하지만,
Google OAuth 크리덴셜과 COOKIE_SECRET은 직접 채워야 한다.

**운영 서버(OCI)에서 값 가져오기:**

```bash
# SSH 키 준비 (WSL 환경)
cp /mnt/c/Users/SSAFY/Documents/oracle/auth/jhserver/ssh-key-2026-02-24.key /tmp/oci.key
chmod 600 /tmp/oci.key

# 크리덴셜 확인
ssh -i /tmp/oci.key ubuntu@168.107.25.12 \
  "docker exec jasojeon-backend-1 env | grep -E 'GOOGLE_CLIENT|COOKIE_SECRET'"
```

**`packages/backend/.env.dev` 최종 내용:**

```dotenv
DATABASE_URL=postgres://jasojeon:devpass@localhost:5433/jasojeon
REDIS_URL=redis://localhost:6380
GOOGLE_CLIENT_ID=<서버에서 가져온 값>
GOOGLE_CLIENT_SECRET=<서버에서 가져온 값>
COOKIE_SECRET=<서버에서 가져온 값>
PORT=4000
NODE_ENV=development
PUBLIC_BASE_URL=http://localhost:4000
```

> `.env.dev`는 절대 커밋하지 않는다. `.gitignore`에 등록돼 있음.

---

## 2. 포트 구조

| 서비스 | 로컬 포트 | 비고 |
|--------|-----------|------|
| 웹 (Vite) | `4124` | `http://localhost:4124` |
| 백엔드 | `4000` | `http://localhost:4000` |
| Postgres | `5433` | docker-compose.dev.yml |
| Redis | `6380` | docker-compose.dev.yml |

---

## 3. 개발 시나리오별 실행 명령

### 프론트엔드 + 백엔드만 (러너 제외)
```bash
./scripts/dev-stack.sh --no-runner
```

### 웹 변경사항만 빠르게 반영 (백엔드 이미 실행 중일 때)
```bash
./scripts/apply-dev-stack.sh
```

### 전체 스택
```bash
./scripts/dev-stack.sh
```

### 특정 컴포넌트 제외 옵션
| 플래그 | 효과 |
|--------|------|
| `--no-runner` | 러너 제외 (UI/백엔드 개발 시 권장) |
| `--no-web` | 웹 제외 |
| `--no-backend` | 백엔드 제외 |
| `--no-infra` | postgres/redis 제외 (이미 떠있을 때) |
| `--skip-check` | check.sh 생략 (빠른 재시작 시) |

---

## 4. 로컬 러너 바이너리 빌드 (테스트용)

로컬 dev 서버(`localhost:4000`)에 붙는 `_local` 바이너리를 빌드하려면:

```bash
cd packages/runner
bun run build.ts --local
# → dist-bin/jasojeon-runner-windows-local.exe (localhost:4000에 연결)
```

프로덕션 바이너리:
```bash
bun run build.ts
# → dist-bin/jasojeon-runner-windows.exe (자소전.com에 연결)
```

로컬 dev 서버의 `/api/runner/download` 엔드포인트는 자동으로 `_local` 바이너리를 제공한다 (`NODE_ENV=development`일 때).

---

## 5. Google OAuth 로컬 로그인

Google Cloud Console에 `http://localhost:4000/auth/google/callback` 이 등록돼 있어서 로컬에서도 Google 로그인이 동작한다.
등록 안 돼있으면 Google Console → API 및 서비스 → OAuth 동의 화면 → 승인된 리디렉션 URI에 추가.

---

## 6. OCI 서버 SSH 접속

```bash
cp /mnt/c/Users/SSAFY/Documents/oracle/auth/jhserver/ssh-key-2026-02-24.key /tmp/oci.key
chmod 600 /tmp/oci.key
ssh -i /tmp/oci.key ubuntu@168.107.25.12
# repo: ~/jasojeon (소문자)
```

---

## 7. 자주 발생하는 에러

### `npm error No workspaces found: --workspace=packages/backend`
→ 실제 원인은 `.env.dev`가 없거나 `DATABASE_URL`이 비어있는 것. 2번 항목 참고.

### `JASOJEON_BACKEND_URL is not set`
→ 러너 실행 시 백엔드 URL이 없는 것. `./scripts/start-dev-runner.sh` 는 `.env.dev`에서 자동으로 읽음.

### 포트 충돌
```bash
./scripts/stop-dev-stack.sh  # 기존 프로세스 정리 후 재시작
```

---

## 8. 테스트 서버 (자소전.shop) 운영

| 항목 | 값 |
|------|-----|
| 도메인 | `xn--9l4b13i8j.shop` (한글: 자소전.shop) |
| 서버 | OCI 168.107.25.12 (`ubuntu@`) |
| 레포 경로 | `~/project/Jasojeon` (develop 체크아웃) |
| 배포 트리거 | `develop` 브랜치 push → `.github/workflows/deploy-dev.yml` |
| 스택 | `docker-compose.dev.yml` (pg 5433, redis 6380, backend 4000, nginx 80/443) + host Vite 4124 |
| systemd unit | `jasojeon-dev.service` (user scope, `Type=oneshot`, `RemainAfterExit=yes`, `TimeoutStartSec=300`, `linger=yes`) |
| 재시작 명령 | `systemctl --user restart jasojeon-dev.service` |
| 상태 확인 | `systemctl --user is-active jasojeon-dev.service` |
| 로그 | `journalctl --user -u jasojeon-dev.service -n 200 --no-pager` |

**주의**: 이 서버의 `~/project/Jasojeon` 파일을 직접 수정하지 않는다. deploy 가
`git reset --hard origin/develop` 로 덮어쓴다. 수정이 필요하면 로컬에서 commit →
`git push origin develop` → 자동 배포 확인.

---

## 9. 자소전.shop edge nginx Basic Auth + 러너 예외 (서버 전용, repo 밖)

`.shop`(dev/staging) 은 **edge(prod) nginx 가 SSL 종단 + Basic Auth** 로 외부 노출을 막는다.
이 설정 파일들은 `.gitignore` 대상이라 repo 에 없고 **OCI 서버에만** 존재한다:

| 파일 (호스트) | 역할 |
|---------------|------|
| `/home/ubuntu/jasojeon-dev-nginx/dev-jasojeon.conf` | `.shop` vhost — edge nginx(`jasojeon-prod-nginx-1`)에 bind-mount. `satisfy any` = IP allowlist(`121.151.242.246`) **또는** Basic Auth |
| `/home/ubuntu/jasojeon-dev-nginx/dev-jasojeon.htpasswd` | Basic Auth 사용자 |

**hosted 러너는 Basic Auth 자격증명을 보내지 않는다.** 따라서 페어링/연결 경로는
`auth_basic off; allow all;` 로 예외 처리되어 있다 (각 경로는 자체 보안 보유):

- `^~ /auth/device-claim` — claim 등록(설계상 무인증) + 폴링(pollToken)
- `= /auth/device/resolve` — deviceToken 으로 보호 (없으면 404)
- `= /runner/ws` — device token 인증

그 외(`/`, `/api/`, SPA)는 Basic Auth 유지. 예외를 빠뜨리면 러너가 `POST /auth/device-claim`
에서 **401** 을 받아 페어링 자체가 시작되지 않는다 (`No backends could be connected. Exiting.`).

> 수정 절차: 호스트 파일 편집 → `docker exec jasojeon-prod-nginx-1 nginx -t` →
> 통과 시 `nginx -s reload` (restart 아님). 편집 전 `.bak-<ts>` 백업 필수.
> 이 설정은 deploy 로 재생성되지 않는 prod 스택이므로 직접 관리한다.
