// 그래프 라이브러리(Cytoscape.js) 연결. 다른 모듈은 이 파일을 통해서만 라이브러리를 쓴다.
// 입력은 층별 보기 결과(view/collapse.js projectView)다. 접힌 하위 유니버스는 꼭지를 크게 그리고 가려진 노드 수를 붙인다.

import cytoscape from 'cytoscape';
import { NODE_TYPES, UNKNOWN_TYPE_LABEL, hasKey } from '../model/schema.js';
import { hasLongWord } from '../view/describe.js';
import { labelBox, placeNewNodes } from '../view/place.js';
import { flowLayout } from '../view/lanes.js';
import { EXPLORE } from './explore.js';
import { firstViewZoom } from '../view/explore.js';
import { GRAPH_COLORS, LOD, chooseVisibleLabels, labelModelPx, labelPriority, labelScreenPx, layoutSpan, nextZoom, pushOutOfBox, pushOutOfCenter, rootLabelSize, separateLabeled, shapeOf, wheelZoomFactor, TYPE_SHAPES } from '../view/graphlod.js';
import { el } from './dom.js';

// 노드 유형별 색(어두운 배경용 파스텔). 범례도 이 표를 쓴다
export const TYPE_COLORS = {
  root: '#b9e07a',
  person: '#6fd6b4',
  work: '#6cc4dc',
  artifact: '#e9c46a',
  org: '#b8a3ec',
  topic: '#ec8fa3',
};
const UNKNOWN_COLOR = '#8a948a';
// 연결이 이 수 이하일 때만 모든 연결 이름을 보인다. 그보다 많으면 고른 노드의 연결만
const LABEL_EDGE_LIMIT = 14;
const BG = GRAPH_COLORS.BG;
const TEXT = '#e6ecdf';
const MUTED = '#8f9d88';
const EDGE = GRAPH_COLORS.EDGE; // 배경(BG)과의 대비 3:1 이상(CR-22 G, 이전 #3d5536은 2.25:1)
const ACCENT = '#a6d86b';

const LAYOUT_LABEL_MAX_NODES = 25; // 이 수 이하의 지도만 배치 계산에 이름 자리를 넣는다
const BIG_TUNED_MAX = 200; // 큰 지도 배치값(온도 1000·냉각 0.99·반복 1500)을 쓰는 노드 수 상한. 이 수를 넘으면 예전 값(120·0.97·1200)
const colorOf =(el) => TYPE_COLORS[el.data('core_type')] || UNKNOWN_COLOR;

// 꼭지에서 몇 단계 떨어졌는지(연결 방향 무시). 닿지 않는 노드는 가장 바깥 고리로 보낸다.
// 같은 고리 안에서는 부모 노드 순서대로 모아 선이 덜 엇갈리게 한다.
function ringOrder(nodes, edges, rootGid) {
  const adj = new Map(nodes.map((n) => [n.gid, []]));
  for (const e of edges) {
    adj.get(e.source)?.push(e.target);
    adj.get(e.target)?.push(e.source);
  }
  const depth = new Map();
  const order = [];
  const queue = adj.has(rootGid) ? [rootGid] : [];
  if (queue.length) depth.set(rootGid, 0);
  while (queue.length) {
    const g = queue.shift();
    order.push(g);
    for (const nb of adj.get(g)) {
      if (!depth.has(nb)) {
        depth.set(nb, depth.get(g) + 1);
        queue.push(nb);
      }
    }
  }
  const maxDepth = Math.max(0, ...depth.values());
  for (const n of nodes) {
    if (!depth.has(n.gid)) {
      depth.set(n.gid, maxDepth + 1);
      order.push(n.gid);
    }
  }
  return { depth, order };
}

function toElements(display) {
  const { nodes, edges, rootGid, collapsed } = display;
  const { depth, order } = ringOrder(nodes, edges, rootGid);
  const collapsedRoot = new Map([...collapsed.values()].map((c) => [c.root_gid, c.hidden_count]));
  // 점선 테두리(참조한 유니버스의 노드)는 내 노드와 참조 노드가 섞여 있을 때만 구분이 의미 있다.
  // 부서처럼 전부 참조한 노드면 모든 노드에 점선이 둘려 오히려 어수선하다
  const mixed = nodes.some((n) => n.origin === 'ref') && nodes.some((n) => n.origin === 'own' && n.core_type !== 'root');
  const degree = new Map();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) || 0) + 1);
    degree.set(e.target, (degree.get(e.target) || 0) + 1);
  }
  const byGid = new Map(nodes.map((n) => [n.gid, n]));
  const rootIds = new Set(nodes.filter((n) => n.core_type === 'root').map((n) => n.gid));
  return [
    ...order.map((gid) => {
      const n = byGid.get(gid);
      const deg = degree.get(gid) || 0;
      const hiddenCount = collapsedRoot.get(gid);
      return {
        group: 'nodes',
        data: {
          mixed,
          id: n.gid,
          universe_id: n.universe_id,
          // 접힌 하위 유니버스의 꼭지: 가려진 노드 수를 함께 보인다
          label: hiddenCount ? `${n.label}
＋${hiddenCount}` : n.label,
          collapsed: !!hiddenCount,
          // 띄어쓰기 없이 긴 낱말(약 9자 넘게)이 있으면 글자 단위 줄바꿈을 허용한다(화면 점검 S-3). 보통 이름은 띄어쓰기에서만 끊는다(재검증)
          longword: hasLongWord(n.label),
          core_type: n.core_type,
          origin: n.origin,
          merged: n.merged_from.length > 0,
          depth: depth.get(gid),
          // 연결이 많을수록 크게(참고 화면처럼 허브가 눈에 띄게)
          size: n.core_type === 'root' ? (hiddenCount ? 64 + Math.min(hiddenCount, 40) : 54) : (24 + Math.min(deg, 8) * 3) * (n.core_type === 'topic' ? 1.25 : 1), // 마름모는 같은 크기에서 작아 보여 조금 키운다
          degree: deg,
        },
      };
    }),
    ...edges.map((e) => ({
      group: 'edges',
      data: {
        id: e.gid,
        source: e.source,
        target: e.target,
        label: e.synthetic ? '' : e.type_label + (e.count > 1 ? ` ×${e.count}` : ''),
        synthetic: e.synthetic,
        summarized: !!e.summarized,
        // 지도 중심 → 항목 「포함」 선(CR-22 G): 아주 흐리게, 화살표·이름 없음, 배치 계산에서 제외
        contains: e.core_type === 'contains' && rootIds.has(e.source),
      },
    })),
  ];
}

// 범례에 보여 줄 유형(현재 그래프에 있는 것만). 모르는 유형은 "기타" 하나로 묶는다
// also: 화면에 없어도 넣을 유형(거르기에서 고른 유형, T-18)
// marks: 유형이 아닌 강조 줄(CR-22 G 8: 공간 기능이 「노랑 = 미해결」 「빨강 겹테두리 = 혼자만 아는 일」 같은 줄을 넘긴다). {key, label, color, ring?}가 그대로 뒤에 붙고 mark: true가 더해진다
export function legendItems(display, also = [], marks = []) {
  const present = new Set([...display.nodes.map((n) => n.core_type), ...also]);
  const items = Object.entries(NODE_TYPES)
    .filter(([key]) => present.has(key))
    .map(([key, label]) => ({ key, label, color: TYPE_COLORS[key], shape: shapeOf(key) }));
  if ([...present].some((t) => !hasKey(NODE_TYPES, t))) items.push({ key: 'unknown', label: UNKNOWN_TYPE_LABEL, color: UNKNOWN_COLOR, shape: shapeOf('unknown') });
  return [...items, ...marks.map((m) => ({ ...m, mark: true }))];
}

// getFilter(display): 거르기 결과 {nodes:Set, edges:Set} 또는 null(T-18, R-17 ③). 그릴 때마다 다시 적용한다
export function createGraph(container, { onSelect, onToggle = () => {}, getFilter = () => null, onFlow = () => {} }) {
  // 흐름 정렬 상태(U-7): 흐름 정렬을 하면 true, 다시 정렬·화면 다시 그리기(render)면 false. 「흐름 정렬」 단추의 눌림 표시에 쓴다
  let flowOn = false;
  const setFlow = (v) => { if (flowOn !== v) { flowOn = v; onFlow(v); } };
  const cy = cytoscape({
    container,
    elements: [],
    userZoomingEnabled: false, // 휠은 아래 wheel 이벤트에서 직접 처리한다(라이브러리의 보정으로 한 칸이 ×1.01밖에 안 됨, CR-22 G)
    minZoom: 0.2,
    maxZoom: 1.8,
    style: [
      {
        selector: 'node',
        style: {
          label: 'data(label)',
          width: 'data(size)',
          height: 'data(size)',
          // 고리 모양: 옅은 속 + 같은 색 테두리
          'background-color': colorOf,
          'background-opacity': 0.35,
          'border-width': 2.5,
          'border-color': colorOf,
          color: TEXT,
          'font-size': 14,
          'text-valign': 'bottom',
          'text-margin-y': 6,
          'text-wrap': 'wrap',
          'text-max-width': 120,
          'text-outline-color': BG,
          'text-outline-width': 2.5,
        },
      },
      {
        selector: 'node[core_type = "root"]',
        style: { 'background-opacity': 0.9, 'border-width': 4, 'font-weight': 'bold', 'font-size': 16 },
      },
      // 유형별 모양(CR-22 G): 색에만 기대지 않는다. 지도 중심은 큰 원 그대로
      ...Object.entries(TYPE_SHAPES).map(([type, shape]) => ({ selector: `node[core_type = "${type}"]`, style: { shape } })),
      // 다른 유니버스에서 참조한 노드는 점선 테두리, 합쳐진 노드는 이중 테두리(02-design 2절)
      { selector: 'node[?mixed][origin = "ref"]', style: { 'border-style': 'dashed' } },
      { selector: 'node[?merged]', style: { 'border-width': 5, 'border-style': 'double' } },
      // 공간별 강조(CR-22 G2): 기록 = 노랑 실선 / 매주 점검 = 빨강 겹테두리(무늬로도 구분) / 인수인계 = 지금 담당이 있는 항목 또렷, 나머지 업무·사람 흐리게
      { selector: 'node.mk-issue', style: { 'border-color': '#ffd84d', 'border-width': 6, 'border-style': 'solid' } },
      { selector: 'node.mk-solo', style: { 'border-color': '#ff6b6b', 'border-width': 7, 'border-style': 'double' } },
      { selector: 'node.mk-current', style: { 'border-color': '#e6ecdf', 'border-width': 4.5, 'background-opacity': 0.65 } },
      { selector: 'node.mk-dim', style: { opacity: 0.45 } },
      { selector: 'node:selected', style: { 'border-width': 4, 'border-color': '#ffffff', 'background-opacity': 0.75 } },
      { selector: 'node.hover', style: { 'border-color': '#ffffff', 'background-opacity': 0.6 } },
      {
        selector: 'edge',
        style: {
          label: '',
          'font-size': 10,
          'text-rotation': 'autorotate',
          color: MUTED,
          'text-outline-color': BG,
          'text-outline-width': 2,
          width: 1.4,
          'line-color': EDGE,
          'target-arrow-color': EDGE,
          'target-arrow-shape': 'triangle',
          'arrow-scale': 0.8,
          'curve-style': 'bezier',
          opacity: 0.9,
        },
      },
      // 연결이 많은 화면은 글자가 빽빽해지므로 이름을 숨기고, 노드를 고르거나 올리면(hood) 그 연결의 이름만 보인다
      { selector: 'edge.labeled', style: { label: 'data(label)' } },
      { selector: 'edge.hood', style: { label: 'data(label)' } },
      { selector: 'edge[?synthetic]', style: { 'line-style': 'dashed' } },
      // 요약 연결: 접힌 세부를 거쳐 올라온 연결
      { selector: 'edge[?summarized]', style: { 'line-style': 'dotted', width: 1.8 } },
      { selector: 'node[?longword]', style: { 'text-overflow-wrap': 'anywhere' } },
      { selector: 'node[?collapsed]', style: { 'border-width': 5, 'border-style': 'double', 'text-wrap': 'wrap' } },
      { selector: '.faded', style: { opacity: 0.15 } },
      { selector: 'node.time-off', style: { opacity: 0.25, 'border-style': 'dotted' } },
      { selector: 'edge.time-off', style: { display: 'none' } }, // 기준일에 유효하지 않은 담당·소속 선은 빼고 노드만 흐리게(D7, 2026-10-25)
      { selector: 'edge.hood', style: { 'line-color': ACCENT, 'target-arrow-color': ACCENT, width: 2.4, color: TEXT, opacity: 1 } },
      // 거르기에서 빠진 요소(R-17 ③, D-17): 기본은 아주 흐리게(위치는 그대로 두어 전체 모양을 잃지 않게), 'hide'면 숨김
      EXPLORE.FILTER_MODE === 'hide'
        ? { selector: '.filtered-out', style: { display: 'none' } }
        : { selector: '.filtered-out', style: { opacity: 0.08, 'text-opacity': 0 } },
      // 이름이 다른 이름과 겹치면 우선순위가 낮은 쪽을 숨긴다(CR-22 G 이름 단계 표시, applyLabels). 클래스 이름은 이전 규칙(작아서 숨김)의 것을 그대로 쓴다
      { selector: '.tiny-label', style: { 'text-opacity': 0 } },
      // 팀을 펼친 직후 펼친 항목 강조(CR-22 G 7)
      { selector: 'node.just-opened', style: { 'border-color': '#ffffff', 'border-width': 5, 'background-opacity': 0.7 } },
      // 포함 선: 아주 흐리게·화살표 없음·이름 늘 숨김(다른 연결 규칙보다 뒤에 둬서 이긴다). 고른 항목의 연결이어도 조금만 진해진다
      { selector: 'edge[?contains]', style: { opacity: LOD.CONTAINS_OPACITY, 'target-arrow-shape': 'none', label: '', width: 1 } },
      { selector: 'edge[?contains].hood', style: { opacity: 0.35, 'line-color': EDGE, 'target-arrow-color': EDGE, width: 1.2, label: '' } },
      // 찾기로 고른 노드: 노란 테두리(잠시)
      // 따라 하기가 짚는 노드(CR-13 A, ui/tour.js가 깜빡이거나 고정으로 켠다)
      // 흰 점선: 공간 강조의 노랑 실선(mk-issue)과 겹쳐 헷갈리지 않게(CR-22 G2)
      { selector: 'node.tour-target', style: { 'border-color': '#ffffff', 'border-width': 8, 'border-style': 'dashed' } },
      { selector: 'node.rw-changed', style: { 'border-color': '#ff9f43', 'border-width': 6, 'border-style': 'solid' } }, // 편집 되감기: 지금과 달라진 항목
      { selector: 'node.found', style: { 'border-color': '#ffd84d', 'border-width': 6 } },
      // 거르기에서 빠졌어도 고른·찾은·마우스를 올린 노드는 보인다(R-17 ①⑦: 거르기 중 찾기로 고르거나 새로 추가한 노드). 'hide'여도 같다
      { selector: 'node.filtered-out:selected, node.filtered-out.found, node.filtered-out.hover', style: { display: 'element', opacity: 1, 'text-opacity': 1 } },
    ],
  });

  // ── 이름 단계 표시(CR-22 G 1) ──
  // 이름은 화면 글자 크기가 배율을 거슬러 11px 밑으로 내려가지 않게 고정하고(역보정), 겹치면 우선순위 낮은 이름부터 숨긴다.
  // 지도 중심·고른 항목·그 이웃은 크게(14px 이상). 확대하면 이름 상자 사이가 벌어져 숨었던 이름이 나온다.
  // 이전 규칙(화면 6px 미만 숨김)은 150개 지도에서 이름이 1개만 보였다(검토 ② 1.3).
  const LOD_PAD = LOD.LABEL_PAD_PX;
  let focusId = null; // 고르거나 올린 항목
  let spaceMarks = { cls: null, gids: [], dim: false }; // 공간별 강조(CR-22 G2). 이름 단계(FU6-8)도 이 값을 본다
  let emph = new Set(); // 그 항목과 이웃(이름을 크게, 우선순위 1)
  let labelTimer = 0;
  let lastLabelStats = { zoom: 0, shown: 0, total: 0 };
  function applyLabels() {
    clearTimeout(labelTimer);
    labelTimer = 0;
    const z = cy.zoom();
    const nodes = cy.nodes();
    if (nodes.empty()) return;
    const normalPx = labelScreenPx(z);
    const bigPx = labelScreenPx(z, true);
    const sized = (n) => {
      const big = n.data('core_type') === 'root' || emph.has(n.id());
      const m = labelModelPx(big ? bigPx : normalPx, z);
      n.style({ 'font-size': m, 'text-max-width': m * 8.6, 'text-outline-width': m * 0.18, 'z-index': emph.has(n.id()) ? 20 : 0 });
    };
    // 거르기에서 빠진 항목은 이름이 이미 안 보이므로 자리를 차지하지 않게 뺀다(고른·찾은·올린 항목은 남김)
    const counted = nodes.filter((n) => !n.hasClass('filtered-out') || n.selected() || n.hasClass('found') || n.hasClass('hover'));
    counted.forEach((n) => {
      sized(n);
      n.removeClass('tiny-label'); // 상자를 재려면 이름이 있어야 한다(숨김 상태에서는 상자를 안 줌)
    });
    nodes.not(counted).forEach(sized);
    const items = counted.map((n) => {
      const b = n.renderedBoundingBox({ includeNodes: false, includeEdges: false, includeLabels: true, includeMainLabels: true, includeSourceLabels: false, includeTargetLabels: false, includeOverlays: false });
      const ok = b && Number.isFinite(b.x1) && b.w > 0;
      return {
        id: n.id(),
        rank: labelPriority({ type: n.data('core_type'), focus: n.id() === focusId, near: emph.has(n.id()), degree: n.data('degree') || 0, marked: n.hasClass('found') || (!!spaceMarks.cls && n.hasClass(spaceMarks.cls)) }),
        degree: n.data('degree') || 0,
        force: n.data('core_type') === 'root', // 지도 중심 이름은 겹쳐도 숨기지 않는다
        box: ok ? { x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 } : null,
      };
    });
    const shown = chooseVisibleLabels(items, LOD_PAD);
    cy.batch(() => {
      counted.forEach((n) => n.toggleClass('tiny-label', !shown.has(n.id())));
      // 연결 이름(관계 글자)도 화면 11px. 이름이 보이는 연결은 고른 항목의 연결(hood)과 연결이 적을 때 모두(labeled)뿐
      const ep = labelModelPx(LOD.EDGE_LABEL_PX, z);
      cy.edges('.hood, .labeled').style({ 'font-size': ep, 'text-outline-width': ep * 0.18 });
    });
    lastLabelStats = { zoom: z, shown: shown.size, total: counted.length };
  }
  // 확대·고르기가 이어질 때 계산을 몰아서 한 번만(150개 지도에서도 가볍게)
  function scheduleLabels(ms = 60) {
    clearTimeout(labelTimer);
    labelTimer = setTimeout(applyLabels, ms);
  }
  const applyTinyLabels = applyLabels;
  cy.on('zoom', () => scheduleLabels(50));

  // ── 휠·단추 확대(CR-22 G 4) ──
  // 라이브러리 기본 휠은 같은 크기 delta를 부정확한 장치로 보고 보정하며 wheelSensitivity를 곱해 한 칸이 ×1.01밖에 안 됐다. 직접 처리: 마우스 한 칸 ×1.15
  let userTouched = false; // 사용자가 직접 확대·이동했으면 첫 맞춤 되돌리기(settle)를 하지 않는다
  function zoomBy(factor, pos) {
    const level = nextZoom(cy.zoom(), factor, cy.minZoom(), cy.maxZoom());
    cy.zoom({ level, renderedPosition: pos || { x: cy.width() / 2, y: cy.height() / 2 } });
  }
  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    userTouched = true;
    const r = container.getBoundingClientRect();
    zoomBy(wheelZoomFactor(e.deltaY, e.deltaMode), { x: e.clientX - r.left, y: e.clientY - r.top });
  }, { passive: false });
  container.addEventListener('mousedown', () => { userTouched = true; });
  const zoomTools = el('div', { class: 'zoom-tools', role: 'group', 'aria-label': '확대·축소', 'data-testid': 'zoom-tools' },
    el('button', { type: 'button', 'data-testid': 'zoom-out', 'aria-label': '축소', title: '축소', onclick: () => { userTouched = true; zoomBy(1 / LOD.BUTTON_STEP); } }, '－'),
    el('button', { type: 'button', 'data-testid': 'zoom-in', 'aria-label': '확대', title: '확대', onclick: () => { userTouched = true; zoomBy(LOD.BUTTON_STEP); } }, '＋'),
    el('button', { type: 'button', 'data-testid': 'zoom-fit', title: '모든 항목이 한 화면에 들어오게 맞춥니다', onclick: () => { userTouched = true; fitTo(undefined, 40); } }, '맞춤'));
  // 단추를 누른 일이 그래프의 빈 곳 누르기(선택 해제)·끌기로 번지지 않게 한다
  for (const type of ['mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchend', 'pointerdown', 'wheel']) zoomTools.addEventListener(type, (e) => e.stopPropagation());
  container.append(zoomTools);

  let lastDisplay = null;
  function applyFilter() {
    cy.elements().removeClass('filtered-out');
    const f = lastDisplay ? getFilter(lastDisplay) : null;
    if (!f) return null;
    cy.nodes().forEach((n) => { if (!f.nodes.has(n.id())) n.addClass('filtered-out'); });
    cy.edges().forEach((e) => { if (!f.edges.has(e.id())) e.addClass('filtered-out'); });
    return f;
  }

  // 노드와 이웃만 또렷하게, 나머지는 흐리게. 클릭(선택)과 마우스 올림(미리 보기)이 함께 쓴다
  let nbhdCenter = null; // 주변만 보기의 가운데 항목(없으면 null)
  function focusOn(node) {
    cy.elements().removeClass('faded hood');
    // 고른·올린 항목과 이웃은 이름이 크게 보이고 먼저 놓인다(CR-22 G 5)
    focusId = node && !node.empty() ? node.id() : null;
    // 이웃이 너무 많으면(지도 중심을 골랐을 때 등) 모두 크게 키우면 서로 가려 읽을 수 없다: 그 항목만 키운다
    const hood = focusId ? node.closedNeighborhood().nodes() : null;
    emph = new Set(!hood ? [] : hood.length - 1 > LOD.EMPH_MAX_NEIGHBORS ? [focusId] : hood.map((n) => n.id()));
    scheduleLabels(16);
    if (!node || node.empty()) return;
    // 주변만 보기에서 가운데 노드를 골랐을 때는 화면의 노드가 모두 "주변"이므로 2단계 노드까지 흐리게 하지 않는다(여섯 번째 검토 U-16)
    if (nbhdCenter && node.id() === nbhdCenter) {
      node.connectedEdges().addClass('hood');
      return;
    }
    cy.elements().not(node.closedNeighborhood()).addClass('faded');
    node.connectedEdges().addClass('hood');
  }

  let selectedGid = null;
  let rwMarks = new Set(); // 편집 되감기에서 지금과 다른 항목의 gid
  const applyRwMarks = () => {
    cy.nodes().forEach((n) => n.toggleClass('rw-changed', rwMarks.has(n.id())));
  };
  let timeOff = new Set(); // 시간 슬라이더의 기준일에 유효하지 않은 항목·연결
  const applyTimeOff = () => {
    cy.elements().removeClass('time-off');
    for (const id of timeOff) cy.getElementById(id).addClass('time-off');
  };

  // 공간별 강조(CR-22 G2): {cls, gids, dim}. 그릴 때마다 다시 적용한다(render가 요소를 새로 만든다)
  const applySpaceMarks = () => {
    cy.nodes().removeClass('mk-issue mk-solo mk-current mk-dim');
    if (!spaceMarks.cls) return;
    const set = new Set(spaceMarks.gids);
    cy.nodes().forEach((n) => {
      if (set.has(n.id())) n.addClass(spaceMarks.cls);
      else if (spaceMarks.dim && set.size && ['work', 'person'].includes(n.data('core_type'))) n.addClass('mk-dim');
    });
  };

  // 노드를 고르면 그 노드와 이웃만 또렷하게 보인다(클릭 펼침)
  function highlight(gid) {
    selectedGid = gid || null;
    cy.$(':selected').unselect();
    const node = gid ? cy.getElementById(gid) : null;
    if (node && node.nonempty()) node.select();
    focusOn(node);
  }

  cy.on('tap', 'node', (evt) => onSelect(evt.target.id()));
  cy.on('tap', (evt) => {
    if (evt.target === cy) onSelect(null);
  });
  // 하위 유니버스 꼭지를 더블클릭하면 펼치거나 접는다
  cy.on('dbltap', 'node[core_type = "root"]', (evt) => onToggle(evt.target.data('universe_id')));
  // 마우스를 올리면 그 노드의 이웃을 미리 보여 주고, 떼면 선택 상태로 돌아간다
  cy.on('mouseover', 'node', (evt) => {
    evt.target.addClass('hover');
    container.style.cursor = 'pointer';
    focusOn(evt.target);
  });
  cy.on('mouseout', 'node', (evt) => {
    evt.target.removeClass('hover');
    container.style.cursor = '';
    focusOn(selectedGid ? cy.getElementById(selectedGid) : null);
  });
  // 마우스가 노드 위에서 그래프 밖으로 바로 나가면 노드의 mouseout이 오지 않을 수 있다: 키운 이름·강조를 되돌린다
  container.addEventListener('mouseleave', () => {
    cy.nodes('.hover').forEach((n) => n.removeClass('hover'));
    container.style.cursor = '';
    focusOn(selectedGid ? cy.getElementById(selectedGid) : null);
  });

  // 그래프 칸 크기가 그래프가 아는 크기와 달라지면(처음 자리 잡을 때, 위아래 줄이 늘고 줄 때) 캔버스를 다시 재고 가운데를 유지한다.
  // 2026-10-24 처음 사용 점검: 1366×768에서 칸은 580px인데 그래프는 485px로 알고 있어 아래가 잘리고 「전체 보기」도 잘린 크기에 맞춤
  // 다른 코드가 화면이 바뀌는 도중(시작 화면이 아직 남아 스크롤바가 있을 때 등)의 크기로 cy.resize()를 부르면, 그 뒤 칸 크기는 그대로라 관찰기가 다시 알리지 않는다
  // → resize를 부를 때마다 다음 프레임에 한 번 더 맞춰 본다
  const syncSize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    const dw = w - cy.width();
    const dh = h - cy.height();
    if (Math.abs(dw) < 1 && Math.abs(dh) < 1) return;
    rawResize();
    // 첫 그리기 직후(칸 크기가 아직 정해지는 중)이고 사용자가 만지지 않았으면, 가운데만 옮기지 않고 한 번 더 맞춘다(CR-22 G 9: 가장자리 잘림)
    if (settle && Date.now() < settle.until && !userTouched) {
      fitTo(undefined, 40);
      firstView(settle.display);
      return;
    }
    cy.panBy({ x: dw / 2, y: dh / 2 });
  };
  let settle = null; // {until, display}: 첫 그리기 뒤 잠시 동안 칸 크기가 바뀌면 다시 맞춘다
  const rawResize = cy.resize.bind(cy);
  let syncRaf = 0;
  cy.resize = () => {
    rawResize();
    if (typeof requestAnimationFrame === 'function' && !syncRaf) syncRaf = requestAnimationFrame(() => { syncRaf = 0; syncSize(); });
    return cy;
  };
  if (typeof ResizeObserver === 'function') new ResizeObserver(syncSize).observe(container);

  // 창 크기가 바뀌면 그래프를 다시 화면에 맞춘다
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      cy.resize();
      fitTo(undefined, 40);
    }, 150);
  });

  function fitTo(eles, padding) {
    cy.fit(eles, padding);
    applyLabels();
  }

  function layout(display) {
    setFlow(false);
    // ① 꼭지를 가운데 두고 꼭지에서 가까운 순서대로 고리를 이룬다.
    // ② 그 자리에서 출발해 연결된 노드끼리 당기고 겹친 노드는 밀어낸다(라벨 크기 포함).
    // 무작위를 쓰지 않으므로 열 때마다 같은 모양이다.
    // 배치는 이름 크기를 계산에 넣는다(nodeDimensionsIncludeLabels). 화면 배율에 맞춰 정한 이름 크기(applyLabels의 11px 고정 등)를 그대로 두면
    // 배율에 따라 배치가 달라지고 작게 보일수록 이름이 커져 배치가 넓어지는 순환이 생긴다(T-18 재검증 R1~R3). 배치하는 동안만 원래 크기로 둔다
    const BYPASS = 'font-size text-max-width text-outline-width z-index';
    cy.nodes().removeStyle(BYPASS);
    cy.nodes().removeClass('tiny-label');
    // 배치 범위는 창 크기가 아니라 항목 수로만 정한다(CR-22 G 9: 창 크기마다 모양이 바뀌지 않게). 라이브러리 기본은 그래프 칸 크기다
    const span = layoutSpan(cy.nodes().length);
    const boundingBox = { x1: 0, y1: 0, w: span, h: span };
    // 포함 선(지도 중심 → 항목)은 배치 계산에서 뺀다: 보이는 선의 21%라 교차의 4분의 3이 이 선 때문이다(검토 ② 1.3).
    // 지도 중심은 뺀 선만 가진 외톨이라 맨 마지막에 가운데(묶은 지도는 자기 항목들의 중심)에 놓는다. 주변만 보기(display.center)는 지도 중심이 이웃 하나라 선을 그대로 둔다
    const nbhdMode = !!(display && display.center);
    const containsEdges = nbhdMode ? cy.collection() : cy.edges('[?contains]');
    const rootsOut = containsEdges.sources().filter('[core_type = "root"]');
    const laid = cy.elements().not(containsEdges).not(rootsOut);
    const maxDepth = Math.max(0, ...cy.nodes().map((n) => n.data('depth')));
    cy.layout({
      name: 'concentric',
      concentric: (n) => maxDepth + 1 - n.data('depth'),
      levelWidth: () => 1,
      minNodeSpacing: 36,
      avoidOverlap: true,
      nodeDimensionsIncludeLabels: true,
      startAngle: (3 / 2) * Math.PI,
      boundingBox,
      animate: false,
      fit: false,
    }).run();
    const count = cy.nodes().length;
    const big = count > LAYOUT_LABEL_MAX_NODES;
    // 큰 지도의 높은 온도·긴 반복은 노드 수가 BIG_TUNED_MAX를 넘으면 980개 첫 열기가 2.9초 → 20초로 느려진다(R11 RV11C-4). 그 위는 예전 값
    const tuned = big && count <= BIG_TUNED_MAX;
    laid.layout({
      name: 'cose',
      randomize: false,
      animate: false,
      // 작은 지도는 이름 자리를 배치에 넣는다. 큰 지도는 이름이 다 보이지 않고 이름 단계 표시가 겹침을 풀어, 이름 자리를 빼야 연결이 덜 얽힌다
      nodeDimensionsIncludeLabels: !big,
      boundingBox,
      // 작은 지도는 고리 모양을 크게 흐트러뜨리지 않도록 낮은 온도에서 조금만 움직인다. 큰 지도는 기본 온도로 충분히 풀어야 연결이 덜 엇갈린다(150개 지도 교차 1302 → 755)
      initialTemp: tuned ? 1000 : 120,
      coolingFactor: tuned ? 0.99 : 0.97,
      idealEdgeLength: () => (big ? 50 : 80),
      edgeElasticity: () => 60,
      nodeRepulsion: () => (big ? 4500 : 9000),
      nodeOverlap: 16,
      gravity: big ? 0.8 : 0.4,
      numIter: tuned ? 1500 : 1200,
      componentSpacing: 40,
      fit: false,
    }).run();
    placeRoots(rootsOut, containsEdges, laid.nodes());
    // 배치가 끝난 뒤 새 확대 배율로 이름 크기를 다시 정한다
    cy.fit(undefined, 30);
    applyLabels();
    // 묶은 지도: 실제 이름 상자로 지도 중심끼리 겹침을 풀고(벌리면 배율이 바뀌므로 다시 맞춤) 이름 크기를 다시 정한다
    for (let i = 0; i < 4 && spreadRootLabels(rootsOut); i += 1) {
      cy.fit(undefined, 30);
      applyLabels();
    }
    if (rootsOut.length > 1) applyLabels(); // spreadRootLabels가 숨은 이름을 풀어 두었으니 다시 정한다
  }

  // 지도 중심 놓기: 하나뿐이면 나머지 항목 상자의 한가운데, 묶은 지도의 지도 중심들은 각자 포함한 항목들의 중심. 겹친 항목은 바깥으로 민다
  function placeRoots(roots, containsEdges, others) {
    if (roots.empty() || others.empty()) return;
    const bb = others.boundingBox({ includeLabels: false });
    const mid = { x: (bb.x1 + bb.x2) / 2, y: (bb.y1 + bb.y2) / 2 };
    const single = roots.length === 1;
    const spots = roots.map((r) => {
      const kids = containsEdges.filter((e) => e.source().same(r)).targets();
      let p = mid;
      if (!single && kids.nonempty()) {
        const kb = kids.boundingBox({ includeLabels: false });
        p = { x: (kb.x1 + kb.x2) / 2, y: (kb.y1 + kb.y2) / 2 };
      }
      return { id: r.id(), x: p.x, y: p.y, r: r.data('size') / 2, ...rootLabelSize(r.data('label')) };
    });
    // 지도 중심끼리 이름 상자까지 겹치면 서로 벌린 뒤(묶은 지도), 둘레의 항목(접힌 묶음의 꼭지 포함)을 바깥으로 민다
    const apart = separateLabeled(spots, LOD.ROOT_GAP_PX);
    roots.forEach((r) => r.position(apart.get(r.id())));
    clearAroundRoots(roots, others, estimatedLabelBox);
  }

  // 한 지도 중심 둘레를 비운다. 다른 지도 중심 둘레로 밀려 들어갈 수 있어 두 바퀴 돈다
  // labelBoxOf(r): 그 지도 중심의 이름 상자(원 아래, 모델 좌표). 이름 아래에 항목이 깔려 이름을 가리지 않게 상자도 비운다(CR-22 G2)
  function clearAroundRoots(roots, others, labelBoxOf) {
    for (let round = 0; round < 2; round += 1) {
      roots.forEach((r) => {
        const p = r.position();
        const radii = {};
        const pos = new Map();
        others.forEach((n) => {
          radii[n.id()] = n.data('size') / 2 + 8;
          pos.set(n.id(), { ...n.position() });
        });
        let moved = pushOutOfCenter(pos, p, r.data('size') / 2, radii);
        moved = pushOutOfBox(moved, labelBoxOf(r), radii, 2);
        moved.forEach((q, id) => cy.getElementById(id).position(q));
      });
    }
  }
  // 추정(rootLabelSize)으로 잰 이름 상자
  const estimatedLabelBox = (r) => {
    const p = r.position();
    const rad = r.data('size') / 2;
    const { w, h } = rootLabelSize(r.data('label'));
    return { x1: p.x - Math.max(rad, w / 2), x2: p.x + Math.max(rad, w / 2), y1: p.y + rad, y2: p.y + rad + h };
  };
  // 실제(현재 이름 크기)로 잰 이름 상자
  const measuredLabelBox = (r) => {
    const b = r.boundingBox({ includeNodes: true, includeEdges: false, includeLabels: true, includeMainLabels: true, includeOverlays: false });
    return { x1: b.x1, x2: b.x2, y1: r.position('y') + r.data('size') / 2, y2: b.y2 };
  };

  // 지도 중심 이름 겹침 풀기(CR-22 G2): 이름은 화면 크기가 고정이라 축소된 화면에서는 그래프 좌표의 이름이 커진다. 처음 놓을 때의 추정(rootLabelSize)이 모자랄 수 있어,
  // 맞춤·이름 크기 계산이 끝난 뒤 실제 이름 상자를 재서 한 번 더 벌린다(벌리면 배율이 바뀌므로 최대 4번). 움직였으면 true
  function spreadRootLabels(roots) {
    if (roots.length < 2) return false;
    const z = cy.zoom();
    const items = roots.map((r) => {
      const b = r.boundingBox({ includeNodes: true, includeEdges: false, includeLabels: true, includeMainLabels: true, includeOverlays: false });
      const p = r.position();
      const rad = r.data('size') / 2;
      return { id: r.id(), x: p.x, y: p.y, r: rad, w: b.w, h: Math.max(0, b.y2 - (p.y + rad)) };
    });
    const apart = separateLabeled(items, LOD.ROOT_GAP_SCREEN_PX / z);
    let moved = 0;
    roots.forEach((r) => {
      const q = apart.get(r.id());
      const p = r.position();
      moved = Math.max(moved, Math.hypot(q.x - p.x, q.y - p.y));
      r.position(q);
    });
    if (moved > 0.5) clearAroundRoots(roots, cy.nodes().not(roots), measuredLabelBox);
    // 지도 중심(원+이름) 상자에 걸친 항목은 이름 상자까지 포함해 가장 가까운 바깥으로 민다: 지도 중심 이름이 항목 이름을 숨기는 것을 줄인다
    const pad = 3 / z;
    let shifted = 0;
    const others = cy.nodes().not(roots);
    others.removeClass('tiny-label'); // 숨은 이름은 상자가 없다: 재기 위해 모두 보이게 두고, 호출한 쪽이 applyLabels로 다시 정한다
    for (let round = 0; round < 2; round += 1) {
      roots.forEach((r) => {
        const rb = r.boundingBox({ includeNodes: true, includeEdges: false, includeLabels: true, includeMainLabels: true, includeOverlays: false });
        others.forEach((n) => {
          const nb = n.boundingBox({ includeNodes: true, includeEdges: false, includeLabels: true, includeMainLabels: true, includeOverlays: false });
          const ox = Math.min(rb.x2, nb.x2) - Math.max(rb.x1, nb.x1) + pad;
          const oy = Math.min(rb.y2, nb.y2) - Math.max(rb.y1, nb.y1) + pad;
          if (ox <= 0 || oy <= 0) return;
          const p = n.position();
          const cxr = (rb.x1 + rb.x2) / 2;
          const cyr = (rb.y1 + rb.y2) / 2;
          if (ox <= oy) n.position({ x: p.x + ((nb.x1 + nb.x2) / 2 >= cxr ? ox : -ox), y: p.y });
          else n.position({ x: p.x, y: p.y + ((nb.y1 + nb.y2) / 2 >= cyr ? oy : -oy) });
          shifted += Math.min(ox, oy);
        });
      });
    }
    return moved > 0.5 || shifted > 0.5;
  }

  // 묶은 지도(CR-18-1): 처음 그릴 때 fit 결과에서 이름이 EXPLORE.FIRST_READ_PX보다 작게 보이면, 지도 중심을 가운데 두고 배율을 올려 시작한다.
  // 노드가 일반 이름 글자 크기(14px)를 기준으로 판단한다. 전체가 다 안 보여도 되며 「전체 보기」(fit)가 전체를 다시 맞춘다
  const NAME_FONT_PX = 14;
  let firstViewInfo = { raised: false, fitZoom: 0, zoom: 0 };
  function firstView(display) {
    const fitZoom = cy.zoom();
    const grouped = display.nodes.filter((n) => n.core_type === 'root').length > 1;
    const r = firstViewZoom({ fitZoom, fontPx: NAME_FONT_PX, readPx: EXPLORE.FIRST_READ_PX, grouped, minZoom: cy.minZoom(), maxZoom: cy.maxZoom() });
    firstViewInfo = { raised: r.raised, fitZoom, zoom: r.zoom };
    if (!r.raised) return;
    const root = cy.getElementById(display.rootGid);
    cy.zoom(r.zoom);
    if (root.nonempty()) cy.center(root);
    else cy.center();
    applyTinyLabels();
  }

  return {
    cy,
    highlight,
    /** 점검용: 마지막 첫 배율 판정 {raised, fitZoom, zoom} */
    firstViewInfo: () => firstViewInfo,

    // 처음에는 전체 배치를 계산한다. 이후(노드 추가 등)에는 기존 노드 자리를 그대로 두고
    // 새 노드만 이웃 옆이나 그래프 바깥쪽에 놓아, 보던 모양이 흐트러지지 않게 한다
    render(display, selectedGid) {
      setFlow(false);
      const before = new Map(cy.nodes().map((n) => [n.id(), { ...n.position() }]));
      emph = new Set(); // 요소를 새로 만들면 덮어쓴 글자 크기도 사라진다(고른 항목은 아래 highlight가 다시 키운다)
      focusId = null;
      cy.elements().remove();
      cy.add(toElements(display));
      cy.edges().toggleClass('labeled', cy.edges().length <= LABEL_EDGE_LIMIT);
      cy.resize();
      if (before.size === 0) {
        layout(display);
      } else {
        // 새 노드는 이웃 둘레의 빈자리에, 이름 크기를 반영해 겹치지 않게 놓는다(T-19 B-P4, view/place.js)
        // (CR-22 G: 이름은 화면 11px 고정이라 그래프 좌표의 글자 크기가 배율마다 달라진다. 자리 계산은 14px 기준 상자를 그대로 쓴다 —
        //  배율에 따라 간격을 키우면 더 작게 보이고 → 이름이 더 커지는 순환이 생긴다. 겹치는 이름은 이름 단계 표시가 낮은 순위부터 숨긴다)
        const box = (n, pos) => {
          const b = labelBox(n.data('label'), n.data('size'));
          return { x1: pos.x - b.w / 2, x2: pos.x + b.w / 2, y1: pos.y - b.size / 2, y2: pos.y - b.size / 2 + b.h };
        };
        const existing = [];
        const fresh = [];
        cy.nodes().forEach((n) => {
          if (before.has(n.id())) {
            n.position(before.get(n.id()));
            existing.push(box(n, before.get(n.id())));
            return;
          }
          const placed = n.neighborhood('node').filter((m) => before.has(m.id()));
          fresh.push({ n, item: { id: n.id(), label: n.data('label'), size: n.data('size'), anchor: placed.nonempty() ? before.get(placed[0].id()) : null } });
        });
        const spots = placeNewNodes(existing, fresh.map((f) => f.item));
        fresh.forEach(({ n }) => n.position(spots.get(n.id())));
        if (fresh.length > 0) fitTo(undefined, 40);
      }
      if (before.size === 0) {
        firstView(display);
        // 칸 크기가 아직 정해지는 중일 수 있다: 잠시 동안 크기가 바뀌면 syncSize가 한 번 더 맞춘다(CR-22 G 9)
        userTouched = false;
        settle = { until: Date.now() + 1500, display };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(syncSize));
      }
      applyTimeOff();
      applySpaceMarks();
      lastDisplay = display;
      nbhdCenter = display.center || null;
      applyTinyLabels(); // 새로 만든 요소에는 판정이 없다(확대가 그대로면 zoom 이벤트도 오지 않음)
      applyFilter();
      highlight(selectedGid);
    },

    /** 거르기 조건이 바뀌면 다시 적용하고, 또렷한 노드에 맞춰 화면을 맞춘다(노드가 적을수록 이름이 커진다) */
    applyFilter() {
      const f = applyFilter();
      // 꼭지는 위치 기준이라 늘 남지만 여기저기 흩어져 있어, 꼭지까지 맞추면 거른 노드 이름이 작아진다: 꼭지가 아닌 남은 노드에 맞춘다
      const kept = cy.nodes().not('.filtered-out');
      const focus = kept.filter((n) => n.data('core_type') !== 'root');
      const eles = !f ? cy.elements() : focus.nonempty() ? focus : kept;
      fitTo(eles, 60);
    },

    /** 찾은 노드를 가운데로 옮기고 이름이 읽히게 확대한다. 노란 테두리로 잠시 표시(R-17 ①) */
    zoomTo(gid) {
      const node = cy.getElementById(gid);
      if (node.empty()) return false;
      cy.nodes('.found').removeClass('found');
      node.addClass('found');
      cy.animate({ center: { eles: node }, zoom: Math.max(cy.zoom(), 1.2) }, { duration: 250 });
      setTimeout(() => node.removeClass('found'), 4000);
      return true;
    },

    /** 편집 되감기: 지금과 달라진 노드 gid들에 표시를 단다(빈 목록이면 해제) */
    setRewindMarks(gids) {
      rwMarks = new Set(gids);
      applyRwMarks();
    },

    /** 시간 슬라이더: 기준일에 유효하지 않은 요소 ID들을 흐리게 표시한다(빈 목록이면 해제) */
    setTimeOff(ids) {
      timeOff = new Set(ids);
      applyTimeOff();
    },

    /** 공간별 강조(CR-22 G2): cls를 gids의 항목에 단다. dim이면 강조되지 않은 업무·사람을 흐리게. cls가 null이면 해제 */
    setSpaceMarks({ cls = null, gids = [], dim = false } = {}) {
      spaceMarks = { cls, gids, dim };
      applySpaceMarks();
      applyTinyLabels(); // 강조된 항목은 이름이 숨지 않게 이름 단계를 다시 계산(FU6-8)
    },

    // 배치를 처음부터 다시 계산한다("정렬" 버튼)
    relayout() {
      layout(lastDisplay);
      settle = null; // 사용자가 다시 정렬했으면 첫 맞춤 되돌리기는 끝
    },

    /** 흐름 정렬(시제품): 가로는 업무의 선후, 세로는 유형 층. 「다시 정렬」로 원래 고리 배치로 돌아간다 */
    flowLayout() {
      if (!lastDisplay) return;
      const nodes = cy.nodes().map((n) => ({ id: n.id(), core_type: n.data('core_type'), label: n.data('label'), size: n.data('size') }));
      const ids = new Set(nodes.map((n) => n.id));
      const edges = (lastDisplay.edges || []).filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ source: e.source, target: e.target, core_type: e.core_type || e.type }));
      const pos = flowLayout(nodes, edges);
      cy.nodes().forEach((n) => {
        const p = pos.get(n.id());
        if (p) n.position(p);
      });
      fitTo(undefined, 40);
      applyTinyLabels();
      setFlow(true);
    },

    fit() {
      fitTo(undefined, 40);
    },

    /**
     * 팀(하위 지도)을 펼친 직후(CR-22 G 7): 펼친 지도의 항목들에 맞춰 화면을 맞추고 잠시 강조한다. 올려 둔 강조는 풀고 고른 항목 기준으로 되돌린다.
     * @returns {boolean} 펼친 항목이 있으면 true
     */
    showOpened(universeId) {
      cy.nodes('.hover').removeClass('hover');
      focusOn(selectedGid ? cy.getElementById(selectedGid) : null);
      const opened = cy.nodes().filter((n) => n.data('universe_id') === universeId);
      if (opened.empty()) return false;
      cy.nodes('.just-opened').removeClass('just-opened');
      opened.addClass('just-opened');
      setTimeout(() => opened.removeClass('just-opened'), 3500);
      // 펼친 항목이 한두 개뿐이면 그것만 맞추면 너무 크게 확대된다: 이웃까지 넣어 맞추고, 어느 쪽이든 1.2배를 넘기지 않는다
      fitTo(opened.length >= 4 ? opened : opened.closedNeighborhood().nodes(), 70);
      if (cy.zoom() > 1.2) {
        cy.zoom({ level: 1.2, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
        applyLabels();
      }
      return true;
    },

    /** 점검용: 이름 계산을 지금 끝낸다(확대 뒤 지연 계산을 기다리지 않고 확인) */
    refreshLabels: applyLabels,
    /** 점검용: 마지막 이름 계산 {zoom, shown, total} */
    labelStats: () => lastLabelStats,

    /**
     * 화면 상태 저장(FU5-7): 항목 자리·배율·이동·칸 크기. 편집 되감기처럼 배치를 다시 계산하는 화면에 들어가기 전에 찍어 두고, 돌아올 때 restore로 되돌린다.
     * 원인: 되감기에 들어갈 때 배치를 새로 계산(relayout)하고 위쪽에 머리 띠가 생기며, 나올 때는 항목만 다시 그려 그 배치·배율이 그대로 남았다
     */
    snapshot() {
      syncSize();
      return { pos: new Map(cy.nodes().map((n) => [n.id(), { ...n.position() }])), zoom: cy.zoom(), pan: { ...cy.pan() }, w: cy.width(), h: cy.height() };
    },

    /** snapshot으로 되돌린다. 없어진 항목은 건너뛰고(새로 생긴 항목은 render가 놓은 자리 그대로), 칸 크기가 달라졌으면 가운데를 유지한다 */
    restore(snap) {
      if (!snap) return;
      syncSize();
      cy.nodes().forEach((n) => {
        const p = snap.pos.get(n.id());
        if (p) n.position(p);
      });
      cy.viewport({ zoom: snap.zoom, pan: { x: snap.pan.x + (cy.width() - snap.w) / 2, y: snap.pan.y + (cy.height() - snap.h) / 2 } });
      applyLabels();
    },
  };
}
