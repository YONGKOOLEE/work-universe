// 메모 양식 부품(CR-22 F): 「이번 주 기록」(기록 공간)과 카드의 「기록 남기기」(메모)가 같이 쓴다.
// 분류는 칩 4개(진행 중·이슈·주의사항·해결됨)이고 처음엔 아무것도 고르지 않는다. 고르지 않으면 「기록」 단추가 막히고 한 줄이 보인다.
// 값은 숨은 select(data-testid = `${prefix}-category`)에 담는다 — 칩을 누르면 select 값이 바뀌고 change가 나가며, select 값을 바꿔도 칩이 따라온다.
import { MEMO_CATEGORIES } from '../model/schema.js';
import { CATEGORY_REQUIRED_TEXT, MEMO_CHIP_ORDER, categoryGate, resolveWarningText } from '../view/record-form.js';
import { el } from './dom.js';

/**
 * @param {{prefix:string, topics?:{id:string,label:string}[], checkedTopic?:string, closeCount?:()=>number, onChange?:()=>void}} o
 *   closeCount: 지금 고른 업무에서 「해결됨」 기록이 닫을 미해결 건수(업무가 바뀌면 refresh()로 다시 계산)
 */
export function memoParts(o) {
  const select = el('select', { 'data-testid': `${o.prefix}-category`, 'aria-label': '분류', hidden: true },
    el('option', { value: '' }, CATEGORY_REQUIRED_TEXT),
    ...MEMO_CHIP_ORDER.map((k) => el('option', { value: k }, MEMO_CATEGORIES[k])));
  select.value = '';
  const gate = el('span', { class: 'muted small memo-gate', 'data-testid': 'memo-gate', role: 'status' }, CATEGORY_REQUIRED_TEXT);
  const warn = el('p', { class: 'notice small', 'data-testid': 'memo-resolve-warn', role: 'status', hidden: true });
  const chips = MEMO_CHIP_ORDER.map((k) => el('button', {
    type: 'button', class: 'chip chip-btn', role: 'radio', 'aria-checked': 'false', 'data-testid': `memo-chip-${k}`, 'data-cat': k,
    onclick: () => { select.value = select.value === k ? '' : k; refresh(); },
  }, MEMO_CATEGORIES[k]));
  // 분류를 안 고르고 막힌 「기록」을 눌렀을 때(FU6-5): 칩 줄 바로 위에 크게 안내하고 칩 줄을 깜빡인다. 고르면 사라진다
  // 방향키: ← ↑ 이전, → ↓ 다음(끝에서 처음으로), Home·End. 옮기면 그 칩을 고른다(라디오 그룹과 같음, X-41)
  chips.forEach((c, i) => c.addEventListener('keydown', (e) => {
    const to = { ArrowLeft: i - 1, ArrowUp: i - 1, ArrowRight: i + 1, ArrowDown: i + 1, Home: 0, End: chips.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    const next = chips[(to + chips.length) % chips.length];
    select.value = next.dataset.cat;
    refresh();
    next.focus();
  }));
  const hint = el('p', { class: 'memo-pick-hint', 'data-testid': 'memo-pick-hint', role: 'alert', hidden: true }, CATEGORY_REQUIRED_TEXT);
  const chipRow = el('div', { class: 'memo-chips', role: 'radiogroup', 'aria-label': '분류', 'data-testid': 'memo-chips' }, ...chips);

  // 이미 끝난 일(해결됨으로 기록): 분류가 이슈일 때만 보인다. 켜면 이슈 메모와 그것을 닫는 해결됨 메모를 같은 날짜로 한 번에 남긴다
  const pastDone = el('input', { type: 'checkbox', 'data-testid': `${o.prefix}-past-resolved` });
  const pastBox = el('div', { 'data-testid': `${o.prefix}-past-box`, hidden: true },
    el('label', { class: 'check' }, pastDone, ' 이미 끝난 일(해결됨으로 기록)'),
    el('p', { class: 'muted small' }, '켜면 이 이슈와 그것을 닫는 「해결됨」 메모를 같은 날짜로 함께 남겨, 지나간 일이 미해결에 쌓이지 않습니다.'));

  const topics = o.topics && o.topics.length
    ? el('div', { class: 'checks' }, ...o.topics.map((t) => el('label', { class: 'check' }, el('input', { type: 'checkbox', value: t.id, checked: t.id === o.checkedTopic }), ` ${t.label}`)))
    : null;

  const refresh = () => {
    const cat = select.value;
    for (const c of chips) {
      const on = c.dataset.cat === cat;
      c.setAttribute('aria-checked', String(on));
      c.tabIndex = on || (!cat && c === chips[0]) ? 0 : -1; // 라디오 그룹처럼 Tab은 그룹에 한 번(고른 칩, 없으면 첫 칩)
      c.className = `chip chip-btn${on ? ' sel' : ''}`;
    }
    const g = categoryGate(cat);
    if (g.ok) hint.hidden = true;
    gate.hidden = g.ok;
    gate.textContent = g.text;
    pastBox.hidden = cat !== 'issue';
    if (cat !== 'issue') pastDone.checked = false;
    if (cat === 'resolved' && o.closeCount) {
      warn.textContent = resolveWarningText(o.closeCount(), o.closeWord || '업무');
      warn.hidden = false;
    } else warn.hidden = true;
    if (o.onChange) o.onChange(g.ok);
  };
  select.addEventListener('change', refresh);
  refresh();

  return {
    select, chipRow, gate, warn, pastBox, pastDone, topics, refresh,
    hint,
    category: () => select.value,
    /** 보관했던 분류를 되돌린다(허용되지 않는 값이면 비움) */
    setCategory(cat) { select.value = Object.hasOwn(MEMO_CATEGORIES, cat) ? cat : ''; refresh(); },
    /** 막힌 「기록」을 눌렀을 때: 안내를 보이고 칩 줄을 깜빡인다 */
    needCategory() {
      hint.hidden = false;
      if (chipRow.classList.remove) chipRow.classList.remove('memo-flash');
      void chipRow.offsetWidth; // 같은 애니메이션을 다시 시작
      chipRow.classList.add('memo-flash');
      setTimeout(() => { if (chipRow.classList.remove) chipRow.classList.remove('memo-flash'); }, 1800);
    },
    topicIds: () => (topics ? [...topics.querySelectorAll('input:checked')].map((i) => i.value) : []),
    pastChecked: () => pastDone.checked,
    reset() { select.value = ''; pastDone.checked = false; refresh(); },
  };
}

/**
 * 막힌(disabled) 「기록」 단추를 눌러도 반응하게 감싼다(FU6-5). 단추의 disabled 값은 그대로 두고, 막혀 있을 때만 단추 위에 투명 덮개(CSS)가 눌림을 받는다.
 * @param {HTMLButtonElement} btn
 * @param {()=>void} onBlockedClick
 * @returns {HTMLElement} btn을 품은 span
 */
export function gateWrap(btn, onBlockedClick) {
  const catcher = el('span', { class: 'gate-catch', 'data-testid': 'gate-catch', 'aria-hidden': 'true', onclick: onBlockedClick });
  return el('span', { class: 'gate-wrap' }, btn, catcher);
}
