// 흐름 정렬(시제품): 선후 순서는 가로, 유형은 세로 층, 이름 상자는 겹치지 않는다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLES } from '../app/data/index.js';
import { buildView } from '../app/src/view/view.js';
import { labelBox } from '../app/src/view/place.js';
import { LANES, flowLayout } from '../app/src/view/lanes.js';

const by = Object.fromEntries(SAMPLES.map((d) => [d.universe.id, d]));
function layoutOf(id) {
  const v = buildView(by[id], (x) => by[x] || null);
  const nodes = v.nodes.filter((n) => !n.hidden).map((n) => ({ id: n.gid, core_type: n.core_type, label: n.label }));
  const ids = new Set(nodes.map((n) => n.id));
  const edges = v.edges.filter((e) => !e.hidden && ids.has(e.source) && ids.has(e.target)).map((e) => ({ source: e.source, target: e.target, core_type: e.core_type }));
  return { nodes, edges, pos: flowLayout(nodes, edges) };
}

test('월말 정산: 자료 수집 → 대사 확인 → 보고가 왼쪽에서 오른쪽, 사람은 업무 위, 산출물은 아래, 꼭지는 맨 위', () => {
  const { nodes, pos } = layoutOf('U-A1');
  const at = (label) => pos.get(nodes.find((n) => n.label === label).id);
  assert.ok(at('자료 수집').x < at('대사 확인').x && at('대사 확인').x < at('보고').x);
  assert.ok(at('한가람').y < at('대사 확인').y && at('서하늘').y < at('대사 확인').y);
  assert.ok(at('점검표 양식').y > at('자료 수집').y);
  assert.ok(at('월말 정산 점검').y < at('한가람').y);
  assert.equal(pos.size, nodes.length);
});

test('모든 샘플에서 모든 노드에 유한한 좌표가 있고 같은 입력은 같은 결과', () => {
  for (const d of SAMPLES) {
    const a = layoutOf(d.universe.id);
    assert.equal(a.pos.size, a.nodes.length, d.universe.id);
    for (const p of a.pos.values()) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    assert.deepEqual([...flowLayout(a.nodes, a.edges)], [...a.pos]);
  }
});

test('같은 층의 이름 상자는 가로로 겹치지 않는다(부서 화면)', () => {
  const { nodes, pos } = layoutOf('U-D1');
  const byLabel = new Map(nodes.map((n) => [n.id, n]));
  const rects = [...pos].map(([id, p]) => {
    const n = byLabel.get(id);
    const b = labelBox(n.label, 24);
    return { id, x1: p.x - b.w / 2, x2: p.x + b.w / 2, y: Math.round(p.y) };
  });
  let overlaps = 0;
  for (let i = 0; i < rects.length; i += 1) for (let j = i + 1; j < rects.length; j += 1) {
    if (rects[i].y === rects[j].y && rects[i].x1 < rects[j].x2 && rects[i].x2 > rects[j].x1) overlaps += 1;
  }
  assert.equal(overlaps, 0);
  assert.ok(LANES.cols >= 1);
});

test('순환·빈 입력에서도 끝난다', () => {
  const nodes = [{ id: 'a', core_type: 'work', label: 'A' }, { id: 'b', core_type: 'work', label: 'B' }];
  const pos = flowLayout(nodes, [{ source: 'a', target: 'b', core_type: 'precedes' }, { source: 'b', target: 'a', core_type: 'precedes' }]);
  assert.equal(pos.size, 2);
  assert.equal(flowLayout([], []).size, 0);
});
