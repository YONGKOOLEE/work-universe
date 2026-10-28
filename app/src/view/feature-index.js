import { searchNodes } from './explore.js';

// 기능 찾기 카탈로그와 검색(CR-21 A). 화면(DOM)·저장소를 쓰지 않는다.
// 정해 둔 목록만 찾는다(자유 문장을 이해하지 않음, limits). 낱말 겹침·앞부분 일치·키워드(동의어)로 점수를 매기고 동점은 목록 순서.
//
// 항목 모양: { id, name, keywords[], where, needs, go, ... }
//   needs: 'none'  — 고른 항목 없이 간다
//          'work'  — 업무를 먼저 골라야 한다(담당 바꾸기·협업자 추가)
//          'node'  — 항목(사람·업무·문서 등)을 먼저 골라야 한다(수정·연결 추가·기록 남기기). 고를 목록에는 업무를 보인다
//          'edit'  — 고칠 수 있는 화면이어야 한다(추가류)
//          'grouped' — 묶은 지도에서 뜻이 있다(매주 점검·통합 확인). 아닌 지도에서는 이유를 알려 주는 자리로 간다
//   write: true      — 읽기 전용·되감기 중에는 쓸 수 없다
//   noGrouped: true  — 묶은 지도에서는 쓸 수 없다
//   requires: 'folderOk'|'tourOk' — ctx에서 그 값이 참일 때만(폴더를 쓸 수 있는 브라우저, 따라 하기가 있는 화면)
//   space: 그 기능이 있는 작업 공간(CR-22 W). 고르면 먼저 그 공간으로 바꾼 뒤 이동·강조한다(없으면 공간을 바꾸지 않음)
//   go: 동작 키(main.js의 goFeature가 푼다). 'ov:<testid>' 그 공간 첫 화면의 그 요소 · 'node:<동작>' 고른 항목의 상세 ·
//       'dlg:<창>' 창 열기 · 'insight:<탭>' 인사이트 · 그 밖은 이름 그대로

export const FEATURE_RESULT_LIMIT = 6; // 결과 목록에 보이는 수(CR-21 A-1)
export const FEATURE_WORK_LIMIT = 8; // 업무를 고르게 할 때 보이는 업무 이름 수(CR-21 A-2)

const F = (id, name, keywords, where, needs, go, extra = {}) => ({ id, name, keywords, where, needs, go, ...extra });

// 목록 순서가 동점 순서다 — 자주 찾는 것을 앞에 둔다
const BASE_FEATURES = [
  F('weekly', '이번 주 기록', ['기록', '메모', '이슈', '진행', '주간', '이번주', '남기기', '적기', '일지'], '「기록」 공간의 「이번 주 기록」', 'none', 'ov:weekly-quick', { write: true, sec: 'record' , space: 'record' }),
  F('issues', '미해결·해결로 표시', ['미해결', '해결', '해결됨', '이슈', '완료', '끝난', '닫기'], '「기록」 공간의 「미해결 n건」', 'none', 'ov:issue-count', { sec: 'record' , space: 'record' }),
  F('recent', '최근 기록', ['최근', '기록', '방금', '쓴', '썼던', '어디', '이력', '확인', '메모', '쓴 것', '기록 찾기', '찾기', '검색'], '「기록」 공간의 「최근 기록」(「모두 보기」에서 지도 전체 기록을 찾습니다)', 'none', 'ov:recent-records', { sec: 'record' , space: 'record' }),
  F('draft', '인수인계 초안 만들기', ['인수인계', '인계', '초안', '인수인계서', '문서', '넘기기', '후임', '후임자', '받는 사람'], '「인수인계」 공간', 'none', 'ov:btn-draft-universe', { sec: 'handover' , space: 'handover' }),
  F('assignee', '담당 넘기기', ['담당', '담당자', '넘기기', '인계', '교체', '변경', '바꾸기', '이동', '후임', '후임자', '받는 사람', '인수인계'], '업무를 고른 뒤 → 「담당 넘기기」', 'work', 'node:assignee', { write: true , space: 'handover' }),
  F('transfer', '담당도 넘기기(초안 확정)', ['담당', '담당자', '넘기기', '인계', '확정', '인수인계서'], '「인수인계」 공간의 「인수인계 초안 만들기」에서 확정할 때 「담당도 넘기기」', 'none', 'ov:btn-draft-universe', { write: true, sec: 'handover' , space: 'handover' }),
  F('event', '기록 남기기', ['이력', '기록', '메모', '담당 시작', '담당 종료', '소속 변경', '인수인계 기록', '이슈'], '항목을 고른 뒤 → 「기록 남기기」', 'node', 'node:event', { write: true , space: 'record' }),
  F('collab', '협업자 추가', ['협업', '협업자', '참조', '연락처', '다른 팀', '사람'], '업무를 고른 뒤 → 「⋯」 → 「협업자 추가」', 'work', 'node:collab', { write: true , space: 'handover' }),
  F('edit', '항목 수정', ['수정', '고치기', '편집', '이름', '설명', '속성', '기간', '바꾸기'], '항목을 고른 뒤 → 「⋯」 → 「수정」', 'node', 'node:edit', { write: true , space: 'edit' }),
  F('edge', '연결 추가', ['연결', '이어', '이음', '관계', '수행', '산출', '잇기'], '항목을 고른 뒤 → 「⋯」 → 「연결 추가」', 'node', 'node:edge', { write: true , space: 'edit' }),
  F('add', '사람·업무·문서 추가(하나씩)', ['추가', '새 항목', '사람', '업무', '문서', '산출물', '만들기', '넣기'], '「지도 관리」 공간의 「사람·업무·문서 추가」', 'edit', 'ov:goal-add-open', { write: true, sec: 'edit' , space: 'edit' }),
  F('table-add', '표로 추가', ['표', '엑셀', '스프레드시트', '붙여넣기', '여러 개', '한꺼번에', '추가'], '「사람·업무·문서 추가」 안 → 「표로 추가」(창이 열림)', 'edit', 'dlg:table-add', { write: true , space: 'edit' }),
  F('text-add', '글로 추가', ['글', '글로', '줄글', '문장', '텍스트', '붙여넣기', '추가', 'AI', '읽기'], '「사람·업무·문서 추가」 안 → 「글로 추가」(창이 열림)', 'edit', 'dlg:text-add', { write: true, noGrouped: true , space: 'edit' }),
  F('doc-attach', '문서로 더하기', ['문서', '회의록', '매뉴얼', '메모', '올리기', '업로드', '붙이기', '반영', '문서 더하기'], '「사람·업무·문서 추가」 안 → 「문서로 더하기」(창이 열림), 또는 업무를 고른 뒤 → 「⋯」 → 「이 업무에 문서 더하기」', 'edit', 'dlg:doc-attach', { write: true, noGrouped: true, space: 'edit' }),
  F('table-edit', '표로 고치기', ['표', '고치기', '한꺼번에', '수정', '일괄', '엑셀'], '「사람·업무·문서 추가」 안 → 「표로 고치기」(창이 열림)', 'edit', 'dlg:table-edit', { write: true , space: 'edit' }),
  F('doc-import', '문서 가져오기(읽어 보기)', ['문서', '가져오기', '업무정의서', '초벌', '변환', '붙여넣기', '불러오기', '읽어 보기'], '「지도 관리」 공간의 「가져오기·내보내기」 → 「문서 붙여넣기(읽어 보기)」 탭', 'none', 'dlg:import:doc', { space: 'edit' }),
  F('json-export', 'JSON 내보내기', ['내보내기', '백업', '저장', '파일', 'json', '다운로드', '내려받기'], '「지도 관리」 공간의 「가져오기·내보내기」 → 「내보내기」 탭', 'none', 'dlg:import:export', { space: 'edit' }),
  F('json-import', 'JSON 가져오기', ['가져오기', '불러오기', '열기', 'json', '파일', '복원'], '「지도 관리」 공간의 「가져오기·내보내기」 → 「JSON 파일」 탭', 'none', 'dlg:import:json', { space: 'edit' }),
  F('html-export', '내용 포함 HTML', ['html', '내용 포함', '공유', '한 파일', '읽기 전용', '내보내기', '내려받기', '보내기'], '「지도 관리」 공간의 「가져오기·내보내기」 → 「내보내기」 탭', 'none', 'dlg:import:export', { space: 'edit' }),
  F('folder', '폴더 연결', ['폴더', '공유', '동료', '함께', '팀', '거울', '연결'], '「지도 관리」 공간의 「가져오기·내보내기」 → 「폴더 연결」 탭', 'none', 'dlg:import:folder', { requires: 'folderOk' , space: 'edit' }),
  F('group', '업무 지도 묶기', ['묶기', '묶음', '팀', '부서', '상위', '합치기', '통합', '하위'], '「지도 관리」 공간의 「업무 지도 묶기」(창이 열림)', 'none', 'dlg:group', { write: true , space: 'edit' }),
  F('create', '새 업무 지도', ['새 지도', '만들기', '생성', '새로', '지도 만들기', '시작'], '「지도 관리」 공간의 「새 업무 지도」(창이 열림)', 'none', 'dlg:create', { write: true , space: 'edit' }),
  F('merge', '통합 확인 목록', ['통합', '확인', '같은 사람', '동일', '동일인', '중복', '합치기', '사번'], '「지도 관리」 공간의 「통합 확인 목록」(묶은 지도)', 'grouped', 'merge', { sec: 'edit' , space: 'edit' }), // 고르면 통합 확인 목록 화면을 바로 연다(묶은 지도가 아니면 이유를 알리는 자리로, FU8-23)
  F('insight', '인사이트 보기(인수인계 위험)', ['인사이트', '위험', '분석', '인수인계 위험', '지식 집중', '준비도', '파급', '혼자'], '「매주 점검」 공간의 「인사이트 보기」', 'none', 'insight:risk', { space: 'check' }),
  F('density', '밀집·공백(일이 몰린 사람, 담당자 없는 업무)', ['밀집', '공백', '몰린', '담당 없음', '빈 업무', '과부하', '일 많은'], '「매주 점검」 공간 → 인사이트 → 「밀집·공백」 탭', 'none', 'insight:density', { space: 'check' }),
  F('repeat', '반복 비효율', ['반복', '비효율', '되풀이', '인수인계 반복'], '「매주 점검」 공간 → 인사이트 → 「반복 비효율」 탭', 'none', 'insight:repeat', { space: 'check' }),
  F('similar', '유사 경험자', ['유사', '경험자', '대신', '후보', '백업', '해 본 사람'], '「매주 점검」 공간 → 인사이트 → 「유사 경험자」 탭', 'none', 'insight:similar', { space: 'check' }),
  F('flow', '흐름 변화', ['흐름', '변화', '추이', '시간 흐름'], '「매주 점검」 공간 → 인사이트 → 「흐름 변화」 탭', 'none', 'insight:flow', { space: 'check' }),
  F('weekly-check', '매주 점검(이번 점검 저장·지난 점검 대비)', ['점검', '매주', '위험', '저장', '비교', '지난', '대비', '증감', '이번 점검'], '「매주 점검」 공간(묶은 지도)', 'grouped', 'ov:team-risk-compare', { sec: 'check' , space: 'check' }),
  F('summary', '점검 요약(복사·내려받기·인쇄)', ['점검', '요약', '복사', '인쇄', '내려받기', '보고'], '「매주 점검」 공간의 「점검 요약 보기」', 'none', 'summary', { space: 'check' }),
  F('rewind', '편집 되감기', ['되감기', '되돌리기', '복원', '이전', '옛', '시점', '실수', '취소'], '「지도 관리」 공간의 「편집 되감기」', 'none', 'ov:rewind-entry', { noGrouped: true, sec: 'edit' , space: 'edit' }), // 읽기 전용에서도 쓸 수 있다 — 되감기는 보기만 한다(R11 RV11-6). 되감기 중·묶은 지도만 막는다
  F('hide', '항목 숨기기·삭제', ['숨기기', '삭제', '지우기', '지워'], '항목을 고른 뒤 → 「⋯」 → 「숨기기」(연결·이력이 없는 새 항목은 「삭제」도). 숨긴 것은 「숨긴 항목」에서 되살립니다', 'node', 'node:hide', { write: true, space: 'edit' }),
  F('hidden', '숨긴 항목', ['숨긴', '숨김', '되살리기', '삭제', '복구', '다시 보이게'], '「지도 관리」 공간의 「숨긴 항목 n개」', 'none', 'ov:hidden-count', { sec: 'edit' , space: 'edit' }),
  F('time', '시간 보기', ['시간', '과거', '기준일', '날짜', '그때', '달', '옛날'], '그래프 아래 「시간 보기」 막대', 'none', 'time'),
  F('find', '항목 찾기', ['찾기', '검색', '이름', '항목', '노드'], '그래프 위 「항목 찾기」 칸', 'none', 'find'),
  F('tools', '흐름 정렬·거르기', ['정렬', '거르기', '필터', '흐름 정렬', '사람별', '유형별'], '그래프 위 「도구 더 보기」', 'none', 'tools'),
  F('settings', '설정(생성 방식·작성자 이름·Claude API 키)', ['설정', '생성 방식', '작성자', '이름', 'api', '키', 'claude', '클로드'], '머리글 「설정」', 'none', 'dlg:settings'),
  F('tour', '따라 하기 다시 보기', ['따라', '도움말', '사용법', '안내', '튜토리얼', '처음', '가이드', '둘러보기'], '머리글 「?」 → 「따라 하기 다시 보기」', 'none', 'dlg:help', { requires: 'tourOk' }),
  F('reset', '가상 데이터 초기화', ['초기화', '리셋', '처음 상태', '샘플'], '「지도 관리」 공간의 「가져오기·내보내기」 창 맨 아래 — 모든 업무 지도를 전부 지웁니다(처음 샘플 상태로)', 'none', 'dlg:import:doc:reset-all', { space: 'edit' }), // 넷째 조각 reset-all: 창이 열린 뒤 그 단추까지(접힌 「고급」을 펼쳐) 데려간다
];

// 일상말 동의어(사용자 의견 10-26 저녁: "무엇을 할까요에서 아무거나 치면 나오는 게 아니라 앱 용어를 쳐야 한다").
// 기능 id별로 사람들이 실제로 치는 말을 더한다. 여기 한 곳에서만 고친다.
// 두 글자 이상 낱말은 앞부분 일치(「퇴사했어요」→ 퇴사)로 걸린다. 한 글자 낱말은 똑같을 때만 걸리므로 흔한 변형을 함께 적는다
export const DAILY_WORDS = {
  weekly: ['할 일', '할일', '해야 할 일', '오늘 할 일', '내 일', '메모 남기기', '메모해', '적어', '적어 두기', '적기', '남겨', '남기', '써 두기', '써 놓기', '오늘 한 일', '한 일', '진행 상황', '기록하기', '기록해'],
  event: ['남겨', '남기', '적어', '메모 남기기', '메모해', '인수인계 기록', '담당 바뀜', '기록해'],
  issues: ['문제', '문제 생김', '끝났', '끝남', '완료', '해결했', '처리', '처리됨', '닫기', '안 풀린', '안 끝난', '밀린', '막힌', '남은 일'],
  recent: ['내 메모', '내 기록', '내가 쓴', '내가 쓴 메모', '내 일', '어디 썼', '썼지', '썼나', '썼는지', '썼어', '쓴 것', '찾아', '찾아보기', '어디에 있', '지난 기록', '옛 기록', '적은 것', '예전에 쓴', '뭐 썼', '어디 적'],
  draft: ['부재', '출장', '자리 비움', '퇴사', '휴가', '출산', '육아', '전보', '자리 옮', '넘겨줄', '넘겨', '인계서', '후임에게', '다음 사람', '교대', '인수인계 문서', '그만두'],
  assignee: ['업무 넘기기', '동료에게 넘기기', '동료에게', '부재', '출장', '자리 비움', '퇴사', '휴가', '대신', '대신 맡', '넘겨', '넘기', '바뀌', '바뀜', '맡기', '맡겨', '맡길', '담당 바뀜', '담당 변경', '누구에게', '이어받', '그만두'],
  collab: ['잠깐 맡기기', '휴가 중', '부재 중', '같이 하는', '함께 하는', '도와주는', '다른 팀 사람', '참여자', '공동'],
  edit: ['이름 바꾸', '이름 변경', '오타', '틀린', '잘못', '고쳐', '수정해', '바꿔', '설명 바꾸'],
  edge: ['연결해', '이어주', '관계 맺', '엮', '붙이기'],
  add: ['새로', '새 업무', '새 사람', '새 문서', '추가', '더 넣', '넣기', '만들', '등록', '하나씩'],
  'table-add': ['엑셀', '표', '붙여', '붙여넣', '복사해서', '여러 명', '여러 개', '여러 업무', '한번에', '대량', '목록 붙여'],
  'text-add': ['글로', '문장', '글 붙여', '메일', '카톡', '복붙', '글 넣기', '문장 읽'],
  'doc-attach': ['문서 올리', '문서 올려', '회의록 올', '매뉴얼 올', '문서 붙', '지도에 반영', '지도에 문서', '문서 더', '실제 지도', '문서들'],
  'table-edit': ['엑셀', '표', '한꺼번에 고치', '일괄 수정', '대량 수정'],
  'doc-import': ['밑그림', '파일', '문서', '올리', '올려', '업로드', '워드', 'pdf', '불러오', '가져오', '업무 문서'],
  'json-export': ['백업', '저장', '보관', '파일로 저장', '내려받', '내보내', '다운로드', '복사본', '저장해', '다른 PC', '다른 컴퓨터', '옮기기', '옮겨', '이사', '집에서', '집 컴퓨터'],
  'json-import': ['복원', '백업 불러', '되살', '파일 열', '불러오', '가져오', '가져와', '올리', '올려', '옛 파일', '다른 PC', '다른 컴퓨터', '옮기기', '옮겨', '이사', '집에서', '집 컴퓨터'],
  'html-export': ['보내', '보낼', '공유', '메일로', '전달', '링크', '읽기만', '동료에게 공유', '공유하기'],
  folder: ['공유', '함께 쓰', '같이 쓰', '여럿이', '동료와', '공용', '같이 보기', '팀원'],
  group: ['팀·부서 지도', '팀', '합치', '합쳐', '묶', '하나로', '여러 지도', '부서', '팀 전체', '통합 지도'],
  create: ['새로', '새 지도', '처음부터', '다른 부서', '지도 하나 더', '새로 시작'],
  merge: ['두 번 들어간 사람', '두 번 들어간', '겹친 사람', '중복 사람', '이름이 두 개', '고른 답', '두 번', '맞춰 보기', '같은 사람', '중복', '겹치', '겹쳐', '이름이 같', '동명이인', '합치', '합쳐', '두 번 나옴', '두 명으로', '다시 묻기', '다시 물어', '묻기', '답 바꾸기', '고른 답 바꾸'],
  insight: ['제일 걱정되는 사람', '걱정되는 사람', '걱정되는', '걱정', '위험한 업무', '위험한 사람', '손볼 곳', '위험', '위험한', '혼자', '혼자만', '한 명만', '퇴사하면', '빠지면', '집중', '큰일'],
  density: ['몰린', '몰려', '과로', '바쁜', '너무 많', '담당 없', '주인 없', '비어', '빈 업무', '누가 안 맡'],
  similar: ['대신', '누가', '누가 할', '대타', '대체', '대신 할', '할 수 있는 사람', '해 본', '경험'],
  repeat: ['반복', '매번', '계속 같은', '똑같은 일', '또 같은'],
  flow: ['요즘', '변하', '달라진'],
  'weekly-check': ['이번 주 점검', '주간 점검', '지난주', '저번 주', '비교'],
  summary: ['보고서', '공유용'],
  rewind: ['고치기 전', '예전 모습', '되돌', '되돌려', '되돌리기', '실수', '잘못 지움', '복구', '방금 한 것', '이전으로', '전으로'],
  hide: ['삭제', '삭제하', '숨기', '지우', '지워', '지운', '지웠', '없애', '없애기', '항목 지우기', '하나 지우기', '빼기'],
  hidden: ['숨기', '숨겼', '숨긴', '안 보이', '다시 보이', '되돌리기', '되돌리', '실수로 숨'],
  time: ['그때', '예전', '지난달', '과거', '옛날', '당시', '그 시점'],
  find: ['이름으로', '어디 있', '이 사람', '이 업무', '항목 찾'],
  settings: ['내 이름', 'ai', '자동', '클로드'],
  tour: ['사용법', '어떻게', '도움', '모르겠', '가이드'],
  reset: ['처음 상태', '다 지우', '전부 지우', '모두 지우', '샘플 지우', '예시 지우', '비우기', '가상 데이터'],
};

export const FEATURES = BASE_FEATURES.map((f) => (DAILY_WORDS[f.id] ? { ...f, keywords: [...f.keywords, ...DAILY_WORDS[f.id].filter((k) => !f.keywords.includes(k))] } : f));

// 찾기 칸을 누르면(빈 칸) 바로 보이는 「자주 하는 일」(사용자 의견 10-26 저녁). id는 위 기능 목록, label은 사람이 말하는 이름
export const COMMON_FEATURES = [
  { id: 'weekly', label: '메모 남기기' },
  { id: 'draft', label: '인수인계서 만들기' },
  { id: 'assignee', label: '담당 넘기기' },
  { id: 'recent', label: '쓴 것 찾기' },
  { id: 'weekly-check', label: '이번 주 점검' }, // 왼쪽 메뉴 「매주 점검」 공간을 연다(RV13-6: 이름과 달리 인사이트 탭으로 가던 것)
  { id: 'add', label: '업무·사람 더 넣기' },
];
export const MAP_ITEM_LIMIT = 5; // 결과의 「지도에서」 묶음에 보이는 항목 수
export const MAP_ITEM_MIN_CHARS = 2; // 공백을 뺀 낱말이 이 글자 수 미만이면 지도 안 이름을 찾지 않는다(한 글자는 거의 다 맞는다)

const norm = (s) => String(s || '').toLowerCase().replace(/[「」()·,.?!~]/g, ' ').replace(/\s+/g, ' ').trim();

// 흔한 낱말: 이 낱말만으로는 약하게만 맞는다(한 곳에서 고친다)
const WEAK_TOKENS = new Set(['사람', '업무', '일', '내', '내가', '제일', '나', '저', '좀', '것', '거', '하는', '되는', '있는', '할', '수']);
const WEAK_MAX = 5;

// 낱말 하나가 기능 한 개에 닿는 점수(가장 높은 것 하나)
function tokenScore(tok, f, nameN, kws, whereN) {
  let best = 0;
  const hit = (n) => { if (n > best) best = n; };
  if (nameN === tok) hit(20);
  else if (tok.length >= 2 && nameN.startsWith(tok)) hit(11); // 한 글자 낱말(「내」)이 이름 앞글자와 맞는다고 걸리지 않게(「내 메모」에서 「내용 포함 HTML」이 위로 오던 것, FU8-8회차) // 키워드가 낱말과 똑같은 것(12)이 이름 앞부분 일치보다 위 — 「점검」은 매주 점검이 점검 요약보다 앞
  else if (tok.length >= 2 && nameN.includes(tok)) hit(9);
  for (const k of kws) {
    if (k === tok) hit(12);
    else if (tok.length >= 2 && k.startsWith(tok)) hit(8); // 앞부분 일치(「미해」→ 미해결)
    else if (k.length >= 2 && tok.startsWith(k)) hit(7); // 조사가 붙은 말(「담당을」→ 담당)
    else if (tok.length >= 2 && k.includes(tok)) hit(4);
  }
  if (tok.length >= 2 && whereN.includes(tok)) hit(2);
  // 어느 기능에나 있는 흔한 낱말(「사람」·「업무」·「내」)은 이름과 똑같은 때가 아니면 약하게만 센다 — 「제일 걱정되는 사람」이 협업자 추가로, 「위험한 업무」가 사람·업무 추가로 가던 것
  // 이름 안에 낱말이 들어 있는 기능은 상한을 한 칸 더 준다 — 「업무」 한 낱말만 치면 「사람·업무·문서 추가」가 1위(RV13-4: 동점일 때 목록 순서로 「담당 넘기기」가 1위가 되던 것)
  if (WEAK_TOKENS.has(tok) && nameN !== tok) return Math.min(best, nameN.includes(tok) ? WEAK_MAX + 1 : WEAK_MAX);
  return best;
}

const REQUIRES_REASON = {
  folderOk: '이 브라우저는 폴더 연결을 지원하지 않음',
  tourOk: '읽기 전용 파일에서는 따라 하기를 쓰지 않음',
};

/**
 * 못 쓰는 이유(없으면 null). ctx: { readOnly, rewinding, grouped, folderOk, tourOk }
 * 흐리게 보이는 결과에 붙는 말이다 — 「이 화면에서는 쓸 수 없음(이유)」
 * 편집 되감기 중에는 개요·인사이트 같은 화면 안 이동도 막힌다(되감기 화면이 개요를 대신하므로). 창을 여는 것(dlg:)은 쓸 수 있는 한 그대로 둔다
 */
export function featureBlock(f, ctx = {}) {
  if (ctx.rewinding && (f.write || !f.go.startsWith('dlg:'))) return '편집 되감기 중';
  if (f.write && ctx.readOnly) return '읽기 전용';
  if (f.noGrouped && ctx.grouped) return '묶은 지도에서는 팀·업무 지도를 열어서 쓰세요';
  if (f.requires && ctx[f.requires] === false) return REQUIRES_REASON[f.requires];
  return null;
}

/**
 * 기능 찾기. 질문 글에서 점수가 있는 기능을 점수 높은 순(동점은 목록 순서)으로 최대 limit개.
 * @returns {{id:string, name:string, where:string, needs:string, go:string, sec?:string, space?:string, score:number, blocked:string|null}[]}
 */
export function searchFeatures(query, ctx = {}, { limit = FEATURE_RESULT_LIMIT, features = FEATURES } = {}) {
  const q = norm(query);
  if (!q) return [];
  const tokens = q.split(' ').filter(Boolean);
  const out = [];
  features.forEach((f, order) => {
    const nameN = norm(f.name);
    const kws = f.keywords.map(norm);
    const whereN = norm(f.where);
    let score = 0;
    for (const tok of tokens) score += tokenScore(tok, f, nameN, kws, whereN);
    // 질문 전체가 이름에 그대로 들어 있으면 보너스(「담당 넘기기」)
    if (tokens.length > 1 && nameN.includes(q)) score += 10;
    // 질문 전체가 키워드 하나와 똑같으면 보너스(「같은 사람」→ 통합 확인이 「사람」만 걸린 협업자 추가보다 앞, R11 FU6-10)
    if (tokens.length > 1 && kws.includes(q)) score += 10;
    // 질문에 여러 낱말짜리 키워드가 그대로 들어 있으면 보너스(「전부 지우기」에 키워드 「전부 지우」 — 「지우기」 한 낱말만으로는 초기화로 가지 않게, FU9-24)
    else if (tokens.length > 1 && kws.some((k) => k.includes(' ') && q.includes(k))) score += 14;
    if (score > 0) out.push({ f, order, score });
  });
  out.sort((a, b) => b.score - a.score || a.order - b.order);
  return out.slice(0, limit).map(({ f, score }) => toResult(f, ctx, f.name, score));
}

function toResult(f, ctx, name, score) {
  return { id: f.id, name, where: f.where, needs: f.needs, go: f.go, ...(f.sec ? { sec: f.sec } : {}), ...(f.space ? { space: f.space } : {}), score, blocked: featureBlock(f, ctx) };
}

/** 「자주 하는 일」 목록(빈 칸일 때). 못 쓰는 것은 blocked 이유가 붙는다 */
export function commonFeatures(ctx = {}, { common = COMMON_FEATURES, features = FEATURES } = {}) {
  return common.map((c) => ({ f: features.find((x) => x.id === c.id), label: c.label })).filter((x) => x.f).map(({ f, label }) => toResult(f, ctx, label, 0));
}

/**
 * 지도 안 항목 이름 찾기(순수). 기존 그래프 「항목 찾기」의 searchNodes를 그대로 쓴다(이름 일부, 대소문자·공백 무시, 숨긴 항목 제외).
 * @returns {{query:string, total:number, rows:{gid:string,label:string,type_label:string}[]}}
 */
export function searchMapItems(view, query, { limit = MAP_ITEM_LIMIT, minChars = MAP_ITEM_MIN_CHARS } = {}) {
  const shown = String(query ?? '').replace(/\s+/g, ' ').trim();
  if (shown.replace(/\s/g, '').length < minChars) return { query: shown, total: 0, rows: [] };
  const hits = searchNodes(view, shown);
  return { query: shown, total: hits.length, rows: hits.slice(0, limit).map((h) => ({ gid: h.gid, label: h.label, type_label: h.type_label })) };
}
