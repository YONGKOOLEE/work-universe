// 다시 뽑은 초안의 「새로」 표시 판정(CR-18 D-13). 순수 함수이며 view만 입력으로 받는다(DOM·저장소를 쓰지 않는다).
// 지난번에 같은 대상으로 초안을 만든 시각(since) 이후에 기록된(recorded_at) 이력이 근거에 들어 있는 문장이 「새로」다.
// 일상 사용 2회차 T2(D-13·L-57): 노드·연결 근거는 그 노드·연결의 마지막 수정 기록(created/updated 이벤트의 recorded_at — 속성 고치기·새 협업자·마감 변경)으로 판정한다.
//   한 노드의 속성 하나만 고쳐도 그 노드가 근거인 문장(개요·절차·마감·주의사항)이 모두 「새로」가 될 수 있다 — 어느 속성이 바뀌었는지는 가리지 않는다(과하게 보이는 쪽, 놓치지 않는 쪽).
// 시각을 저장하는 곳은 store/draft-seen.js(이 브라우저 설정 전용)이고, 문서·내보내기·백업에는 들어가지 않는다.

import { refGid } from '../view/view.js';

const instant = (s) => {
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
};

/** 노드·연결의 기록 시각을 모으는 이벤트 유형(「숨김」·되살림은 속성 수정이 아니라 보지 않는다) */
export const DRAFT_NEW_RECORD_TYPES = Object.freeze(['created', 'updated']);

const lastEditCache = new WeakMap(); // view → {events, n, map}: 같은 view·같은 이벤트 수일 때만 다시 쓴다
/**
 * 노드·연결 gid → 마지막 수정 기록 시각(ms). view.events의 created/updated(target_kind node·edge) 이벤트로 만든다. view마다 한 번만 계산한다.
 * view.canonical이 있으면 합쳐진 노드의 대표 gid로도 찾는다(초안 근거는 대표 gid)
 */
function lastEditByTarget(view) {
  const evs = Array.isArray(view.events) ? view.events : [];
  const hit = lastEditCache.get(view);
  if (hit && hit.events === evs && hit.n === evs.length) return hit.map;
  const out = new Map();
  const canon = typeof view.canonical === 'function' ? view.canonical : (g) => g;
  for (const ev of evs) {
    const p = ev && ev.payload;
    if (!DRAFT_NEW_RECORD_TYPES.includes(ev.type) || !p || !['node', 'edge'].includes(p.target_kind) || !p.target_id) continue;
    const at = instant(ev.recorded_at);
    if (at === null) continue;
    const raw = refGid(ev.universe_id, String(p.target_id));
    for (const g of new Set([raw, canon(raw)])) if (!(out.get(g) >= at)) out.set(g, at);
  }
  lastEditCache.set(view, { events: evs, n: evs.length, map: out });
  return out;
}

/**
 * 문장의 근거 중 since 이후에 기록된 것이 있는가: 이력(메모 등)은 그 이벤트의 기록 시각, 노드·연결은 마지막 수정(created/updated) 기록 시각.
 * since가 없거나 시각으로 읽을 수 없으면(처음 만드는 초안) 항상 false.
 * @param {{events:object[]}} view
 * @param {{evidence_ids:string[]}} sentence
 * @param {string|null} since 지난번 초안을 만든 시각(ISO)
 */
export function isNewSentence(view, sentence, since) {
  const cut = instant(since);
  if (cut === null || !sentence || !Array.isArray(sentence.evidence_ids)) return false;
  const ids = new Set(sentence.evidence_ids);
  const edits = lastEditByTarget(view);
  if (sentence.evidence_ids.some((g) => edits.get(g) > cut)) return true;
  return view.events.some((ev) => {
    if (!ids.has(ev.gid)) return false;
    const at = instant(ev.recorded_at);
    return at !== null && at > cut;
  });
}

/**
 * 초안 전체의 표시 판정: 항목 키 → 문장별 불리언 배열(문장 순서 그대로).
 * @returns {Record<string, boolean[]>}
 */
export function newSentenceFlags(view, draft, since) {
  const out = {};
  for (const item of draft.items) out[item.key] = item.sentences.map((s) => isNewSentence(view, s, since));
  return out;
}
