// 새 유니버스의 「첫 업무(선택)」(조력자 의견 2026-10-17 "어떻게 시작할지 막막하다", 01 R-12·R-08).
// 방금 만든 유니버스(꼭지만 있음)에 업무 하나와 선택으로 담당자·산출물을 한 번에 넣는다.
// 순수 함수: DOM·저장소를 쓰지 않는다. 한 단계라도 실패하면 문서는 그대로다(전부 아니면 전무).
import { addAssignment, addEdge, addNode } from './commands.js';

const text = (v) => (typeof v === 'string' ? v.trim() : '');

// 오류에 어느 칸에서 났는지(starter_*)를 붙인다. 원래 필드는 inner_field에 남긴다
const wrap = (error, field) => ({ ...error, field, ...(error.field ? { inner_field: error.field } : {}) });

/**
 * @param {object} doc 방금 만든 유니버스 문서
 * @param {{work?:string, person?:string, cycle?:string, due?:string, artifact?:string}} starter
 * @param {{now:string, random?:()=>number}} ctx
 * @returns {{ok:true, doc:object, skipped:true} | {ok:true, doc:object, created:{work:object, person?:object, artifact?:object}} | {ok:false, error:object}}
 */
export function applyStarter(doc, starter, ctx) {
  const s = starter || {};
  const work = text(s.work);
  const person = text(s.person);
  const cycle = text(s.cycle);
  const due = text(s.due);
  const artifact = text(s.artifact);
  if (!work) return { ok: true, doc, skipped: true };

  const attrs = { ...(cycle ? { 주기: cycle } : {}), ...(due ? { 마감: due } : {}) };
  const w = addNode(doc, { core_type: 'work', label: work, ...(Object.keys(attrs).length ? { attrs } : {}) }, ctx);
  if (!w.ok) return { ok: false, error: wrap(w.error, 'starter_work') };
  const rootLink = addEdge(w.doc, { source: doc.universe.root_node_id, target: w.node.id, core_type: 'contains' }, ctx);
  if (!rootLink.ok) return { ok: false, error: wrap(rootLink.error, 'starter_work') };
  let next = rootLink.doc;
  const created = { work: w.node };

  if (person) {
    const p = addNode(next, { core_type: 'person', label: person }, ctx);
    if (!p.ok) return { ok: false, error: wrap(p.error, 'starter_person') };
    const a = addAssignment(p.doc, { type: 'assign_start', occurred_at: ctx.now.slice(0, 10), payload: { person_id: p.node.id, work_id: w.node.id } }, ctx);
    if (!a.ok) return { ok: false, error: wrap(a.error, 'starter_person') };
    next = a.doc;
    created.person = p.node;
  }

  if (artifact) {
    const x = addNode(next, { core_type: 'artifact', label: artifact }, ctx);
    if (!x.ok) return { ok: false, error: wrap(x.error, 'starter_artifact') };
    const e = addEdge(x.doc, { source: w.node.id, target: x.node.id, core_type: 'produces' }, ctx);
    if (!e.ok) return { ok: false, error: wrap(e.error, 'starter_artifact') };
    next = e.doc;
    created.artifact = x.node;
  }
  return { ok: true, doc: next, created };
}
