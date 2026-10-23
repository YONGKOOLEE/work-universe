// 문서 AI 변환(CR-15 A, T-37, D-33, 12.9). 순수 함수 — DOM·저장소·네트워크를 쓰지 않는다.
//   buildConvertPrompt   문서 원문 → 요청 {system, user, schema}
//   verifyAiConvert      모델 응답 → 원문 인용(quote)이 원문에 실제로 있는 항목만 남김(없으면 그 항목을 버림)
//   aiResultToDocument   남은 항목 → 12.2 유니버스 문서 + 변환 보고(규칙 변환 convertDocument와 같은 모양)
// "지어내지 않기": 앱이 믿는 것은 모델의 말이 아니라 원문과 글자가 맞는 인용뿐이다.
//   - 항목(업무·사람·산출물·주제·메모)마다 quote 필수: 공백·대소문자를 무시하고 8글자 이상이 원문의 부분 문자열이어야 한다
//   - 연결은 양 끝 항목이 살아 있고 12.2 허용 조합이어야 하며, quote가 있으면 그것도 원문에 있어야 한다
//   - 노드 ID·연결 ID는 모델에 맡기지 않고 앱이 매긴다. 작성 주체·날짜도 원문에 있을 때만 쓴다
// 응답 스키마의 칸은 모두 필수(선택 칸 없음)이고 비우려면 빈 글자(""), false를 쓴다 — 구조화 출력의 선택 칸 수 제한을 피하고 모양을 고정한다.

import { newId } from '../model/commands.js';
import { isDate } from '../model/checks.js';
import { ID_PREFIX, LABEL_MAX, SCHEMA_VERSION, SUBTYPE_ROLE, TEXT_MAX, normalizeLabel, pairAllowed } from '../model/schema.js';
import { validateDocument } from '../model/validate.js';
import { CONVERT_RULES, findDate, marksOf, statusOf, stripMarks } from '../rules/doc-convert.js';
import { QUOTE_MAX, QUOTE_MIN, normalizeQuote, quoteShapeProblem } from './evidence-text.js';
import { CONVERT_SYSTEM_PROMPT, convertUserText } from './prompts.js';

/** 인용의 최소 길이(공백을 뺀 글자 수). 짧은 구절은 어디에나 있어 근거가 되지 못한다 */
export const AI_CONVERT_MIN_QUOTE = QUOTE_MIN;
/** 노드의 원문 속성(attrs.원문)에 남기는 인용 길이 */
export const AI_SOURCE_MAX = 40;
export const AI_CONVERT_LABEL = 'AI 변환';
export const WORK_ATTR_KEYS = ['절차', '주기', '마감', '주의사항', '사용 시스템'];
export const AI_RELATIONS = ['performs', 'produces', 'precedes', 'relates_to', 'references'];
export const AI_EDGE_TYPES = ['work', 'person', 'artifact', 'topic'];
export const AI_MEMO_KINDS = ['issue', 'caution'];

// ── 응답 스키마 ─────────────────────────────────────────────────────────────
const str = (description) => ({ type: 'string', description });
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const list = (items) => ({ type: 'array', items });
const Q = str('문서에서 글자 그대로 따온 구절(8글자 이상). 문서에 없는 구절은 쓰지 마세요');
const ENDPOINT = obj({ type: { type: 'string', enum: AI_EDGE_TYPES }, label: str('위에서 만든 항목의 label 그대로') });

/** 모델이 내야 하는 JSON. 12.2를 단순화한 입력 형식이다(ID·시각은 앱이 매긴다) */
export const AI_CONVERT_SCHEMA = obj({
  name: str('유니버스(문서) 이름. 100글자 이하'),
  purpose: str('목적 한두 문장. 문서에 있는 내용만, 없으면 빈 글자'),
  owner: str('작성 주체(팀·부서). 문서에 적힌 것만, 없으면 빈 글자'),
  date: str('작성일 YYYY-MM-DD. 문서에 적힌 것만, 없으면 빈 글자'),
  works: list(obj({
    label: str('업무 이름'),
    description: str('설명. 없으면 빈 글자'),
    attrs: obj(Object.fromEntries(WORK_ATTR_KEYS.map((k) => [k, str(`${k}. 문서에 있을 때만, 없으면 빈 글자`)]))),
    quote: Q,
  })),
  people: list(obj({
    label: str('사람 또는 역할 이름'),
    role: { type: 'boolean', description: '이름 없이 역할 이름뿐이면 true' },
    org: str('소속(기관·팀). 없으면 빈 글자'),
    duty: str('하는 일. 없으면 빈 글자'),
    quote: Q,
  })),
  artifacts: list(obj({ label: str('산출물 이름'), description: str('설명. 없으면 빈 글자'), quote: Q })),
  topics: list(obj({ label: str('주제 이름(요건·예외·보안 등)'), description: str('내용. 없으면 빈 글자'), subtype: str('하위 유형(예: 예외, 보안, 요건). 없으면 빈 글자'), quote: Q })),
  memos: list(obj({
    text: str('미확정 질문·리스크·유의사항 한 건'),
    kind: { type: 'string', enum: AI_MEMO_KINDS },
    work: str('관련 업무의 label. 분명하지 않으면 빈 글자'),
    quote: Q,
  })),
  edges: list(obj({
    from: ENDPOINT,
    to: ENDPOINT,
    relation: { type: 'string', enum: AI_RELATIONS },
    quote: str('근거 구절. 없으면 빈 글자'),
  })),
});

// ── 요청 ────────────────────────────────────────────────────────────────────

/** 보낼 수 있는 글인가 → {ok:true} | {ok:false, reason:'empty'|'too_long', max?} */
export function checkConvertInput(text) {
  if (typeof text !== 'string' || !text.trim()) return { ok: false, reason: 'empty' };
  if (text.length > CONVERT_RULES.maxInput) return { ok: false, reason: 'too_long', max: CONVERT_RULES.maxInput };
  return { ok: true };
}

/**
 * @param {string} text 문서 원문(20만 자 이하)
 * @returns {{system:string, user:string, schema:object}}
 * @throws {Error} 비었거나 20만 자를 넘으면(err.code = 'empty'|'too_long') — 호출하지 않는다
 */
export function buildConvertPrompt(text) {
  const c = checkConvertInput(text);
  if (!c.ok) {
    const err = new Error(c.reason === 'empty' ? '변환할 문서가 비어 있습니다' : `문서가 너무 깁니다(${c.max.toLocaleString()}자 이하)`);
    err.code = c.reason;
    throw err;
  }
  return { system: CONVERT_SYSTEM_PROMPT, user: convertUserText(text), schema: AI_CONVERT_SCHEMA };
}

/** 원문 지문(FNV-1a 32비트 + 길이). 캐시 키용 — 같은 글이면 같은 키 */
export function textFingerprint(text) {
  const s = String(text);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16).padStart(8, '0')}-${s.length}`;
}

// ── 검증 ────────────────────────────────────────────────────────────────────
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const KIND_LABEL = { work: '업무', person: '사람', artifact: '산출물', topic: '주제', memo: '메모', edge: '연결' };

/**
 * 모델 응답에서 원문 인용이 확인된 항목만 남긴다.
 * 버림 단위는 항목 하나: 인용이 8글자 미만이거나 원문(공백·대소문자 무시)에 없으면 그 항목만 버리고 나머지는 둔다.
 * 연결은 양 끝이 남아 있고 12.2 허용 조합일 때만 남는다. 같은 유형·이름(normalizeLabel)은 먼저 나온 것 하나로 합친다.
 * @param {string} text 문서 원문
 * @param {object} parsed 모델 응답(AI_CONVERT_SCHEMA 모양)
 * @returns {{ok:false, reason:'format'|'empty'} | {ok:true, kept:object, dropped:{kind:string, label:string, reason:string}[], counts:object}}
 */
export function verifyAiConvert(text, parsed) {
  if (!isObj(parsed)) return { ok: false, reason: 'format' };
  const arr = (k) => (Array.isArray(parsed[k]) ? parsed[k] : []);
  const hay = normalizeQuote(text);
  const dropped = [];
  const truncated = [];
  let merged = 0;
  const drop = (kind, label, reason) => dropped.push({ kind, label: clip(oneLine(label || '(이름 없음)'), 60), reason });

  /** 인용이 맞으면 null, 아니면 버리는 이유 */
  const quoteProblem = (quote) => {
    if (typeof quote !== 'string') return '원문 인용이 없음';
    const q = normalizeQuote(quote);
    const shape = quoteShapeProblem(q);
    if (shape === 'short') return `원문 인용이 ${AI_CONVERT_MIN_QUOTE}글자 미만`;
    if (shape === 'long') return `원문 인용이 ${QUOTE_MAX}글자 초과(원문을 통째로 베낀 인용)`;
    if (shape) return `원문 인용에 글자·숫자가 ${AI_CONVERT_MIN_QUOTE}개 미만`;
    return hay.includes(q) ? null : '원문에서 인용을 찾지 못함';
  };
  const text1 = (v, max, where) => {
    if (typeof v !== 'string') return '';
    const s = v.trim();
    if (s.length <= max) return s;
    truncated.push({ where, max });
    return `${s.slice(0, max - 1)}…`;
  };
  /** 이름: 표시([가정]·[미확인])는 따로 두고, 100글자를 넘으면 자르되 전체는 설명으로 */
  const labelOf = (raw) => {
    if (typeof raw !== 'string') return null;
    const full = oneLine(stripMarks(raw) || raw);
    if (!full) return null;
    const marks = clip(marksOf(raw).join(' '), LABEL_MAX); // 표시도 이름 상한 안으로(R10-7: attrs.표시가 길어 문서 전체가 실패하지 않게)
    if (full.length <= LABEL_MAX) return { label: full, marks, full: '' };
    truncated.push({ where: '이름', max: LABEL_MAX });
    return { label: `${full.slice(0, LABEL_MAX - 1)}…`, marks, full };
  };

  const kept = { name: '', purpose: '', owner: '', date: '', works: [], people: [], artifacts: [], topics: [], memos: [], edges: [], truncated };
  const index = new Map(); // `유형|이름` → 남긴 항목(연결 끝을 찾는다)
  const take = (kind, coreType, raw, build) => {
    if (!isObj(raw)) return drop(kind, '', '항목 형식이 맞지 않음');
    const l = labelOf(raw.label);
    if (!l) return drop(kind, '', '이름이 비어 있음');
    const why = quoteProblem(raw.quote);
    if (why) return drop(kind, l.label, why);
    const key = `${coreType}|${normalizeLabel(l.label)}`;
    if (index.has(key)) { merged += 1; return undefined; }
    const description = text1(raw.description, TEXT_MAX, l.label) || (l.full ? text1(l.full, TEXT_MAX, l.label) : '');
    const item = { label: l.label, marks: l.marks, description, quote: oneLine(raw.quote), ...build(raw, l) };
    index.set(key, item);
    kept[coreType === 'person' ? 'people' : `${coreType}s`].push(item);
    return item;
  };

  for (const w of arr('works')) {
    take('work', 'work', w, (raw) => {
      const attrs = {};
      for (const k of WORK_ATTR_KEYS) {
        const v = isObj(raw.attrs) ? text1(raw.attrs[k], TEXT_MAX, k) : '';
        if (v) attrs[k] = v;
      }
      return { attrs };
    });
  }
  for (const p of arr('people')) {
    take('person', 'person', p, (raw) => ({ role: raw.role === true, org: text1(raw.org, LABEL_MAX, '소속'), duty: text1(raw.duty, TEXT_MAX, '하는 일') }));
  }
  for (const a of arr('artifacts')) take('artifact', 'artifact', a, () => ({}));
  for (const t of arr('topics')) take('topic', 'topic', t, (raw) => ({ subtype: text1(raw.subtype, LABEL_MAX, '하위 유형') }));

  for (const m of arr('memos')) {
    const body = isObj(m) ? text1(m.text, TEXT_MAX, '메모') : '';
    if (!body) { drop('memo', '', isObj(m) ? '내용이 비어 있음' : '항목 형식이 맞지 않음'); continue; }
    const why = quoteProblem(m.quote);
    if (why) { drop('memo', body, why); continue; }
    const wl = labelOf(m.work);
    const work = wl ? index.get(`work|${normalizeLabel(wl.label)}`) : null;
    kept.memos.push({ text: body, kind: AI_MEMO_KINDS.includes(m.kind) ? m.kind : 'issue', work: work ? work.label : '', quote: oneLine(m.quote) });
  }

  const seenEdges = new Set();
  for (const e of arr('edges')) {
    const ends = isObj(e) ? ['from', 'to'].map((k) => (isObj(e[k]) && AI_EDGE_TYPES.includes(e[k].type) ? { type: e[k].type, l: labelOf(e[k].label) } : null)) : [null, null];
    const name = ends.every((x) => x && x.l) ? `${ends[0].l.label} → ${ends[1].l.label}` : '';
    if (!ends.every((x) => x && x.l)) { drop('edge', '', '연결 끝의 형식이 맞지 않음'); continue; }
    if (!AI_RELATIONS.includes(e.relation)) { drop('edge', name, '연결 종류가 맞지 않음'); continue; }
    const [a, b] = ends.map((x) => index.get(`${x.type}|${normalizeLabel(x.l.label)}`));
    if (!a || !b) { drop('edge', name, '연결 끝의 항목이 없어서(원문 인용이 확인되지 않아) 뺌'); continue; }
    if (a === b) { drop('edge', name, '자기 자신으로 가는 연결'); continue; }
    if (!pairAllowed(e.relation, ends[0].type, ends[1].type)) { drop('edge', name, '허용되지 않는 연결 조합'); continue; }
    const hasQuote = typeof e.quote === 'string' && e.quote.trim() !== '';
    const why = hasQuote ? quoteProblem(e.quote) : null;
    if (why) { drop('edge', name, why); continue; }
    const key = `${ends[0].type}|${a.label}|${ends[1].type}|${b.label}|${e.relation}`;
    if (seenEdges.has(key)) { merged += 1; continue; }
    seenEdges.add(key);
    kept.edges.push({ from: { type: ends[0].type, label: a.label }, to: { type: ends[1].type, label: b.label }, relation: e.relation, quote: hasQuote ? oneLine(e.quote) : '' });
  }

  // 머리: 이름은 사람이 미리 보기에서 고친다. 작성 주체·날짜는 원문에 있을 때만 쓴다
  const nm = labelOf(parsed.name);
  kept.name = nm ? nm.label : '';
  kept.nameMarks = nm ? nm.marks : '';
  kept.purpose = text1(parsed.purpose, TEXT_MAX, '목적');
  const owner = typeof parsed.owner === 'string' ? oneLine(parsed.owner) : '';
  kept.owner = owner && owner.length <= LABEL_MAX && hay.includes(normalizeQuote(owner)) ? owner : '';
  kept.date = dateInText(text, parsed.date);

  const nodes = kept.works.length + kept.people.length + kept.artifacts.length + kept.topics.length;
  const counts = {
    works: kept.works.length, people: kept.people.length, artifacts: kept.artifacts.length, topics: kept.topics.length,
    memos: kept.memos.length, edges: kept.edges.length, dropped: dropped.length, merged, truncated: truncated.length,
  };
  if (!nodes) return { ok: false, reason: 'empty', dropped, counts };
  return { ok: true, kept, dropped, counts };
}

/** 모델이 말한 날짜는 실제 달력 날짜이고 원문 어딘가에 같은 날짜가 있을 때만 쓴다(YYYY-MM-DD) */
function dateInText(text, raw) {
  const d = findDate(typeof raw === 'string' ? raw : '');
  if (!d || !isDate(d)) return '';
  const [y, m, day] = d.split('-');
  return new RegExp(`(?<!\\d)${y}\\s*[.\\-/년]\\s*0?${Number(m)}\\s*[.\\-/월]\\s*0?${Number(day)}(?!\\d)`).test(text) ? d : '';
}

// ── 문서 만들기 ─────────────────────────────────────────────────────────────

const srcOf = (quote) => (quote.length > AI_SOURCE_MAX ? `${quote.slice(0, AI_SOURCE_MAX)}…` : quote);

/**
 * 검증을 통과한 항목 → 12.2 유니버스 문서. 규칙 변환(convertDocument)과 같은 결과 모양.
 *  - 노드 ID는 N-001…, 꼭지는 N-000. 연결 L-001…, 이력 E-001… (앱이 매김)
 *  - 노드 attrs.원문 = 인용 앞 40자, attrs.변환 = AI 변환(모델명, 날짜). 업무 절차는 attrs.절차에 그대로
 *  - 모델이 말한 연결 외에, 연결이 없는 항목과 모든 업무는 꼭지에 「포함」으로 묶는다(규칙 변환과 같게)
 * @param {object} kept verifyAiConvert().kept
 * @param {{now:string, model:string, dropped?:object[], random?:()=>number}} ctx
 * @returns {{ok:true, doc:object, report:object} | {ok:false, error:{code:string, errors:object[]}}}
 */
export function aiResultToDocument(kept, ctx) {
  const random = ctx.random || Math.random;
  const today = ctx.now.slice(0, 10);
  const docDate = kept.date || today;
  const tag = `${AI_CONVERT_LABEL}(${ctx.model}, ${today})`;
  const notes = [{ code: 'C-AI-MODEL', model: ctx.model }];
  if (ctx.dropped && ctx.dropped.length) notes.push({ code: 'C-AI-DROPPED', count: ctx.dropped.length, items: ctx.dropped });
  for (const t of kept.truncated || []) notes.push({ code: 'C-TRUNCATED', where: t.where, max: t.max });

  const nodes = [];
  const byKey = new Map();
  const subtypes = new Map();
  const add = (coreType, item, extra = {}) => {
    const status = statusOf(item.label, item.marks, item.description, item.quote);
    const n = {
      id: `N-${String(nodes.length + 1).padStart(3, '0')}`,
      core_type: coreType,
      label: item.label,
      ...(extra.subtype ? { subtype: extra.subtype } : {}),
      ...(item.description ? { description: item.description } : {}),
      attrs: { 원문: srcOf(item.quote), ...(extra.attrs || {}), ...(status ? { 상태: status } : {}), ...(item.marks ? { 표시: item.marks } : {}), 변환: tag },
      hidden: false,
      created_at: ctx.now,
      updated_at: ctx.now,
    };
    nodes.push(n);
    byKey.set(`${coreType}|${normalizeLabel(item.label)}`, n);
    return n;
  };
  const works = kept.works.map((w) => add('work', w, { attrs: w.attrs }));
  const people = kept.people.map((p) => {
    if (p.role) subtypes.set(`person|${SUBTYPE_ROLE}`, { core_type: 'person', name: SUBTYPE_ROLE });
    return add('person', { ...p, description: p.description || p.duty }, { subtype: p.role ? SUBTYPE_ROLE : undefined, attrs: p.org ? { 소속: p.org } : {} });
  });
  const artifacts = kept.artifacts.map((a) => add('artifact', a));
  const topics = kept.topics.map((t) => {
    if (t.subtype) subtypes.set(`topic|${t.subtype}`, { core_type: 'topic', name: t.subtype });
    return add('topic', t, { subtype: t.subtype || undefined });
  });

  const rootId = 'N-000';
  const name = kept.name || '이름 없는 문서';
  const root = {
    id: rootId, core_type: 'root', label: name,
    ...(kept.purpose ? { description: kept.purpose } : {}),
    attrs: {
      원문: '전체',
      ...(kept.nameMarks ? { 표시: kept.nameMarks, 상태: statusOf(kept.nameMarks) } : {}),
      변환: tag,
    },
    hidden: false, created_at: ctx.now, updated_at: ctx.now,
  };

  const edges = [];
  const pushEdge = (source, target, core_type, note) => {
    edges.push({ id: `L-${String(edges.length + 1).padStart(3, '0')}`, source, target, core_type, ...(note ? { note } : {}), hidden: false, created_at: ctx.now });
  };
  const linked = new Set();
  for (const e of kept.edges) {
    const a = byKey.get(`${e.from.type}|${normalizeLabel(e.from.label)}`);
    const b = byKey.get(`${e.to.type}|${normalizeLabel(e.to.label)}`);
    if (!a || !b) continue;
    pushEdge(a.id, b.id, e.relation, e.quote ? `${AI_CONVERT_LABEL}: 원문 「${srcOf(e.quote)}」` : `${AI_CONVERT_LABEL}: 원문에서 읽은 관계`);
    linked.add(a.id);
    linked.add(b.id);
  }
  for (const w of works) pushEdge(rootId, w.id, 'contains');
  for (const n of [...people, ...artifacts, ...topics]) if (!linked.has(n.id)) pushEdge(rootId, n.id, 'contains');

  const events = [];
  const pushEvent = (type, payload, note, occurred_at = docDate) => {
    events.push({ id: `E-${String(events.length + 1).padStart(3, '0')}`, type, occurred_at, recorded_at: ctx.now, source: 'system', payload, ...(note ? { note } : {}) });
  };
  pushEvent('created', { target_kind: 'node', target_id: rootId }, `문서에서 ${AI_CONVERT_LABEL}으로 만듦(${ctx.model})`, today);
  kept.memos.forEach((m) => {
    const w = m.work ? byKey.get(`work|${normalizeLabel(m.work)}`) : null;
    const kind = m.kind === 'caution' ? '주의' : '질문·이슈';
    const note = clip(`[${AI_CONVERT_LABEL} · 원문 「${srcOf(m.quote)}」 · ${kind}] ${m.text}`, TEXT_MAX);
    pushEvent('memo', { target_id: w ? w.id : rootId, category: m.kind }, note);
  });
  if (!kept.date && kept.memos.length) notes.push({ code: 'C-DATE-ASSUMED', date: today });

  if (!kept.owner) notes.push({ code: 'C-NO-OWNER' });
  const descParts = [];
  if (kept.purpose) descParts.push(kept.purpose);
  descParts.push(`문서에서 ${AI_CONVERT_LABEL}으로 만든 업무 지도(원문 인용이 확인된 항목만).`);
  const universe = {
    id: newId(ID_PREFIX.universe, random),
    name,
    level: '업무',
    owner: kept.owner || '',
    description: clip(descParts.join(' '), TEXT_MAX),
    root_node_id: rootId,
    subtypes: [...subtypes.values()],
    tags: ['문서 변환', AI_CONVERT_LABEL],
    is_sample: false,
    created_at: ctx.now,
  };

  const doc = { schema_version: SCHEMA_VERSION, universe, nodes: [root, ...nodes], edges, events, refs: [], identity_links: [] };
  // 작성 주체는 미리 보기에서 사람이 채우므로 비어 있어도 된다. 그 밖의 오류는 쓸 수 없는 결과다
  const errors = validateDocument(doc).errors.filter((e) => e.path !== 'universe.owner');
  if (errors.length) return { ok: false, error: { code: 'E-SCHEMA', errors } };

  const memoCount = kept.memos.length;
  const sections = [
    ['ai_work', '업무', works.length], ['ai_person', '사람', people.length], ['ai_artifact', '산출물', artifacts.length],
    ['ai_topic', '주제', topics.length], ['ai_memo', '메모', memoCount], ['ai_edge', '연결', kept.edges.length],
  ].filter(([, , n]) => n > 0).map(([kind, title, made]) => ({ ref: '문서 전체', title, kind, made }));
  return {
    ok: true,
    doc,
    // target이 없으면 미리 보기가 「월말 정산 수준」 세분화 줄을 보이지 않는다(업무가 여러 개인 문서는 노드가 많은 것이 정상)
    report: { rules_version: null, ai: true, node_count: doc.nodes.length, target: null, steps: 0, sections, notes },
  };
}
