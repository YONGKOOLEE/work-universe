// 변환 결과를 비교하기 쉬운 줄 목록으로(노드·연결·메모·알림·절 보고). 고정 비교 테스트와 스냅숏 갱신 도구가 함께 쓴다.
// 2026-10-04 재검증 도구(scratchpad verify-0404/dump.mjs)를 옮긴 것.
import { convertDocument } from '../../../app/src/rules/doc-convert.js';
import { CASES } from './cases-a.mjs';
import { NC } from './cases-b.mjs';

export const ctx = { now: '2026-10-04T09:00:00+09:00', random: () => 0.5 };
export const ALL_CASES = [...CASES, ...NC];

// cr17j: CR-17 J 스위치를 이 호출에서만 덮어쓴다(예: 전부 켠 결과 보기). 없으면 CONVERT_RULES.cr17j(기본 전부 꺼짐)
export function dump(text, cr17j) {
  let r;
  try { r = convertDocument(text, cr17j ? { ...ctx, cr17j } : ctx); } catch (e) { return ['CRASH ' + e.message]; }
  if (!r.ok) return ['ERROR ' + JSON.stringify(r.error)];
  const d = r.doc;
  const out = [];
  const lab = new Map(d.nodes.map((n) => [n.id, n.label]));
  out.push(`U name=${d.universe.name} owner=${d.universe.owner}`);
  out.push(`U desc=${JSON.stringify(d.universe.description)}`);
  for (const n of d.nodes) out.push(`N [${n.core_type}${n.subtype ? '/' + n.subtype : ''}] ${n.label} | desc=${JSON.stringify(n.description || '')} | attrs=${JSON.stringify(n.attrs || {})}`);
  for (const e of d.edges) out.push(`E ${lab.get(e.source)}>${lab.get(e.target)}:${e.core_type}${e.note ? ' (' + e.note + ')' : ''}`);
  for (const e of d.events) out.push(`EV ${e.type} ${e.occurred_at} ${lab.get(e.payload && e.payload.target_id) ?? ''} [${(e.payload && e.payload.category) ?? ''}] ${JSON.stringify(e.note ?? '')}`);
  for (const n of r.report.notes) out.push(`NOTE ${JSON.stringify(n)}`);
  for (const s of r.report.sections || []) out.push(`SEC ${JSON.stringify(s)}`);
  return out;
}
