// T-25 (R-21 ①, D-23) 숨긴 노드 되살리기: model 명령, app 저장, 뷰 복원, 이력 문장, 숨긴 노드 목록
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addNode, hideNode, restoreNode } from '../app/src/model/commands.js';
import { createApp } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import { validateDocument } from '../app/src/model/validate.js';
import { buildView } from '../app/src/view/view.js';
import { describeNode, eventText } from '../app/src/view/describe.js';
import { hiddenNodesOf } from '../app/src/rules/hidden.js';
import { SAMPLES } from '../app/data/index.js';
import { EXAMPLE_12_6 } from './fixtures/example-12-6.js';
import { clone, deepFreeze } from './helpers.js';

const ctx = { now: '2026-10-01T10:00:00+09:00' };
const ctx2 = { now: '2026-10-02T10:00:00+09:00' };
const doc = deepFreeze(clone(EXAMPLE_12_6));
const codeOf = (r) => r.error.code;

test('되살리기: hidden이 false가 되고 이벤트는 updated(before hidden true, after hidden false)', () => {
  const hidden = hideNode(doc, 'N-020', ctx).doc;
  const r = restoreNode(hidden, 'N-020', ctx2);
  assert.equal(r.ok, true);
  assert.equal(r.doc.nodes.find((n) => n.id === 'N-020').hidden, false);
  assert.equal(r.node.updated_at, ctx2.now);
  assert.equal(r.event.type, 'updated');
  assert.deepEqual(r.event.payload, { target_kind: 'node', target_id: 'N-020', before: { hidden: true }, after: { hidden: false } });
  assert.equal(r.event.source, 'user');
  assert.equal(r.doc.events.length, hidden.events.length + 1);
  assert.equal(r.doc.nodes.length, doc.nodes.length);
  assert.equal(validateDocument(r.doc).ok, true);
});

test('되살리기: 원본 문서를 바꾸지 않는다(동결된 문서에서도 동작)', () => {
  const hidden = deepFreeze(clone(hideNode(doc, 'N-020', ctx).doc));
  const before = JSON.stringify(hidden);
  const r = restoreNode(hidden, 'N-020', ctx2);
  assert.equal(r.ok, true);
  assert.equal(JSON.stringify(hidden), before);
  assert.equal(hidden.nodes.find((n) => n.id === 'N-020').hidden, true);
});

test('되살리기: 이미 보이는 노드는 문서 그대로, event는 null', () => {
  const r = restoreNode(doc, 'N-020', ctx);
  assert.equal(r.ok, true);
  assert.equal(r.event, null);
  assert.equal(r.doc, doc);
});

test('되살리기: 꼭지·없는 노드는 거부(E-SCHEMA)', () => {
  assert.equal(codeOf(restoreNode(doc, 'N-000', ctx)), 'E-SCHEMA');
  assert.equal(codeOf(restoreNode(doc, 'N-999', ctx)), 'E-SCHEMA');
});

test('되살리기: 같은 유형·이름의 보이는 노드가 이미 있으면 E-DUP(existing_id)로 거부하고 문서는 그대로', () => {
  const hidden = hideNode(doc, 'N-001', ctx).doc;
  const label = hidden.nodes.find((n) => n.id === 'N-001');
  const again = addNode(hidden, { core_type: label.core_type, label: label.label }, ctx2);
  assert.equal(again.ok, true);
  const r = restoreNode(again.doc, 'N-001', ctx2);
  assert.deepEqual(r, { ok: false, error: { code: 'E-DUP', existing_id: again.node.id } });
  assert.equal(again.doc.nodes.find((n) => n.id === 'N-001').hidden, true);
});

test('되살리기: 숨김 → 되살림 → 다시 숨김이 되풀이되고 이력이 쌓인다', () => {
  let d = hideNode(doc, 'N-020', ctx).doc;
  d = restoreNode(d, 'N-020', ctx2).doc;
  const again = hideNode(d, 'N-020', { now: '2026-10-03T10:00:00+09:00' });
  assert.equal(again.ok, true);
  assert.equal(again.event.type, 'hidden');
  assert.deepEqual(d.events.slice(-2).map((e) => e.type), ['hidden', 'updated']);
});

test('뷰: 숨기면 노드와 그 연결이 빠지고, 되살리면 연결·이력이 숨기기 전 그대로 보인다', () => {
  const sample = SAMPLES[0];
  // 연결이 가장 많은 보이는 노드(꼭지 제외)를 고른다
  const v0 = buildView(sample, () => null);
  const target = v0.nodes.filter((n) => n.core_type !== 'root' && !n.hidden).map((n) => ({ n, c: v0.neighbors(n.gid).length })).sort((a, b) => b.c - a.c)[0].n;
  assert.ok(target && v0.neighbors(target.gid).length >= 2);
  const hidden = hideNode(sample, target.id, ctx).doc;
  const vh = buildView(hidden, () => null);
  assert.equal(vh.visible().nodes.some((n) => n.gid === target.gid), false);
  assert.ok(vh.visible().edges.length < v0.visible().edges.length);
  const back = restoreNode(hidden, target.id, ctx2).doc;
  const v1 = buildView(back, () => null);
  const ids = (v) => v.visible().edges.map((e) => e.gid).sort();
  assert.deepEqual(ids(v1), ids(v0)); // 연결이 숨기기 전과 같다
  assert.equal(v1.visible().nodes.length, v0.visible().nodes.length);
  assert.equal(v1.neighbors(target.gid).length, v0.neighbors(target.gid).length);
  // 이력: 원래 이력 + 숨김 + 되살림
  const hist = (v) => describeNode(v, target.gid, { asOf: '2026-10-05' }).history;
  assert.equal(hist(v1).length, hist(v0).length + 2);
  assert.ok(hist(v1).some((h) => h.text === '되살림(숨김 해제)'));
});

test('이력 문장: updated의 hidden true → false는 「되살림」, 다른 필드와 함께 바뀌면 일반 수정 문장', () => {
  const v = buildView(doc, () => null);
  const ev = (before, after) => ({ type: 'updated', payload: { target_kind: 'node', target_id: 'N-020', before, after } });
  assert.equal(eventText(v, ev({ hidden: true }, { hidden: false })), '되살림(숨김 해제)');
  assert.match(eventText(v, ev({ label: '가', hidden: true }, { label: '나', hidden: false })), /^수정 — /);
  assert.match(eventText(v, ev({ label: '가' }, { label: '나' })), /^수정 — /);
});

test('숨긴 노드 목록: 꼭지 제외, 최근에 숨긴 것이 위, 숨긴 날짜 표시, 되살리면 목록에서 빠진다', () => {
  assert.deepEqual(hiddenNodesOf(doc), []);
  let d = hideNode(doc, 'N-001', { now: '2026-10-01T10:00:00+09:00', occurred_at: '2026-10-01' }).doc;
  d = hideNode(d, 'N-020', { now: '2026-10-02T10:00:00+09:00', occurred_at: '2026-10-02' }).doc;
  const list = hiddenNodesOf(d);
  assert.deepEqual(list.map((n) => n.id), ['N-020', 'N-001']);
  assert.deepEqual(list.map((n) => n.hidden_at), ['2026-10-02', '2026-10-01']);
  assert.ok(list.every((n) => n.type_label && n.label));
  assert.deepEqual(hiddenNodesOf(restoreNode(d, 'N-020', ctx2).doc).map((n) => n.id), ['N-001']);
  // 다시 숨기면 가장 늦은 숨김의 날짜
  const re = hideNode(restoreNode(d, 'N-020', ctx2).doc, 'N-020', { now: '2026-10-09T10:00:00+09:00', occurred_at: '2026-10-09' }).doc;
  assert.equal(hiddenNodesOf(re)[0].hidden_at, '2026-10-09');
});

// ── app: 저장 1회, 저장 실패, 읽기 전용 ──
function memoryStorage(failWrites = () => false) {
  const m = new Map();
  const log = [];
  return {
    log,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      if (failWrites(k)) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError', code: 22 });
      log.push(k);
      m.set(k, String(v));
    },
    removeItem: (k) => m.delete(k),
  };
}
const open = (storage) => createApp({ store: createStore(storage), samples: SAMPLES, currentId: SAMPLES[0].universe.id, now: () => '2026-10-04T09:00:00+09:00' });

test('app.restoreNode: 숨김 → 되살림이 저장되고 다시 열어도 보인다. 저장은 문서 1회', () => {
  const storage = memoryStorage();
  const app = open(storage);
  const node = app.doc.nodes.find((n) => n.core_type !== 'root');
  assert.equal(app.hideNode(node.id).ok, true);
  assert.equal(app.view.getNode(`${app.doc.universe.id}/${node.id}`).hidden, true);
  const writesBefore = storage.log.filter((k) => k.startsWith('wu:v1:u:')).length;
  const r = app.restoreNode(node.id);
  assert.equal(r.ok, true);
  assert.equal(storage.log.filter((k) => k.startsWith('wu:v1:u:')).length, writesBefore + 1);
  assert.equal(open(storage).doc.nodes.find((n) => n.id === node.id).hidden, false);
  assert.equal(open(storage).doc.events.at(-1).payload.after.hidden, false);
});

test('app.restoreNode: 저장 실패(W-STORAGE)면 화면 상태를 바꾸지 않는다', () => {
  let fail = false;
  const storage = memoryStorage((k) => fail && k.startsWith('wu:v1:u:'));
  const app = open(storage);
  const node = app.doc.nodes.find((n) => n.core_type !== 'root');
  app.hideNode(node.id);
  fail = true;
  const eventsBefore = app.doc.events.length;
  const r = app.restoreNode(node.id);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'W-STORAGE');
  assert.equal(app.doc.nodes.find((n) => n.id === node.id).hidden, true);
  assert.equal(app.doc.events.length, eventsBefore);
});

test('app.restoreNode: 저장소를 쓸 수 없으면(읽기 전용) 거부', () => {
  const app = createApp({ store: null, samples: SAMPLES, currentId: SAMPLES[0].universe.id, now: () => '2026-10-04T09:00:00+09:00' });
  const r = app.restoreNode(app.doc.nodes.find((n) => n.core_type !== 'root').id);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'W-STORAGE');
});
