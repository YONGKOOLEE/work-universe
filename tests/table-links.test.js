// CR-13 C(2026-10-18): 표로 추가의 연결 칸(담당자·산출물·다음 업무). 이름 찾기·새로 만들기·전부 아니면 전무·담당 이력
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBatch, createUniverse, addNode } from '../app/src/model/commands.js';
import { validateDocument } from '../app/src/model/validate.js';
import { createApp } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import { SAMPLES } from '../app/data/index.js';
import { linkSummary, newRowsToOps, parseTable, splitLinkNames } from '../app/src/model/table.js';

const ctx = { now: '2026-10-18T10:00:00+09:00' };
const base = () => createUniverse({ name: '연결 칸 시험', level: '팀', owner: '가상팀' }, ctx).doc;
const rootId = (d) => d.universe.root_node_id;
const withNodes = (specs) => specs.reduce((d, input) => {
  const r = addNode(d, input, ctx);
  assert.equal(r.ok, true);
  return r.doc;
}, base());
const run = (doc, tsv, opt = {}) => {
  const ops = newRowsToOps(parseTable(tsv).rows, { doc, ...opt });
  return { ops, r: applyBatch(doc, ops, ctx) };
};
const find = (d, label, type) => d.nodes.filter((n) => n.label === label && (!type || n.core_type === type));
const edgesOf = (d, type) => d.edges.filter((e) => e.core_type === type && !e.hidden);

test('연결 칸 이름 나누기: 쉼표·세미콜론, 공백 정리, 빈 값·같은 이름 되풀이 제외', () => {
  assert.deepEqual(splitLinkNames(' 가 ,나;; 다 ,  ,가 '), ['가', '나', '다']);
  assert.deepEqual(splitLinkNames(''), []);
});

test('기존 사람·산출물 이름으로 잇는다(새 노드를 만들지 않는다), 담당 시작 이력이 남는다', () => {
  const doc = withNodes([{ core_type: 'person', label: '가상 갑', emp_no: 'V-0001' }, { core_type: 'artifact', label: '정산 보고서' }]);
  const { r } = run(doc, '유형\t이름\t담당자\t산출물\n업무\t월 정산\t가상 갑\t정산 보고서');
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const work = find(r.doc, '월 정산', 'work')[0];
  const person = find(r.doc, '가상 갑')[0];
  assert.equal(find(r.doc, '정산 보고서').length, 1);
  assert.equal(r.doc.nodes.length, doc.nodes.length + 1);
  const perf = edgesOf(r.doc, 'performs');
  assert.equal(perf.length, 1);
  assert.deepEqual([perf[0].source, perf[0].target, perf[0].period.start], [person.id, work.id, '2026-10-18']);
  const hist = r.doc.events.filter((e) => e.type === 'assign_start' && e.payload.work_id === work.id);
  assert.equal(hist.length, 1);
  assert.equal(hist[0].payload.person_id, person.id);
  const produces = edgesOf(r.doc, 'produces');
  assert.equal(produces.length, 1);
  assert.deepEqual([produces[0].source, produces[0].target], [work.id, find(r.doc, '정산 보고서')[0].id]);
  assert.equal(validateDocument(r.doc).ok, true);
});

test('없는 이름은 새 노드로 만든다(사람·산출물은 꼭지에 잇지 않고, 새 업무는 꼭지에 잇는다)', () => {
  const doc = base();
  const { r } = run(doc, '유형\t이름\t담당자\t산출물\t다음 업무\n업무\t대사\t새 담당\t새 산출물\t새 후행');
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  const ids = (l) => find(r.doc, l)[0].id;
  const toRoot = (id) => r.doc.edges.some((e) => e.core_type === 'contains' && e.source === rootId(r.doc) && e.target === id);
  assert.equal(toRoot(ids('대사')), true);
  assert.equal(toRoot(ids('새 후행')), true);
  assert.equal(toRoot(ids('새 담당')), false);
  assert.equal(toRoot(ids('새 산출물')), false);
  assert.equal(edgesOf(r.doc, 'precedes').length, 1);
  assert.equal(edgesOf(r.doc, 'performs').length, 1);
  assert.equal(r.rows.filter((x) => x.aux).length, 3);
  assert.match(linkSummary(r), /항목 4개, 연결 3개를 만들었습니다\(새로 만든 사람·산출물 2개, 새 업무 1개\)/); // CR-18-2
});

test('같은 이름이 여러 행에서 나와도 한 번만 만든다', () => {
  const { r } = run(base(), '유형\t이름\t담당자\t산출물\n업무\t가\t공용 담당\t공용 보고서\n업무\t나\t공용 담당\t공용 보고서');
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(find(r.doc, '공용 담당').length, 1);
  assert.equal(find(r.doc, '공용 보고서').length, 1);
  assert.equal(edgesOf(r.doc, 'performs').length, 2);
  assert.equal(edgesOf(r.doc, 'produces').length, 2);
});

test('같은 표의 다른 행을 다음 업무로 참조한다(새로 만들지 않고 그 행에 잇는다)', () => {
  const { r } = run(base(), '유형\t이름\t다음 업무\n업무\t1단계\t2단계\n업무\t2단계\t');
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(find(r.doc, '2단계').length, 1);
  assert.equal(r.rows.filter((x) => x.aux).length, 0);
  const e = edgesOf(r.doc, 'precedes')[0];
  assert.deepEqual([e.source, e.target], [find(r.doc, '1단계')[0].id, find(r.doc, '2단계')[0].id]);
});

test('업무가 아닌 행에 연결 칸 값이 있으면 전체 거부(그 행 오류, 아무것도 저장되지 않음)', () => {
  const doc = base();
  const { r } = run(doc, '유형\t이름\t산출물\n업무\t정상 업무\t\n사람\t가상 을\t보고서');
  assert.equal(r.ok, false);
  assert.equal(r.doc, doc);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].row, 2);
  assert.equal(r.errors[0].error.field, 'links');
  assert.equal(r.errors[0].error.work_only, true);
});

test('같은 이름의 사람이 둘 이상이면 그 행 오류', () => {
  const doc = withNodes([{ core_type: 'person', label: '동명', emp_no: 'V-0001' }, { core_type: 'person', label: '동명', emp_no: 'V-0002' }]);
  const { r } = run(doc, '유형\t이름\t담당자\n업무\t가\t동명');
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].row, 1);
  assert.equal(r.errors[0].error.ambiguous.core_type, 'person');
});

test('이미 계속 담당 중이면 담당은 건너뛴다(오류 아님), 연결은 늘지 않는다', () => {
  const doc0 = withNodes([{ core_type: 'person', label: '가상 갑', emp_no: 'V-0001' }, { core_type: 'work', label: '기존 업무' }]);
  const pid = find(doc0, '가상 갑')[0].id;
  const wid = find(doc0, '기존 업무')[0].id;
  const a = applyBatch(doc0, [{ op: 'assign', input: { person_id: pid, work_id: wid, occurred_at: '2026-01-01' } }], ctx);
  assert.equal(a.ok, true);
  const again = applyBatch(a.doc, [{ op: 'assign', input: { person_id: pid, work_id: wid } }], ctx);
  assert.equal(again.ok, true);
  assert.equal(edgesOf(again.doc, 'performs').length, 1);
  assert.equal(again.warnings[0].code, 'W-ALREADY-ASSIGNED');
  assert.match(linkSummary({ ...again, created: [] }) || '', /이미 담당 중이라 건너뛴 담당 1건/);
});

test('이미 같은 연결(산출)이 있으면 건너뛴다(오류 아님)', () => {
  const doc = withNodes([{ core_type: 'work', label: '업무 A' }, { core_type: 'artifact', label: '자료' }]);
  const w = find(doc, '업무 A')[0].id;
  const art = find(doc, '자료')[0].id;
  const edge = { op: 'addEdge', skipDup: true, input: { source: w, target: art, core_type: 'produces' } };
  const first = applyBatch(doc, [edge], ctx);
  const second = applyBatch(first.doc, [edge], ctx);
  assert.equal(second.ok, true);
  assert.equal(edgesOf(second.doc, 'produces').length, 1);
  assert.equal(applyBatch(first.doc, [{ ...edge, skipDup: false }], ctx).ok, false);
});

test('머리글 인식: 담당·후행 업무·산출 별칭, 머리글 없으면 속성 칸 다음부터 담당자·산출물·다음 업무', () => {
  const t = parseTable('유형\t이름\t담당\t후행 업무\t산출\n업무\t가\t갑\t나\t보고서');
  assert.deepEqual(t.columns, ['type', 'label', 'assignee', 'next', 'outputs']);
  const h = parseTable('업무\t가\t\t\t\t\t갑\t보고서\t나');
  assert.equal(h.header, false);
  assert.deepEqual([h.rows[0].cells.assignee, h.rows[0].cells.outputs, h.rows[0].cells.next], ['갑', '보고서', '나']);
});

test('연결 칸이 없는 표는 예전 명령과 똑같다(보조 명령 없음)', () => {
  const ops = newRowsToOps(parseTable('유형\t이름\n업무\t가\n사람\t나').rows, { doc: base() });
  assert.deepEqual(ops.map((o) => o.op), ['addNode', 'addNode']);
});

test('앱: 연결 칸이 있어도 저장소에 한 번만 쓴다, 실패하면 아무것도 바뀌지 않는다', () => {
  const m = new Map();
  const storage = { failWrites: false, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem(k, v) { if (this.failWrites) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); m.set(k, String(v)); }, removeItem: (k) => m.delete(k) };
  const now = () => '2026-10-18T12:00:00+09:00';
  const first = createApp({ store: createStore(storage), samples: SAMPLES, now });
  const id = first.createUniverse({ name: '연결 칸 앱', level: '팀', owner: '가상팀' }).doc.universe.id;
  const store = createStore(storage);
  let saves = 0;
  const orig = store.saveUniverse.bind(store);
  store.saveUniverse = (d) => { saves += 1; return orig(d); };
  const app = createApp({ store, samples: SAMPLES, currentId: id, now });
  saves = 0;
  const ops = (tsv) => newRowsToOps(parseTable(tsv).rows, { doc: app.doc });
  const snap = JSON.stringify(app.doc);
  storage.failWrites = true;
  assert.equal(app.applyBatch(ops('유형\t이름\t담당자\t산출물\n업무\t가\t갑\t보고서')).ok, false);
  assert.equal(JSON.stringify(app.doc), snap);
  storage.failWrites = false;
  saves = 0; // 실패한 시도의 호출은 세지 않는다
  const bad = app.applyBatch(ops('유형\t이름\t산출물\n업무\t가\t보고서\n사람\t나\t보고서'));
  assert.equal(bad.ok, false);
  assert.equal(saves, 0);
  const ok = app.applyBatch(ops('유형\t이름\t담당자\t산출물\t다음 업무\n업무\t가\t갑\t보고서\t나\n업무\t나\t갑\t\t'));
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.equal(saves, 1);
  assert.equal(edgesOf(app.doc, 'performs').length, 2);
  assert.equal(find(app.doc, '갑').length, 1);
});

test('결함 주입 확인: 이력 없이 수행 연결만 만드는 경로(addEdge)와 표의 담당 칸(assign)은 다르다', () => {
  const { r } = run(base(), '유형\t이름\t담당자\n업무\t가\t갑');
  assert.equal(r.doc.events.filter((e) => e.type === 'assign_start').length, 1);
  const noHist = applyBatch(base(), [
    { op: 'addNode', row: 1, input: { core_type: 'person', label: '갑' } },
    { op: 'addNode', row: 2, input: { core_type: 'work', label: '가' } },
    { op: 'addEdge', input: { source: '@1', target: '@2', core_type: 'performs' } },
  ], ctx);
  assert.equal(noHist.doc.events.filter((e) => e.type === 'assign_start').length, 0);
});
