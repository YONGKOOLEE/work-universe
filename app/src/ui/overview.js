// 작업 공간 패널의 강조(flash)와 「최근 기록」 그리기(CR-21 B, CR-22 W: 목적별 묶음·개요 단추 4개는 왼쪽 작업 공간 메뉴(ui/workspace.js)가 대신한다).
import { el } from './dom.js';

// 바꾸기 쉬운 값은 한 곳에(연속 진행 모드 원칙)
export const OVERVIEW = {
  FLASH_MS: 1500, // 단추·기능 찾기로 데려간 자리를 테두리로 강조하는 시간(CR-21 C-1 약 1.5초)
};

/** 요소를 잠깐 테두리로 강조한다(FLASH_MS 뒤 자동으로 지움). 다시 그려져 요소가 없어져도 상관없다 */
export function flash(node, ms = OVERVIEW.FLASH_MS) {
  if (!node) return;
  node.classList.add('goal-flash');
  setTimeout(() => { if (node.classList && node.classList.remove) node.classList.remove('goal-flash'); }, ms);
}

/** 개요 「최근 기록」(CR-21 B-2). rows는 view/recent-records.js의 결과, onGo(row)는 「보기」를 누를 때 */
export function recentList(rows, onGo, { onAll = null, canRecord = true } = {}) {
  const box = el('div', { class: 'recent-records', 'data-testid': 'recent-records' }, el('p', { class: 'small' }, el('strong', {}, '최근 기록')));
  if (!rows.length) {
    // 「이번 주 기록」 양식이 없는 화면(읽기 전용·되감기·묶은 지도·업무 없는 지도)에서는 양식을 가리키지 않는다(R11 RV11-4)
    box.append(el('p', { class: 'muted small', 'data-testid': 'recent-empty' }, canRecord ? '아직 남긴 기록이 없습니다 — 「이번 주 기록」에 첫 기록을 남겨 보세요' : '아직 남긴 기록이 없습니다'));
    return box;
  }
  box.append(el('ul', { class: 'recent-list' }, ...rows.map((r) => el('li', { 'data-testid': 'recent-item', 'data-gid': r.gid },
    el('span', { class: 'muted small' }, r.date),
    el('span', { class: 'chip' }, r.kind),
    el('span', { class: 'recent-target' }, r.target),
    el('span', { class: 'recent-text' }, r.text),
    el('button', { type: 'button', class: 'small-btn', 'data-testid': 'recent-go', title: '이 업무를 고르고 이력의 그 줄로 갑니다', onclick: () => onGo(r) }, '보기')))));
  // 쓴 것을 지도 전체에서 찾는 입구(R11 FU6-4): 기록 표(범주·기간·찾기·20줄씩)
  if (onAll) box.append(el('p', { class: 'small' }, el('button', { type: 'button', class: 'link', 'data-testid': 'recent-all', title: '지도 전체의 기록을 표로 보고 찾습니다', onclick: onAll }, '모두 보기 →')));
  return box;
}
