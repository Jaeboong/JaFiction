# Git Workflow

이 문서는 Jasojeon 레포의 브랜치 전략, PR 프로세스, 다중 에이전트 동시 작업 시 조율 방법을 정의한다.
외부 에이전트가 새 세션에서 "어디에 커밋해야 하고 어떻게 PR을 열어야 하는가"를 파악하기 위한 기준 문서다.

---

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

### 워크플로 구성 (3개)

| 파일 | 트리거 | 역할 |
|------|--------|------|
| `.github/workflows/test.yml` | `pull_request: [develop, main]` + manual | `./scripts/check.sh` (공용 게이트) |
| `.github/workflows/deploy-dev.yml` | `push: develop` + manual | 자소전.shop 자동 재배포 (SSH → git reset --hard → with-npm install → systemctl restart) |
| `.github/workflows/deploy.yml` | `push: main` | 프로덕션 배포 (현재 휴면) |

### deploy-dev 서버 실행 내용

```bash
cd ~/project/Jasojeon
git fetch origin develop
git reset --hard origin/develop
./scripts/with-npm.sh install
systemctl --user restart jasojeon-dev.service
systemctl --user is-active jasojeon-dev.service
```

### 로컬 배포 전 검증

```bash
./scripts/check.sh
```

### 주의사항

- `develop` force push 금지. 봇/로컬 race 시 commit 순서로 해결.
- `main` force push 금지.
- 서버 `~/project/Jasojeon` 직접 편집 금지 (다음 배포가 덮어쓴다).

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
