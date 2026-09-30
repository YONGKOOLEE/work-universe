// 자료 편집 양식(R-02, T-06): 노드 추가·수정, 연결 추가·수정, 이력 추가.
// 양식은 값을 모아 onSubmit(values)을 부르고, 돌려받은 결과({ok, error})로 오류 사유를 보여 준다.
// 저장·검증은 app → model이 한다. 여기서는 입력과 표시만 한다.

import { EDGE_TYPES, NODE_TYPES } from '../model/schema.js';
import { el } from './dom.js';
import { messageFor } from './messages.js';

// 오늘 날짜(현지 기준). toISOString은 UTC라 한국 새벽에는 전날이 된다
const today = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function field(label, input, attrs = {}) {
  return el('label', { class: 'field', ...attrs }, el('span', {}, label), input);
}

function select(options, value, attrs = {}) {
  const s = el('select', attrs);
  for (const [v, text] of options) s.append(el('option', { value: v, selected: v === value }, text));
  return s;
}

function nodeOptions(nodes, { empty } = {}) {
  const opts = nodes.map((n) => [n.id, `${n.label} (${n.type_label})`]);
  return empty ? [['', empty], ...opts] : opts;
}

// 오류·성공 메시지 영역. 중복이면 기존 노드로 가는 링크를 붙인다
function messageBox() {
  const box = el('div', { class: 'form-message', 'aria-live': 'polite', 'data-testid': 'form-message' });
  return {
    box,
    show(result, ctx, onFocusLocal) {
      box.replaceChildren();
      box.className = 'form-message';
      if (result.ok) return;
      box.classList.add('error');
      box.dataset.code = result.error.code;
      box.append(messageFor(result.error, ctx));
      if (result.error.existing_id && onFocusLocal && ctx.kind !== 'edge') {
        box.append(' ', el('button', { type: 'button', class: 'link', onclick: () => onFocusLocal(result.error.existing_id) }, '기존 노드 보기'));
      }
    },
  };
}

function actions(submitText, onCancel) {
  return el(
    'div',
    { class: 'row' },
    el('button', { type: 'submit', class: 'primary' }, submitText),
    onCancel ? el('button', { type: 'button', onclick: onCancel }, '취소') : null,
  );
}

// 속성(키-값) 입력 줄. 예: 주기 = 매월
function attrsEditor(attrs = {}) {
  const rows = el('div', { class: 'attrs-rows' });
  const addRow = (k = '', v = '') => {
    const key = el('input', { placeholder: '이름(예: 주기)', value: k, class: 'attr-key' });
    const val = el('input', { placeholder: '값(예: 매월)', value: String(v), class: 'attr-val' });
    const row = el('div', { class: 'attr-row' }, key, val, el('button', { type: 'button', title: '이 속성 지우기', onclick: () => row.remove() }, '×'));
    rows.append(row);
  };
  for (const [k, v] of Object.entries(attrs)) addRow(k, v);
  const wrap = el('div', { class: 'attrs-editor' }, rows, el('button', { type: 'button', class: 'small-btn', onclick: () => addRow() }, '+ 속성 추가'));
  return {
    el: wrap,
    value() {
      const out = {};
      for (const row of rows.children) {
        const k = row.querySelector('.attr-key').value.trim();
        const v = row.querySelector('.attr-val').value.trim();
        if (!k || !v) continue;
        // 원래 숫자였던 값은 숫자로 되돌린다. 글자로 바뀌면 고치지 않은 속성도 "수정"으로 기록되기 때문이다
        out[k] = typeof attrs[k] === 'number' && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v;
      }
      return Object.keys(out).length ? out : null;
    },
  };
}

function periodEditor(period = {}) {
  const start = el('input', { type: 'date', value: period.start || '', class: 'period-start' });
  const end = el('input', { type: 'date', value: period.end || '', class: 'period-end' });
  return {
    el: el('div', { class: 'row period' }, start, el('span', { class: 'muted' }, '~'), end),
    value() {
      const p = {};
      if (start.value) p.start = start.value;
      if (end.value) p.end = end.value;
      return Object.keys(p).length ? p : null;
    },
  };
}

/**
 * 노드 추가·수정 양식.
 * @param {{mode:'add'|'edit', node?:object, subtypes:{core_type,name}[], onSubmit:(values)=>object, onCancel?:()=>void, onFocusLocal?:(id)=>void}} o
 */
export function nodeForm(o) {
  const n = o.node || {};
  const isRoot = n.core_type === 'root';
  const typeOptions = Object.entries(NODE_TYPES).filter(([k]) => k !== 'root');
  const type = select(typeOptions, n.core_type || 'work', { 'data-testid': 'node-type', disabled: o.mode === 'edit' });
  const subtype = el('select', { 'data-testid': 'node-subtype' });
  const syncSubtypes = () => {
    const names = o.subtypes.filter((s) => s.core_type === type.value).map((s) => s.name);
    subtype.replaceChildren(el('option', { value: '' }, '(없음)'), ...names.map((nm) => el('option', { value: nm, selected: nm === n.subtype }, nm)));
    subtypeField.hidden = names.length === 0;
  };
  const subtypeField = field('하위 유형', subtype);
  const label = el('input', { value: n.label || '', maxlength: 100, autocomplete: 'off', 'data-testid': 'node-label', disabled: isRoot });
  const description = el('textarea', { rows: 3, 'data-testid': 'node-description' }, n.description || '');
  const empNo = el('input', { value: n.emp_no || '', placeholder: 'V-0000', autocomplete: 'off', 'data-testid': 'node-empno' });
  const empField = field('사번(선택)', empNo);
  const attrs = attrsEditor(n.attrs || {});
  const period = periodEditor(n.period || {});
  const syncType = () => {
    empField.hidden = type.value !== 'person';
    syncSubtypes();
  };
  type.addEventListener('change', syncType);
  syncType();

  const msg = messageBox();
  const form = el(
    'form',
    { class: 'editor', novalidate: true, 'data-testid': `node-form-${o.mode}` },
    o.mode === 'edit' ? el('h3', {}, '노드 수정') : null,
    o.mode === 'add' ? field('유형', type) : null,
    subtypeField,
    field('라벨', label),
    isRoot ? el('p', { class: 'muted small' }, '꼭지 이름은 유니버스 이름과 같아서 바꿀 수 없습니다.') : null,
    field('설명', description),
    empField,
    field('속성', attrs.el),
    field('기간(선택)', period.el),
    msg.box,
    actions(o.mode === 'add' ? '추가' : '저장', o.onCancel),
  );
  form.addEventListener('submit', (evt) => {
    evt.preventDefault();
    const values = {
      core_type: type.value,
      subtype: subtype.value || null,
      label: label.value,
      description: description.value,
      emp_no: type.value === 'person' ? empNo.value : null,
      attrs: attrs.value(),
      period: period.value(),
    };
    if (isRoot) delete values.label;
    const result = o.onSubmit(values);
    msg.show(result, { kind: 'node' }, o.onFocusLocal);
  });
  return form;
}

/**
 * 연결 추가 양식. 선택한 노드를 한쪽 끝으로 두고 상대 노드·관계·방향을 고른다.
 * @param {{node:object, candidates:object[], onSubmit:(values)=>object, onCancel:()=>void}} o
 */
export function edgeForm(o) {
  const relation = select(Object.entries(EDGE_TYPES), 'relates_to', { 'data-testid': 'edge-type' });
  const direction = select([['out', `${o.node.label} → 상대`], ['in', `상대 → ${o.node.label}`]], 'out', { 'data-testid': 'edge-direction' });
  const other = select(nodeOptions(o.candidates, { empty: '상대 노드를 고르세요' }), '', { 'data-testid': 'edge-other' });
  const period = periodEditor();
  const note = el('input', { autocomplete: 'off', placeholder: '예: 인수 후 담당' });
  const msg = messageBox();
  const form = el(
    'form',
    { class: 'editor', novalidate: true, 'data-testid': 'edge-form' },
    el('h3', {}, '연결 추가'),
    field('관계', relation),
    field('방향', direction),
    field('상대 노드', other),
    field('기간(선택, 담당·소속 기간)', period.el),
    field('메모(선택)', note),
    msg.box,
    actions('연결', o.onCancel),
  );
  form.addEventListener('submit', (evt) => {
    evt.preventDefault();
    const out = direction.value === 'out';
    const values = {
      core_type: relation.value,
      source: out ? o.node.id : other.value,
      target: out ? other.value : o.node.id,
      period: period.value(),
      note: note.value,
    };
    msg.show(o.onSubmit(values), { kind: 'edge', relation: relation.value });
  });
  return form;
}

/** 연결 수정 양식(기간·메모). 양 끝과 관계는 바꿀 수 없다. */
export function edgeEditForm(o) {
  const period = periodEditor(o.edge.period || {});
  const note = el('input', { value: o.edge.note || '', autocomplete: 'off' });
  const msg = messageBox();
  const form = el(
    'form',
    { class: 'editor', novalidate: true, 'data-testid': 'edge-edit-form' },
    el('h3', {}, `연결 수정: ${o.title}`),
    field('기간', period.el),
    field('메모', note),
    msg.box,
    actions('저장', o.onCancel),
  );
  form.addEventListener('submit', (evt) => {
    evt.preventDefault();
    msg.show(o.onSubmit({ period: period.value(), note: note.value }), { kind: 'edge' });
  });
  return form;
}

const EVENT_CHOICES = [
  ['memo', '메모(이슈·결정)'],
  ['handover', '인수인계'],
  ['assign_start', '담당 시작'],
  ['assign_end', '담당 종료'],
  ['affiliation_change', '소속 변경'],
];

/**
 * 이력 추가 양식. 선택한 노드를 알맞은 칸에 미리 채운다.
 * @param {{node:object, nodes:object[], handovers:object[], onSubmit:(values)=>object, onCancel:()=>void}} o
 */
export function eventForm(o) {
  const byType = (t) => o.nodes.filter((n) => n.core_type === t);
  const pre = (t) => (o.node.core_type === t ? o.node.id : '');
  const type = select(EVENT_CHOICES, 'memo', { 'data-testid': 'event-type' });
  const date = el('input', { type: 'date', value: today(), 'data-testid': 'event-date' });
  const note = el('textarea', { rows: 2, 'data-testid': 'event-note', placeholder: '예: 대사 불일치 3건 재발' });
  const person = select(nodeOptions(byType('person'), { empty: '사람을 고르세요' }), pre('person'));
  const work = select(nodeOptions(byType('work'), { empty: '업무를 고르세요' }), pre('work'));
  const from = select(nodeOptions(byType('person'), { empty: '보내는 사람' }), pre('person'));
  const to = select(nodeOptions(byType('person'), { empty: '받는 사람' }), '');
  const artifact = select(nodeOptions(byType('artifact'), { empty: '(없음) 인수인계서 없이' }), pre('artifact'));
  const previous = select([['', '(없음) 참조하지 않음'], ...o.handovers.map((h) => [h.id, `${h.occurred_at} ${h.text}`])], '');
  const fromOrg = select(nodeOptions(byType('org'), { empty: '(미기재)' }), '');
  const toOrg = select(nodeOptions(byType('org'), { empty: '(미기재)' }), '');
  const topics = el('div', { class: 'checks' }, ...byType('topic').map((t) => el('label', { class: 'check' }, el('input', { type: 'checkbox', value: t.id, checked: t.id === o.node.id }), ` ${t.label}`)));

  // 같은 입력 칸(업무·사람)을 여러 종류가 함께 쓰므로, 종류를 바꿀 때마다 칸을 새로 감싼다
  // (DOM 요소는 한 곳에만 붙을 수 있다)
  const groups = {
    memo: () => [field('관련 주제(선택)', topics)],
    handover: () => [field('업무', work), field('보내는 사람', from), field('받는 사람', to), field('인수인계서(선택)', artifact), field('이전 인수인계 참조(선택)', previous)],
    assign_start: () => [field('사람', person), field('업무', work)],
    assign_end: () => [field('사람', person), field('업무', work)],
    affiliation_change: () => [field('사람', person), field('이전 소속(선택)', fromOrg), field('새 소속(선택)', toOrg)],
  };
  const slot = el('div', { class: 'event-fields' });
  const sync = () => slot.replaceChildren(...groups[type.value]());
  type.addEventListener('change', sync);
  sync();

  const msg = messageBox();
  const form = el(
    'form',
    { class: 'editor', novalidate: true, 'data-testid': 'event-form' },
    el('h3', {}, '이력 추가'),
    field('종류', type),
    field('날짜', date),
    slot,
    field('내용', note),
    msg.box,
    actions('기록', o.onCancel),
  );
  form.addEventListener('submit', (evt) => {
    evt.preventDefault();
    const v = (s) => s.value || undefined;
    const payloads = {
      memo: () => ({ target_id: o.node.id, topic_ids: [...topics.querySelectorAll('input:checked')].map((i) => i.value) }),
      handover: () => ({ work_id: v(work), from_person_id: v(from), to_person_id: v(to), artifact_id: v(artifact), previous_handover_id: v(previous) }),
      assign_start: () => ({ person_id: v(person), work_id: v(work) }),
      assign_end: () => ({ person_id: v(person), work_id: v(work) }),
      affiliation_change: () => ({ person_id: v(person), from_org_id: v(fromOrg) || null, to_org_id: v(toOrg) || null }),
    };
    const payload = Object.fromEntries(Object.entries(payloads[type.value]()).filter(([, x]) => x !== undefined));
    msg.show(o.onSubmit({ type: type.value, occurred_at: date.value, payload, note: note.value }), { kind: 'event' });
  });
  return form;
}
