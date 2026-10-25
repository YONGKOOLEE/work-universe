// 기능 찾기 카탈로그와 검색(CR-21 A). 화면(DOM)·저장소를 쓰지 않는다.
// 정해 둔 목록만 찾는다(자유 문장을 이해하지 않음, limits). 낱말 겹침·앞부분 일치·키워드(동의어)로 점수를 매기고 동점은 목록 순서.
//
// 항목 모양: { id, name, keywords[], where, needs, go, ... }
//   needs: 'none'  — 고른 항목 없이 간다
//          'work'  — 업무를 먼저 골라야 한다(담당 바꾸기·협업자 추가)
//          'node'  — 항목(사람·업무·문서 등)을 먼저 골라야 한다(수정·연결 추가·이력 추가). 고를 목록에는 업무를 보인다
//          'edit'  — 고칠 수 있는 화면이어야 한다(추가류)
//          'grouped' — 묶은 지도에서 뜻이 있다(매주 점검·통합 확인). 아닌 지도에서는 이유를 알려 주는 자리로 간다
//   write: true      — 읽기 전용·되감기 중에는 쓸 수 없다
//   noGrouped: true  — 묶은 지도에서는 쓸 수 없다
//   requires: 'folderOk'|'tourOk' — ctx에서 그 값이 참일 때만(폴더를 쓸 수 있는 브라우저, 따라 하기가 있는 화면)
//   go: 동작 키(main.js의 goFeature가 푼다). 'ov:<testid>' 개요의 그 요소 · 'sec:<구역>' 개요의 목적별 묶음 · 'node:<동작>' 고른 항목의 상세 ·
//       'dlg:<창>' 창 열기 · 'insight:<탭>' 인사이트 · 그 밖은 이름 그대로

export const FEATURE_RESULT_LIMIT = 6; // 결과 목록에 보이는 수(CR-21 A-1)
export const FEATURE_WORK_LIMIT = 8; // 업무를 고르게 할 때 보이는 업무 이름 수(CR-21 A-2)

const F = (id, name, keywords, where, needs, go, extra = {}) => ({ id, name, keywords, where, needs, go, ...extra });

// 목록 순서가 동점 순서다 — 자주 찾는 것을 앞에 둔다
export const FEATURES = [
  F('weekly', '이번 주 기록', ['기록', '메모', '이슈', '진행', '주간', '이번주', '남기기', '적기', '일지'], '개요 → 「기록하기」 묶음', 'none', 'ov:weekly-quick', { write: true, sec: 'record' }),
  F('issues', '미해결·해결로 표시', ['미해결', '해결', '해결됨', '이슈', '완료', '끝난', '닫기'], '개요 → 「기록하기」 묶음의 「미해결 n건」', 'none', 'ov:issue-count', { sec: 'record' }),
  F('recent', '최근 기록', ['최근', '기록', '방금', '쓴', '썼던', '어디', '이력', '확인'], '개요 → 「기록하기」 묶음의 「최근 기록」', 'none', 'ov:recent-records', { sec: 'record' }),
  F('draft', '인수인계 초안 만들기', ['인수인계', '인계', '초안', '인수인계서', '문서', '넘기기'], '개요 → 「인수인계」 묶음', 'none', 'ov:btn-draft-universe', { sec: 'handover' }),
  F('assignee', '담당 바꾸기', ['담당', '담당자', '넘기기', '인계', '교체', '변경', '바꾸기', '이동'], '업무를 고른 뒤 → 「담당 바꾸기」', 'work', 'node:assignee', { write: true }),
  F('transfer', '담당도 넘기기(초안 확정)', ['담당', '담당자', '넘기기', '인계', '확정', '인수인계서'], '「인수인계 초안 만들기」에서 확정할 때 「담당도 넘기기」', 'none', 'ov:btn-draft-universe', { write: true, sec: 'handover' }),
  F('event', '이력 추가', ['이력', '기록', '메모', '담당 시작', '담당 종료', '소속 변경', '인수인계 기록', '이슈'], '항목을 고른 뒤 → 「이력 추가」', 'node', 'node:event', { write: true }),
  F('collab', '협업자 추가', ['협업', '협업자', '참조', '연락처', '다른 팀', '사람'], '업무를 고른 뒤 → 「협업자 추가」', 'work', 'node:collab', { write: true }),
  F('edit', '항목 수정', ['수정', '고치기', '편집', '이름', '설명', '속성', '기간', '바꾸기'], '항목을 고른 뒤 → 「수정」', 'node', 'node:edit', { write: true }),
  F('edge', '연결 추가', ['연결', '이어', '이음', '관계', '수행', '산출', '잇기'], '항목을 고른 뒤 → 「연결 추가」', 'node', 'node:edge', { write: true }),
  F('add', '사람·업무·문서 추가(하나씩)', ['추가', '새 항목', '사람', '업무', '문서', '산출물', '만들기', '넣기'], '개요 → 「지도 고치기」 묶음의 「사람·업무·문서 추가」', 'edit', 'ov:goal-add-open', { write: true, sec: 'edit' }),
  F('table-add', '표로 추가', ['표', '엑셀', '스프레드시트', '붙여넣기', '여러 개', '한꺼번에', '추가'], '「사람·업무·문서 추가」 안 → 「표로 추가」(창이 열림)', 'edit', 'dlg:table-add', { write: true }),
  F('text-add', '글로 추가', ['글', '글로', '줄글', '문장', '텍스트', '붙여넣기', '추가', 'AI', '읽기'], '「사람·업무·문서 추가」 안 → 「글로 추가」(창이 열림)', 'edit', 'dlg:text-add', { write: true, noGrouped: true }),
  F('table-edit', '표로 고치기', ['표', '고치기', '한꺼번에', '수정', '일괄', '엑셀'], '「사람·업무·문서 추가」 안 → 「표로 고치기」(창이 열림)', 'edit', 'dlg:table-edit', { write: true }),
  F('doc-import', '문서 가져오기(초벌 변환)', ['문서', '가져오기', '업무정의서', '초벌', '변환', '붙여넣기', '불러오기'], '머리글 「가져오기·내보내기」 → 「문서 붙여넣기(초벌 변환)」 탭', 'none', 'dlg:import:doc'),
  F('json-export', 'JSON 내보내기', ['내보내기', '백업', '저장', '파일', 'json', '다운로드', '내려받기'], '머리글 「가져오기·내보내기」 → 「내보내기」 탭', 'none', 'dlg:import:export'),
  F('json-import', 'JSON 가져오기', ['가져오기', '불러오기', '열기', 'json', '파일', '복원'], '머리글 「가져오기·내보내기」 → 「JSON 파일」 탭', 'none', 'dlg:import:json'),
  F('html-export', '내용 포함 HTML', ['html', '내용 포함', '공유', '한 파일', '읽기 전용', '내보내기', '내려받기', '보내기'], '머리글 「가져오기·내보내기」 → 「내보내기」 탭', 'none', 'dlg:import:export'),
  F('folder', '폴더 연결', ['폴더', '공유', '동료', '함께', '팀', '거울', '연결'], '머리글 「가져오기·내보내기」 → 「폴더 연결」 탭', 'none', 'dlg:import:folder', { requires: 'folderOk' }),
  F('group', '업무 지도 묶기', ['묶기', '묶음', '팀', '부서', '상위', '합치기', '통합', '하위'], '머리글 「업무 지도 묶기」(창이 열림)', 'none', 'dlg:group', { write: true }),
  F('create', '새 업무 지도', ['새 지도', '만들기', '생성', '새로', '지도 만들기', '시작'], '머리글 「새 업무 지도」(창이 열림)', 'none', 'dlg:create', { write: true }),
  F('merge', '통합 확인 목록', ['통합', '확인', '같은 사람', '동일', '중복', '합치기', '사번'], '개요 → 「지도 고치기」 묶음의 「통합 확인 목록」(묶은 지도)', 'grouped', 'ov:merge-hint', { sec: 'edit' }),
  F('insight', '인사이트 보기(인수인계 위험)', ['인사이트', '위험', '분석', '인수인계 위험', '지식 집중', '준비도', '파급', '혼자'], '개요 → 「점검」 묶음의 「인사이트 보기」', 'none', 'insight:risk'),
  F('density', '밀집·공백(일이 몰린 사람, 담당자 없는 업무)', ['밀집', '공백', '몰린', '담당 없음', '빈 업무', '과부하', '일 많은'], '인사이트 → 「밀집·공백」 탭', 'none', 'insight:density'),
  F('repeat', '반복 비효율', ['반복', '비효율', '되풀이', '인수인계 반복'], '인사이트 → 「반복 비효율」 탭', 'none', 'insight:repeat'),
  F('similar', '유사 경험자', ['유사', '경험자', '대신', '후보', '백업', '해 본 사람'], '인사이트 → 「유사 경험자」 탭', 'none', 'insight:similar'),
  F('flow', '흐름 변화', ['흐름', '변화', '추이', '시간 흐름'], '인사이트 → 「흐름 변화」 탭', 'none', 'insight:flow'),
  F('weekly-check', '매주 점검(이번 점검 저장·지난 점검 대비)', ['점검', '매주', '위험', '저장', '비교', '지난', '대비', '증감', '이번 점검'], '개요 → 「점검」 묶음(묶은 지도)', 'grouped', 'ov:team-risk-compare', { sec: 'check' }),
  F('summary', '점검 요약(복사·내려받기·인쇄)', ['점검', '요약', '복사', '인쇄', '내려받기', '보고'], '개요 → 「점검」 묶음의 「점검 요약 보기」', 'none', 'summary'),
  F('rewind', '편집 되감기', ['되감기', '되돌리기', '복원', '이전', '옛', '시점', '실수', '취소'], '개요 → 「지도 고치기」 묶음의 「편집 되감기」', 'none', 'ov:rewind-entry', { write: true, noGrouped: true, sec: 'edit' }),
  F('hidden', '숨긴 항목', ['숨긴', '숨김', '되살리기', '삭제', '복구', '다시 보이게'], '개요 → 「지도 고치기」 묶음의 「숨긴 항목 n개」', 'none', 'ov:hidden-count', { sec: 'edit' }),
  F('time', '시간 보기', ['시간', '과거', '기준일', '날짜', '그때', '달', '옛날'], '그래프 아래 「시간 보기」 막대', 'none', 'time'),
  F('find', '항목 찾기', ['찾기', '검색', '이름', '항목', '노드'], '그래프 위 「항목 찾기」 칸', 'none', 'find'),
  F('tools', '흐름 정렬·거르기', ['정렬', '거르기', '필터', '흐름 정렬', '사람별', '유형별'], '그래프 위 「도구 더 보기」', 'none', 'tools'),
  F('settings', '설정(생성 방식·작성자 이름·Claude API 키)', ['설정', '생성 방식', '작성자', '이름', 'api', '키', 'claude', '클로드'], '머리글 「설정」', 'none', 'dlg:settings'),
  F('tour', '따라 하기 다시 보기', ['따라', '도움말', '사용법', '안내', '튜토리얼', '처음', '가이드', '둘러보기'], '머리글 「?」 → 「따라 하기 다시 보기」', 'none', 'dlg:help', { requires: 'tourOk' }),
  F('reset', '가상 데이터 초기화', ['초기화', '리셋', '처음 상태', '샘플', '되돌리기', '지우기'], '머리글 「가져오기·내보내기」 창 맨 아래', 'none', 'dlg:import:doc'),
];

const norm = (s) => String(s || '').toLowerCase().replace(/[「」()·,.?!~]/g, ' ').replace(/\s+/g, ' ').trim();

// 낱말 하나가 기능 한 개에 닿는 점수(가장 높은 것 하나)
function tokenScore(tok, f, nameN, kws, whereN) {
  let best = 0;
  const hit = (n) => { if (n > best) best = n; };
  if (nameN === tok) hit(20);
  else if (nameN.startsWith(tok)) hit(11); // 키워드가 낱말과 똑같은 것(12)이 이름 앞부분 일치보다 위 — 「점검」은 매주 점검이 점검 요약보다 앞
  else if (tok.length >= 2 && nameN.includes(tok)) hit(9);
  for (const k of kws) {
    if (k === tok) hit(12);
    else if (tok.length >= 2 && k.startsWith(tok)) hit(8); // 앞부분 일치(「미해」→ 미해결)
    else if (k.length >= 2 && tok.startsWith(k)) hit(7); // 조사가 붙은 말(「담당을」→ 담당)
    else if (tok.length >= 2 && k.includes(tok)) hit(4);
  }
  if (tok.length >= 2 && whereN.includes(tok)) hit(2);
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
 * @returns {{id:string, name:string, where:string, needs:string, go:string, sec?:string, score:number, blocked:string|null}[]}
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
    // 질문 전체가 이름에 그대로 들어 있으면 보너스(「담당 바꾸기」)
    if (tokens.length > 1 && nameN.includes(q)) score += 10;
    if (score > 0) out.push({ f, order, score });
  });
  out.sort((a, b) => b.score - a.score || a.order - b.order);
  return out.slice(0, limit).map(({ f, score }) => ({ id: f.id, name: f.name, where: f.where, needs: f.needs, go: f.go, ...(f.sec ? { sec: f.sec } : {}), score, blocked: featureBlock(f, ctx) }));
}
