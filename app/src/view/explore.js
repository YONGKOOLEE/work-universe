// 큰 화면 탐색: 찾기·거르기·주변만 보기(T-18, R-17, D-17). CR-10 B 시제품(브랜치 proto-cr10-btable)을 정식으로 다시 짠 것.
// 브라우저 기능(DOM, 저장소)을 쓰지 않는 순수 함수. 입력은 buildView 결과(view)와 층별 보기 결과(display)이고,
// 데이터를 바꾸지 않는다(R-17 ⑤). 결과는 노드 전역 참조(gid) 집합이다.

import { normalizeLabel } from '../model/schema.js';

// 찾기용 정규화: 대소문자·공백 차이를 무시한다(" 대 사 " = "대사")
const norm = (s) => normalizeLabel(String(s || '')).replace(/\s+/g, '');

/**
 * 이름 일부로 노드를 찾는다(R-17 ①②). 숨긴 노드는 빼고, 접힌 하위 유니버스 안의 노드도 찾는다(view 전체가 대상).
 * 합쳐진 노드(동일성 연결)는 원래 이름 중 하나라도 맞으면 찾는다.
 * 순서: 이름이 검색어로 시작하는 것 → 가나다순.
 * @returns {{gid:string, label:string, core_type:string, type_label:string, universe_name:string}[]} 맞는 것 전부(자르기는 화면 몫)
 */
export function searchNodes(view, query) {
  const q = norm(query);
  if (!q) return [];
  const hits = [];
  for (const n of view.nodes) {
    if (n.hidden) continue;
    // 합쳐진 원본 중 숨긴 것의 이름으로는 찾지 않는다(숨긴 노드는 찾기에 나오지 않음, T-18 오류 검증)
    const names = [n.label, ...(n.merged_from || []).map((g) => view.rawNode(g)).filter((r) => r && !r.hidden).map((r) => r.label)].filter(Boolean);
    const keys = names.map(norm);
    if (!keys.some((k) => k.includes(q))) continue;
    hits.push({ gid: n.gid, label: n.label, core_type: n.core_type, type_label: n.type_label, universe_name: n.universe_name, prefix: keys.some((k) => k.startsWith(q)) });
  }
  hits.sort((a, b) => Number(b.prefix) - Number(a.prefix) || a.label.localeCompare(b.label, 'ko') || a.gid.localeCompare(b.gid));
  return hits.map(({ prefix, ...h }) => h);
}

/**
 * 거르기(R-17 ③): 지금 그린 그래프(display)에서 또렷하게 남길 노드·연결을 계산한다.
 * 꼭지(하위 유니버스 꼭지 포함)는 위치를 잡는 기준이라 늘 남긴다.
 * @param {object} display projectView 또는 neighborhoodDisplay 결과
 * @param {{types?: string[]|null, person?: string|null}} filter types: 남길 노드 유형, person: 고른 사람(전역 ID)
 * @returns {null | {nodes:Set<string>, edges:Set<string>, shown:number, total:number}} 거르기가 없으면 null
 */
export function filterDisplay(display, filter = {}) {
  const types = filter.types && filter.types.length ? new Set(filter.types) : null;
  const person = filter.person || null;
  if (!types && !person) return null;
  let keep = new Set(display.nodes.filter((n) => n.core_type === 'root' || !types || types.has(n.core_type)).map((n) => n.gid));
  const edges = new Set();
  if (person) {
    // 그 사람 + 그 사람이 맡은(수행) 업무. 접힌 세부 업무는 요약 연결의 끝(대표 노드)으로 나타난다.
    // 유형도 골랐으면 두 조건을 모두 만족하는 것만(꼭지는 위와 같이 늘 남김)
    const mine = display.edges.filter((e) => e.core_type === 'performs' && e.source === person);
    const own = new Set([person, ...mine.map((e) => e.target)]);
    keep = new Set([...keep].filter((g) => own.has(g) || (display.nodes.find((n) => n.gid === g) || {}).core_type === 'root'));
    for (const e of mine) if (keep.has(e.source) && keep.has(e.target)) edges.add(e.gid);
  } else {
    for (const e of display.edges) if (keep.has(e.source) && keep.has(e.target)) edges.add(e.gid);
  }
  return { nodes: keep, edges, shown: keep.size, total: display.nodes.length };
}

/** 거르기 「사람 하나」에 고를 수 있는 사람(지금 그래프에 있는 사람), 가나다순 */
export function personsIn(display) {
  return display.nodes.filter((n) => n.core_type === 'person').sort((a, b) => a.label.localeCompare(b.label, 'ko') || a.gid.localeCompare(b.gid));
}

/**
 * 주변만 보기(R-17 ④): 노드 하나와 depth단계 안의 이웃만 남긴 화면용 그래프(projectView와 같은 모양).
 * 접힘과 무관하게 전체 그래프(숨김 제외)에서 이웃을 찾는다. 연결 방향은 무시한다.
 * @returns {null | {nodes:object[], edges:object[], rootGid:string, collapsed:Map, expandable:Set, center:string, depth:number, neighbor_count:number}}
 *   노드가 없거나 숨겨졌으면 null. 이웃이 없으면 neighbor_count 0(화면은 바꾸지 않는다 — ui 몫)
 */
export function neighborhoodDisplay(view, gid, depth = 1) {
  const center = view.canonical(gid);
  const node = view.getNode(center);
  if (!node || node.hidden) return null;
  const { nodes, edges } = view.visible();
  const adj = new Map(nodes.map((n) => [n.gid, []]));
  for (const e of edges) {
    if (!adj.has(e.source) || !adj.has(e.target)) continue;
    adj.get(e.source).push(e.target);
    adj.get(e.target).push(e.source);
  }
  const dist = new Map([[center, 0]]);
  const queue = [center];
  while (queue.length) {
    const g = queue.shift();
    if (dist.get(g) >= depth) continue;
    for (const nb of adj.get(g) || []) {
      if (!dist.has(nb)) {
        dist.set(nb, dist.get(g) + 1);
        queue.push(nb);
      }
    }
  }
  // rootGid를 가운데 노드로 두면 graph.js 배치가 그 노드에서 고리로 퍼진다
  return {
    nodes: nodes.filter((n) => dist.has(n.gid)),
    edges: edges.filter((e) => dist.has(e.source) && dist.has(e.target)),
    rootGid: center,
    collapsed: new Map(),
    expandable: new Set(),
    center,
    depth,
    neighbor_count: dist.size - 1,
  };
}
