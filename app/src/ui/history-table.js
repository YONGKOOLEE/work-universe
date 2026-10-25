// 기록(이력) 표 화면(CR-22 K P1): 카드의 「모두 보기 →」로 여는 넓은 작업 화면.
// 거르기·찾기·쪽 나누기 계산은 view/card.js(filterHistory·pageRows)가 하고, 여기서는 그린다. 고른 값은 state에 두어 다시 그려도 남는다.
import { el } from './dom.js';
import { CARD, HISTORY_GROUPS, HISTORY_PERIODS, filterHistory, pageRows } from '../view/card.js';

/**
 * @param {{title:string, rows:object[], today:string, state:{group:string,period:string,q:string,page:number}, readOnly:boolean, onClose:()=>void, onResolve:(gid:string)=>void}} o
 * rows: 최신이 위인 이력 줄(view/card.js historyRows). state는 부르는 쪽이 들고 있다가 다시 그릴 때 넘긴다(바뀐 값은 여기서 state에 적는다)
 */
export function historyTablePanel(o) {
  const { state } = o;
  const wrap = el('div', { class: 'history-table', 'data-testid': 'history-table-panel' });
  const head = el('div', { class: 'row ht-head' },
    el('h2', { tabindex: '-1' }, `${o.title} › 기록(이력) ${o.rows.length}건`),
    el('button', { type: 'button', 'data-testid': 'history-table-close', onclick: o.onClose }, '닫기'));
  const filters = el('div', { class: 'ht-filters', 'data-testid': 'ht-filters' });
  const body = el('div', { class: 'ht-body' });
  const foot = el('div', { class: 'row ht-foot' });

  const chip = (key, value, label, testid) => el('button', {
    type: 'button', class: `chip chip-btn${state[key] === value ? ' sel' : ''}`, 'aria-pressed': String(state[key] === value), 'data-testid': testid,
    onclick: () => { state[key] = value; state.page = 1; drawFilters(); drawBody(); },
  }, label);

  function drawFilters() {
    filters.replaceChildren(
      el('span', { class: 'muted small' }, '범주'),
      chip('group', '전체', '전체', 'ht-group-all'), ...HISTORY_GROUPS.map((g) => chip('group', g, g, `ht-group-${g}`)),
      el('span', { class: 'muted small ht-sep' }, '기간'),
      ...HISTORY_PERIODS.map((p) => chip('period', p, p, `ht-period-${p}`)),
    );
  }
  const search = el('input', { type: 'search', class: 'ht-search', placeholder: '내용 찾기', 'aria-label': '이력 내용 찾기', 'data-testid': 'ht-search', value: state.q || '', maxlength: '100' });
  search.addEventListener('input', () => { state.q = search.value; state.page = 1; drawBody(); });

  function drawBody() {
    const f = filterHistory(o.rows, { group: state.group === '전체' ? '' : state.group, period: state.period === '전체' ? '' : state.period, q: state.q }, o.today);
    const page = pageRows(f, state.page);
    body.replaceChildren(page.shown.length
      ? el('table', { class: 'ht-table', 'data-testid': 'history-table' },
        el('thead', {}, el('tr', {}, el('th', {}, '날짜'), el('th', {}, '범주'), el('th', {}, '내용'), el('th', {}, '상태'))),
        el('tbody', {}, ...page.shown.map((r) => el('tr', { 'data-testid': 'ht-row', 'data-gid': r.gid, class: r.after ? 'after' : '' },
          el('td', { class: 'muted small nowrap' }, r.date),
          el('td', {}, el('span', { class: 'chip' }, r.type_label)),
          el('td', {}, r.text),
          el('td', { class: 'nowrap' },
            r.status === '미해결' ? el('span', { class: 'chip warn', 'data-testid': 'ht-open' }, '미해결') : r.status ? el('span', { class: 'muted small' }, r.status) : null,
            r.status === '미해결' && !o.readOnly ? el('button', { type: 'button', class: 'small-btn', 'data-testid': 'ht-resolve', onclick: () => o.onResolve(r.gid) }, '해결로 표시') : null)))))
      : el('p', { class: 'muted', 'data-testid': 'ht-empty' }, '조건에 맞는 기록이 없습니다.'));
    foot.replaceChildren(...[
      el('span', { class: 'muted small', 'data-testid': 'ht-count' }, `${page.total}건 중 ${page.shownCount}건 표시`),
      page.hasMore ? el('button', { type: 'button', 'data-testid': 'ht-more', onclick: () => { state.page += 1; drawBody(); } }, `다음 ${Math.min(CARD.HISTORY_PAGE, page.total - page.shownCount)}`) : null,
    ].filter(Boolean));
  }

  drawFilters();
  drawBody();
  wrap.append(head, el('div', { class: 'ht-bar' }, filters, search), body, foot);
  return wrap;
}
