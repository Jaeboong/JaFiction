# Git Workflow

이 문서는 Jasojeon 레포의 브랜치 전략, PR 프로세스, 다중 에이전트 동시 작업 시 조율 방법을 정의한다.
외부 에이전트가 새 세션에서 "어디에 커밋해야 하고 어떻게 PR을 열어야 하는가"를 파악하기 위한 기준 문서다.

---

## 브랜치 전략

| 브랜치 | 역할 |
|--------|------|
| `main` | 프로덕션 기준. push 즉시 GitHub Actions → OCI 자동 배포. |
| `feat/<name>` | 기능 단위 작업 브랜치. 완료 시 `main`으로 PR. |
| `dev` | 통합 실험 브랜치 (상시 유지는 보장되지 않음). |

### 현재 활성 원격 브랜치

```
origin/main
origin/dev
origin/feat/hosted-migration
origin/feat/jafiction-bootstrap
origin/local-save
```

### 브랜치 네이밍 규칙

- 기능: `feat/<kebab-case-description>` — 예: `feat/provider-auth`
- 버그픽스: `fix/<kebab-case-description>` — 예: `fix/ws-reconnect`
- 하네스/문서: `harness/<description>` 또는 `docs/<description>`
- 브랜치 이름에 개인 이름이나 날짜는 포함하지 않는다.

---

## 커밋 컨벤션

```
feat(scope): description
fix(scope): description
docs: description
refactor(scope): description
test(scope): description
```

### scope 예시

| scope | 대상 |
|-------|------|
| `runner` | `packages/runner/**` |
| `backend` | `packages/backend/**` |
- `shared` | `packages/shared/**` |
| `web` | `packages/web/**` |
| `harness` | `scripts/**`, `tools/**`, `.github/**` |

### 규칙

- 제목은 명령형 동사로 시작한다 (한국어 가능).
- 본문이 필요한 경우 빈 줄 한 줄로 구분한다.
- 커밋 하나에 하나의 논리적 변경만 담는다.
- 절대 커밋하지 않는 것: `.harness/**`, `*.pid`, 로컬 로그, `.claude/` 세션 상태, `.env*` 파일.

---

## PR 프로세스

1. **작업 브랜치에서 커밋**
   ```bash
   git checkout -b feat/<name>
   # 작업 후
   git add <files>
   git commit -m "feat(scope): description"
   ```

2. **검증 통과 확인**
   ```bash
   ./scripts/check.sh
   ```
   check.sh가 실패하면 PR을 열지 않는다.

3. **PR 생성** (WSL/bash에서 gh CLI 래퍼 사용)
   ```bash
   ./scripts/gh.sh pr create \
     --base main \
     --title "feat(scope): description" \
     --body "## 변경 내용\n...\n## 검증\n- [ ] check.sh 통과"
   ```
   raw `gh` 명령은 WSL PATH 문제로 실패할 수 있으므로 반드시 `./scripts/gh.sh`를 사용한다.

4. **머지 후 자동 배포**
   `main`에 머지되면 GitHub Actions `deploy.yml`이 즉시 실행된다.

---

## 다중 에이전트 작업 시 규칙

### 기본 원칙

- 동시에 같은 파일을 편집하지 않는다.
- 각 에이전트는 작업 시작 전에 자신이 담당할 파일 범위를 `docs/plans/` 계획 문서에 명시한다.
- 충돌이 발생하면 나중에 작업한 에이전트가 rebase/merge 책임을 진다.

### 작업 격리

- 장기 작업은 `git worktree`로 격리한다 (선택적):
  ```bash
  git worktree add ../jasojeon-feat-x feat/x
  ```
- 같은 스테이지를 두 에이전트가 동시에 진행하지 않는다.
- Codex에 위임한 작업은 위임 중임을 `docs/logs/codex.txt`에 기록한다.

### 브랜치 소유

- 에이전트가 새 브랜치를 만들 때는 계획 문서(`docs/plans/`)에 해당 브랜치 이름을 명시한다.
- Head agent(Claude)가 어느 에이전트가 어느 브랜치를 담당하는지 추적한다.

### 충돌 해소

```bash
# 나중에 작업한 에이전트가 실행
git fetch origin
git rebase origin/main
# 충돌 수정 후
git add <resolved-files>
git rebase --continue
```

---

## CI/CD

### 트리거

`main` 브랜치에 push가 발생하면 `.github/workflows/deploy.yml`이 자동 실행된다.

### 파이프라인 단계

| 단계 | 내용 |
|------|------|
| Checkout | `actions/checkout@v4` |
| Setup Node | Node.js 20, npm cache 활성화 |
| Install dependencies | `npm ci` (루트 워크스페이스) |
| Build shared | `npx tsc -p packages/shared/tsconfig.json` |
| Type check (backend) | `npx tsc -p packages/backend/tsconfig.json --noEmit` |
| Validate secrets | `OCI_HOST`, `OCI_USER`, `OCI_SSH_KEY` 존재 확인 |
| Deploy to OCI | SSH → `git pull` → `docker compose build --no-cache` → `docker compose up -d` → `docker image prune -f` |

### 배포 대상

- 서버: OCI (Oracle Cloud Infrastructure)
- SSH 접속: `OCI_USER@OCI_HOST` (GitHub Secrets로 관리)
- 서버 경로: `~/jasojeon` (소문자)
- 실행 명령: `docker compose --env-file .env.production build` → `up -d`

### 로컬에서 배포 전 검증

```bash
./scripts/check.sh          # 타입 체크 + lint
./scripts/dev-stack.sh      # 전체 스택 로컬 실행 확인
```

### 주의사항

- `main`에 force push 금지.
- 배포는 docker compose 재빌드를 포함하므로 짧은 다운타임이 발생할 수 있다.
- 빌드 실패 시 GitHub Actions 로그를 확인한다: `./scripts/gh.sh run list --workflow=deploy.yml`

---

## 주의사항 요약

| 금지 사항 | 이유 |
|-----------|------|
| `main` force push | 자동 배포 파이프라인 오염 위험 |
| raw `gh` CLI 직접 호출 | WSL PATH에서 Windows 바이너리를 참조할 수 있음 |
| 동일 파일 동시 편집 | 다중 에이전트 충돌 |
| `.harness/**`, `*.pid`, 로컬 로그 커밋 | 머신 종속 상태 오염 |
| `.env*` 파일 커밋 | 시크릿 유출 |
| check.sh 미통과 상태로 PR | 파이프라인 실패 및 배포 중단 |
