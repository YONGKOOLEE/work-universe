// 숨긴 노드 목록(R-21). 순수 함수 — 문서 하나(현재 유니버스)만 본다.

import { nodeTypeLabel } from '../model/schema.js';

/**
 * 숨긴 노드 [{id, label, core_type, type_label, hidden_at, edge_count}]. 꼭지는 숨길 수 없으므로, 완전히 삭제한 자리표시 노드(deleted)는 되살릴 수 없으므로 제외한다.
 * hidden_at = 그 노드의 가장 늦은 「숨김」 이벤트의 업무 시점(없으면 빈 문자열). 최근에 숨긴 것이 위.
 */
export function hiddenNodesOf(doc) {
  const hiddenAt = new Map();
  for (const e of doc.events || []) {
    if (e.type !== 'hidden' || !e.payload || e.payload.target_kind !== 'node') continue;
    const prev = hiddenAt.get(e.payload.target_id);
    if (!prev || e.recorded_at >= prev.recorded_at) hiddenAt.set(e.payload.target_id, e);
  }
  return doc.nodes
    .filter((n) => n.hidden && !n.deleted && n.core_type !== 'root')
    .map((n) => {
      const ev = hiddenAt.get(n.id);
      return { id: n.id, label: n.label, core_type: n.core_type, type_label: nodeTypeLabel(n.core_type), hidden_at: ev ? ev.occurred_at : '', edge_count: (doc.edges || []).filter((e) => e.source === n.id || e.target === n.id).length };
    })
    .sort((a, b) => b.hidden_at.localeCompare(a.hidden_at) || a.label.localeCompare(b.label, 'ko'));
}
