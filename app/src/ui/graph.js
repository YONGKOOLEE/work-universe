// 그래프 라이브러리(Cytoscape.js) 연결. 다른 모듈은 이 파일을 통해서만 라이브러리를 쓴다.
// 입력은 층별 보기 결과(view/collapse.js projectView)다. 접힌 하위 유니버스는 꼭지를 크게 그리고 가려진 노드 수를 붙인다.

import cytoscape from 'cytoscape';
import { NODE_TYPES, UNKNOWN_TYPE_LABEL } from '../model/schema.js';

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
const BG = '#0f1510';
const TEXT = '#e6ecdf';
const MUTED = '#8f9d88';
const EDGE = '#3d5536';
const ACCENT = '#a6d86b';

const colorOf = (el) => TYPE_COLORS[el.data('core_type')] || UNKNOWN_COLOR;

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
          longword: String(n.label).split(/s+/).some((w) => w.length > 9),
          core_type: n.core_type,
          origin: n.origin,
          merged: n.merged_from.length > 0,
          depth: depth.get(gid),
          // 연결이 많을수록 크게(참고 화면처럼 허브가 눈에 띄게)
          size: n.core_type === 'root' ? (hiddenCount ? 64 + Math.min(hiddenCount, 40) : 54) : 24 + Math.min(deg, 8) * 3,
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
      },
    })),
  ];
}

// 범례에 보여 줄 유형(현재 그래프에 있는 것만). 모르는 유형은 "기타" 하나로 묶는다
export function legendItems(display) {
  const present = new Set(display.nodes.map((n) => n.core_type));
  const items = Object.entries(NODE_TYPES)
    .filter(([key]) => present.has(key))
    .map(([key, label]) => ({ key, label, color: TYPE_COLORS[key] }));
  if ([...present].some((t) => !NODE_TYPES[t])) items.push({ key: 'unknown', label: UNKNOWN_TYPE_LABEL, color: UNKNOWN_COLOR });
  return items;
}

export function createGraph(container, { onSelect, onToggle = () => {} }) {
  const cy = cytoscape({
    container,
    elements: [],
    wheelSensitivity: 0.3,
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
      // 다른 유니버스에서 참조한 노드는 점선 테두리, 합쳐진 노드는 이중 테두리(02-design 2절)
      { selector: 'node[?mixed][origin = "ref"]', style: { 'border-style': 'dashed' } },
      { selector: 'node[?merged]', style: { 'border-width': 5, 'border-style': 'double' } },
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
      { selector: 'edge.time-off', style: { opacity: 0.2, 'line-style': 'dotted' } },
      { selector: 'edge.hood', style: { 'line-color': ACCENT, 'target-arrow-color': ACCENT, width: 2.4, color: TEXT, opacity: 1 } },
    ],
  });

  // 노드와 이웃만 또렷하게, 나머지는 흐리게. 클릭(선택)과 마우스 올림(미리 보기)이 함께 쓴다
  function focusOn(node) {
    cy.elements().removeClass('faded hood');
    if (!node || node.empty()) return;
    cy.elements().not(node.closedNeighborhood()).addClass('faded');
    node.connectedEdges().addClass('hood');
  }

  let selectedGid = null;
  let timeOff = new Set(); // 시간 슬라이더의 기준일에 유효하지 않은 노드·연결
  const applyTimeOff = () => {
    cy.elements().removeClass('time-off');
    for (const id of timeOff) cy.getElementById(id).addClass('time-off');
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

  // 창 크기가 바뀌면 그래프를 다시 화면에 맞춘다
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      cy.resize();
      cy.fit(undefined, 40);
    }, 150);
  });

  function layout() {
    // ① 꼭지를 가운데 두고 꼭지에서 가까운 순서대로 고리를 이룬다.
    // ② 그 자리에서 출발해 연결된 노드끼리 당기고 겹친 노드는 밀어낸다(라벨 크기 포함).
    // 무작위를 쓰지 않으므로 열 때마다 같은 모양이다.
    const maxDepth = Math.max(0, ...cy.nodes().map((n) => n.data('depth')));
    cy.layout({
      name: 'concentric',
      concentric: (n) => maxDepth + 1 - n.data('depth'),
      levelWidth: () => 1,
      minNodeSpacing: 36,
      avoidOverlap: true,
      nodeDimensionsIncludeLabels: true,
      startAngle: (3 / 2) * Math.PI,
      animate: false,
      fit: false,
    }).run();
    cy.layout({
      name: 'cose',
      randomize: false,
      animate: false,
      nodeDimensionsIncludeLabels: true,
      // 고리 모양을 크게 흐트러뜨리지 않도록 낮은 온도에서 조금만 움직인다
      initialTemp: 120,
      coolingFactor: 0.97,
      idealEdgeLength: () => 80,
      edgeElasticity: () => 60,
      nodeRepulsion: () => 9000,
      nodeOverlap: 16,
      gravity: 0.4,
      numIter: 1200,
      fit: true,
      padding: 30,
    }).run();
  }

  return {
    cy,
    highlight,

    // 처음에는 전체 배치를 계산한다. 이후(노드 추가 등)에는 기존 노드 자리를 그대로 두고
    // 새 노드만 이웃 옆이나 그래프 바깥쪽에 놓아, 보던 모양이 흐트러지지 않게 한다
    render(display, selectedGid) {
      const before = new Map(cy.nodes().map((n) => [n.id(), { ...n.position() }]));
      cy.elements().remove();
      cy.add(toElements(display));
      cy.edges().toggleClass('labeled', cy.edges().length <= LABEL_EDGE_LIMIT);
      cy.resize();
      if (before.size === 0) {
        layout();
      } else {
        const box = cy.nodes().filter((n) => before.has(n.id())).boundingBox();
        let slot = 0;
        cy.nodes().forEach((n) => {
          if (before.has(n.id())) return n.position(before.get(n.id()));
          const placed = n.neighborhood('node').filter((m) => before.has(m.id()));
          if (placed.nonempty()) {
            const p = before.get(placed[0].id());
            n.position({ x: p.x + 90, y: p.y + 60 + slot * 40 });
          } else {
            n.position({ x: box.x2 + 80, y: box.y1 + 40 + slot * 70 });
          }
          slot += 1;
        });
        if (slot > 0) cy.fit(undefined, 40);
      }
      applyTimeOff();
      highlight(selectedGid);
    },

    /** 시간 슬라이더: 기준일에 유효하지 않은 요소 ID들을 흐리게 표시한다(빈 목록이면 해제) */
    setTimeOff(ids) {
      timeOff = new Set(ids);
      applyTimeOff();
    },

    // 배치를 처음부터 다시 계산한다("정렬" 버튼)
    relayout() {
      layout();
    },

    fit() {
      cy.fit(undefined, 40);
    },
  };
}
