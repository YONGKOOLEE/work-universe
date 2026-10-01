// 상세 패널에 보여 줄 내용을 view에서 만든다(R-01, R-14). 화면(DOM)에 의존하지 않는 순수 함수.
// ui는 이 결과를 그리기만 한다. 그래야 Node에서 테스트할 수 있다(12.7).

import { EDGE_TYPES, MEMO_CATEGORIES, eventTypeLabel, memoCategoryOf } from '../model/schema.js';
import { toGid } from './view.js';

const FIELD_NAMES = {
  label: '라벨', description: '설명', attrs: '속성', tags: '태그', period: '기간', subtype: '하위 유형', emp_no: '사번', note: '메모',
};
const EDGE_ORDER = Object.keys(EDGE_TYPES);

// 기간 표시. 끝이 없으면 진행 중이다(12.2)
export function periodText(period) {
  if (!period || (!period.start && !period.end)) return '';
  return `${period.start || '?'} ~ ${period.end || '진행 중'}`;
}

function fieldValue(v) {
  if (v === null || v === undefined) return '(없음)';
  if (typeof v === 'object') return periodText(v) || JSON.stringify(v);
  return String(v);
}

// 이벤트를 한 줄 문장으로. 노드 ID는 라벨로 바꾸고, 숨긴 노드는 표시를 붙인다
export function eventText(view, ev) {
  const p = ev.payload || {};
  const name = (id) => {
    if (!id) return null;
    const node = view.getNode(id.includes('/') ? id : toGid(ev.universe_id, id));
    if (!node) return id;
    return node.hidden ? `${node.label}(숨김 처리된 노드)` : node.label;
  };
  switch (ev.type) {
    case 'assign_start':
      return `${name(p.person_id)} 담당 시작 — ${name(p.work_id)}`;
    case 'assign_end':
      return `${name(p.person_id)} 담당 종료 — ${name(p.work_id)}`;
    case 'handover': {
      const basis = p.artifact_id ? ` (근거: ${name(p.artifact_id)})` : ' (인수인계서 없음)';
      return `${name(p.from_person_id)} → ${name(p.to_person_id)} 인수인계 — ${name(p.work_id)}${basis}${ev.note ? `. ${ev.note}` : ''}`;
    }
    case 'affiliation_change': {
      // 조직 노드가 다른 유니버스에 있으면 ID가 없다. 없는 값은 "미기재"(R-14)
      const orgs = p.from_org_id || p.to_org_id ? ` (${name(p.from_org_id) || '미기재'} → ${name(p.to_org_id) || '미기재'})` : '';
      return `${name(p.person_id)} 소속 변경${orgs}${ev.note ? `: ${ev.note}` : ''}`;
    }
    case 'memo': {
      const cat = memoCategoryOf(p);
      return `${cat === 'issue' ? '' : `[${MEMO_CATEGORIES[cat]}] `}${ev.note || '메모'}`;
    }
    case 'updated': {
      const keys = Object.keys(p.after || {});
      const changes = keys.map((k) => `${FIELD_NAMES[k] || k}: ${fieldValue(p.before && p.before[k])} → ${fieldValue(p.after[k])}`);
      return `수정 — ${changes.join(', ') || '변경 내용 없음'}`;
    }
    case 'hidden':
      return '숨김 처리';
    case 'created':
      return '생성';
    default:
      return ev.note || eventTypeLabel(ev.type);
  }
}

/**
 * 노드 상세. 없는 노드는 {found:false}. 숨긴 노드도 내용을 돌려주고 hidden으로 알린다(4절 "숨김 후 참조").
 * links가 비어 있으면 "연결 없음"이다(R-01 ②).
 */
export function describeNode(view, gid) {
  const { found, hidden, node } = view.lookup(gid);
  if (!found) return { found: false };

  const rows = [{ label: '유형', value: node.type_label + (node.subtype ? ` > ${node.subtype}` : '') }];
  if (node.emp_no) rows.push({ label: '사번', value: node.emp_no });
  if (node.description) rows.push({ label: '설명', value: node.description });
  for (const [k, v] of Object.entries(node.attrs || {})) rows.push({ label: k, value: String(v) });
  if (node.period) rows.push({ label: '기간', value: periodText(node.period) });
  if (node.tags && node.tags.length) rows.push({ label: '태그', value: node.tags.join(', ') });
  rows.push({
    label: '출처',
    value: node.origin === 'ref' ? `참조한 유니버스: ${node.universe_name}` : `이 유니버스(${node.universe_name})`,
  });
  const others = node.merged_from.map((g) => view.rawNode(g)).filter(Boolean);
  if (others.length) rows.push({ label: '같은 노드', value: `${others.map((n) => n.universe_name).join(', ')}의 노드와 합쳐져 있음` });

  const links = view
    .neighbors(gid)
    .map(({ edge, direction, other }) => ({
      edge_gid: edge.gid,
      synthetic: !!edge.synthetic,
      direction,
      relation: edge.synthetic ? '포함(참조)' : edge.type_label + (edge.subtype ? ` > ${edge.subtype}` : ''),
      relation_type: edge.core_type,
      period: periodText(edge.period),
      note: edge.note || '',
      other: { gid: other.gid, label: other.label, type_label: other.type_label },
    }))
    .sort((a, b) => EDGE_ORDER.indexOf(a.relation_type) - EDGE_ORDER.indexOf(b.relation_type) || a.other.label.localeCompare(b.other.label));

  const history = (view.index.eventsByNode.get(node.gid) || []).map((ev) => ({
    gid: ev.gid,
    date: ev.occurred_at,
    type_label: eventTypeLabel(ev.type),
    text: eventText(view, ev),
  }));

  return { found: true, gid: node.gid, title: node.label, core_type: node.core_type, hidden, rows, links, no_links: links.length === 0, history };
}

/** 노드를 고르지 않았을 때 보여 줄 유니버스 개요. */
export function describeUniverse(view) {
  const { nodes, edges } = view.visible();
  const counts = new Map();
  for (const n of nodes) counts.set(n.type_label, (counts.get(n.type_label) || 0) + 1);
  const dates = view.events.map((e) => e.occurred_at);
  return {
    name: view.universe.name,
    level: view.universe.level,
    owner: view.universe.owner,
    description: view.universe.description || '',
    counts: [...counts].map(([type_label, count]) => ({ type_label, count })),
    node_total: nodes.length,
    edge_total: edges.length,
    period: dates.length ? { first: dates[0], last: dates[dates.length - 1] } : null,
    missing: view.missing,
  };
}
