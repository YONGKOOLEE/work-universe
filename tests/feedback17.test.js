// 사용자 화면 확인 의견(2026-10-17): 노드 추가 때 함께 이을 연결(applyBatch addEdge 표식 '@행번호'), 연결 관계·상대 바꾸기(replaceEdge)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBatch, replaceEdge } from '../app/src/model/commands.js';
import { createApp } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import { SAMPLES } from '../app/data/index.js';
import { EXAMPLE_12_6 } from './fixtures/example-12-6.js';

const ctx = { now: '2026-10-17T10:00:00+09:00' };
const doc = EXAMPLE_12_6;
const snap = JSON.stringify(doc);

test('addEdge op: 같은 묶음의 새 노드를 @행번호로 가리켜 노드와 연결이 함께 생긴다(사람 → 기존 업무 수행)', () => {
  const r = applyBatch(doc, [
    { op: 'addNode', row: 1, input: { core_type: 'person', label: '새사람', emp_no: 'V-7777' } },
    { op: 'addEdge', row: 2, input: { core_type: 'performs', source: '@1', target: 'N-001' } },
  ], ctx);
  assert.equal(r.ok, true);
  assert.equal(r.created.length, 1);
  assert.equal(r.edges.length, 1);
  assert.equal(r.edges[0].source, r.created[0].id);
  assert.equal(r.edges[0].target, 'N-001');
  assert.equal(r.doc.edges.length, doc.edges.length + 1);
  assert.equal(r.events.length, 2);
  assert.equal(JSON.stringify(doc), snap);
});

test('addEdge op: 새 노드가 target 쪽이어도 된다(업무 → 새 산출물)', () => {
  const r = applyBatch(doc, [
    { op: 'addNode', input: { core_type: 'artifact', label: '새 산출물' } },
    { op: 'addEdge', input: { core_type: 'produces', source: 'N-001', target: '@1' } },
  ], ctx);
  assert.equal(r.ok, true);
  assert.equal(r.edges[0].target, r.created[0].id);
});

test('addEdge op: 꼭지 연결(attachRoot)과 함께 써도 한 묶음이다', () => {
  const r = applyBatch(doc, [
    { op: 'addNode', input: { core_type: 'work', label: '새 업무' }, attachRoot: true },
    { op: 'addEdge', input: { core_type: 'precedes', source: 'N-001', target: '@1' } },
  ], ctx);
  assert.equal(r.ok, true);
  assert.equal(r.doc.edges.length, doc.edges.length + 2);
  assert.equal(r.events.length, 3);
});

test('addEdge op: 기존 노드끼리 연결도 된다(표로 연결 넣기용 일반 op)', () => {
  const r = applyBatch(doc, [{ op: 'addEdge', input: { core_type: 'relates_to', source: 'N-010', target: 'N-030' } }], ctx);
  assert.equal(r.ok, true);
  assert.equal(r.created.length, 0);
  assert.equal(r.doc.edges.length, doc.edges.length + 1);
});

test('addEdge op: 허용되지 않는 조합이면 전부 저장 안 됨(노드도 안 생김), 오류는 연결 행', () => {
  const r = applyBatch(doc, [
    { op: 'addNode', row: 1, input: { core_type: 'person', label: '새사람2' } },
    { op: 'addEdge', row: 2, input: { core_type: 'produces', source: '@1', target: 'N-001' } },
  ], ctx);
  assert.equal(r.ok, false);
  assert.equal(r.doc, doc);
  assert.deepEqual(r.errors.map((e) => [e.row, e.error.code]), [[2, 'E-PAIR']]);
});

test('addEdge op: 이미 있는 연결(중복)이면 거부, 숨긴 노드가 끝이어도 거부', () => {
  const dup = applyBatch(doc, [{ op: 'addEdge', input: { core_type: 'performs', source: 'N-011', target: 'N-001' } }], ctx);
  assert.equal(dup.ok, false);
  assert.equal(dup.errors[0].error.code, 'E-DUP');
  const hid = JSON.parse(snap);
  hid.nodes.find((n) => n.id === 'N-030').hidden = true;
  const r = applyBatch(hid, [{ op: 'addEdge', input: { core_type: 'relates_to', source: 'N-010', target: 'N-030' } }], ctx);
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].error.hidden, true);
});

test('addEdge op: 앞 행이 실패하면 그 오류만 보고하고, 없는 행 참조는 bad_ref', () => {
  const failed = applyBatch(doc, [
    { op: 'addNode', input: { core_type: 'work', label: '대사 확인' } },
    { op: 'addEdge', input: { core_type: 'precedes', source: 'N-001', target: '@1' } },
  ], ctx);
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.errors.map((e) => [e.row, e.error.code]), [[1, 'E-DUP']]);
  const bad = applyBatch(doc, [{ op: 'addEdge', input: { core_type: 'precedes', source: 'N-001', target: '@5' } }], ctx);
  assert.equal(bad.ok, false);
  assert.equal(bad.errors[0].error.bad_ref, 5);
});

test('app: 노드와 연결을 함께 저장해도 저장소 쓰기는 한 번, 실패하면 저장소·문서가 그대로', () => {
  const m = new Map();
  const storage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  const store = createStore(storage);
  const now = () => '2026-10-17T12:00:00+09:00';
  const first = createApp({ store, samples: SAMPLES, now });
  const made = first.createUniverse({ name: '연결 동시 시험', level: '팀', owner: '가상팀' });
  const id = made.doc.universe.id;
  const setup = createApp({ store, samples: SAMPLES, currentId: id, now });
  const w = setup.applyBatch([{ op: 'addNode', input: { core_type: 'work', label: '기준 업무' }, attachRoot: true }]).created[0];
  let saves = 0;
  const orig = store.saveUniverse.bind(store);
  store.saveUniverse = (d) => { saves += 1; return orig(d); };
  const app = createApp({ store, samples: SAMPLES, currentId: id, now });
  saves = 0;
  const bad = app.applyBatch([
    { op: 'addNode', row: 1, input: { core_type: 'person', label: '가상 담당' } },
    { op: 'addEdge', row: 2, input: { core_type: 'produces', source: '@1', target: w.id } },
  ]);
  assert.equal(bad.ok, false);
  assert.equal(saves, 0);
  assert.equal(app.doc.nodes.some((n) => n.label === '가상 담당'), false);
  const ok = app.applyBatch([
    { op: 'addNode', row: 1, input: { core_type: 'person', label: '가상 담당' } },
    { op: 'addEdge', row: 2, input: { core_type: 'performs', source: '@1', target: w.id } },
  ]);
  assert.equal(ok.ok, true);
  assert.equal(saves, 1);
  assert.equal(app.doc.edges.some((e) => e.core_type === 'performs'), true);
});

test('app.replaceEdge: 저장 한 번, 옛 연결 숨김·새 연결 생성, 실패하면 저장 안 함', () => {
  const m = new Map();
  const storage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  const store = createStore(storage);
  const now = () => '2026-10-17T12:00:00+09:00';
  const first = createApp({ store, samples: SAMPLES, now });
  const id = first.createUniverse({ name: '연결 교체 시험', level: '팀', owner: '가상팀' }).doc.universe.id;
  const setup = createApp({ store, samples: SAMPLES, currentId: id, now });
  const a = setup.applyBatch([
    { op: 'addNode', input: { core_type: 'work', label: '업무 가' }, attachRoot: true },
    { op: 'addNode', input: { core_type: 'work', label: '업무 나' }, attachRoot: true },
    { op: 'addEdge', input: { core_type: 'references', source: '@1', target: '@2' } },
  ]);
  assert.equal(a.ok, true);
  const old = a.edges[0];
  let saves = 0;
  const orig = store.saveUniverse.bind(store);
  store.saveUniverse = (d) => { saves += 1; return orig(d); };
  const app = createApp({ store, samples: SAMPLES, currentId: id, now });
  saves = 0;
  const bad = app.replaceEdge(old.id, { source: a.created[0].id, target: a.created[1].id, core_type: 'produces' });
  assert.equal(bad.ok, false);
  assert.equal(saves, 0);
  assert.equal(app.findEdge(old.id).hidden, false);
  const r = app.replaceEdge(old.id, { source: a.created[0].id, target: a.created[1].id, core_type: 'precedes' });
  assert.equal(r.ok, true);
  assert.equal(saves, 1);
  assert.equal(app.findEdge(old.id).hidden, true);
  assert.equal(app.findEdge(r.edge.id).core_type, 'precedes');
});

test('replaceEdge: 관계를 바꾸면 옛 연결은 숨고 새 연결이 생기며 이벤트가 둘 남는다', () => {
  const r = replaceEdge(doc, 'L-003', { source: 'N-001', target: 'N-020', core_type: 'produces' }, ctx);
  assert.equal(r.ok, true);
  assert.equal(r.doc.edges.find((e) => e.id === 'L-003').hidden, true);
  assert.equal(r.edge.core_type, 'produces');
  assert.equal(r.edge.hidden, false);
  assert.equal(r.doc.edges.length, doc.edges.length + 1);
  assert.deepEqual(r.doc.events.slice(doc.events.length).map((e) => e.type), ['hidden', 'created']);
  assert.equal(JSON.stringify(doc), snap);
});

test('replaceEdge: 상대만 바꿔도 된다(수행 연결의 사람 교체)', () => {
  const r = replaceEdge(doc, 'L-002', { source: 'N-010', target: 'N-001', core_type: 'performs' }, ctx);
  assert.equal(r.ok, true);
  assert.equal(r.doc.edges.find((e) => e.id === 'L-002').hidden, true);
  assert.equal(r.edge.source, 'N-010');
});

test('replaceEdge: 새 연결이 허용 안 됨·중복이면 문서 그대로(옛 연결도 안 숨김)', () => {
  const pair = replaceEdge(doc, 'L-003', { source: 'N-001', target: 'N-030', core_type: 'performs' }, ctx);
  assert.equal(pair.ok, false);
  assert.equal(pair.error.code, 'E-PAIR');
  const dup = replaceEdge(doc, 'L-003', { source: 'N-011', target: 'N-001', core_type: 'performs' }, ctx);
  assert.equal(dup.ok, false);
  assert.equal(dup.error.code, 'E-DUP');
  assert.equal(JSON.stringify(doc), snap);
  assert.equal(replaceEdge(doc, '없는-ID', { source: 'N-001', target: 'N-030', core_type: 'relates_to' }, ctx).ok, false);
});
