---
date: 2026-04-19
status: confirmed
scope: harness — CI/CD 3-workflow 전환
branches: develop (테스트/자소전.shop) + main (프로덕션, 휴면 유지)
---

# 2026-04-19 — CI/CD 3-워크플로 전환 (test + deploy-dev + deploy)

**목적**: Jasojeon 모노레포에 `test` / `deploy-dev` / `deploy` 세 개 워크플로를 두고,
로컬 Claude + nanoclaw 봇 두 경로가 `develop` 브랜치로 수렴해 자소전.shop
(OCI 168.107.25.12) 테스트 서버에 자동 배포되도록 한다. `main` 프로덕션 배포
파이프라인(`deploy.yml`)은 **이 plan 범위 밖** 이며 시그니처를 건드리지 않는다.

**선결 조건 (사용자 수동, §4)**: CI 전용 SSH 키 신규 발급 + `OCI_SSH_KEY` secret 교체.
Codex 는 서버 SSH 권한이 없으므로 그 단계만 사용자가 수행한다.

**드라이빙 컨텍스트**:
- 실측 서버 스택: `~/project/Jasojeon/` + `docker-compose.dev.yml` + `jasojeon-dev.service`
  (systemd --user, linger=yes, `TimeoutStartSec=300`)
- Vite dev 4124 / backend 4000 / postgres 5433 / redis 6380 / nginx 80·443
- nanoclaw 봇이 `~/project/Jasojeon` 을 volume mount 로 쓰기 가능 → race condition 존재
- 기존 `.github/workflows/deploy.yml` 은 main 전용, 현재 `~/jasojeon/` 에 `.env.production`
  없어 유휴 상태 (손대지 않음)

---

## 목차

1. 결정사항 요약
2. 신규 파일 (test.yml, deploy-dev.yml)
3. 수정 파일 (CLAUDE.md, LOCAL_SETUP.md, GIT_WORKFLOW.md)
4. 사용자 수동 단계 (선결 조건 포함)
5. Codex 실행 순서
6. 검증 계획
7. 리스크 및 롤백
8. Non-goals
9. 참조

---

## 1. 결정사항 요약

| ID | 결정 | 근거 |
|----|------|------|
| D1 | 3-워크플로 구조: `test.yml` (PR 게이트) + `deploy-dev.yml` (develop push) + 기존 `deploy.yml` (main 유지) | 로컬+봇 두 entry point 의 수렴 지점을 develop 으로 고정 |
| D2 | CI 전용 ed25519 SSH 키 신규 발급, `OCI_SSH_KEY` secret 교체 | 개인 키를 GitHub secret 에 두는 보안 리스크 제거 |
| D3 | 로컬 `CLAUDE.md` + 서버 nanoclaw `CLAUDE.md` 두 곳에 `develop` 동기화 규약 명문화 | Race condition 을 규약으로 해결 (구조 변경 회피) |
| D4 | 서버 재시작 경로를 `systemctl --user restart jasojeon-dev.service` 로 단일화 | 기존 unit 이 backend + web 두 스크립트를 묶어 관리 |
| D5 | `test.yml` 에 `PUPPETEER_SKIP_DOWNLOAD=true` + `actions/cache@v4` for `~/.cache/puppeteer` | Chromium 다운로드 3–5분 절감. puppeteer 는 DI 로 stub 되어 단위 테스트 영향 없음 (증거: `packages/runner/src/test/puppeteerFetcher.test.ts` 의 `PuppeteerLike`) |
| D6 | `git pull` ↔ nanoclaw 경합은 **규약**으로만 해결. `~/project/Jasojeon-work/` 분리 체크아웃은 future (§8) | YAGNI, 현 시점 단일 사용자 |
| D7 | `deploy.yml` / `~/jasojeon/` 전혀 수정 안 함 | main prod 복원은 별도 plan |
| D8 | `deploy-dev.yml` 실패 시 `journalctl --user -u jasojeon-dev.service -n 50 --no-pager` 수집 | 진단 비용 저렴, `if: failure()` step 으로 분리 |
| D9 | 서버에서 의존성 설치는 `./scripts/with-npm.sh install` (ci 아님) | dev 서버는 hot restart 성격. `ci` 는 node_modules 삭제 + 재설치라 과도함. WSL/node 안전 래퍼를 재사용 |
| D10 | 러너 바이너리 빌드 파이프라인 = 옵션 B (GitHub Actions → rsync). `build.ts` 에 `JASOJEON_RUNNER_BACKEND_URL` env override 추가 | 서버 CPU 부담 회피 + Bun cross-compile 은 ubuntu runner 에서 잘 동작. main/develop 동일 구조 확장 가능 |
| D11 | dev 바이너리 파일명은 `-local` suffix 유지 (내용은 `.shop` BACKEND_URL) | `runnerDownload.ts:34-36` 이 `NODE_ENV !== production` 일 때 `-local` 파일을 서빙. 최소 변경. suffix 재명명은 다음 plan. |
| D12 | Puppeteer 번들 실증은 첫 배포 후 검증 (SPA 추출 성공 여부) | bun --compile 이 Chromium 외부 바이너리를 단일 executable 에 embed 못 하므로 실패 가능. Phase 2 별도 plan. |

### 도메인 매핑 (사용자 확정)

| 브랜치 | 서버 디렉토리 | 도메인 | 용도 |
|--------|-------------|--------|------|
| `main` | `/home/ubuntu/jasojeon/` | **자소전.com** (`xn--9l4b13i8j.com`) | 프로덕션 (현재 휴면) |
| `develop` | `/home/ubuntu/project/Jasojeon/` | **자소전.shop** (`xn--9l4b13i8j.shop`) | 테스트 배포 |

---

## 2. 신규 파일

### 2.1 `.github/workflows/test.yml`

전체 내용을 아래와 같이 생성한다. 주석 포함. trailing newline 유지.

```yaml
name: Test

# PR 게이트: develop / main 을 타겟으로 한 모든 PR 에서 실행.
# 수동 트리거(workflow_dispatch)로도 돌릴 수 있다.
on:
  pull_request:
    branches: [develop, main]
  workflow_dispatch:

# 최소 권한: 코드만 읽는다.
permissions:
  contents: read

# 같은 PR 에서 여러 번 push 할 때 이전 실행은 취소.
concurrency:
  group: test-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    name: scripts/check.sh
    runs-on: ubuntu-latest
    timeout-minutes: 15

    env:
      # Chromium 바이너리 다운로드를 건너뜀.
      # puppeteer 는 PuppeteerLike 로 DI 되어 있어 단위 테스트엔 실 브라우저 불필요.
      # 근거: packages/runner/src/test/puppeteerFetcher.test.ts
      PUPPETEER_SKIP_DOWNLOAD: "true"

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      # 이미 캐시가 있으면 그대로, 없으면 빈 디렉토리 캐시.
      # SKIP=true 와 병존 가능 — 향후 플래그 해제 시 즉시 재활용.
      - name: Restore puppeteer cache
        uses: actions/cache@v4
        with:
          path: ~/.cache/puppeteer
          key: puppeteer-${{ runner.os }}-${{ hashFiles('packages/runner/package.json') }}
          restore-keys: |
            puppeteer-${{ runner.os }}-

      - name: Install dependencies
        run: npm ci

      - name: Deterministic checks
        run: ./scripts/check.sh
```

**요구사항 체크리스트**:
- trigger: `pull_request.branches: [develop, main]` + `workflow_dispatch` ✔
- runner: `ubuntu-latest`, Node 20, `cache: npm` ✔
- env `PUPPETEER_SKIP_DOWNLOAD=true` ✔
- steps: checkout → setup-node → cache → `npm ci` → `./scripts/check.sh` ✔
- `timeout-minutes: 15` ✔
- `permissions: contents: read` ✔

---

### 2.2 `.github/workflows/deploy-dev.yml`

**2-job 구조**: `runner-build` (ubuntu 에서 bun cross-compile) → `deploy` (SSH + rsync + systemctl restart).
`deploy` 는 `needs: runner-build` 로 대기. runner-build 실패 시 deploy 진입 안 함.

```yaml
name: Deploy to Dev (자소전.shop)

# develop 브랜치 push = 테스트 환경 배포.
# 수동 재배포는 workflow_dispatch 로.
on:
  push:
    branches: [develop]
  workflow_dispatch:

permissions:
  contents: read

# 동시 배포 충돌 방지. cancel-in-progress=false 로 큐잉 전략.
# 주의: 빠른 연속 push 시 배포가 큐에 쌓여 순차 실행된다. 건너뛰지 않음.
concurrency:
  group: deploy-dev
  cancel-in-progress: false

jobs:
  # ---- Job 1: 러너 바이너리 빌드 (ubuntu runner, bun cross-compile) ----
  # D10: 서버 CPU 부담 회피. 4 플랫폼 (windows-x64, mac-arm64/x64, linux-x64) 바이너리 생성.
  # BACKEND_URL 은 자소전.shop 으로 박아서 테스트 사용자가 받은 러너가 dev backend 로 연결.
  # D11: 파일명은 `-local` suffix (runnerDownload.ts 의 LOCAL_FILE_MAP 호환).
  # D12: Puppeteer 번들링은 첫 배포 후 실증. 실패 시 Phase 2 별도 plan.
  runner-build:
    name: Build runner binaries (bun --compile)
    runs-on: ubuntu-latest
    timeout-minutes: 15

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - name: Setup Bun
        uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      # Puppeteer Chromium 다운로드 스킵 — 바이너리 컴파일에는 불필요.
      # 런타임 동작 이슈(D12)는 첫 배포 후 별도 검증.
      - name: Install dependencies
        env:
          PUPPETEER_SKIP_DOWNLOAD: "true"
        run: npm ci

      - name: Build runner binaries (BACKEND_URL=자소전.shop, --local suffix)
        env:
          JASOJEON_RUNNER_BACKEND_URL: "https://xn--9l4b13i8j.shop"
        run: |
          cd packages/runner
          bun run build.ts --local

      - name: List built binaries
        run: ls -la packages/runner/dist-bin/

      - name: Upload runner artifacts
        uses: actions/upload-artifact@v4
        with:
          name: runner-binaries
          path: packages/runner/dist-bin/
          retention-days: 7

  # ---- Job 2: 서버 배포 (SSH: git reset + install + rsync dist-bin + systemctl restart) ----
  deploy:
    name: Deploy to OCI (자소전.shop)
    runs-on: ubuntu-latest
    needs: runner-build
    timeout-minutes: 15

    steps:
      - name: Checkout (metadata only)
        uses: actions/checkout@v4

      - name: Download runner artifacts
        uses: actions/download-artifact@v4
        with:
          name: runner-binaries
          path: /tmp/runner-dist-bin

      - name: Validate secrets
        env:
          OCI_HOST: ${{ secrets.OCI_HOST }}
          OCI_USER: ${{ secrets.OCI_USER }}
          OCI_SSH_KEY: ${{ secrets.OCI_SSH_KEY }}
        run: |
          if [ -z "$OCI_HOST" ]; then echo "::error::OCI_HOST secret is empty"; exit 1; fi
          if [ -z "$OCI_USER" ]; then echo "::error::OCI_USER secret is empty"; exit 1; fi
          if [ -z "$OCI_SSH_KEY" ]; then echo "::error::OCI_SSH_KEY secret is empty"; exit 1; fi
          echo "All secrets present. Host length: ${#OCI_HOST}, User: $OCI_USER"

      - name: Prepare SSH key
        env:
          OCI_SSH_KEY: ${{ secrets.OCI_SSH_KEY }}
        run: |
          printf '%s\n' "$OCI_SSH_KEY" > /tmp/deploy_key
          chmod 600 /tmp/deploy_key

      - name: Deploy to dev stack (git reset + install + systemctl restart)
        env:
          OCI_HOST: ${{ secrets.OCI_HOST }}
          OCI_USER: ${{ secrets.OCI_USER }}
        run: |
          ssh -i /tmp/deploy_key \
            -o StrictHostKeyChecking=no \
            -o ConnectTimeout=30 \
            "${OCI_USER}@${OCI_HOST}" \
            'set -euo pipefail
            cd ~/project/Jasojeon
            echo "=== git fetch ==="
            git fetch origin develop
            echo "=== git reset --hard origin/develop ==="
            git reset --hard origin/develop
            echo "=== install deps (with-npm.sh install) ==="
            ./scripts/with-npm.sh install
            echo "=== ensure dist-bin dir ==="
            mkdir -p packages/runner/dist-bin
            echo "=== restart jasojeon-dev.service ==="
            systemctl --user restart jasojeon-dev.service
            echo "=== verify is-active ==="
            systemctl --user is-active jasojeon-dev.service
            echo "=== deploy done ==="'

      - name: Rsync runner binaries to server
        env:
          OCI_HOST: ${{ secrets.OCI_HOST }}
          OCI_USER: ${{ secrets.OCI_USER }}
        run: |
          # chmod +x 로컬에서 부여 후 rsync 가 permission 보존
          chmod +x /tmp/runner-dist-bin/* || true
          rsync -avz --delete \
            -e "ssh -i /tmp/deploy_key -o StrictHostKeyChecking=no" \
            /tmp/runner-dist-bin/ \
            "${OCI_USER}@${OCI_HOST}:~/project/Jasojeon/packages/runner/dist-bin/"
          echo "=== rsync done ==="

      - name: Verify runner binaries on server
        env:
          OCI_HOST: ${{ secrets.OCI_HOST }}
          OCI_USER: ${{ secrets.OCI_USER }}
        run: |
          ssh -i /tmp/deploy_key \
            -o StrictHostKeyChecking=no \
            "${OCI_USER}@${OCI_HOST}" \
            'ls -la ~/project/Jasojeon/packages/runner/dist-bin/'

      - name: Cleanup SSH key
        if: always()
        run: rm -f /tmp/deploy_key

      # 실패 시에만 systemd 저널 마지막 50줄 수집. 진단 저렴.
      - name: Collect failure logs
        if: failure()
        env:
          OCI_HOST: ${{ secrets.OCI_HOST }}
          OCI_USER: ${{ secrets.OCI_USER }}
          OCI_SSH_KEY: ${{ secrets.OCI_SSH_KEY }}
        run: |
          printf '%s\n' "$OCI_SSH_KEY" > /tmp/deploy_key_fail
          chmod 600 /tmp/deploy_key_fail
          ssh -i /tmp/deploy_key_fail \
            -o StrictHostKeyChecking=no \
            -o ConnectTimeout=30 \
            "${OCI_USER}@${OCI_HOST}" \
            'journalctl --user -u jasojeon-dev.service -n 50 --no-pager || true
             systemctl --user status jasojeon-dev.service --no-pager || true' \
            || echo "Failed to collect logs (SSH or systemctl unavailable)"
          rm -f /tmp/deploy_key_fail
```

**요구사항 체크리스트**:
- trigger: `push.branches: [develop]` + `workflow_dispatch` ✔
- concurrency: group `deploy-dev`, cancel-in-progress `false` ✔
- 2-job 구조: runner-build (Bun cross-compile) → deploy (SSH + rsync) ✔ (D10)
- `JASOJEON_RUNNER_BACKEND_URL=https://xn--9l4b13i8j.shop` env override ✔ (D10, D11)
- Validate secrets step ✔
- SSH ExecStart 내용 (fetch → reset --hard → install → restart → is-active) ✔
- rsync `dist-bin/` 으로 4 플랫폼 바이너리 배포 ✔
- `timeout-minutes: 15` ✔ (각 job)
- 실패 시 systemd journal last 50 lines + service status ✔ (D8)

**설계 메모**:
- `git reset --hard origin/develop` 을 사용하는 이유: nanoclaw 가 서버에서 실수로
  uncommitted 로컬 변경을 만든 상태여도 `git pull` 은 merge conflict 로 멈추지만,
  deploy 는 "develop HEAD 와 일치" 가 진실이어야 한다. 규약 위반 감지는 R1 참조.
- `TimeoutStartSec=300` (systemd unit) × GitHub Actions `timeout-minutes: 15`
  = 부팅 5분 여유 + 네트워크/설치 10분 여유.

---

## 3. 수정 파일

### 3.1 `CLAUDE.md` (레포 루트)

기존 구조를 보존하고, `## Official Entrypoints (WSL-safe)` 섹션과
`## Planes — Keep Them Separate` 섹션 사이에 다음 섹션을 **신규 삽입**한다.

```markdown
---

## Branch / Deploy Workflow

| 브랜치 | 환경 | 자동 배포 |
|--------|------|-----------|
| `develop` | 테스트 (자소전.shop, OCI 168.107.25.12) | push → `.github/workflows/deploy-dev.yml` |
| `main` | 프로덕션 (휴면 중) | push → `.github/workflows/deploy.yml` (현재 `.env.production` 없어 실효 없음) |

### 작업 규약 (로컬 Claude + nanoclaw 봇 공통)

1. **모든 작업은 `develop` 브랜치에 commit + `git push origin develop`** 으로 수렴한다.
   서버 `~/project/Jasojeon` 파일을 직접 편집하고 방치 금지 (deploy-dev.yml 의
   `git reset --hard origin/develop` 가 날려버린다).
2. **로컬 작업 시작 전** 반드시 `git pull origin develop`.
3. **`main`** 은 `develop → main` PR merge 로만 전진시킨다 (현 plan 범위 밖, 휴면).
4. PR 은 `develop` 을 base 로 연다. `test.yml` 이 PR 게이트.

> 서버 ↔ 로컬 ↔ 봇 race condition 완화를 위해 위 규약은 강제 규칙이다. 구조적 격리
> (예: `~/project/Jasojeon-work/` 별도 checkout) 는 현재 single user 라 YAGNI.
```

### 3.2 `docs/development/LOCAL_SETUP.md`

`## 7. 자주 발생하는 에러` 섹션 뒤에 다음 섹션을 **신규 추가** 한다
(현재 최대 번호가 7이므로 `## 8. 테스트 서버 (자소전.shop) 운영`).

```markdown
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
```

### 3.3 `packages/runner/build.ts` (env override 추가)

현재 `build.ts:18-20`:
```ts
const BACKEND_URL = isLocal
  ? "http://localhost:4000"
  : "https://xn--9l4b13i8j.com";
```

아래로 교체 (최소 변경, backward compatible):
```ts
// 우선순위: env override > --local 플래그 > 기본(자소전.com, main prod)
const BACKEND_URL =
  process.env.JASOJEON_RUNNER_BACKEND_URL
  ?? (isLocal ? "http://localhost:4000" : "https://xn--9l4b13i8j.com");
```

**사용 예시**:
- main prod 빌드 (미래): env 없음 → `https://xn--9l4b13i8j.com` (자소전.com)
- develop dev 빌드 (deploy-dev.yml): `JASOJEON_RUNNER_BACKEND_URL=https://xn--9l4b13i8j.shop` + `--local` → 파일명 `-local` suffix, 내용 `.shop` BACKEND_URL
- 로컬 개발: `--local` 만 → `http://localhost:4000` (기존 동작 유지)

### 3.4 `docs/development/GIT_WORKFLOW.md`

**이 파일의 기존 내용은 현재 plan 이후 misleading 이 된다** (main=핫, dev=불확실 →
실제는 develop=테스트 핫, main=휴면). 다음 두 섹션을 치환한다.

**치환 1**: `## 브랜치 전략` 테이블을 아래로 교체

```markdown
## 브랜치 전략

| 브랜치 | 역할 | 자동 배포 |
|--------|------|-----------|
| `develop` | 테스트 환경 (자소전.shop) 기준. push → GitHub Actions 자동 배포. | `.github/workflows/deploy-dev.yml` |
| `main` | 프로덕션 기준 (현재 휴면). push 시 기존 `deploy.yml` 이 돌지만 `.env.production` 미정비로 실효 없음. | `.github/workflows/deploy.yml` |
| `feat/<name>` | 기능 단위 작업 브랜치. 완료 시 `develop` 으로 PR. | — |
| `fix/<name>` | 버그 픽스 브랜치. `develop` 으로 PR. | — |

### PR base
- 기본: `develop`
- 프로덕션 승격: `develop → main` (수동, 별도 plan)
```

**치환 2**: `## CI/CD` 섹션 전체 교체

```markdown
## CI/CD

### 워크플로 구성 (3개)

| 파일 | 트리거 | 역할 |
|------|--------|------|
| `.github/workflows/test.yml` | `pull_request: [develop, main]` + manual | `./scripts/check.sh` (공용 게이트) |
| `.github/workflows/deploy-dev.yml` | `push: develop` + manual | 자소전.shop 자동 재배포 (SSH → git reset --hard → with-npm install → systemctl restart) |
| `.github/workflows/deploy.yml` | `push: main` | 프로덕션 배포 (현재 휴면) |

### deploy-dev 서버 실행 내용

```
cd ~/project/Jasojeon
git fetch origin develop
git reset --hard origin/develop
./scripts/with-npm.sh install
systemctl --user restart jasojeon-dev.service
systemctl --user is-active jasojeon-dev.service
```

### 로컬 배포 전 검증

```
./scripts/check.sh
```

### 주의사항

- `develop` force push 금지. 봇/로컬 race 시 commit 순서로 해결.
- `main` force push 금지.
- 서버 `~/project/Jasojeon` 직접 편집 금지 (다음 배포가 덮어쓴다).
```

---

## 4. 사용자 수동 단계 (Codex 범위 밖)

Codex 는 GitHub Actions YAML + 레포 문서만 쓸 수 있다. 아래 항목들은 서버 SSH
접근 / GitHub repo secret 편집 / 서버 전용 파일 수정이 필요해 **사용자가 직접 수행**
한다. 이 섹션 전체가 deploy-dev.yml 첫 실행 전에 완료되어야 한다.

### 4.1 [선결조건] CI 전용 SSH 키 발급 (D2)

기존 `OCI_SSH_KEY` 가 사용자 개인 키였다면 반드시 교체한다.

```bash
# 1) 서버에서 deploy 전용 키 발급 (ubuntu 유저로)
ssh ubuntu@168.107.25.12
ssh-keygen -t ed25519 -f ~/.ssh/jasojeon_ci_deploy -N "" -C "jasojeon CI deploy (develop→dev)"

# 2) pubkey 를 authorized_keys 에 추가
cat ~/.ssh/jasojeon_ci_deploy.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

# 3) privkey 값을 복사
cat ~/.ssh/jasojeon_ci_deploy
```

- [ ] 서버에서 키 생성 완료
- [ ] authorized_keys 에 pubkey 추가됨
- [ ] GitHub 리포지토리 Settings → Secrets and variables → Actions 에서
      **`OCI_SSH_KEY` secret 을 새 privkey 값으로 교체** (덮어쓰기)
- [ ] `OCI_HOST` = `168.107.25.12`, `OCI_USER` = `ubuntu` 값 확인 (기존 유지)
- [ ] 로컬에서 `ssh -i ~/.ssh/jasojeon_ci_deploy ubuntu@168.107.25.12 'echo ok'` 로
      새 키 동작 검증 (선택적 smoke test)

### 4.2 서버 nanoclaw CLAUDE.md 규약 추가 (D3)

파일: `/home/ubuntu/nanoclaw/groups/discord_jasojeon/CLAUDE.md` (레포 밖 → Codex 접근 불가)

아래 섹션을 기존 파일 맨 끝에 append 한다.

```markdown
---

## Jasojeon develop branch 동기화 규약 (필독)

이 봇은 `/home/ubuntu/project/Jasojeon/` 을 volume mount 로 쓰기 가능하다. 하지만
같은 경로를 GitHub Actions `deploy-dev.yml` 이 `git reset --hard origin/develop`
으로 덮어쓴다. 따라서 다음을 강제한다.

1. 파일 수정 요청을 받으면 반드시 `cd /home/ubuntu/project/Jasojeon` 에서 작업한다.
2. 작업 후 즉시 `git add -A && git commit -m "..." && git push origin develop` 한다.
   커밋/푸시 없이 방치된 변경은 다음 배포에서 소실된다.
3. 작업 시작 전 `git fetch origin && git reset --hard origin/develop` 으로 최신 상태 확보.
4. 배포 파이프라인과 경합을 피하려면 push 후 최소 1–2분 뒤 다음 작업을 시작한다
   (systemd restart 5분 타임아웃 + 캐시 재구성 완료 대기).
5. 로컬 Claude (사용자 데스크탑) 도 같은 규약을 따른다. 두 경로 모두 `develop` 에서 수렴.

> Race 근본 해결 (`~/project/Jasojeon-work/` 별도 checkout) 은 미래 옵션으로만 추적.
```

- [ ] 서버에서 위 텍스트를 `/home/ubuntu/nanoclaw/groups/discord_jasojeon/CLAUDE.md` 에 append
- [ ] nanoclaw 봇 재시작은 불필요 (CLAUDE.md 는 실행 시 재로딩)

### 4.3 첫 push 후 확인

deploy-dev.yml 커밋이 develop 에 들어가는 순간 워크플로가 첫 실행된다.

- [ ] GitHub Actions 탭에서 `Deploy to Dev (자소전.shop)` run 녹색 확인
  - runner-build job 성공 (artifact `runner-binaries` 업로드)
  - deploy job 성공 (rsync 로 dist-bin 전송)
- [ ] 서버에서 `systemctl --user is-active jasojeon-dev.service` → `active`
- [ ] 서버 `cd ~/project/Jasojeon && git log --oneline -1` HEAD 가 신규 커밋
- [ ] 서버 `ls ~/project/Jasojeon/packages/runner/dist-bin/` 에 바이너리 4개 (`-local` suffix)
- [ ] 자소전.shop (xn--9l4b13i8j.shop) 정상 렌더링
- [ ] 자소전.shop `/api/runner/download?os=linux` (또는 호스트 OS) 로 다운로드 → 파일 크기 비-0
- [ ] 다운받은 러너 기동 후 일반 공고 1건 (예: 잡코리아) 추출 성공
- [ ] (R6 실증) SPA 공고 1건 (예: jumpit) 추출 시도 — 실패 시 Phase 2 별도 plan 착수

---

## 5. Codex 실행 순서

Codex 프롬프트 (GPT-5.4 xhigh) 는 이 plan 을 입력으로 받는다. 아래 순서로 진행한다.

1. **Step 1 — `.github/workflows/test.yml` 생성** (§2.1 YAML 그대로 복사, 주석 포함)
2. **Step 2 — `.github/workflows/deploy-dev.yml` 생성** (§2.2 YAML 2-job 구조 그대로, 주석 포함)
3. **Step 3 — `packages/runner/build.ts` 수정** (§3.3 의 BACKEND_URL 3줄 교체; 다른 줄 손대지 않음)
4. **Step 4 — `CLAUDE.md` 수정** (§3.1 신규 섹션을 "Official Entrypoints" 와
   "Planes — Keep Them Separate" 사이에 삽입)
5. **Step 5 — `docs/development/LOCAL_SETUP.md` 수정** (§3.2 §8 신규 섹션 append;
   파일 존재 확인 먼저. 번호 충돌 시 다음 번호로 조정)
6. **Step 6 — `docs/development/GIT_WORKFLOW.md` 수정** (§3.4 두 섹션 치환;
   `## 브랜치 전략` 테이블 + `## CI/CD` 섹션 전체)
7. **Step 7 — 검증**:
   - `./scripts/check.sh` 실행. docs-check 가 링크를 검증한다.
   - 실패 시 문서 수정 내용의 링크가 깨진 것 → 수정 후 재실행.
   - `packages/runner/build.ts` 변경 후 로컬에서 `bun run packages/runner/build.ts --local`
     한 번 실행해 bun 크로스컴파일이 깨지지 않는지 확인 (선택적; 로컬 bun 없으면 스킵 — CI 에서 검증)
8. **Step 8 — 단일 커밋 + push**:
   - 커밋 메시지: `feat(ci): 3-워크플로 전환 + 러너 바이너리 자동 빌드 (develop → 자소전.shop)`
   - 본문: 주요 변경 5줄 + plan 참조
   - plan 문서 `docs/plans/2026-04-19-cicd-develop-deploy.md` 도 함께 커밋에 포함
   - `git push origin develop` (branch protection 없음, --no-verify 금지)

**금지 사항**:
- `.github/workflows/deploy.yml` 수정 금지
- `~/jasojeon/` 관련 파일 어떤 것도 생성/수정 금지
- `.env*` 파일 커밋 금지
- `packages/**` 런타임 코드 수정 금지 (harness plane 전용 plan)

---

## 6. 검증 계획

### 6.1 Codex 로컬 검증 (push 전)

- `./scripts/check.sh` → 통과해야 push
- `git diff --stat` → 변경 파일 7개 확인 (2 신규 YAML + 1 수정 TS(build.ts) + 3 수정 MD + 1 plan MD)
- `git log --oneline -1` → 커밋 메시지 형식 확인

### 6.2 첫 실행 (GitHub Actions)

이 plan 의 커밋 자체가 develop push 이므로 **그 순간이 deploy-dev.yml 첫 실행**.
사용자는 다음을 확인.

- [ ] GitHub Actions → `Deploy to Dev (자소전.shop)` workflow run 녹색
- [ ] `Validate secrets` step 통과 (secret 교체가 끝났다면)
- [ ] `Deploy to dev stack` step 의 stdout 에
      `=== git reset --hard origin/develop ===` →
      `=== install deps ===` →
      `=== restart jasojeon-dev.service ===` →
      `=== verify is-active ===` (출력: `active`) →
      `=== deploy done ===` 순서로 로그 확인

### 6.3 PR 게이트 (다음 PR 에서)

- [ ] develop → main 이 아닌 아무 feature PR 을 develop 대상으로 열었을 때
      `test.yml` 이 자동 실행되는지 확인

### 6.4 서버 측 검증 (사용자)

```bash
ssh ubuntu@168.107.25.12
cd ~/project/Jasojeon
git log --oneline -1              # 배포 커밋이 HEAD
systemctl --user is-active jasojeon-dev.service   # active
journalctl --user -u jasojeon-dev.service --since "10 min ago" --no-pager | tail -100
curl -s -o /dev/null -w "%{http_code}\n" https://xn--9l4b13i8j.shop/
```

---

## 7. 리스크 및 롤백

### R1 — deploy-dev 가 서버 local uncommitted 변경을 소실 (심각도: 중, 확률: 저)

- **원인**: nanoclaw 또는 사용자가 서버 `~/project/Jasojeon` 에서 파일을 직접
  수정하고 commit/push 없이 방치. 다음 배포가 `git reset --hard origin/develop` 로 삭제.
- **완화**: §3.1 (`CLAUDE.md`) + §4.2 (nanoclaw CLAUDE.md) 규약 명문화.
  deploy 로그의 `git reset --hard` 라인이 soft warning 역할.
- **롤백**: 해당 변경을 사용자가 수동 재작성 후 정상 루트(로컬 push)로 재진입.

### R2 — `PUPPETEER_SKIP_DOWNLOAD` 로 CI 테스트는 통과하나 runtime 에서 Chromium 부재 (심각도: 저)

- **영향 없음** 이유: `puppeteerFetcher.test.ts` 는 `PuppeteerLike` DI 로 stub 사용.
  단위 테스트는 실 Chromium 없이 동작.
- **remaining gap**: `scripts/verify-puppeteer-jumpit.ts` 같은 E2E 는 CI 에서 돌지 않음
  (애초에 `check.sh` 에 포함 안 됨). 로컬에서만 의미.
- **롤백**: 필요 시 `test.yml` env 에서 `PUPPETEER_SKIP_DOWNLOAD` 제거 + 캐시 활성.

### R3 — systemd restart 5분 초과로 timeout (심각도: 저)

- **완화**: systemd unit `TimeoutStartSec=300` × GitHub Actions `timeout-minutes: 15`.
- **관찰 지표**: `is-active` step 이 `activating` 에서 멈추면 오래 걸리는 중.
- **롤백**: 서버에서 `systemctl --user stop jasojeon-dev.service` 후 원인 조사.

### R4 — 기존 `OCI_SSH_KEY` 교체 안 하고 배포 강행 (심각도: 고, 확률: 사용자 의존)

- **리스크**: 개인 키가 CI 에 노출된 상태 지속.
- **완화**: §4.1 을 선결 조건으로 명시. 교체 전에는 `deploy-dev.yml` 이 실행되더라도
  인증은 성공할 수 있으나 보안 상태 불량.
- **탐지**: 사용자가 §4.1 체크박스를 모두 채우기 전엔 이 plan "done" 으로 선언하지 않음.

### R5 — concurrency 큐잉으로 예상 외 2중 배포 관찰 (심각도: 저)

- **원인**: 연속 push 2회 시 cancel-in-progress=false 로 두 번째가 큐잉되어 순차 실행.
- **정상 동작**. 단, 사용자가 "왜 2번 돌지?" 라고 놀라지 않도록 문서화 (본 plan §1 D1 각주).

### R6 — 러너 바이너리 런타임에 Puppeteer/Chromium 해석 실패 (심각도: 중, 확률: 고)

- **원인**: `bun build --compile` 이 `puppeteer` js 를 번들에 embed 하더라도,
  Chromium 외부 바이너리(약 150MB/플랫폼)는 단일 executable 에 포함 불가. 러너 기동 후
  `new PuppeteerFetcher()` 호출 시 `require("puppeteer")` 는 성공하나 Chromium 경로를
  못 찾아 SPA 공고 추출이 실패.
- **관찰 방법**: 첫 배포 성공 후 자소전.shop 에서 러너 다운로드 → 기동 → jumpit 공고 URL
  입력 시 `PuppeteerFetcher` 에러 로그 확인.
- **단기 완화**: `fetcherRouter` 가 실패 시 StaticFetcher 로 fallback (Chunk 0.5 설계).
  따라서 SSR 사이트는 정상 작동, SPA 만 실패.
- **장기 해결 (Phase 2, 별도 plan)**: 옵션 C (puppeteer-core + system Chrome) 또는
  옵션 D (Chromium 바이너리 postinstall 로 사용자 PC 에 다운로드) 중 선택.
- **탐지 체크**: §4.3 에 "러너 기동 + SPA 공고 1건 추출" 체크박스 포함.

---

## 8. Non-goals (이 plan 범위 외)

| 항목 | 이유 |
|------|------|
| `~/project/Jasojeon-work/` 별도 checkout 으로 race 구조적 해결 | 단일 사용자, YAGNI. 봇+로컬 동시 작업 빈도 낮으면 불필요. |
| main 프로덕션 배포 복원 (`.env.production` 정비 포함) | 별도 plan. 이 plan 은 develop 테스트 라인만 다룸. |
| main `deploy.yml` 에도 `runner-build` job 도입 | 이번 plan 은 develop 만. main 복원 plan 에서 동일 구조 적용 예정. |
| **Puppeteer 번들 전략 확정 (Phase 2)** — `puppeteer-core` 전환 또는 Chromium 바이너리 동봉 | R6 실증 후 옵션 C/D 중 선택. 이번 plan 범위는 "러너 바이너리 배포 파이프라인" 까지. SPA 추출 실동작은 Phase 2 책임. |
| branch protection rule (`develop` require PR / require test.yml) | 혼자 작업, 긴급 hotfix 시 마찰 큼. 협업자 합류 시점에 재검토. |
| `test.yml` 에 lint step 추가 | 현 레포에 lint 스크립트 없음. ESLint 도입은 별도 plan. |
| E2E (`verify-puppeteer-jumpit.ts`) CI 편입 | 실 Chromium 필요 + 잡힙 DOM 변화 외부 의존. 별도 plan. |
| 러너 바이너리 파일명 suffix 재명명 (`-local` → `-staging` 등) | 이번 plan 은 `runnerDownload.ts` 의 LOCAL_FILE_MAP 로직을 건드리지 않음. 다음 plan 에서 semantic 재정비. |
| backend → `docker compose` dev 스택 리로드 자동화 | 현재 backend 컨테이너는 `docker-compose.dev.yml` 로 띄우고 systemd 재시작이 필요한 경우 drift. 실제 호스트 supervise.mjs 가 tsx --watch 하므로 코드 변경은 자동 반영됨 — 인프라 변경 시에만 별도 수작업. |

---

## 9. 참조

- 기존 `.github/workflows/deploy.yml` (변경 없음, 비교 기준)
- 서버 unit: `/home/ubuntu/.config/systemd/user/jasojeon-dev.service`
  (`ExecStart=/bin/bash -c 'start-dev-backend.sh && start-dev-web.sh'`,
   `ExecStop=stop-dev-stack.sh`, `Type=oneshot`, `RemainAfterExit=yes`,
   `TimeoutStartSec=300`, linger=yes)
- 서버 nanoclaw 지침: `/home/ubuntu/nanoclaw/groups/discord_jasojeon/CLAUDE.md`
- Puppeteer DI 증거: `packages/runner/src/test/puppeteerFetcher.test.ts`
  (`PuppeteerLike` 로 stub — 실 Chromium 없어도 단위 테스트 통과)
- 레포 검증 체인: `scripts/check.sh` → `scripts/test-all.sh` + `scripts/docs-check.sh`
- 관련 문서 (동기화 대상): `CLAUDE.md`, `AGENTS.md`, `docs/development/OPERATING_RULES.md`,
  `docs/development/LOCAL_SETUP.md`, `docs/development/GIT_WORKFLOW.md`

---

## Appendix A — Codex 단일 커밋 메시지 템플릿

```
feat(ci): 3-워크플로 전환 + 러너 바이너리 자동 빌드 (develop → 자소전.shop)

- add .github/workflows/test.yml (PR 게이트, PUPPETEER_SKIP_DOWNLOAD)
- add .github/workflows/deploy-dev.yml (2-job: runner-build + deploy)
- update packages/runner/build.ts: JASOJEON_RUNNER_BACKEND_URL env override
- update CLAUDE.md: Branch/Deploy Workflow 섹션 추가 (develop 수렴 규약)
- update docs/development/LOCAL_SETUP.md §8: 테스트 서버 운영
- update docs/development/GIT_WORKFLOW.md: 브랜치 전략 + CI/CD 테이블 개정
- add docs/plans/2026-04-19-cicd-develop-deploy.md (이 plan)

develop push 시 ubuntu runner 에서 bun --compile 로 4 플랫폼 바이너리 생성 →
rsync 로 서버 dist-bin/ 배포 → systemctl restart. BACKEND_URL=자소전.shop 박힘.
기존 deploy.yml / ~/jasojeon 프로덕션 경로는 건드리지 않음. Puppeteer 번들 실증
(R6) 은 첫 배포 후 Phase 2 별도 plan 으로 분리. CI 전용 SSH 키 발급 (OCI_SSH_KEY
secret 교체) 은 사용자 수동 선결 조건 (§4.1).
```

---

## Appendix B — 롤백 스니펫 (사용자가 배포 실패 시 수동 복구)

```bash
# 1) deploy-dev 비활성화 (임시)
gh workflow disable "Deploy to Dev (자소전.shop)"

# 2) 서버에서 직접 재시작
ssh ubuntu@168.107.25.12
cd ~/project/Jasojeon
git fetch origin develop
git reset --hard origin/develop   # 또는 직전 known-good sha
./scripts/with-npm.sh install
systemctl --user restart jasojeon-dev.service
systemctl --user status jasojeon-dev.service --no-pager

# 3) 원인 분석 후 재활성화
gh workflow enable "Deploy to Dev (자소전.shop)"
```
