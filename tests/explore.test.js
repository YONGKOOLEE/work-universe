// T-18 큰 화면 탐색(R-17, D-17): 찾기·거르기·주변만 보기 순수 함수(view/explore.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allSamples, mkDoc, mkEdge, mkNode, viewOf } from './helpers.js';
import { buildView } from '../app/src/view/view.js';
import { projectView } from '../app/src/view/collapse.js';
import { filterDisplay, neighborhoodDisplay, personsIn, searchNodes } from '../app/src/view/explore.js';

// ── ① ② 찾기 ──
test('R-17 ① 찾기: 부서 화면에서 "대사" → 접힌 하위 유니버스 안의 노드까지 유형·유니버스 이름과 함께 나온다', () => {
  const v = viewOf('U-D1');
  const hits = searchNodes(v, '대사');
  assert.ok(hits.some((h) => h.gid === 'U-A1/N-001' && h.type_label === '업무' && h.universe_name === '월말 정산 점검'));
  const shown = new Set(projectView(v).nodes.map((n) => n.gid));
  assert.ok(hits.some((h) => !shown.has(h.gid)), '접힌 화면에 없는 노드도 찾아야 한다');
  for (const h of hits) assert.ok(h.label.replace(/\s/g, '').includes('대사') || v.getNode(h.gid).merged_from.length, h.label);
});

test('R-17 ① 찾기: 공백·대소문자 무시, 검색어로 시작하는 이름이 앞, 숨긴 노드 제외, 자르지 않음', () => {
  const doc = mkDoc('U-X', [mkNode('N-1', 'work', '가상 대사'), mkNode('N-2', 'work', '대사 확인'), mkNode('N-3', 'work', '대사 숨김', { hidden: true }), mkNode('N-4', 'work', 'VAN 정산')], []);
  const v = buildView(doc);
  assert.deepEqual(searchNodes(v, ' 대 사 ').map((h) => h.label), ['대사 확인', '가상 대사']); // 가나다로는 「가상 대사」가 앞이지만 검색어로 시작하는 것이 먼저
  assert.deepEqual(searchNodes(v, 'van').map((h) => h.label), ['VAN 정산']);
  const many = mkDoc('U-M', Array.from({ length: 45 }, (_, i) => mkNode(`N-${i + 1}`, 'work', `점검 ${String(i + 1).padStart(2, '0')}`)), []);
  assert.equal(searchNodes(buildView(many), '점검').length, 45);
});

test('R-17 ① 찾기: 합쳐진 노드는 원래 이름(합쳐지기 전 이름)으로도 찾는다', () => {
  const v = viewOf('U-T1');
  const merged = v.nodes.find((n) => n.merged_from.length && !n.hidden);
  assert.ok(merged, '팀 샘플에 합쳐진 노드(주제 동일성 연결)가 있어야 한다');
  const other = merged.merged_from.map((g) => v.rawNode(g).label).find((l) => l !== merged.label) || merged.label;
  assert.ok(searchNodes(v, other).some((h) => h.gid === merged.gid));
});

test('R-17 ② 찾기: 합쳐진 원본 중 숨긴 것의 이름으로는 찾지 않는다(보이는 원본 이름으로는 찾음)', () => {
  const a = mkDoc('U-P', [mkNode('N-1', 'person', '가람')], []);
  const b = mkDoc('U-Q', [mkNode('N-1', 'person', '비밀옛이름', { hidden: true })], []);
  const c = mkDoc('U-R', [mkNode('N-1', 'person', '가람별칭')], []);
  a.refs = [{ child_universe_id: 'U-Q' }, { child_universe_id: 'U-R' }];
  a.identity_links = [
    { id: 'I-1', a: 'U-P/N-1', b: 'U-Q/N-1', kind: 'person', status: 'confirmed', method: 'manual' },
    { id: 'I-2', a: 'U-P/N-1', b: 'U-R/N-1', kind: 'person', status: 'confirmed', method: 'manual' },
  ];
  const v = buildView(a, (id) => ({ 'U-Q': b, 'U-R': c })[id] || null);
  assert.deepEqual(searchNodes(v, '비밀옛이름'), []);
  assert.deepEqual(searchNodes(v, '별칭').map((h) => h.gid), [v.canonical('U-P/N-1')]);
});

test('R-17 ② 찾기 오류: 맞는 노드가 없거나 빈 검색어면 빈 목록. 이름이 아닌 설명·사번만 맞으면 찾지 않는다', () => {
  const v = viewOf('U-D1');
  assert.deepEqual(searchNodes(v, '없는이름xyz'), []);
  assert.deepEqual(searchNodes(v, '   '), []);
  const doc = mkDoc('U-X', [mkNode('N-1', 'person', '가람', { emp_no: 'V-1234', description: '대사 담당' })], []);
  assert.deepEqual(searchNodes(buildView(doc), '대사'), []);
  assert.deepEqual(searchNodes(buildView(doc), 'V-1234'), []);
});

// ── ③ 거르기 ──
test('R-17 ③ 거르기: 유형만 남기고(꼭지는 늘 남김) 연결은 양 끝이 남은 것만', () => {
  const d = projectView(viewOf('U-D1'));
  const f = filterDisplay(d, { types: ['work'] });
  const types = new Set(d.nodes.filter((n) => f.nodes.has(n.gid)).map((n) => n.core_type));
  assert.deepEqual([...types].sort(), ['root', 'work']);
  assert.equal(f.total, d.nodes.length);
  assert.equal(f.shown, f.nodes.size);
  for (const e of d.edges) assert.equal(f.edges.has(e.gid), f.nodes.has(e.source) && f.nodes.has(e.target));
});

const personDoc = () => mkDoc('U-X', [mkNode('N-1', 'person', '가람'), mkNode('N-2', 'work', '대사'), mkNode('N-3', 'work', '보고'), mkNode('N-4', 'person', '나래'), mkNode('N-5', 'topic', '불일치')],
  [mkEdge('N-000', 'N-2', 'contains'), mkEdge('N-000', 'N-3', 'contains'), mkEdge('N-1', 'N-2', 'performs'), mkEdge('N-4', 'N-3', 'performs'), mkEdge('N-2', 'N-3', 'precedes'), mkEdge('N-2', 'N-5', 'relates_to'), mkEdge('N-1', 'N-5', 'relates_to')]); // 사람 → 주제(관련)는 거르기에 남지 않아야 한다(수행만)

test('R-17 ③ 거르기: 사람 하나 → 그 사람·맡은 업무·꼭지만, 연결은 수행 연결만', () => {
  const d = projectView(buildView(personDoc()));
  assert.deepEqual(personsIn(d).map((p) => p.label), ['가람', '나래']);
  const f = filterDisplay(d, { person: 'U-X/N-1' });
  assert.deepEqual([...f.nodes].sort(), ['U-X/N-000', 'U-X/N-1', 'U-X/N-2']);
  assert.equal(f.edges.size, 1);
  assert.ok(!f.nodes.has('U-X/N-3') && !f.nodes.has('U-X/N-4') && !f.nodes.has('U-X/N-5'));
});

test('R-17 ③ 거르기: 유형과 사람을 함께 고르면 두 조건을 모두 만족하는 것만(사람 유형을 빼면 그 사람도 흐려짐)', () => {
  const d = projectView(buildView(personDoc()));
  const f = filterDisplay(d, { types: ['work'], person: 'U-X/N-1' });
  assert.deepEqual([...f.nodes].sort(), ['U-X/N-000', 'U-X/N-2']);
  assert.equal(f.edges.size, 0);
});

test('R-17 ③ 거르기 없음(풀기) → null. 맡은 업무가 없는 사람이면 그 사람과 꼭지만', () => {
  const d = projectView(viewOf('U-A1'));
  assert.equal(filterDisplay(d, {}), null);
  assert.equal(filterDisplay(d, { types: [], person: null }), null);
  const doc = mkDoc('U-Y', [mkNode('N-1', 'person', '홀로')], []);
  const f = filterDisplay(projectView(buildView(doc)), { person: 'U-Y/N-1' });
  assert.deepEqual([...f.nodes].sort(), ['U-Y/N-000', 'U-Y/N-1']);
});

// ── ④ 주변만 보기 ──
test('R-17 ④ 주변만 보기: 1단계 이웃만, 가운데가 배치 기준. 2단계는 더 넓다(부서 화면, 접힌 노드도 포함)', () => {
  const v = viewOf('U-D1');
  const one = neighborhoodDisplay(v, 'U-A1/N-001', 1);
  assert.equal(one.rootGid, 'U-A1/N-001');
  assert.equal(one.center, 'U-A1/N-001');
  assert.ok(one.neighbor_count >= 1 && one.nodes.length === one.neighbor_count + 1);
  const ids = new Set(one.nodes.map((n) => n.gid));
  for (const e of one.edges) assert.ok(ids.has(e.source) && ids.has(e.target));
  for (const g of ids) if (g !== 'U-A1/N-001') assert.ok(v.neighbors('U-A1/N-001').some((x) => x.other.gid === g), g);
  const two = neighborhoodDisplay(v, 'U-A1/N-001', 2);
  assert.ok(two.neighbor_count > one.neighbor_count);
  assert.ok(one.nodes.length < v.visible().nodes.length);
});

test('R-17 ④ 주변만 보기 오류: 이웃 없음 → neighbor_count 0, 없는·숨긴 노드 → null, 숨긴 이웃은 빠짐', () => {
  const doc = mkDoc('U-Z', [mkNode('N-1', 'work', '외톨이'), mkNode('N-2', 'work', '숨김', { hidden: true }), mkNode('N-3', 'work', '짝'), mkNode('N-4', 'topic', '숨긴 이웃', { hidden: true })],
    [mkEdge('N-3', 'N-4', 'relates_to')]);
  const v = buildView(doc);
  assert.equal(neighborhoodDisplay(v, 'U-Z/N-1').neighbor_count, 0);
  assert.equal(neighborhoodDisplay(v, 'U-Z/N-9'), null);
  assert.equal(neighborhoodDisplay(v, 'U-Z/N-2'), null);
  assert.equal(neighborhoodDisplay(v, 'U-Z/N-3').neighbor_count, 0);
});

// ── ⑤ 데이터 불변 ──
test('R-17 ⑤ 셋 다 데이터를 바꾸지 않는다: 샘플 전부(깊게 동결)에서 호출해도 오류 없이 결과만 돌려준다', () => {
  for (const id of Object.keys(allSamples())) {
    const v = viewOf(id);
    const d = projectView(v);
    const before = JSON.stringify(allSamples()[id]);
    searchNodes(v, '가');
    filterDisplay(d, { types: ['work', 'person'] });
    const p = personsIn(d)[0];
    if (p) filterDisplay(d, { person: p.gid });
    const any = v.visible().nodes[1];
    if (any) neighborhoodDisplay(v, any.gid, 2);
    assert.equal(JSON.stringify(allSamples()[id]), before, id);
  }
});
