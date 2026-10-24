// 상세 패널에 보여 줄 내용을 view에서 만든다(R-01, R-14). 화면(DOM)에 의존하지 않는 순수 함수.
// ui는 이 결과를 그리기만 한다. 그래야 Node에서 테스트할 수 있다(12.7).

import { EDGE_TYPES, MEMO_CATEGORIES, eventTypeLabel, memoCategoryOf } from '../model/schema.js';
import { refGid } from './view.js';

const FIELD_NAMES = {
  label: '이름', description: '설명', attrs: '속성', tags: '태그', period: '기간', subtype: '하위 유형', emp_no: '사번', note: '메모', exposed: '상위 화면에서 보이기',
};
const EDGE_ORDER = Object.keys(EDGE_TYPES);

/**
 * 기준일에 이 기간이 어떤 상태인가(12.2: 끝이 없으면 진행 중). 기간이 없으면 current.
 * 담당 판정(인사이트·초안·상세)이 모두 이 함수를 쓴다.
 * @returns {'current'|'ended'|'scheduled'}
 */
export function periodStatus(period, asOf) {
  if (!period) return 'current';
  if (period.start && period.start > asOf) return 'scheduled';
  if (period.end && period.end < asOf) return 'ended';
  return 'current';
}

// 기간 표시. 끝이 없으면 진행 중이다(12.2). 기준일을 주면 아직 시작 전인 기간은 "예정"으로 쓴다
export function periodText(period, asOf = null) {
  if (!period || (!period.start && !period.end)) return '';
  if (asOf && periodStatus(period, asOf) === 'scheduled') return `${period.start}${period.end ? ` ~ ${period.end}` : '부터'} (시작 예정)`;
  return `${period.start || '?'} ~ ${period.end || '진행 중'}`;
}

const STATUS_LABEL = { current: '현재', ended: '종료', scheduled: '예정' };

/** 문장·근거 칩에 쓰는 노드 이름. 숨긴 노드는 표시를 붙인다(4절 "숨김 후 참조"). 초안·이력 문장·근거 칩이 모두 이것을 쓴다(검토5 C-2) */
export const displayName = (node) => (node.deleted ? '(삭제된 노드)' : node.hidden ?`${node.label}(숨김 처리된 노드)` : node.label);

/** 이름에 띄어쓰기 없이 긴 낱말(10자 이상)이 있는가. 그래프가 그런 이름만 글자 단위로 줄바꿈한다(화면 점검 S-3, 재검증) */
export const hasLongWord = (label, max = 9) => String(label || '').split(/\s+/).some((w) => w.length > max);

function fieldValue(v) {
  if (v === null || v === undefined) return '(없음)';
  if (typeof v === 'boolean') return v ? '예' : '아니요';
  if (typeof v === 'object') return periodText(v) || JSON.stringify(v);
  return String(v);
}

// 속성(attrs) 수정 이력의 한 칸 값: 길면 줄인다. 원문 JSON 대신 읽기 쉬운 글로 보인다(처음 사용 점검 FU-15)
export const ATTR_VALUE_MAX = 60;
const attrValue = (v) => {
  const s = v === null || v === undefined || v === '' ? '(없음)' : String(v).replace(/\s+/g, ' ').trim();
  return s.length > ATTR_VALUE_MAX ? `${s.slice(0, ATTR_VALUE_MAX)}…` : s;
};

/**
 * 속성 수정 전·후(키→값 객체)에서 바뀐 값만 읽기 쉬운 글로: 「주기: 매월 · 마감: 매월 말」.
 * 새로 생긴 속성은 「키: 값」, 값이 바뀌면 「키: 이전 → 새」, 지운 속성은 「키: 지움(이전)」. 바뀐 것이 없으면 ''.
 * 객체가 아니면(깨진 이력) null — 부르는 쪽이 예전 방식으로 보인다.
 */
export function attrsChangeText(before, after) {
  const plain = (o) => o === null || o === undefined || (typeof o === 'object' && !Array.isArray(o));
  if (!plain(before) || !plain(after)) return null;
  const b = before || {};
  const a = after || {};
  const has = (o, k) => Object.hasOwn(o, k) && o[k] !== null && o[k] !== undefined && o[k] !== '';
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  const parts = [];
  for (const k of keys) {
    const hb = has(b, k);
    const ha = has(a, k);
    if (hb && ha && String(b[k]) === String(a[k])) continue;
    if (!hb && !ha) continue;
    parts.push(!hb ? `${k}: ${attrValue(a[k])}` : !ha ? `${k}: 지움(${attrValue(b[k])})` : `${k}: ${attrValue(b[k])} → ${attrValue(a[k])}`);
  }
  return parts.join(' · ');
}

// 이벤트를 한 줄 문장으로. 노드 ID는 라벨로 바꾸고, 숨긴 노드는 표시를 붙인다
// opts.tagIssue(CR-18 D-14): 이력 목록은 모든 메모에 분류 꼬리표를 붙인다 — 이슈만 빠지던 결함. 근거 글(LLM 입력·근거 칩·문서 출력)의 문장은 그대로 두려고 기본은 false다
export function eventText(view, ev, { tagIssue = false } = {}) {
  const p = ev.payload || {};
  const name = (id) => {
    if (!id) return null;
    const node = view.getNode(refGid(ev.universe_id, id));
    if (!node) return id;
    return displayName(node);
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
      // 둘 다 없으면 괄호를 생략한다(「(미기재 → 미기재): 조직개편: …」처럼 같은 말이 겹쳐 보이지 않게, 검토9 R-6)
      const fromOrg = name(p.from_org_id);
      const toOrg = name(p.to_org_id);
      const orgs = !fromOrg && !toOrg ? '' : ` (${fromOrg || '미기재'} → ${toOrg || '미기재'})`;
      return `${name(p.person_id)} 소속 변경${orgs}${ev.note ? `: ${ev.note}` : ''}`;
    }
    case 'memo': {
      const cat = memoCategoryOf(p);
      return `${(cat === 'issue' && !tagIssue) || !Object.hasOwn(MEMO_CATEGORIES, cat) ? '' : `[${MEMO_CATEGORIES[cat]}] `}${ev.note || '메모'}`;
    }
    case 'created':
    case 'updated':
      if (p.target_kind === 'identity_link' && ev.link) {
        const raw = (g) => { const n = view.rawNode(g); return n ? `${n.label}(${n.universe_name})` : g; };
        const what = { person: '사람으로', work: '업무로', topic: '주제로' }[ev.link.kind] || '노드로';
        const verdict = ev.type === 'updated' ? (p.after && p.after.status) : ev.link.status;
        const word = verdict === 'confirmed' ? `같은 ${what} 확인` : verdict === 'rejected' ? `다른 ${what} 판정` : '확인 대기로 둠';
        return `통합 확인 — ${raw(ev.link.a)} · ${raw(ev.link.b)}: ${word}${ev.link.method === 'emp_no_auto' ? '(사번 자동)' : ''}`;
      }
      if (ev.type === 'created') return '생성';
      // 완전히 삭제(CR-13 D): 지운 필드 이름만 남기고 값은 남기지 않는다
      if (p.after && p.after.deleted === true) return `완전히 삭제(내용 지움${Array.isArray(p.cleared_fields) ? `: ${p.cleared_fields.map((k) => FIELD_NAMES[k] || k).join(', ')}` : ''})`;
      // 숨긴 노드·연결을 되살림(R-21): updated의 hidden true → false
      if (p.before && p.before.hidden === true && p.after && p.after.hidden === false && Object.keys(p.after).length === 1) return '되살림(숨김 해제)';
      {
        const keys = Object.keys(p.after || {});
        const changes = keys.map((k) => {
          // 속성은 바뀐 값만(FU-15): 「속성: 주기: 매월 · 마감: 매월 말」. 객체가 아니거나 바뀐 것을 못 찾으면 예전 방식
          const detail = k === 'attrs' ? attrsChangeText(p.before && p.before[k], p.after[k]) : null;
          if (detail) return `${FIELD_NAMES[k] || k}: ${detail}`;
          return `${FIELD_NAMES[k] || k}: ${fieldValue(p.before && p.before[k])} → ${fieldValue(p.after[k])}`;
        });
        if (!changes.length && (ev.payload && ev.payload.cleared)) return '수정(내용 지움)';
        return `수정 — ${changes.join(', ') || '변경 내용 없음'}`;
      }
    case 'hidden':
      return '숨김 처리';
    default:
      return ev.note || eventTypeLabel(ev.type);
  }
}

/**
 * 기준일의 소속(R-14). 소속 연결(기간이 기준일에 걸친 것)이 있으면 그 조직, 없으면 기준일 이전 마지막 소속 변경 이력.
 * 조직 노드가 다른 유니버스에 있어 ID가 없으면 "미기재"이고, 이력 메모를 함께 돌려준다.
 * @returns {{label:string, from:'edge'|'event'|null, event_gid:string|null, note:string}}
 */
export function affiliationAt(view, personGid, asOf) {
  const g = view.canonical(personGid);
  // 숨긴 조직으로 가는 연결은 건너뛴다(상세 연결 목록과 맞춤, 검토 2026-10-17)
  const edge = view.edges.find((e) => !e.hidden && e.core_type === 'belongs_to' && e.source === g && periodStatus(e.period, asOf) === 'current'
    && !(view.getNode(e.target) || {}).hidden);
  if (edge) return { label: view.getNode(edge.target)?.label || '미기재', from: 'edge', event_gid: null, note: '' };
  const evs = (view.index.eventsByNode.get(g) || []).filter((ev) => ev.type === 'affiliation_change' && ev.occurred_at <= asOf);
  if (!evs.length) return { label: '미기재', from: null, event_gid: null, note: '' };
  const ev = evs[evs.length - 1];
  const to = ev.payload.to_org_id ? view.getNode(refGid(ev.universe_id, ev.payload.to_org_id)) : null;
  return { label: to ? to.label : '미기재', from: 'event', event_gid: ev.gid, note: `${ev.occurred_at} 소속 변경${ev.note ? `: ${ev.note}` : ''}` };
}

/**
 * 노드 상세. 없는 노드는 {found:false}. 숨긴 노드도 내용을 돌려주고 hidden으로 알린다(4절 "숨김 후 참조").
 * links가 비어 있으면 "연결 없음"이다(R-01 ②).
 */
export function describeNode(view, gid, { asOf = null, past = false } = {}) {
  const { found, hidden, node } = view.lookup(gid);
  if (!found) return { found: false };

  const rows = [{ label: '유형', value: node.type_label + (node.subtype ? ` > ${node.subtype}` : '') }];
  if (node.emp_no) rows.push({ label: '사번', value: node.emp_no });
  if (asOf && node.core_type === 'person') {
    const aff = affiliationAt(view, node.gid, asOf);
    if (aff.from) rows.push({ label: '소속(기준일)', value: aff.note && aff.label === '미기재' ? `미기재 — ${aff.note}` : aff.label });
  }
  if (node.description) rows.push({ label: '설명', value: node.description });
  for (const [k, v] of Object.entries(node.attrs || {})) rows.push({ label: k, value: String(v) });
  if (node.period) rows.push({ label: '기간', value: periodText(node.period, asOf) });
  if (node.tags && node.tags.length) rows.push({ label: '태그', value: node.tags.join(', ') });
  rows.push({
    label: '출처',
    value: node.origin === 'ref' ? `참조한 업무 지도: ${node.universe_name}` : `이 업무 지도(${node.universe_name})`,
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
      period: periodText(edge.period, asOf),
      // 수행 연결은 기준일 기준 현재·종료·예정을 붙인다(사람·업무 상세에서 지금 담당을 구분하도록)
      status_key: asOf && edge.core_type === 'performs' && !edge.synthetic ? periodStatus(edge.period, asOf) : null,
      status: asOf && edge.core_type === 'performs' && !edge.synthetic ? (past && periodStatus(edge.period, asOf) === 'current' ? '그때 담당' : STATUS_LABEL[periodStatus(edge.period, asOf)]) : null,
      note: edge.note || '',
      other: { gid: other.gid, label: other.label, type_label: other.type_label },
    }))
    .sort((a, b) => EDGE_ORDER.indexOf(a.relation_type) - EDGE_ORDER.indexOf(b.relation_type) || a.other.label.localeCompare(b.other.label));

  const history = (view.index.eventsByNode.get(node.gid) || []).map((ev) => ({
    gid: ev.gid,
    date: ev.occurred_at,
    type_label: eventTypeLabel(ev.type),
    text: eventText(view, ev, { tagIssue: true }),
    // 시간 슬라이더로 과거를 볼 때 기준일 이후 이력은 흐리게 보인다
    after: !!asOf && ev.occurred_at > asOf,
  }));

  return { found: true, gid: node.gid, title: node.label, core_type: node.core_type, hidden, deleted: !!node.deleted, rows, links, no_links: links.length === 0, history };
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
    empno_conflicts: view.empno_conflicts || [],
    stale_links: view.stale_links || [],
  };
}
