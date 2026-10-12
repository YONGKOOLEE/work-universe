// T-19 표 입력: 일괄 명령(전부 아니면 전무, D-18)과 표 읽기(D-19). 연결 R-18 AC ①~⑥, 결정 T19-1~17
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBatch, createUniverse } from '../app/src/model/commands.js';
import { validateDocument } from '../app/src/model/validate.js';
import { BATCH_MAX_ROWS, CODES } from '../app/src/model/schema.js';
import { editRowsToOps, editableRows, newRowsToOps, parseAttrsCell, parseTable, splitTsv } from '../app/src/model/table.js';
import { clone } from './helpers.js';

const ctx = { now: '2026-10-12T10:00:00+09:00' };
const base = () => createUniverse({ name: '표 시험 팀', level: '팀', owner: '가상팀' }, ctx).doc;
const rootId = (d) => d.universe.root_node_id;

test('표 읽기: 머리글을 인식하고 탭·따옴표 안 줄바꿈을 읽는다', () => {
  const t = parseTable('유형\t이름\t설명\t속성\n업무\t월말 정산\t"첫 줄\n둘째 줄"\t주기=월; 마감=5일\n\n사람\t가상 담당\t\t');
  assert.equal(t.header, true);
  assert.deepEqual(t.columns, ['type', 'label', 'description', 'attrs']);
  assert.equal(t.rows.length, 2);
  assert.equal(t.rows[0].cells.description, '첫 줄\n둘째 줄');
  assert.equal(t.rows[1].cells.label, '가상 담당');
});

test('표 읽기: 머리글이 없으면 기본 열 순서(유형·이름·하위 유형·설명·사번·속성)로 읽고 첫 줄도 데이터', () => {
  const t = parseTable('업무\t대사\t\t카드사 대사\n사람\t가상 갑\t\t\tV-0001');
  assert.equal(t.header, false);
  assert.equal(t.rows.length, 2);
  assert.equal(t.rows[0].cells.description, '카드사 대사');
  assert.equal(t.rows[1].cells.emp_no, 'V-0001');
});

test('표 읽기: 머리글보다 칸이 많은 행은 오류 행(조용히 버리지 않음)', () => {
  const t = parseTable('유형\t이름\n업무\t정산\t남는칸');
  assert.equal(t.rows[0].error.extra_cells, true);
  assert.equal(newRowsToOps(t.rows)[0].op, 'invalid');
});

test('표 읽기: 속성 칸 해석과 오류, 따옴표 해석', () => {
  assert.deepEqual(parseAttrsCell('주기=월; 마감=5일\n담당=갑').attrs, { 주기: '월', 마감: '5일', 담당: '갑' });
  assert.equal(parseAttrsCell('주기').error.format, true);
  assert.equal(parseAttrsCell('=값').error.format, true);
  assert.deepEqual(parseAttrsCell('주기=').attrs, { 주기: null });
  assert.deepEqual(splitTsv('a\tb\n\n"x""y"\tz'), [['a', 'b'], ['x"y', 'z']]);
});

test('R-18 ①⑤: 5행 → 노드 5개, 노드마다 생성 이력, 업무만 꼭지에 연결(T19-6), 원본 문서는 그대로', () => {
  const d = base();
  const snap = JSON.stringify(d);
  const t = parseTable('유형\t이름\n업무\t정산 A\n업무\t정산 B\n사람\t가상 갑\n산출물\t보고서\n조직\t가상 부서');
  const r = applyBatch(d, newRowsToOps(t.rows), ctx);
  assert.equal(r.ok, true);
  assert.equal(r.created.length, 5);
  assert.equal(r.doc.nodes.length, d.nodes.length + 5);
  const createdNodeEvents = r.events.filter((e) => e.type === 'created' && e.payload.target_kind === 'node');
  assert.equal(createdNodeEvents.length, 5);
  assert.equal(r.doc.edges.length, 2); // 업무 2개만 꼭지에 연결
  assert.ok(r.doc.edges.every((e) => e.source === rootId(d) && e.core_type === 'contains'));
  assert.equal(JSON.stringify(d), snap);
  assert.equal(validateDocument(r.doc).ok, true);
  // 이력 순서(T19-7): 행 순서대로 노드 → (연결)
  assert.deepEqual(r.events.map((e) => e.payload.target_kind), ['node', 'edge', 'node', 'edge', 'node', 'node', 'node']);
});

test('R-18 ③: 한 행이라도 오류면 아무것도 저장하지 않고 오류 행 전부와 사유를 돌려준다(E-BATCH)', () => {
  const d = base();
  const t = parseTable('유형\t이름\n업무\t정상 행\n업무\t\n없는유형\t이상한 행\n업무\t정상 행 2');
  const r = applyBatch(d, newRowsToOps(t.rows), ctx);
  assert.equal(r.ok, false);
  assert.equal(r.doc, d); // 같은 객체: 아무것도 만들지 않음
  assert.deepEqual(r.errors.map((e) => e.row), [2, 3]);
  assert.equal(r.errors[0].error.code, CODES.REQUIRED);
  assert.equal(r.errors[1].error.code, CODES.SCHEMA);
  assert.equal(r.errors[1].error.unknown_type, '없는유형');
});

test('R-18 ③: 고친 뒤 다시 저장하면 전부 저장된다', () => {
  const d = base();
  assert.equal(applyBatch(d, newRowsToOps(parseTable('유형\t이름\n업무\t가\n업무\t').rows), ctx).ok, false);
  const good = applyBatch(d, newRowsToOps(parseTable('유형\t이름\n업무\t가\n업무\t나').rows), ctx);
  assert.equal(good.ok, true);
  assert.equal(good.created.length, 2);
});

test('같은 이름: 표 안 중복은 앞 행 번호와 함께, 기존 노드와의 중복도 E-DUP(T19-5)', () => {
  const d = base();
  const r = applyBatch(d, newRowsToOps(parseTable('유형\t이름\n업무\t정산\n업무\t 정산 \n사람\t정산').rows), ctx);
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 1); // 다른 유형의 같은 이름은 허용(사람)
  assert.equal(r.errors[0].row, 2);
  assert.equal(r.errors[0].error.code, CODES.DUP);
  assert.equal(r.errors[0].error.with_row, 1);
  const first = applyBatch(d, newRowsToOps(parseTable('업무\t정산').rows), ctx);
  const again = applyBatch(first.doc, newRowsToOps(parseTable('업무\t정산').rows), ctx);
  assert.equal(again.ok, false);
  assert.equal(again.errors[0].error.code, CODES.DUP);
  assert.ok(again.errors[0].error.existing_id);
});

test('상한: 101행은 처리하지 않고 알린다(T19-11), 빈 묶음은 거부', () => {
  const d = base();
  const rows = Array.from({ length: BATCH_MAX_ROWS + 1 }, (_, i) => ({ cells: { type: '업무', label: `업무 ${i}` } }));
  const r = applyBatch(d, newRowsToOps(rows), ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.too_many, BATCH_MAX_ROWS);
  assert.equal(applyBatch(d, [], ctx).ok, false);
  assert.equal(applyBatch(d, newRowsToOps(rows.slice(0, BATCH_MAX_ROWS)), ctx).ok, true);
});

test('R-18 ②: 기존 노드 수정은 수정 이력(변경 전후)을 남기고, 표에 없는 속성은 지우지 않는다(T19-17)', () => {
  const added = applyBatch(base(), newRowsToOps([
    { cells: { type: '업무', label: '정산', description: '원래 설명', attrs: '주기=월; 마감=5일' } },
    { cells: { type: '업무', label: '손대지 않음' } },
  ]), ctx);
  const d = added.doc;
  const rows = clone(editableRows(d));
  assert.equal(rows.length, 2);
  const target = rows.find((r) => r.cells.label === '정산');
  target.cells.description = '새 설명';
  target.cells.attrs = '마감=7일'; // 주기는 표에 없음 → 그대로 남는다
  const r = applyBatch(d, editRowsToOps(rows, d), { now: '2026-10-13T10:00:00+09:00' });
  assert.equal(r.ok, true);
  assert.equal(r.updated.length, 1); // 안 바뀐 행은 이력을 만들지 않는다
  assert.deepEqual(r.doc.nodes.find((x) => x.id === target.id).attrs, { 주기: '월', 마감: '7일' });
  const ev = r.events[0];
  assert.equal(ev.type, 'updated');
  assert.equal(ev.payload.before.description, '원래 설명');
  assert.equal(ev.payload.after.description, '새 설명');
  assert.deepEqual(ev.payload.before.attrs, { 주기: '월', 마감: '5일' });
});

test('수정: 「키=」로 비우면 그 속성만 지우고, 유형 변경·꼭지는 거부', () => {
  const d = applyBatch(base(), newRowsToOps([{ cells: { type: '업무', label: '정산', attrs: '주기=월; 마감=5일' } }]), ctx).doc;
  const row = clone(editableRows(d)[0]);
  const del = applyBatch(d, editRowsToOps([{ ...row, cells: { ...row.cells, attrs: '주기=월; 마감=' } }], d), ctx);
  assert.equal(del.ok, true);
  assert.deepEqual(del.doc.nodes.find((x) => x.id === row.id).attrs, { 주기: '월' });
  const typ = applyBatch(d, editRowsToOps([{ ...row, cells: { ...row.cells, type: '사람' } }], d), ctx);
  assert.equal(typ.errors[0].error.cannot_change, true);
  assert.equal(applyBatch(d, editRowsToOps([{ id: rootId(d), cells: { type: '', label: '바꿈' } }], d), ctx).ok, false);
});

test('수정: 한 행이 중복 이름이면 전체가 그대로(문서·이력 모두)', () => {
  const d = applyBatch(base(), newRowsToOps([{ cells: { type: '업무', label: 'A' } }, { cells: { type: '업무', label: 'B' } }]), ctx).doc;
  const rows = clone(editableRows(d));
  rows[0].cells.description = '설명 추가';
  rows[1].cells.label = 'A';
  const r = applyBatch(d, editRowsToOps(rows, d), ctx);
  assert.equal(r.ok, false);
  assert.equal(r.doc, d);
  assert.equal(r.errors[0].row, 2);
});

test('검토 7: 머리글의 모르는 열은 무시하고 알린다(행을 막지 않음)', () => {
  const t = parseTable('유형\t이름\t메모\n업무\tA\tx');
  assert.equal(t.rows[0].error, undefined);
  assert.deepEqual(t.ignored, ['메모']);
  assert.equal(t.rows[0].cells.label, 'A');
});

test('검토 7: 닫히지 않은 큰따옴표는 읽지 않고 알린다', () => {
  const t = parseTable('업무\t"abc\n업무\t다음');
  assert.equal(t.unclosed, true);
  assert.equal(t.rows.length, 0);
});

test('검토 7: 속성 값에 ;가 있는 노드는 표로 속성을 고치지 못하게 하고, 다른 칸만 고치면 속성은 그대로', () => {
  const d = applyBatch(base(), [{ op: 'addNode', input: { core_type: 'work', label: 'W', attrs: { a: 'x;b=1', c: '1' } } }], ctx).doc;
  const row = clone(editableRows(d)[0]);
  const locked = applyBatch(d, editRowsToOps([{ ...row, cells: { ...row.cells, attrs: 'a=x;b=1; c=2' } }], d), ctx);
  assert.equal(locked.errors[0].error.locked, true);
  const other = applyBatch(d, editRowsToOps([{ ...row, cells: { ...row.cells, description: '설명만' } }], d), ctx);
  assert.equal(other.ok, true);
  assert.deepEqual(other.doc.nodes.find((n) => n.id === row.id).attrs, { a: 'x;b=1', c: '1' });
});

test('검토 7: 숫자 속성은 다른 키를 고쳐도 숫자로 남고, 줄바꿈이 \r\n이어도 바뀐 행으로 보지 않는다', () => {
  const d = applyBatch(base(), [{ op: 'addNode', input: { core_type: 'work', label: 'N', description: '첫\n둘', attrs: { a: 5, b: 'x' } } }], ctx).doc;
  const row = clone(editableRows(d)[0]);
  const same = editRowsToOps([{ ...row, cells: { ...row.cells, description: '첫\r\n둘' } }], d);
  assert.equal(same.length, 0);
  const r = applyBatch(d, editRowsToOps([{ ...row, cells: { ...row.cells, attrs: 'a=5; b=y' } }], d), ctx);
  assert.equal(r.ok, true);
  assert.deepEqual(r.doc.nodes.find((n) => n.id === row.id).attrs, { a: 5, b: 'y' });
});
