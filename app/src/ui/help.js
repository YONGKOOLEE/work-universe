// 머리글 「?」 도움말(FU-9, 처음 사용 점검 2026-10-24): 용어 4개·생성 방식 3개·「따라 하기 다시 보기」.
// 문구 원문은 이 파일 한 곳에 둔다. 따라 하기가 없는 화면에서도 같은 상자가 열린다.

import { el } from './dom.js';

export const HELP_TITLE = '도움말';
export const HELP_INTRO = '이 앱은 업무마다 누가 언제 무엇을 했는지 기록해 두고, 담당자가 바뀔 때 근거 달린 인수인계 초안과 「혼자만 아는 업무」 경고를 만듭니다.';
export const HELP_TERMS_TITLE = '용어';
export const HELP_TERMS = [
  { term: '업무 지도(유니버스)', desc: '업무를 묶은 한 단위입니다. 단추 이름에는 「유니버스」라고 적혀 있습니다.' },
  { term: '노드', desc: '그래프의 동그라미 하나입니다. 사람·업무·산출물·주제·조직이 있습니다.' },
  { term: '꼭지', desc: '가운데 큰 동그라미입니다. 업무 지도 전체를 뜻합니다.' },
  { term: '근거 칩', desc: '문장 밑 「근거:」 옆의 작은 단추입니다. 누르면 그래프에서 그 노드가 빛납니다.' },
];
export const HELP_GEN_TITLE = '문장은 이렇게 만들어집니다';
export const HELP_GEN = [
  { term: '사전 생성', desc: '개발 중 Claude가 근거만 보고 미리 쓴 문장입니다. 앱이 열 때마다 근거를 검사합니다.' },
  { term: '규칙 기반', desc: '기록을 그대로 모아 만든 문장입니다.' },
  { term: 'Claude API', desc: '본인 키를 「설정」에 넣으면 실시간으로 씁니다.' },
];
export const HELP_TOUR_LABEL = '따라 하기 다시 보기';
export const HELP_CLOSE_LABEL = '닫기';

/** 도움말 글에 나오는 「…」 이름 목록(화면에 실제로 있는 이름과 맞는지 단위 테스트가 확인) */
export function helpTexts() {
  return [HELP_INTRO, ...HELP_TERMS.map((t) => t.desc), ...HELP_GEN.map((t) => t.desc), HELP_TOUR_LABEL, HELP_CLOSE_LABEL];
}

/**
 * 도움말 상자 안 내용.
 * @param {{onTour:()=>void, onClose:()=>void}} o
 */
export function helpPanel(o) {
  const list = (items, testid) => el('dl', { 'data-testid': testid }, ...items.flatMap((t) => [el('dt', {}, t.term), el('dd', {}, t.desc)]));
  return el('div', { 'data-testid': 'help-content' },
    el('h2', { id: 'help-title' }, HELP_TITLE),
    el('p', { 'data-testid': 'help-intro' }, HELP_INTRO),
    el('h3', {}, HELP_TERMS_TITLE),
    list(HELP_TERMS, 'help-terms'),
    el('h3', {}, HELP_GEN_TITLE),
    list(HELP_GEN, 'help-gen'),
    el('div', { class: 'row' },
      el('button', { type: 'button', class: 'primary', 'data-testid': 'help-tour', onclick: o.onTour }, HELP_TOUR_LABEL),
      el('button', { type: 'button', 'data-testid': 'help-close', onclick: o.onClose }, HELP_CLOSE_LABEL)));
}
