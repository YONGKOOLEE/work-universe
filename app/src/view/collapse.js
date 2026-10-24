// 층별 보기(CR-4 제안): 상위 유니버스에서 하위 유니버스를 접어서 보여 준다.
// 노드를 복사하지 않고 "보여 주는 수준"만 줄인다. 계산(규칙)은 buildView의 전체 데이터를 쓰고, 화면만 이 결과를 쓴다.
// 브라우저 기능을 쓰지 않는 순수 함수.
//
// - 기준 유니버스와 펼친 유니버스: 모든 노드
// - 접힌 하위 유니버스: 꼭지 + 위로 드러낼 노드(exposure)
// - 숨겨진 노드에 붙은 연결은 포함 관계를 따라 올라가 가장 가까운 보이는 노드로 옮긴다(요약 연결)

import { toGid } from './view.js';

/**
 * 노드를 위층에 드러낼지. node.exposed(사용자 지정)가 있으면 그것을, 없으면 기본 규칙을 따른다.
 * 기본: 꼭지, 담당자(수행 연결이 있는 사람), 최상위 업무(다른 업무에 포함되지 않은 업무), 유니버스 사이 공유 주제.
 * @returns {{exposed:boolean, explicit:boolean, reason:string}}
 */
/**
 * exposureOf가 노드마다 연결 전체를 훑지 않도록 유니버스별로 한 번만 계산해 두는 표(여덟 번째 검토 7b).
 * performers: 유니버스 → 수행 연결의 출발 노드 집합, underWork: 유니버스 → 업무에 포함된 대상 노드 집합
 */
export function exposureIndex(view) {
  const performers = new Map();
  const underWork = new Map();
  const setOf = (m, u) => {
    if (!m.has(u)) m.set(u, new Set());
    return m.get(u);
  };
  for (const e of view.edges) {
    if (e.hidden || e.synthetic) continue;
    if (e.core_type === 'performs') setOf(performers, e.universe_id).add(e.source);
    else if (e.core_type === 'contains' && view.getNode(e.source)?.core_type === 'work') setOf(underWork, e.universe_id).add(e.target);
  }
  return { performers, underWork };
}

export function exposureOf(view, gid, index = null) {
  const node = view.rawNode(gid);
  if (!node) return { exposed: false, explicit: false, reason: '' };
  if (node.core_type === 'root') return { exposed: true, explicit: false, reason: '지도 중심' };
  if (typeof node.exposed === 'boolean') {
    return { exposed: node.exposed, explicit: true, reason: node.exposed ? '직접 드러냄' : '직접 숨김' };
  }
  const idx = index || exposureIndex(view);
  const canon = view.canonical(gid);
  switch (node.core_type) {
    case 'person': {
      const performs = !!idx.performers.get(node.universe_id)?.has(canon);
      return { exposed: performs, explicit: false, reason: performs ? '담당자' : '담당 업무 없음' };
    }
    case 'work': {
      const underWork = !!idx.underWork.get(node.universe_id)?.has(canon);
      return { exposed: !underWork, explicit: false, reason: underWork ? '하위 업무' : '최상위 업무' };
    }
    case 'topic': {
      const shared = view.getNode(gid).merged_from.length > 0;
      return { exposed: shared, explicit: false, reason: shared ? '다른 업무 지도와 공유한 주제' : '이 업무 안의 주제' };
    }
    default:
      return { exposed: false, explicit: false, reason: '세부 정보' };
  }
}

/**
 * @param {object} view buildView 결과
 * @param {{expanded?: Set<string>}} [opts] 펼친 하위 유니버스 ID
 * @returns {{nodes:object[], edges:object[], rootGid:string, collapsed:Map<string,{hidden_count:number}>}}
 */
export function projectView(view, { expanded = new Set() } = {}) {
  const rootId = view.universe_id;

  // 1) 어떤 유니버스를 보여 줄지: 기준 + 그 하위. 펼친 유니버스는 다시 그 하위까지
  const children = new Map();
  for (const { parent, child } of view.ref_links) {
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(child);
  }
  const full = new Set([rootId]);
  const collapsedU = new Set();
  const queue = [rootId];
  while (queue.length) {
    const u = queue.shift();
    for (const ch of children.get(u) || []) {
      if (full.has(ch) || collapsedU.has(ch)) continue;
      if (expanded.has(ch)) {
        full.add(ch);
        queue.push(ch);
      } else {
        collapsedU.add(ch);
      }
    }
  }

  // 2) 원래(합치기 전) 노드 단위로 보일지 정한다. 펼친 유니버스의 원본이 있으면 보인다.
  //    접힌 원본만 있으면: 어느 원본에든 직접 지정(위층에 드러내기)이 있으면 그 지정을 따르고, 없으면 기본 규칙 중 하나라도 맞으면 보인다
  //    (검토 2026-10-03: 합쳐진 윤바다의 드러내기를 꺼도 다른 원본의 기본 규칙 때문에 계속 보이던 문제)
  const visible = new Set();
  const expIndex = exposureIndex(view);
  for (const n of view.nodes) {
    if (n.hidden) continue;
    const raws = [n.gid, ...n.merged_from].map((g) => view.rawNode(g)).filter((r) => r && !r.hidden);
    if (raws.some((r) => full.has(r.universe_id))) {
      visible.add(n.gid);
      continue;
    }
    // 직접 지정은 원본이 어느 단계에 있든(손자 유니버스여도) 본다. 직접 숨김만 있으면 숨긴다
    const explicit = raws.map((r) => exposureOf(view, r.gid, expIndex)).filter((e) => e.explicit);
    if (explicit.length && !explicit.some((e) => e.exposed)) continue;
    const exp = raws.filter((r) => collapsedU.has(r.universe_id)).map((r) => exposureOf(view, r.gid, expIndex));
    if (exp.some((e) => e.exposed)) visible.add(n.gid);
  }

  // 3) 숨겨진 노드의 대리 노드: 포함 관계를 따라 올라가 처음 만나는 보이는 노드
  const parentOf = new Map();
  for (const e of view.edges) {
    if (!e.hidden && !e.synthetic && e.core_type === 'contains' && !parentOf.has(e.target)) parentOf.set(e.target, e.source);
  }
  const repOf = (gid) => {
    let g = gid;
    const seen = new Set();
    while (g && !visible.has(g)) {
      if (seen.has(g)) return null;
      seen.add(g);
      g = parentOf.get(g);
    }
    return g || null;
  };

  // 4) 연결: 끝점을 대리 노드로 옮기고, 같은 (출발, 도착, 관계)는 하나로 모은다
  const byKey = new Map();
  const shownU = new Set([...full, ...collapsedU]);
  // 숨긴 노드의 연결은 요약 연결로도 되살리지 않는다(그래프와 상세·개요 연결 수가 같은 말을 하도록, 여섯 번째 검토 C-5)
  const hiddenEnd = (g) => { const n = view.getNode(g); return !!n && n.hidden; };
  for (const e of view.edges) {
    if (e.hidden || !shownU.has(e.universe_id) || hiddenEnd(e.source) || hiddenEnd(e.target)) continue;
    const s = repOf(e.source);
    const t = repOf(e.target);
    if (!s || !t || s === t) continue;
    const summarized = s !== e.source || t !== e.target;
    const key = `${s}|${t}|${e.core_type}|${e.synthetic ? 'ref' : ''}`;
    const prev = byKey.get(key);
    if (prev) {
      prev.count += 1;
      prev.summarized = prev.summarized || summarized;
    } else {
      byKey.set(key, { ...e, gid: summarized ? `sum:${key}` : e.gid, source: s, target: t, summarized, count: 1 });
    }
  }

  // 5) 접힌 유니버스마다 가려진 노드 수(꼭지에 표시). 그 아래 하위 유니버스의 노드도 센다
  const below = (u) => {
    const out = new Set([u]);
    const stack = [u];
    while (stack.length) for (const ch of children.get(stack.pop()) || []) if (!out.has(ch)) { out.add(ch); stack.push(ch); }
    return out;
  };
  const collapsed = new Map();
  for (const u of collapsedU) {
    const scope = below(u);
    const hidden = view.nodes.filter((n) => scope.has(n.universe_id) && !n.hidden && !visible.has(n.gid)).length;
    collapsed.set(u, { hidden_count: hidden, root_gid: toGid(u, view.universes.get(u).root_node_id) });
  }

  return {
    nodes: view.nodes.filter((n) => visible.has(n.gid)),
    edges: [...byKey.values()],
    rootGid: toGid(rootId, view.universe.root_node_id),
    collapsed,
    expandable: new Set([...collapsedU, ...[...full].filter((u) => u !== rootId)]),
  };
}
