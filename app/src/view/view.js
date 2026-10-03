// 합성 뷰(12.7 view): 유니버스 + 꼭지 참조(재귀) + 동일성 연결 → 화면·규칙이 쓰는 읽기 전용 그래프.
// 원본 문서는 바꾸지 않는다(R-11 ⑤). 노드마다 출처를 전역 참조("<유니버스 ID>/<노드 ID>")로 유지한다.
// 브라우저 기능(DOM, 저장소)을 쓰지 않는다.

import { EVENT_PAYLOAD, edgeTypeLabel, nodeTypeLabel, NODE_TYPES, normalizeEmpNo, normalizeLabel } from '../model/schema.js';

export function toGid(universeId, localId) {
  return `${universeId}/${localId}`;
}

/** 이벤트·연결 안의 ID를 전역 참조로: "/"가 있으면 이미 전역, 없으면 그 문서(유니버스) 안의 ID다(12.1). 규칙·화면이 모두 이것을 쓴다(검토5 C-4) */
export const refGid = (universeId, id) => (id.includes('/') ? id : toGid(universeId, id));

export function parseGid(gid) {
  const i = typeof gid === 'string' ? gid.indexOf('/') : -1;
  return i < 0 ? null : { universe_id: gid.slice(0, i), local_id: gid.slice(i + 1) };
}

function pushTo(map, key, value) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * @param {object} rootDoc 기준 유니버스 문서(12.2)
 * @param {(universeId:string)=>object|null} [resolveUniverse] 참조된 유니버스 문서를 찾는 함수
 * @returns 노드·연결·이벤트(전역 ID)와 조회 표(1.7)를 가진 읽기 전용 뷰
 */
export function buildView(rootDoc, resolveUniverse = () => null) {
  // 1) 참조를 재귀로 펼친다. 순환은 건너뛰고 기록한다(순환 자체는 저장 때 E-CYCLE로 거부)
  const docs = [];
  const included = new Set();
  const missing = [];
  const cyclic = [];
  const refLinks = [];

  function visit(doc, chain) {
    included.add(doc.universe.id);
    docs.push(doc);
    for (const ref of (doc.refs || []).filter((r) => !r.hidden)) {
      const childId = ref.child_universe_id;
      if (chain.has(childId)) {
        cyclic.push({ parent: doc.universe.id, child: childId });
        continue;
      }
      const child = resolveUniverse(childId);
      if (!child) {
        if (!missing.includes(childId)) missing.push(childId);
        continue;
      }
      refLinks.push({ parent: doc, child });
      if (!included.has(childId)) visit(child, new Set([...chain, childId]));
    }
  }
  visit(rootDoc, new Set([rootDoc.universe.id]));

  // 2) 노드
  const rootId = rootDoc.universe.id;
  const nodes = [];
  const nodeByGid = new Map();
  for (const doc of docs) {
    for (const n of doc.nodes) {
      const node = {
        gid: toGid(doc.universe.id, n.id),
        universe_id: doc.universe.id,
        universe_name: doc.universe.name,
        id: n.id,
        core_type: n.core_type,
        type_label: nodeTypeLabel(n.core_type),
        known_type: !!NODE_TYPES[n.core_type],
        subtype: n.subtype,
        label: n.label,
        description: n.description,
        attrs: n.attrs,
        tags: n.tags,
        period: n.period,
        emp_no: n.emp_no,
        exposed: n.exposed,
        hidden: !!n.hidden,
        origin: doc.universe.id === rootId ? 'own' : 'ref',
        merged_from: [],
      };
      nodes.push(node);
      nodeByGid.set(node.gid, node);
    }
  }

  // 3) 동일성 연결: 확정된 것만 합친다. 대표는 숨기지 않은 노드 중 먼저 나온 것(기준 유니버스 우선)
  const order = new Map(nodes.map((n, i) => [n.gid, (n.hidden ? nodes.length : 0) + i]));
  const parent = new Map();
  const find = (g) => {
    let r = g;
    while (parent.has(r)) r = parent.get(r);
    return r;
  };
  const unresolvedLinks = [];
  const staleLinks = []; // 사번 자동 연결인데 그 뒤 사번이 바뀌어 더는 맞지 않는 연결(다시 확인 필요)
  for (const doc of docs) {
    for (const link of doc.identity_links || []) {
      if (link.status !== 'confirmed') continue;
      if (!nodeByGid.has(link.a) || !nodeByGid.has(link.b)) {
        unresolvedLinks.push(link.id);
        continue;
      }
      if (link.method === 'emp_no_auto') {
        const [x, y] = [nodeByGid.get(link.a), nodeByGid.get(link.b)];
        if (!x.emp_no || !y.emp_no || normalizeEmpNo(x.emp_no) !== normalizeEmpNo(y.emp_no)) {
          staleLinks.push(link.id);
          continue;
        }
      }
      const ra = find(link.a);
      const rb = find(link.b);
      if (ra === rb) continue;
      if (order.get(ra) <= order.get(rb)) parent.set(rb, ra);
      else parent.set(ra, rb);
    }
  }
  const canonical = (gid) => (nodeByGid.has(gid) ? find(gid) : gid);
  // 판정한 쌍(대표 노드 기준). 같은 사람이 여러 유니버스에 있어도 한 번 판정하면 된다
  const decidedPairs = new Set(docs.flatMap((d) => (d.identity_links || []).filter((l) => l.status !== 'pending').map((l) => [canonical(l.a), canonical(l.b)].sort().join('|'))));
  for (const n of nodes) {
    const c = canonical(n.gid);
    if (c !== n.gid) nodeByGid.get(c).merged_from.push(n.gid);
  }
  // 대표 노드는 합쳐진 노드가 모두 숨겨졌을 때만 숨김으로 본다
  for (const n of nodes) {
    if (n.merged_from.length) n.hidden = n.hidden && n.merged_from.every((g) => nodeByGid.get(g).hidden);
  }
  const viewNodes = nodes.filter((n) => canonical(n.gid) === n.gid);

  // 4) 연결: 끝점을 대표 노드로 바꾸고, 참조 관계는 부모 꼭지 → 자식 꼭지의 합성 연결로 나타낸다
  const edges = [];
  for (const doc of docs) {
    for (const e of doc.edges) {
      const source = canonical(toGid(doc.universe.id, e.source));
      const target = canonical(toGid(doc.universe.id, e.target));
      if (source === target) continue; // 합쳐진 두 노드 사이의 연결은 자기 연결이 되므로 그리지 않는다
      edges.push({
        gid: toGid(doc.universe.id, e.id),
        universe_id: doc.universe.id,
        id: e.id,
        source,
        target,
        core_type: e.core_type,
        type_label: edgeTypeLabel(e.core_type),
        subtype: e.subtype,
        period: e.period,
        note: e.note,
        hidden: !!e.hidden,
        synthetic: false,
      });
    }
  }
  for (const { parent: p, child: c } of refLinks) {
    const source = canonical(toGid(p.universe.id, p.universe.root_node_id));
    const target = canonical(toGid(c.universe.id, c.universe.root_node_id));
    if (source === target) continue;
    edges.push({
      gid: toGid(p.universe.id, `ref:${c.universe.id}`),
      universe_id: p.universe.id,
      id: `ref:${c.universe.id}`,
      source,
      target,
      core_type: 'contains',
      type_label: edgeTypeLabel('contains'),
      hidden: false,
      synthetic: true,
    });
  }

  // 5) 이벤트: 노드 참조를 전역 ID(대표 노드 기준)로 모아 두고 시간순으로 정렬한다
  const events = [];
  for (const doc of docs) {
    for (const ev of doc.events) {
      const rule = EVENT_PAYLOAD[ev.type] || {};
      const payload = ev.payload || {};
      const toNodeGid = (id) => canonical(refGid(doc.universe.id, id));
      const nodeGids = [];
      for (const k of rule.nodeRefs || []) if (payload[k]) nodeGids.push(toNodeGid(payload[k]));
      for (const k of rule.nodeListRefs || []) for (const id of payload[k] || []) nodeGids.push(toNodeGid(id));
      if (payload.target_kind === 'node' && payload.target_id) nodeGids.push(toNodeGid(payload.target_id));
      // 동일성 판정(T-10): 두 노드의 이력에 모두 남긴다
      const link = payload.target_kind === 'identity_link' ? (doc.identity_links || []).find((l) => l.id === payload.target_id) : null;
      if (link) for (const g of [link.a, link.b]) if (nodeByGid.has(g)) nodeGids.push(canonical(g));
      events.push({
        gid: toGid(doc.universe.id, ev.id),
        universe_id: doc.universe.id,
        id: ev.id,
        type: ev.type,
        occurred_at: ev.occurred_at,
        recorded_at: ev.recorded_at,
        source: ev.source,
        payload,
        note: ev.note,
        node_gids: [...new Set(nodeGids)],
        ...(link ? { link: { a: link.a, b: link.b, kind: link.kind, status: link.status, method: link.method } } : {}),
      });
    }
  }
  // 업무 시점 → 기록 시각(시간대를 반영한 시각으로 비교) → ID 순. 같은 날짜의 이력은 기록한 순서대로 쌓인다
  const instant = (s) => {
    const t = Date.parse(s);
    return Number.isNaN(t) ? 0 : t;
  };
  events.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || instant(a.recorded_at) - instant(b.recorded_at) || a.gid.localeCompare(b.gid));

  // 6) 조회 표(1.7). 숨긴 노드는 사번·유형+라벨·주제 조회에서 빠지고, 이력(eventsByNode)은 남긴다
  const byEmpNo = new Map();
  const byTypeLabel = new Map();
  const eventsByNode = new Map();
  const nodesByTopic = new Map();
  for (const n of viewNodes) {
    if (n.hidden) continue;
    if (n.core_type === 'person' && n.emp_no) pushTo(byEmpNo, normalizeEmpNo(n.emp_no), n);
    pushTo(byTypeLabel, `${n.core_type}|${normalizeLabel(n.label)}`, n);
  }
  for (const ev of events) for (const g of ev.node_gids) pushTo(eventsByNode, g, ev);
  for (const e of edges) {
    if (e.hidden || e.core_type !== 'relates_to') continue;
    const src = nodeByGid.get(e.source);
    const tgt = nodeByGid.get(e.target);
    if (src && tgt && !src.hidden && !tgt.hidden && tgt.core_type === 'topic') pushTo(nodesByTopic, tgt.gid, src);
  }

  const view = {
    universe_id: rootId,
    universe: rootDoc.universe,
    nodes: viewNodes,
    // 합치기 전의 모든 노드(통합 확인 목록 계산용, T-10)
    raw_nodes: nodes,
    edges,
    events,
    missing, // 찾지 못한 하위 유니버스 ID
    cyclic, // 순환이라 건너뛴 참조
    ref_links: refLinks.map(({ parent: p, child: ch }) => ({ parent: p.universe.id, child: ch.universe.id })),
    universes: new Map(docs.map((d) => [d.universe.id, d.universe])),
    unresolved_links: unresolvedLinks,
    stale_links: staleLinks,
    // 같은 사번인데 이름이 다른 사람(W-EMPNO-CONFLICT, 4절 사번 충돌). 자동으로 합치지 않고 알리기만 한다(R-11 ③)
    // 사람이 이미 판정한 쌍(같은 사람으로 확인 또는 다른 사람으로 판정)만 남은 충돌은 알리지 않는다(T-10)
    empno_conflicts: [...byEmpNo.entries()]
      .filter(([, list]) => list.some((x, i) => list.slice(i + 1).some((y) => normalizeLabel(x.label) !== normalizeLabel(y.label) && !decidedPairs.has([x.gid, y.gid].sort().join('|')))))
      .map(([emp_no, list]) => ({ code: 'W-EMPNO-CONFLICT', emp_no, nodes: list.map((n) => ({ gid: n.gid, label: n.label, universe_name: n.universe_name })) })),
    index: { byEmpNo, byTypeLabel, eventsByNode, nodesByTopic },

    canonical,
    getNode: (gid) => nodeByGid.get(canonical(gid)),
    // 합쳐지기 전의 원래 노드(동일성 연결된 다른 유니버스의 노드 확인용)
    rawNode: (gid) => nodeByGid.get(gid),

    // 근거 ID 확인용. 숨긴 노드도 내용을 유지해 돌려주고 hidden으로 알린다(4절 "숨김 후 참조")
    lookup(gid) {
      const node = nodeByGid.get(canonical(gid));
      return node ? { found: true, hidden: node.hidden, node } : { found: false, hidden: false, node: null };
    },

    // 근거 ID가 가리키는 노드나 이력이 있는가(공급자 결과의 근거 검증용, 검토5 C-2)
    exists: (gid) => view.lookup(gid).found || events.some((e) => e.gid === gid),

    // 화면에 보일 노드·연결(숨김 제외). 끝점이 숨겨진 연결도 뺀다
    visible() {
      const vn = viewNodes.filter((n) => !n.hidden);
      const ids = new Set(vn.map((n) => n.gid));
      return { nodes: vn, edges: edges.filter((e) => !e.hidden && ids.has(e.source) && ids.has(e.target)) };
    },

    // 노드에 연결된 보이는 연결과 반대편 노드. 없으면 빈 배열("연결 없음")
    neighbors(gid) {
      const g = canonical(gid);
      const { edges: ve } = view.visible();
      return ve
        .filter((e) => e.source === g || e.target === g)
        .map((e) => ({ edge: e, direction: e.source === g ? 'out' : 'in', other: nodeByGid.get(e.source === g ? e.target : e.source) }));
    },
  };
  return view;
}
