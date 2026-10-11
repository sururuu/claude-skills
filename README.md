# claude-skills

Claude Code 등 코딩 에이전트에서 쓰는 스킬 모음입니다.

## 설치

```bash
# 이 저장소의 스킬 전체
npx skills add sururuu/claude-skills

# 특정 스킬만 (전역 설치는 -g)
npx skills add sururuu/claude-skills --skill kwcag-a11y-review -g
```

직접 복사해도 됩니다: `skills/<이름>/` 폴더를 `~/.claude/skills/`(전역) 또는 프로젝트의 `.claude/skills/`에 넣으세요.

## 스킬 목록

### kwcag-a11y-review

한국형 웹 콘텐츠 접근성 지침(**KWCAG 2.2**, 33개 검사항목) 기준으로 웹 화면 코드나 실행 중인 페이지를 검수하고, 항목 번호별 발견 사항과 수정안을 보고서로 만듭니다.

- **사용:** "이 화면 접근성 검수해 줘", "KWCAG 기준으로 점검해 줘" 또는 `/kwcag-a11y-review <대상>`
- **방법:** 정적 코드 검토 + axe-core 자동 스캔 + 화면에 맞춘 수동 확인 목록
- **판정 유형 구분:** 모든 발견에 `자동`(도구로 확정) / `AI`(코드 판단, 사람 확인 필요) / `수동`(직접 확인 필요)을 붙이고, "준수"라고 단정하지 않습니다.
- **KWCAG 번호로 보고:** axe 결과(WCAG 기준)를 `scripts/kwcag-map.json` 대응표로 KWCAG 검사항목에 묶습니다. KWCAG에 대응 항목이 없는 WCAG 규칙은 "미분류(참고)"로 남깁니다.

#### 자동 스캔 (선택)

스킬이 필요할 때 실행합니다. 검수 대상 프로젝트에 아래 패키지가 있어야 하며, 없으면 스크립트가 lockfile(pnpm/yarn/bun/npm)에 맞는 설치 명령을 알려 줍니다.

| 모드 | 용도 | 필요 패키지 |
|---|---|---|
| `--url` | 개발 서버의 렌더링된 화면 (권장, 명도 대비 계산 가능) | `playwright`, `@axe-core/playwright` + Chromium |
| `--file` | 정적 HTML | `jsdom`, `axe-core` |

```bash
node <skill-dir>/scripts/kwcag-scan.mjs --url http://localhost:3000/products/1 --keyboard --out a11y-scan.md
```

`--keyboard`를 붙이면 실제로 Tab을 눌러 키보드 초점 순서를 기록하고, 보이지 않는 요소의 초점·초점 표시 없음·키보드 함정·포인터 전용 요소를 찾습니다(KWCAG 2.1.1, 2.1.2).

로컬 개발 서버의 자체 서명 HTTPS 인증서는 무시하고 검사합니다.

#### 테스트

스캔 스크립트를 수정했다면 저장소 루트에서:

```bash
npm install
npm test
```

`scripts/fixtures/`에 심어 둔 위반이 기대한 KWCAG 항목으로 묶이는지 확인합니다. 키보드 확인 테스트는 Chromium이 필요합니다(`npx playwright install chromium`).

#### 주의

- 체크리스트의 기준 문구는 KWCAG 원문을 요약한 것입니다. 인증 준비 등 공식 판정에는 원문을 확인하세요.
- 자동 스캔은 33개 항목 중 일부만 판정할 수 있습니다. 위반 0건은 준수를 뜻하지 않습니다.

## 라이선스

MIT
