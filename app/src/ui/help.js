// 머리글 「?」 도움말(FU-9, 처음 사용 점검 2026-10-24): 왼쪽 공간 5개·용어 7개·생성 방식 3개(접힘)·키와 데이터·「따라 하기 다시 보기」.
// 문구 원문은 이 파일(용어)과 ai-notes.js(AI 관련 글) 두 곳에 둔다. 따라 하기가 없는 화면에서도 같은 상자가 열린다.

import { el } from './dom.js';
import { PREGEN_NOTE_FULL, SECURITY_ITEMS, SECURITY_TITLE } from './ai-notes.js';

export const HELP_TITLE = '도움말';
export const HELP_INTRO = '이 앱은 업무마다 누가 언제 무엇을 했는지 기록해 두고, 담당자가 바뀔 때 근거 달린 인수인계 초안과 「혼자만 아는 업무」 경고를 만듭니다.';
export const HELP_SPACES_TITLE = '왼쪽 공간';
export const HELP_SPACES = [
  { term: '지도 보기', desc: '그래프를 둘러보고 항목을 눌러 속성·연결·이력을 봅니다.' },
  { term: '기록', desc: '업무에 메모를 남기고, 미해결을 모아 보고 해결로 표시합니다.' },
  { term: '인수인계', desc: '인수인계 초안을 만들고, 담당 공백·혼자만 아는 일 가운데 먼저 넘길 일을 고릅니다.' },
  { term: '매주 점검', desc: '인수인계 위험을 보고, 묶은 지도는 점검을 저장해 지난번과 비교합니다.' },
  { term: '지도 관리', desc: '항목 추가·수정, 새 업무 지도 만들기·묶기, 가져오기·내보내기, 편집 되감기를 합니다.' },
];
// 메뉴 옆 숫자 배지의 뜻(R11 FU6-16)
export const HELP_SPACES_BADGE = '메뉴 옆 숫자: 「기록」은 미해결 건수, 「매주 점검」은 혼자만 아는 일 개수입니다(0이면 숫자가 없습니다).';
export const HELP_TERMS_TITLE = '용어';
export const HELP_TERMS = [
  { term: '업무 지도', desc: '업무를 묶은 한 단위입니다.' },
  { term: '항목', desc: '그래프의 도형 하나입니다. 사람·업무·산출물·주제·조직이 있습니다.' },
  { term: '지도 중심', desc: '연두색 큰 동그라미입니다. 업무 지도 전체를 뜻합니다.' },
  { term: '묶은 지도', desc: '여러 업무 지도를 팀·부서로 묶은 지도입니다. 접힌 하위 지도를 펼쳐 볼 수 있고, 매주 점검에서 지난 점검과 비교합니다.' },
  { term: '혼자만 아는 일', desc: '지금 해 본 사람이 한 명뿐인 업무입니다. 인수인계 기록이 없으면 위험이 높음, 있으면 주의로 보입니다.' },
  { term: '미해결', desc: '아직 해결 표시하지 않은 이슈·진행 중 메모입니다. 기록 공간에서 모아 보고 해결로 표시합니다.' },
  { term: '근거 칩', desc: '문장 밑 「근거:」 옆의 작은 단추입니다. 누르면 그래프에서 그 항목이 빛납니다.' },
];
export const HELP_GEN_TITLE = '문장은 이렇게 만들어집니다';
export const HELP_GEN = [
  // 3회차: 언제·무엇으로 만든 문장인지, 내가 만든 지도에는 어떻게 되는지까지(글 원문은 ai-notes.js)
  { term: '사전 생성', desc: PREGEN_NOTE_FULL },
  { term: '규칙 기반', desc: '기록을 그대로 모아 만든 문장입니다.' },
  { term: 'Claude API', desc: '본인 키를 「설정」에 넣으면 실시간으로 씁니다.' },
];
export const HELP_SECURITY_TITLE = SECURITY_TITLE;
export const HELP_SECURITY = SECURITY_ITEMS;
export const HELP_TOUR_LABEL = '따라 하기 다시 보기';
export const HELP_CLOSE_LABEL = '닫기';

/** 도움말 글에 나오는 「…」 이름 목록(화면에 실제로 있는 이름과 맞는지 단위 테스트가 확인) */
export function helpTexts() {
  return [HELP_INTRO, HELP_SPACES_BADGE, ...HELP_SPACES.map((t) => t.desc), ...HELP_TERMS.map((t) => t.desc), ...HELP_GEN.map((t) => t.desc), ...HELP_SECURITY.map((t) => t.desc), HELP_TOUR_LABEL, HELP_CLOSE_LABEL];
}

/**
 * 도움말 상자 안 내용.
 * @param {{onTour:()=>void, onClose:()=>void}} o
 */
export function helpPanel(o) {
  const list = (items, testid, attrs = {}) => el('dl', { 'data-testid': testid, ...attrs }, ...items.flatMap((t) => [el('dt', {}, t.term), el('dd', {}, t.desc)]));
  return el('div', { 'data-testid': 'help-content' },
    el('h2', { id: 'help-title' }, HELP_TITLE),
    el('p', { 'data-testid': 'help-intro' }, HELP_INTRO),
    el('h3', {}, HELP_SPACES_TITLE),
    list(HELP_SPACES, 'help-spaces'),
    el('p', { class: 'muted small', 'data-testid': 'help-badge' }, HELP_SPACES_BADGE),
    el('h3', {}, HELP_TERMS_TITLE),
    list(HELP_TERMS, 'help-terms'),
    // 문장 생성 방식 3항목은 처음에는 접어 둔다(도움말을 길게 만들지 않으려고)
    el('details', { class: 'help-gen', 'data-testid': 'help-gen-fold' },
      el('summary', {}, HELP_GEN_TITLE),
      list(HELP_GEN, 'help-gen', { style: 'margin-top: 6px;' })),
    // 키와 데이터: 처음에는 접어 둔다(도움말을 길게 만들지 않으려고). 열면 저장 위치·밖으로 나가는 것·받은 문장·회사 기준·사내 LLM
    el('details', { class: 'help-security', 'data-testid': 'help-security' },
      el('summary', {}, HELP_SECURITY_TITLE),
      list(HELP_SECURITY, 'help-security-list', { style: 'grid-template-columns: 1fr; margin-top: 6px;' })), // 설명이 길어 이름 아래에 한 줄씩(옆에 두면 설명 칸이 좁아진다)
    el('div', { class: 'row' },
      el('button', { type: 'button', class: 'primary', 'data-testid': 'help-tour', onclick: o.onTour }, HELP_TOUR_LABEL),
      el('button', { type: 'button', 'data-testid': 'help-close', onclick: o.onClose }, HELP_CLOSE_LABEL)));
}
