// 담당 시작·종료 이력은 수행 연결과 함께 반영된다(조력자 의견 2026-10-12: "이력 추가하면 업무랑 사람이 연결이 안 되는 듯")
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addAssignment, addNode, createUniverse } from '../app/src/model/commands.js';
import { validateDocument } from '../app/src/model/validate.js';
import { clone } from './helpers.js';

const ctx = { now: '2026-10-12T10:00:00+09:00' };
function base() {
  let d = createUniverse({ name: '담당 시험', level: '팀', owner: '가상팀' }, ctx).doc;
  const p = addNode(d, { core_type: 'person', label: '가상 갑', emp_no: 'V-0001' }, ctx);
  const w = addNode(p.doc, { core_type: 'work', label: '가상 업무' }, ctx);
  d = w.doc;
  return { d, person: p.node.id, work: w.node.id };
}
const start = (person, work, date = '2026-10-01') => ({ type: 'assign_start', occurred_at: date, payload: { person_id: person, work_id: work } });
const end = (person, work, date = '2026-10-10') => ({ type: 'assign_end', occurred_at: date, payload: { person_id: person, work_id: work } });

test('담당 시작 → 수행 연결(시작일)과 이력이 함께 생긴다', () => {
  const { d, person, work } = base();
  const snap = JSON.stringify(d);
  const r = addAssignment(d, start(person, work), ctx);
  assert.equal(r.ok, true);
  const edge = r.doc.edges.find((e) => e.core_type === 'performs');
  assert.deepEqual([edge.source, edge.target, edge.period], [person, work, { start: '2026-10-01' }]);
  assert.equal(r.event.type, 'assign_start');
  assert.equal(r.doc.events.filter((e) => e.type === 'assign_start').length, 1);
  assert.equal(validateDocument(r.doc).ok, true);
  assert.equal(JSON.stringify(d), snap);
});

test('이미 담당 중이면 거부(연결·이력 모두 그대로)', () => {
  const { d, person, work } = base();
  const a = addAssignment(d, start(person, work), ctx).doc;
  const r = addAssignment(a, start(person, work, '2026-10-05'), ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'E-DUP');
  assert.equal(r.error.already_active, true);
});

test('담당 종료 → 진행 중 연결에 끝 날짜가 채워지고 이력이 남는다', () => {
  const { d, person, work } = base();
  const a = addAssignment(d, start(person, work), ctx).doc;
  const r = addAssignment(a, end(person, work), ctx);
  assert.equal(r.ok, true);
  assert.deepEqual(r.doc.edges.find((e) => e.core_type === 'performs').period, { start: '2026-10-01', end: '2026-10-10' });
  assert.equal(r.doc.events.filter((e) => e.type === 'assign_end').length, 1);
  assert.equal(validateDocument(r.doc).ok, true);
});

test('담당 중인 연결이 없으면 종료를 거부하고, 끝 날짜가 시작보다 앞이면 거부(아무것도 바뀌지 않음)', () => {
  const { d, person, work } = base();
  const none = addAssignment(d, end(person, work), ctx);
  assert.equal(none.ok, false);
  assert.equal(none.error.no_active, true);
  const a = addAssignment(d, start(person, work, '2026-10-05'), ctx).doc;
  const before = clone(a);
  const bad = addAssignment(a, end(person, work, '2026-10-01'), ctx);
  assert.equal(bad.ok, false);
  assert.deepEqual(a, before);
});

test('종료 뒤 같은 사람이 다시 담당을 시작할 수 있다(연결이 두 기간으로)', () => {
  const { d, person, work } = base();
  let doc = addAssignment(d, start(person, work, '2026-01-01'), ctx).doc;
  doc = addAssignment(doc, end(person, work, '2026-03-31'), ctx).doc;
  const r = addAssignment(doc, start(person, work, '2026-06-01'), ctx);
  assert.equal(r.ok, true);
  assert.equal(r.doc.edges.filter((e) => e.core_type === 'performs').length, 2);
});

test('사람·업무가 아닌 노드나 빈 값은 이력 검증에서 거부되고 연결은 만들지 않는다', () => {
  const { d, person, work } = base();
  const swapped = addAssignment(d, start(work, person), ctx);
  assert.equal(swapped.ok, false);
  assert.equal(addAssignment(d, { type: 'assign_start', occurred_at: '2026-10-01', payload: { person_id: person } }, ctx).ok, false);
  assert.equal(d.edges.filter((e) => e.core_type === 'performs').length, 0);
});
