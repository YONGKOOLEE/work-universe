// 확정 때 「담당도 넘기기」(CR-18-6): 어떤 업무의 담당을 넘길 수 있는지 고르는 순수 계산. 화면(ui/draft.js)과 확정 명령(app/app.js)이 같은 규칙을 쓴다.
// 데이터를 바꾸지 않는다. 바꾸는 일은 app.confirmHandover가 기존 명령(addAssignment: 담당 종료·시작)으로 한 묶음으로 한다.

import { DRAFT_TARGET_TYPES } from '../model/schema.js';
import { scopeWorks } from '../rules/handover.js';

/** 진행 중인 수행 연결: 숨기지 않았고 끝 날짜가 없다(model/commands.js addAssignment의 active와 같은 기준) */
const active = (e) => !e.hidden && e.core_type === 'performs' && !(e.period && e.period.end);

/** 그 유니버스 안의 ID(없으면 null). 합쳐진 노드면 그 유니버스에 있는 원본의 ID */
export function localIdIn(view, gid, uid) {
  if (!gid) return null;
  if (gid.startsWith(`${uid}/`)) return gid.slice(uid.length + 1);
  const own = ((view.getNode(gid) || {}).merged_from || []).find((g) => g.startsWith(`${uid}/`));
  return own ? own.slice(uid.length + 1) : null;
}

/** 확정이 인수인계 이력을 남기는 업무(전역 참조): 대상이 업무면 그 업무, 지도 중심이면 범위 업무 중 보내는 사람이 맡았던 업무 */
export function handoverWorks(view, { target, from }) {
  const t = view.getNode(target);
  if (!t || !DRAFT_TARGET_TYPES.includes(t.core_type)) return [];
  if (t.core_type === 'work') return [t.gid];
  const performed = (w) => view.edges.some((e) => !e.hidden && e.core_type === 'performs' && e.target === w && e.source === from);
  return scopeWorks(view, t.gid).map((g) => view.canonical(g)).filter(performed);
}

/**
 * 담당을 넘길 업무를 고른다.
 *  - moves: 보내는 사람이 지금 수행 중(끝 날짜 없는 수행 연결이 uid 유니버스 안에 있음)이고 받는 사람은 아직 아닌 업무 [{work, edge_id}]
 *  - already: 받는 사람이 이미 수행 중이라 건너뛰는 업무(보내는 사람의 연결은 그대로 둔다)
 *  - elsewhere: 보내는 사람이 수행 중이지만 연결이 다른 유니버스에 있어 이 화면에서 못 넘기는 업무
 *  - persons_ok: 보내는·받는 사람이 모두 uid 유니버스 안에 있는가(없으면 연결을 만들거나 끝낼 수 없다)
 * @returns {{moves:{work:string, edge_id:string}[], already:string[], elsewhere:string[], persons_ok:boolean, from_local:string|null, to_local:string|null}}
 */
export function transferPlan(view, { target, from, to }, uid) {
  const fromLocal = localIdIn(view, from, uid);
  const toLocal = localIdIn(view, to, uid);
  const out = { moves: [], already: [], elsewhere: [], persons_ok: !!(fromLocal && toLocal), from_local: fromLocal, to_local: toLocal };
  for (const w of handoverWorks(view, { target, from })) {
    const mine = view.edges.filter((e) => active(e) && e.source === from && e.target === w);
    if (!mine.length) continue; // 이미 끝난 담당: 넘길 것이 없다
    const here = mine.find((e) => e.universe_id === uid);
    if (!here) {
      out.elsewhere.push(w);
      continue;
    }
    if (view.edges.some((e) => active(e) && e.source === to && e.target === w)) {
      out.already.push(w);
      continue;
    }
    out.moves.push({ work: w, edge_id: here.id });
  }
  return out;
}

/**
 * 인수인계 초안의 보내는·받는 사람 목록 순서(T6): 초안 범위(대상 업무 또는 지도 중심의 범위 업무)를 수행한 사람이 먼저, 그 밖의 사람이 뒤.
 * 「수행한」은 끝난 담당까지 포함한다(숨기지 않은 수행 연결이 한 번이라도 있음). 각 묶음 안은 받은 순서를 지킨다.
 * 범위를 알 수 없거나(대상 없음·범위 업무 없음) 수행한 사람이 없으면 inScope가 비고 others가 전부다(순서 그대로).
 * @param {{nodes:object[], edges:object[]}} view
 * @param {string} targetGid
 * @param {{gid:string}[]} people 사람 노드(보이는 것)
 * @returns {{inScope:object[], others:object[]}}
 */
export function peopleByScope(view, targetGid, people) {
  const works = new Set(targetGid ? scopeWorks(view, targetGid).map((g) => view.canonical(g)) : []);
  if (!works.size) return { inScope: [], others: [...people] };
  const performers = new Set();
  for (const e of view.edges) if (!e.hidden && e.core_type === 'performs' && works.has(e.target)) performers.add(e.source);
  return { inScope: people.filter((p) => performers.has(p.gid)), others: people.filter((p) => !performers.has(p.gid)) };
}
