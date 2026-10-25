// 개요 패널의 목적별 묶음·「무엇을 할까요?」 단추·「최근 기록」 그리기(CR-21 C·B). 내용은 부르는 쪽(main.js)이 만들고, 여기서는 틀과 강조만 맡는다.
import { el } from './dom.js';

// 바꾸기 쉬운 값은 한 곳에(연속 진행 모드 원칙)
export const OVERVIEW = {
  FLASH_MS: 1500, // 단추·기능 찾기로 데려간 자리를 테두리로 강조하는 시간(CR-21 C-1 약 1.5초)
};

/** 목적별 묶음 4개: 개요 단추 이름·묶음 머리글·한 줄 설명(CR-21 C-2). 순서가 화면 순서다 */
export const GOALS = [
  { key: 'record', label: '기록하기', desc: '업무에 메모·진행 상황을 남기고, 끝난 일을 해결로 표시합니다' },
  { key: 'handover', label: '인수인계', desc: '담당자가 바뀔 때 기록으로 초안을 만들고 확정합니다' },
  { key: 'check', label: '점검', desc: '인수인계 위험을 보고, 묶은 지도는 매주 점검을 저장해 비교합니다' },
  { key: 'edit', label: '지도 고치기', desc: '항목을 더하고 고치고, 이전 모습으로 되돌립니다' },
];

/** 요소를 잠깐 테두리로 강조한다(FLASH_MS 뒤 자동으로 지움). 다시 그려져 요소가 없어져도 상관없다 */
export function flash(node, ms = OVERVIEW.FLASH_MS) {
  if (!node) return;
  node.classList.add('goal-flash');
  setTimeout(() => { if (node.classList && node.classList.remove) node.classList.remove('goal-flash'); }, ms);
}

/** 「무엇을 할까요?」 단추 줄. keys는 보일 묶음(비어 있는 묶음은 부르는 쪽이 빼서 넘긴다), onGo(key)는 누를 때 */
export function goalBar(keys, onGo) {
  return el('div', { class: 'goal-bar', role: 'group', 'aria-label': '무엇을 할까요?', 'data-testid': 'goal-bar' },
    ...GOALS.filter((g) => keys.includes(g.key)).map((g) => el('button', { type: 'button', 'data-testid': `goal-${g.key}`, onclick: () => onGo(g.key) }, g.label)));
}

/** 묶음 하나: 머리글(h3)·한 줄 설명·내용. 내용이 하나도 없으면 null(묶음도 단추도 숨긴다, CR-21 C-4) */
export function goalSection(goal, children) {
  const list = children.filter(Boolean);
  if (!list.length) return null;
  return el('section', { class: 'goal-sec', 'data-testid': `goal-sec-${goal.key}` },
    el('h3', { tabindex: '-1' }, goal.label),
    el('p', { class: 'muted small goal-desc' }, goal.desc),
    ...list);
}

/** 개요 「최근 기록」(CR-21 B-2). rows는 view/recent-records.js의 결과, onGo(row)는 「보기」를 누를 때 */
export function recentList(rows, onGo) {
  const box = el('div', { class: 'recent-records', 'data-testid': 'recent-records' }, el('p', { class: 'small' }, el('strong', {}, '최근 기록')));
  if (!rows.length) {
    box.append(el('p', { class: 'muted small', 'data-testid': 'recent-empty' }, '아직 남긴 기록이 없습니다 — 「이번 주 기록」에 첫 기록을 남겨 보세요'));
    return box;
  }
  box.append(el('ul', { class: 'recent-list' }, ...rows.map((r) => el('li', { 'data-testid': 'recent-item', 'data-gid': r.gid },
    el('span', { class: 'muted small' }, r.date),
    el('span', { class: 'chip' }, r.kind),
    el('span', { class: 'recent-target' }, r.target),
    el('span', { class: 'recent-text' }, r.text),
    el('button', { type: 'button', class: 'small-btn', 'data-testid': 'recent-go', title: '이 업무를 고르고 이력의 그 줄로 갑니다', onclick: () => onGo(r) }, '보기')))));
  return box;
}
