# tools/

결정론적 검증 도구 모음. CI-safe, credential-free, non-interactive 실행을 전제로 한다.

---

## 역할

`tools/`는 **하네스(harness) 플레인**에 속하며, 제품 런타임 코드(`packages/`)와 엄격히 분리된다.
여기에 두는 도구는 반드시 세 조건을 만족해야 한다.

1. **결정론적** — 동일 입력에 항상 동일 결과를 낸다.
2. **credential-free** — API 키, 토큰, 환경 비밀이 없어도 실행된다.
3. **non-interactive** — stdin 입력 없이 종료 코드(0 / non-0)만으로 통과·실패를 표시한다.

---

## 현재 도구

### `validate-doc-links.ts`

모든 마크다운 문서의 **로컬 링크 무결성**을 검사한다.

- 검사 대상: `README.md`, `.github/pull_request_template.md`, `docs/development/**/*.md`, `docs/plans/**/*.md`
- 각 파일의 `[텍스트](경로)` 패턴에서 로컬 파일 경로를 추출해 실제 존재 여부를 확인한다.
- 외부 URL(`http:`, `https:`, `mailto:`)과 앵커 전용 링크(`#...`)는 건너뛴다.
- 깨진 링크가 하나라도 있으면 목록을 출력하고 `process.exitCode = 1`로 종료한다.

---

## check.sh에서의 호출 흐름

```
scripts/check.sh
  └─ scripts/docs-check.sh
       ├─ tsc -p tsconfig.tools.json   # tools/*.ts → dist-tools/*.js 컴파일
       └─ node dist-tools/validate-doc-links.js
```

직접 실행이 필요하면:

```bash
./scripts/docs-check.sh
```

전체 검증(타입 체크 + 빌드 + 문서 링크)을 돌리려면:

```bash
./scripts/check.sh
```

---

## 새 도구 추가 기준

`tools/`에 새 파일을 추가할 때 아래를 확인한다.

- [ ] TypeScript로 작성하며 `tsconfig.tools.json`의 `include` 범위에 포함되는가?
- [ ] 실행에 외부 네트워크나 자격증명이 필요하지 않은가?
- [ ] 결과를 종료 코드로만 전달하는가? (0 = 통과, non-0 = 실패)
- [ ] `scripts/docs-check.sh` 또는 별도 스크립트에서 `check.sh`가 호출하도록 연결했는가?

위 조건을 하나라도 만족하지 못하면 `scripts/`나 `packages/`의 다른 위치를 검토한다.
