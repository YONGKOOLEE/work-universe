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

// R7-1: 주제는 맨 아래 한 줄이 아니라 관련 업무 바로 아래 띠에 둔다. 개선 전(주제를 업무 평균 x, 맨 아래 줄에 두고 겹치면 옆으로 밀던 배치)의 값:
// 카드승인(U-K1) 주제-업무 연결 20개의 가로 거리 합 10800, 세로 거리 합 5296
const topicStats = (id) => {
  const { nodes, edges, pos } = layoutOf(id);
  const type = new Map(nodes.map((n) => [n.id, n.core_type]));
  let dx = 0;
  let dy = 0;
  let worst = 0;
  for (const t of nodes.filter((n) => n.core_type === 'topic')) {
    const ws = edges.filter((e) => e.source === t.id || e.target === t.id).map((e) => (e.source === t.id ? e.target : e.source)).filter((m) => type.get(m) === 'work');
    for (const w of ws) { dx += Math.abs(pos.get(w).x - pos.get(t.id).x); dy += Math.abs(pos.get(w).y - pos.get(t.id).y); }
    if (ws.length) worst = Math.max(worst, Math.min(...ws.map((w) => Math.abs(pos.get(w).y - pos.get(t.id).y))));
  }
  return { dx, dy, worst };
};

test('카드승인: 주제가 14개여도 주제-업무 연결의 가로 거리 합이 개선 전(10800)의 절반 아래, 세로 거리 합도 개선 전(5296)보다 작다', () => {
  const s = topicStats('U-K1');
  assert.ok(s.dx < 5400, `dx ${s.dx}`);
  assert.ok(s.dy < 5296, `dy ${s.dy}`);
  assert.ok(s.worst <= 3.5 * LANES.rowGap, `worst ${s.worst}`); // 가장 먼 주제도 가장 가까운 관련 업무에서 3.5층 안
});

test('모든 샘플에서 같은 높이의 이름 상자가 겹치지 않고, 주제는 관련 업무 아래에 놓인다', () => {
  for (const d of SAMPLES) {
    const { nodes, pos } = layoutOf(d.universe.id);
    const rects = nodes.map((n) => { const p = pos.get(n.id); const b = labelBox(n.label, 24); return { x1: p.x - b.w / 2, x2: p.x + b.w / 2, y: Math.round(p.y) }; });
    let overlaps = 0;
    for (let i = 0; i < rects.length; i += 1) for (let j = i + 1; j < rects.length; j += 1) {
      if (rects[i].y === rects[j].y && rects[i].x1 < rects[j].x2 && rects[i].x2 > rects[j].x1) overlaps += 1;
    }
    assert.equal(overlaps, 0, d.universe.id);
  }
  const { nodes, edges, pos } = layoutOf('U-K1');
  const kind = new Map(nodes.map((n) => [n.id, n.core_type]));
  for (const t of nodes.filter((n) => n.core_type === 'topic')) {
    const ws = edges.filter((e) => e.source === t.id || e.target === t.id).map((e) => (e.source === t.id ? e.target : e.source)).filter((m) => kind.get(m) === 'work');
    if (ws.length) assert.ok(pos.get(t.id).y > Math.min(...ws.map((w) => pos.get(w).y)), t.label);
  }
});

test('월말 정산: 사람 이름 상자가 꼭지 → 업무 선 위에 놓이지 않는다', () => {
  const { nodes, edges, pos } = layoutOf('U-A1');
  const root = nodes.find((n) => n.core_type === 'root');
  const rp = pos.get(root.id);
  for (const p of nodes.filter((n) => n.core_type === 'person')) {
    const pp = pos.get(p.id);
    const w = labelBox(p.label, 24).w;
    for (const e of edges.filter((x) => x.source === root.id || x.target === root.id)) {
      const o = pos.get(e.source === root.id ? e.target : e.source);
      if (o.y <= pp.y) continue;
      const lx = rp.x + (o.x - rp.x) * ((pp.y - rp.y) / (o.y - rp.y));
      assert.ok(!(lx > pp.x - w / 2 && lx < pp.x + w / 2), `${p.label} 가 선 위에 있음`);
    }
  }
});
