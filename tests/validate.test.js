import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDocument } from '../app/src/model/validate.js';
import { nodeTypeLabel } from '../app/src/model/schema.js';
import { SAMPLE_T01 } from '../app/data/sample-t01.js';
import { EXAMPLE_12_6 } from './fixtures/example-12-6.js';

const clone = (d) => JSON.parse(JSON.stringify(d));
const codes = (r) => r.errors.map((e) => e.code);

test('12.6 예시 JSON을 불러와 검증을 통과한다', () => {
  const r = validateDocument(EXAMPLE_12_6);
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings, []);
});

test('T-01 샘플도 통과한다', () => {
  assert.equal(validateDocument(SAMPLE_T01).ok, true);
});

test('스키마 버전이 다르면 E-SCHEMA이고 읽기 전용으로 열도록 알린다', () => {
  const d = clone(EXAMPLE_12_6);
  d.schema_version = '2.0';
  const r = validateDocument(d);
  assert.deepEqual(codes(r), ['E-SCHEMA']);
  assert.equal(r.readOnly, true);
});

test('형식이 깨진 문서는 E-SCHEMA', () => {
  assert.deepEqual(codes(validateDocument(null)), ['E-SCHEMA']);
  const d = clone(EXAMPLE_12_6);
  delete d.edges;
  assert.ok(codes(validateDocument(d)).includes('E-SCHEMA'));
});

test('필수값 누락 → E-REQUIRED (유니버스·노드·연결·이벤트)', () => {
  const d = clone(EXAMPLE_12_6);
  d.universe.owner = '';
  d.nodes[2].label = '  ';
  delete d.edges[0].target;
  delete d.events[0].occurred_at;
  const paths = validateDocument(d).errors.filter((e) => e.code === 'E-REQUIRED').map((e) => e.path);
  assert.ok(paths.includes('universe.owner'));
  assert.ok(paths.includes('nodes[2].label'));
  assert.ok(paths.includes('edges[0].target'));
  assert.ok(paths.includes('events[0].occurred_at'));
});

test('중복 → E-DUP (사번, 유형+라벨, 겹치는 연결, 노드·이벤트 ID)', () => {
  const d = clone(EXAMPLE_12_6);
  d.nodes.push({ id: 'N-012', core_type: 'person', label: '다른 이름', emp_no: 'V-1002', hidden: false });
  d.nodes.push({ id: 'N-031', core_type: 'work', label: ' 대사 확인 ', hidden: false });
  d.edges.push({ id: 'L-009', source: 'N-011', target: 'N-001', core_type: 'performs', period: { start: '2026-07-01' }, hidden: false });
  d.nodes.push({ id: 'N-001', core_type: 'topic', label: 'ID 중복', hidden: false });
  d.events.push({ ...d.events[0] });
  const dups = validateDocument(d).errors.filter((e) => e.code === 'E-DUP');
  assert.deepEqual(dups.find((e) => e.path === 'nodes[6]'), { code: 'E-DUP', path: 'nodes[6]', existing_id: 'N-011' });
  assert.equal(dups.find((e) => e.path === 'nodes[7]').existing_id, 'N-001');
  assert.equal(dups.find((e) => e.path === 'edges[3]').existing_id, 'L-002');
  assert.ok(dups.some((e) => e.path === 'nodes[8].id'));
  assert.ok(dups.some((e) => e.path === 'events[2].id'));
});

test('숨긴 노드는 중복 판정에서 제외한다', () => {
  const d = clone(EXAMPLE_12_6);
  d.nodes[1].hidden = true;
  d.nodes.push({ id: 'N-031', core_type: 'work', label: '대사 확인', hidden: false });
  assert.equal(validateDocument(d).ok, true);
});

test('허용되지 않은 관계 조합 → E-PAIR', () => {
  const d = clone(EXAMPLE_12_6);
  d.edges.push({ id: 'L-009', source: 'N-020', target: 'N-011', core_type: 'performs', hidden: false });
  assert.deepEqual(validateDocument(d).errors, [{ code: 'E-PAIR', path: 'edges[3]' }]);
});

test('등록되지 않은 하위 유형 → E-SUBTYPE', () => {
  const d = clone(EXAMPLE_12_6);
  d.nodes[4].subtype = '없는 하위 유형';
  d.edges[0].subtype = '없는 관계 하위 유형';
  assert.deepEqual(codes(validateDocument(d)), ['E-SUBTYPE', 'E-SUBTYPE']);
});

test('모르는 유형을 불러와도 멈추지 않고 "기타"로 표시된다', () => {
  const d = clone(EXAMPLE_12_6);
  d.nodes.push({ id: 'N-040', core_type: 'customer', label: '외부 고객', hidden: false });
  d.edges.push({ id: 'L-010', source: 'N-040', target: 'N-001', core_type: 'sponsors', hidden: false });
  d.edges.push({ id: 'L-011', source: 'N-040', target: 'N-011', core_type: 'performs', hidden: false });
  assert.deepEqual(validateDocument(d).errors, []);
  assert.equal(nodeTypeLabel('customer'), '기타');
});

test('사번 없는 사람은 저장을 허용하고 W-NO-EMPNO 경고', () => {
  const d = clone(EXAMPLE_12_6);
  d.nodes.push({ id: 'N-012', core_type: 'person', label: '임가온', hidden: false });
  const r = validateDocument(d);
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings, [{ code: 'W-NO-EMPNO', target_id: 'N-012' }]);
});

test('꼭지는 정확히 1개이고 root_node_id와 같아야 한다', () => {
  const d = clone(EXAMPLE_12_6);
  d.universe.root_node_id = 'N-001';
  assert.deepEqual(codes(validateDocument(d)), ['E-SCHEMA']);
  const d2 = clone(EXAMPLE_12_6);
  d2.nodes[0].hidden = true;
  assert.deepEqual(codes(validateDocument(d2)), ['E-SCHEMA']);
});

test('이벤트 payload: 필수 키 누락 → E-REQUIRED, 없는 노드 참조 → E-SCHEMA, 전역 참조는 통과', () => {
  const d = clone(EXAMPLE_12_6);
  delete d.events[1].payload.from_person_id;
  d.events[0].payload.person_id = 'N-999';
  assert.deepEqual(codes(validateDocument(d)).sort(), ['E-REQUIRED', 'E-SCHEMA']);

  const g = clone(EXAMPLE_12_6);
  g.events[0].payload.from_org_id = 'U-O/N-100';
  assert.equal(validateDocument(g).ok, true);
});

test('꼭지 참조: 자기 자신은 E-CYCLE, 같은 하위 유니버스 중복은 E-DUP', () => {
  const d = clone(EXAMPLE_12_6);
  d.refs = [{ child_universe_id: 'U-A1' }];
  assert.deepEqual(codes(validateDocument(d)), ['E-CYCLE']);
  d.refs = [{ child_universe_id: 'U-B' }, { child_universe_id: 'U-B' }];
  assert.deepEqual(codes(validateDocument(d)), ['E-DUP']);
});

test('동일성 연결: 업무는 사람 확인만, 판정한 사람 확인 연결은 판정자 필수', () => {
  const d = clone(EXAMPLE_12_6);
  d.identity_links = [
    { id: 'I-1', a: 'U-A1/N-011', b: 'U-B/N-002', kind: 'person', method: 'emp_no_auto', status: 'confirmed' },
    { id: 'I-2', a: 'U-A1/N-001', b: 'U-B/N-005', kind: 'work', method: 'human', status: 'pending' },
  ];
  assert.equal(validateDocument(d).ok, true);
  d.identity_links.push({ id: 'I-3', a: 'U-A1/N-001', b: 'U-B/N-006', kind: 'work', method: 'emp_no_auto', status: 'confirmed' });
  d.identity_links.push({ id: 'I-4', a: 'U-A1/N-001', b: 'U-B/N-007', kind: 'work', method: 'human', status: 'confirmed' });
  assert.deepEqual(
    validateDocument(d).errors.map((e) => `${e.code}:${e.path}`),
    ['E-SCHEMA:identity_links[2].method', 'E-REQUIRED:identity_links[3].decided_by'],
  );
});
