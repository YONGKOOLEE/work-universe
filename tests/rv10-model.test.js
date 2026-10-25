// 열 번째 검토(docs/review-2026-10-25.md) 모델 결함 수정 시험: RV10C-6·7·8·12, RV10S-5·8
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addEdge, addEvent, addNode, addSubtype, applyBatch, createUniverse, decideIdentity, updateNode } from '../app/src/model/commands.js';
import { validateDocument } from '../app/src/model/validate.js';
import { DOC_MAX_DEPTH } from '../app/src/model/schema.js';
import { SAMPLES } from '../app/data/index.js';
import { PREGEN } from '../app/data/pregen.js';
import { EXAMPLE_12_6 } from './fixtures/example-12-6.js';
import { clone, mkDoc, mkNode } from './helpers.js';

const ctx = { now: '2026-10-01T10:00:00+09:00' };
const base = () => clone(EXAMPLE_12_6);
const paths = (doc) => validateDocument(doc).errors.map((e) => e.path);

test('RV10C-6: 정상 문서(내장 샘플·예제)는 새 규칙으로도 통과한다', () => {
  for (const d of [...SAMPLES, EXAMPLE_12_6]) assert.equal(validateDocument(d).ok, true, d.universe.id);
  assert.ok(PREGEN);
});

test('RV10C-6: 가져오기 검증도 자기 자신 연결을 거부한다', () => {
  const d = base();
  const w = d.nodes.find((n) => n.core_type === 'work');
  d.edges.push({ id: 'L-SELF', source: w.id, target: w.id, core_type: 'precedes', hidden: false, created_at: ctx.now });
  assert.ok(paths(d).includes(`edges[${d.edges.length - 1}].target`));
});

test('RV10C-6: 보내는 사람과 받는 사람이 같은 인수인계를 거부한다', () => {
  const d = base();
  const person = d.nodes.find((n) => n.core_type === 'person');
  const work = d.nodes.find((n) => n.core_type === 'work');
  d.events.push({ id: 'E-SAME', type: 'handover', occurred_at: '2026-09-01', recorded_at: ctx.now, source: 'user',
    payload: { work_id: work.id, from_person_id: person.id, to_person_id: person.id } });
  assert.ok(paths(d).includes(`events[${d.events.length - 1}].payload.to_person_id`));
});

test('RV10C-6: 같은 노드끼리 잇는 동일성 연결(a=b)을 거부한다', () => {
  const d = base();
  d.identity_links.push({ id: 'I-SAME', a: 'U-X/N-1', b: 'U-X/N-1', kind: 'person', method: 'human', status: 'pending' });
  assert.ok(paths(d).includes(`identity_links[${d.identity_links.length - 1}].b`));
});

test('RV10C-6: 하위 유형을 꼭지(root)에 등록한 문서를 거부한다', () => {
  const d = base();
  d.universe.subtypes = [...(d.universe.subtypes || []), { core_type: 'root', name: '꼭지유형' }];
  assert.ok(paths(d).includes(`universe.subtypes[${d.universe.subtypes.length - 1}]`));
  assert.equal(addSubtype(base(), { core_type: 'root', name: '꼭지유형' }).ok, false);
});

test('RV10C-7: 태그에 숫자가 있으면 명령도 거부한다(가져오기와 같은 규칙)', () => {
  const r = addNode(base(), { core_type: 'work', label: '태그 시험', tags: [1, 2] }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.field, 'tags');
  assert.equal(createUniverse({ name: 'a', level: 'b', owner: 'c', tags: [7] }, ctx).ok, false);
});

test('RV10C-7: 속성 값이 NaN·Infinity이면 명령이 거부한다', () => {
  for (const v of [NaN, Infinity]) {
    const r = addNode(base(), { core_type: 'work', label: '속성 시험', attrs: { 값: v } }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.error.field, 'attrs');
  }
  const d = base();
  d.nodes[1] = { ...d.nodes[1], attrs: { 값: NaN } };
  assert.ok(paths(d).includes('nodes[1].attrs'));
});

test('RV10C-7: 이력 payload 안의 너무 긴 글을 명령이 거부한다', () => {
  const d = base();
  const person = d.nodes.find((n) => n.core_type === 'person');
  const r = addEvent(d, { type: 'memo', occurred_at: '2026-09-01', payload: { text: 'x'.repeat(2001), target_id: person.id } }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'E-SCHEMA');
});

test('RV10C-8: previous_handover_id가 글자가 아니면 예외 대신 오류를 돌려준다', () => {
  const d = base();
  const work = d.nodes.find((n) => n.core_type === 'work');
  const [p1, p2] = d.nodes.filter((n) => n.core_type === 'person');
  for (const bad of [123, {}, [], true]) {
    const r = addEvent(d, { type: 'handover', occurred_at: '2026-09-01', payload: { work_id: work.id, from_person_id: p1.id, to_person_id: p2.id, previous_handover_id: bad } }, ctx);
    assert.equal(r.ok, false);
    assert.equal(r.error.field, 'previous_handover_id');
  }
});

test('RV10C-12: 담당 시작(끝 날짜 포함)의 종료 이력이 events에 들어간다', () => {
  const d = base();
  const person = d.nodes.find((n) => n.core_type === 'person');
  const work = d.nodes.find((n) => n.core_type === 'work');
  const r = applyBatch(d, [{ op: 'assign', input: { person_id: person.id, work_id: work.id, occurred_at: '2026-01-01', end_date: '2026-02-01' } }], ctx);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const added = r.doc.events.slice(d.events.length);
  assert.deepEqual(r.events.map((e) => e.id), added.map((e) => e.id));
});

test('RV10C-12: updateNode 오류는 화면 행(shown_row) 번호로 보고한다', () => {
  const d = base();
  const r = applyBatch(d, [{ op: 'updateNode', row: 1, shown_row: 7, id: 'N-없음', changes: { label: 'x' } }], ctx);
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].row, 7);
});

test('RV10S-5: 너무 깊게 중첩된 문서를 검증에서 거부한다', () => {
  const d = base();
  let deep = {};
  const top = deep;
  for (let i = 0; i < 200000; i += 1) { deep.a = {}; deep = deep.a; }
  d.events.push({ id: 'E-DEEP', type: 'memo', occurred_at: '2026-09-01', payload: { x: top } });
  const r = validateDocument(d);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.too_deep === DOC_MAX_DEPTH));
});

test('RV10S-5: 정상 문서는 깊이 상한에 걸리지 않는다', () => {
  assert.equal(validateDocument(base()).errors.some((e) => e.too_deep), false);
});

test('RV10S-8: __proto__·constructor·prototype ID를 검증이 거부한다', () => {
  for (const bad of ['__proto__', 'constructor', 'prototype']) {
    const d = base();
    d.nodes.push(mkNode(bad, 'work', `이름-${bad}`));
    assert.ok(paths(d).includes(`nodes[${d.nodes.length - 1}].id`), bad);
  }
});

test('RV10S-8: 속성 키 __proto__를 검증과 명령이 거부한다', () => {
  const attrs = JSON.parse('{"__proto__": "x"}');
  const d = mkDoc('U-T', [mkNode('N-1', 'work', '업무', { attrs })], []);
  assert.ok(paths(d).includes('nodes[1].attrs'));
  const r = addNode(base(), { core_type: 'work', label: '키 시험', attrs: JSON.parse('{"constructor": "x"}') }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.field, 'attrs');
  assert.equal(updateNode(base(), 'N-001', { attrs: JSON.parse('{"prototype": "x"}') }, ctx).ok, false);
});

test('RV10S-8: 연결 추가 명령에는 영향이 없다(회귀)', () => {
  const d = base();
  const p = d.nodes.find((n) => n.core_type === 'person');
  assert.equal(addEdge(d, { source: p.id, target: p.id, core_type: 'references' }, ctx).ok, false);
  assert.equal(decideIdentity(d, { a: 'U/N-1', b: 'U/N-1', kind: 'person', status: 'pending' }, ctx).ok, false);
});
