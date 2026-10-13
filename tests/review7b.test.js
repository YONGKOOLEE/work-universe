// 일곱 번째 검토 후속 결정 R7-6(담당 시작의 끝 날짜)·V-1(같은 초 해결 표시)·V-2(해결 메모의 대상 일치)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, laterThan } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import { SAMPLES } from '../app/data/index.js';
import { addAssignment, addEvent, addNode, createUniverse } from '../app/src/model/commands.js';
import { validateDocument } from '../app/src/model/validate.js';
import { openMemos } from '../app/src/rules/issues.js';
import { buildView } from '../app/src/view/view.js';
import { messageFor } from '../app/src/ui/messages.js';

const ctx = { now: '2026-10-13T09:00:00+09:00' };
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

// ── R7-6 담당 시작의 끝 날짜 ──
function base() {
  let d = createUniverse({ name: '소급 시험', level: '팀', owner: '가상팀' }, ctx).doc;
  const p = addNode(d, { core_type: 'person', label: '가상 갑', emp_no: 'V-0001' }, ctx);
  const w = addNode(p.doc, { core_type: 'work', label: '가상 업무' }, ctx);
  return { d: w.doc, person: p.node.id, work: w.node.id };
}
const start = (person, work, date, end_date) => ({
  type: 'assign_start', occurred_at: date, payload: { person_id: person, work_id: work }, ...(end_date !== undefined ? { end_date } : {}),
});
const performs = (doc) => doc.edges.filter((e) => e.core_type === 'performs');

test('R7-6 끝 날짜가 있으면 지난 기간 연결과 시작·종료 이력 2건이 한 묶음으로 생긴다', () => {
  const { d, person, work } = base();
  const snap = JSON.stringify(d);
  const r = addAssignment(d, start(person, work, '2026-03-01', '2026-06-30'), ctx);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(performs(r.doc).map((e) => e.period), [{ start: '2026-03-01', end: '2026-06-30' }]);
  const evs = r.doc.events.filter((e) => e.type === 'assign_start' || e.type === 'assign_end');
  assert.deepEqual(evs.map((e) => [e.type, e.occurred_at]), [['assign_start', '2026-03-01'], ['assign_end', '2026-06-30']]);
  assert.equal(r.event.type, 'assign_start');
  assert.equal(r.endEvent.type, 'assign_end');
  assert.equal(validateDocument(r.doc).ok, true);
  assert.equal(JSON.stringify(d), snap, '원본 문서는 그대로');
  // 이력 순서(뷰 기준): 시작이 종료보다 앞
  const order = buildView(r.doc, () => null).events.filter((e) => e.type.startsWith('assign_')).map((e) => e.type);
  assert.deepEqual(order, ['assign_start', 'assign_end']);
});

test('R7-6 끝 날짜가 시작보다 앞이면 거부하고 문서는 그대로, 같은 날은 허용', () => {
  const { d, person, work } = base();
  const r = addAssignment(d, start(person, work, '2026-06-30', '2026-03-01'), ctx);
  assert.equal(r.ok, false);
  assert.deepEqual([r.error.code, r.error.field], ['E-SCHEMA', 'end_date']);
  assert.ok(messageFor(r.error, { kind: 'event' }).includes('끝 날짜'));
  assert.equal(addAssignment(d, start(person, work, '2026-06-30', '2026-13-45'), ctx).ok, false, '날짜 형식 오류');
  assert.equal(addAssignment(d, start(person, work, '2026-06-30', '2026-06-30'), ctx).ok, true);
});

test('R7-6 이미 있는 기간과 겹치면 period_overlap으로 거부하고 문서는 그대로, 겹치지 않으면 성공', () => {
  const { d, person, work } = base();
  const a = addAssignment(d, start(person, work, '2026-07-01'), ctx).doc; // 끝 없는 연결
  const before = JSON.stringify(a);
  const overlap = addAssignment(a, start(person, work, '2026-03-01', '2026-07-15'), ctx);
  assert.equal(overlap.ok, false);
  assert.equal(overlap.error.code, 'E-DUP');
  assert.equal(overlap.error.period_overlap, true);
  assert.ok(messageFor(overlap.error, { kind: 'event' }).includes('겹칩니다'));
  const inside = addAssignment(a, start(person, work, '2026-08-01', '2026-09-01'), ctx);
  assert.equal(inside.error.period_overlap, true);
  assert.equal(JSON.stringify(a), before);
  const ok = addAssignment(a, start(person, work, '2026-01-01', '2026-06-30'), ctx);
  assert.equal(ok.ok, true, JSON.stringify(ok.error));
  assert.equal(performs(ok.doc).length, 2);
  assert.equal(ok.doc.events.filter((e) => e.type === 'assign_end').length, 1);
  assert.equal(validateDocument(ok.doc).ok, true);
  // 끝난 기간과도 겹치면 거부
  const again = addAssignment(ok.doc, start(person, work, '2026-02-01', '2026-03-01'), ctx);
  assert.equal(again.error.period_overlap, true);
});

test('R7-6 끝 날짜가 없으면 지금과 같다(끝 없는 연결, 이력 1건, 이미 담당 중이면 already_active)', () => {
  const { d, person, work } = base();
  for (const e of [undefined, '']) {
    const r = addAssignment(d, start(person, work, '2026-10-01', e), ctx);
    assert.equal(r.ok, true);
    assert.deepEqual(performs(r.doc).map((x) => x.period), [{ start: '2026-10-01' }]);
    assert.equal(r.doc.events.filter((x) => x.type.startsWith('assign_')).length, 1);
    assert.equal(r.endEvent, undefined);
    assert.equal(addAssignment(r.doc, start(person, work, '2026-10-05'), ctx).error.already_active, true);
  }
});

test('R7-6 앱 저장: 끝 날짜 입력은 한 번에 저장되고 새로 열어도 같다', () => {
  const storage = memoryStorage();
  const mk = (id) => createApp({ store: createStore(storage), samples: SAMPLES, currentId: id, now: () => ctx.now });
  const app = mk(undefined);
  const { d, person, work } = base();
  app.importUniverse(d);
  const app2 = mk(d.universe.id);
  const r = app2.addEvent(start(person, work, '2026-03-01', '2026-06-30'));
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const again = mk(d.universe.id);
  assert.equal(performs(again.doc).length, 1);
  assert.equal(again.doc.events.filter((e) => e.type.startsWith('assign_')).length, 2);
});

// ── V-1 같은 초 해결 표시 ──
function memoApp(recordedAt, nowStr = recordedAt) {
  let d = createUniverse({ name: 'V1', level: '팀', owner: '가상팀' }, ctx).doc;
  const w = addNode(d, { core_type: 'work', label: '가상 대사' }, ctx);
  d = addEvent(w.doc, { type: 'memo', occurred_at: '2026-10-13', payload: { category: 'issue', target_id: w.node.id }, note: '문제' }, { now: recordedAt }).doc;
  const storage = memoryStorage();
  createApp({ store: createStore(storage), samples: SAMPLES, now: () => nowStr }).importUniverse(d);
  return { app: createApp({ store: createStore(storage), samples: SAMPLES, currentId: d.universe.id, now: () => nowStr }), work: w.node.id };
}

test('V-1 같은 초에 쓴 메모도 「해결로 표시」로 40번 모두 닫힌다(ID 무작위여도)', () => {
  for (let i = 0; i < 40; i += 1) {
    const { app } = memoApp('2026-10-13T09:00:00+09:00');
    const target = openMemos(app.view)[0];
    const r = app.resolveMemo(target.gid, '2026-10-13');
    assert.equal(r.ok, true, `${i}회: ${JSON.stringify(r.error)}`);
    assert.equal(openMemos(app.view).length, 0, `${i}회`);
    const res = app.doc.events.filter((e) => e.type === 'memo').at(-1);
    assert.ok(Date.parse(res.recorded_at) >= Date.parse(target.recorded_at) + 1000, `${i}회: 해결 메모가 최소 1초 뒤`);
  }
});

test('V-1 원래 메모가 미래 시각(다른 PC 시계)이어도 닫히고 저장된 시각은 1초 뒤', () => {
  const { app } = memoApp('2026-10-13T18:00:00+09:00', '2026-10-13T09:00:00+09:00');
  const target = openMemos(app.view)[0];
  const r = app.resolveMemo(target.gid, '2026-10-13');
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(openMemos(app.view).length, 0);
  assert.equal(app.doc.events.filter((e) => e.type === 'memo').at(-1).recorded_at, '2026-10-13T18:00:01+09:00');
  assert.equal(validateDocument(app.doc).ok, true);
});

test('V-1 laterThan: 이미 뒤면 그대로, 아니면 +1초(시간대 표기 유지), 읽을 수 없으면 그대로', () => {
  assert.equal(laterThan('2026-10-13T09:00:05+09:00', '2026-10-13T09:00:00+09:00'), '2026-10-13T09:00:05+09:00');
  assert.equal(laterThan('2026-10-13T09:00:00+09:00', '2026-10-13T09:00:00+09:00'), '2026-10-13T09:00:01+09:00');
  assert.equal(laterThan('2026-10-13T09:00:00+09:00', '2026-10-13T09:00:00.500+09:00'), '2026-10-13T09:00:01+09:00');
  assert.equal(laterThan('2026-10-13T09:00:00+09:00', '2026-10-13T23:59:59+09:00'), '2026-10-14T00:00:00+09:00');
  assert.equal(laterThan('2026-10-13T09:00:00Z', '2026-10-13T09:00:00Z'), '2026-10-13T09:00:01Z');
  assert.equal(laterThan('2026-10-13T09:00:00-05:00', '2026-10-13T09:00:00-05:00'), '2026-10-13T09:00:01-05:00');
  assert.equal(laterThan('2026-10-13T09:00:00+09:00', '이상한 값'), '2026-10-13T09:00:00+09:00');
  assert.equal(laterThan('2026-10-13T09:00:00+09:00', undefined), '2026-10-13T09:00:00+09:00');
});

test('V-1 not_closed 문구는 시계 하나만 원인으로 짚지 않는다', () => {
  const m = messageFor({ code: 'E-SCHEMA', field: 'event', not_closed: true });
  assert.ok(m.includes('닫지 못했습니다') && m.includes('아무것도 저장하지 않았습니다'));
  assert.ok(m.includes('가려졌을 수'), m);
});

// ── V-2 해결 메모의 대상·주제 일치 ──
test('V-2 resolves_id가 가리키는 메모와 대상·주제가 다른 해결 메모는 거부, 같으면 통과', () => {
  let d = createUniverse({ name: 'V2', level: '팀', owner: '가상팀' }, ctx).doc;
  const w1 = addNode(d, { core_type: 'work', label: '가상 업무 하나' }, ctx);
  const w2 = addNode(w1.doc, { core_type: 'work', label: '가상 업무 둘' }, ctx);
  const t1 = addNode(w2.doc, { core_type: 'topic', label: '가상 주제 하나' }, ctx);
  const t2 = addNode(t1.doc, { core_type: 'topic', label: '가상 주제 둘' }, ctx);
  const first = addEvent(t2.doc, { type: 'memo', occurred_at: '2026-10-12', payload: { category: 'issue', target_id: w1.node.id, topic_ids: [t1.node.id] }, note: '문제' }, ctx);
  const hidden = { ...first.doc, nodes: first.doc.nodes.map((n) => (n.id === w1.node.id ? { ...n, hidden: true } : n)) };
  const resolve = (payload, doc = hidden) => addEvent(doc, { type: 'memo', occurred_at: '2026-10-13', payload: { category: 'resolved', resolves_id: first.event.id, ...payload }, note: '해결' }, ctx);
  const same = { target_id: w1.node.id, topic_ids: [t1.node.id] };
  assert.equal(resolve(same).ok, true, '숨긴 대상이어도 같은 대상·주제면 통과');
  const otherTarget = resolve({ ...same, target_id: w2.node.id });
  assert.deepEqual([otherTarget.ok, otherTarget.error.field, otherTarget.error.mismatch], [false, 'resolves_id', true]);
  assert.equal(resolve({ ...same, target_id: w2.node.id }, first.doc).ok, false, '숨기지 않은 경우도 다른 대상은 거부');
  assert.equal(resolve({ target_id: w1.node.id, topic_ids: [t2.node.id] }).ok, false, '다른 주제');
  assert.equal(resolve({ target_id: w1.node.id }).ok, false, '주제 빠짐');
  assert.equal(resolve({ topic_ids: [t1.node.id] }).ok, false, '대상 빠짐');
  assert.ok(messageFor(otherTarget.error, { kind: 'event' }).includes('다릅니다'));
});

// 재검증(나 묶음) 3: 끝 날짜는 지난 기간용 — 오늘보다 뒤면 거부, 문서는 그대로
test('R7-6: 끝 날짜가 오늘(ctx.now)보다 뒤면 거부하고 문서를 바꾸지 않는다', async () => {
  const { addAssignment, addNode, createUniverse } = await import('../app/src/model/commands.js');
  const c = { now: '2026-10-13T10:00:00+09:00' };
  let d = createUniverse({ name: '미래 끝', level: '팀', owner: '가상팀' }, c).doc;
  const p = addNode(d, { core_type: 'person', label: '가상 을', emp_no: 'V-0002' }, c); d = p.doc;
  const w = addNode(d, { core_type: 'work', label: '가상 일' }, c); d = w.doc;
  const r = addAssignment(d, { type: 'assign_start', occurred_at: '2026-10-01', end_date: '2026-10-20', payload: { person_id: p.node.id, work_id: w.node.id } }, c);
  assert.equal(r.ok, false);
  assert.equal(r.error.future, true);
  const ok = addAssignment(d, { type: 'assign_start', occurred_at: '2026-10-01', end_date: '2026-10-13', payload: { person_id: p.node.id, work_id: w.node.id } }, c);
  assert.equal(ok.ok, true, '오늘까지는 허용');
});
