// 편집 되감기(CR-14 A, R-25, D-30). 순수 함수 — DOM·저장소를 쓰지 않는다.
// 원리: 저장 방식은 그대로 두고, 지금 문서에서 그 시점(기록 시각) 뒤의 이력을 거꾸로 적용해 옛 문서를 만든다.
// 되돌리기는 옛 문서와 같아지도록 기존 명령(숨김·되살림·수정·연결 생성 …)을 한 묶음으로 적용한다(지우지 않는다, D-04).
//
// 한계(문서화, limits로 알린다)
//  - 「바로 삭제」한 노드와 하위 유형 추가는 이력이 없어 되감기에 보이지 않는다.
//  - 「완전히 삭제」(purge)한 노드는 내용·붙은 연결을 이미 지웠으므로 자리표시로만 남는다(limit 'purged').
//  - 노드 updated_at은 그 노드의 남은 생성·수정·숨김 이력 중 마지막 시각(없으면 created_at)으로 복원한다.
//    이력 없이 들어온 노드(문서 변환·가져오기)는 이력이 되감기에 닿지 않는 한 값을 그대로 둔다.
//  - 동일성 연결의 수정 이력에는 status·method 이전 값만 있다. 점수·이유·판정자·판정 시각은 복원하지 못한다(limit 'identity_detail').

import { addEdge, addRef, decideIdentity, hideEdge, hideNode, hideRef, restoreNode, updateEdge, updateNode } from './commands.js';
import { nodeDupKey } from './checks.js';
import { LABEL_MAX } from './schema.js';

// 되돌리기 중간에 이름이 겹칠 노드를 잠시 비켜 둘 이름(같은 묶음 안에서 곧 그때 이름으로 바뀐다)
const tempLabel = (n) => { const tail = ` (되감기 중 ${n.id})`; return `${String(n.label).slice(0, Math.max(1, LABEL_MAX - tail.length))}${tail}`; };

// C14-1: 같은 기록 시각(한 번의 저장) = 한 판. 바꾸려면 여기 한 곳만 고친다
const groupKey = (recordedAt) => Date.parse(recordedAt);

const NODE_FIELDS = ['label', 'description', 'attrs', 'tags', 'period', 'subtype', 'emp_no', 'exposed'];
const EDGE_FIELDS = ['subtype', 'period', 'note'];
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const copy = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
const bad = (field) => ({ ok: false, error: { code: 'E-SCHEMA', field } });

/** 기록 시각 문자열이 읽히는가 */
export function validAt(at) {
  return typeof at === 'string' && !Number.isNaN(Date.parse(at));
}

/** 시점 표시 "2026-10-23 14:05"(기록 문자열의 날짜·시:분 그대로, 읽히지 않으면 원문) */
export function pointLabel(at) {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(String(at));
  return m ? `${m[1]} ${m[2]}` : String(at);
}

/**
 * 편집 시점 목록. 같은 기록 시각의 이력은 한 판이다(C14-1). 오래된 순.
 * @returns {{at:string, count:number, kinds:string[]}[]} kinds는 그 판에 있는 이력 종류(created·updated·hidden·memo …)
 */
export function editPoints(doc) {
  const groups = new Map();
  for (const ev of (doc && doc.events) || []) {
    if (!ev || !validAt(ev.recorded_at)) continue;
    const key = groupKey(ev.recorded_at);
    if (!groups.has(key)) groups.set(key, { at: ev.recorded_at, count: 0, kinds: [] });
    const g = groups.get(key);
    g.count += 1;
    if (!g.kinds.includes(ev.type)) g.kinds.push(ev.type);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g);
}

function setBefore(target, before, skip = []) {
  for (const [k, v] of Object.entries(before || {})) {
    if (skip.includes(k)) continue;
    if (v === null || v === undefined) delete target[k];
    else target[k] = copy(v);
  }
}

// 이력 하나를 거꾸로 적용한다(work는 복사본). 대상이 없으면(바로 삭제·완전히 삭제로 사라짐) 건너뛴다
function reverseEvent(work, ev, ctx) {
  const p = ev.payload;
  if (!p || !['created', 'updated', 'hidden'].includes(ev.type)) return;
  const id = p.target_id;
  if (p.target_kind === 'node') {
    if (ev.type === 'created') {
      work.nodes = work.nodes.filter((n) => n.id !== id);
      return;
    }
    const n = work.nodes.find((x) => x.id === id);
    if (!n) return;
    ctx.touched.add(id);
    if (ev.type === 'hidden') {
      // 완전히 삭제한 노드(자리표시)는 과거 시점에서도 숨긴 채로 둔다: 내용이 없고, 보이는 자리표시는 검증 규칙(deleted면 hidden)을 깬다(재검증 결함 2)
      if (!n.deleted) n.hidden = false;
      return;
    }
    if (p.after && p.after.deleted === true) {
      if (!ctx.purged.has(id)) {
        ctx.purged.add(id);
        ctx.limits.push({ code: 'purged', id });
      }
      return; // 지운 내용은 되살릴 수 없다
    }
    setBefore(n, p.before, ['deleted']);
    return;
  }
  if (p.target_kind === 'edge') {
    if (ev.type === 'created') {
      work.edges = work.edges.filter((e) => e.id !== id);
      return;
    }
    const e = work.edges.find((x) => x.id === id);
    if (!e) return;
    if (ev.type === 'hidden') e.hidden = false;
    else setBefore(e, p.before);
    return;
  }
  if (p.target_kind === 'ref') {
    const refs = work.refs || [];
    if (ev.type === 'created') {
      let i = -1;
      for (let k = refs.length - 1; k >= 0; k -= 1) {
        if (refs[k].child_universe_id === id && (i < 0 || refs[k].added_at === ev.recorded_at)) {
          i = k;
          if (refs[k].added_at === ev.recorded_at) break;
        }
      }
      if (i >= 0) refs.splice(i, 1);
      return;
    }
    if (ev.type === 'hidden') {
      let i = -1;
      for (let k = refs.length - 1; k >= 0; k -= 1) {
        if (refs[k].child_universe_id === id && refs[k].hidden && (i < 0 || refs[k].removed_at === ev.recorded_at)) {
          i = k;
          if (refs[k].removed_at === ev.recorded_at) break;
        }
      }
      if (i >= 0) {
        delete refs[i].hidden;
        delete refs[i].removed_at;
      }
    }
    return;
  }
  if (p.target_kind === 'identity_link') {
    const links = work.identity_links || [];
    if (ev.type === 'created') {
      work.identity_links = links.filter((l) => l.id !== id);
      return;
    }
    const l = links.find((x) => x.id === id);
    if (!l || ev.type !== 'updated') return;
    if (p.before && p.before.status !== undefined) l.status = p.before.status;
    if (p.before && p.before.method !== undefined) l.method = p.before.method;
    if (l.method === 'human' && l.status !== 'pending') {
      if (!ctx.identityLimit.has(id)) {
        ctx.identityLimit.add(id);
        ctx.limits.push({ code: 'identity_detail', id });
      }
    } else {
      delete l.decided_by;
      delete l.decided_at;
    }
  }
}

function diffDocs(cur, then) {
  const added = [];
  const changed = [];
  const hidden = [];
  const thenNodes = new Map(then.nodes.map((n) => [n.id, n]));
  const thenEdges = new Map(then.edges.map((e) => [e.id, e]));
  const scan = (list, map, fields, kind) => {
    for (const c of list) {
      const t = map.get(c.id);
      if (!t) {
        added.push(c.id);
        continue;
      }
      const diffFields = fields.filter((f) => !same(c[f], t[f]));
      if (!!c.hidden !== !!t.hidden) {
        if (c.hidden) hidden.push(c.id);
        else diffFields.push('hidden');
      }
      if (diffFields.length) changed.push({ id: c.id, kind, fields: diffFields });
    }
  };
  scan(cur.nodes, thenNodes, NODE_FIELDS, 'node');
  scan(cur.edges, thenEdges, EDGE_FIELDS, 'edge');
  return { added, changed, hidden };
}

/**
 * 그 시점(at, 기록 시각)의 문서를 만든다. 입력 문서는 바꾸지 않는다(동결된 문서도 가능).
 * @returns {{ok:true, doc:object, diff:{added:string[], changed:{id:string,kind:string,fields:string[]}[], hidden:string[]},
 *   limits:{code:string, id?:string}[]} | {ok:false, error:object}}
 *   diff는 지금과 비교: added = 그 시점 뒤에 생긴 노드·연결 id, changed = 바뀐 것(숨김 해제 포함), hidden = 그 시점 뒤에 숨긴 것
 */
export function rewind(doc, at) {
  if (!doc || !Array.isArray(doc.events) || !Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) return bad('doc');
  if (!validAt(at)) return bad('at');
  const atMs = Date.parse(at);
  const work = copy(doc);
  work.refs = work.refs || [];
  work.identity_links = work.identity_links || [];
  const ctx = { touched: new Set(), purged: new Set(), identityLimit: new Set(), limits: [] };
  // "그 시점 뒤"는 기록 순서로 자른다: 시각이 at보다 늦은 첫 이력부터 끝까지. 이력은 덧붙이기만 하므로 보통은 시각 순서와 같고,
  // 다른 PC 시계(미래 시각, L-42)가 섞여도 그 자리에서 끊어 문서가 어긋나지 않는다(재검증 결함 3: 시각만 보면 생성은 빠지고 그 수정 이력은 남음)
  const isLater = (ev) => ev && validAt(ev.recorded_at) && Date.parse(ev.recorded_at) > atMs;
  const found = work.events.findIndex(isLater);
  const cut = found < 0 ? work.events.length : found;
  for (let i = work.events.length - 1; i >= cut; i -= 1) reverseEvent(work, work.events[i], ctx);
  work.events = work.events.slice(0, cut);
  // updated_at: 남은 노드 이력 중 마지막 시각, 없으면 created_at
  for (const id of ctx.touched) {
    const n = work.nodes.find((x) => x.id === id);
    if (!n || n.deleted) continue;
    let best = null;
    for (const ev of work.events) {
      const p = ev.payload;
      if (['created', 'updated', 'hidden'].includes(ev.type) && p && p.target_kind === 'node' && p.target_id === id && validAt(ev.recorded_at)
        && (best === null || Date.parse(ev.recorded_at) >= Date.parse(best))) best = ev.recorded_at;
    }
    n.updated_at = best || n.created_at;
  }
  return { ok: true, doc: work, diff: diffDocs(doc, work), limits: ctx.limits };
}

const activeChildren = (d) => new Set((d.refs || []).filter((r) => !r.hidden).map((r) => r.child_universe_id));

/**
 * 지금 문서를 그 시점과 같게 만들 명령 목록. 순서가 중요하다(숨김 → 되살림 → 수정 → 연결 생성 → 숨김 → 묶기 → 통합 판정).
 * 사용자 이력(메모·인수인계·담당)은 되돌리지 않는다(C14-3). 그 뒤 생긴 노드·연결은 지우지 않고 숨긴다(C14-2).
 * 숨긴 채로 남는 노드·연결의 칸 값은 맞추지 않는다(보이는 것만 같게 한다).
 * @returns {{ok:true, ops:object[], counts:object, limits:object[], rewound:object} | {ok:false, error:object}}
 *   op: {op:'hideNode'|'restoreNode'|'updateNode'|'hideEdge'|'updateEdge'|'addEdge'|'hideRef'|'addRef'|'decideIdentity', ..., soft?:true}
 *   soft 명령은 실패해도 건너뛰고 limits에 건수로 알린다(묶기·통합 판정)
 */
export function rewindOps(current, at) {
  const r = rewind(current, at);
  if (!r.ok) return r;
  const then = r.doc;
  const limits = [...r.limits];
  const tNode = new Map(then.nodes.map((n) => [n.id, n]));
  const tEdge = new Map(then.edges.map((e) => [e.id, e]));
  const cNode = new Map(current.nodes.map((n) => [n.id, n]));
  const ops = [];
  const counts = { hide_nodes: 0, temp_renames: 0, restore_nodes: 0, update_nodes: 0, hide_edges: 0, add_edges: 0, temp_restores: 0, update_edges: 0, hide_refs: 0, add_refs: 0, identity: 0 };
  const push = (o, key) => {
    ops.push(o);
    counts[key] += 1;
  };
  // 순서(재검증 결함 1: 같은 이름·사번이 중간 상태에서 겹쳐 E-DUP로 통째로 실패하던 문제):
  //   1) 숨김을 먼저(그 뒤 생긴 것 + 그때 숨겨져 있던 것) → 2) 겹칠 노드만 임시 이름·사번 → 3) 되살림 → 4) 그때 값으로 수정
  // 1) 그 시점 뒤에 생긴 노드, 그 시점에 숨겨져 있던 노드, 그런 연결을 숨긴다
  const hiddenNow = new Set();
  for (const n of current.nodes) {
    if (n.core_type === 'root' || n.hidden || n.deleted) continue;
    const t = tNode.get(n.id);
    if (t && !t.hidden) continue;
    hiddenNow.add(n.id);
    push({ op: 'hideNode', id: n.id }, 'hide_nodes');
  }
  for (const e of current.edges) {
    const t = tEdge.get(e.id);
    if (!e.hidden && (!t || t.hidden)) push({ op: 'hideEdge', id: e.id }, 'hide_edges');
  }
  // 되살릴 노드와, 그 뒤 보이는 노드(그때도 보이던 것)
  const restored = new Set();
  for (const n of current.nodes) {
    const t = tNode.get(n.id);
    if (!t || t.hidden || !n.hidden) continue;
    if (n.deleted) {
      limits.push({ code: 'purged_skip', id: n.id });
      continue;
    }
    restored.add(n.id);
  }
  const staying = current.nodes.filter((n) => !n.hidden && !n.deleted && !hiddenNow.has(n.id) && tNode.has(n.id));
  // 2) 지금 이름(사번)이 다른 노드의 그때 이름(사번)이나 되살릴 노드의 이름과 겹치면, 그 노드를 먼저 임시 값으로 비켜 둔다
  const claimed = new Map(); // 중복 키 → 그 키를 갖게 될 노드 id들
  const claim = (key, id) => { if (key) (claimed.get(key) || claimed.set(key, []).get(key)).push(id); };
  for (const n of staying) claim(nodeDupKey(tNode.get(n.id)), n.id);
  for (const id of restored) { claim(nodeDupKey(cNode.get(id)), id); claim(nodeDupKey(tNode.get(id)), id); }
  // 되살릴 노드의 지금 이름(되살릴 때 쓰는 값)과 겹치는 노드는 자기 이름이 안 바뀌어도 잠시 비켜 둔다
  const restoreKeys = new Set([...restored].map((id) => nodeDupKey(cNode.get(id))).filter(Boolean));
  const tempRenamed = new Set();
  for (const n of staying) {
    const key = nodeDupKey(n);
    if (!key) continue;
    const changing = key !== nodeDupKey(tNode.get(n.id));
    if (!(claimed.get(key) || []).some((id) => id !== n.id)) continue;
    if (!changing && !restoreKeys.has(key)) continue;
    const changes = n.core_type === 'person' ? { emp_no: null } : { label: tempLabel(n) };
    tempRenamed.add(n.id);
    push({ op: 'updateNode', id: n.id, changes, temp: true }, 'temp_renames');
  }
  // 3) 그 뒤 숨긴 노드를 되살린다. 그래도 겹치면(드묾: 숨긴 동안 다른 노드가 그 이름을 씀) 그 노드만 숨긴 채로 두고 알린다
  // 되살린 노드도 지금 이름이 다른 노드의 그때 이름(또는 다른 되살릴 노드의 지금 이름)과 겹치면 바로 임시 값으로 비켜 둔다.
  // 되살림과 비켜 두기를 노드마다 번갈아 해서, 같은 이름으로 숨겨진 노드 둘도 차례로 되살린다(되살림이 실패하면 함께 건너뜀)
  // 이름(사번)이 바뀔 노드부터 되살려 비켜 두고, 그대로인 노드는 뒤에(같은 이름으로 숨겨진 둘 중 그대로인 쪽이 자리를 먼저 차지하지 않게)
  const changesKey = (id) => nodeDupKey(cNode.get(id)) !== nodeDupKey(tNode.get(id));
  const restoreOrder = [...restored].sort((x, y) => Number(changesKey(y)) - Number(changesKey(x)));
  for (const id of restoreOrder) {
    push({ op: 'restoreNode', id, soft: true }, 'restore_nodes');
    const n = cNode.get(id);
    const key = nodeDupKey(n);
    if (!key || key === nodeDupKey(tNode.get(id))) continue;
    if (!(claimed.get(key) || []).some((x) => x !== id)) continue;
    tempRenamed.add(id);
    push({ op: 'updateNode', id, changes: n.core_type === 'person' ? { emp_no: null } : { label: tempLabel(n) }, temp: true, soft: true }, 'temp_renames');
  }
  // 4) 바뀐 칸을 그때 값으로. 되살린 노드의 수정은 되살림이 실패하면 함께 건너뛴다(soft)
  for (const n of current.nodes) {
    const t = tNode.get(n.id);
    if (!t || t.hidden || n.deleted || (n.hidden && !restored.has(n.id))) continue;
    const changes = {};
    for (const f of NODE_FIELDS) if (!same(n[f], t[f])) changes[f] = copy(t[f]) ?? null;
    // 임시 값으로 비켜 둔 노드는 이름(사번)이 그대로여도 그때 값을 다시 넣는다
    if (tempRenamed.has(n.id)) changes[n.core_type === 'person' ? 'emp_no' : 'label'] = copy(t[n.core_type === 'person' ? 'emp_no' : 'label']) ?? null;
    if (Object.keys(changes).length) push({ op: 'updateNode', id: n.id, changes, ...(restored.has(n.id) ? { soft: true } : {}) }, 'update_nodes');
  }
  for (const e of current.edges) {
    const t = tEdge.get(e.id);
    if (!t || t.hidden || e.hidden) continue;
    const changes = {};
    for (const f of EDGE_FIELDS) if (!same(e[f], t[f])) changes[f] = copy(t[f]) ?? null;
    if (Object.keys(changes).length) push({ op: 'updateEdge', id: e.id, changes }, 'update_edges');
  }
  // 4) 그 뒤 숨긴 연결은 같은 내용으로 새로 만든다(숨긴 연결을 되살리는 명령이 없다)
  // 연결은 끝 노드가 숨겨져 있어도 남을 수 있다(그 시점에 끝이 숨겨져 있던 연결). 만들 때만 잠깐 되살렸다가 5)에서 다시 숨긴다
  const shown = (id) => {
    const n = cNode.get(id);
    return !!n && ((!n.hidden && !hiddenNow.has(id)) || restored.has(id));
  };
  const tempShown = new Set();
  for (const e of current.edges) {
    const t = tEdge.get(e.id);
    if (!t || t.hidden || !e.hidden) continue;
    const need = [t.source, t.target].filter((id, i, arr) => !shown(id) && arr.indexOf(id) === i);
    const impossible = need.some((id) => { const n = cNode.get(id); return !n || n.deleted || n.core_type === 'root'; });
    if (impossible) {
      limits.push({ code: 'edge_end_hidden', id: e.id });
      continue;
    }
    for (const id of need) {
      if (tempShown.has(id)) continue;
      tempShown.add(id);
      push({ op: 'restoreNode', id, soft: true, temp: true }, 'temp_restores');
    }
    const input = { source: t.source, target: t.target, core_type: t.core_type };
    for (const f of EDGE_FIELDS) if (t[f] !== undefined) input[f] = copy(t[f]);
    // 끝을 잠깐 되살리거나, 끝이 되살릴 노드(되살림이 실패할 수 있음)면 실패해도 건너뛴다
    push({ op: 'addEdge', input, from_id: e.id, ...(need.length || restored.has(t.source) || restored.has(t.target) ? { soft: true } : {}) }, 'add_edges');
  }
  // 5) 연결을 만들려고 잠깐 되살린 노드를 다시 숨긴다(그때 숨겨져 있던 노드는 1)에서 숨겼다)
  for (const id of tempShown) push({ op: 'hideNode', id }, 'hide_nodes');
  // 6) 묶기(참조)
  const thenKids = activeChildren(then);
  const curKids = activeChildren(current);
  for (const id of curKids) if (!thenKids.has(id)) push({ op: 'hideRef', child: id, soft: true }, 'hide_refs');
  for (const id of thenKids) if (!curKids.has(id)) push({ op: 'addRef', child: id, soft: true }, 'add_refs');
  // 7) 통합 판정: 그때 있던 판정의 상태·방법이 지금과 다르면 다시 기록한다. 그 뒤 새로 생긴 판정은 없앨 수 없어 건너뛴다
  const tLink = new Map((then.identity_links || []).map((l) => [l.id, l]));
  let skipped = 0;
  for (const l of current.identity_links || []) {
    const t = tLink.get(l.id);
    if (!t) {
      skipped += 1;
      continue;
    }
    if (t.status === l.status && t.method === l.method) continue;
    push({
      op: 'decideIdentity', soft: true,
      input: { a: t.a, b: t.b, kind: t.kind, method: t.method, status: t.status, ...(t.decided_by ? { decided_by: t.decided_by } : {}), ...(t.reason ? { reason: t.reason } : {}) },
    }, 'identity');
  }
  if (skipped) limits.push({ code: 'identity_created_after', count: skipped });
  return { ok: true, ops, counts, limits, rewound: r };
}

/**
 * 기록 시각 now가 이력의 마지막 시각보다 늦지 않으면(같은 초 등) 마지막 시각 + 1초를 now와 같은 시간대 표기로 돌려준다(재검증 결함 4).
 * now가 이미 늦으면 그대로. 표기를 읽지 못하면 now 그대로
 */
export function laterThanLast(now, events = []) {
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) return now;
  let last = -Infinity;
  for (const ev of events) {
    const t = ev && validAt(ev.recorded_at) ? Date.parse(ev.recorded_at) : NaN;
    if (!Number.isNaN(t) && t > last) last = t;
  }
  if (nowMs > last) return now;
  const ms = Math.floor(last / 1000) * 1000 + 1000;
  const m = /([+-])(\d\d):(\d\d)$/.exec(now);
  if (!m) return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const off = (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  const d = new Date(ms + off * 60000);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}${m[1]}${m[2]}:${m[3]}`;
}

/**
 * rewindOps의 명령을 차례로 적용한다(전부 아니면 전무). 새 이력마다 note "편집 되감기: {label}으로 되돌림"을 붙인다.
 * (makeEvent는 note를 받지 않아, 명령이 만든 이력에 여기서 덧붙인다.)
 * @param {{now:string, random?:()=>number, source?:string}} ctx
 * @param {{resolve?:(id:string)=>object|null, label?:string, decidedBy?:string}} opts resolve는 묶기 추가의 순환·존재 검사용
 * @returns {{ok:true, doc:object, applied:number, skipped:object[]} | {ok:false, doc:object, error:object, op:object}}
 */
export function applyRewindOps(doc, ops, ctx, opts = {}) {
  if (!Array.isArray(ops) || ops.length === 0) return { ok: false, doc, error: { code: 'E-REQUIRED', field: 'ops' }, op: null };
  const resolve = opts.resolve || (() => null);
  const decidedBy = opts.decidedBy || '편집 되감기';
  let work = doc;
  const start = doc.events.length;
  const skipped = [];
  let applied = 0;
  for (const o of ops) {
    let r;
    if (o.op === 'hideNode') r = hideNode(work, o.id, ctx);
    else if (o.op === 'restoreNode') r = restoreNode(work, o.id, ctx);
    else if (o.op === 'updateNode') r = updateNode(work, o.id, o.changes, ctx);
    else if (o.op === 'hideEdge') r = hideEdge(work, o.id, ctx);
    else if (o.op === 'updateEdge') r = updateEdge(work, o.id, o.changes, ctx);
    else if (o.op === 'addEdge') r = addEdge(work, o.input, ctx);
    else if (o.op === 'hideRef') r = hideRef(work, o.child, ctx);
    else if (o.op === 'addRef') r = addRef(work, o.child, ctx, resolve);
    else if (o.op === 'decideIdentity') r = decideIdentity(work, { ...o.input, decided_by: o.input.decided_by || decidedBy }, ctx);
    else r = { ok: false, error: { code: 'E-SCHEMA', field: 'op' } };
    if (!r.ok) {
      if (o.soft) {
        skipped.push({ op: o.op, error: r.error, ...(o.child ? { child: o.child } : {}) });
        continue;
      }
      return { ok: false, doc, error: r.error, op: o };
    }
    work = r.doc;
    applied += 1;
  }
  const note = `편집 되감기: ${opts.label || ''}으로 되돌림`;
  const events = work.events.map((ev, i) => (i >= start ? { ...ev, note } : ev));
  return { ok: true, doc: { ...work, events }, applied, skipped };
}
