import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildView, parseGid, toGid } from '../app/src/view/view.js';
import { hideNode } from '../app/src/model/commands.js';
import { EXAMPLE_12_6 } from './fixtures/example-12-6.js';

const T = '2026-10-01T10:00:00+09:00';

function universe(id, name, nodes, edges = [], extra = {}) {
  return {
    schema_version: '1.0',
    universe: { id, name, level: '팀', owner: '가상', root_node_id: `${id}-root`, subtypes: [], is_sample: true, created_at: T },
    nodes: [{ id: `${id}-root`, core_type: 'root', label: name, hidden: false }, ...nodes],
    edges, events: [], refs: [], identity_links: [], ...extra,
  };
}
const person = (id, label, emp_no) => ({ id, core_type: 'person', label, emp_no, hidden: false });
const refs = (...ids) => ids.map((child_universe_id) => ({ child_universe_id }));

test('전역 참조 변환', () => {
  assert.equal(toGid('U-A1', 'N-003'), 'U-A1/N-003');
  assert.deepEqual(parseGid('U-A1/N-003'), { universe_id: 'U-A1', local_id: 'N-003' });
  assert.equal(parseGid('N-003'), null);
});

test('단일 유니버스: 노드·연결·이벤트가 전역 ID로 나오고 원본은 그대로', () => {
  const before = JSON.stringify(EXAMPLE_12_6);
  const v = buildView(EXAMPLE_12_6);
  assert.equal(v.nodes.length, 6);
  assert.equal(v.edges.length, 3);
  assert.equal(v.getNode('U-A1/N-001').label, '대사 확인');
  assert.equal(v.getNode('U-A1/N-001').origin, 'own');
  assert.equal(v.edges.find((e) => e.id === 'L-002').source, 'U-A1/N-011');
  assert.equal(v.nodes.find((n) => n.id === 'N-000').type_label, '지도 중심'); // CR-18-2
  assert.equal(JSON.stringify(EXAMPLE_12_6), before);
  assert.deepEqual(buildView(EXAMPLE_12_6).nodes, v.nodes); // 같은 입력 → 같은 결과
});

test('조회 표: 사번, 유형+라벨, 노드별 이벤트(시간순), 주제별 노드', () => {
  const v = buildView(EXAMPLE_12_6);
  assert.equal(v.index.byEmpNo.get('V-1002')[0].gid, 'U-A1/N-011');
  assert.equal(v.index.byTypeLabel.get('work|대사 확인')[0].gid, 'U-A1/N-001');
  assert.deepEqual(v.index.eventsByNode.get('U-A1/N-010').map((e) => e.id), ['E-001', 'E-002']);
  assert.deepEqual(v.index.eventsByNode.get('U-A1/N-020').map((e) => e.id), ['E-002']);
  assert.deepEqual(v.index.nodesByTopic.get('U-A1/N-030').map((n) => n.gid), ['U-A1/N-001']);
});

test('이웃 조회: 연결이 없으면 빈 배열("연결 없음")', () => {
  const v = buildView(EXAMPLE_12_6);
  const n = v.neighbors('U-A1/N-001').map((x) => `${x.direction}:${x.other.label}`).sort();
  assert.deepEqual(n, ['in:월말 정산 점검', 'in:윤바다', 'out:대사 불일치']);
  assert.deepEqual(v.neighbors('U-A1/N-010'), []);
  assert.deepEqual(v.neighbors('U-A1/N-020'), []);
});

test('숨김 후 참조: 숨긴 노드는 화면에서 빠지지만 근거 조회는 내용을 유지한다', () => {
  const v = buildView(hideNode(EXAMPLE_12_6, 'N-020', { now: T }).doc);
  assert.equal(v.visible().nodes.some((n) => n.id === 'N-020'), false);
  const found = v.lookup('U-A1/N-020');
  assert.equal(found.found, true);
  assert.equal(found.hidden, true);
  assert.equal(found.node.label, '2026-06 인수인계서');
  assert.equal(v.lookup('U-A1/N-999').found, false);
  assert.ok(v.index.eventsByNode.get('U-A1/N-020').length >= 2); // 이력은 유지(생성 이벤트 없는 예시라 handover + hidden)
  assert.equal(v.index.byTypeLabel.has('artifact|2026-06 인수인계서'), false);
});

test('숨긴 노드에 붙은 연결은 보이는 그래프에서 빠진다', () => {
  const v = buildView(hideNode(EXAMPLE_12_6, 'N-011', { now: T }).doc);
  assert.equal(v.visible().edges.some((e) => e.id === 'L-002'), false);
  assert.equal(v.visible().edges.length, 2);
});

test('꼭지 참조: 하위 유니버스가 펼쳐지고 부모 꼭지 → 자식 꼭지 합성 연결이 생긴다', () => {
  const a = universe('U-A', 'A팀', [person('p1', '한가람', 'V-1001')]);
  const b = universe('U-B', 'B팀', [person('p2', '도하람', 'V-2001')]);
  const dept = universe('U-D', '부서', [], [], { refs: refs('U-A', 'U-B') });
  const all = { 'U-A': a, 'U-B': b };
  const v = buildView(dept, (id) => all[id] || null);
  assert.equal(v.nodes.length, 5);
  assert.equal(v.getNode('U-A/p1').origin, 'ref');
  assert.equal(v.getNode('U-D/U-D-root').origin, 'own');
  const synth = v.edges.filter((e) => e.synthetic).map((e) => `${e.source}→${e.target}`).sort();
  assert.deepEqual(synth, ['U-D/U-D-root→U-A/U-A-root', 'U-D/U-D-root→U-B/U-B-root']);
  assert.deepEqual(v.missing, []);
  assert.equal(dept.nodes.length, 1); // 원본에는 노드가 추가되지 않는다
});

test('참조가 여러 단계여도 펼쳐지고, 같은 유니버스를 두 경로로 참조해도 한 번만 포함된다', () => {
  const c = universe('U-C', 'C팀', [person('p3', '임가온')]);
  const a = universe('U-A', 'A팀', [], [], { refs: refs('U-C') });
  const b = universe('U-B', 'B팀', [], [], { refs: refs('U-C') });
  const dept = universe('U-D', '부서', [], [], { refs: refs('U-A', 'U-B') });
  const all = { 'U-A': a, 'U-B': b, 'U-C': c };
  const v = buildView(dept, (id) => all[id]);
  assert.equal(v.nodes.filter((n) => n.universe_id === 'U-C').length, 2);
  assert.equal(v.edges.filter((e) => e.synthetic).length, 4); // D→A, D→B, A→C, B→C
});

test('순환 참조는 무한 반복하지 않고 건너뛴 참조를 기록한다', () => {
  const a = universe('U-A', 'A팀', [], [], { refs: refs('U-D') });
  const dept = universe('U-D', '부서', [], [], { refs: refs('U-A') });
  const v = buildView(dept, (id) => (id === 'U-A' ? a : id === 'U-D' ? dept : null));
  assert.equal(v.nodes.length, 2);
  assert.deepEqual(v.cyclic, [{ parent: 'U-A', child: 'U-D' }]);
});

test('없는 하위 유니버스는 missing에 기록하고 나머지는 그대로 보인다', () => {
  const v = buildView(universe('U-D', '부서', [], [], { refs: refs('U-X') }), () => null);
  assert.deepEqual(v.missing, ['U-X']);
  assert.equal(v.nodes.length, 1);
});

test('동일성 연결(확정)은 노드를 하나로 보이게 하고 원본 출처를 유지한다', () => {
  const a = universe('U-A', 'A팀', [person('p1', '윤바다', 'V-1002')]);
  const b = universe('U-B', 'B팀', [person('p9', '윤바다', 'V-1002'), { id: 'w1', core_type: 'work', label: '장소 섭외', hidden: false }],
    [{ id: 'l1', source: 'p9', target: 'w1', core_type: 'performs', hidden: false }],
    { events: [{ id: 'e1', type: 'memo', occurred_at: '2026-05-01', payload: { target_id: 'p9' } }] });
  const links = [
    { id: 'I-1', a: 'U-A/p1', b: 'U-B/p9', kind: 'person', method: 'emp_no_auto', status: 'confirmed' },
    { id: 'I-2', a: 'U-A/U-A-root', b: 'U-B/w1', kind: 'work', method: 'human', status: 'pending' },
  ];
  const dept = universe('U-D', '부서', [], [], { refs: refs('U-A', 'U-B'), identity_links: links });
  const all = { 'U-A': a, 'U-B': b };
  const v = buildView(dept, (id) => all[id]);

  assert.equal(v.nodes.filter((n) => n.label === '윤바다').length, 1);
  const merged = v.getNode('U-B/p9');
  assert.equal(merged.gid, 'U-A/p1'); // 먼저 나온 유니버스가 대표
  assert.deepEqual(merged.merged_from, ['U-B/p9']);
  assert.equal(v.canonical('U-B/p9'), 'U-A/p1');
  assert.equal(v.edges.find((e) => e.id === 'l1').source, 'U-A/p1'); // 연결 끝점이 대표 노드로 이어진다
  assert.deepEqual(v.index.eventsByNode.get('U-A/p1').map((e) => e.id), ['e1']);
  assert.equal(v.index.byEmpNo.get('V-1002').length, 1);
  assert.equal(v.getNode('U-B/w1').gid, 'U-B/w1'); // 확인 대기 연결은 합치지 않는다
  assert.equal(b.nodes.length, 3); // 원본은 그대로
});

test('거부 연결은 합치지 않고, 노드가 없는 연결은 unresolved로 기록한다', () => {
  const a = universe('U-A', 'A팀', [person('p1', '윤바다', 'V-1002')]);
  const b = universe('U-B', 'B팀', [person('p9', '윤바다', 'V-1002')]);
  const links = [
    { id: 'I-1', a: 'U-A/p1', b: 'U-B/p9', kind: 'person', method: 'human', status: 'rejected', decided_by: 'x', decided_at: T },
    { id: 'I-2', a: 'U-A/p1', b: 'U-B/없음', kind: 'person', method: 'human', status: 'confirmed', decided_by: 'x', decided_at: T },
  ];
  const dept = universe('U-D', '부서', [], [], { refs: refs('U-A', 'U-B'), identity_links: links });
  const all = { 'U-A': a, 'U-B': b };
  const v = buildView(dept, (id) => all[id]);
  assert.equal(v.nodes.filter((n) => n.label === '윤바다').length, 2);
  assert.deepEqual(v.unresolved_links, ['I-2']);
  assert.equal(v.index.byEmpNo.get('V-1002').length, 2); // 사번은 같지만 연결되지 않은 상태가 그대로 보인다
});
