# 업무잇다 — AI 업무 지식관리 · 상시 인수인계 플랫폼 (MVP)

문서가 아닌 **업무(Work Unit)** 를 중심으로 배경·경과·결정·향후 조치를 연결하고,
업무 상세 화면 자체를 인수인계 자료로 쓰는 인터랙티브 프로토타입.

## 바로 열기

- 제출본 최상위 폴더의 `업무잇다.html`을 더블클릭하면 브라우저에서 바로 실행됨 (설치 불필요, 시연 데이터 내장)
- 제출본 HTML 다시 만들기: `npm install` → `npm run single`
- 게시 페이지와 이 파일은 데이터가 따로 저장됨. 상단 '데이터 옮기기'에서 내보내기 → 불러오기로 이동
- 폴더의 `index.html`은 개발용 진입 파일이라 직접 열면 빈 화면이 나옴

## 실행 (개발)

```bash
npm install
npm run dev        # 개발 서버 (http://localhost:5173)
npm run build      # dist/ 정적 빌드
npm run single     # dist-single/index.html 단일 파일 빌드 (서버 없이 열기)
```

- React 18 + TypeScript + Tailwind CSS 3 + lucide-react, 서버·DB 없음
- 상태는 `localStorage`(`worklink-state`)에 보존. 상단 '초기화'로 시연 데이터 복원
  - 기본 시연 상태: 가상 업무 1건과 문서 2건이 등록된 상태

## 이번 추가 기능

- **PDF 등록**: pdf.js로 브라우저에서 본문 추출. 쪽 번호·문단 번호(p쪽-문단)를 유지해 근거 위치로 사용. 글자가 거의 없으면 스캔 PDF로 보고 '별도 확인 필요' 경고
- **업무 반영 미리보기**: 문서 등록 시 결정사항·타임라인 이벤트·향후 조치·업무 개요 갱신 제안을 추출 → 근거 인용문과 날짜를 원문과 대조 → 담당자가 항목별로 승인한 것만 반영 (`src/ai/reflect.ts`, `src/components/ReflectionPreview.tsx`)
- **Claude 연결**: claude.ai 게시 페이지의 sample 기능으로 문서 분석·AI 검색을 Claude가 수행 (`src/ai/claude.tsx`, `src/ai/claudeSearch.ts`). 페이지를 여는 사람의 Claude 계정을 사용하며 첫 호출 때 동의 창이 뜸. claude.ai 밖에서 실행하면 자동으로 규칙 기반 Mock 엔진 사용. 중복 업무 탐지는 Mock 유지
- Claude 답변의 '원문 확인' 표시는 Claude가 아니라 플랫폼이 인용문을 원문과 직접 대조해 판정함. 일치하지 않으면 '추가 확인 필요'로 낮춤

## 데이터 버전 (schema 7)

- schema 7: 업무에 `nextIds`(선후행)·`topics`(주제), 상태에 `mapHidden`, 사용자에 `empNo`·`role` 추가. 6→7 변환은 `lib/migrate.ts`, 불러오기·저장 데이터는 6과 7만 받음

## 업무 검색

- AI 업무 검색은 질문에 나온 업무를 찾아 그 업무 자료로만 답함 (`ai/workAnswer.ts`, Claude 검색도 동일하게 대상 업무 자료만 전달)

## 담당자·열람 범위 (schema 4)

- 담당자는 복수 지정(`owners`), 담당 기간은 `ownerHistory`에 시작·종료일로 남음. 인계 시 인계자가 '담당에서 빠짐/공동 담당 유지'를 선택
- 사용자는 본인이 담당자인 업무와 인수 대기 중인 업무만 볼 수 있음 (`scopeFor` in `lib/store.tsx`)
- 업무 관리·문서함·타임라인·회의록은 사용자별로 마지막에 보던 업무를 공유 (`useFocus`)

## 구조

```
src/
  lib/types.ts        단일 데이터 모델 (업무·문서·이벤트·결정·조치·이력·인계·스냅샷)
  lib/store.tsx       전역 저장소 + localStorage 영속화 + 변경 이력 기록
  lib/router.tsx      메모리 라우터 (iframe 환경에서도 동작)
  data/seed.ts        시연 초기 데이터(가상) — createSeed('linked' | 'fresh')
  ai/concepts.ts      업무 개념 사전 · 유사도 (임베딩 API로 교체 지점)
  ai/engine.ts        Mock AI: 누락 점검, 브리핑, 중복 탐지, 문서 분석, AI 검색
  ai/reflect.ts       반영 제안 추출(Claude/Mock) · 원문 대조 검증 · 승인 항목 반영
  ai/claude.tsx       Claude 연결 상태·엔진 선택(Claude/Mock)·오류 처리
  ai/claudeSearch.ts  Claude 기반 AI 검색 + 인용 검증
  lib/pdf.ts          PDF 본문 추출
  pages/*             대시보드 · 업무 관리/상세 · 문서함 · 타임라인 · 회의록 · AI 검색 · 인계
```

## 근거 구분 원칙

| 표시 | 의미 |
|---|---|
| 원문 확인 | 등록 원문에 직접 기재 (근거 위치로 이동 가능) |
| AI 추론 | 여러 자료를 종합한 해석 |
| 추가 확인 필요 | 근거 부족 — 확정하지 않음 |
| 담당자 작성 | 사람이 직접 입력 |

이벤트·문서의 원문 상태: 원문 확보 / 원문 내 인용 확인 / 정책 이력 참고정보 / 링크만 등록 / 플랫폼 기록

## 시연 데이터

시연 데이터는 모두 가상이다.
