// 표 입력(T-19, R-18·D-18·D-19): 스프레드시트에서 복사한 탭 구분 글 → 행, 행 → 일괄 명령(순수 함수).
// 이 모듈은 DOM·저장소를 쓰지 않는다.
// 연결 칸(2026-10-18 CR-13 C): 새 행(업무)의 「담당자·산출물·다음 업무」 칸 → 이름으로 노드를 찾아(없으면 새로 만들어) 수행·산출·선후행 연결. 「표로 고치기」에는 연결 칸이 없다.
// 기본값은 docs/decisions-pending.md 8절(T19-1~17). 바꾸기 쉽게 TABLE_RULES 한 곳에 둔다.

import { BATCH_MAX_ROWS, CODES, LABEL_MAX, NODE_TYPES, isUnsafeKey, normalizeLabel } from './schema.js';

export const TABLE_RULES = {
  maxRows: BATCH_MAX_ROWS, // T19-11
  maxInput: 200000, // 붙여 넣을 수 있는 글자 수
  attrSeparators: /[;；\n]/, // 속성 칸 「키=값; 키=값」 (T19-1)
  linkSeparators: /[,，;；]/, // 연결 칸 「이름, 이름」 (CR-13 C)
};

// 열 키 → 머리글로 인정하는 이름(T19-1·T19-2). 공백은 없애고 비교한다
export const TABLE_COLUMNS = [
  { key: 'type', label: '유형', aliases: ['유형', '종류', '타입'] },
  { key: 'label', label: '이름', aliases: ['이름', '노드', '노드이름', '명칭', '업무명'] },
  { key: 'subtype', label: '하위 유형', aliases: ['하위유형', '세부유형', '하위종류'] },
  { key: 'description', label: '설명', aliases: ['설명', '내용', '비고'] },
  { key: 'emp_no', label: '사번', aliases: ['사번', '사원번호'] },
  { key: 'attrs', label: '속성', aliases: ['속성', '주요속성'] },
  // 연결 칸(업무 새 행에서만. 머리글 없는 붙여 넣기는 속성 칸 다음에서부터 이 순서)
  { key: 'assignee', label: '담당자', aliases: ['담당자', '담당', '담당자명'], link: 'person' },
  { key: 'outputs', label: '산출물', aliases: ['산출물', '산출'], link: 'artifact' },
  { key: 'next', label: '다음 업무', aliases: ['다음업무', '후행업무', '다음', '후행'], link: 'work' },
];
/** 연결 칸 키(표로 고치기에는 없다) */
export const LINK_KEYS = TABLE_COLUMNS.filter((c) => c.link).map((c) => c.key);
const KEYS = TABLE_COLUMNS.map((c) => c.key);
const squash = (s) => String(s).replace(/\s+/g, '');

// 입력 별칭(FU9-1): 메뉴 이름이 「사람·업무·문서 추가」라 「문서」라고 쓰는 사람이 많다. 저장은 기존 산출물 유형 그대로
const TYPE_ALIASES = [['문서', 'artifact'], ['파일', 'artifact'], ['보고서', 'artifact'], ['자료', 'artifact'], ['서류', 'artifact'], ['산출', 'artifact']];
const TYPE_BY_NAME = new Map([
  ...Object.entries(NODE_TYPES).filter(([k]) => k !== 'root').flatMap(([k, name]) => [[name, k], [k, k]]),
  ...TYPE_ALIASES,
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
    if (!key || isUnsafeKey(key)) return { attrs: null, error: { code: CODES.SCHEMA, field: 'attrs', format: true } };
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
  const base = baseRowOps(rows, attach);
  return LINK_KEYS.some((k) => rows.some((r) => cell(r.cells || {}, k).trim() !== '')) ? withLinkOps(rows, base, opt.doc, attach) : base;
}

/** 연결 칸 글 「이름, 이름」 → 이름 목록(앞뒤 공백 정리, 빈 값·같은 이름 되풀이 제외) */
export function splitLinkNames(text) {
  const seen = new Set();
  const out = [];
  for (const part of String(text ?? '').split(TABLE_RULES.linkSeparators)) {
    const name = part.replace(/\s+/g, ' ').trim();
    const key = normalizeLabel(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

const AUX_ROW_BASE = 10000; // 연결 칸이 만든 보조 명령의 행 번호(화면 행과 겹치지 않는 번호. 오류는 shown_row 로 그 칸이 있는 행에 보인다)

/**
 * 새 행 명령 뒤에 연결 칸이 만드는 명령을 붙인다: 이름 찾기 → (없으면) 새 노드(aux) → 연결(assign·produces·precedes).
 * 이름 찾기: 같은 유형의 노드를 이 문서(숨김 제외)와 같은 표의 행에서 normalizeLabel 로 찾는다. 둘 이상이면 그 행 오류.
 * 연결 칸은 업무 행에서만 쓴다. 오류가 있는 행의 연결 칸은 처리하지 않는다(그 행 오류만 보고).
 */
function withLinkOps(rows, base, doc, attach) {
  const key = (type, label) => `${type}\u0000${normalizeLabel(label)}`;
  const docIds = new Map();
  for (const n of doc?.nodes || []) {
    if (n.hidden || n.core_type === 'root' || typeof n.label !== 'string') continue;
    const k = key(n.core_type, n.label);
    docIds.set(k, [...(docIds.get(k) || []), n.id]);
  }
  const tableRefs = new Map();
  base.forEach((op) => {
    if (op.op !== 'addNode') return;
    const k = key(op.input.core_type, op.input.label);
    tableRefs.set(k, [...(tableRefs.get(k) || []), `@${op.row}`]);
  });
  const out = base.slice();
  const auxOps = [];
  const linkOps = [];
  const auxRef = new Map(); // 이름 키 → '@보조행'(같은 이름은 한 번만 만든다)
  let nextAux = AUX_ROW_BASE;
  const columnOf = Object.fromEntries(TABLE_COLUMNS.map((c) => [c.key, c]));
  rows.forEach((r, i) => {
    const op = base[i];
    const cells = r.cells || {};
    const has = LINK_KEYS.some((k) => cell(cells, k).trim() !== '');
    if (!has || op.op === 'invalid') return;
    const row = op.row;
    if (op.input.core_type !== 'work') {
      out[i] = { op: 'invalid', row, error: { code: CODES.SCHEMA, field: 'links', work_only: true } };
      return;
    }
    // 1) 이름 해석(오류가 있으면 이 행은 아무것도 만들지 않는다)
    const plan = [];
    for (const colKey of LINK_KEYS) {
      const type = columnOf[colKey].link;
      for (const name of splitLinkNames(cell(cells, colKey))) {
        if (name.length > LABEL_MAX) { out[i] = { op: 'invalid', row, error: { code: CODES.SCHEMA, field: 'links', too_long: LABEL_MAX } }; return; } // 이름 칸이 아니라 연결 칸 문제(검토 R13 재검증 1)
        const k = key(type, name);
        const found = [...(docIds.get(k) || []), ...(tableRefs.get(k) || [])];
        if (found.length > 1) { out[i] = { op: 'invalid', row, error: { code: CODES.DUP, field: 'links', ambiguous: { core_type: type, label: name } } }; return; }
        plan.push({ colKey, type, name, k, ref: found[0] || auxRef.get(k) || null });
      }
    }
    // 2) 만들기: 없는 이름은 새 노드(같은 이름은 한 번만), 그다음 연결
    const mine = `@${row}`;
    for (const p of plan) {
      if (!p.ref) {
        const auxRow = nextAux++;
        auxOps.push({ op: 'addNode', row: auxRow, shown_row: row, aux: true, input: { core_type: p.type, label: p.name }, attachRoot: p.type === 'work' && attach !== false });
        p.ref = `@${auxRow}`;
        auxRef.set(p.k, p.ref);
      }
      const edgeRow = nextAux++;
      if (p.colKey === 'assignee') linkOps.push({ op: 'assign', row: edgeRow, shown_row: row, aux: true, input: { person_id: p.ref, work_id: mine } });
      else linkOps.push({ op: 'addEdge', row: edgeRow, shown_row: row, aux: true, skipDup: true, input: { source: mine, target: p.ref, core_type: p.colKey === 'outputs' ? 'produces' : 'precedes' } });
    }
  });
  return [...out, ...auxOps, ...linkOps];
}

function baseRowOps(rows, attach) {
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
        type: Object.hasOwn(NODE_TYPES, n.core_type) ? NODE_TYPES[n.core_type] : '',
        label: String(n.label ?? ''),
        subtype: String(n.subtype || ''),
        description: String(n.description || ''),
        emp_no: String(n.emp_no || ''),
        attrs: formatAttrsCell(n.attrs),
      },
    }));
}


/**
 * 표로 추가한 결과 요약(CR-13 C). 연결 칸을 쓰지 않았으면 null.
 * 「노드 n개, 연결 m개를 만들었습니다(새로 만든 사람·산출물 k개)」 + 이미 담당 중이라 건너뛴 수
 */
export function linkSummary(result) {
  const rows = result?.rows || [];
  if (!rows.some((r) => r.aux || r.kind === 'assigned' || r.kind === 'skipped' || r.kind === 'edge')) return null;
  const links = (result.edges || []).length + (result.assignments || []).length;
  const fresh = rows.filter((r) => r.aux && (r.node.core_type === 'person' || r.node.core_type === 'artifact')).length;
  const freshWork = rows.filter((r) => r.aux && r.node.core_type === 'work').length;
  const already = rows.filter((r) => r.kind === 'skipped' && r.reason === 'already_assigned').length;
  const dup = rows.filter((r) => r.kind === 'skipped' && r.reason === 'duplicate_edge').length;
  let text = `항목 ${(result.created || []).length}개, 연결 ${links}개를 만들었습니다(새로 만든 사람·산출물 ${fresh}개${freshWork ? `, 새 업무 ${freshWork}개` : ''}).`;
  if (already) text += ` 이미 담당 중이라 건너뛴 담당 ${already}건.`;
  if (dup) text += ` 이미 있는 연결 ${dup}건은 건너뛰었습니다.`;
  return text;
}
