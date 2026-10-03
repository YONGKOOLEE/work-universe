# 세션 시작 안내 (HANDOFF)

새 세션은 **이 파일 하나만 먼저 읽는다.** 문서 전체를 읽으면 약 18만 자(6만 토큰 안팎)라서, 작업마다 필요한 절만 골라 읽는다(아래 "작업별로 읽을 곳").
마지막 갱신: 2026-10-03 (세션 종료 인계: CR-8까지 완료, 작업 트리 깨끗함)

## 1. 지금 상태 (2026-10-03 세션 종료 시점)

- **단계:** 계획 승인 완료, 구현 거의 끝. 제출 기한 2026-10-30. 계획된 구현 T-ID는 모두 구현됨. 모두 로컬 커밋(push·태그 없음), 작업 트리 깨끗함.
- **검증 상태:** 단위 테스트 319개 통과, Chrome 154.0.8037.93·Edge 154.0.4258.53 전체 점검 통과, 제출 점검 9/9(압축 → 풀기 → 새 프로필 점검 → 실행 안내 따라가기), 비밀값 0건, R-06 형식 통과.
- **승인·결정(모두 처리됨):**
  - CR-1~CR-8 승인. CR-4(층별 보기·묶기)·CR-7(문구 정리)은 사용자 "1,2,3,4,5 전부 승인 및 진행", CR-8(초안 확정)은 "추천하는 걸로 구현"(둘 다 2026-10-03).
  - `docs/decisions-pending.md`의 결정 27건은 추천안으로 확정, 화면·내용 확인(T-09·T-10·T-11·T-12·T-13·T-17, 가상 이름, 사전 생성 문장, 한계 목록, 실행 안내)은 확인됨. D3-28·D3-29(CR-8 해석)도 2026-10-03 사용자 확정("그대로"). 확인 전 결정 없음.
- **이번 세션(2026-10-03)에 한 것:** T-17 문서 변환·가져오기·내보내기(tech-record 32·32.1절), 일괄 결정 반영과 N-1(한글·워드 문서 읽기)·N-2(같은 이름 경고)·N-4(연결 오류 안내)·N-5(유사 경험자 "해당 없음") 및 네 번째 검토 25건 중 24건 수정(33절), CR-8 초안 확정(34절).
- **남은 것(사람 몫, 일정 미정):**
  - T-14 대리 관찰: 동료에게 index.html만 주고 설명 없이 탐색을 시작하는지(R-08 완료 기준, 미확인).
  - T-15: 다른 PC(조력자 PC)에서 `npm run package` 결과를 풀어 실행, 메일 첨부 시험(K-6), 제출본 태그(D2-10: 제출본에만).
  - T-16: 영상·대본·소개자료 — 기한(10-30) 즈음, 검토 뒤에(사용자 결정).
- **조력자 의견이 오면:** 구성 기준·데이터 내용·변환 규칙 v1(`CONVERT_RULES`)만 조정. 순서 K-9: T-13 데이터 → T-12 사전 생성(`node tools/pregen-dump.mjs`로 다시 쓰기) → 시나리오.
- **새 기능은 사용자 요청이 있을 때만** 만든다. 요청이 없으면 다음 세션 첫 행동은 "남은 것" 중 무엇을 할지 묻기.
- **사용자 확인용 가이드(Git 밖):** `.tmp/guide/확인-가이드.md`(전체 확인 순서), `.tmp/guide/결정-가이드.md`, 그리고 Git 안의 `docs/가져오기-사용가이드.md`.
- 진행 기록: `docs/.status`의 `implementation:` 절. 결정·해석: `docs/tech-record.md`(절 번호로 찾기). 한계: `docs/limits.md`(L-1~L-14).

## 2. 지켜야 할 것

- **지침:** `CLAUDE.md`. 연속 진행 모드: T-ID 하나씩 하되 확인을 기다리지 않고 다음으로, 검증을 통과하면 로컬 자동 커밋(push·태그 없음). 승인 문서(00~03)를 바꿔야 하는 것은 하지 않고 CR 후보로 `decisions-pending.md`에 쌓는다.
- **실행 조건:** `dist/index.html` 파일 하나. `file://` 더블클릭으로 동작해야 하므로 `type="module"`과 `fetch`는 쓰지 않는다. 빌드할 때 검사한다.
- **데이터:** 가상 데이터만 쓴다. 사번은 `V-`+4자리.
- **모듈 경계(02-design 12.7):** `model`·`view`·`rules`·`llm`은 DOM·저장소를 쓰지 않는다(Node 테스트용). 화면은 `ui`, 흐름은 `app`.
- **샘플:** `app/data/*.js`의 `STAMP`는 반드시 **과거 시각**이다(테스트가 막는다). 샘플을 고치면 STAMP를 바꾼다.
- **사용자와 일하는 방식:** **답은 반드시 한국어로만**(긴 작업 뒤 요약에서 영어로 바뀌어 크게 질책받음, 2026-10-03). 결정은 추천안과 기본값을 붙여 묻는다. 확인은 묶어서 받는다. 진행도를 물으면 근거와 함께 답한다. 조력자에게 보낼 글은 편한 반말로 쓴다.
- **확인이 밀리지 않게:** 연속 진행 중이라도 사용자가 마지막으로 직접 확인한 지점에서 너무 멀어지면(예: 커밋 10개 이상) 확인 가이드를 만들어 먼저 권한다(2026-10-03 사용자 지적 "내가 확인하고 있지 않는데 괜찮은지").
- **"다 됐다"고 하기 전에:** 테스트 기대값을 구현 뒤에 정했다면 일부러 결함을 넣어 테스트가 잡는지 보고, 실제와 비슷한 입력(예: 한글·워드 문서)으로 한 번 더 시험한다. 큰 기능은 하위 에이전트 검토(범주별, 재현 스크립트 요구)를 돌린다.

## 3. 명령

```
npm test                  # 단위 테스트(319개)
node tools/pregen-dump.mjs        # 사전 생성 작성용 근거 덤프(데이터를 바꾸면 다시 보고 app/data/pregen.js 고침)
npm run build             # dist/index.html (바이트 크기 표시)
npm run check:browser     # Chrome·Edge file:// 점검. SHOT_DIR=.tmp/shots 를 주면 화면 PNG 저장
npm run check:secrets     # 비밀값 형식 검색(dist 포함). 0건이어야 함
npm run package           # 제출 압축 release/업무유니버스-제출본-날짜.zip
npm run check:submit      # 제출 점검 9단계(압축을 풀어 새 프로필로 브라우저 점검 + 실행 안내 따라가기). --quick은 브라우저 생략
npm run check:guide       # 실행 안내 "5분 둘러보기"를 실제 마우스·키보드로 따라가기(Chrome·Edge)
node tools/virtual-data-check.mjs   # R-06 형식 점검
node tools/perf-check.mjs 300 --browser   # 규모 점검
```

## 4. 작업 요령 (이 PC에서 겪은 함정)

- **셸 문제:** Bash heredoc에 백틱(`)이나 `${}`가 섞이면 셸이 깨진다. 여러 줄 수정은 Write 도구로 `.tmp/*.cjs` 스크립트를 만든 뒤 `node`로 실행하거나, Edit 도구를 쓴다.
- **브라우저 점검이 멈출 때:** 페이지를 다시 연 뒤 `window.confirm` 자동 수락이 풀린 경우가 많다. 멈추면 `taskkill //F //IM chrome.exe //IM msedge.exe`로 정리한다. 점검은 `timeout`을 두고 돌린다.
- **화면 확인:** 자동 점검은 "눌러짐"만 확인할 수 있다. 새 화면은 반드시 스크린샷으로 보고, 핵심 요소가 실제로 그려지는지(크기가 있는지) 점검을 넣는다.
- **화면 글자:** `replaceChildren(..., null)`은 "null" 글자를 넣는다. 빈 값은 걸러 낸다(점검이 잡는다).
- **노드 추가:** `node`는 PowerShell PATH에 없을 수 있다. Bash에서는 `export PATH="/c/Program Files/nodejs:$PATH"`.
- **점검용 전역:** `window.__wu`는 주소에 `?check`가 있을 때만 생긴다(D-4-10). 점검 도구에서 페이지를 열거나 시작 화면으로 갈 때 `location.search`를 지킨다.
- **테스트에서 샘플 고치기:** 명령(addNode 등)은 문서를 얕게 복사한다. 결과 문서의 이벤트·노드 객체를 직접 고치면 공용 샘플(SAMPLE_A1 등)이 바뀌어 다른 테스트가 깨진다. 먼저 `JSON.parse(JSON.stringify(...))`로 깊은 복사.
- **node -e / 스크립트 안 문자열 치환:** 셸·JS 이스케이프가 겹쳐 정규식이 깨지기 쉽다(`\/`가 `/`로 바뀌는 등). 정규식이 든 수정은 Edit 도구로 한다.
- **브라우저 점검 순서:** 월말 정산 데이터를 바꾸는 단계(초안 확정 등)는 「가상 데이터 초기화」 뒤 끝부분에 둔다. 앞에 두면 뒤의 개수 점검이 깨진다.

## 5. 작업별로 읽을 곳 (필요한 절만)

| 작업 | 읽을 곳 |
|---|---|
| 공통(짧게) | 이 파일, `docs/.status`의 `implementation:` 절, 해당 T-ID 행(`docs/03-plan.md` 2절) |
| T-10 통합(다시 볼 때) | 01 R-11, 02 2·3절·12.2 `identity_links`·12.7 흐름 3, tech-record 10·31절, `app/src/merge/merge.js` |
| T-11 인사이트·시간 보기를 다시 볼 때 | 01 R-05·R-14, 02 5.5, tech-record 16·19·23·24·25·29절 |
| T-12 사전 생성(다시 쓸 때) | 01 R-15(CR-1), 02 5.4·12.3, tech-record 15·27절, `tools/pregen-dump.mjs`, `app/data/pregen.js` |
| T-13 데이터(교체 시) | 02 4절(사례·예외 9건)·1.7, 03 7.2, tech-record 7·18·26절, `app/data/answers-v1.js`, `docs/limits.md` |
| T-15 제출 | 03 T-15·K-6, review 3-1~3-7·4-10, README |
| T-17 문서 변환·가져오기(다시 볼 때) | `docs/가져오기-사용가이드.md`(사용법·특이점), 01 CR-3·CR-5, 02 12.9·12.9.1, tech-record 9·32절, `app/src/rules/doc-convert.js`(`CONVERT_RULES`), `app/src/ui/import.js` |
| 초안 확정(CR-8) | 01 R-03 ③, 02 5.6.1, tech-record 34절, `app/src/app/app.js` confirmHandover, `app/src/ui/draft.js` confirmBox, `tests/confirm.test.js` |
| 화면 수정 | `app/src/ui/*`, tech-record 8·12·17·21절 |

## 6. 코드 지도

- `app/src/model`: 스키마 상수·검증·명령·가져오기 미리 보기(`import.js`)(순수 함수)
- `app/src/view`: 합성 뷰, 상세 문장, 층별 보기
- `app/src/merge`: 통합 확인 목록(사번 자동 연결, 사번 충돌·없음, 업무 후보)
- `app/src/rules`: 인수인계 초안(`handover.js`), 인사이트(`insight.js`), 문서 초벌 변환(`doc-convert.js`)
- `app/src/llm`: 연결부(`connector.js`)와 공급자(`providers.js`: 사전 생성 기본, Claude API·사내 LLM은 P2 자리)
- `app/src/app`: 명령 흐름과 저장(가져오기 importUniverse·내보내기 exportJson·초안 확정 confirmHandover 포함)
- `app/src/store`: 브라우저 저장소
- `app/src/ui`: 화면(main, graph, detail, editor, draft, insight, start, merge, import)
- `app/data`: 샘플 7개(월말 정산·카드승인·결제운영팀·행사팀·부서·교육팀·조직관리), 정답 표(v2), 시작 화면 문구, 가져오기 예시 문서(`doc-example.js`, inputs 원문 복사)
- `tests/*.test.js`: 단위 테스트
- `tools/`: 빌드, 브라우저 점검, 비밀값·데이터·규모 점검

## 7. 세션을 끝낼 때

`docs/.status`(완료·미확인·다음 작업)와 이 파일 1절을 갱신한다. 큰 결정과 해석은 `docs/tech-record.md`에 새 절로 남긴다.
