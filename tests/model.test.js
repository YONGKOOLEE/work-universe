import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addNode, newId } from '../app/src/model/commands.js';
import { SAMPLE_T01 } from '../app/data/sample-t01.js';

const ctx = { now: '2026-10-01T10:00:00+09:00' };

test('샘플은 노드 3개·연결 2개, 12.2 필수 키를 가진다', () => {
  assert.equal(SAMPLE_T01.schema_version, '1.0');
  for (const k of ['universe', 'nodes', 'edges', 'events', 'refs', 'identity_links']) assert.ok(k in SAMPLE_T01, k);
  assert.equal(SAMPLE_T01.nodes.length, 3);
  assert.equal(SAMPLE_T01.edges.length, 2);
  const root = SAMPLE_T01.nodes.find((n) => n.id === SAMPLE_T01.universe.root_node_id);
  assert.equal(root.core_type, 'root');
  for (const n of SAMPLE_T01.nodes) if (n.emp_no) assert.match(n.emp_no, /^V-\d{4}$/);
});

test('새 ID는 접두어 + 영숫자 8자리', () => {
  assert.match(newId('N-'), /^N-[A-Z0-9]{8}$/);
});

test('노드 추가: 새 문서와 created 이벤트, 원본 불변', () => {
  const r = addNode(SAMPLE_T01, { core_type: 'artifact', label: '점검표 양식' }, ctx);
  assert.equal(r.ok, true);
  assert.equal(r.doc.nodes.length, 4);
  assert.equal(SAMPLE_T01.nodes.length, 3);
  assert.equal(r.event.type, 'created');
  assert.deepEqual(r.event.payload, { target_kind: 'node', target_id: r.node.id });
  assert.equal(r.event.occurred_at, '2026-10-01');
  assert.equal(r.node.hidden, false);
});

test('라벨 누락 → E-REQUIRED', () => {
  const r = addNode(SAMPLE_T01, { core_type: 'work', label: '   ' }, ctx);
  assert.deepEqual(r, { ok: false, error: { code: 'E-REQUIRED', field: 'label' } });
});

test('같은 유형 + 정규화 라벨 → E-DUP과 기존 노드 ID', () => {
  const r = addNode(SAMPLE_T01, { core_type: 'work', label: ' 대사 확인 ' }, ctx);
  assert.deepEqual(r, { ok: false, error: { code: 'E-DUP', existing_id: 'N-001' } });
});

test('같은 사번 → E-DUP', () => {
  const r = addNode(SAMPLE_T01, { core_type: 'person', label: '다른 이름', emp_no: 'V-1002' }, ctx);
  assert.equal(r.error.code, 'E-DUP');
});

test('사번 없는 사람은 저장하고 W-NO-EMPNO 경고', () => {
  const r = addNode(SAMPLE_T01, { core_type: 'person', label: '서하늘' }, ctx);
  assert.equal(r.ok, true);
  assert.equal(r.warnings[0].code, 'W-NO-EMPNO');
});

test('미등록 하위 유형 → E-SUBTYPE, 꼭지 추가 → E-SCHEMA', () => {
  assert.equal(addNode(SAMPLE_T01, { core_type: 'artifact', label: 'x', subtype: '없음' }, ctx).error.code, 'E-SUBTYPE');
  assert.equal(addNode(SAMPLE_T01, { core_type: 'root', label: 'x' }, ctx).error.code, 'E-SCHEMA');
});
