// 그래프 위 막대: 찾기 · 거르기 · 상태 표시(T-18, R-17, D-17). 계산은 view/explore.js(순수 함수)가 하고, 이 파일은 입력·표시만 한다.
// 키보드(R-17 ⑧, R-08 보강): 찾기 칸 입력 → ↓로 결과 목록 → Enter로 노드 열기. Enter를 바로 누르면 첫 결과를 연다.

import { el } from './dom.js';

// 바꾸기 쉬운 값은 한 곳에(연속 진행 모드 원칙, decisions-pending 6절 C10-5)
export const EXPLORE = {
  FILTER_MODE: 'dim', // 거르기에서 빠진 노드: 'dim'(흐리게, 추천대로 2026-10-04) | 'hide'(숨기기)
  LABEL_MIN_PX: 6, // 화면에서 이 크기(px)보다 작아지는 이름은 숨긴다(R-17 ⑦)
  LABEL_READ_PX: 15, // 마우스를 올리거나 고른 노드의 이름은 화면에서 이 크기 이상으로(R-17 ⑦)
  ROOT_MIN_PX: 11, // 꼭지(유니버스) 이름은 숨기지 않고 화면에서 이 크기 이상으로(검토: 125% 노트북 첫 화면에 이름이 하나도 없음, decisions-pending C10-6). 0이면 꼭지도 숨김
  NBHD_PROMOTE_ABOVE: 15, // 그래프에 그려진 노드가 이 수를 넘으면 노드 상세 첫 줄에 「주변만 보기」를 꺼낸다(D8-3, 2026-10-17). 샘플: 월말 정산 10·행사 9는 「더 보기」 안, 교육 18·팀 19·조직관리 24·카드승인 38은 첫 줄
  RESULT_LIMIT: 30, // 찾기 결과 목록에 보이는 수(더 있으면 "더 길게 입력" 안내)
};

/**
 * @param {{
 *   container: HTMLElement,
 *   search: (q:string, opts:{wide:boolean}) => {gid:string,label:string,type_label:string,universe_name:string,where?:string}[],
 *   onPick: (gid:string) => void,
 *   types: () => {key:string,label:string,color:string}[],
 *   persons: () => {gid:string,label:string}[],
 *   onFilter: (f:{types:string[], person:string|null}) => void,
 * }} o
 */
export function exploreBar(o) {
  const filter = { types: [], person: null };
  let hits = [];

  // ── 찾기(R-17 ①②⑧) ──
  const input = el('input', { type: 'search', placeholder: '노드 찾기 (이름 일부, 예: 대사)', 'aria-label': '노드 찾기', 'data-testid': 'find-input', autocomplete: 'off', 'aria-controls': 'find-results' });
  // 「설명·속성까지」(T-26, R-22 ①, D-24): 기본 켬. 저장하지 않는다(화면을 열 때마다 켬, L-27과 같은 방식)
  const wide = el('input', { type: 'checkbox', checked: true, 'data-testid': 'find-wide' });
  wide.addEventListener('change', () => { if (input.value.trim()) showResults(); });
  const wideLabel = el('label', { class: 'check small find-wide' }, wide, '설명·속성까지');
  const results = el('ul', { id: 'find-results', class: 'find-results', 'data-testid': 'find-results', hidden: true, 'aria-label': '찾은 노드' });
  const close = () => { results.hidden = true; };
  const pick = (gid) => {
    close();
    input.blur();
    o.onPick(gid);
  };
  const buttons = () => [...results.querySelectorAll('button')];
  function showResults() {
    const q = input.value.trim();
    if (!q) {
      hits = []; // 칸을 비운 뒤 Enter가 이전 결과로 가지 않게
      return close();
    }
    hits = o.search(q, { wide: wide.checked });
    const shown = hits.slice(0, EXPLORE.RESULT_LIMIT);
    results.replaceChildren(...(hits.length
      ? [
        ...shown.map((h) => el('li', {}, el('button', { type: 'button', 'data-testid': 'find-hit', 'data-gid': h.gid, onclick: () => pick(h.gid) },
          el('span', { class: 'name' }, h.label), el('span', { class: 'chip' }, h.type_label), h.where ? el('span', { class: 'where', 'data-testid': 'find-where' }, h.where) : null, el('span', { class: 'uname' }, h.universe_name)))),
        hits.length > shown.length ? el('li', { class: 'more muted small', 'data-testid': 'find-more' }, `외 ${hits.length - shown.length}개 — 더 길게 입력하면 좁혀집니다`) : null,
      ].filter(Boolean)
      : [el('li', { class: 'none', 'data-testid': 'find-none', role: 'status' }, `찾는 노드 없음: 「${q}」`)]));
    results.hidden = false;
  }
  let quietFocus = false; // 결과 목록에서 Esc로 돌아올 때는 목록을 다시 열지 않는다
  input.addEventListener('input', showResults);
  input.addEventListener('focus', () => {
    details.open = false; // 거르기 창이 열린 채 키보드로 오면 결과 목록을 덮는다(같은 높이)
    if (!quietFocus) showResults();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      if (!hits.length || results.hidden) showResults();
      if (hits.length) pick(hits[0].gid);
    } else if (e.key === 'ArrowDown' && !results.hidden && buttons().length) {
      e.preventDefault();
      buttons()[0].focus();
    } else if (e.key === 'Escape') {
      e.stopPropagation(); // 화면 전체의 Esc(선택 해제)와 겹치지 않게: 찾기 칸에서는 목록만 닫는다
      if (!results.hidden) {
        e.preventDefault(); // type=search의 기본 동작(입력 글자 지우기)을 막는다: 목록만 닫고 글자는 남긴다
        close();
      } else input.blur();
    }
  });
  // 결과 목록 안: ↑↓로 이동, Enter·Space는 버튼 기본 동작(누르기), Esc는 찾기 칸으로
  results.addEventListener('keydown', (e) => {
    const list = buttons();
    const i = list.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' && i >= 0) { e.preventDefault(); list[Math.min(i + 1, list.length - 1)].focus(); }
    if (e.key === 'ArrowUp' && i >= 0) { e.preventDefault(); if (i === 0) input.focus(); else list[i - 1].focus(); }
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      quietFocus = true;
      input.focus();
      quietFocus = false;
    }
  });
  // (재검증 R-1: 결과 목록이 열린 상태에서 「설명·속성까지」가 목록에 덮여 눌리지 않아, 찾기에 딸린 옵션이므로 찾기 칸 옆에 둔다. 접는 것은 흐름 정렬·거르기뿐)
  const findBox = el('div', { class: 'find-box' }, input, wideLabel, results);
  document.addEventListener('click', (e) => { if (!findBox.contains(e.target)) close(); });
  findBox.addEventListener('focusout', (e) => { if (!findBox.contains(e.relatedTarget)) close(); });

  // ── 거르기(R-17 ③) ──
  // details는 아래에서 만든다(찾기 칸 focus 처리기가 쓰는 시점에는 이미 있다)
  const typeBox = el('div', { class: 'types' });
  const personSel = el('select', { 'data-testid': 'filter-person', 'aria-label': '사람 하나 고르기' });
  // 사람은 하나만 고르므로 고르면 창을 닫아 그래프를 가리지 않는다(유형은 여러 개를 고를 수 있어 열어 둔다)
  personSel.addEventListener('change', () => {
    filter.person = personSel.value || null;
    details.open = false;
    o.onFilter({ ...filter });
  });
  const dimText = EXPLORE.FILTER_MODE === 'hide' ? '나머지는 숨김' : '나머지는 흐리게';
  const details = el('details', { class: 'filter-box', 'data-testid': 'filter-box' },
    el('summary', { 'data-testid': 'filter-open' }, '거르기'),
    el('div', { class: 'filter-panel' },
      el('div', { class: 'muted small' }, `노드 유형 — 고른 유형만 또렷하게, ${dimText}(업무 지도의 중심 노드인 꼭지는 늘 보임)`), typeBox,
      el('div', { class: 'muted small' }, '사람 하나 — 그 사람과 맡은 업무(지난 담당 포함)만 또렷하게'), personSel,
      el('button', { type: 'button', class: 'small-btn', 'data-testid': 'filter-clear-panel', onclick: () => clear() }, '거르기 모두 풀기')));
  details.addEventListener('toggle', () => { if (details.open) renderFilterInputs(); });
  document.addEventListener('click', (e) => { if (details.open && !details.contains(e.target)) details.open = false; });
  details.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && details.open) {
      e.stopPropagation();
      details.open = false;
      details.querySelector('summary').focus();
    }
  });

  function renderFilterInputs() {
    // o.types(selected): 지금 화면의 유형 + 고른 유형(화면에 없어도 — 주변만 보기·접기 뒤에도 하나씩 풀 수 있게)
    typeBox.replaceChildren(...o.types(filter.types).map((t) => {
      const cb = el('input', { type: 'checkbox', value: t.key, checked: filter.types.includes(t.key), 'data-testid': `filter-type-${t.key}` });
      cb.addEventListener('change', () => {
        filter.types = cb.checked ? [...new Set([...filter.types, t.key])] : filter.types.filter((k) => k !== t.key);
        o.onFilter({ ...filter });
      });
      return el('label', { class: 'check' }, cb, el('span', { class: 'dot', style: `background:${t.color}` }), t.label);
    }));
    const people = o.persons(filter.person);
    // 고른 사람이 화면에서 사라졌어도(유니버스 접기 등) 목록에 남겨 풀 수 있게 한다
    personSel.replaceChildren(el('option', { value: '' }, people.length ? '(사람 고르지 않음)' : '(이 화면에 사람 없음)'),
      ...people.map((p) => el('option', { value: p.gid, selected: p.gid === filter.person }, p.label)));
    personSel.disabled = !people.length && !filter.person;
  }
  function clear() {
    filter.types = [];
    filter.person = null;
    details.open = false;
    o.onFilter({ ...filter });
  }

  const status = el('div', { class: 'explore-status', 'data-testid': 'explore-status', role: 'status' });
  // 거르기도 고급 도구 줄로. 줄 순서: 흐름 정렬(index.html) · 거르기. 「설명·속성까지」는 찾기 칸 옆에 남긴다(재검증 R-1)
  if (o.advanced) {
    o.advanced.append(details);
    o.container.replaceChildren(findBox, status);
  } else o.container.replaceChildren(findBox, details, status);

  return {
    clear,
    /** 상태 줄: parts는 el 요소들(없으면 비움) */
    setStatus(...parts) {
      status.replaceChildren(...parts.filter(Boolean));
    },
  };
}
