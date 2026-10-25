// CR-22 G 그래프 가독성: 이름 단계 표시(우선순위·겹침)·휠 배율·배치 범위·모양·색 대비 + 주변만 보기(지도 중심 통과 금지·유효하지 않은 연결 제외). 순수 함수만(브라우저 점검은 tools/browser-check.mjs 「CR-22 G」)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkDoc, mkEdge, mkNode } from './helpers.js';
import { buildView } from '../app/src/view/view.js';
import { periodStatus } from '../app/src/view/describe.js';
import { neighborhoodDisplay, offPeriodEdgeIds } from '../app/src/view/explore.js';
import {
  GRAPH_COLORS, LOD, TYPE_SHAPES, chooseVisibleLabels, contrastRatio, labelModelPx, labelPriority, labelScreenPx, layoutSpan, nextZoom, pushOutOfCenter, separateCircles, shapeOf, wheelZoomFactor,
} from '../app/src/view/graphlod.js';

const box = (x, y, w = 60, h = 14) => ({ x1: x, y1: y, x2: x + w, y2: y + h });

// ── 1. 이름 글자 크기·우선순위·겹침 ──
test('CR-22 G 1 이름 글자: 배율을 줄여도 화면 11px 밑으로 안 내려가고(역보정), 키워도 14px를 넘지 않는다. 크게 볼 이름은 14~16px', () => {
  assert.equal(labelScreenPx(0.26), LOD.MIN_PX); // 150개 지도 첫 배율(예전엔 3.6px라 숨김)
  assert.equal(labelScreenPx(0.5), LOD.MIN_PX);
  assert.equal(labelScreenPx(0.9), 0.9 * 14);
  assert.equal(labelScreenPx(1), 14);
  assert.equal(labelScreenPx(1.8), 14);
  assert.equal(labelScreenPx(0.26, true), 14);
  assert.equal(labelScreenPx(1.5, true), 16);
  assert.equal(labelScreenPx(0), 14, '잘못된 배율은 1로 본다');
  assert.ok(Math.abs(labelModelPx(11, 0.25) - 44) < 1e-9, '그래프 좌표 글자 크기 = 화면 크기 ÷ 배율');
});

test('CR-22 G 1 우선순위: 지도 중심 = 고른 항목 > 이웃 > 연결 많은 업무 > 업무 > 사람·조직 > 산출물·주제', () => {
  const p = (o) => labelPriority(o);
  const order = [
    p({ type: 'root' }), p({ type: 'person', near: true }), p({ type: 'work', degree: 4 }), p({ type: 'work', degree: 1 }), p({ type: 'person' }), p({ type: 'artifact' }),
  ];
  assert.deepEqual(order, [0, 1, 2, 3, 4, 5]);
  assert.equal(p({ type: 'topic', focus: true }), 0, '고른 항목은 유형과 상관없이 0순위');
  assert.equal(p({ type: 'org' }), p({ type: 'person' }));
  assert.equal(p({ type: 'topic' }), p({ type: 'artifact' }));
  assert.equal(p({ type: 'unknown' }), 5);
  assert.ok(p({ type: 'work', degree: LOD.HUB_DEGREE }) < p({ type: 'work', degree: LOD.HUB_DEGREE - 1 }));
});

test('CR-22 G 1 겹침: 우선순위 높은 이름이 남고 낮은 쪽이 숨는다. 겹치지 않으면 모두 보인다. 같은 순위는 연결 많은 쪽', () => {
  const shown = chooseVisibleLabels([
    { id: 'person', rank: 4, degree: 9, box: box(10, 10) },
    { id: 'work', rank: 3, degree: 1, box: box(40, 12) }, // person과 겹침(가로 40~70 vs 10~70)
    { id: 'far', rank: 5, degree: 0, box: box(300, 300) },
  ]);
  assert.deepEqual([...shown].sort(), ['far', 'work'], '업무(3순위)가 사람(4순위)을 이긴다. 겹치지 않은 산출물은 그대로');
  const tie = chooseVisibleLabels([
    { id: 'a', rank: 3, degree: 1, box: box(0, 0) },
    { id: 'b', rank: 3, degree: 5, box: box(10, 0) },
  ]);
  assert.deepEqual([...tie], ['b']);
  assert.equal(chooseVisibleLabels([{ id: 'x', rank: 0, box: box(0, 0) }, { id: 'y', rank: 0, box: box(0, 0) }]).size, 1, '같은 자리 둘은 하나만(결정적: id 순)');
  assert.deepEqual([...chooseVisibleLabels([{ id: 'x', rank: 0, box: box(0, 0) }, { id: 'a', rank: 0, box: box(0, 0) }])], ['a']);
});

test('CR-22 G 1 지도 중심(force): 겹쳐도 숨기지 않고 다른 이름보다 먼저 놓인다', () => {
  const shown = chooseVisibleLabels([
    { id: 'work', rank: 2, degree: 9, box: box(0, 0) },
    { id: 'rootA', rank: 0, force: true, box: box(10, 0) },
    { id: 'rootB', rank: 0, force: true, box: box(20, 0) },
  ]);
  assert.deepEqual([...shown].sort(), ['rootA', 'rootB'], '지도 중심 둘은 서로 겹쳐도 둘 다 보이고, 겹친 업무는 숨는다');
});

test('CR-22 G 1 여백·이름 없음: 여백(2px) 안에 붙은 이름도 겹친 것으로 본다. 상자가 없는(이름 없는) 항목은 자리를 차지하지 않고 통과', () => {
  const touching = chooseVisibleLabels([{ id: 'a', rank: 1, box: box(0, 0, 50, 14) }, { id: 'b', rank: 2, box: box(51, 0, 50, 14) }]);
  assert.deepEqual([...touching], ['a'], '간격 1px < 여백 2px');
  const apart = chooseVisibleLabels([{ id: 'a', rank: 1, box: box(0, 0, 50, 14) }, { id: 'b', rank: 2, box: box(53, 0, 50, 14) }]);
  assert.equal(apart.size, 2);
  const none = chooseVisibleLabels([{ id: 'a', rank: 1, box: box(0, 0) }, { id: 'noname', rank: 9, box: null }]);
  assert.ok(none.has('noname'));
  assert.equal(chooseVisibleLabels([]).size, 0);
});

test('CR-22 G 1 확대하면 숨었던 이름이 나온다: 같은 항목들을 두 배 벌려 놓으면 숨은 이름이 보인다', () => {
  const spread = (k) => Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, rank: 3 + (i % 3), degree: i, box: box((i % 4) * 40 * k, Math.floor(i / 4) * 12 * k, 60, 14) }));
  const small = chooseVisibleLabels(spread(1)).size;
  const big = chooseVisibleLabels(spread(3)).size;
  assert.ok(small < 12 && big === 12 && big > small, `확대 전 ${small}개 → 확대 후 ${big}개`);
});

test('CR-22 G 1 150개 규모에서도 계산이 가볍다(겹침 계산 150개 × 100회 < 1초)', () => {
  const items = Array.from({ length: 150 }, (_, i) => ({ id: `n${i}`, rank: i % 6, degree: i % 9, box: box((i * 37) % 900, (i * 53) % 600, 70, 14) }));
  const t0 = performance.now();
  for (let k = 0; k < 100; k += 1) chooseVisibleLabels(items);
  assert.ok(performance.now() - t0 < 1000);
});

// ── 4. 휠 ──
test('CR-22 G 4 휠: 마우스 한 칸(|deltaY| ≥ 50)은 ×1.15 / ÷1.15, 터치패드의 작은 값은 연속 배율, 위로 돌리면 확대', () => {
  assert.equal(wheelZoomFactor(-100), 1.15);
  assert.equal(wheelZoomFactor(100), 1 / 1.15);
  assert.equal(wheelZoomFactor(-50), 1.15);
  assert.equal(wheelZoomFactor(-120), 1.15, '큰 값도 한 칸');
  assert.ok(Math.abs(wheelZoomFactor(-10) - Math.exp(0.1)) < 1e-12);
  assert.ok(Math.abs(wheelZoomFactor(7) - Math.exp(-0.07)) < 1e-12);
  assert.equal(wheelZoomFactor(0), 1);
  assert.equal(wheelZoomFactor(NaN), 1);
  assert.equal(wheelZoomFactor(-3, 1), 1.15, 'deltaMode 줄: -3줄 = -120px → 한 칸');
  assert.ok(wheelZoomFactor(-49) > 1 && wheelZoomFactor(-49) < 1.15 + 0.4);
});

test('CR-22 G 4 휠 칸 수: 두 배까지 5칸(예전 81칸). 배율은 [minZoom, maxZoom] 밖으로 안 나간다. 확대·축소가 서로 되돌린다', () => {
  let z = 1;
  let n = 0;
  while (z < 2) { z = nextZoom(z, wheelZoomFactor(-100), 0.2, 1.8 * 10); n += 1; }
  assert.equal(n, 5);
  assert.equal(nextZoom(1.7, 1.15, 0.2, 1.8), 1.8);
  assert.equal(nextZoom(0.21, 1 / 1.15, 0.2, 1.8), 0.2);
  assert.ok(Math.abs(nextZoom(nextZoom(1, 1.15, 0.2, 1.8), 1 / 1.15, 0.2, 1.8) - 1) < 1e-12);
  assert.ok(wheelZoomFactor(-1e9) <= 1.5 && wheelZoomFactor(1e9) >= 1 / 1.5);
  assert.ok(LOD.BUTTON_STEP > 1);
});

// ── 2·9. 배치 ──
test('CR-22 G 9 배치 범위는 항목 수로만 정해진다(창 크기와 무관). 항목이 많을수록 넓다', () => {
  assert.equal(layoutSpan(10), layoutSpan(10));
  assert.ok(layoutSpan(150) > layoutSpan(38) && layoutSpan(38) >= layoutSpan(10));
  assert.ok(layoutSpan(0) >= 480 && layoutSpan(1) >= 480);
  assert.equal(layoutSpan(150), Math.round(Math.sqrt(150) * 110));
});

test('CR-22 G 2 지도 중심 둘레 비우기: 가까운 항목만 같은 방향으로 밀려 나가고 먼 항목은 그대로. 정확히 겹친 항목은 서로 다른 방향으로', () => {
  const c = { x: 0, y: 0 };
  const pos = new Map([['near', { x: 10, y: 0 }], ['far', { x: 400, y: 0 }], ['a', { x: 0, y: 0 }], ['b', { x: 0, y: 0 }]]);
  const out = pushOutOfCenter(pos, c, 27, { near: 15, far: 15, a: 15, b: 15 }, 14);
  assert.equal(out.get('near').y, 0);
  assert.ok(Math.abs(out.get('near').x - 56) < 1e-9, '27 + 15 + 14');
  assert.deepEqual(out.get('far'), { x: 400, y: 0 });
  const da = Math.hypot(out.get('a').x, out.get('a').y);
  assert.ok(Math.abs(da - 56) < 1e-9);
  assert.notDeepEqual(out.get('a'), out.get('b'));
  assert.deepEqual(pos.get('near'), { x: 10, y: 0 }, '입력은 바꾸지 않는다');
});

test('CR-22 G 2 지도 중심끼리 겹침 풀기(묶은 지도): 겹친 원은 간격 이상으로 벌어지고 떨어진 원은 그대로, 같은 자리 둘은 다른 방향으로', () => {
  const out = separateCircles([
    { id: 'a', x: 0, y: 0, r: 27 }, { id: 'b', x: 30, y: 0, r: 36 }, { id: 'far', x: 900, y: 900, r: 40 }, { id: 'c', x: 30, y: 0, r: 20 },
  ], 14);
  const d = (u, v) => Math.hypot(out.get(u).x - out.get(v).x, out.get(u).y - out.get(v).y);
  assert.ok(d('a', 'b') >= 27 + 36 + 14 - 0.5 && d('a', 'c') >= 27 + 20 + 14 - 0.5 && d('b', 'c') >= 36 + 20 + 14 - 0.5, '모든 쌍이 반지름 합 + 간격 이상');
  assert.deepEqual(out.get('far'), { x: 900, y: 900 });
  assert.deepEqual([...separateCircles([]).keys()], []);
  const one = separateCircles([{ id: 'x', x: 5, y: 5, r: 50 }]);
  assert.deepEqual(one.get('x'), { x: 5, y: 5 }, '하나뿐이면 그대로');
});

// ── 3. 모양·색 ──
test('CR-22 G 3 유형별 모양: 사람 원 · 업무 둥근 사각 · 산출물 사각 · 주제 마름모 · 조직 육각 · 지도 중심 원. 모르는 유형은 원', () => {
  assert.deepEqual(TYPE_SHAPES, { root: 'ellipse', person: 'ellipse', work: 'round-rectangle', artifact: 'rectangle', topic: 'diamond', org: 'hexagon' });
  assert.equal(shapeOf('work'), 'round-rectangle');
  assert.equal(shapeOf('낯선유형'), 'ellipse');
  assert.equal(new Set(['person', 'work', 'artifact', 'topic', 'org'].map(shapeOf)).size, 5 - 0, '지도 중심을 뺀 다섯 유형의 모양은 모두 다르다(원은 사람 하나)');
});

test('CR-22 G 3 연결선 색: 배경과의 대비가 3:1 이상(이전 #3d5536은 2.25:1)', () => {
  assert.ok(contrastRatio('#3d5536', GRAPH_COLORS.BG) < 3);
  assert.ok(contrastRatio(GRAPH_COLORS.EDGE, GRAPH_COLORS.BG) >= 3, String(contrastRatio(GRAPH_COLORS.EDGE, GRAPH_COLORS.BG)));
  assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 1e-9);
});

// ── 8. 범례 ──
test('CR-22 G 8 범례: legendItems는 유형 줄에 모양(shape)을 담고, 선택 인자로 받은 강조 줄을 mark: true로 뒤에 붙인다(공간 기능용)', async () => {
  const { legendItems } = await import('../app/src/ui/graph.js');
  const display = { nodes: [{ core_type: 'root' }, { core_type: 'person' }, { core_type: 'work' }, { core_type: 'artifact' }, { core_type: 'topic' }, { core_type: 'org' }, { core_type: '낯선' }] };
  const base = legendItems(display);
  assert.deepEqual(Object.fromEntries(base.map((i) => [i.key, i.shape])), { root: 'ellipse', person: 'ellipse', work: 'round-rectangle', artifact: 'rectangle', topic: 'diamond', org: 'hexagon', unknown: 'ellipse' });
  assert.ok(base.every((i) => !i.mark));
  const marks = [{ key: 'unresolved', label: '노랑 = 미해결', color: '#ffd84d' }, { key: 'solo', label: '빨강 겹테두리 = 혼자만 아는 일', color: '#ff5a5a', ring: true }];
  const withMarks = legendItems(display, [], marks);
  assert.equal(withMarks.length, base.length + 2);
  assert.deepEqual(withMarks.slice(0, base.length), base, '유형 줄은 그대로');
  assert.deepEqual(withMarks.slice(-2).map((i) => [i.key, i.mark, i.ring || false]), [['unresolved', true, false], ['solo', true, true]]);
  assert.deepEqual(legendItems(display, ['topic'], []).map((i) => i.key), base.map((i) => i.key), '두 번째 인자(거르기에서 고른 유형)는 이전과 같이 동작');
});

// ── 6. 주변만 보기 ──
function bigMap() {
  // 지도 중심 R이 업무 A·X·Y를 포함. 사람 P는 A 담당, 사람 Q는 X 담당. A와 Z는 선후
  const nodes = [
    mkNode('N-0', 'root', '가상 지도'), mkNode('N-A', 'work', '업무 A'), mkNode('N-X', 'work', '업무 X'), mkNode('N-Y', 'work', '업무 Y'),
    mkNode('N-Z', 'work', '업무 Z'), mkNode('N-P', 'person', '가상 사람 P'), mkNode('N-Q', 'person', '가상 사람 Q'),
  ];
  const edges = [
    mkEdge('N-0', 'N-A', 'contains'), mkEdge('N-0', 'N-X', 'contains'), mkEdge('N-0', 'N-Y', 'contains'), mkEdge('N-0', 'N-Z', 'contains'),
    mkEdge('N-A', 'N-Z', 'precedes'), mkEdge('N-P', 'N-A', 'performs', { period: { start: '2025-01-01' } }), mkEdge('N-Q', 'N-X', 'performs', { period: { start: '2025-01-01' } }),
  ];
  return buildView(mkDoc('U-G', nodes, edges));
}
const gids = (d) => d.nodes.map((n) => n.gid).sort();

test('CR-22 G 6 주변만 보기: 지도 중심은 끝점으로만 — 사람 P의 2단계가 지도 중심을 지나 지도 전체로 퍼지지 않는다', () => {
  const v = bigMap();
  const two = neighborhoodDisplay(v, 'U-G/N-P', 2);
  assert.deepEqual(gids(two), ['U-G/N-0', 'U-G/N-A', 'U-G/N-P', 'U-G/N-Z'].sort(), 'P → A → (지도 중심, Z). 지도 중심이 보이긴 하지만');
  const three = neighborhoodDisplay(v, 'U-G/N-P', 3);
  assert.ok(!three.nodes.some((n) => ['U-G/N-X', 'U-G/N-Y', 'U-G/N-Q'].includes(n.gid)), '3단계도 지도 중심 너머(X·Y·Q)로는 안 간다');
  assert.equal(three.neighbor_count, 3);
});

test('CR-22 G 6 주변만 보기: 가운데 항목이 지도 중심 자신이면 그 연결을 따라간다(1단계 = 포함한 업무 전부)', () => {
  const v = bigMap();
  const one = neighborhoodDisplay(v, 'U-G/N-0', 1);
  assert.deepEqual(gids(one), ['U-G/N-0', 'U-G/N-A', 'U-G/N-X', 'U-G/N-Y', 'U-G/N-Z'].sort());
});

test('CR-22 G 6 주변만 보기: 기준일에 유효하지 않은 담당·소속 연결은 따라가지 않는다(끝난 담당 연결로만 닿는 항목이 안 나옴)', () => {
  const nodes = [mkNode('N-1', 'person', '가상 사람 1'), mkNode('N-2', 'work', '지난 업무'), mkNode('N-3', 'work', '지금 업무'), mkNode('N-4', 'org', '가상 팀')];
  const edges = [
    mkEdge('N-1', 'N-2', 'performs', { period: { start: '2024-01-01', end: '2025-06-30' } }),
    mkEdge('N-1', 'N-3', 'performs', { period: { start: '2025-07-01' } }),
    mkEdge('N-1', 'N-4', 'belongs_to', { period: { start: '2026-12-01' } }), // 아직 시작 전
    mkEdge('N-2', 'N-3', 'precedes'),
  ];
  const v = buildView(mkDoc('U-T', nodes, edges));
  const off = offPeriodEdgeIds(v.visible().edges, '2026-10-26', periodStatus);
  assert.equal(off.size, 2, '끝난 담당과 시작 전 소속');
  const without = neighborhoodDisplay(v, 'U-T/N-1', 1, { skipEdges: off });
  assert.deepEqual(gids(without), ['U-T/N-1', 'U-T/N-3']);
  const withAll = neighborhoodDisplay(v, 'U-T/N-1', 1);
  assert.equal(withAll.neighbor_count, 3, '옵션이 없으면 예전과 같다');
  // 선후(precedes)는 기간이 없으므로 따라간다: 2단계에서 지난 업무가 지금 업무를 거쳐 나온다
  const two = neighborhoodDisplay(v, 'U-T/N-1', 2, { skipEdges: off });
  assert.deepEqual(gids(two), ['U-T/N-1', 'U-T/N-2', 'U-T/N-3']);
  // 기준일을 옛날로 두면 같은 연결이 유효하다
  const old = offPeriodEdgeIds(v.visible().edges, '2025-01-01', periodStatus);
  assert.deepEqual([...old].length, 2, '2025-01-01에는 이후 시작하는 두 연결(2025-07·2026-12)이 아직 시작 전');
});

test('CR-22 G 6 offPeriodEdgeIds: 담당·소속만 보고, 기간이 없으면 유효로 본다', () => {
  const off = offPeriodEdgeIds([
    { gid: 'e1', core_type: 'performs', period: { end: '2020-01-01' } },
    { gid: 'e2', core_type: 'produces', period: { end: '2020-01-01' } },
    { gid: 'e3', core_type: 'belongs_to' },
  ], '2026-10-26', periodStatus);
  assert.deepEqual([...off], ['e1']);
});
