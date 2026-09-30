# 기술 기록 — 도구·라이브러리·실측 결과

구현 단계에서 확정한 도구 버전, 라이선스, 전제 실측 결과를 확인 날짜와 함께 남긴다(CLAUDE.md, 03-plan T-01).

## 1. 도구·라이브러리 (확인일 2026-09-30)

| 이름 | 버전 | 라이선스 | 용도 | 확인 방법 |
|---|---|---|---|---|
| Node.js (LTS) | 24.19.0 | MIT | 빌드·단위 테스트·브라우저 점검 도구(실행 결과물에는 불필요) | `winget install OpenJS.NodeJS.LTS`, `node --version` |
| npm | 11.17.0 | Artistic-2.0 | 의존성 설치 | `npm --version` |
| Git | 2.55.0.windows.5 | GPL-2.0 | 버전 관리 | `git --version` |
| Cytoscape.js | 3.34.3 (정확한 버전 고정) | MIT | 그래프 시각화(D-10). 빌드 결과에 포함 | `npm view cytoscape`, `node_modules/cytoscape/package.json`. 의존성 0개 |
| esbuild | 0.28.2 (개발용, 정확한 버전 고정) | MIT | 번들러. ES 모듈 소스 → IIFE 단일 스크립트 | `npm view esbuild`, `npx esbuild --version` |

- 설치 시 npm이 esbuild의 설치 스크립트 실행을 보류했다(`allow-scripts` 경고). 플랫폼 바이너리(`@esbuild/win32-x64`)는 설치되어 있고 `esbuild --version`이 정상 동작하므로 승인하지 않았다.
- Cytoscape.js의 MIT 고지는 빌드할 때 `dist/THIRD_PARTY_LICENSES.txt`로 함께 넣는다.

## 2. 그래프 라이브러리 선택 (D-10, K-8)

| 후보 | 버전·라이선스(2026-09-30) | 오프라인 번들 | 클릭 펼침 | 판단 |
|---|---|---|---|---|
| **Cytoscape.js** | 3.34.3, MIT | 의존성 0개. 번들에 그대로 포함됨 | 노드 `tap` 이벤트, 요소 추가·숨김, 이웃 조회(`neighborhood`), 레이아웃 내장 | **선택.** 그래프 자료 구조(노드·연결·선택·이웃)가 내장되어 있어 탐색·펼침(R-01)을 적은 코드로 구현할 수 있음 |
| vis-network | 10.1.2, Apache-2.0 OR MIT | standalone 빌드로 가능 | 클릭 이벤트, 물리 레이아웃 | 가능하지만 물리 시뮬레이션 중심이라 수백 노드에서 안정화 제어가 추가로 필요. 포기 |
| D3.js | 7.9.0, ISC | 하위 패키지 30개. 번들 가능 | 직접 구현해야 함 | 저수준. 선택·펼침·레이아웃을 직접 짜야 해서 코드량이 큼. 포기 |

## 3. 빌드 방식 (P-1)

- 소스: `app/src`의 ES 모듈(`import`/`export`). Node 단위 테스트가 그대로 불러온다.
- 빌드: `npm run build` → esbuild `format: iife` → `dist/app.js`(모듈 없는 단일 스크립트, 약 442KB, 최소화) + `dist/index.html`(일반 `<script src="app.js">`).
- 빌드 스크립트가 결과물에 `type="module"`, `import`/`export` 문, `fetch(` 호출이 없는지 검사하고, 있으면 실패한다.
- 샘플 데이터는 JS 모듈로 감싸 번들에 포함한다(12.1).
- 대안 K-3(인라인 단일 HTML)은 쓰지 않았다. 스크립트 파일 분리 방식으로 P-1이 통과했기 때문이다.

## 4. 디렉터리 구조 변경 (03-plan 1.1 대비)

| 변경 | 이유 |
|---|---|
| `app/vendor/` 사용 안 함 | 라이브러리를 npm으로 정확한 버전에 고정(`package-lock.json`)하고 esbuild가 번들에 포함한다. 파일을 따로 복사해 둘 필요가 없다 |
| `app/src/app/` 추가 | 02-design 12.7의 `app` 모듈(명령 흐름·상태) 자리. 1.1 목록에 없어서 추가했다 |
| `.tmp/` (Git 제외) | 브라우저 점검 도구의 임시 프로필 |

## 5. 전제 실측 결과 (T-01, 2026-09-30)

점검 도구: `npm run build && npm run check:browser` (`tools/browser-check.mjs`).
설치된 Chrome·Edge를 DevTools 프로토콜로 조종해 `file:///C:/AI/work-universe/dist/index.html`을 연다.

| 브라우저 | 버전 |
|---|---|
| Chrome | 154.0.8037.58 |
| Edge | 154.0.4258.37 |

| 항목 | Chrome | Edge | 방법 |
|---|---|---|---|
| **P-1** file://로 열어 그래프 표시(노드 3, 연결 2) | 통과 | 통과 | headless 모드 |
| 노드 클릭 → 상세(속성·연결 노드) | 통과 | 통과 | 캔버스 좌표에 실제 마우스 이벤트 전달 |
| 노드 1개 추가·저장 | 통과 | 통과 | 화면 양식 입력 |
| 오류: 라벨 누락 `E-REQUIRED`, 중복 `E-DUP` + 기존 노드 링크 | 통과 | 통과 | |
| 연결 없는 노드 → "연결 없음" | 통과 | 통과 | |
| 인터넷 차단 상태에서 동작, 외부 요청 0건 | 통과 | 통과 | 닫힌 포트를 프록시로 지정해 모든 http(s) 요청 차단 |
| **P-3** 새로고침 후 추가 노드 유지 | 통과 | 통과 | `Page.reload` |
| **P-3** 브라우저를 닫았다 다시 열어도 유지 | 통과 | 통과 | 같은 프로필, 정상 종료(`Browser.close`) |
| 오류: 저장소 차단 → `W-STORAGE` 배너, 샘플 읽기 전용 | 통과 | 통과 | 페이지 스크립트보다 먼저 `localStorage` 접근 시 SecurityError가 나게 함(쿠키 차단과 같은 동작) |

- 3회 반복 실행해 모두 통과했다.
- 사용자가 탐색기에서 `dist/index.html`을 직접 더블클릭해 동작을 확인했다(2026-09-30).
- **관찰:** 브라우저를 강제 종료(프로세스 kill)하면, 저장 직후 몇 초 안의 변경이 디스크에 기록되지 않아 사라질 수 있다(점검 도구 첫 버전에서 재현). 정상 종료에서는 유지된다. 시연 중 편집 직후 강제 종료는 피하고, 내보내기(T-06 이후)를 안내한다.
- **미확인:**
  - 네트워크 어댑터를 실제로 끊은 상태. 프록시 차단으로 대신 확인했다.
  - 다른 PC·OS, Firefox·Safari(03-plan 1.4, K-3에서 수용한 위험).
