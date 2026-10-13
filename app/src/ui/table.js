// 표로 한꺼번에 넣기·고치기 화면(T-19, R-18, D-18·D-19). 대화상자 하나에 두 방식:
//  - 표로 추가: 스프레드시트에서 복사한 글을 붙여 넣거나 칸에 직접 쓴 새 행들
//  - 표로 고치기: 지금 유니버스의 노드를 표로 펼쳐 바꾼 행만 저장(유형은 바꿀 수 없음)
// 저장은 app.applyBatch 한 번. 오류가 한 행이라도 있으면 아무것도 저장하지 않고 오류 행을 표시한다(전부 아니면 전무).
import { el } from './dom.js';
import { messageFor } from './messages.js';
import { NODE_TYPES } from '../model/schema.js';
import { TABLE_COLUMNS, TABLE_RULES, editRowsToOps, editableRows, newRowsToOps, parseTable } from '../model/table.js';

const TYPE_CHOICES = Object.entries(NODE_TYPES).filter(([k]) => k !== 'root').map(([, name]) => name);
const emptyCells = () => ({ type: '', label: '', subtype: '', description: '', emp_no: '', attrs: '' });
const isBlank = (cells) => Object.values(cells).every((v) => String(v ?? '').trim() === '');

/**
 * @param {{dialog:HTMLDialogElement, app:object, onSaved:(result:object)=>void}} o
 * @returns {(mode:'add'|'edit')=>void} 대화상자를 여는 함수
 */
export function tableDialog(o) {
  const st = { mode: 'add', rows: [], errors: new Map(), note: '', message: '', attach: true, pasteText: '' };

  const blankRows = (n) => Array.from({ length: n }, () => ({ cells: emptyCells() }));

  function paste() {
    const t = parseTable(st.pasteText);
    if (t.tooLong) {
      st.note = `붙여 넣은 글이 너무 깁니다(최대 ${TABLE_RULES.maxInput}자).`;
      return;
    }
    if (t.unclosed) {
      st.note = '큰따옴표(")가 닫히지 않아 읽지 않았습니다. 셀 안에 따옴표가 있으면 짝이 맞는지 확인하세요.';
      return;
    }
    if (!t.rows.length) {
      st.note = '붙여 넣은 글에서 행을 찾지 못했습니다. 스프레드시트에서 셀을 복사해 붙여 넣으세요.';
      return;
    }
    const kept = st.rows.filter((r) => !isBlank(r.cells));
    const rows = t.rows.map((r) => ({ cells: { ...emptyCells(), ...r.cells }, parseError: r.error }));
    st.rows = [...kept, ...rows];
    st.errors = new Map();
    st.message = '';
    st.note = `${rows.length}행을 읽었습니다. ${t.header ? '첫 줄은 머리글로 읽었습니다.' : '머리글이 없어 열 순서(유형·이름·하위 유형·설명·사번·속성)로 읽었습니다.'} 확인한 뒤 「저장」을 누르세요.`;
    if (t.ignored) st.note += ` 알 수 없는 열(${t.ignored.join(', ')})은 읽지 않았습니다.`;
    if (t.tooMany) st.note += ` 한 번에 ${t.tooMany}행까지 저장할 수 있습니다.`;
  }

  function collect() {
    const body = o.dialog.querySelector('tbody');
    return [...body.querySelectorAll('tr:not(.row-msg-line)')].map((tr, i) => {
      const src = st.rows[i];
      const cells = {};
      for (const c of TABLE_COLUMNS) {
        const input = tr.querySelector(`[data-col="${c.key}"]`);
        if (input) cells[c.key] = input.value;
      }
      const next = { ...src.cells, ...cells };
      const edited = Object.keys(next).some((k) => String(next[k] ?? '') !== String(src.cells[k] ?? ''));
      const { parseError, ...rest } = src; // 사용자가 칸을 고치면 붙여 넣을 때의 오류 표시는 풀린다
      return { ...(edited ? rest : src), cells: next };
    });
  }

  function save() {
    st.rows = collect();
    st.errors = new Map();
    st.message = '';
    const numbered = st.rows.map((r, i) => ({ ...r, line: i + 1 }));
    let ops;
    if (st.mode === 'add') {
      const filled = numbered.filter((r) => !isBlank(r.cells)).map((r) => (r.parseError ? { ...r, error: r.parseError } : r));
      ops = newRowsToOps(filled, { attachRoot: st.attach ? 'work' : false });
    } else {
      ops = editRowsToOps(numbered.map((r) => ({ ...r, error: r.parseError })), o.app.doc);
      if (ops.length === 0) {
        st.message = '바뀐 행이 없습니다.';
        return render();
      }
    }
    const r = o.app.applyBatch(ops);
    if (!r.ok) {
      if (r.errors && r.errors.length) {
        for (const e of r.errors) st.errors.set(e.row, messageFor(e.error, { kind: 'node' }));
        st.message = `${r.errors.length}행에 문제가 있어 아무것도 저장하지 않았습니다. 표시된 행을 고친 뒤 다시 저장하세요.`;
      } else st.message = messageFor(r.error, { kind: 'node' });
      return render();
    }
    o.dialog.close();
    o.onSaved(r);
  }

  function row(r, i) {
    const err = st.errors.get(i + 1);
    const existing = st.mode === 'edit';
    const input = (key, attrs = {}) => el('input', {
      'data-col': key, 'data-testid': `table-${key}-${i}`, value: r.cells[key] ?? '', autocomplete: 'off', 'aria-label': `${i + 1}행 ${TABLE_COLUMNS.find((c) => c.key === key).label}`, ...attrs,
    });
    const typeCell = existing
      ? el('input', { 'data-col': 'type', value: r.cells.type, readonly: true, 'aria-label': `${i + 1}행 유형`, class: 'ro' })
      : el('input', { 'data-col': 'type', 'data-testid': `table-type-${i}`, list: 'table-types', value: r.cells.type, autocomplete: 'off', 'aria-label': `${i + 1}행 유형` });
    const main = el('tr', { class: err ? 'row-error' : '', 'data-testid': `table-row-${i}` },
      el('th', { scope: 'row' }, String(i + 1)),
      el('td', {}, typeCell),
      el('td', {}, input('label', { maxlength: 100 })),
      el('td', {}, input('subtype')),
      el('td', {}, el('textarea', { 'data-col': 'description', rows: 1, 'aria-label': `${i + 1}행 설명` }, r.cells.description ?? '')),
      el('td', {}, input('emp_no', { placeholder: 'V-0000' })),
      el('td', {}, el('textarea', { 'data-col': 'attrs', rows: 1, 'aria-label': `${i + 1}행 속성`, placeholder: '키=값; 키=값' }, r.cells.attrs ?? '')),
      !existing ? el('td', {}, el('button', { type: 'button', class: 'small-btn', 'aria-label': `${i + 1}행 빼기`, onclick: () => { st.rows = collect(); st.rows.splice(i, 1); st.errors = new Map(); render(); } }, '빼기')) : null,
    );
    const msg = el('tr', { class: 'row-error row-msg-line', hidden: !err },
      el('td', { colspan: existing ? 7 : 8, 'data-testid': `table-msg-${i}` }, err ? `${i + 1}행: ${err}` : ''));
    return [main, msg];
  }

  function render() {
    const existing = st.mode === 'edit';
    const attachBox = !existing ? el('label', { class: 'check' },
      el('input', { type: 'checkbox', 'data-testid': 'table-attach', checked: st.attach, onchange: (e) => { st.attach = e.target.checked; } }),
      ' 업무는 유니버스의 중심 노드(꼭지)에 바로 연결하기') : null;
    const pasteBox = !existing ? el('div', { class: 'editor' },
      el('label', { class: 'field' },
        el('span', {}, '스프레드시트에서 복사한 표 붙여 넣기(탭으로 나뉜 글)'),
        el('textarea', { id: 'table-paste', rows: 4, 'data-testid': 'table-paste', placeholder: '유형\t이름\t설명\n업무\t월말 정산\t카드사 대사와 마감', oninput: (e) => { st.pasteText = e.target.value; } }, st.pasteText)),
      el('div', { class: 'row' }, el('button', { type: 'button', 'data-testid': 'table-paste-apply', onclick: () => { st.rows = collect(); paste(); render(); } }, '표로 옮기기'))) : null;
    const head = el('thead', {}, el('tr', {},
      el('th', {}, '#'), ...TABLE_COLUMNS.map((c) => el('th', { class: `col-${c.key}` }, c.label)), !existing ? el('th', {}) : null));
    const table = el('div', { class: 'batch-wrap' },
      el('table', { class: 'dg-table batch-grid', 'data-testid': 'table-grid' }, head, el('tbody', {}, ...st.rows.flatMap(row))));

    const bundled = existing && (o.app.doc.refs || []).some((r) => !r.hidden);
    // replaceChildren은 null을 "null" 글자로 넣으므로 빈 칸을 걸러 낸다(검토7 U-1)
    const parts = [
      el('div', { class: 'import-head' },
        el('h2', { id: 'table-title' }, existing ? '표로 고치기' : '표로 추가'),
        el('button', { type: 'button', 'data-testid': 'table-close', onclick: () => o.dialog.close() }, '닫기')),
      el('p', { class: 'muted small' }, existing
        ? '지금 유니버스의 노드를 표로 펼쳤습니다. 바꾼 행만 저장되고 수정 이력(바꾸기 전·후)이 남습니다. 유형은 바꿀 수 없고, 속성은 적은 키만 바뀝니다(지우려면 「키=」). 연결은 표로 고치지 않습니다.'
        : `표의 한 행이 노드 하나입니다(한 번에 ${TABLE_RULES.maxRows}행까지). 저장하면 전부 한 번에 들어가고, 한 행이라도 문제가 있으면 아무것도 저장되지 않습니다. 연결은 표로 넣지 않습니다.`),
      pasteBox,
      st.note ? el('p', { class: 'notice', 'data-testid': 'table-note' }, st.note) : null,
      table,
      !existing ? el('div', { class: 'row' }, el('button', { type: 'button', 'data-testid': 'table-add-row', disabled: st.rows.length >= TABLE_RULES.maxRows, onclick: () => { st.rows = collect(); st.rows.push({ cells: emptyCells() }); render(); } }, '행 추가')) : null,
      attachBox,
      el('p', { class: 'error-text', 'data-testid': 'table-message', 'aria-live': 'polite' }, st.message),
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'primary', 'data-testid': 'table-save', onclick: save }, '저장')),
      el('datalist', { id: 'table-types' }, ...TYPE_CHOICES.map((t) => el('option', { value: t }))),
    ];
    if (bundled) {
      // 묶은 화면(U-2): 하위 유니버스 노드는 이 문서에 없으므로 빈 표와 「저장」 대신 안내만 보인다
      o.dialog.replaceChildren(
        el('div', { class: 'import-head' },
          el('h2', { id: 'table-title' }, '표로 고치기'),
          el('button', { type: 'button', 'data-testid': 'table-close', onclick: () => o.dialog.close() }, '닫기')),
        el('p', { class: 'notice', 'data-testid': 'table-bundled' }, '이 화면은 여러 유니버스를 묶은 화면입니다. 각 유니버스를 열어 고치세요.'));
      return;
    }
    o.dialog.replaceChildren(...parts.filter(Boolean));
  }

  return (mode) => {
    st.mode = mode;
    st.errors = new Map();
    st.message = '';
    st.note = '';
    st.pasteText = '';
    st.rows = mode === 'edit' ? editableRows(o.app.doc) : blankRows(3);
    if (mode === 'edit' && st.rows.length === 0) st.note = '고칠 노드가 없습니다.';
    render();
    o.dialog.showModal();
  };
}
