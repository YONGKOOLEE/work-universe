// 표 입력(T-19, R-18·D-18·D-19): 스프레드시트에서 복사한 탭 구분 글 → 행, 행 → 일괄 명령(순수 함수).
// 이 모듈은 DOM·저장소를 쓰지 않는다. 연결(관계)은 표로 넣지 않는다(R-18 ⑥).
// 기본값은 docs/decisions-pending.md 8절(T19-1~17). 바꾸기 쉽게 TABLE_RULES 한 곳에 둔다.

import { BATCH_MAX_ROWS, CODES, LABEL_MAX, NODE_TYPES } from './schema.js';

export const TABLE_RULES = {
  maxRows: BATCH_MAX_ROWS, // T19-11
  maxInput: 200000, // 붙여 넣을 수 있는 글자 수
  attrSeparators: /[;；\n]/, // 속성 칸 「키=값; 키=값」 (T19-1)
};

// 열 키 → 머리글로 인정하는 이름(T19-1·T19-2). 공백은 없애고 비교한다
export const TABLE_COLUMNS = [
  { key: 'type', label: '유형', aliases: ['유형', '종류', '타입'] },
  { key: 'label', label: '이름', aliases: ['이름', '노드', '노드이름', '명칭', '업무명'] },
  { key: 'subtype', label: '하위 유형', aliases: ['하위유형', '세부유형', '하위종류'] },
  { key: 'description', label: '설명', aliases: ['설명', '내용', '비고'] },
  { key: 'emp_no', label: '사번', aliases: ['사번', '사원번호'] },
  { key: 'attrs', label: '속성', aliases: ['속성', '주요속성'] },
];
const KEYS = TABLE_COLUMNS.map((c) => c.key);
const squash = (s) => String(s).replace(/\s+/g, '');

const TYPE_BY_NAME = new Map([
  ...Object.entries(NODE_TYPES).filter(([k]) => k !== 'root').flatMap(([k, name]) => [[name, k], [k, k]]),
]);

/** 유형 칸 글 → core_type. 모르면 null, 비었으면 '' */
export function parseTypeCell(text) {
  const t = squash(text ?? '').toLowerCase();
  if (!t) return '';
  return TYPE_BY_NAME.get(t) || null;
}

/** 탭·줄바꿈·큰따옴표(셀 안 줄바꿈)를 읽는 작은 TSV 해석. 빈 줄은 건너뛴다. 따옴표가 닫히지 않으면 unclosed */
function scanTsv(text) {
  const src = String(text).replace(/\r\n?/g, '\n');
  const records = [];
  let rec = [];
  let cell = '';
  let quoted = false;
  let atCellStart = true;
  const endCell = () => { rec.push(cell); cell = ''; atCellStart = true; };
  const endRecord = () => {
    endCell();
    if (rec.some((c) => c.trim() !== '')) records.push(rec);
    rec = [];
  };
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && atCellStart) {
      quoted = true;
      atCellStart = false;
    } else if (ch === '\t') endCell();
    else if (ch === '\n') endRecord();
    else { cell += ch; atCellStart = false; }
  }
  if (cell !== '' || rec.length) endRecord();
  return { records, unclosed: quoted };
}

export function splitTsv(text) {
  return scanTsv(text).records;
}

/** 속성 칸 「키=값; 키=값」 → {attrs, error}. 값이 비면 null(고치기에서 그 속성을 지움) */
export function parseAttrsCell(text) {
  const attrs = {};
  const s = String(text ?? '').trim();
  if (!s) return { attrs };
  for (const part of s.split(TABLE_RULES.attrSeparators)) {
    const p = part.trim();
    if (!p) continue;
    const at = p.indexOf('=');
    const key = at < 0 ? '' : p.slice(0, at).trim();
    // 객체 프로토타입을 건드리는 키는 받지 않는다(조용히 사라지지 않게 거부. 검토7 K-5)
    if (!key || key === '__proto__' || key === 'constructor' || key === 'prototype') return { attrs: null, error: { code: CODES.SCHEMA, field: 'attrs', format: true } };
    const value = p.slice(at + 1).trim();
    attrs[key] = value === '' ? null : value;
  }
  return { attrs };
}

/** 속성 칸 「키=값; …」으로 썼다가 다시 읽어도 같은가(값·키에 ;·줄바꿈·=가 없는가) */
export function attrsRoundTrip(attrs) {
  return Object.entries(attrs || {}).every(([k, v]) => !/[;；\n=]/.test(k) && !/[;；\n]/.test(String(v)));
}

/** 속성 객체 → 칸 글(고치기 화면에 채울 때) */
export function formatAttrsCell(attrs) {
  return Object.entries(attrs || {}).map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * 붙여 넣은 글 → 행. 첫 줄 칸 중 「이름」 계열이 있으면 머리글로 읽고, 없으면 기본 열 순서로 읽는다(T19-2).
 * @returns {{rows: {line:number, cells:object, error?:object}[], header:boolean, columns:string[], tooMany?:number, tooLong?:boolean}}
 */
export function parseTable(text) {
  if (String(text).length > TABLE_RULES.maxInput) return { rows: [], header: false, columns: KEYS, tooLong: true };
  const scanned = scanTsv(text);
  if (scanned.unclosed) return { rows: [], header: false, columns: KEYS, unclosed: true };
  const records = scanned.records;
  let columns = KEYS;
  let header = false;
  let start = 0;
  let ignoredColumns = [];
  if (records.length) {
    const found = records[0].map((c) => {
      const t = squash(c).toLowerCase();
      return TABLE_COLUMNS.find((col) => col.aliases.includes(t))?.key || null;
    });
    if (found.includes('label')) {
      header = true;
      start = 1;
      columns = found;
      ignoredColumns = records[0].filter((c, j) => !found[j] && c.trim() !== '').map((c) => c.trim());
    }
  }
  const rows = [];
  records.slice(start).forEach((rec, i) => {
    const line = i + 1; // 데이터 행 번호(머리글·빈 줄 제외)
    const cells = {};
    let extra = false;
    rec.forEach((c, j) => {
      const key = columns[j];
      // 이름·유형 같은 한 줄 칸의 줄바꿈은 공백으로(설명·속성만 여러 줄을 허용)
      const one = key === 'description' || key === 'attrs' ? c.trim() : c.replace(/\s+/g, ' ').trim();
      if (key) cells[key] = key in cells && cells[key] ? cells[key] : one;
      else if (c.trim() !== '' && !(header && j < columns.length)) extra = true; // 머리글에 있는 모르는 열은 무시(ignored)
    });
    const row = { line, cells };
    if (extra) row.error = { code: CODES.SCHEMA, field: 'columns', extra_cells: true };
    rows.push(row);
  });
  const out = { rows, header, columns: columns.filter(Boolean) };
  if (ignoredColumns.length) out.ignored = ignoredColumns;
  if (rows.length > TABLE_RULES.maxRows) out.tooMany = TABLE_RULES.maxRows;
  return out;
}

const cell = (cells, k) => (cells[k] === undefined || cells[k] === null ? '' : String(cells[k]).replace(/\r\n?/g, '\n'));

/**
 * 새 행 → addNode 일괄 명령. 행에 문제가 있으면 invalid 명령(그 행 사유)으로 돌려 전부 아니면 전무로 처리되게 한다.
 * @param {{line?:number, cells:object, error?:object}[]} rows
 * @param {{attachRoot?: boolean|'work'}} [opt] attachRoot: true 모두 꼭지에 연결, 'work' 업무만(T19-6), false 연결 안 함
 */
export function newRowsToOps(rows, opt = {}) {
  const attach = opt.attachRoot === undefined ? 'work' : opt.attachRoot;
  return rows.map((r, i) => {
    const row = r.line ?? i + 1;
    if (r.error) return { op: 'invalid', row, error: r.error };
    const c = r.cells;
    const coreType = parseTypeCell(cell(c, 'type'));
    if (coreType === '') return { op: 'invalid', row, error: { code: CODES.REQUIRED, field: 'core_type' } };
    if (coreType === null) return { op: 'invalid', row, error: { code: CODES.SCHEMA, field: 'core_type', unknown_type: cell(c, 'type') } };
    const label = cell(c, 'label').trim();
    if (!label) return { op: 'invalid', row, error: { code: CODES.REQUIRED, field: 'label' } };
    if (label.length > LABEL_MAX) return { op: 'invalid', row, error: { code: CODES.REQUIRED, field: 'label', too_long: LABEL_MAX } };
    const a = parseAttrsCell(cell(c, 'attrs'));
    if (a.error) return { op: 'invalid', row, error: a.error };
    const attrs = Object.fromEntries(Object.entries(a.attrs).filter(([, v]) => v !== null));
    const input = { core_type: coreType, label };
    if (cell(c, 'subtype').trim()) input.subtype = cell(c, 'subtype').trim();
    if (cell(c, 'description').trim()) input.description = cell(c, 'description').trim();
    if (cell(c, 'emp_no').trim()) input.emp_no = cell(c, 'emp_no').trim();
    if (Object.keys(attrs).length) input.attrs = attrs;
    return { op: 'addNode', row, input, attachRoot: attach === true || (attach === 'work' && coreType === 'work') };
  });
}

/**
 * 기존 노드 행 → updateNode 일괄 명령(T19-3·T19-17). 표에 쓴 속성 키만 바꾸고 표에 없는 속성은 지우지 않는다.
 * 속성 칸이 채워 준 글 그대로면 속성은 건드리지 않는다(값에 「;」가 들어 있어도 안전하게).
 * @param {{line?:number, id:string, cells:object}[]} rows
 * @param {object} doc 현재 문서
 */
export function editRowsToOps(rows, doc) {
  const original = new Map(editableRows(doc).map((r) => [r.id, r.cells]));
  const untouched = (r) => {
    const o = original.get(r.id);
    return !!o && Object.keys(o).every((k) => cell(r.cells, k).trim() === o[k].trim());
  };
  return rows.map((r, i) => ({ r, row: r.line ?? i + 1 })).filter(({ r }) => r.error || !untouched(r)).map(({ r, row }) => {
    const node = doc.nodes.find((n) => n.id === r.id);
    if (!node || node.core_type === 'root') return { op: 'invalid', row, error: { code: CODES.SCHEMA, field: 'id' } };
    const c = r.cells;
    const type = parseTypeCell(cell(c, 'type'));
    if (type !== '' && type !== node.core_type) return { op: 'invalid', row, error: { code: CODES.SCHEMA, field: 'core_type', cannot_change: true } };
    const label = cell(c, 'label').trim();
    if (!label) return { op: 'invalid', row, error: { code: CODES.REQUIRED, field: 'label' } };
    if (label.length > LABEL_MAX) return { op: 'invalid', row, error: { code: CODES.REQUIRED, field: 'label', too_long: LABEL_MAX } };
    const changes = { label };
    if ('description' in c) changes.description = cell(c, 'description');
    if ('subtype' in c) changes.subtype = cell(c, 'subtype');
    if ('emp_no' in c && node.core_type === 'person') changes.emp_no = cell(c, 'emp_no');
    else if (cell(c, 'emp_no').trim() && node.core_type !== 'person') return { op: 'invalid', row, error: { code: CODES.SCHEMA, field: 'emp_no' } };
    if ('attrs' in c && cell(c, 'attrs').trim() !== formatAttrsCell(node.attrs)) {
      if (!attrsRoundTrip(node.attrs)) return { op: 'invalid', row, error: { code: CODES.SCHEMA, field: 'attrs', locked: true } };
      const a = parseAttrsCell(cell(c, 'attrs'));
      if (a.error) return { op: 'invalid', row, error: a.error };
      const merged = { ...(node.attrs || {}) };
      for (const [k, v] of Object.entries(a.attrs)) {
        if (v === null) delete merged[k];
        else if (!(k in merged && String(merged[k]) === v)) merged[k] = v; // 같은 값이면 원래 값(숫자 등)을 그대로
      }
      changes.attrs = merged;
    }
    return { op: 'updateNode', row, id: node.id, changes };
  });
}

/** 고치기 화면에 채울 행: 보이는 노드(꼭지·숨김 제외), 문서 순서(T19-3) */
export function editableRows(doc) {
  return doc.nodes
    .filter((n) => !n.hidden && n.core_type !== 'root')
    .map((n) => ({
      id: n.id,
      cells: {
        type: NODE_TYPES[n.core_type] || '',
        label: n.label,
        subtype: n.subtype || '',
        description: n.description || '',
        emp_no: n.emp_no || '',
        attrs: formatAttrsCell(n.attrs),
      },
    }));
}

