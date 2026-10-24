// 명령 적용(순수 함수). 입력 문서를 바꾸지 않고 새 문서와 이벤트를 돌려준다(12.7 model).
// 성공: {ok:true, doc, event, ...}  실패: {ok:false, error:{code, field?, existing_id?}}
// 모든 변경은 이벤트로 쌓고(D-04), 삭제는 숨김으로만 한다.

import { findDuplicateEdge, findDuplicateNode, isDate, periodError, subtypeRegistered } from './checks.js';
import {
  ATTRS_MAX_KEYS,
  BATCH_MAX_ROWS,
  CODES,
  EDGE_TYPES,
  EVENT_PAYLOAD,
  ID_PREFIX,
  IDENTITY_KINDS,
  IDENTITY_METHODS,
  IDENTITY_STATUSES,
  LABEL_MAX,
  NODE_TYPES,
  SCHEMA_VERSION,
  TAGS_MAX,
  TEXT_MAX,
  USER_EVENT_TYPES,
  hasKey,
  pairAllowed,
  pairKey,
} from './schema.js';
import { eventPayloadErrors } from './validate.js';

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// 12.1: 접두어 + 무작위 영숫자 8자리. random은 [0,1) 값을 돌려주는 함수(테스트에서 주입).
export function newId(prefix, random = Math.random) {
  let s = '';
  for (let i = 0; i < 8; i += 1) s += ID_CHARS[Math.floor(random() * ID_CHARS.length)];
  return prefix + s;
}

function uniqueId(prefix, taken, random) {
  let id;
  do id = newId(prefix, random); while (taken.has(id));
  return id;
}

const fail = (code, extra = {}) => ({ ok: false, error: { code, ...extra } });
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const isEmpty = (v) => v === undefined || v === null || v === '';

function makeEvent(doc, type, payload, ctx, extra = {}) {
  return {
    id: uniqueId(ID_PREFIX.event, new Set(doc.events.map((e) => e.id)), ctx.random || Math.random),
    type,
    occurred_at: ctx.occurred_at || ctx.now.slice(0, 10),
    recorded_at: ctx.now,
    source: ctx.source || 'user',
    payload,
    ...extra,
  };
}

// ── 노드 ────────────────────────────────────────────────────────────────

// 입력 필드를 저장 형식으로 정리한다. 빈 값은 필드를 두지 않는다.
function normalizeNodeFields(f) {
  const out = { core_type: f.core_type, label: typeof f.label === 'string' ? f.label.trim() : '' };
  if (!isEmpty(f.subtype)) out.subtype = f.subtype;
  if (!isEmpty(f.description) && String(f.description).trim()) out.description = String(f.description).trim();
  if (!isEmpty(f.attrs)) out.attrs = f.attrs;
  if (Array.isArray(f.tags) && f.tags.length) out.tags = f.tags;
  if (!isEmpty(f.period)) out.period = f.period;
  if (!isEmpty(f.emp_no) && String(f.emp_no).trim()) out.emp_no = String(f.emp_no).trim();
  return out;
}

// 저장 전 검사. 문제가 없으면 null. isUpdate이면 유형은 바꾸지 않으므로 모르는 유형("기타")도 허용한다.
function nodeFieldError(doc, f, { excludeId, isUpdate = false } = {}) {
  if (!f.core_type) return { code: CODES.REQUIRED, field: 'core_type' };
  if (!f.label || f.label.length > LABEL_MAX) return { code: CODES.REQUIRED, field: 'label' };
  if (!isUpdate && (!hasKey(NODE_TYPES, f.core_type) || f.core_type === 'root')) return { code: CODES.SCHEMA, field: 'core_type' };
  if (f.subtype && !subtypeRegistered(doc, f.core_type, f.subtype)) return { code: CODES.SUBTYPE, field: 'subtype' };
  if (f.emp_no && f.core_type !== 'person') return { code: CODES.SCHEMA, field: 'emp_no' };
  // 사번 길이: 가져오기 검증(validate.js)과 같은 상한(검토8 재검증)
  if (f.emp_no && String(f.emp_no).length > LABEL_MAX) return { code: CODES.SCHEMA, field: 'emp_no', too_long: LABEL_MAX };
  if (f.exposed !== undefined && typeof f.exposed !== 'boolean') return { code: CODES.SCHEMA, field: 'exposed' };
  if (f.attrs !== undefined) {
    const ok =
      f.attrs !== null &&
      typeof f.attrs === 'object' &&
      !Array.isArray(f.attrs) &&
      Object.values(f.attrs).every((v) => typeof v === 'string' || typeof v === 'number');
    if (!ok) return { code: CODES.SCHEMA, field: 'attrs' };
  }
  if (periodError(f.period)) return { code: CODES.SCHEMA, field: 'period' };
  if (f.description && f.description.length > TEXT_MAX) return { code: CODES.SCHEMA, field: 'description', too_long: TEXT_MAX };
  if (f.attrs && Object.values(f.attrs).some((v) => String(v).length > TEXT_MAX)) return { code: CODES.SCHEMA, field: 'attrs', too_long: TEXT_MAX };
  // 가져오기 검증(validate.js, 검토9 S-2)과 같은 개수·길이 상한: 앱이 저장한 문서를 다시 가져오지 못하는 일을 막는다
  if (f.attrs && Object.keys(f.attrs).length > ATTRS_MAX_KEYS) return { code: CODES.SCHEMA, field: 'attrs', too_many: ATTRS_MAX_KEYS };
  if (Array.isArray(f.tags) && (f.tags.length > TAGS_MAX || f.tags.some((t) => typeof t === 'string' && t.length > TEXT_MAX))) return { code: CODES.SCHEMA, field: 'tags', too_many: TAGS_MAX };
  const dup = findDuplicateNode(doc.nodes, f, excludeId);
  if (dup) return { code: CODES.DUP, existing_id: dup.id };
  return null;
}

/**
 * 노드 1개를 추가한다. 꼭지는 유니버스를 만들 때만 생긴다(1.2 Root).
 * @param {object} doc 12.2 유니버스 문서
 * @param {{core_type:string, label:string, subtype?:string, description?:string, attrs?:object, tags?:string[], period?:object, emp_no?:string}} input
 * @param {{now:string, random?:()=>number, source?:string, occurred_at?:string}} ctx now는 ISO 8601 날짜·시각(시간대 포함)
 */
export function addNode(doc, input, ctx) {
  const fields = normalizeNodeFields(input);
  const error = nodeFieldError(doc, fields);
  if (error) return { ok: false, error };

  const node = {
    id: uniqueId(ID_PREFIX.node, new Set(doc.nodes.map((n) => n.id)), ctx.random || Math.random),
    ...fields,
    hidden: false,
    created_at: ctx.now,
    updated_at: ctx.now,
  };
  const event = makeEvent(doc, 'created', { target_kind: 'node', target_id: node.id }, ctx);
  const warnings = node.core_type === 'person' && !node.emp_no ? [{ code: CODES.NO_EMPNO, target_id: node.id }] : [];

  return {
    ok: true,
    doc: { ...doc, nodes: [...doc.nodes, node], events: [...doc.events, event] },
    node,
    event,
    warnings,
  };
}

// exposed: 위층(상위 유니버스)에서 보일지. 없으면 기본 규칙(view/collapse.js)을 따른다(CR-4 제안)
const NODE_EDITABLE = ['label', 'description', 'attrs', 'tags', 'period', 'subtype', 'emp_no', 'exposed'];

/**
 * 노드를 수정한다. 바뀐 필드만 골라 `updated` 이벤트의 before/after에 남긴다(R-02 ②).
 * changes에서 값이 빈 문자열·null이면 그 필드를 지운다. 유형(core_type)은 바꿀 수 없다.
 * 바뀐 것이 없으면 문서를 그대로 돌려주고 event는 null이다.
 */
export function updateNode(doc, nodeId, changes, ctx) {
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node) return fail(CODES.SCHEMA, { field: 'id' });
  // 숨긴 노드는 근거로서 내용을 그대로 지킨다(4절 숨김 후 참조). 고치려면 숨기기 전에 고친다
  if (node.hidden) return fail(CODES.SCHEMA, { field: 'id', hidden: true });
  if (changes.core_type !== undefined && changes.core_type !== node.core_type) return fail(CODES.SCHEMA, { field: 'core_type' });
  // 꼭지의 이름은 유니버스 이름과 같아야 한다(1.2)
  if (node.core_type === 'root' && changes.label !== undefined && changes.label !== node.label) {
    return fail(CODES.SCHEMA, { field: 'label' });
  }

  const merged = { ...node };
  for (const key of NODE_EDITABLE) {
    if (!(key in changes)) continue;
    const v = typeof changes[key] === 'string' ? changes[key].trim() : changes[key];
    if (isEmpty(v) || (Array.isArray(v) && v.length === 0)) delete merged[key];
    else merged[key] = v;
  }
  const error = nodeFieldError(doc, merged, { excludeId: nodeId, isUpdate: true });
  if (error) return { ok: false, error };

  const before = {};
  const after = {};
  for (const key of NODE_EDITABLE) {
    if (!same(node[key], merged[key])) {
      before[key] = node[key] ?? null;
      after[key] = merged[key] ?? null;
    }
  }
  if (Object.keys(after).length === 0) return { ok: true, doc, node, event: null, warnings: [] };

  const updated = { ...merged, updated_at: ctx.now };
  const event = makeEvent(doc, 'updated', { target_kind: 'node', target_id: nodeId, before, after }, ctx);
  const warnings = updated.core_type === 'person' && !updated.emp_no ? [{ code: CODES.NO_EMPNO, target_id: nodeId }] : [];
  return {
    ok: true,
    doc: { ...doc, nodes: doc.nodes.map((n) => (n.id === nodeId ? updated : n)), events: [...doc.events, event] },
    node: updated,
    event,
    warnings,
  };
}

/** 노드를 숨긴다(삭제 대신, D-04). 꼭지는 숨길 수 없다. 이미 숨겼으면 event는 null이다. */
export function hideNode(doc, nodeId, ctx) {
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node) return fail(CODES.SCHEMA, { field: 'id' });
  if (node.core_type === 'root') return fail(CODES.SCHEMA, { field: 'core_type' });
  if (node.hidden) return { ok: true, doc, node, event: null };

  const hiddenNode = { ...node, hidden: true, updated_at: ctx.now };
  const event = makeEvent(doc, 'hidden', { target_kind: 'node', target_id: nodeId }, ctx);
  return {
    ok: true,
    doc: { ...doc, nodes: doc.nodes.map((n) => (n.id === nodeId ? hiddenNode : n)), events: [...doc.events, event] },
    node: hiddenNode,
    event,
  };
}

/**
 * 숨긴 노드를 되살린다(R-21, D-23). 새 이벤트 종류 없이 `updated`(hidden true → false)로 남긴다.
 * 노드에 딸린 연결은 숨길 때 건드리지 않았으므로 그대로 다시 보인다. 꼭지는 숨길 수 없으므로 되살릴 수도 없다.
 * 이미 보이는 노드면 event는 null이다. 같은 유형·이름(사람은 같은 사번)의 보이는 노드가 이미 있으면 E-DUP(existing_id)로 거부한다.
 */
export function restoreNode(doc, nodeId, ctx) {
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node) return fail(CODES.SCHEMA, { field: 'id' });
  if (node.core_type === 'root') return fail(CODES.SCHEMA, { field: 'core_type' });
  if (!node.hidden) return { ok: true, doc, node, event: null };
  if (node.deleted) return fail(CODES.SCHEMA, { field: 'id', deleted: true }); // 완전히 삭제한 항목은 되살릴 수 없다
  const dup = findDuplicateNode(doc.nodes, node, nodeId);
  if (dup) return fail(CODES.DUP, { existing_id: dup.id });

  const shown = { ...node, hidden: false, updated_at: ctx.now };
  const event = makeEvent(doc, 'updated', { target_kind: 'node', target_id: nodeId, before: { hidden: true }, after: { hidden: false } }, ctx);
  return {
    ok: true,
    doc: { ...doc, nodes: doc.nodes.map((n) => (n.id === nodeId ? shown : n)), events: [...doc.events, event] },
    node: shown,
    event,
  };
}

// ── 삭제(CR-13 D): 바로 삭제와 숨긴 뒤 완전히 삭제(자리표시) ──────────────────

/** 완전히 삭제한 노드의 이름. 이 노드를 가리키던 이력은 이 이름으로 보인다 */
// 저장되는 자리표시 이름이라 CR-18-2 용어 바꾸기에서도 그대로 둔다(저장 값 불변). 화면에는 view/describe.js displayName이 「(삭제된 항목)」으로 보인다
export const DELETED_LABEL = '(삭제된 노드)';
// 자리표시로 만들 때 지우는 노드 필드
const PURGE_FIELDS = ['description', 'attrs', 'emp_no', 'subtype', 'tags', 'period', 'exposed'];

const eventRefsNode = (ev, nodeId) => {
  const p = ev.payload;
  if (!p || typeof p !== 'object') return false;
  const rule = has(EVENT_PAYLOAD, ev.type) ? EVENT_PAYLOAD[ev.type] : null;
  if (!rule) return false;
  if ((rule.nodeRefs || []).some((k) => p[k] === nodeId)) return true;
  return (rule.nodeListRefs || []).some((k) => Array.isArray(p[k]) && p[k].includes(nodeId));
};
const has = (obj, key) => typeof key === 'string' && Object.hasOwn(obj, key);
// 그 노드 자신의 생성·수정·숨김 이벤트(노드 자신의 이력)
const isOwnEvent = (ev, nodeId) => ['created', 'updated', 'hidden'].includes(ev.type)
  && ev.payload && ev.payload.target_kind === 'node' && ev.payload.target_id === nodeId;

/**
 * 바로 삭제할 수 있는가: 아무도 가리키지 않는 노드(연결·다른 이력·동일성 연결이 없음). 꼭지는 안 된다.
 * @returns {{ok:boolean, reasons:string[], edge_count:number}} reasons: root | not_found | edges | events | identity_links | refs
 */
export function canDeleteNow(doc, nodeId, { externalRefs = false } = {}) {
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node) return { ok: false, reasons: ['not_found'], edge_count: 0 };
  const reasons = [];
  // 다른 유니버스(상위 묶음 등)의 동일성 연결이 이 노드를 가리킴: 이 문서만 보고는 알 수 없어 앱이 알려 준다(검토 R13 재검증 3)
  if (externalRefs) reasons.push('external');
  if (node.core_type === 'root') reasons.push('root');
  const auto = new Set(autoAttachEdges(doc, nodeId).map((e) => e.id));
  const edgeCount = (doc.edges || []).filter((e) => (e.source === nodeId || e.target === nodeId) && !auto.has(e.id)).length;
  if (edgeCount) reasons.push('edges');
  if ((doc.events || []).some((ev) => !isOwnEvent(ev, nodeId) && eventRefsNode(ev, nodeId))) reasons.push('events');
  const gid = `${doc.universe.id}/${nodeId}`;
  if ((doc.identity_links || []).some((l) => l.a === gid || l.b === gid)) reasons.push('identity_links');
  if ((doc.refs || []).some((r) => Object.values(r).some((v) => v === gid || v === nodeId))) reasons.push('refs');
  return { ok: reasons.length === 0, reasons, edge_count: edgeCount };
}

// 노드를 문서에서 통째로 뺀다(자기 이벤트 포함). canDeleteNow가 통과한 노드에만 쓴다
function removeNodeWhole(doc, nodeId) {
  const auto = new Set(autoAttachEdges(doc, nodeId).map((e) => e.id));
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => n.id !== nodeId),
    edges: doc.edges.filter((e) => !auto.has(e.id)),
    events: doc.events.filter((ev) => !isOwnEvent(ev, nodeId)
      && !(ev.payload && ev.payload.target_kind === 'edge' && auto.has(ev.payload.target_id))),
  };
}

// 노드 추가 양식의 「꼭지에 붙이기」(기본 켜짐)가 만든 연결: 꼭지 → 노드 「포함」, 하위 유형·기간·메모 없음, 이력은 생성 한 줄뿐.
// 막 만든 노드에도 이 연결은 붙어 있으므로 「연결 없음」으로 본다(CR-13 D 구현 판단 — 바꾸려면 AUTO_ATTACH_IS_FREE)
const AUTO_ATTACH_IS_FREE = true;
function autoAttachEdges(doc, nodeId) {
  if (!AUTO_ATTACH_IS_FREE) return [];
  return (doc.edges || []).filter((e) => e.target === nodeId && e.source === doc.universe.root_node_id && e.core_type === 'contains'
    && !e.subtype && !e.period && !e.note
    && !doc.events.some((ev) => ev.payload && ev.payload.target_kind === 'edge' && ev.payload.target_id === e.id && ev.type !== 'created'));
}

/**
 * 연결·이력이 없는 노드를 바로 지운다(되돌릴 수 없음). 조건이 안 맞으면 E-SCHEMA(reason 'in_use', reasons).
 * 노드와 그 노드의 생성·수정·숨김 이벤트를 문서에서 뺀다.
 */
export function deleteNodeNow(doc, nodeId, ctx, opts = {}) { // eslint-disable-line no-unused-vars
  const can = canDeleteNow(doc, nodeId, opts);
  if (!can.ok) return fail(CODES.SCHEMA, { field: 'id', reason: 'in_use', reasons: can.reasons });
  const node = doc.nodes.find((n) => n.id === nodeId);
  return { ok: true, doc: removeNodeWhole(doc, nodeId), node, event: null, removed: true };
}

/**
 * 숨긴 노드를 완전히 삭제한다. 숨기지 않은 노드는 거부(E-SCHEMA, reason 'not_hidden').
 * 바로 삭제 조건이 맞으면 통째로 뺀다. 아니면 자리표시로 비운다: 이름 「(삭제된 노드)」, 내용 필드 제거, deleted:true(hidden 유지),
 * 붙은 연결(숨긴 것 포함)과 그 연결의 이력을 문서에서 빼고, 이 노드의 예전 수정 이력에서도 내용 값을 지운다.
 * 이 노드를 가리킨 메모·인수인계 등 다른 이력은 그대로 둔다(ID가 남아 있어 검증이 깨지지 않는다).
 * 이력에는 updated 한 줄(deleted false → true, 지운 필드 이름만. 지운 값은 남기지 않음).
 */
export function purgeNode(doc, nodeId, ctx, opts = {}) {
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node) return fail(CODES.SCHEMA, { field: 'id' });
  if (node.core_type === 'root') return fail(CODES.SCHEMA, { field: 'core_type' });
  if (node.deleted) return { ok: true, doc, node, event: null };
  if (!node.hidden) return fail(CODES.SCHEMA, { field: 'id', reason: 'not_hidden' });
  if (canDeleteNow(doc, nodeId, opts).ok) return { ok: true, doc: removeNodeWhole(doc, nodeId), node, event: null, removed: true };

  const cleared = ['label', ...PURGE_FIELDS.filter((k) => node[k] !== undefined)];
  const placeholder = {
    id: node.id, core_type: node.core_type, label: DELETED_LABEL, hidden: true, deleted: true,
    created_at: node.created_at, updated_at: ctx.now,
  };
  const removedEdgeIds = new Set(doc.edges.filter((e) => e.source === nodeId || e.target === nodeId).map((e) => e.id));
  const keep = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => k === 'hidden' || k === 'deleted'));
  const events = doc.events
    .filter((ev) => !(['created', 'updated', 'hidden'].includes(ev.type) && ev.payload && ev.payload.target_kind === 'edge' && removedEdgeIds.has(ev.payload.target_id)))
    .map((ev) => {
      if (!isOwnEvent(ev, nodeId)) return ev;
      const { note, ...rest } = ev; // eslint-disable-line no-unused-vars
      if (ev.type !== 'updated') return rest;
      const before = keep(ev.payload.before);
      const after = keep(ev.payload.after);
      // 값을 지운 수정 이력은 「수정(내용 지움)」으로 보이게 표시한다(describe.js eventText)
      const stripped = Object.keys(ev.payload.after || {}).length !== Object.keys(after).length;
      return { ...rest, payload: { ...ev.payload, before, after, ...(stripped ? { cleared: true } : {}) } };
    });
  const event = makeEvent({ ...doc, events }, 'updated', {
    target_kind: 'node', target_id: nodeId, before: { deleted: false }, after: { deleted: true }, cleared_fields: cleared,
  }, ctx);
  return {
    ok: true,
    doc: {
      ...doc,
      nodes: doc.nodes.map((n) => (n.id === nodeId ? placeholder : n)),
      edges: doc.edges.filter((e) => !removedEdgeIds.has(e.id)),
      events: [...events, event],
    },
    node: placeholder,
    event,
    removed_edges: removedEdgeIds.size,
  };
}

// ── 연결 ────────────────────────────────────────────────────────────────

/**
 * 연결 1개를 추가한다. 양 끝 노드는 같은 유니버스에 있어야 하고 관계 조합은 12.2 표를 따른다.
 * @param {{source:string, target:string, core_type:string, subtype?:string, period?:object, note?:string}} input
 */
export function addEdge(doc, input, ctx) {
  for (const k of ['source', 'target', 'core_type']) {
    if (isEmpty(input[k])) return fail(CODES.REQUIRED, { field: k });
  }
  const src = doc.nodes.find((n) => n.id === input.source);
  const tgt = doc.nodes.find((n) => n.id === input.target);
  if (!src) return fail(CODES.SCHEMA, { field: 'source' });
  if (!tgt) return fail(CODES.SCHEMA, { field: 'target' });
  // 자기 자신으로 가는 연결은 그래프에 그려지지 않아(view.js) 보이지 않는 연결로 남는다: 만들지 않는다(2026-10-18, 표 「다음 업무」에 자기 이름)
  if (input.source === input.target) return fail(CODES.SCHEMA, { field: 'target', self_loop: true });
  // 숨긴 노드는 화면에 없으므로 새 연결의 끝이 될 수 없다(기존 연결은 이력으로 남는다)
  if (src.hidden) return fail(CODES.SCHEMA, { field: 'source', hidden: true });
  if (tgt.hidden) return fail(CODES.SCHEMA, { field: 'target', hidden: true });
  if (!hasKey(EDGE_TYPES, input.core_type)) return fail(CODES.SCHEMA, { field: 'core_type' });
  if (!pairAllowed(input.core_type, src.core_type, tgt.core_type)) return fail(CODES.PAIR);
  if (input.subtype && !subtypeRegistered(doc, input.core_type, input.subtype)) return fail(CODES.SUBTYPE, { field: 'subtype' });
  if (periodError(input.period)) return fail(CODES.SCHEMA, { field: 'period' });
  // 연결 메모 길이: 가져오기 검증(validate.js)과 같은 상한. 앱이 저장한 문서를 다시 가져오지 못하는 일을 막는다(검토8 재검증)
  if (input.note && String(input.note).trim().length > TEXT_MAX) return fail(CODES.SCHEMA, { field: 'note', too_long: TEXT_MAX });

  const fields = { source: input.source, target: input.target, core_type: input.core_type };
  if (!isEmpty(input.period)) fields.period = input.period;
  const dup = findDuplicateEdge(doc.edges, fields);
  if (dup) return fail(CODES.DUP, { existing_id: dup.id });

  const edge = {
    id: uniqueId(ID_PREFIX.edge, new Set(doc.edges.map((e) => e.id)), ctx.random || Math.random),
    ...fields,
    ...(input.subtype ? { subtype: input.subtype } : {}),
    ...(input.note && String(input.note).trim() ? { note: String(input.note).trim() } : {}),
    hidden: false,
    created_at: ctx.now,
  };
  const event = makeEvent(doc, 'created', { target_kind: 'edge', target_id: edge.id }, ctx);
  return { ok: true, doc: { ...doc, edges: [...doc.edges, edge], events: [...doc.events, event] }, edge, event };
}

const EDGE_EDITABLE = ['subtype', 'period', 'note'];

/** 연결의 하위 유형·기간·메모를 수정한다. 양 끝과 관계 유형은 바꿀 수 없다. */
export function updateEdge(doc, edgeId, changes, ctx) {
  const edge = doc.edges.find((e) => e.id === edgeId);
  if (!edge) return fail(CODES.SCHEMA, { field: 'id' });
  for (const k of ['source', 'target', 'core_type']) {
    if (changes[k] !== undefined && changes[k] !== edge[k]) return fail(CODES.SCHEMA, { field: k });
  }

  const merged = { ...edge };
  for (const key of EDGE_EDITABLE) {
    if (!(key in changes)) continue;
    const v = typeof changes[key] === 'string' ? changes[key].trim() : changes[key];
    if (isEmpty(v)) delete merged[key];
    else merged[key] = v;
  }
  if (merged.subtype && !subtypeRegistered(doc, merged.core_type, merged.subtype)) return fail(CODES.SUBTYPE, { field: 'subtype' });
  if (periodError(merged.period)) return fail(CODES.SCHEMA, { field: 'period' });
  if (merged.note !== undefined && (typeof merged.note !== 'string' || merged.note.length > TEXT_MAX)) return fail(CODES.SCHEMA, { field: 'note', too_long: TEXT_MAX });
  const dup = !merged.hidden && findDuplicateEdge(doc.edges, merged, edgeId);
  if (dup) return fail(CODES.DUP, { existing_id: dup.id });

  const before = {};
  const after = {};
  for (const key of EDGE_EDITABLE) {
    if (!same(edge[key], merged[key])) {
      before[key] = edge[key] ?? null;
      after[key] = merged[key] ?? null;
    }
  }
  if (Object.keys(after).length === 0) return { ok: true, doc, edge, event: null };

  const event = makeEvent(doc, 'updated', { target_kind: 'edge', target_id: edgeId, before, after }, ctx);
  return {
    ok: true,
    doc: { ...doc, edges: doc.edges.map((e) => (e.id === edgeId ? merged : e)), events: [...doc.events, event] },
    edge: merged,
    event,
  };
}

/** 연결을 숨긴다. 이미 숨겼으면 event는 null이다. */
export function hideEdge(doc, edgeId, ctx) {
  const edge = doc.edges.find((e) => e.id === edgeId);
  if (!edge) return fail(CODES.SCHEMA, { field: 'id' });
  if (edge.hidden) return { ok: true, doc, edge, event: null };

  const hiddenEdge = { ...edge, hidden: true };
  const event = makeEvent(doc, 'hidden', { target_kind: 'edge', target_id: edgeId }, ctx);
  return {
    ok: true,
    doc: { ...doc, edges: doc.edges.map((e) => (e.id === edgeId ? hiddenEdge : e)), events: [...doc.events, event] },
    edge: hiddenEdge,
    event,
  };
}

/**
 * 연결의 관계·상대(양 끝)를 바꾼다: 옛 연결을 숨기고(hideEdge) 새 연결을 만든다(addEdge). 하나라도 실패하면 문서 그대로.
 * 지우지 않는 원칙(D-04)에 따라 이력에는 숨김과 생성 이벤트가 둘 다 남는다. 옛 연결을 숨긴 문서에서 새 연결을 검사하므로
 * 같은 끝·관계로 다시 만들 때 옛 연결과 중복이 되지 않는다.
 * @param {{source:string, target:string, core_type:string, subtype?:string, period?:object, note?:string}} input 새 연결 내용
 * @returns {{ok:true, doc:object, edge:object, hidden:object, events:object[]} | {ok:false, error:object}}
 */
export function replaceEdge(doc, edgeId, input, ctx) {
  const h = hideEdge(doc, edgeId, ctx);
  if (!h.ok) return h;
  const a = addEdge(h.doc, input, ctx);
  if (!a.ok) return { ok: false, error: a.error };
  return { ok: true, doc: a.doc, edge: a.edge, hidden: h.edge, event: a.event, events: [h.event, a.event].filter(Boolean) };
}

// ── 이벤트 ──────────────────────────────────────────────────────────────

/**
 * 사용자 입력 이벤트(담당 시작·종료, 인수인계, 소속 변경, 메모)를 추가한다. 추가만 가능하다(D-04).
 * 생성·수정·숨김 이벤트는 명령이 자동으로 기록하므로 여기서 받지 않는다.
 * @param {{type:string, occurred_at:string, payload?:object, note?:string}} input
 */
export function addEvent(doc, input, ctx) {
  if (isEmpty(input.type)) return fail(CODES.REQUIRED, { field: 'type' });
  if (!USER_EVENT_TYPES.includes(input.type)) return fail(CODES.SCHEMA, { field: 'type' });
  if (isEmpty(input.occurred_at)) return fail(CODES.REQUIRED, { field: 'occurred_at' });
  if (!isDate(input.occurred_at)) return fail(CODES.SCHEMA, { field: 'occurred_at' });
  if (input.note && String(input.note).length > TEXT_MAX) return fail(CODES.SCHEMA, { field: 'note', too_long: TEXT_MAX });
  const pl = input.payload || {};
  // 인수인계는 보내는 사람과 받는 사람이 달라야 한다
  if (input.type === 'handover' && pl.from_person_id && pl.from_person_id === pl.to_person_id) {
    return fail(CODES.SCHEMA, { field: 'to_person_id', same_person: true });
  }
  // 숨긴 노드를 새 이력의 대상으로 쓰지 않는다(연결과 같은 기준). 전역 참조(다른 유니버스)는 여기서 확인하지 않는다
  // 단, 「해결로 표시」(범주 resolved + resolves_id)는 대상이 숨겨져 있어도 그 메모를 닫을 수 있어야 한다(검토7 K-1)
  // 이 예외는 해결 메모의 대상·주제가 닫는 메모의 대상·주제와 같을 때만 쓴다(검토7 V-2). 다르면 거부한다
  const isResolution = pl.category === 'resolved' && !!pl.resolves_id;
  if (isResolution) {
    const orig = typeof pl.resolves_id === 'string' ? doc.events.find((x) => x && x.id === pl.resolves_id && x.type === 'memo') : null;
    if (orig) {
      const op = orig.payload || {};
      const topics = (p) => JSON.stringify([...(Array.isArray(p.topic_ids) ? p.topic_ids : [])].sort());
      if ((op.target_id || null) !== (pl.target_id || null) || topics(op) !== topics(pl)) {
        return fail(CODES.SCHEMA, { field: 'resolves_id', mismatch: true });
      }
    }
  }
  for (const [k, v] of Object.entries(isResolution ? {} : pl)) {
    for (const id of Array.isArray(v) ? v : [v]) {
      if (typeof id !== 'string' || id.includes('/') || !/_id$|_ids$/.test(k) || k === 'previous_handover_id') continue;
      const n = doc.nodes.find((x) => x.id === id);
      if (n && n.hidden) return fail(CODES.SCHEMA, { field: k, hidden: true });
    }
  }

  const nodesById = new Map(doc.nodes.map((n) => [n.id, n]));
  const edgeIds = new Set(doc.edges.map((e) => e.id));
  const candidate = { type: input.type, payload: input.payload };
  const [first] = eventPayloadErrors(doc, nodesById, edgeIds, candidate);
  if (first) return fail(first.code, { field: first.field, ...(first.expected ? { expected: first.expected } : {}) });
  const prev = input.payload && input.payload.previous_handover_id;
  if (prev && !prev.includes('/') && !doc.events.some((e) => e.id === prev && e.type === 'handover')) {
    return fail(CODES.SCHEMA, { field: 'previous_handover_id' });
  }

  const event = makeEvent(doc, input.type, input.payload || {}, { ...ctx, occurred_at: input.occurred_at }, {
    ...(input.note && String(input.note).trim() ? { note: String(input.note).trim() } : {}),
  });
  return { ok: true, doc: { ...doc, events: [...doc.events, event] }, event };
}

// ── 유형 설정과 유니버스 ────────────────────────────────────────────────

/**
 * 하위 유형을 등록한다(1.3 ②). 반드시 핵심 유형 하나에 속한다. 데이터만 늘고 코드 변경은 없다.
 * 설정 변경이라 이벤트는 남기지 않는다.
 */
export function addSubtype(doc, input) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!input.core_type) return fail(CODES.REQUIRED, { field: 'core_type' });
  if (!name || name.length > LABEL_MAX) return fail(CODES.REQUIRED, { field: 'name' });
  const known = (hasKey(NODE_TYPES, input.core_type) && input.core_type !== 'root') || hasKey(EDGE_TYPES, input.core_type); // 상속 속성(constructor 등)은 유형이 아님(검토8 R8-6)
  if (!known) return fail(CODES.SCHEMA, { field: 'core_type' });
  if (subtypeRegistered(doc, input.core_type, name)) return fail(CODES.DUP, { field: 'name' });

  const subtypes = [...(doc.universe.subtypes || []), { core_type: input.core_type, name }];
  return { ok: true, doc: { ...doc, universe: { ...doc.universe, subtypes } } };
}

/**
 * 유니버스를 만든다. 꼭지 노드가 자동으로 생기고 생성 이벤트가 남는다(R-12).
 * 같은 이름·단위의 유니버스가 이미 있는지는 저장소를 아는 app에서 경고한다.
 * @param {{name:string, level:string, owner:string, description?:string, tags?:string[], is_sample?:boolean}} input
 */
export function createUniverse(input, ctx) {
  const text = (v) => (typeof v === 'string' ? v.trim() : '');
  const name = text(input.name);
  if (!name || name.length > LABEL_MAX) return fail(CODES.REQUIRED, { field: 'name' });
  if (!text(input.level) || text(input.level).length > LABEL_MAX) return fail(CODES.REQUIRED, { field: 'level' });
  if (!text(input.owner) || text(input.owner).length > LABEL_MAX) return fail(CODES.REQUIRED, { field: 'owner' });
  if (text(input.description).length > TEXT_MAX) return fail(CODES.SCHEMA, { field: 'description', too_long: TEXT_MAX });

  const random = ctx.random || Math.random;
  const rootId = newId(ID_PREFIX.node, random);
  const universe = {
    id: newId(ID_PREFIX.universe, random),
    name,
    level: text(input.level),
    owner: text(input.owner),
    root_node_id: rootId,
    subtypes: [],
    is_sample: !!input.is_sample,
    created_at: ctx.now,
    ...(text(input.description) ? { description: text(input.description) } : {}),
    ...(Array.isArray(input.tags) && input.tags.length ? { tags: input.tags } : {}),
  };
  const root = { id: rootId, core_type: 'root', label: name, hidden: false, created_at: ctx.now, updated_at: ctx.now };
  const base = { schema_version: SCHEMA_VERSION, universe, nodes: [root], edges: [], events: [], refs: [], identity_links: [] };
  const event = makeEvent(base, 'created', { target_kind: 'node', target_id: rootId }, ctx);
  return { ok: true, doc: { ...base, events: [event] }, event };
}

// ── 꼭지 참조(유니버스 묶기) ─────────────────────────────────────────────

const activeRefs = (doc) => (doc.refs || []).filter((r) => !r.hidden);

// childId에서 참조를 따라 내려가다 targetId를 만나면 true(순환)
export function reaches(childId, targetId, resolveUniverse, seen = new Set()) {
  if (childId === targetId) return true;
  if (seen.has(childId)) return false;
  seen.add(childId);
  const child = resolveUniverse(childId);
  return !!child && activeRefs(child).some((r) => reaches(r.child_universe_id, targetId, resolveUniverse, seen));
}

/**
 * 하위 유니버스를 참조로 포함한다(D-02·D-03). 원본은 바꾸지 않는다.
 * resolveUniverse(id)는 다른 유니버스 문서를 찾는 함수다(순환 검사에 필요).
 */
export function addRef(doc, childId, ctx, resolveUniverse) {
  if (isEmpty(childId)) return fail(CODES.REQUIRED, { field: 'child_universe_id' });
  if (childId === doc.universe.id) return fail(CODES.CYCLE);
  if (!resolveUniverse(childId)) return fail(CODES.SCHEMA, { field: 'child_universe_id' });
  if (activeRefs(doc).some((r) => r.child_universe_id === childId)) return fail(CODES.DUP, { field: 'child_universe_id' });
  if (reaches(childId, doc.universe.id, resolveUniverse)) return fail(CODES.CYCLE);

  const ref = { child_universe_id: childId, added_at: ctx.now };
  const event = makeEvent(doc, 'created', { target_kind: 'ref', target_id: childId }, ctx);
  return { ok: true, doc: { ...doc, refs: [...(doc.refs || []), ref], events: [...doc.events, event] }, event };
}

/** 참조를 해제한다(CR-4 제안). 숨김과 같이 기록은 남기고 화면·계산에서만 빠진다. */
export function hideRef(doc, childId, ctx) {
  const i = (doc.refs || []).findIndex((r) => r.child_universe_id === childId && !r.hidden);
  if (i < 0) return fail(CODES.SCHEMA, { field: 'child_universe_id' });
  const refs = doc.refs.map((r, k) => (k === i ? { ...r, hidden: true, removed_at: ctx.now } : r));
  const event = makeEvent(doc, 'hidden', { target_kind: 'ref', target_id: childId }, ctx);
  return { ok: true, doc: { ...doc, refs, events: [...doc.events, event] }, event };
}

// ── 동일성 연결 판정(R-11, D-03, 12.7 흐름 3) ─────────────────────────────

/**
 * 두 노드(전역 참조)가 같은지 판정을 기록한다. 같은 쌍의 연결이 있으면 상태를 바꾸고, 없으면 새로 만든다.
 * 사람 확인(human)의 확정·거부는 판정자·시각이 필수다(12.2). 이벤트는 created/updated + target_kind "identity_link"(12.2, CR-7)
 * (12.2 이벤트 표에 없는 값이라 CR 후보로 기록, tech-record 31절).
 * @param {{a:string, b:string, kind:'person'|'work'|'topic', method:'emp_no_auto'|'human', status:'pending'|'confirmed'|'rejected', score?:number, reason?:string, decided_by?:string}} input
 */
export function decideIdentity(doc, input, ctx) {
  const { a, b, kind, method = 'human', status } = input || {};
  if (isEmpty(a) || isEmpty(b)) return fail(CODES.REQUIRED, { field: isEmpty(a) ? 'a' : 'b' });
  if (a === b) return fail(CODES.SCHEMA, { field: 'b', same_node: true });
  if (!IDENTITY_KINDS.includes(kind)) return fail(CODES.SCHEMA, { field: 'kind' });
  if (!IDENTITY_METHODS.includes(method)) return fail(CODES.SCHEMA, { field: 'method' });
  if (!IDENTITY_STATUSES.includes(status)) return fail(CODES.SCHEMA, { field: 'status' });
  if (method === 'emp_no_auto' && kind !== 'person') return fail(CODES.SCHEMA, { field: 'method' });
  const decided = method === 'human' && status !== 'pending';
  if (decided && isEmpty(input.decided_by)) return fail(CODES.REQUIRED, { field: 'decided_by' });

  const links = doc.identity_links || [];
  const i = links.findIndex((l) => pairKey(l.a, l.b) === pairKey(a, b));
  const fields = {
    kind,
    method,
    status,
    ...(input.score !== undefined ? { score: input.score } : {}),
    ...(input.reason ? { reason: String(input.reason).slice(0, TEXT_MAX) } : {}),
    ...(decided ? { decided_by: input.decided_by, decided_at: ctx.now } : {}),
  };
  if (i >= 0) {
    const prev = links[i];
    if (prev.status === status && prev.method === method) return fail(CODES.DUP, { field: 'status', existing_id: prev.id });
    const next = { id: prev.id, a: prev.a, b: prev.b, ...fields };
    const event = makeEvent(doc, 'updated', { target_kind: 'identity_link', target_id: prev.id, before: { status: prev.status, method: prev.method }, after: { status, method } }, ctx);
    const updated = links.map((l, j) => (j === i ? next : l));
    return { ok: true, doc: { ...doc, identity_links: updated, events: [...doc.events, event] }, event, link: next };
  }
  const link = { id: uniqueId(ID_PREFIX.identity, new Set(links.map((l) => l.id)), ctx.random || Math.random), a, b, ...fields };
  const event = makeEvent(doc, 'created', { target_kind: 'identity_link', target_id: link.id }, ctx);
  return { ok: true, doc: { ...doc, identity_links: [...links, link], events: [...doc.events, event] }, event, link };
}

// ── 일괄 명령(T-19, D-18) ──────────────────────────────────────────────────

/**
 * 노드 추가·수정 명령 여러 개를 차례로 적용한다. 전부 아니면 전무: 하나라도 실패하면 원래 문서를 그대로 두고
 * 실패한 행을 모두 돌려준다(고칠 곳을 한꺼번에 보이려고 실패한 행은 건너뛰고 끝까지 검사한다).
 * 같은 묶음 안의 앞 행은 뒤 행의 중복 검사에 반영된다(표 안 같은 이름 → E-DUP, with_row로 앞 행 번호).
 * addEdge의 source·target에는 노드 id 또는 같은 묶음 안에서 앞서 만든 노드를 가리키는 표식 '@<행번호>'(예: '@1')를 쓸 수 있다.
 * 행 번호는 그 addNode 행의 row(없으면 1부터 순서). 앞 행이 아니거나 노드를 만들지 않은 행을 가리키면 E-SCHEMA(bad_ref).
 * 앞 행이 실패했으면 그 행의 오류만 보고하고 이 연결 행은 건너뛴다. 연결 검증은 addEdge 그대로(허용 조합·중복·숨김).
 * @param {object} doc
 * @param {Array<
 *   {op:'addNode', row?:number, input:object, attachRoot?:boolean} |
 *   {op:'updateNode', row?:number, id:string, changes:object} |
 *   {op:'addEdge', row?:number, input:{source:string, target:string, core_type:string, subtype?:string, period?:object, note?:string}} |
 *   {op:'assign', row?:number, shown_row?:number, input:{person_id:string, work_id:string, occurred_at?:string}} |
 *   {op:'invalid', row?:number, error:{code:string}}
 * >} ops row는 화면의 행 번호(없으면 1부터 순서)
 * @param {{now:string, random?:()=>number, source?:string, occurred_at?:string}} ctx
 * @returns {{ok:true, doc:object, events:object[], created:object[], updated:object[], warnings:object[], rows:object[]}
 *   | {ok:false, doc:object, errors:{row:number, error:object}[], error:object}}
 */
export const BATCH_MAX_OPS = BATCH_MAX_ROWS * 6;

export function applyBatch(doc, ops, ctx) {
  if (!Array.isArray(ops) || ops.length === 0) {
    const error = { code: CODES.REQUIRED, field: 'rows' };
    return { ok: false, doc, errors: [], error };
  }
  // 행(aux 아님)은 BATCH_MAX_ROWS까지, 표의 연결 칸이 만드는 보조 명령(aux·연결·담당)까지 합쳐 BATCH_MAX_OPS까지(2026-10-18 CR-13 C)
  if (ops.filter((o) => !o.aux && o.op !== 'addEdge' && o.op !== 'assign').length > BATCH_MAX_ROWS) {
    const error = { code: CODES.SCHEMA, field: 'rows', too_many: BATCH_MAX_ROWS };
    return { ok: false, doc, errors: [], error };
  }
  if (ops.length > BATCH_MAX_OPS) {
    const error = { code: CODES.SCHEMA, field: 'rows', too_many: BATCH_MAX_ROWS, links: BATCH_MAX_OPS };
    return { ok: false, doc, errors: [], error };
  }
  const rootId = doc.universe.root_node_id;
  let work = doc;
  const events = [];
  const created = [];
  const updated = [];
  const warnings = [];
  const errors = [];
  const rows = [];
  const createdRow = new Map(); // 묶음 안에서 만든 항목 id → 행 번호
  const rowNode = new Map(); // 행 번호 → 그 행에서 만든 항목 id ('@행번호' 표식 해석용)
  const failedRows = new Set(); // 실패한 행 번호(그 행을 가리키는 연결은 건너뜀)
  const createdEdges = [];
  const assignments = [];

  ops.forEach((op, i) => {
    const row = op.row ?? i + 1;
    const shown = op.shown_row ?? row; // 오류를 보일 화면 행(표의 연결 칸이 만든 보조 명령은 그 칸이 있는 행)
    if (op.op === 'invalid') {
      failedRows.add(row);
      errors.push({ row, error: op.error });
      return;
    }
    if (op.op === 'addNode') {
      const r = addNode(work, op.input, ctx);
      if (!r.ok) {
        failedRows.add(row);
        const error = { ...r.error };
        if (error.existing_id && createdRow.has(error.existing_id)) error.with_row = createdRow.get(error.existing_id);
        errors.push({ row: shown, error });
        return;
      }
      let next = r.doc;
      const evs = [r.event];
      if (op.attachRoot) {
        const e = addEdge(next, { source: rootId, target: r.node.id, core_type: 'contains' }, ctx);
        if (!e.ok) {
          failedRows.add(row);
          errors.push({ row: shown, error: e.error });
          return;
        }
        next = e.doc;
        evs.push(e.event);
      }
      work = next;
      events.push(...evs);
      created.push(r.node);
      warnings.push(...r.warnings);
      createdRow.set(r.node.id, row);
      rowNode.set(row, r.node.id);
      rows.push({ row, kind: 'created', node: r.node, ...(op.aux ? { aux: true } : {}) });
      return;
    }
    if (op.op === 'updateNode') {
      const r = updateNode(work, op.id, op.changes, ctx);
      if (!r.ok) {
        failedRows.add(row);
        errors.push({ row, error: r.error });
        return;
      }
      work = r.doc;
      if (r.event) {
        events.push(r.event);
        updated.push(r.node);
        warnings.push(...r.warnings);
      }
      rows.push({ row, kind: r.event ? 'updated' : 'unchanged', node: r.node });
      return;
    }
    if (op.op === 'addEdge' || op.op === 'assign') {
      const isAssign = op.op === 'assign';
      const input = { ...(op.input || {}) };
      let skip = false;
      for (const k of isAssign ? ['person_id', 'work_id'] : ['source', 'target']) {
        const m = typeof input[k] === 'string' ? /^@(\d+)$/.exec(input[k]) : null;
        if (!m) continue;
        const ref = Number(m[1]);
        if (rowNode.has(ref)) input[k] = rowNode.get(ref);
        else if (failedRows.has(ref)) skip = true; // 앞 행의 오류가 이미 보고된다
        else {
          failedRows.add(row);
          errors.push({ row: shown, error: { code: CODES.SCHEMA, field: k, bad_ref: ref } });
          return;
        }
      }
      if (skip) {
        failedRows.add(row);
        return;
      }
      if (isAssign) {
        // 담당 시작: 수행 연결 + 담당 시작 이력(addAssignment). 이미 계속 담당 중이면 건너뜀(오류 아님)
        const occurred = input.occurred_at || String(ctx.now).slice(0, 10);
        const a = addAssignment(work, { type: 'assign_start', occurred_at: occurred, payload: { person_id: input.person_id, work_id: input.work_id } }, ctx);
        if (!a.ok) {
          if (a.error.code === CODES.DUP && a.error.already_active) {
            warnings.push({ code: 'W-ALREADY-ASSIGNED', row: shown, person_id: input.person_id, work_id: input.work_id });
            rows.push({ row, kind: 'skipped', reason: 'already_assigned' });
            return;
          }
          failedRows.add(row);
          errors.push({ row: shown, error: a.error });
          return;
        }
        work = a.doc;
        events.push(a.event);
        assignments.push(a.edge);
        rows.push({ row, kind: 'assigned', edge: a.edge });
        return;
      }
      const r = addEdge(work, input, ctx);
      if (!r.ok) {
        // skipDup: 이미 같은 연결이 있으면 건너뜀(표의 연결 칸)
        if (op.skipDup && r.error.code === CODES.DUP) {
          rows.push({ row, kind: 'skipped', reason: 'duplicate_edge' });
          return;
        }
        failedRows.add(row);
        errors.push({ row: shown, error: r.error });
        return;
      }
      work = r.doc;
      events.push(r.event);
      createdEdges.push(r.edge);
      rows.push({ row, kind: 'edge', edge: r.edge });
      return;
    }
    failedRows.add(row);
    errors.push({ row, error: { code: CODES.SCHEMA, field: 'op' } });
  });

  if (errors.length) return { ok: false, doc, errors, error: errors[0].error };
  return { ok: true, doc: work, events, created, updated, edges: createdEdges, assignments, warnings, rows };
}

// ── 담당 이력과 수행 연결(02-design 3절: 담당 시작·종료는 수행 연결이 생기거나 끝날 때 남는다) ──

/**
 * 담당 시작·종료를 이력과 수행(performs) 연결에 함께 반영한다(한 묶음).
 *  - assign_start: 사람 → 업무 수행 연결을 시작일로 만들고 이력을 남긴다. 이미 계속 담당 중이면 E-DUP.
 *  - assign_end: 그 사람의 진행 중(끝 없음) 수행 연결에 끝 날짜를 채우고 이력을 남긴다. 진행 중인 연결이 없으면 거부.
 *  - assign_start + input.end_date(선택): 연결을 {start, end} 기간으로 만들고 담당 시작·종료 이력을 함께 남긴다(과거 소급).
 * 이 묶음의 이벤트 순서: 연결 생성(또는 연결 수정) → 담당 이력(→ 끝 날짜가 있으면 담당 종료 이력).
 * @param {{type:'assign_start'|'assign_end', occurred_at:string, payload:{person_id:string, work_id:string}, note?:string}} input
 */
export function addAssignment(doc, input, ctx) {
  const pl = input.payload || {};
  // 끝 날짜(선택, 담당 시작만): 과거 기간을 소급 입력한다(검토7 R7-6). 연결을 {start, end}로 만들고 시작·종료 이력을 함께 남긴다
  const endDate = input.type === 'assign_start' && !isEmpty(input.end_date) ? input.end_date : null;
  if (endDate !== null) {
    if (!isDate(endDate) || (isDate(input.occurred_at) && endDate < input.occurred_at)) return fail(CODES.SCHEMA, { field: 'end_date' });
    // 끝 날짜는 지난 기간을 한 번에 넣기 위한 것: 오늘보다 뒤면 거부한다(미래 종료 이력이 남으면 실제 종료를 기록할 수 없게 됨)
    if (ctx.now && endDate > ctx.now.slice(0, 10)) return fail(CODES.SCHEMA, { field: 'end_date', future: true });
    const probeEnd = addEvent(doc, { type: 'assign_end', occurred_at: endDate, payload: pl }, ctx);
    if (!probeEnd.ok) return probeEnd;
  }
  // 이력 검증(날짜·대상 유형·숨김)을 먼저 한다: 통과하지 못하면 연결도 만들지 않는다
  const probe = addEvent(doc, input, ctx);
  if (!probe.ok) return probe;
  const active = doc.edges.find(
    (e) => !e.hidden && e.core_type === 'performs' && e.source === pl.person_id && e.target === pl.work_id && !(e.period && e.period.end),
  );
  let work = doc;
  let edge;
  if (input.type === 'assign_start') {
    // 끝 날짜가 있으면 계속 담당 중인 연결과 기간이 겹치는지는 아래 addEdge가 가린다
    if (active && endDate === null) return fail(CODES.DUP, { existing_id: active.id, already_active: true });
    const period = endDate === null ? { start: input.occurred_at } : { start: input.occurred_at, end: endDate };
    const r = addEdge(work, { source: pl.person_id, target: pl.work_id, core_type: 'performs', period }, ctx);
    // 끝난 담당 기간과 겹쳐서 거부된 것: 화면이 「같은 노드」가 아니라 담당 기간 문구를 고르게 표시한다(검토7 K-3)
    if (!r.ok) return r.error && r.error.code === CODES.DUP ? { ...r, error: { ...r.error, period_overlap: true } } : r;
    work = r.doc;
    edge = r.edge;
  } else {
    if (!active) return fail(CODES.SCHEMA, { field: 'work_id', no_active: true });
    const r = updateEdge(work, active.id, { period: { ...(active.period || {}), end: input.occurred_at } }, ctx);
    if (!r.ok) return r;
    work = r.doc;
    edge = r.edge;
  }
  const ev = addEvent(work, input, ctx);
  if (!ev.ok) return ev;
  if (endDate !== null) {
    const endEv = addEvent(ev.doc, { type: 'assign_end', occurred_at: endDate, payload: pl }, ctx);
    if (!endEv.ok) return endEv;
    return { ok: true, doc: endEv.doc, event: ev.event, endEvent: endEv.event, edge };
  }
  return { ok: true, doc: ev.doc, event: ev.event, edge };
}
