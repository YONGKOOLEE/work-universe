# 세션 시작 안내 (HANDOFF)

새 세션은 **이 파일 하나만 먼저 읽는다.** 문서 전체를 읽으면 약 18만 자(6만 토큰 안팎)라서, 작업마다 필요한 절만 골라 읽는다(아래 "작업별로 읽을 곳").
마지막 갱신: 2026-10-02 (두 번째 전체 검토 직후)

## 1. 지금 상태 (한 줄씩)

- 계획 승인 완료. 구현 중. 제출 기한 2026-10-30.
- 완료: T-01, T-03~T-08(M1), T-09, T-11(반복 비효율·밀집/공백·흐름 변화·시간 슬라이더), T-13(기본안 데이터: 교육팀 U-C·조직관리 U-O, 예외 9건, 한계 목록), T-12(연결부 + 사전 생성, Claude API는 P2라 자리만). T-14(시작 화면)는 구현 완료·관찰 대기. 키 검색 도구(`check:secrets`)도 있음.
  - 커밋 001b558까지 반영. **T-11 밀집/공백(tech-record 23절)과 두 번째 전체 검토 수정(24절)은 사용자 확인·커밋 대기** → `git status`로 확인.
  - T-14는 구현만 끝났다. 완료 기준(대리 검증자 관찰, R-08)은 미확인.
  - 조력자 의견이 오면 데이터 내용만 교체: T-13 → T-12 → 시나리오(K-9).
- 대기(조력자 의견): T-10 통합, T-17 문서 변환. CR-4(층별 보기)는 코드에만 있고 미승인.
- 이후: T-15 제출 점검(일부는 사용자: 깨끗한 PC·메일 발송), T-16 영상(사용자).
- **연속 진행 모드(2026-10-02~):** 확인 없이 다음 작업으로, 작업마다 로컬 자동 커밋. 결정·확인은 `docs/decisions-pending.md`에 쌓는다(CLAUDE.md 작업 방식).
- 진행 기록: `docs/.status`의 `implementation:` 절. 결정·해석: `docs/tech-record.md`(절 번호로 찾기).

## 2. 지켜야 할 것

- **지침:** `CLAUDE.md`. 한 번에 T-ID 하나만. 커밋은 사용자가 시킬 때만. 설계와 다르게 하려면 먼저 CR로 제안한다.
- **실행 조건:** `dist/index.html` 파일 하나. `file://` 더블클릭으로 동작해야 하므로 `type="module"`과 `fetch`는 쓰지 않는다. 빌드할 때 검사한다.
- **데이터:** 가상 데이터만 쓴다. 사번은 `V-`+4자리.
- **모듈 경계(02-design 12.7):** `model`·`view`·`rules`·`llm`은 DOM·저장소를 쓰지 않는다(Node 테스트용). 화면은 `ui`, 흐름은 `app`.
- **샘플:** `app/data/*.js`의 `STAMP`는 반드시 **과거 시각**이다(테스트가 막는다). 샘플을 고치면 STAMP를 바꾼다.
- **사용자와 일하는 방식:** 결정은 추천안과 기본값을 붙여 묻는다. 확인은 묶어서 받는다. 진행도를 물으면 근거와 함께 답한다. 조력자에게 보낼 글은 편한 반말로 쓴다.

## 3. 명령

```
npm test                  # 단위 테스트(246개)
node tools/pregen-dump.mjs        # 사전 생성 작성용 근거 덤프(데이터를 바꾸면 다시 보고 app/data/pregen.js 고침)
npm run build             # dist/index.html (바이트 크기 표시)
npm run check:browser     # Chrome·Edge file:// 점검. SHOT_DIR=.tmp/shots 를 주면 화면 PNG 저장
npm run check:secrets     # 비밀값 형식 검색(dist 포함). 0건이어야 함
node tools/virtual-data-check.mjs   # R-06 형식 점검
node tools/perf-check.mjs 300 --browser   # 규모 점검
```

## 4. 작업 요령 (이 PC에서 겪은 함정)

- **셸 문제:** Bash heredoc에 백틱(`)이나 `${}`가 섞이면 셸이 깨진다. 여러 줄 수정은 Write 도구로 `.tmp/*.cjs` 스크립트를 만든 뒤 `node`로 실행하거나, Edit 도구를 쓴다.
- **브라우저 점검이 멈출 때:** 페이지를 다시 연 뒤 `window.confirm` 자동 수락이 풀린 경우가 많다. 멈추면 `taskkill //F //IM chrome.exe //IM msedge.exe`로 정리한다. 점검은 `timeout`을 두고 돌린다.
- **화면 확인:** 자동 점검은 "눌러짐"만 확인할 수 있다. 새 화면은 반드시 스크린샷으로 보고, 핵심 요소가 실제로 그려지는지(크기가 있는지) 점검을 넣는다.
- **화면 글자:** `replaceChildren(..., null)`은 "null" 글자를 넣는다. 빈 값은 걸러 낸다(점검이 잡는다).
- **노드 추가:** `node`는 PowerShell PATH에 없을 수 있다. Bash에서는 `export PATH="/c/Program Files/nodejs:$PATH"`.

## 5. 작업별로 읽을 곳 (필요한 절만)

| 작업 | 읽을 곳 |
|---|---|
| 공통(짧게) | 이 파일, `docs/.status`의 `implementation:` 절, 해당 T-ID 행(`docs/03-plan.md` 2절) |
| T-10 통합 | 01 R-11, 02 2·3절·12.2 `identity_links`·12.7 흐름 3, tech-record 10절(CR-4 시제품), review 2-5·2-6·2-17 |
| T-11 나머지 | 01 R-05·R-14, 02 5.5, tech-record 16·19·23·24·25절 |
| T-12 사전 생성(다시 쓸 때) | 01 R-15(CR-1), 02 5.4·12.3, tech-record 15·27절, `tools/pregen-dump.mjs`, `app/data/pregen.js` |
| T-13 데이터(교체 시) | 02 4절(사례·예외 9건)·1.7, 03 7.2, tech-record 7·18·26절, `app/data/answers-v1.js`, `docs/limits.md` |
| T-15 제출 | 03 T-15·K-6, review 3-1~3-7·4-10, README |
| T-17 문서 변환 | 01 CR-3, 02 12.9, `.status` CR-3·CR-5, tech-record 9절 |
| 화면 수정 | `app/src/ui/*`, tech-record 8·12·17·21절 |

## 6. 코드 지도

- `app/src/model`: 스키마 상수·검증·명령(순수 함수)
- `app/src/view`: 합성 뷰, 상세 문장, 층별 보기
- `app/src/rules`: 인수인계 초안(`handover.js`), 인사이트(`insight.js`)
- `app/src/llm`: 연결부(`connector.js`)와 공급자(`providers.js`: 사전 생성 기본, Claude API·사내 LLM은 P2 자리)
- `app/src/app`: 명령 흐름과 저장
- `app/src/store`: 브라우저 저장소
- `app/src/ui`: 화면(main, graph, detail, editor, draft, insight, start)
- `app/data`: 샘플 7개(월말 정산·카드승인·결제운영팀·행사팀·부서·교육팀·조직관리), 정답 표(v2), 시작 화면 문구
- `tests/*.test.js`: 단위 테스트
- `tools/`: 빌드, 브라우저 점검, 비밀값·데이터·규모 점검

## 7. 세션을 끝낼 때

`docs/.status`(완료·미확인·다음 작업)와 이 파일 1절을 갱신한다. 큰 결정과 해석은 `docs/tech-record.md`에 새 절로 남긴다.
