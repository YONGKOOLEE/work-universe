// 자료 편집 양식(R-02, T-06): 노드 추가·수정, 연결 추가·수정, 이력 추가.
// 양식은 값을 모아 onSubmit(values)을 부르고, 돌려받은 결과({ok, error})로 오류 사유를 보여 준다.
// 저장·검증은 app → model이 한다. 여기서는 입력과 표시만 한다.

import { EDGE_TYPES, MEMO_CATEGORIES, NODE_TYPES, allowedRelations, pairAllowed } from '../model/schema.js';
import { el } from './dom.js';
import { josa, messageFor } from './messages.js';
import { todayLocal } from './time.js';

// 하위 유형 선택 칸: 목록에서 고르거나 "새 하위 유형"을 입력한다(1.3 ②).
// getType()은 지금 고른 핵심 유형(노드 유형 또는 관계)을 돌려준다. refresh()로 유형이 바뀔 때 목록을 다시 채운다.
function subtypeEditor(subtypes, getType, selected, testid) {
  const NEW = '__new__';
  const pick = el('select', { 'data-testid': testid });
  const input = el('input', { placeholder: '새 하위 유형 이름(예: 회의록)', maxlength: 100, autocomplete: 'off', 'data-testid': `${testid}-new`, hidden: true });
  const box = el('div', { class: 'subtype-box' }, pick, input);
  const refresh = () => {
    const names = subtypes.filter((s) => s.core_type === getType()).map((s) => s.name);
    pick.replaceChildren(
      el('option', { value: '' }, '(없음)'),
      ...names.map((nm) => el('option', { value: nm, selected: nm === selected }, nm)),
      el('option', { value: NEW }, '＋ 새 하위 유형 추가…'),
    );
    input.hidden = true;
  };
  pick.addEventListener('change', () => {
    input.hidden = pick.value !== NEW;
    if (!input.hidden) input.focus();
  });
  refresh();
  return {
    el: box,
    refresh,
    // {name, isNew}: 새로 입력한 이름이면 isNew. 비어 있으면 null
    value() {
      if (pick.value === NEW) return input.value.trim() ? { name: input.value.trim(), isNew: true } : { name: '', isNew: true };
      return pick.value ? { name: pick.value, isNew: false } : null;
    },
  };
}

// 하위 유형 값을 확정한다. 새 이름이면 먼저 등록하고(onAddSubtype), 실패하면 {ok:false, error}를 돌려준다
function resolveSubtype(sub, coreType, onAddSubtype) {
  const v = sub.value();
  if (!v) return { ok: true, name: null };
  if (!v.isNew) return { ok: true, name: v.name };
  if (!v.name) return { ok: false, error: { code: 'E-REQUIRED', field: 'name' } };
  if (!onAddSubtype) return { ok: false, error: { code: 'E-SUBTYPE', field: 'subtype' } };
  const r = onAddSubtype(coreType, v.name);
  return r.ok ? { ok: true, name: v.name } : { ok: false, error: r.error };
}

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

// 관계 고르기 목록의 보기 글(CR-18 D-8): 「참조」는 무엇에 쓰는지 알 수 있게 설명을 붙인다. 값(references)·저장 형식은 그대로
export const RELATION_HELP = { references: '(협업·공유·참고)' };
export const relationOptionText = (relation) => `${EDGE_TYPES[relation]}${RELATION_HELP[relation] ? ` ${RELATION_HELP[relation]}` : ''}`;
const relationChoices = () => Object.keys(EDGE_TYPES).map((k) => [k, relationOptionText(k)]);

/**
 * 관계 고르기 칸(FU5-9): 「이 조합에는 못 씀」 묶음의 보기는 고를 수 없다. 보기 자체가 disabled라 마우스·키보드로는 고를 수 없지만,
 * 스크립트·자동 입력 등으로 못 쓰는 값이 들어와도(change) 바로 직전의 쓸 수 있던 값으로 되돌리고 뒤따르는 처리(고른 표시·하위 유형 갱신)는 하지 않는다.
 * 이 리스너는 칸을 만들 때 가장 먼저 붙으므로 다른 change 리스너보다 먼저 돈다
 */
function makeRelationSelect(value, attrs) {
  const sel = select(relationChoices(), value, attrs);
  sel.dataset.lastOk = sel.value;
  sel.addEventListener('change', (e) => {
    const picked = Array.from(sel.options || []).find((x) => x.value === sel.value);
    if (picked && picked.disabled) {
      sel.value = sel.dataset.lastOk;
      e.stopImmediatePropagation();
      return;
    }
    sel.dataset.lastOk = sel.value;
  });
  return sel;
}

// 두 노드 유형 사이에 기본으로 권할 관계와 방향. a → b가 되면 out, b → a면 in. 쓸 수 있는 관계가 없으면 null
const RELATION_PREFERENCE = ['performs', 'produces', 'belongs_to', 'relates_to', 'references', 'precedes', 'contains'];
function suggestRelation(aType, bType) {
  const ok = allowedRelations(aType, bType);
  for (const relation of RELATION_PREFERENCE) {
    const x = ok.find((y) => y.relation === relation);
    if (x) return { relation, out: x.forward };
  }
  return null;
}

// 관계 고르기 칸(FU-35, CR-18-4): 고른 두 노드 유형으로 쓸 수 있는 관계를 목록 위에, 어느 방향으로도 쓸 수 없는 관계는
// 아래 <optgroup label="이 조합에는 못 씀"> 안에 disabled로 둔다. 방향은 따로 고르므로(allowedRelations의 forward||backward) 한쪽 방향이라도 되면 쓸 수 있다.
// 연결 대상이 아직 없으면(유형을 모르면) 전부 쓸 수 있는 원래 순서로 되돌린다.
// 고른 값: 쓸 수 있으면 그대로. 못 쓰는 값이면 쓸 수 있는 첫 관계로 바꾼다(FU5-9: 예전에는 직접 고른 값(opts.touched)을 두어 E-PAIR 오류를 보였지만,
// 못 쓰는 보기는 고를 수 없게 하는 쪽으로 바꿨다). opts.keep이면 값을 바꾸지 않는다(연결 수정 양식을 처음 열 때).
// hint(요소)가 있으면 쓸 수 있는 관계가 하나뿐일 때 「(이 조합은 「참조」만 됩니다)」 한 줄, 직접 고른 값이 바뀌었을 때는 바뀐 사실 한 줄을 보인다. 돌려줌: {only: 하나뿐인 관계 | null, changed: 값을 바꿨는가}
export const PAIR_BLOCKED_GROUP = '이 조합에는 못 씀';
export function markRelationOptions(relationSelect, aType, bType, hint = null, opts = {}) {
  const ok = aType && bType ? new Set(allowedRelations(aType, bType).map((x) => x.relation)) : null;
  const keep = relationSelect.value;
  const keys = Object.keys(EDGE_TYPES);
  const usable = ok ? keys.filter((k) => ok.has(k)) : keys;
  const blocked = ok ? keys.filter((k) => !ok.has(k)) : [];
  let value = keep;
  // FU5-9: 못 쓰게 된 값(직접 고른 값 포함)은 쓸 수 있는 첫 관계로 바꾼다. 예전에는 직접 고른 값을 두어 저장할 때 오류를 보였지만, 못 쓰는 값을 고른 채 두지 않는다
  const switchedFromBlocked = !!(ok && !opts.keep && usable.length && !ok.has(keep));
  if (switchedFromBlocked) value = usable[0];
  const mk = (v, disabled) => el('option', { value: v, disabled, selected: v === value }, relationOptionText(v));
  const children = usable.map((v) => mk(v, false));
  if (blocked.length) children.push(el('optgroup', { label: PAIR_BLOCKED_GROUP, 'data-testid': 'relation-blocked' }, ...blocked.map((v) => mk(v, true))));
  relationSelect.replaceChildren(...children);
  relationSelect.value = value;
  const only = ok && usable.length === 1 ? usable[0] : null;
  relationSelect.dataset.lastOk = relationSelect.value;
  if (hint) {
    // 하나뿐이면 그 안내, 아니면 사용자가 직접 고른 값이 바뀌었을 때만 바뀐 사실을 한 줄로(손대지 않은 기본값이 바뀐 것은 알리지 않는다)
    const note = only ? `(이 조합은 「${EDGE_TYPES[only]}」만 됩니다)`
      : switchedFromBlocked && opts.touched ? `(고른 「${EDGE_TYPES[keep]}」은 이 조합에 쓸 수 없어 「${EDGE_TYPES[value]}」${josa(EDGE_TYPES[value], '으로/로')} 바꿨습니다)` : '';
    hint.hidden = !note;
    hint.textContent = note;
  }
  return { only, changed: value !== keep };
}

// 관계 칸 바로 아래의 「이 조합은 ○○만 됩니다」 한 줄(처음엔 숨김)
function onlyHint(testid) {
  return el('p', { class: 'muted small relation-only', hidden: true, 'data-testid': testid, 'aria-live': 'polite' });
}

// E-PAIR 안내에 쓸 문맥: 고른 두 노드와 그 사이에 쓸 수 있는 관계
function pairContext(relation, s, t) {
  return { kind: 'edge', relation, source: s, target: t, suggestions: allowedRelations(s.core_type, t.core_type) };
}

// 관계가 자동으로 바뀐 뒤: 지금 방향으로는 안 되고 반대 방향으로만 되는 관계면 방향을 뒤집는다(out = 이 노드 → 상대)
function alignDirection(directionSelect, relation, nodeType, otherType) {
  const a = allowedRelations(nodeType, otherType).find((x) => x.relation === relation);
  if (!a) return;
  const out = directionSelect.value === 'out';
  if ((out && a.forward) || (!out && a.backward)) return;
  directionSelect.value = a.forward ? 'out' : 'in';
}

// 오류·성공 메시지 영역. 중복이면 기존 노드로 가는 링크를 붙인다
function messageBox() {
  const box = el('div', { class: 'form-message', 'aria-live': 'polite', 'data-testid': 'form-message' });
  const clear = () => {
    box.replaceChildren();
    box.className = 'form-message';
    delete box.dataset.code;
  };
  let wired = false;
  return {
    box,
    clear,
    show(result, ctx, onFocusLocal) {
      clear();
      if (result.ok) return;
      box.classList.add('error');
      box.dataset.code = result.error.code;
      box.append(messageFor(result.error, ctx));
      if (result.error.existing_id && onFocusLocal && ctx.kind !== 'edge') {
        box.append(' ', el('button', { type: 'button', class: 'link', onclick: () => onFocusLocal(result.error.existing_id) }, '기존 항목 보기'));
      }
      // FU5-12: 양식 값(관계·이을 항목·유형 등)이 바뀌면 앞 시도의 오류 줄을 지운다. 지난 오류가 남아 지금 고른 값에 대한 말처럼 읽히지 않게. 양식당 한 번만 건다
      const form = !wired && typeof box.closest === 'function' ? box.closest('form') : null;
      if (form) {
        wired = true;
        form.addEventListener('change', clear);
      }
      // 오류가 화면 밖에 있으면 못 보므로(FU-35) 단추 바로 위의 이 자리로 스크롤한다
      if (typeof box.scrollIntoView === 'function') box.scrollIntoView({ block: 'nearest' });
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
    const ATTR_HINTS = { 절차: '값(예: ① 자료 수집 ② 대조 ③ 보고)', 주의사항: '값(예: 월말에는 조회가 느림)', 마감: '값(예: 매월 5일까지)', '관련 문서': '값(예: 공용 문서함 > 정산)', '사용 시스템': '값(예: 가상정산시스템)' };
    const val = el('input', { placeholder: ATTR_HINTS[k] || '값(예: 매월)', value: String(v), class: 'attr-val' });
    const row = el('div', { class: 'attr-row' }, key, val, el('button', { type: 'button', title: '이 속성 지우기', onclick: () => row.remove() }, '×'));
    rows.append(row);
  };
  for (const [k, v] of Object.entries(attrs)) addRow(k, v);
  const wrap = el('div', { class: 'attrs-editor' }, rows, el('button', { type: 'button', class: 'small-btn', onclick: () => addRow() }, '+ 속성 추가'));
  return {
    el: wrap,
    // 표준 양식의 빈 항목 이름을 누르면(FU-16) 그 속성 칸을 보장한다: 같은 이름 줄이 있으면 그 값 칸, 없으면 새 줄을 더해 값 칸을 돌려준다
    ensure(name) {
      const row = [...rows.children].find((r) => r.querySelector('.attr-key').value.trim() === name);
      if (row) return row.querySelector('.attr-val');
      addRow(name, '');
      return rows.lastElementChild.querySelector('.attr-val');
    },
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
  const start = el('input', { type: 'date', value: period.start || '', class: 'period-start', min: '1900-01-01', max: '2200-12-31' });
  const end = el('input', { type: 'date', value: period.end || '', class: 'period-end', min: '1900-01-01', max: '2200-12-31' });
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
  const sub = subtypeEditor(o.subtypes, () => type.value, n.subtype, 'node-subtype');
  const subtypeField = field('하위 유형(선택)', sub.el);
  const label = el('input', { value: n.label || '', maxlength: 100, autocomplete: 'off', 'data-testid': 'node-label', disabled: isRoot });
  const description = el('textarea', { rows: 3, maxlength: 2000, 'data-testid': 'node-description' }, n.description || '');
  const empNo = el('input', { value: n.emp_no || '', placeholder: 'V-0000', maxlength: 100, autocomplete: 'off', 'data-testid': 'node-empno' });
  const empField = field('사번(선택)', empNo);
  const attrs = attrsEditor(n.attrs || {});
  const period = periodEditor(n.period || {});
  const syncType = () => {
    empField.hidden = type.value !== 'person';
    subtypeField.hidden = isRoot;
    sub.refresh();
  };
  type.addEventListener('change', syncType);
  syncType();

  // 추가할 때만: 꼭지에 바로 연결(포함). 업무는 기본으로 켠다 — 연결 없이 떠 있는 노드를 줄이기 위해
  const attach = el('input', { type: 'checkbox', 'data-testid': 'node-attach', checked: type.value === 'work' });
  const attachField = el('label', { class: 'check' }, attach, ' 지도 중심(연두색 큰 동그라미)에 바로 연결하기');
  if (o.mode === 'add') type.addEventListener('change', () => { attach.checked = type.value === 'work'; });

  // 추가할 때만(선택): 상대 노드를 골라 노드와 연결을 한 번에 저장한다. 비워 두면 연결 없이 노드만 추가한다
  const link = o.mode === 'add' && o.getCandidates ? linkFields() : null;
  function linkFields() {
    const other = select([['', '(연결하지 않음)']], '', { 'data-testid': 'node-link-other' });
    const relation = makeRelationSelect('relates_to', { 'data-testid': 'node-link-type' });
    const direction = select([['out', '새 항목 → 상대'], ['in', '상대 → 새 항목']], 'out', { 'data-testid': 'node-link-direction' });
    const onlyNote = onlyHint('node-link-only');
    const detail = el('div', { class: 'link-detail', hidden: true }, field('관계', relation), onlyNote, field('방향', direction));
    const candidates = () => o.getCandidates();
    const fill = () => {
      const keep = other.value;
      const list = candidates();
      other.replaceChildren(...nodeOptions(list, { empty: '(연결하지 않음)' }).map(([v, t]) => el('option', { value: v, selected: v === keep }, t)));
      if (!list.some((n) => n.id === keep)) other.value = '';
    };
    const sync = () => {
      detail.hidden = !other.value;
      const picked = other.value ? candidates().find((n) => n.id === other.value) : null;
      markRelationOptions(relation, picked ? type.value : null, picked ? picked.core_type : null, onlyNote); // 쓸 수 있는 관계를 위로·못 쓰는 관계는 아래 묶음(FU-35, CR-18-4)
      if (!other.value) return; // 상대나 새 항목 유형이 바뀔 때마다 알맞은 관계·방향을 다시 추천한다(직접 고르는 것은 그 뒤에)
      const t = candidates().find((n) => n.id === other.value);
      const sug = t && suggestRelation(type.value, t.core_type);
      if (sug) {
        relation.value = sug.relation;
        direction.value = sug.out ? 'out' : 'in';
      }
    };
    other.addEventListener('focus', fill);
    other.addEventListener('change', sync);
    type.addEventListener('change', sync);
    fill();
    const box = el('div', { class: 'link-group', 'data-testid': 'node-link' }, field('함께 이을 항목(선택)', other), detail,
      el('p', { class: 'muted small' }, '항목을 고르면 추가와 연결이 한 번에 저장됩니다. 연결할 수 없는 조합이면 저장하기 전에 알려 드립니다.'));
    return { el: box, other, relation, direction, candidates, fill };
  }

  const msg = messageBox();
  const form = el(
    'form',
    { class: 'editor', novalidate: true, 'data-testid': `node-form-${o.mode}` },
    o.mode === 'edit' ? el('h3', {}, '항목 수정') : null,
    o.mode === 'add' ? field('유형', type) : null,
    subtypeField,
    field('이름', label),
    isRoot ? el('p', { class: 'muted small' }, '지도 중심 이름은 업무 지도 이름과 같아서 바꿀 수 없습니다.') : null,
    field('설명', description),
    empField,
    field('속성', attrs.el),
    field('기간(선택)', period.el),
    o.mode === 'add' ? attachField : null,
    link ? link.el : null,
    msg.box,
    actions(o.mode === 'add' ? '추가' : '저장', o.onCancel),
  );
  // 화면이 다시 그려질 때(노드 이름 수정·추가·숨김 뒤) 「함께 이을 노드」 목록을 새 이름으로 다시 만든다(점검 3회차: 고친 직후 옛 이름이 한동안 보임).
  // 이 목록은 칸에 초점이 갈 때만 다시 만들어져 왔다. 입력 중인 다른 칸은 건드리지 않고, 고른 상대는 그대로 둔다
  form.refreshCandidates = () => { if (link) link.fill(); };
  // o.focusField(수정 양식만, FU-16): 표준 양식의 빈 항목 이름. 「설명」이면 설명 칸에, 그 밖이면 그 속성 칸(없으면 줄을 더해서)에 초점. 양식을 화면에 붙인 뒤 부른다
  form.focusStart = () => {
    if (!o.focusField) return;
    const target = o.focusField === '설명' ? description : attrs.ensure(o.focusField);
    target.focus();
  };
  form.addEventListener('submit', (evt) => {
    evt.preventDefault();
    const resolved = resolveSubtype(sub, type.value, o.onAddSubtype);
    if (!resolved.ok) return msg.show(resolved, { kind: 'node' });
    const values = {
      core_type: type.value,
      subtype: resolved.name,
      label: label.value,
      description: description.value,
      emp_no: type.value === 'person' ? empNo.value : null,
      attrs: attrs.value(),
      period: period.value(),
    };
    if (isRoot) delete values.label;
    if (o.mode === 'add') values.attach_root = attach.checked;
    let ctx = { kind: 'node' };
    if (link && link.other.value) {
      const out = link.direction.value === 'out';
      values.link = { other_id: link.other.value, core_type: link.relation.value, out };
      // 허용되지 않는 조합은 저장하기 전에 사유를 보인다(새 노드 이름이 비어 있으면 이름 오류가 먼저 나가도록 건너뜀)
      const t = link.candidates().find((n) => n.id === link.other.value);
      if (t && values.label !== undefined && String(values.label).trim()) {
        const fresh = { id: '@new', label: String(values.label).trim(), core_type: type.value };
        const s = out ? fresh : t;
        const d = out ? t : fresh;
        if (!pairAllowed(values.link.core_type, s.core_type, d.core_type)) {
          return msg.show({ ok: false, error: { code: 'E-PAIR' } }, pairContext(values.link.core_type, s, d));
        }
      }
    }
    const result = o.onSubmit(values);
    // 연결 쪽에서 난 오류면 연결 문구로 보인다
    if (!result.ok && result.edge_error && link) {
      const t = link.candidates().find((n) => n.id === link.other.value);
      const out = link.direction.value === 'out';
      const fresh = { id: '@new', label: String(values.label || '').trim(), core_type: type.value };
      ctx = t ? pairContext(link.relation.value, out ? fresh : t, out ? t : fresh) : { kind: 'edge', relation: link.relation.value };
    }
    msg.show(result, ctx, o.onFocusLocal);
  });
  return form;
}

/**
 * 연결 추가 양식. 선택한 노드를 한쪽 끝으로 두고 상대 노드·관계·방향을 고른다.
 * @param {{node:object, candidates:object[], onSubmit:(values)=>object, onCancel:()=>void}} o
 */
export function edgeForm(o) {
  const relation = makeRelationSelect('relates_to', { 'data-testid': 'edge-type' });
  const direction = select([['out', `${o.node.label} → 상대`], ['in', `상대 → ${o.node.label}`]], 'out', { 'data-testid': 'edge-direction' });
  const other = select(nodeOptions(o.candidates, { empty: '상대 항목을 고르세요' }), '', { 'data-testid': 'edge-other' });
  const onlyNote = onlyHint('edge-only');
  let touched = false; // 사용자가 관계 칸을 직접 고른 뒤인가(손대지 않은 기본값만 자동으로 바꾼다)
  relation.addEventListener('change', () => { touched = true; });
  // 상대를 고르면 이 노드와 상대의 유형으로 쓸 수 있는 관계를 위로, 못 쓰는 관계는 아래 묶음으로 보낸다(FU-35, CR-18-4). 상대를 아직 안 골랐으면 전부 켜 둔다.
  // 관계를 자동으로 바꿨으면(못 쓰던 값이었거나 하나뿐) 방향도 그 관계가 되는 쪽으로 맞춘다
  other.addEventListener('change', () => {
    const t = o.candidates.find((n) => n.id === other.value);
    const r = markRelationOptions(relation, t ? o.node.core_type : null, t ? t.core_type : null, onlyNote, { touched });
    if (t && r.changed) alignDirection(direction, relation.value, o.node.core_type, t.core_type);
  });
  const period = periodEditor();
  const note = el('input', { autocomplete: 'off', maxlength: 2000, placeholder: '예: 인수 후 담당' });
  const sub = subtypeEditor(o.subtypes || [], () => relation.value, null, 'edge-subtype');
  relation.addEventListener('change', () => sub.refresh());
  const msg = messageBox();
  const form = el(
    'form',
    { class: 'editor', novalidate: true, 'data-testid': 'edge-form' },
    el('h3', {}, '연결 추가'),
    field('관계', relation),
    onlyNote,
    field('하위 유형(선택, 예: 참조 > 검토함)', sub.el),
    field('방향', direction),
    field('상대 항목', other),
    field('기간(선택, 담당·소속 기간)', period.el),
    field('메모(선택)', note),
    msg.box,
    actions('연결', o.onCancel),
  );
  form.addEventListener('submit', (evt) => {
    evt.preventDefault();
    const out = direction.value === 'out';
    const resolved = resolveSubtype(sub, relation.value, o.onAddSubtype);
    if (!resolved.ok) return msg.show(resolved, { kind: 'edge', relation: relation.value });
    const values = {
      core_type: relation.value,
      subtype: resolved.name,
      source: out ? o.node.id : other.value,
      target: out ? other.value : o.node.id,
      period: period.value(),
      note: note.value,
    };
    const result = o.onSubmit(values);
    const ctx = { kind: 'edge', relation: relation.value };
    if (!result.ok && result.error.code === 'E-PAIR') {
      const byId = (id) => (id === o.node.id ? o.node : o.candidates.find((n) => n.id === id));
      const s = byId(values.source);
      const t = byId(values.target);
      if (s && t) Object.assign(ctx, { source: s, target: t, suggestions: allowedRelations(s.core_type, t.core_type) });
    }
    msg.show(result, ctx);
  });
  return form;
}

/**
 * 연결 수정 양식. 기간·메모는 그 자리에서 고치고, 관계나 상대(방향)를 바꾸면 옛 연결을 숨기고 새 연결을 만든다(한 번의 저장).
 * onSubmit({period, note}) 또는 관계·상대가 바뀌면 onSubmit({replace:true, input:{source, target, core_type, subtype?, period?, note?}})
 * @param {{edge:object, node:object, candidates:object[], title:string, onSubmit:(values)=>object, onCancel:()=>void}} o node는 지금 고른(연결의 한쪽 끝) 노드
 */
export function edgeEditForm(o) {
  const focalIsTarget = o.edge.target === o.node.id && o.edge.source !== o.node.id;
  const otherId = focalIsTarget ? o.edge.source : o.edge.target;
  const period = periodEditor(o.edge.period || {});
  const note = el('input', { value: o.edge.note || '', maxlength: 2000, autocomplete: 'off', 'data-testid': 'edge-edit-note' });
  const relation = makeRelationSelect(o.edge.core_type, { 'data-testid': 'edge-edit-type' });
  const direction = select([['out', `${o.node.label} → 상대`], ['in', `상대 → ${o.node.label}`]], focalIsTarget ? 'in' : 'out', { 'data-testid': 'edge-edit-direction' });
  const list = o.candidates.filter((n) => n.id !== o.node.id);
  const opts = nodeOptions(list);
  // 지금 상대가 목록에 없으면(숨긴 노드 등) 그대로 둘 수 있게 항목을 하나 보태 둔다
  if (!list.some((n) => n.id === otherId)) opts.unshift([otherId, '(현재 상대)']);
  const other = select(opts, otherId, { 'data-testid': 'edge-edit-other' });
  const onlyNote = onlyHint('edge-edit-only');
  let touched = false;
  relation.addEventListener('change', () => { touched = true; });
  // 연결 수정에도 같은 처리(CR-18-4). 처음 열 때는 지금 값을 그대로 둔다. 상대를 바꿀 때 지금 관계가 새 조합에 못 쓰이면 쓸 수 있는 첫 관계로 바꾼다
  const remark = (keep) => {
    const t = list.find((n) => n.id === other.value);
    const r = markRelationOptions(relation, t ? o.node.core_type : null, t ? t.core_type : null, onlyNote, { keep, touched });
    if (!keep && t && r.changed) alignDirection(direction, relation.value, o.node.core_type, t.core_type);
  };
  other.addEventListener('change', () => remark(false));
  remark(true);
  const msg = messageBox();
  const form = el(
    'form',
    { class: 'editor', novalidate: true, 'data-testid': 'edge-edit-form' },
    el('h3', {}, `연결 수정: ${o.title}`),
    el('p', { class: 'muted small', 'data-testid': 'edge-edit-hint' }, '관계나 상대를 바꾸면 옛 연결은 숨기고(기록은 남음) 새 연결을 만듭니다.'),
    field('관계', relation),
    onlyNote,
    field('방향', direction),
    field('상대 항목', other),
    field('기간', period.el),
    field('메모', note),
    msg.box,
    actions('저장', o.onCancel),
  );
  form.addEventListener('submit', (evt) => {
    evt.preventDefault();
    const out = direction.value === 'out';
    const changed = relation.value !== o.edge.core_type || other.value !== otherId || out !== !focalIsTarget;
    if (!changed) return msg.show(o.onSubmit({ period: period.value(), note: note.value }), { kind: 'edge' });
    const input = {
      core_type: relation.value,
      source: out ? o.node.id : other.value,
      target: out ? other.value : o.node.id,
      period: period.value(),
      note: note.value,
    };
    // 관계가 그대로면 하위 유형도 이어 간다(관계가 바뀌면 하위 유형은 관계에 딸린 것이므로 비운다)
    if (relation.value === o.edge.core_type && o.edge.subtype) input.subtype = o.edge.subtype;
    const result = o.onSubmit({ replace: true, input });
    const ctx = { kind: 'edge', relation: relation.value };
    if (!result.ok && result.error.code === 'E-PAIR') {
      const byId = (id) => (id === o.node.id ? o.node : list.find((n) => n.id === id));
      const s = byId(input.source);
      const t = byId(input.target);
      if (s && t) Object.assign(ctx, pairContext(relation.value, s, t));
    }
    msg.show(result, ctx);
  });
  return form;
}

// 분류가 인수인계 초안의 어느 칸으로 가는지(FU-37). rules/handover.js의 같은 매핑: 이슈 → 최근 이슈, 진행 중 → 진행 중인 일, 주의사항 → 주의사항·노하우
const CATEGORY_HINT = '분류에 따라 인수인계 초안의 칸이 정해집니다: 이슈 → 「최근 이슈」, 진행 중 → 「진행 중인 일」, 주의사항 → 「주의사항·노하우」';

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
  const date = el('input', { type: 'date', value: todayLocal(), 'data-testid': 'event-date', min: '1900-01-01', max: '2200-12-31' });
  const endDate = el('input', { type: 'date', value: '', 'data-testid': 'event-end-date', min: '1900-01-01', max: todayLocal() });
  const note = el('textarea', { rows: 2, 'data-testid': 'event-note', placeholder: '예: 대사 불일치 3건 재발' });
  const person = select(nodeOptions(byType('person'), { empty: '사람을 고르세요' }), pre('person'));
  const work = select(nodeOptions(byType('work'), { empty: '업무를 고르세요' }), pre('work'));
  const from = select(nodeOptions(byType('person'), { empty: '보내는 사람' }), pre('person'));
  const to = select(nodeOptions(byType('person'), { empty: '받는 사람' }), '');
  const artifact = select(nodeOptions(byType('artifact'), { empty: '(없음) 인수인계서 없이' }), pre('artifact'));
  const previous = select([['', '(없음) 참조하지 않음'], ...o.handovers.map((h) => [h.id, `${h.occurred_at} ${h.text}`])], '');
  const fromOrg = select(nodeOptions(byType('org'), { empty: '(미기재)' }), '');
  const toOrg = select(nodeOptions(byType('org'), { empty: '(미기재)' }), '');
  const category = select(Object.entries(MEMO_CATEGORIES), 'issue', { 'data-testid': 'event-category' });
  const topics = el('div', { class: 'checks' }, ...byType('topic').map((t) => el('label', { class: 'check' }, el('input', { type: 'checkbox', value: t.id, checked: t.id === o.node.id }), ` ${t.label}`)));
  // 「이미 끝난 일(해결됨으로 기록)」(CR-18 D-12): 분류가 이슈일 때만 보인다. 켜면 이슈 메모와 그것을 닫는 해결됨 메모를 같은 날짜로 한 번에 남긴다(저장은 부르는 쪽: input.also_resolved)
  const pastDone = el('input', { type: 'checkbox', 'data-testid': 'event-past-resolved' });
  const pastBox = el('div', { 'data-testid': 'event-past-box', hidden: true },
    el('label', { class: 'check' }, pastDone, ' 이미 끝난 일(해결됨으로 기록)'),
    el('p', { class: 'muted small' }, '켜면 이 이슈와 그것을 닫는 「해결됨」 메모를 같은 날짜로 함께 남겨, 지나간 일이 미해결에 쌓이지 않습니다.'));
  const syncPast = () => { pastBox.hidden = type.value !== 'memo' || category.value !== 'issue'; };
  category.addEventListener('change', syncPast);

  // 같은 입력 칸(업무·사람)을 여러 종류가 함께 쓰므로, 종류를 바꿀 때마다 칸을 새로 감싼다
  // (DOM 요소는 한 곳에만 붙을 수 있다)
  const groups = {
    memo: () => [field('분류', category), el('p', { class: 'muted small', 'data-testid': 'category-hint' }, CATEGORY_HINT), field('관련 주제(선택)', topics), pastBox],
    handover: () => [field('업무', work), field('보내는 사람', from), field('받는 사람', to), field('인수인계서(선택)', artifact), field('이전 인수인계 참조(선택)', previous)],
    assign_start: () => [
      field('사람', person),
      field('업무', work),
      field('끝 날짜(선택)', endDate),
      el('p', { class: 'muted small', 'data-testid': 'assign-hint' }, '기록하면 사람 → 업무 「수행」 연결도 이 날짜부터 함께 만들어집니다. 끝 날짜를 넣으면 그 날짜까지의 지난 기간으로 담당 시작·종료를 함께 기록합니다.'),
    ],
    assign_end: () => [field('사람', person), field('업무', work), el('p', { class: 'muted small', 'data-testid': 'assign-hint' }, '기록하면 진행 중인 「수행」 연결의 끝 날짜가 이 날짜로 채워집니다.')],
    affiliation_change: () => [field('사람', person), field('이전 소속(선택)', fromOrg), field('새 소속(선택)', toOrg)],
  };
  const slot = el('div', { class: 'event-fields' });
  const sync = () => { slot.replaceChildren(...groups[type.value]()); syncPast(); };
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
      memo: () => ({ target_id: o.node.id, category: category.value, topic_ids: [...topics.querySelectorAll('input:checked')].map((i) => i.value) }),
      handover: () => ({ work_id: v(work), from_person_id: v(from), to_person_id: v(to), artifact_id: v(artifact), previous_handover_id: v(previous) }),
      assign_start: () => ({ person_id: v(person), work_id: v(work) }),
      assign_end: () => ({ person_id: v(person), work_id: v(work) }),
      affiliation_change: () => ({ person_id: v(person), from_org_id: v(fromOrg) || null, to_org_id: v(toOrg) || null }),
    };
    // 메모는 내용이 있어야 한다: 이력은 지울 수 없어 빈 메모가 영구히 남고 근거·흐름 표의 건수에 들어간다(여섯 번째 검토 U-2)
    if (type.value === 'memo' && !note.value.trim()) return msg.show({ ok: false, error: { code: 'E-REQUIRED', field: 'note' } }, { kind: 'event' });
    const payload = Object.fromEntries(Object.entries(payloads[type.value]()).filter(([, x]) => x !== undefined));
    const input = { type: type.value, occurred_at: date.value, payload, note: note.value };
    if (type.value === 'assign_start' && endDate.value) input.end_date = endDate.value;
    if (type.value === 'memo' && category.value === 'issue' && pastDone.checked) input.also_resolved = true;
    msg.show(o.onSubmit(input), { kind: 'event' });
  });
  return form;
}
