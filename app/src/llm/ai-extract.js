// 글로 추가의 Claude 읽기(CR-19, D-37, D-33). 순수 함수 — DOM·저장소·네트워크를 쓰지 않는다.
//   checkExtractInput   보낼 수 있는 글인가(비었는지·길이)
//   existingItems       보낼 「지금 지도의 항목」 이름·유형 목록(최대 AI_EXTRACT_MAX_EXISTING개)
//   buildExtractPrompt  요청 {system, user, schema}
//   verifyAiExtract     모델 응답 → 원문 인용(quote)이 글에 실제로 있는 행만 남기고, 규칙 읽기와 같은 제안 모양으로(rules/text-extract.js의 finalizeProposal)
// "지어내지 않기": 앱이 믿는 것은 모델의 말이 아니라 글과 글자가 맞는 인용뿐이다(ai-convert.js와 같은 방식).
//   - 항목: 유형·이름 길이가 맞고, 이름이 글에 「낱말」로 있고(서하늘 안의 「하늘」, 보고서 안의 「보고」는 없는 것, R16-10), 인용이 글에 있어야 한다.
//     사번은 글에서 그 이름 바로 뒤 괄호에 있을 때만 쓴다(R16-6: 다른 사람 사번을 옮겨 붙이지 못하게)
//   - 연결: 양 끝이 남은 항목이고 관계가 스키마·PAIR_RULES에 맞고(반대 방향만 맞으면 뒤집음), 인용이 글에 있고 그 인용 안에 두 끝 이름이 모두 있어야 한다(R16-10)
//   - 통과하지 못한 행은 버리고 개수를 notes에 남긴다
// 응답 스키마의 칸은 모두 필수(선택 칸 없음)이고, 비우려면 빈 글자("")를 쓴다(ai-convert.js와 같은 이유).

import { LABEL_MAX, normalizeEmpNo, normalizeLabel } from '../model/schema.js';
import {
  TEXT_LIMITS, TEXT_NODE_TYPES, TEXT_UNREAD_CONTEXT_NOTE, capNotes, createBuilder, empNoAfterName, finalizeProposal, nameInText, orientRelation, ownCandidates, splitSentences,
} from '../rules/text-extract.js';
import { QUOTE_MAX, normalizeQuote } from './evidence-text.js';
import { textFingerprint } from './ai-convert.js';
import { EXTRACT_SYSTEM_PROMPT, extractUserText } from './prompts.js';

/** 보내는 「지도의 항목」 최대 개수(넘으면 앞에서부터. 이름 목록만 가므로 글자 수는 작다) */
export const AI_EXTRACT_MAX_EXISTING = 200;
/** 인용의 최소 길이(공백을 뺀 글자 수). 한 문장 인용이 목적이라 문서 변환(8글자)보다 짧게 둔다 */
export const AI_EXTRACT_MIN_QUOTE = 4;
/** 모델이 낼 수 있는 연결 관계(포함은 앱이 지도 중심에 잇는 기본 동작이라 뺀다) */
export const AI_EXTRACT_RELATIONS = ['performs', 'produces', 'precedes', 'belongs_to', 'relates_to', 'references'];
export const AI_EXTRACT_LABEL = 'Claude 읽기';

// ── 응답 스키마 ─────────────────────────────────────────────────────────────
const str = (description) => ({ type: 'string', description });
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const list = (items) => ({ type: 'array', items });

/** 모델이 내야 하는 JSON */
export const AI_EXTRACT_SCHEMA = obj({
  nodes: list(obj({
    type: { type: 'string', enum: [...TEXT_NODE_TYPES] },
    label: str('글에 나온 이름 그대로(조사는 떼기, 2~100글자)'),
    emp_no: str('글에 적힌 사번. 없으면 빈 글자'),
    quote: str('글에서 글자 그대로 따온 구절(4글자 이상). 글에 없는 구절은 쓰지 마세요'),
  })),
  edges: list(obj({
    from_label: str('위 nodes의 label 그대로'),
    to_label: str('위 nodes의 label 그대로'),
    type: { type: 'string', enum: AI_EXTRACT_RELATIONS },
    quote: str('글에서 글자 그대로 따온 구절(4글자 이상)'),
  })),
});

// ── 요청 ────────────────────────────────────────────────────────────────────

/** 보낼 수 있는 글인가 → {ok:true} | {ok:false, reason:'empty'|'too_long', max?} */
export function checkExtractInput(text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, reason: 'empty' };
  if (text.length > TEXT_LIMITS.maxChars) return { ok: false, reason: 'too_long', max: TEXT_LIMITS.maxChars };
  return { ok: true };
}

/** 입력이 안 되는 이유를 사람이 읽는 글로 */
export const extractInputMessage = (check) => (check.reason === 'empty' ? '읽을 글이 비어 있습니다' : `글이 너무 깁니다(${check.max.toLocaleString()}자 이하)`);

/** 보낼 지도의 항목 [{type, label}] — 이 업무 지도에 있는 항목(숨김·꼭지 제외)의 유형 키와 이름뿐이다 */
export function existingItems(view, max = AI_EXTRACT_MAX_EXISTING) {
  return ownCandidates(view).slice(0, max).map((c) => ({ type: c.core_type, label: c.label.length > LABEL_MAX ? c.label.slice(0, LABEL_MAX) : c.label }));
}

/**
 * @param {string} text 붙여 넣은 글
 * @param {{type:string, label:string}[]} [existing] existingItems 결과
 * @returns {{system:string, user:string, schema:object}}
 * @throws {Error} 비었거나 너무 길면(err.code = 'empty'|'too_long') — 호출하지 않는다
 */
export function buildExtractPrompt(text, existing = []) {
  const c = checkExtractInput(text);
  if (!c.ok) {
    const err = new Error(extractInputMessage(c));
    err.code = c.reason;
    throw err;
  }
  return { system: EXTRACT_SYSTEM_PROMPT, user: extractUserText(text, existing), schema: AI_EXTRACT_SCHEMA };
}

/** 보낼 글 + 항목 목록의 지문(캐시 키용) */
export const extractFingerprint = (text, existing) => textFingerprint(`${text}\u0002${existing.map((x) => `${x.type}\u0001${x.label}`).join('\u0003')}`);

// ── 검증 ────────────────────────────────────────────────────────────────────
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * 모델 응답에서 원문 인용이 확인된 행만 남겨 규칙 읽기와 같은 제안 모양으로 만든다.
 * 버림 단위는 행 하나. 같은 이름의 항목·같은 연결은 먼저 나온 것 하나로 합친다.
 * @param {string} text 붙여 넣은 글
 * @param {object} parsed 모델 응답(AI_EXTRACT_SCHEMA 모양)
 * @param {object|null} view 지금 지도(match·exists를 채운다)
 * @param {{model?:string}} [opt]
 * @returns {{ok:false, reason:'format'} | {ok:false, reason:'empty', dropped:object[], counts:object}
 *   | {ok:true, proposal:object, dropped:{kind:'node'|'edge', label:string, reason:string}[], counts:{nodes:number, edges:number, dropped:number, merged:number}}}
 */
export function verifyAiExtract(text, parsed, view = null, opt = {}) {
  if (!isObj(parsed) || !Array.isArray(parsed.nodes)) return { ok: false, reason: 'format' };
  const rawEdges = Array.isArray(parsed.edges) ? parsed.edges : [];
  const hay = normalizeQuote(text);
  const dropped = [];
  let merged = 0;
  const drop = (kind, label, reason) => dropped.push({ kind, label: clip(oneLine(label || '(이름 없음)'), 60), reason });

  /** 인용이 맞으면 null, 아니면 버리는 이유 */
  const quoteProblem = (quote) => {
    if (typeof quote !== 'string') return '원문 인용이 없음';
    const q = normalizeQuote(quote);
    if (q.length < AI_EXTRACT_MIN_QUOTE) return `원문 인용이 ${AI_EXTRACT_MIN_QUOTE}글자 미만`;
    if (q.length > QUOTE_MAX) return `원문 인용이 ${QUOTE_MAX}글자 초과(글을 통째로 베낀 인용)`;
    if ((q.match(/[\p{L}\p{N}]/gu) || []).length < AI_EXTRACT_MIN_QUOTE) return `원문 인용에 글자·숫자가 ${AI_EXTRACT_MIN_QUOTE}개 미만`;
    return hay.includes(q) ? null : '원문에서 인용을 찾지 못함';
  };

  const b = createBuilder();
  const quotes = [];
  for (const raw of parsed.nodes) {
    if (!isObj(raw)) { drop('node', '', '항목 형식이 맞지 않음'); continue; }
    const label = typeof raw.label === 'string' ? oneLine(raw.label) : '';
    if (!TEXT_NODE_TYPES.includes(raw.type)) { drop('node', label, '항목 유형이 맞지 않음'); continue; }
    if (label.length < TEXT_LIMITS.nameMin || label.length > LABEL_MAX) { drop('node', label, `이름 길이가 맞지 않음(${TEXT_LIMITS.nameMin}~${LABEL_MAX}글자)`); continue; }
    if (!nameInText(text, label)) { drop('node', label, '이름이 글에 없음'); continue; }
    const why = quoteProblem(raw.quote);
    if (why) { drop('node', label, why); continue; }
    // 사번은 글에서 그 이름 바로 뒤 괄호에 있을 때만 쓴다(없는 사번을 지어내거나 다른 사람 사번을 옮겨 붙이지 않게). 사람 항목에만 붙는다
    const emp = typeof raw.emp_no === 'string' ? raw.emp_no.trim() : '';
    const emp_no = raw.type === 'person' && emp && empNoAfterName(text, label, normalizeEmpNo(emp)) ? emp : '';
    const before = b.nodes.length;
    const n = b.addNode({ type: raw.type, label, emp_no }, oneLine(raw.quote));
    if (n && b.nodes.length === before) merged += 1;
    if (n) quotes.push(raw.quote);
  }

  const byLabel = (l) => b.nodes.find((n) => normalizeLabel(n.label) === normalizeLabel(typeof l === 'string' ? l : ''));
  for (const raw of rawEdges) {
    if (!isObj(raw)) { drop('edge', '', '연결 형식이 맞지 않음'); continue; }
    const name = `${oneLine(raw.from_label ?? '')} → ${oneLine(raw.to_label ?? '')}`;
    if (!AI_EXTRACT_RELATIONS.includes(raw.type)) { drop('edge', name, '연결 종류가 맞지 않음'); continue; }
    const a = byLabel(raw.from_label);
    const c = byLabel(raw.to_label);
    if (!a || !c) { drop('edge', name, '연결 끝의 항목이 없어서(근거가 확인되지 않아) 뺌'); continue; }
    if (a === c) { drop('edge', name, '자기 자신으로 가는 연결'); continue; }
    const dir = orientRelation(raw.type, a.type, c.type);
    if (!dir) { drop('edge', name, '두 항목의 유형에 맞지 않는 연결'); continue; }
    const why = quoteProblem(raw.quote);
    if (why) { drop('edge', name, why); continue; }
    // 연결의 근거 구절 안에 두 끝 이름이 모두 낱말로 있어야 한다(다른 문장의 인용을 붙여 만든 연결을 걸러낸다)
    if (!nameInText(raw.quote, a.label) || !nameInText(raw.quote, c.label)) { drop('edge', name, '근거 구절에 두 항목의 이름이 모두 있어야 함'); continue; }
    const before = b.edges.length;
    const e = dir === 'forward' ? b.addEdge(a, c, raw.type, oneLine(raw.quote)) : b.addEdge(c, a, raw.type, oneLine(raw.quote));
    if (e) quotes.push(raw.quote);
    else if (b.edges.length === before && !b.flags.edgesCapped) merged += 1;
  }

  const counts = { nodes: b.nodes.length, edges: b.edges.length, dropped: dropped.length, merged };
  if (!b.nodes.length) return { ok: false, reason: 'empty', dropped, counts };

  // 읽지 못한 문장: 남은 인용과 겹치지 않는 문장(인용이 문장 안에 있거나 문장이 인용 안에 있으면 읽은 것으로 본다)
  const qn = quotes.map(normalizeQuote);
  const unread = splitSentences(text).filter((s) => {
    const sn = normalizeQuote(s);
    return !qn.some((q) => q.includes(sn) || sn.includes(q));
  });
  const notes = [];
  if (dropped.length) notes.push(`Claude 응답 중 ${dropped.length}개 행은 원문 인용이 확인되지 않거나 규칙에 맞지 않아 뺐습니다`);
  notes.push(...capNotes(b.flags));
  // R19 ①: 읽지 못한 문장이 있는 글에서는 앞뒤 문장이 읽은 문장의 뜻을 바꿀 수 있다 — 안내하고 'existing-only'에서도 연결을 처음 체크하지 않는다
  const unreadContext = unread.length > 0 && b.edges.length > 0;
  if (unreadContext) notes.push(TEXT_UNREAD_CONTEXT_NOTE);
  const proposal = finalizeProposal({ method: 'claude_api', ...(opt.model ? { model: opt.model } : {}), nodes: b.nodes, edges: b.edges, unread, partial: [], notes, unreadContext }, view);
  return { ok: true, proposal, dropped, counts };
}
