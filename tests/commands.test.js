import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addEdge, addEvent, addNode, addSubtype, createUniverse, hideEdge, hideNode, updateEdge, updateNode,
} from '../app/src/model/commands.js';
import { validateDocument } from '../app/src/model/validate.js';
import { EXAMPLE_12_6 } from './fixtures/example-12-6.js';

const ctx = { now: '2026-10-01T10:00:00+09:00' };
const doc = EXAMPLE_12_6;
const snapshot = JSON.stringify(doc);
const codeOf = (r) => r.error.code;

test('수정: 바뀐 필드만 before/after로 남고 원본은 그대로', () => {
  const r = updateNode(doc, 'N-020', { label: '2026-06 인수인계서(수정)' }, ctx);
  assert.equal(r.ok, true);
  assert.equal(r.event.type, 'updated');
  assert.deepEqual(r.event.payload, {
    target_kind: 'node', target_id: 'N-020',
    before: { label: '2026-06 인수인계서' }, after: { label: '2026-06 인수인계서(수정)' },
  });
  assert.equal(r.doc.nodes.find((n) => n.id === 'N-020').label, '2026-06 인수인계서(수정)');
  assert.equal(r.doc.nodes.find((n) => n.id === 'N-020').updated_at, ctx.now);
  assert.equal(r.doc.events.length, doc.events.length + 1);
  assert.equal(JSON.stringify(doc), snapshot);
});

test('수정: 두 번 수정하면 이벤트가 쌓이고 각 변경 전 값이 남는다', () => {
  const a = updateNode(doc, 'N-001', { description: '첫 설명' }, ctx);
  const b = updateNode(a.doc, 'N-001', { description: '둘째 설명' }, ctx);
  const updates = b.doc.events.filter((e) => e.type === 'updated');
  assert.equal(updates.length, 2);
  assert.equal(updates[0].payload.before.description, null);
  assert.equal(updates[1].payload.before.description, '첫 설명');
});

test('수정: 바뀐 것이 없으면 이벤트를 만들지 않는다', () => {
  const r = updateNode(doc, 'N-001', { label: '대사 확인' }, ctx);
  assert.equal(r.ok, true);
  assert.equal(r.event, null);
  assert.equal(r.doc, doc);
});

test('수정: 빈 값으로 필드를 지우고, 라벨을 비우면 E-REQUIRED', () => {
  const cleared = updateNode(doc, 'N-001', { attrs: null }, ctx);
  assert.equal(cleared.doc.nodes.find((n) => n.id === 'N-001').attrs, undefined);
  assert.deepEqual(cleared.event.payload.before, { attrs: { 주기: '매월' } });
  assert.equal(codeOf(updateNode(doc, 'N-001', { label: ' ' }, ctx)), 'E-REQUIRED');
});

test('수정: 다른 노드와 같아지면 E-DUP(자기 자신과는 중복 아님), 유형 변경은 거부', () => {
  assert.equal(updateNode(doc, 'N-030', { label: '대사 불일치' }, ctx).ok, true); // 자기 자신
  const withTwo = addNode(doc, { core_type: 'topic', label: '반복 이슈' }, ctx).doc;
  const r = updateNode(withTwo, withTwo.nodes.at(-1).id, { label: ' 대사 불일치 ' }, ctx);
  assert.deepEqual(r, { ok: false, error: { code: 'E-DUP', existing_id: 'N-030' } });
  assert.equal(codeOf(updateNode(doc, 'N-001', { core_type: 'topic' }, ctx)), 'E-SCHEMA');
});

test('수정: 사번을 다른 사람과 같게 바꾸면 E-DUP', () => {
  const r = updateNode(doc, 'N-010', { emp_no: 'V-1002' }, ctx);
  assert.deepEqual(r, { ok: false, error: { code: 'E-DUP', existing_id: 'N-011' } });
});

test('수정: 꼭지 이름은 바꿀 수 없다', () => {
  assert.equal(codeOf(updateNode(doc, 'N-000', { label: '다른 이름' }, ctx)), 'E-SCHEMA');
});

test('숨김: hidden 표시와 이벤트만 남고 노드·이력은 지워지지 않는다', () => {
  const r = hideNode(doc, 'N-020', ctx);
  assert.equal(r.ok, true);
  assert.equal(r.doc.nodes.length, doc.nodes.length);
  assert.equal(r.doc.nodes.find((n) => n.id === 'N-020').hidden, true);
  assert.equal(r.event.type, 'hidden');
  assert.equal(r.doc.events.length, doc.events.length + 1);
  assert.equal(hideNode(r.doc, 'N-020', ctx).event, null); // 이미 숨김
  assert.equal(doc.nodes.find((n) => n.id === 'N-020').hidden, false);
});

test('숨김: 꼭지는 숨길 수 없고, 없는 노드는 거부', () => {
  assert.equal(codeOf(hideNode(doc, 'N-000', ctx)), 'E-SCHEMA');
  assert.equal(codeOf(hideNode(doc, 'N-999', ctx)), 'E-SCHEMA');
});

test('숨긴 노드와 같은 라벨은 다시 추가할 수 있다(숨김은 중복 판정에서 제외)', () => {
  const hidden = hideNode(doc, 'N-001', ctx).doc;
  assert.equal(addNode(hidden, { core_type: 'work', label: '대사 확인' }, ctx).ok, true);
});

test('연결 추가: 정상 조합과 created 이벤트', () => {
  const r = addEdge(doc, { source: 'N-001', target: 'N-020', core_type: 'produces' }, ctx);
  assert.equal(r.ok, true);
  assert.equal(r.edge.hidden, false);
  assert.deepEqual(r.event.payload, { target_kind: 'edge', target_id: r.edge.id });
  assert.equal(r.doc.edges.length, doc.edges.length + 1);
});

test('연결 추가: 허용되지 않는 조합 → E-PAIR', () => {
  assert.equal(codeOf(addEdge(doc, { source: 'N-020', target: 'N-011', core_type: 'performs' }, ctx)), 'E-PAIR');
  assert.equal(codeOf(addEdge(doc, { source: 'N-001', target: 'N-011', core_type: 'performs' }, ctx)), 'E-PAIR');
  assert.equal(codeOf(addEdge(doc, { source: 'N-001', target: 'N-000', core_type: 'references' }, ctx)), 'E-PAIR'); // 꼭지 제외
  assert.equal(codeOf(addEdge(doc, { source: 'N-010', target: 'N-001', core_type: 'contains' }, ctx)), 'E-PAIR');
});

test('연결 추가: 필수값 누락 → E-REQUIRED, 없는 노드·모르는 관계 → E-SCHEMA', () => {
  assert.deepEqual(addEdge(doc, { source: 'N-001', core_type: 'produces' }, ctx),
    { ok: false, error: { code: 'E-REQUIRED', field: 'target' } });
  assert.equal(codeOf(addEdge(doc, { source: 'N-001', target: 'N-999', core_type: 'produces' }, ctx)), 'E-SCHEMA');
  assert.equal(codeOf(addEdge(doc, { source: 'N-001', target: 'N-020', core_type: '없는관계' }, ctx)), 'E-SCHEMA');
});

test('연결 추가: 같은 출발·도착·유형에 기간이 겹치면 E-DUP, 겹치지 않으면 허용', () => {
  const overlap = addEdge(doc, { source: 'N-011', target: 'N-001', core_type: 'performs', period: { start: '2026-08-01' } }, ctx);
  assert.deepEqual(overlap, { ok: false, error: { code: 'E-DUP', existing_id: 'L-002' } });
  // 기존 연결(2026-06-01부터 진행 중)을 끝내면, 그 뒤 기간은 겹치지 않는다
  const ended = updateEdge(doc, 'L-002', { period: { start: '2026-06-01', end: '2026-08-31' } }, ctx).doc;
  const later = { source: 'N-011', target: 'N-001', core_type: 'performs' };
  assert.equal(addEdge(ended, { ...later, period: { start: '2026-09-01' } }, ctx).ok, true);
  assert.equal(codeOf(addEdge(ended, { ...later, period: { start: '2026-08-31' } }, ctx)), 'E-DUP');
});

test('연결 추가: 잘못된 기간 → E-SCHEMA', () => {
  const bad = (period) => addEdge(doc, { source: 'N-001', target: 'N-020', core_type: 'produces', period }, ctx);
  assert.equal(codeOf(bad({ start: '2026-13-01' })), 'E-SCHEMA');
  assert.equal(codeOf(bad({ start: '2026-06-02', end: '2026-06-01' })), 'E-SCHEMA');
});

test('연결 수정·숨김: 변경 전 값과 hidden 이벤트가 남는다', () => {
  const u = updateEdge(doc, 'L-002', { note: '인수 후 담당' }, ctx);
  assert.deepEqual(u.event.payload.before, { note: null });
  assert.equal(codeOf(updateEdge(doc, 'L-002', { target: 'N-020' }, ctx)), 'E-SCHEMA');
  const h = hideEdge(u.doc, 'L-002', ctx);
  assert.equal(h.doc.edges.find((e) => e.id === 'L-002').hidden, true);
  assert.equal(h.event.payload.target_kind, 'edge');
});

test('하위 유형: 등록된 것만 쓸 수 있고 추가는 데이터만 바뀐다', () => {
  assert.equal(codeOf(addNode(doc, { core_type: 'artifact', label: '회의록 1', subtype: '회의록' }, ctx)), 'E-SUBTYPE');
  const s = addSubtype(doc, { core_type: 'artifact', name: '회의록' });
  assert.equal(s.ok, true);
  assert.equal(addNode(s.doc, { core_type: 'artifact', label: '회의록 1', subtype: '회의록' }, ctx).ok, true);
  assert.equal(codeOf(addSubtype(s.doc, { core_type: 'artifact', name: '회의록' })), 'E-DUP');
  assert.equal(codeOf(addSubtype(doc, { core_type: 'root', name: 'x' })), 'E-SCHEMA');
  assert.equal(codeOf(addSubtype(doc, { core_type: 'artifact', name: ' ' })), 'E-REQUIRED');
  // 관계에도 하위 유형을 등록할 수 있다(참조 > 검토함)
  const e = addSubtype(doc, { core_type: 'references', name: '검토함' });
  assert.equal(addEdge(e.doc, { source: 'N-020', target: 'N-001', core_type: 'references', subtype: '검토함' }, ctx).ok, true);
});

test('이벤트 추가: 메모·인수인계가 쌓이고 잘못된 입력은 거부', () => {
  const memo = addEvent(doc, {
    type: 'memo', occurred_at: '2026-09-01', payload: { target_id: 'N-001', topic_ids: ['N-030'] }, note: '대사 불일치 3건 재발',
  }, ctx);
  assert.equal(memo.ok, true);
  assert.equal(memo.event.note, '대사 불일치 3건 재발');
  assert.equal(memo.event.source, 'user');
  assert.equal(memo.event.occurred_at, '2026-09-01');
  const handover = {
    type: 'handover', occurred_at: '2026-10-01',
    payload: { work_id: 'N-001', from_person_id: 'N-011', to_person_id: 'N-010', previous_handover_id: 'E-002' },
  };
  assert.equal(addEvent(memo.doc, handover, ctx).ok, true);

  assert.equal(codeOf(addEvent(doc, { type: 'created', occurred_at: '2026-09-01', payload: {} }, ctx)), 'E-SCHEMA');
  assert.deepEqual(addEvent(doc, { type: 'memo', payload: {} }, ctx), { ok: false, error: { code: 'E-REQUIRED', field: 'occurred_at' } });
  assert.equal(codeOf(addEvent(doc, { type: 'memo', occurred_at: '2026-02-30', payload: {} }, ctx)), 'E-SCHEMA');
  assert.deepEqual(addEvent(doc, { type: 'handover', occurred_at: '2026-10-01', payload: { work_id: 'N-001' } }, ctx),
    { ok: false, error: { code: 'E-REQUIRED', field: 'from_person_id' } });
  assert.equal(codeOf(addEvent(doc, {
    type: 'assign_start', occurred_at: '2026-10-01', payload: { person_id: 'N-999', work_id: 'N-001' },
  }, ctx)), 'E-SCHEMA');
  const badPrev = { ...handover, payload: { ...handover.payload, previous_handover_id: 'E-999' } };
  assert.equal(codeOf(addEvent(doc, badPrev, ctx)), 'E-SCHEMA');
});

test('유니버스 생성: 꼭지와 생성 이벤트가 자동으로 만들어지고, 필수값이 없으면 거부', () => {
  const r = createUniverse({ name: ' 신규 행사 ', level: '업무', owner: '가상행사팀' }, ctx);
  assert.equal(r.ok, true);
  assert.match(r.doc.universe.id, /^U-[A-Z0-9]{8}$/);
  assert.equal(r.doc.nodes.length, 1);
  assert.equal(r.doc.nodes[0].core_type, 'root');
  assert.equal(r.doc.nodes[0].label, '신규 행사');
  assert.equal(r.doc.universe.root_node_id, r.doc.nodes[0].id);
  assert.equal(r.doc.events[0].type, 'created');
  assert.equal(validateDocument(r.doc).ok, true);
  assert.deepEqual(createUniverse({ name: '', level: '업무', owner: 'x' }, ctx), { ok: false, error: { code: 'E-REQUIRED', field: 'name' } });
  assert.equal(createUniverse({ name: 'x', level: '', owner: 'x' }, ctx).error.field, 'level');
  assert.equal(createUniverse({ name: 'x', level: '팀', owner: ' ' }, ctx).error.field, 'owner');
});

test('명령 결과 문서는 항상 검증을 통과한다', () => {
  let d = doc;
  d = addNode(d, { core_type: 'person', label: '서하늘', emp_no: 'V-1003' }, ctx).doc;
  d = addEdge(d, { source: d.nodes.at(-1).id, target: 'N-001', core_type: 'performs', period: { start: '2026-10-01' } }, ctx).doc;
  d = updateNode(d, 'N-001', { description: '설명' }, ctx).doc;
  d = hideNode(d, 'N-020', ctx).doc;
  d = addEvent(d, { type: 'memo', occurred_at: '2026-10-01', payload: { target_id: 'N-001' } }, ctx).doc;
  assert.deepEqual(validateDocument(d).errors, []);
});
