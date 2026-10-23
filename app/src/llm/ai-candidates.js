// AI 연관 후보(CR-15 C, T-38, D-33, R-11·R-28). 순수 함수 — DOM·저장소·네트워크를 쓰지 않는다.
//   collectWorks         묶은 지도(view)의 하위 유니버스 업무 → 보낼 글 목록 [{universe, node, universe_name, gid, label, text}]
//   checkCandidatesInput 보낼 수 있는 크기인가(업무 수·전체 글자 수 상한)
//   buildCandidatesPrompt 요청 {system, user, schema}
//   verifyAiCandidates   모델 응답 → 끝 업무가 입력에 있고 quote가 그 업무 글에 있는 쌍만 남김
//   decidedSets          사람이 이미 판정한 쌍(거부·확정) — 다시 내지 않으려고
//   withAiCandidates     통합 확인 목록(mergePlan 결과)에 「AI 후보」를 끼워 넣음(기존 후보는 그대로, 확정은 여전히 사람)
// "지어내지 않기": 앱이 믿는 것은 모델의 말이 아니라 두 업무의 글과 글자가 맞는 인용뿐이다(ai-convert.js와 같은 방식).
// 응답 스키마의 칸은 모두 필수(선택 칸 없음), additionalProperties:false — C15-4와 같은 이유.

import { pairKey } from '../model/schema.js';
import { textFingerprint } from './ai-convert.js';
import { QUOTE_MAX, QUOTE_MIN, describeEvidence, normalizeQuote, quoteShapeProblem } from './evidence-text.js';
import { CANDIDATES_SYSTEM_PROMPT, candidatesUserText } from './prompts.js';

/** 보낼 업무 수와 글자 수 상한(한 곳). 넘으면 호출하지 않고 안내한다 */
export const AI_CANDIDATES_MAX_WORKS = 300;
export const AI_CANDIDATES_MAX_CHARS = 100000;
/** 업무 하나의 글 길이 상한(보낸 글 = 인용을 확인하는 글) */
export const AI_CANDIDATES_WORK_TEXT_MAX = 1500;
/** 인용의 최소 길이(공백을 뺀 글자 수). ai-convert와 같은 기준 */
export const AI_CANDIDATES_MIN_QUOTE = QUOTE_MIN;
/** 한 번에 받아들일 쌍 수(프롬프트는 30쌍까지 요청) */
export const AI_CANDIDATES_MAX_PAIRS = 50;
export const AI_CANDIDATE_LABEL = 'AI 후보';
const REASON_MAX = 300;

// ── 응답 스키마 ─────────────────────────────────────────────────────────────
const str = (description) => ({ type: 'string', description });
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const REF = obj({ universe: str('입력 머리의 universe 값 그대로'), node: str('입력 머리의 node 값 그대로') });

/** 모델이 내야 하는 JSON */
export const AI_CANDIDATES_SCHEMA = obj({
  pairs: {
    type: 'array',
    items: obj({
      a: REF,
      b: REF,
      reason: str('왜 같은 일로 보이는지 한 문장'),
      quote_a: str('a 업무의 글에서 글자 그대로 따온 구절(8글자 이상)'),
      quote_b: str('b 업무의 글에서 글자 그대로 따온 구절(8글자 이상)'),
      confidence: { type: 'string', enum: ['high', 'medium'] },
    }),
  },
});

// ── 재료 ────────────────────────────────────────────────────────────────────
const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const gidOf = (w) => `${w.universe}/${w.node}`;

/**
 * 묶은 지도의 하위 유니버스 업무를 보낼 글로 만든다. 글 = 근거 글(describeEvidence)에서 앞의 근거 ID를 뺀 것
 * 「[업무] 이름 — 설명 {속성}」 + 그 업무가 만드는 산출물·잇는 주제의 이름. 근거 ID를 빼는 것은 ID 글자가 인용으로 통과하지 못하게 하려는 것
 * @param {object} view 묶은 유니버스의 buildView 결과
 * @returns {{universe:string, node:string, universe_name:string, gid:string, label:string, text:string}[]}
 */
export function collectWorks(view) {
  const rootId = view.universe_id;
  const out = [];
  for (const n of view.raw_nodes || []) {
    if (n.core_type !== 'work' || n.hidden || n.deleted || n.universe_id === rootId) continue;
    const head = describeEvidence(view, n.gid);
    let text = head.startsWith(`${n.gid} `) ? head.slice(n.gid.length + 1) : head;
    const c = view.canonical(n.gid);
    const artifacts = new Set();
    const topics = new Set();
    for (const e of view.edges || []) {
      if (e.hidden || e.source !== c) continue;
      const t = view.getNode(e.target);
      if (!t || t.hidden) continue;
      if (e.core_type === 'produces' && t.core_type === 'artifact') artifacts.add(t.label);
      if (e.core_type === 'relates_to' && t.core_type === 'topic') topics.add(t.label);
    }
    if (artifacts.size) text += ` | 산출물: ${[...artifacts].join(', ')}`;
    if (topics.size) text += ` | 주제: ${[...topics].join(', ')}`;
    out.push({ universe: n.universe_id, node: n.id, universe_name: n.universe_name || '', gid: n.gid, label: n.label, text: clip(oneLine(text), AI_CANDIDATES_WORK_TEXT_MAX) });
  }
  return out;
}

/** 보낼 수 있는가 → {ok:true} | {ok:false, reason:'few'|'too_many'|'too_long', max?} */
export function checkCandidatesInput(works) {
  if (!Array.isArray(works) || works.length < 2 || new Set(works.map((w) => w.universe)).size < 2) return { ok: false, reason: 'few' };
  if (works.length > AI_CANDIDATES_MAX_WORKS) return { ok: false, reason: 'too_many', max: AI_CANDIDATES_MAX_WORKS };
  if (works.reduce((s, w) => s + w.text.length, 0) > AI_CANDIDATES_MAX_CHARS) return { ok: false, reason: 'too_long', max: AI_CANDIDATES_MAX_CHARS };
  return { ok: true };
}

/** 입력이 안 되는 이유를 사람이 읽는 글로 */
export function candidatesInputMessage(check) {
  if (check.reason === 'few') return '비교할 업무가 부족합니다(서로 다른 유니버스의 업무가 2개 이상 필요)';
  if (check.reason === 'too_many') return `업무가 너무 많습니다(${check.max.toLocaleString()}개 이하)`;
  return `업무 글이 너무 깁니다(${check.max.toLocaleString()}자 이하)`;
}

/**
 * @param {{universe:string, node:string, universe_name?:string, text:string}[]} works collectWorks 결과
 * @returns {{system:string, user:string, schema:object}}
 * @throws {Error} 보낼 수 없는 크기면(err.code = 'few'|'too_many'|'too_long') — 호출하지 않는다
 */
export function buildCandidatesPrompt(works) {
  const c = checkCandidatesInput(works);
  if (!c.ok) {
    const err = new Error(candidatesInputMessage(c));
    err.code = c.reason;
    throw err;
  }
  return { system: CANDIDATES_SYSTEM_PROMPT, user: candidatesUserText(works), schema: AI_CANDIDATES_SCHEMA };
}

/** 보낸 업무 목록의 지문(캐시 키용). 같은 글이면 같은 키 */
export const worksFingerprint = (works) => textFingerprint(works.map((w) => `${gidOf(w)}\u0001${w.text}`).join('\u0002'));

// ── 사람이 이미 판정한 쌍 ───────────────────────────────────────────────────

/**
 * mergePlan과 같은 기준(대표 노드로 바꾼 쌍)으로 판정한 쌍을 모은다
 * @param {object} view
 * @param {object[]} links 지금 문서의 identity_links
 * @returns {{rejected:Set<string>, confirmed:Set<string>, canon:(gid:string)=>string}}
 */
export function decidedSets(view, links = []) {
  const canon = (g) => view.canonical(g);
  const rejected = new Set();
  const confirmed = new Set();
  for (const l of [...(links || []), ...(view.decided_links || [])]) {
    if (l.status === 'rejected') rejected.add(pairKey(canon(l.a), canon(l.b)));
    else if (l.status === 'confirmed') confirmed.add(pairKey(canon(l.a), canon(l.b)));
  }
  return { rejected, confirmed, canon };
}

// ── 검증 ────────────────────────────────────────────────────────────────────

/**
 * 모델 응답에서 확인된 쌍만 남긴다. 버림 단위는 쌍 하나.
 *  - 끝 업무(universe·node)가 입력에 있어야 한다(지어낸 노드는 버림), 서로 다른 업무·서로 다른 유니버스여야 한다
 *  - quote_a·quote_b: 각각 공백을 뺀 8글자 이상이고 그 업무 글(보낸 글)의 부분 문자열이어야 한다(공백·대소문자 무시)
 *  - 같은 쌍(순서 무관)은 먼저 나온 것 하나로 합친다
 *  - 사람이 이미 거부한 쌍·이미 확정한(같은 대표 노드가 된) 쌍은 넣지 않는다
 * @param {{universe:string, node:string, universe_name?:string, label?:string, text:string}[]} works 보낸 업무 목록
 * @param {object} parsed 모델 응답(AI_CANDIDATES_SCHEMA 모양)
 * @param {{rejected?:Set<string>, confirmed?:Set<string>, canon?:(gid:string)=>string}} [decided] decidedSets 결과
 * @returns {{ok:false, reason:'format'} | {ok:true, pairs:object[], dropped:{reason:string, kind:'invalid'|'decided', title:string}[], counts:{pairs:number, dropped:number, decided:number, merged:number}}}
 *   pairs[]: {a, b, reason, quotes:[인용a, 인용b], confidence, title} — a·b는 전역 참조("유니버스ID/업무ID")
 */
export function verifyAiCandidates(works, parsed, decided = {}) {
  if (!isObj(parsed) || !Array.isArray(parsed.pairs)) return { ok: false, reason: 'format' };
  const rejected = decided.rejected || new Set();
  const confirmed = decided.confirmed || new Set();
  const canon = decided.canon || ((g) => g);
  const byGid = new Map((Array.isArray(works) ? works : []).map((w) => [gidOf(w), w]));
  const hay = new Map([...byGid].map(([g, w]) => [g, normalizeQuote(w.text)]));
  const pairs = [];
  const dropped = [];
  const seen = new Set();
  let merged = 0;
  const drop = (kind, reason, title = '') => dropped.push({ kind, reason, title });
  const titleOf = (wa, wb) => `「${wa.label || wa.node}」(${wa.universe_name || wa.universe}) ↔ 「${wb.label || wb.node}」(${wb.universe_name || wb.universe})`;
  const refOf = (r) => (isObj(r) && typeof r.universe === 'string' && typeof r.node === 'string' && r.universe && r.node ? `${r.universe}/${r.node}` : null);
  /** 인용이 맞으면 null, 아니면 버리는 이유 */
  const quoteProblem = (quote, g, side) => {
    if (typeof quote !== 'string') return `${side} 업무의 원문 인용이 없음`;
    const q = normalizeQuote(quote);
    const shape = quoteShapeProblem(q);
    if (shape === 'short') return `${side} 업무의 원문 인용이 ${AI_CANDIDATES_MIN_QUOTE}글자 미만`;
    if (shape === 'long') return `${side} 업무의 원문 인용이 ${QUOTE_MAX}글자 초과`;
    if (shape) return `${side} 업무의 원문 인용에 글자·숫자가 ${AI_CANDIDATES_MIN_QUOTE}개 미만`;
    return hay.get(g).includes(q) ? null : `${side} 업무 글에서 인용을 찾지 못함`;
  };

  for (const raw of parsed.pairs) {
    if (!isObj(raw)) { drop('invalid', '항목 형식이 맞지 않음'); continue; }
    const ga = refOf(raw.a);
    const gb = refOf(raw.b);
    if (!ga || !gb) { drop('invalid', '업무 표시의 형식이 맞지 않음'); continue; }
    const wa = byGid.get(ga);
    const wb = byGid.get(gb);
    if (!wa || !wb) { drop('invalid', '보낸 목록에 없는 업무(지어낸 업무)'); continue; }
    const title = titleOf(wa, wb);
    if (ga === gb) { drop('invalid', '같은 업무를 두 번 가리킴', title); continue; }
    if (wa.universe === wb.universe) { drop('invalid', '같은 유니버스 안의 쌍', title); continue; }
    const why = quoteProblem(raw.quote_a, ga, '앞') || quoteProblem(raw.quote_b, gb, '뒤');
    if (why) { drop('invalid', why, title); continue; }
    const reason = typeof raw.reason === 'string' ? clip(oneLine(raw.reason), REASON_MAX) : '';
    if (!reason) { drop('invalid', '이유가 비어 있음', title); continue; }
    const key = pairKey(ga, gb);
    if (seen.has(key)) { merged += 1; continue; }
    seen.add(key);
    const ca = canon(ga);
    const cb = canon(gb);
    const dkey = pairKey(ca, cb);
    if (ca === cb || confirmed.has(dkey)) { drop('decided', '이미 같다고 확정한 쌍', title); continue; }
    if (rejected.has(dkey)) { drop('decided', '사람이 이미 다르다고 판정한 쌍', title); continue; }
    if (pairs.length >= AI_CANDIDATES_MAX_PAIRS) { drop('invalid', `쌍이 너무 많음(${AI_CANDIDATES_MAX_PAIRS}쌍까지)`, title); continue; }
    pairs.push({ a: ga, b: gb, reason, quotes: [oneLine(raw.quote_a), oneLine(raw.quote_b)], confidence: raw.confidence === 'high' ? 'high' : 'medium', title });
  }
  const invalid = dropped.filter((d) => d.kind === 'invalid').length;
  return { ok: true, pairs, dropped, counts: { pairs: pairs.length, dropped: invalid, decided: dropped.length - invalid, merged } };
}

// ── 통합 확인 목록에 끼워 넣기 ──────────────────────────────────────────────

/**
 * mergePlan 결과에 「AI 후보」를 끼워 넣은 새 계획을 돌려준다(원본은 바꾸지 않는다).
 *  - 기존 후보와 같은 쌍(순서 무관, 대표 노드 기준)이면 그 후보에 `ai`만 덧붙인다(순서·점수·이유·근거 그대로)
 *  - 새 쌍이면 `source:'ai'` 후보로 목록 끝에 더한다(score 0, 이유는 「AI 후보: …」, a·b는 대표 노드)
 *  - 판정 흐름은 그대로다: 후보의 a·b·reason을 decideIdentity에 넘겨 사람이 「같은 업무」/「다른 업무」를 고른다
 * ai: {reason, confidence, quotes:[{gid, quote}, {gid, quote}]}
 * @param {object} plan mergePlan 결과
 * @param {object[]} pairs verifyAiCandidates().pairs
 * @param {{canon?:(gid:string)=>string, skip?:(a:string, b:string)=>boolean}} [opts] canon: 대표 노드로 바꾸는 함수. skip: 지금 이미 판정한 쌍이면 true
 * @returns {object} plan과 같은 모양(counts에 ai·ai_merged 추가). 더할 것이 없으면 plan 그대로
 */
export function withAiCandidates(plan, pairs, { canon = (g) => g, skip = null } = {}) {
  if (!plan || !Array.isArray(pairs) || !pairs.length) return plan;
  const works = plan.works.slice();
  const index = new Map(works.map((w, i) => [pairKey(w.a, w.b), i]));
  const seen = new Set();
  let added = 0;
  let overlapped = 0;
  for (const p of pairs) {
    const a = canon(p.a);
    const b = canon(p.b);
    if (a === b) continue;
    const key = pairKey(a, b);
    if (seen.has(key)) continue;
    seen.add(key);
    const ai = { reason: p.reason, confidence: p.confidence, quotes: [{ gid: a, quote: p.quotes[0] }, { gid: b, quote: p.quotes[1] }] };
    if (index.has(key)) {
      const i = index.get(key);
      works[i] = { ...works[i], ai };
      overlapped += 1;
      continue;
    }
    if (skip && skip(a, b)) continue;
    works.push({ type: 'work_candidate', kind: 'work', a, b, score: 0, source: 'ai', title: p.title, reason: `${AI_CANDIDATE_LABEL}: ${p.reason}`, evidence_ids: [a, b], ai });
    added += 1;
  }
  return { ...plan, works, counts: { ...plan.counts, ai: added, ai_merged: overlapped } };
}
