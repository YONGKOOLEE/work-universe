# 세션 시작 안내 (HANDOFF)

새 세션은 **이 파일 하나만 먼저 읽는다.** 문서 전체를 읽으면 약 18만 자(6만 토큰 안팎)라서, 작업마다 필요한 절만 골라 읽는다(아래 "작업별로 읽을 곳").
마지막 갱신: 2026-10-13 (CR-12 T-23~T-26·C12-8 완료, 일곱 번째 검토 b72df34. 지금은 가 묶음 수정 중 → 제출 압축·나란히 재검증 → 사용자 결정 R7-1~10·사람 몫)

## 1. 지금 상태 (2026-10-13)

**2026-10-13 최신:** CR-12(승인 2026-10-13, 1차 제출을 실사용 수준으로) 중 T-23 인수인계서 내려받기·인쇄(R-19), T-24 미해결 이슈 보기·해결 표시(R-20, C12-8 resolves_id 포함), T-25 숨긴 노드 되살리기·백업 권유(R-21), T-26 찾기 넓히기·작성자 이름(R-22)을 구현·검증했다(단위 523, Chrome·Edge 통과). 일곱 번째 전체 검토(T-28, 커밋 b72df34, `docs/review-2026-10-13.md`)가 끝났고, 그중 "가" 묶음(코드: Sonnet / 문서: 이 갱신 포함)을 수정 중이다. **남은 일 순서:** 가 묶음 수정 → 메인의 전체 점검 → 새 제출 압축(`npm run package`, 9/9)·수정 전 판과 나란히 재검증 → 커밋 → 사용자 결정 R7-1~10(decisions-pending 11절)과 사람 몫(화면 확인, 메일 첨부 시험, 백업 push, 문서 3개 검토, 대리 관찰). T-27(흐름 정렬 배치)은 R7-1 결정 뒤, T-21은 조력자 샘플이 오면. 기능 동결 날짜는 폐기(CR-12), 동결은 진행에 따라 사용자가 정한다. 아래 "제출 가능한 판"·"검증" 줄은 CR-12 전 판이라 새 압축으로 바뀐다.

**모델 원칙:** 메인은 Opus, 구현은 Sonnet 하위 에이전트(파일 영역이 겹치지 않게 나눔), 코드 검토·재검증·기록·커밋은 메인(검토 하위 에이전트는 Opus).

**2026-10-13 추가(그 전):** 조력자 2명 의견 처리(tech-record 40절, decisions-pending 9절): 담당 시작·종료가 수행 연결과 함께 반영, 이력 15건 초과 접기, T-20 최소판(표준 양식 점검, rules/form.js), 샘플 맞춤, 「흐름 정렬」 시제품 버튼(채택 여부는 사용자 결정, 스크린샷 `.tmp/shots/*-20*`). 제출 압축은 다시 만들 것(`npm run package`, `check:submit`).

### 한 줄 요약
**T-19(표 입력)까지 구현(2026-10-12, 커밋은 git log). 그 전: T-18까지 구현, 여섯 번째 검토(`docs/review-2026-10-05.md`)의 "가"(바로 고칠 것)와 "나"(추천대로)를 처리했다.** 순서는 CR-11로 바뀌었다: **시연 대본·샘플 보강(끝남) → T-22(문서 3개 초안이 있음) → T-19 → (조력자 의견 뒤) T-20 최소판. T-21은 1차 제출에서 제외.** 연속 진행 모드.

### 결과물
- **제출 가능한 판:** `release/업무유니버스-제출본-20261005.zip`(제출 점검 9/9). 조력자에게 보낼 판도 이것(요청글 `.tmp/guide/조력자-요청글.md` 갱신). 이전 판들은 보관.
- **검증:** 단위 테스트 465개, Chrome·Edge 전체 점검, 실행 안내 따라가기(7단계), 제출 점검 9/9, 비밀값 0건, R-06 — 모두 통과.
- **새 문서(draft, 사용자 검토 전):** `docs/T-22-실사용-전환-경로.md`, `docs/소개자료-AI활용-초안.md`, `docs/시연-대본-초안.md`.
- **이번에 바뀐 화면:** 「패널 넓게 보기」, 확정 직후 안내(맨 위·그래프 가운데), 사번 칸/빈 메모/날짜 오류, 월말 정산에 「자료 수집·보고」 공백 이야기(윤바다가 떠난 뒤 후임 없음), 유사 경험자의 「역할 · 담당자 미연결」 표시.

### 사용자에게 남은 것 (`docs/decisions-pending.md` 7절 C11-1~7)
1. 새 문서 3개 읽고 고칠 곳 알려 주기(T-22 전환 경로가 길다: A4 5쪽 가까이)
2. T-18·이번 수정 화면 확인(확인 가이드는 아직 없음 — 끝에 묶어서 만들 것)
3. 조력자에게 새 압축과 요청글 보내기(사용자가 직접). 답(표준 양식·메모 규모)이 와야 T-20
4. 기능 동결 날짜(사용자가 미룸), 백업(push 또는 외부 복사)

### 다음 작업 순서
(T-19는 2026-10-12 완료: tech-record 39절. 아래는 참고)
T-22 사용자 검토 반영 → ~~T-19~~(표 입력·일괄 명령, 읽을 곳: 01 R-18·02 D-18·D-19·03 T-19·limits L-29·L-30. 시제품 브랜치 `proto-cr10-btable`의 C 부분은 참고만. review-2026-10-05 2절 "T-19 전에 정리하면 좋은 것" 6가지를 먼저: 변환기의 표 읽기 순수 함수 분리, 표 입력은 `ui/main.js`에 넣지 말고 별도 파일, `updateNode`가 attrs를 통째로 바꾸므로 병합 규칙, 길이 검사 한 곳, 거르기 상태 두 벌 정리) → (조력자 의견 뒤) T-20 최소판 → 동결 → 전체 검토 → T-16 촬영·T-15(사람 몫) → 제출. 항목마다 구현 → 검토 → 수정 → 나란히 재검증 → 새 제출 압축.
- T-19 착수 전 정해야 할 17가지는 review-2026-10-05 4절 D-2(표의 열, 머리글 인식, 기존 행 범위, 같은 이름 처리, 꼭지 연결, 오류 표시 등). "답이 없으면" 값으로 decisions-pending에 등록한 뒤 구현.
### 승인·결정 현황
- CR-1~CR-10 승인 완료(CR-9·CR-10은 2026-10-04 "우선 전부 권장대로"). 새 설계 결정은 D-16~D-20(검토 문서 결함 번호 D-1~D-15와 겹치지 않게).
- CR-12 승인 완료(2026-10-13): R-19~R-22, D-21~D-25, T-23~T-28. 동결 날짜 폐기·진행에 따라 사용자가 정함. 해석은 decisions-pending 10절(C12-1~12). 일곱 번째 검토 뒤 승인 문서 문구 CR 묶음은 R7-10에 대기.
- 아직 빈 자리: 02 5.6.2 표준 양식 내용(조력자 의견), 12.9.2 시험 문서·v2 결과(실문서), D-P7·B-P3(조력자 의견), limits L-10·L-14·L-25 값(각 작업 끝).

### 사람 몫 (일정 미정)
- T-14 대리 관찰(조력자 요청 1이 겸함), T-15 다른 PC·메일(요청 6이 겸함, 제출본 태그는 사용자), T-16 영상·대본(기능 동결 뒤)

### 최근 작업 (자세히는 tech-record·.status)
- 2026-10-03: 다섯 번째 전체 검토와 수정, 재검증 3회(tech-record 35절). CR-10 초안.
- 2026-10-04 낮: 자율 작업(변환기 가상 문서 10건 시험, 화면 크기·키보드 점검, CR-10 반영안, 시제품 브랜치), 경계 사례 108개 고정 비교(tech-record 36절).
- 2026-10-04 저녁: 일괄 답 처리 — 샘플 손질(ae4e26d), CR-9·CR-10 문서 반영(하위 에이전트 반영 + 별도 재검증), .status approvals·doc_changes·CONFIRM-2026-10-04 기록. 실행 안내 낱말 풀이(f9a34ec).
- 2026-10-04 밤: 화면 확인 "이상없으니까 진행", 동결 날짜는 미룸. T-18 구현(295c9cf) → 검토 A·B(7251496) → 재검증 회귀 3건(442e954) → 수렴(3894b25). tech-record 37절.
- 2026-10-05: 여섯 번째 전체 검토(4범주 에이전트) → "가"(c66ff84)·"나"(f10ab6c) 처리, CR-11, 새 문서 3개. tech-record 38절.

### 알려진 한계 (고치지 않고 남긴 것)
- 변환기: 「작성자 가상팀 2026.09.18, 기준일 …」은 기준일을 고름, 「제2026-1-5호」만 있으면 알림, 탭·공백 섞인 들여쓰기 등(tech-record 36.2). 정책은 02 12.9.2(D-P1~P7, T-21에서 구현).
- 화면: 빽빽한 화면에서 키운 꼭지 이름끼리 겹칠 수 있음, 모두 펼친 부서 화면에서 유형 거르기를 해도 남은 노드가 흩어져 이름이 작음(주변만 보기로 읽음), 800×450 같은 아주 작은 창은 최소 배율에 걸려 화면 밖 노드(tech-record 37절).
- 그 밖: `docs/limits.md` L-1~L-31.

### 문서 위치
- 진행 기록 `docs/.status`(implementation 절), 결정·해석 `docs/tech-record.md`(머리 목차), 한계 `docs/limits.md`, 사용자용 `docs/가져오기-사용가이드.md`, 확인·정리 가이드는 `.tmp/guide/`(Git 밖, 최신은 `진행-정리-20261004.md`).

## 2. 지켜야 할 것

- **구현:** 연속 진행 모드(T-ID 하나씩, 확인은 끝에 묶어서). CR-10 착수 조건(화면 확인)은 2026-10-04에 충족("이상없으니까 진행").
- **지침:** `CLAUDE.md`. 연속 진행 모드: T-ID 하나씩 하되 확인을 기다리지 않고 다음으로, 검증을 통과하면 로컬 자동 커밋(push·태그 없음). 승인 문서(00~03)를 바꿔야 하는 것은 하지 않고 CR 후보로 `decisions-pending.md`에 쌓는다.
- **실행 조건:** `dist/index.html` 파일 하나. `file://` 더블클릭으로 동작해야 하므로 `type="module"`과 `fetch`는 쓰지 않는다. 빌드할 때 검사한다.
- **데이터:** 가상 데이터만 쓴다. 사번은 `V-`+4자리.
- **모듈 경계(02-design 12.7):** `model`·`view`·`rules`·`llm`은 DOM·저장소를 쓰지 않는다(Node 테스트용). 화면은 `ui`, 흐름은 `app`.
- **샘플:** `app/data/*.js`의 `STAMP`는 반드시 **과거 시각**이다(테스트가 막는다). 샘플을 고치면 STAMP를 바꾼다.
- **사용자와 일하는 방식:** **답은 반드시 한국어로만**(긴 작업 뒤 요약에서 영어로 바뀌어 크게 질책받음, 2026-10-03). 결정은 추천안과 기본값을 붙여 묻는다. 확인은 묶어서 받는다. 진행도를 물으면 근거와 함께 답한다. 조력자에게 보낼 글은 편한 반말로 쓴다.
- **확인이 밀리지 않게:** 연속 진행 중이라도 사용자가 마지막으로 직접 확인한 지점에서 너무 멀어지면(예: 커밋 10개 이상) 확인 가이드를 만들어 먼저 권한다(2026-10-03 사용자 지적 "내가 확인하고 있지 않는데 괜찮은지").
- **"다 됐다"고 하기 전에:** 테스트 기대값을 구현 뒤에 정했다면 일부러 결함을 넣어 테스트가 잡는지 보고, 실제와 비슷한 입력(예: 한글·워드 문서)으로 한 번 더 시험한다. 큰 기능은 하위 에이전트 검토(범주별, 재현 스크립트 요구)를 돌린다.
- **고친 뒤 다시 검증:** 검토에서 나온 것을 고친 뒤에는 "수정 전 판과 나란히 돌려 비교하는" 재검증 에이전트를 따로 돌린다(2026-10-03: 수정이 만든 회귀 13건을 이렇게 잡음). 정규식·낱말 목록은 읽혀야 하는 것과 읽히면 안 되는 것을 함께 테스트에 넣는다. 하위 에이전트에게는 파일 영역이 겹치지 않는 작은 묶음으로 나눠 맡긴다(한도로 끊기면 git diff·npm test로 상태부터 확인).

## 3. 명령

```
npm test                  # 단위 테스트(523개, 2026-10-13 실행 결과. 이후 늘 수 있음)
node tools/pregen-dump.mjs        # 사전 생성 작성용 근거 덤프(데이터를 바꾸면 다시 보고 app/data/pregen.js 고침)
npm run build             # dist/index.html (바이트 크기 표시)
npm run check:browser     # Chrome·Edge file:// 점검. SHOT_DIR=.tmp/shots 를 주면 화면 PNG 저장
npm run check:secrets     # 비밀값 형식 검색(dist 포함). 0건이어야 함
npm run package           # 제출 압축 release/업무유니버스-제출본-날짜.zip
npm run check:submit      # 제출 점검 9단계(압축을 풀어 새 프로필로 브라우저 점검 + 실행 안내 따라가기). --quick은 브라우저 생략
npm run check:guide       # 실행 안내 "5분 둘러보기"를 실제 마우스·키보드로 따라가기(Chrome·Edge)
node tools/virtual-data-check.mjs   # R-06 형식 점검
node tools/convert-snapshot.mjs     # 변환기 경계 사례 108개 차이 보기(규칙을 일부러 바꿨으면 사례마다 판정한 뒤 --write)
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

- **정규식을 스크립트로 넣지 말 것(재발):** 2026-10-04 `.cjs` 치환 스크립트 안의 `\s+`가 `s+`로 들어가 수정이 효과 없었다(테스트도 못 잡음). 정규식은 Edit 도구로, 판정은 순수 함수로 빼서 테스트한다.
- **브라우저를 여러 에이전트가 쓸 때:** `check:browser`는 포트 9333, `check:guide` 9600, `perf-check` 9911을 쓴다. 다른 에이전트에는 겹치지 않는 포트 범위(예: 9700~)와 자기 프로필 폴더를 주고, `taskkill` 전체 종료를 금지한다.

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
| 변환기를 고칠 때 | tech-record 35.2·36.1(회귀 교훈), `tests/convert-snapshot.test.js`·`node tools/convert-snapshot.mjs`(경계 사례 108개 차이), `tests/corpus.test.js`(가상 업무정의서 10건), `docs/가져오기-사용가이드.md` 4~6절 |
| T-18 찾기·거르기·주변만 보기(다시 볼 때) | 01 R-17, 02 D-17, tech-record 37절, `app/src/view/explore.js`, `app/src/ui/explore.js`(상수 EXPLORE), `app/src/ui/graph.js`(tiny-label·bigLabel·fitTo), `tests/explore.test.js` |
| CR-10 시제품을 볼 때 | 브랜치 `proto-cr10-btable`(`git log main..proto-cr10-btable`), `.tmp/proto-cr10/` 스크린샷, tech-record 36절 |
| 다섯 번째 검토(2026-10-03) 후속 | `docs/review-2026-10-03.md`(항목·판정·10절 처리 결과), tech-record 35·35.1·35.2절, decisions-pending 4절(CR-9 후보), `tests/review5-*.test.js`, `tests/helpers.js` |
| CR-12 (T-23~T-26, R-19~R-22) | `docs/CR-12-초안.md`, 01 R-19~R-22, 02 D-21~D-25·12.2 memo payload(resolves_id)·12.4(authorName·lastExportAt), 03 T-23~T-28, tech-record 41~44절, decisions-pending 10절, limits L-38~L-41, `docs/review-2026-10-13.md`, `tests/issues·backup·search-wide.test.js` |
| 화면 수정 | `app/src/ui/*`, tech-record 8·12·17·21절 |

## 6. 코드 지도

- `app/src/model`: 스키마 상수·검증·명령(일괄 명령 applyBatch, 되살리기 restoreNode 포함)·가져오기 미리 보기(`import.js`)·표 읽기(`table.js`)(순수 함수)
- `app/src/view`: 합성 뷰, 상세 문장, 층별 보기, 찾기·거르기(`explore.js`, 설명·속성까지 찾기 포함), 새 노드 자리(`place.js`), 흐름 정렬(`lanes.js`), 인수인계서 HTML 만들기(`handover-doc.js`)
- `app/src/merge`: 통합 확인 목록(사번 자동 연결, 사번 충돌·없음, 업무 후보)
- `app/src/rules`: 인수인계 초안(`handover.js`), 인사이트(`insight.js`), 문서 초벌 변환(`doc-convert.js`), 표준 양식 점검(`form.js`), 미해결 이슈 판정(`issues.js`), 숨긴 노드 목록(`hidden.js`), 백업 권유 판단(`backup.js`)
- `app/src/llm`: 연결부(`connector.js`)와 공급자(`providers.js`: 사전 생성 기본, Claude API·사내 LLM은 P2 자리)
- `app/src/app`: 명령 흐름과 저장(가져오기 importUniverse·내보내기 exportJson·초안 확정 confirmHandover 포함)
- `app/src/store`: 브라우저 저장소
- `app/src/ui`: 화면(main, graph, detail, editor, draft, insight, start, merge, import, settings, table 표 대화상자, issues 미해결 목록, hidden 숨긴 노드 목록, backup 백업 권유 줄)과 도우미(dom, messages, chip-label, evidence 근거 칩, time 날짜, doc-output 인수인계서 내려받기·인쇄)
- `app/data`: 샘플 7개(월말 정산·카드승인·결제운영팀·행사팀·부서·교육팀·조직관리), 정답 표(v2), 시작 화면 문구, 가져오기 예시 문서(`doc-example.js`, inputs 원문 복사)
- `tests/*.test.js`: 단위 테스트. `tests/helpers.js`(공용 샘플은 깊게 동결됨), `tests/fixtures/corpus/`(가상 업무정의서 10건, 머리 주석에 정답), `tests/fixtures/convert-cases/`(변환기 경계 사례 108개와 스냅숏)
- `tools/`: 빌드, 브라우저 점검, 비밀값·데이터·규모 점검

## 7. 세션을 끝낼 때

`docs/.status`(완료·미확인·다음 작업)와 이 파일 1절을 갱신한다. 큰 결정과 해석은 `docs/tech-record.md`에 새 절로 남긴다.
