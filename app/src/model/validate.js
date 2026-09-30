// 유니버스 문서 검증(12.2·12.5). 불러오기·가져오기 때 쓴다. 순수 함수.
// 모르는 노드·관계 유형은 오류로 멈추지 않고 통과시킨다(1.3, 화면에서 "기타"로 표시).

import { findDuplicateEdge, findDuplicateNode, isDate, periodError, subtypeRegistered } from './checks.js';
import {
  CODES,
  EDGE_TYPES,
  EVENT_PAYLOAD,
  EVENT_SOURCES,
  EVENT_TYPES,
  IDENTITY_KINDS,
  IDENTITY_METHODS,
  IDENTITY_STATUSES,
  LABEL_MAX,
  NODE_TYPES,
  SCHEMA_VERSION,
  pairAllowed,
} from './schema.js';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isBlank = (v) => typeof v !== 'string' || v.trim() === '';
const isGlobalRef = (v) => typeof v === 'string' && v.includes('/');

/**
 * @param {object} doc 12.2 유니버스 문서
 * @returns {{ok:boolean, errors:{code:string, path:string, [k:string]:any}[], warnings:object[], readOnly:boolean}}
 *   readOnly: 스키마 버전이 달라 읽기 전용으로 열어야 함(12.1)
 */
export function validateDocument(doc) {
  const errors = [];
  const warnings = [];
  const err = (code, path, extra = {}) => errors.push({ code, path, ...extra });
  const result = (readOnly = false) => ({ ok: errors.length === 0, errors, warnings, readOnly });

  if (!isObject(doc)) {
    err(CODES.SCHEMA, '');
    return result();
  }
  if (doc.schema_version !== SCHEMA_VERSION) {
    err(CODES.SCHEMA, 'schema_version', { found: doc.schema_version });
    return result(true);
  }
  if (!isObject(doc.universe)) err(CODES.SCHEMA, 'universe');
  for (const k of ['nodes', 'edges', 'events', 'refs', 'identity_links']) {
    if (!Array.isArray(doc[k])) err(CODES.SCHEMA, k);
  }
  if (errors.length) return result();

  const u = doc.universe;
  for (const k of ['id', 'name', 'level', 'owner', 'root_node_id']) {
    if (isBlank(u[k])) err(CODES.REQUIRED, `universe.${k}`);
  }
  if (typeof u.name === 'string' && u.name.trim().length > LABEL_MAX) err(CODES.REQUIRED, 'universe.name');
  if (u.subtypes !== undefined && !Array.isArray(u.subtypes)) err(CODES.SCHEMA, 'universe.subtypes');
  const seenSubtypes = new Set();
  (Array.isArray(u.subtypes) ? u.subtypes : []).forEach((s, i) => {
    const path = `universe.subtypes[${i}]`;
    if (!isObject(s) || isBlank(s.name)) return err(CODES.REQUIRED, path);
    if (!NODE_TYPES[s.core_type] && !EDGE_TYPES[s.core_type]) return err(CODES.SCHEMA, path);
    const key = `${s.core_type}|${s.name}`;
    if (seenSubtypes.has(key)) err(CODES.DUP, path);
    seenSubtypes.add(key);
  });

  // 노드
  const nodesById = new Map();
  doc.nodes.forEach((n, i) => {
    const path = `nodes[${i}]`;
    if (!isObject(n) || isBlank(n.id)) return err(CODES.REQUIRED, `${path}.id`);
    if (nodesById.has(n.id)) err(CODES.DUP, `${path}.id`, { existing_id: n.id });
    else nodesById.set(n.id, n);
    if (isBlank(n.core_type)) err(CODES.REQUIRED, `${path}.core_type`);
    if (isBlank(n.label) || n.label.trim().length > LABEL_MAX) err(CODES.REQUIRED, `${path}.label`);
    if (n.subtype && !subtypeRegistered(doc, n.core_type, n.subtype)) err(CODES.SUBTYPE, `${path}.subtype`);
    if (n.emp_no !== undefined && n.core_type !== 'person') err(CODES.SCHEMA, `${path}.emp_no`);
    if (n.hidden !== undefined && typeof n.hidden !== 'boolean') err(CODES.SCHEMA, `${path}.hidden`);
    if (periodError(n.period)) err(CODES.SCHEMA, `${path}.period`);
    if (n.attrs !== undefined) {
      const okAttrs = isObject(n.attrs) && Object.values(n.attrs).every((v) => typeof v === 'string' || typeof v === 'number');
      if (!okAttrs) err(CODES.SCHEMA, `${path}.attrs`);
    }
    if (n.tags !== undefined && !(Array.isArray(n.tags) && n.tags.every((t) => typeof t === 'string'))) {
      err(CODES.SCHEMA, `${path}.tags`);
    }
  });

  // 꼭지: 정확히 1개, universe.root_node_id와 같고 숨기지 않음
  const roots = doc.nodes.filter((n) => isObject(n) && n.core_type === 'root');
  if (roots.length !== 1 || roots[0].id !== u.root_node_id || roots[0].hidden === true) {
    err(CODES.SCHEMA, 'universe.root_node_id');
  }

  // 중복(숨긴 노드 제외). 앞에 있는 노드를 기존 노드로 안내한다
  const seen = [];
  doc.nodes.forEach((n, i) => {
    if (!isObject(n) || n.hidden) return;
    const dup = findDuplicateNode(seen, n);
    if (dup) err(CODES.DUP, `nodes[${i}]`, { existing_id: dup.id });
    seen.push(n);
    if (n.core_type === 'person' && !n.emp_no) warnings.push({ code: CODES.NO_EMPNO, target_id: n.id });
  });

  // 연결
  const edgeIds = new Set();
  const seenEdges = [];
  doc.edges.forEach((e, i) => {
    const path = `edges[${i}]`;
    if (!isObject(e) || isBlank(e.id)) return err(CODES.REQUIRED, `${path}.id`);
    if (edgeIds.has(e.id)) err(CODES.DUP, `${path}.id`, { existing_id: e.id });
    edgeIds.add(e.id);
    for (const k of ['source', 'target', 'core_type']) {
      if (isBlank(e[k])) err(CODES.REQUIRED, `${path}.${k}`);
    }
    const src = nodesById.get(e.source);
    const tgt = nodesById.get(e.target);
    if (!isBlank(e.source) && !src) err(CODES.SCHEMA, `${path}.source`);
    if (!isBlank(e.target) && !tgt) err(CODES.SCHEMA, `${path}.target`);
    if (src && tgt && !pairAllowed(e.core_type, src.core_type, tgt.core_type)) err(CODES.PAIR, path);
    if (e.subtype && !subtypeRegistered(doc, e.core_type, e.subtype)) err(CODES.SUBTYPE, `${path}.subtype`);
    if (periodError(e.period)) err(CODES.SCHEMA, `${path}.period`);
    if (e.hidden !== undefined && typeof e.hidden !== 'boolean') err(CODES.SCHEMA, `${path}.hidden`);
    if (!e.hidden) {
      const dup = findDuplicateEdge(seenEdges, e);
      if (dup) err(CODES.DUP, path, { existing_id: dup.id });
      seenEdges.push(e);
    }
  });

  // 이벤트
  const eventIds = new Set();
  doc.events.forEach((ev, i) => {
    const path = `events[${i}]`;
    if (!isObject(ev) || isBlank(ev.id)) return err(CODES.REQUIRED, `${path}.id`);
    if (eventIds.has(ev.id)) err(CODES.DUP, `${path}.id`, { existing_id: ev.id });
    eventIds.add(ev.id);
    if (!EVENT_TYPES[ev.type]) return err(CODES.SCHEMA, `${path}.type`);
    if (isBlank(ev.occurred_at)) err(CODES.REQUIRED, `${path}.occurred_at`);
    else if (!isDate(ev.occurred_at)) err(CODES.SCHEMA, `${path}.occurred_at`);
    if (ev.source !== undefined && !EVENT_SOURCES.includes(ev.source)) err(CODES.SCHEMA, `${path}.source`);
    for (const e of eventPayloadErrors(doc, nodesById, edgeIds, ev)) err(e.code, `${path}.payload.${e.field}`);
  });
  // previous_handover_id는 같은 문서의 이벤트를 가리킨다(전역 참조는 다른 유니버스)
  doc.events.forEach((ev, i) => {
    const prev = isObject(ev) && isObject(ev.payload) ? ev.payload.previous_handover_id : undefined;
    if (prev && !isGlobalRef(prev) && !eventIds.has(prev)) err(CODES.SCHEMA, `events[${i}].payload.previous_handover_id`);
  });

  // 꼭지 참조
  const seenRefs = new Set();
  doc.refs.forEach((r, i) => {
    const path = `refs[${i}]`;
    if (!isObject(r) || isBlank(r.child_universe_id)) return err(CODES.REQUIRED, `${path}.child_universe_id`);
    if (r.child_universe_id === u.id) return err(CODES.CYCLE, path);
    if (seenRefs.has(r.child_universe_id)) err(CODES.DUP, path);
    seenRefs.add(r.child_universe_id);
  });

  // 동일성 연결
  const linkIds = new Set();
  doc.identity_links.forEach((l, i) => {
    const path = `identity_links[${i}]`;
    if (!isObject(l) || isBlank(l.id)) return err(CODES.REQUIRED, `${path}.id`);
    if (linkIds.has(l.id)) err(CODES.DUP, `${path}.id`);
    linkIds.add(l.id);
    if (!isGlobalRef(l.a) || !isGlobalRef(l.b)) err(CODES.SCHEMA, `${path}.a`);
    if (!IDENTITY_KINDS.includes(l.kind)) err(CODES.SCHEMA, `${path}.kind`);
    if (!IDENTITY_METHODS.includes(l.method)) err(CODES.SCHEMA, `${path}.method`);
    if (!IDENTITY_STATUSES.includes(l.status)) err(CODES.SCHEMA, `${path}.status`);
    // 업무 노드는 사람 확인만 허용(1.2 IdentityLink)
    if (l.method === 'emp_no_auto' && l.kind !== 'person') err(CODES.SCHEMA, `${path}.method`);
    // 판정을 내린(확인·거부) 사람 확인 연결은 판정자·시각이 필수
    if (l.method === 'human' && l.status !== 'pending' && (isBlank(l.decided_by) || isBlank(l.decided_at))) {
      err(CODES.REQUIRED, `${path}.decided_by`);
    }
  });

  return result();
}

// 이벤트 payload의 필수 키와 참조 ID 오류. 다른 유니버스를 가리키는 전역 참조("U/N")는 여기서 확인하지 않는다.
// 명령(addEvent)에서도 같은 규칙으로 쓴다.
export function eventPayloadErrors(doc, nodesById, edgeIds, ev) {
  const rule = EVENT_PAYLOAD[ev.type];
  const payload = ev.payload;
  const out = [];
  if (!rule) return out;
  if (!isObject(payload)) {
    if (rule.required) out.push({ code: CODES.REQUIRED, field: rule.required[0] });
    return out;
  }
  for (const k of rule.required || []) {
    if (payload[k] === undefined || payload[k] === null || payload[k] === '') out.push({ code: CODES.REQUIRED, field: k });
  }
  if (ev.type === 'created' || ev.type === 'hidden' || ev.type === 'updated') {
    if (payload.target_kind !== 'node' && payload.target_kind !== 'edge') out.push({ code: CODES.SCHEMA, field: 'target_kind' });
    else if (payload.target_id && !isGlobalRef(payload.target_id)) {
      const exists = payload.target_kind === 'node' ? nodesById.has(payload.target_id) : edgeIds.has(payload.target_id);
      if (!exists) out.push({ code: CODES.SCHEMA, field: 'target_id' });
    }
    if (ev.type === 'updated' && (!isObject(payload.before) || !isObject(payload.after))) {
      out.push({ code: CODES.SCHEMA, field: 'before' });
    }
    return out;
  }
  const checkNode = (field, id) => {
    if (id && !isGlobalRef(id) && !nodesById.has(id)) out.push({ code: CODES.SCHEMA, field });
  };
  for (const k of rule.nodeRefs || []) checkNode(k, payload[k]);
  for (const k of rule.nodeListRefs || []) {
    if (payload[k] === undefined) continue;
    if (!Array.isArray(payload[k])) out.push({ code: CODES.SCHEMA, field: k });
    else payload[k].forEach((id) => checkNode(k, id));
  }
  return out;
}
