// LLM 연결부(D-07, 5.4). 화면·기능 코드는 이 함수들만 쓴다(R-15). 공급자는 providers.js에서 이름으로 만든다.
// 규칙:
//   - 공급자 문장마다 근거 ID를 검증한다. 근거가 비었거나, 데이터에 없거나, 그 항목의 규칙 기반 근거 밖이면
//     그 항목은 규칙 기반 문장으로 대체한다("근거로 고른 것만" 쓴다, 5.4 · 검토 3-11).
//   - 근거가 없는 항목(이력 부족)에는 문장을 지어내지 않는다.
//   - 공급자가 실패하거나 형식이 깨지면 전체를 규칙 기반으로 두고 원인을 남긴다(R-04 ③).
//   - 사전 생성 결과가 없는 항목(새로 입력한 데이터 등)은 규칙 기반 문장이 그대로 남는다(CR-1).
// 실시간 경로(CR-15, D-33): 위 동기 함수는 그대로 두고, 같은 검증에 원문 인용(quote) 검증을 더한 비동기 함수
//   refineDraftAsync·explainInsightAsync를 따로 둔다. 화면은 동기 결과를 먼저 그리고 비동기 결과가 오면 교체한다(R-04 ③).
//   공급자가 live가 아니면(키 없음 등) 비동기 함수는 아무것도 부르지 않고 null을 돌려준다.
// 브라우저 기능을 쓰지 않는다.

import { KEYLESS_PREGEN_REASON, KEYLESS_REASON, REASON_PREFIX, fingerprint, itemEvidence, peopleKey } from './providers.js';
import { validateDocument } from '../model/validate.js';
import { describeEvidence, quoteInEvidence } from './evidence-text.js';
import { buildDraftPrompt, buildExplainPrompt } from './prompts.js';
import { aiResultToDocument, checkConvertInput, textFingerprint, verifyAiConvert } from './ai-convert.js';
import { candidatesInputMessage, checkCandidatesInput, verifyAiCandidates, worksFingerprint } from './ai-candidates.js';

export const METHOD_LABELS = { rule: '규칙 기반', pregen: '사전 생성(Claude가 기록만 보고 써 둔 문장)', llm: 'Claude API(실시간)' };
const FALLBACK = 'W-LLM-FALLBACK';

// 공급자가 던진 오류 → 규칙 기반 전환 사유. 키가 없거나 아직 연결하지 않은 공급자(noPrefix)는 고장이 아니므로 머리말 없이 그 안내를 그대로 쓰고(키 없음은 keyless 표지),
// 진짜 오류(키 거부·한도·시간 초과·형식)는 머리말 「연결 오류:」 뒤에 원인을 이어 붙인다. 원인 코드(W-LLM-FALLBACK)는 그대로다
const messageOf = (err) => (err && err.message ? err.message : String(err));
const reasonOf = (err) => (err && err.noPrefix ? messageOf(err) : `${REASON_PREFIX}${messageOf(err)}`);
const failureOf = (err) => ({ code: FALLBACK, reason: reasonOf(err), ...(err && err.keyless ? { keyless: true } : {}) });
export const QUOTE_FAIL = 'W-LLM-QUOTE';

const validSentences = (sentences, allowed, exists) =>
  Array.isArray(sentences) && sentences.length > 0 &&
  sentences.every((s) => s && typeof s.text === 'string' && s.text.trim() && Array.isArray(s.evidence_ids) && s.evidence_ids.length > 0 &&
    s.evidence_ids.every((g) => allowed.has(g) && exists(g)));

/**
 * @param {object} draft 규칙 기반 결과(rules/handover.js의 draft)
 * @param {{provider?: {name:string, method:'pregen'|'llm', refine:(task:string, draft:object)=>{items:object[]}}, exists:(gid:string)=>boolean}} opts
 * @returns {object} draft와 같은 모양. method(공급자 문장을 하나라도 썼으면 공급자 방식), fallback({code, reason}),
 *   counts({provider, rule}) — 항목마다 method가 붙는다
 */
export function refineDraft(draft, { provider = null, exists }) {
  const asRule = (fallback) => ({ ...draft, items: draft.items.map((i) => ({ ...i, method: 'rule' })), method: 'rule', fallback, counts: { provider: 0, rule: draft.items.filter((i) => !i.insufficient).length } });
  if (!provider || provider.name === 'none') return asRule(null);

  let result;
  try {
    result = provider.refine('handover', draft);
  } catch (err) {
    return asRule(failureOf(err));
  }
  if (!result || !Array.isArray(result.items)) return asRule({ code: FALLBACK, reason: '응답 형식 오류' });

  let replaced = 0;
  let used = 0;
  const items = draft.items.map((ruleItem) => {
    const got = result.items.find((i) => i && i.key === ruleItem.key);
    if (!got) return { ...ruleItem, method: 'rule' };
    if (ruleItem.insufficient) return { ...ruleItem, method: 'rule' };
    if (!validSentences(got.sentences, new Set(itemEvidence(ruleItem)), exists)) {
      replaced += 1;
      return { ...ruleItem, method: 'rule', replaced: true };
    }
    used += 1;
    return { ...ruleItem, sentences: got.sentences, method: provider.method };
  });
  // 키 없이 Claude API를 고른 경우(CR-17 H): 사전 생성 문장을 썼으면 그렇게, 하나도 못 썼으면 규칙 기반이라고 사실대로 알린다(고장이 아니라 안내: keyless 표지)
  const replacedNote = replaced ? `근거가 확인되지 않은 항목 ${replaced}개는 규칙 기반 문장으로 대체` : '';
  const fallback = provider.keyless
    ? { code: FALLBACK, reason: `${used ? KEYLESS_PREGEN_REASON : KEYLESS_REASON}${replacedNote ? `(${replacedNote})` : ''}`, keyless: true }
    : replaced ? { code: FALLBACK, reason: replacedNote } : null;
  return {
    ...draft,
    items,
    method: used ? provider.method : 'rule',
    fallback,
    // 이력 부족 항목은 어느 쪽에도 세지 않는다(문장이 없음)
    counts: { provider: used, rule: items.filter((i) => !i.insufficient).length - used },
  };
}

/**
 * 설명 문장: 인사이트 설명(역할 b, insight_explain) 또는 업무 후보 이유(역할 c, work_candidate_reason, T-10).
 * 공급자 결과가 없거나 검증에 실패하면 규칙 기반 문장.
 * @param {{task?:string, target:string, evidence_ids:string[], rule:{text:string, evidence_ids:string[]}[]}} req
 * @returns {{sentences:object[], method:string, fallback:object|null}}
 */
export function explainInsight(req, { provider = null, exists }) {
  const rule = { sentences: req.rule, method: 'rule', fallback: null };
  if (!provider || provider.name === 'none' || typeof provider.explain !== 'function') return rule;
  let got;
  try {
    got = provider.explain(req.target, req.evidence_ids, req.task || 'insight_explain', req.rule);
  } catch (err) {
    return { ...rule, fallback: failureOf(err) };
  }
  if (!got) return rule;
  if (!validSentences(got.sentences, new Set(req.evidence_ids), exists)) {
    return { ...rule, fallback: { code: FALLBACK, reason: '근거가 확인되지 않아 규칙 기반 설명으로 대체' } };
  }
  return { sentences: got.sentences, method: provider.method, fallback: null };
}

/**
 * 문서 → 유니버스 변환(역할 d, CR-3·CR-5 ②). 규칙 기반 초벌 변환이 기본이고, 공급자가 문서 변환(convert)을 할 수 있으면 그 결과를 쓴다(CR-3 B 자리).
 * 공급자 결과는 스키마 검증과 원문 근거(모든 노드의 attrs.원문)를 통과해야 쓴다. 아니면 규칙 기반 결과와 원인을 돌려준다(R-04 ③).
 * 사전 생성은 내장 샘플용이라 새 문서에는 결과가 없다 → 규칙 기반.
 * @param {string} text 문서 원문
 * @param {{provider?:object|null, ruleConvert:(text:string)=>object}} opts ruleConvert: rules/doc-convert.js의 convertDocument를 감싼 것
 * @returns {{ok:boolean, doc?:object, report?:object, error?:object, method:string, fallback:object|null, note?:string|null}}
 *   fallback: 공급자가 실패해 규칙 기반으로 바꾼 원인. note: 실패는 아니지만 알릴 것(사전 생성)
 */
export function convertDocumentWith(text, { provider = null, ruleConvert }) {
  // 실시간 공급자(키 있음)면 결과에 「AI로 변환」 손잡이(ai)를 붙인다. 동기 결과는 그대로 규칙 기반이고, 화면이 단추를 눌렀을 때만 ai.run을 부른다(T-37).
  // 키가 없으면 ai가 없어 화면에 단추도 없다
  const aiHook = isLive(provider) ? { model: provider.model, run: (t) => convertDocumentAsync(t, { provider }) } : null;
  const rule = (fallback, note = null) => ({ ...ruleConvert(text), method: 'rule', fallback, note, ...(aiHook ? { ai: aiHook } : {}) });
  if (aiHook) return rule(null);
  if (!provider || provider.name === 'none') return rule(null);
  if (typeof provider.convert !== 'function') return rule(null, '사전 생성 결과는 내장 샘플용이라, 새 문서는 규칙 기반으로 변환했습니다');
  let got;
  try {
    got = provider.convert('doc_to_universe', text);
  } catch (err) {
    return rule(failureOf(err));
  }
  const d = got && got.doc;
  // 작성 주체는 미리 보기에서 사람이 채우므로 비어 있어도 된다
  const blocking = d ? validateDocument(d).errors.filter((e) => e.path !== 'universe.owner') : [null];
  if (blocking.length) {
    return rule({ code: FALLBACK, reason: '변환 결과가 형식 검증을 통과하지 못해 규칙 기반으로 변환했습니다' });
  }
  if (!d.nodes.every((n) => n && n.attrs && typeof n.attrs.원문 === 'string' && n.attrs.원문.trim())) {
    return rule({ code: FALLBACK, reason: '원문 근거가 없는 항목이 있어 규칙 기반으로 변환했습니다' });
  }
  return { ok: true, doc: d, report: got.report || null, method: provider.method, fallback: null, note: null };
}

// ── 실시간 경로(CR-15) ─────────────────────────────────────────────────────

/** 먼저 그릴 때 쓰는 동기 공급자. 실시간 공급자면 그 base(사전 생성), 아니면 그대로 */
export const syncProvider = (provider) => (provider && provider.live ? provider.base || null : provider);
/** 비동기 경로를 쓸 수 있는 공급자인가(키가 있어 만들어진 실시간 공급자만 true) */
export const isLive = (provider) => !!(provider && provider.live === true && typeof provider.refine === 'function');


// 캐시 키(task, target, item, 규칙 기반 문장 지문, 모델, 사람): 근거가 바뀌면 지문이 달라져 다시 호출한다(K-9).
// 초안은 보내는·받는 사람에 따라 문장(문의할 사람 등)이 달라지므로 사람 조합(from>to)이 키에 들어간다(사전 생성 키와 같은 원칙, R10-2). 설명·변환은 사람이 없다
export const llmCacheKey = (task, target, item, ruleSentences, model, people = '') => [task, target, item || '', fingerprint(ruleSentences), model || '', people].join('|');

// 진행 중인 요청 합치기(R10-3): 같은 키의 요청이 아직 끝나지 않았으면 새로 보내지 않고 같은 응답을 기다린다(과금·한도).
// 공급자(=키·모델) 하나마다 따로 둔다. 끝나면(성공·실패 모두) 지운다 — 실패를 기억하지 않으므로 다음 호출은 새로 보낸다
const inflightMaps = new WeakMap();
function sharedRequest(provider, key, start) {
  let m = inflightMaps.get(provider);
  if (!m) {
    m = new Map();
    inflightMaps.set(provider, m);
  }
  if (m.has(key)) return m.get(key);
  const p = (async () => start())().finally(() => { if (m.get(key) === p) m.delete(key); });
  m.set(key, p);
  return p;
}

/** 인사이트 설명의 실시간 호출을 늦추는 시간(R10-3): 시간 막대를 끌면 설명 상자가 계속 다시 그려지므로, 조용해진 뒤 화면에 남은 상자만 부른다 */
export const LLM_INSIGHT_DEBOUNCE_MS = 400;
/**
 * ms 뒤에 shouldRun()이 참이면 run()을 부른다(그 사이 상자가 화면에서 빠졌으면 부르지 않음). 돌려주는 함수로 취소할 수 있다
 * @returns {() => void} 취소
 */
export function afterQuiet(shouldRun, run, ms = LLM_INSIGHT_DEBOUNCE_MS) {
  const t = setTimeout(() => { if (shouldRun()) run(); }, ms);
  return () => clearTimeout(t);
}

/**
 * 한 항목의 문장 검증. 근거 ID(비어 있지 않고, 허용 목록 안이고, 데이터에 있음)를 먼저, 그다음 quote를 본다.
 * quote: 문장마다 1개 이상, 각 quote가 그 문장의 근거 글 안에 공백·대소문자 무시 부분 문자열로 있어야 한다.
 * @returns {{ok:true, sentences:object[]}|{ok:false, quote:boolean}} quote: 근거 ID는 맞는데 quote만 틀렸는가
 */
function checkLive(sentences, allowed, exists, textOf) {
  const structural = Array.isArray(sentences) && sentences.length > 0 && sentences.every((s) => s && typeof s.text === 'string' && s.text.trim() &&
    Array.isArray(s.evidence_ids) && s.evidence_ids.length > 0 && s.evidence_ids.every((g) => allowed.has(g) && exists(g)));
  if (!structural) return { ok: false, quote: false };
  for (const s of sentences) {
    const texts = s.evidence_ids.map(textOf);
    if (!Array.isArray(s.quotes) || s.quotes.length === 0 || !s.quotes.every((q) => quoteInEvidence(q, texts))) return { ok: false, quote: true };
  }
  return { ok: true, sentences: sentences.map((s) => ({ text: s.text, evidence_ids: [...s.evidence_ids], quotes: [...s.quotes] })) };
}

const withoutQuotes = (sentences) => sentences.map((s) => ({ text: s.text, evidence_ids: s.evidence_ids }));
const memo = (fn) => {
  const m = new Map();
  return (x) => {
    if (!m.has(x)) m.set(x, fn(x));
    return m.get(x);
  };
};
const cacheGet = (cache, key) => {
  try {
    return cache ? cache.get(key) : null;
  } catch {
    return null;
  }
};
const cacheSet = (cache, key, value) => {
  try {
    if (cache) cache.set(key, value);
  } catch {
    // 캐시를 못 써도 결과는 쓴다
  }
};

/**
 * refineDraft의 실시간 판. 캐시에 있는 항목은 호출 없이 쓰고, 없는 항목만 한 번에 요청한다.
 * 전체 실패(오류·시간 초과·형식)는 규칙 기반 + 원인(W-LLM-FALLBACK), quote만 틀린 항목은 규칙 기반 + replaced + 사유 W-LLM-QUOTE.
 * @param {object} draft 규칙 기반 결과
 * @param {{provider:object|null, exists:(gid:string)=>boolean, view:object, base?:object|null}} opts view: 근거 글을 만들 buildView 결과. base: 호출 전에 그려진 동기 결과(refineDraft) — 실패·불통과 항목은 그 문장을 유지한다
 * @returns {Promise<object|null>} refineDraft와 같은 모양(method는 쓴 항목이 있으면 'llm') + live({called, cached}). 실시간 공급자가 아니면 null
 */
export async function refineDraftAsync(draft, { provider = null, exists, view, base = null }) {
  if (!isLive(provider)) return null;
  const textOf = memo((g) => describeEvidence(view, g));
  const targets = draft.items.filter((i) => !i.insufficient && Array.isArray(i.sentences));
  const people = peopleKey(draft.from, draft.to);
  // base: 호출 전에 화면에 그려진 동기 결과(사전 생성 등). 실패·검증 불통과 항목은 그 문장을 그대로 둔다(규칙 기반으로 내리지 않음, B1)
  const keptOf = (key) => {
    const b = base && Array.isArray(base.items) ? base.items.find((i) => i && i.key === key) : null;
    return b && b.method && b.method !== 'rule' && Array.isArray(b.sentences) && b.sentences.length ? b : null;
  };

  const keyOf = (i) => llmCacheKey('handover', draft.target, i.key, i.sentences, provider.model, people);
  const done = new Map(); // 항목 key → 검증을 통과한 문장(quotes 포함)
  const need = [];
  for (const item of targets) {
    const hit = cacheGet(provider.cache, keyOf(item));
    const checked = hit && Array.isArray(hit.sentences) ? checkLive(hit.sentences, new Set(itemEvidence(item)), exists, textOf) : null;
    if (checked && checked.ok) done.set(item.key, checked.sentences);
    else need.push(item);
  }
  const cached = done.size;

  // 항목 구성: 통과한 항목은 Claude API 문장, 아니면 호출 전 문장(사전 생성 등), 그것도 없으면 규칙 기반
  const build = (failed) => {
    let keptN = 0;
    const items = draft.items.map((ruleItem) => {
      const got = done.get(ruleItem.key);
      if (ruleItem.insufficient || !Array.isArray(ruleItem.sentences)) return { ...ruleItem, method: 'rule' };
      if (got) return { ...ruleItem, sentences: withoutQuotes(got), method: 'llm' };
      const kept = keptOf(ruleItem.key);
      if (kept) {
        keptN += 1;
        return { ...kept };
      }
      return failed ? { ...ruleItem, method: 'rule' } : { ...ruleItem, method: 'rule', replaced: true };
    });
    return { items, keptN };
  };

  let failure = null;
  let badQuote = 0;
  let badOther = 0;
  if (need.length) {
    try {
      const result = await sharedRequest(provider, need.map(keyOf).join('\n'), () => provider.refine('handover', buildDraftPrompt({ draft, items: need, textOf })));
      if (!result || !Array.isArray(result.items)) throw new Error('응답 형식 오류');
      for (const item of need) {
        const got = result.items.find((i) => i && i.key === item.key);
        const checked = got ? checkLive(got.sentences, new Set(itemEvidence(item)), exists, textOf) : { ok: false, quote: false };
        if (checked.ok) {
          done.set(item.key, checked.sentences);
          cacheSet(provider.cache, keyOf(item), { sentences: checked.sentences });
        } else if (checked.quote) badQuote += 1;
        else badOther += 1;
      }
    } catch (err) {
      failure = reasonOf(err);
    }
  }
  if (failure && done.size === 0) {
    const { items, keptN } = build(true);
    return {
      ...draft, items, method: keptN ? base.method : 'rule', fallback: { code: FALLBACK, reason: failure, ...(keptN ? { keep: true } : {}) },
      counts: { provider: keptN, rule: targets.length - keptN }, live: { called: true, cached: 0 },
    };
  }

  const { items, keptN } = build(!!failure);
  const used = done.size;
  const keep = keptN > 0;
  const parts = [];
  if (failure) parts.push(`${failure}(저장된 응답이 있는 항목만 쓰고 나머지는 ${keep ? '원래 문장 유지' : '규칙 기반'})`);
  if (badQuote) parts.push(`원문 인용(quote)이 근거 글에서 확인되지 않은 항목 ${badQuote}개는 ${keep ? '원래 문장 유지' : '규칙 기반 문장으로 대체'}`);
  if (badOther) parts.push(`근거가 확인되지 않은 항목 ${badOther}개는 ${keep ? '원래 문장 유지' : '규칙 기반 문장으로 대체'}`);
  return {
    ...draft,
    items,
    method: used ? 'llm' : keep ? base.method : 'rule',
    fallback: parts.length ? { code: badQuote ? QUOTE_FAIL : FALLBACK, reason: parts.join(', '), ...(keep ? { keep: true } : {}) } : null,
    // 이력 부족 항목은 어느 쪽에도 세지 않는다. 쓴 항목이 없고 호출 전 문장이 남았으면 그 방식(사전 생성)의 개수로 센다
    counts: used ? { provider: used, rule: targets.length - used, kept: keptN } : { provider: keptN, rule: targets.length - keptN },
    live: { called: need.length > 0, cached },
  };
}

/**
 * explainInsight의 실시간 판(인사이트 설명 7종). 캐시 → 호출 → 검증(근거 ID + quote), 실패하면 호출 전 문장(base: 사전 생성 등, 없으면 규칙 기반 문장) + 원인.
 * @param {{task?:string, target:string, evidence_ids:string[], rule:object[]}} req
 * @param {{provider:object|null, exists:(gid:string)=>boolean, view:object, base?:{sentences:object[], method:string}|null}} opts base: 호출 전에 그려진 동기 결과
 * @returns {Promise<{sentences:object[], method:string, fallback:object|null, live:{called:boolean, cached:boolean}}|null>} 실시간 공급자가 아니면 null
 */
export async function explainInsightAsync(req, { provider = null, exists, view, base = null }) {
  if (!isLive(provider)) return null;
  const keep = !!(base && base.method && base.method !== 'rule' && Array.isArray(base.sentences) && base.sentences.length);
  const rule = (fallback, called) => ({
    sentences: keep ? base.sentences : req.rule,
    method: keep ? base.method : 'rule',
    fallback: fallback && keep ? { ...fallback, keep: true } : fallback,
    live: { called, cached: false },
  });
  if (!Array.isArray(req.evidence_ids) || req.evidence_ids.length === 0) return rule(null, false);
  const textOf = memo((g) => describeEvidence(view, g));
  const task = req.task || 'insight_explain';
  const key = llmCacheKey(task, req.target, '', req.rule, provider.model);
  const allowed = new Set(req.evidence_ids);

  const hit = cacheGet(provider.cache, key);
  const fromCache = hit && Array.isArray(hit.sentences) ? checkLive(hit.sentences, allowed, exists, textOf) : null;
  if (fromCache && fromCache.ok) return { sentences: withoutQuotes(fromCache.sentences), method: 'llm', fallback: null, live: { called: false, cached: true } };

  let result;
  try {
    result = await sharedRequest(provider, key, () => provider.refine(task, buildExplainPrompt({ req, textOf })));
    if (!result || !Array.isArray(result.sentences)) throw new Error('응답 형식 오류');
  } catch (err) {
    return rule({ code: FALLBACK, reason: reasonOf(err) }, true);
  }
  const checked = checkLive(result.sentences, allowed, exists, textOf);
  if (!checked.ok) {
    const word = keep ? '원래 설명 유지' : '규칙 기반 설명으로 대체';
    return rule(checked.quote
      ? { code: QUOTE_FAIL, reason: `원문 인용(quote)이 근거 글에서 확인되지 않아 ${word}` }
      : { code: FALLBACK, reason: `근거가 확인되지 않아 ${word}` }, true);
  }
  cacheSet(provider.cache, key, { sentences: checked.sentences });
  return { sentences: withoutQuotes(checked.sentences), method: 'llm', fallback: null, live: { called: true, cached: false } };
}

// ── 문서 AI 변환(CR-15 A, T-37) ──────────────────────────────────────────────
// 캐시: 공급자 하나당 마지막 1건만, 메모리에만 둔다(공급자는 설정이 바뀌면 새로 만들어지므로 키를 지우면 함께 사라진다).
// 이유: 문서는 크고(최대 20만 자) 응답도 커서 200건짜리 응답 캐시(localStorage, wu:v1:llm-cache)에 넣으면 저장 용량을 먹고,
//   문서 내용이 브라우저 저장소에 남는다(R-28 ⑤: 응답 본문은 저장·내보내기에 넣지 않는다). 같은 문서를 다시 누를 때 호출을 아끼는 것이 목적이라 1건이면 충분하다.
const convertMemo = new WeakMap();

/**
 * 문서 → 유니버스 변환의 실시간 판. 모델 응답에서 원문 인용(quote)이 원문에 있는 항목만 남긴 뒤 12.2 문서로 만든다(llm/ai-convert.js).
 * 호출은 공급자의 convert(text) 하나뿐이다. 응답 검증(스키마·인용·연결 끝)은 여기서 하고, 사람 확인은 가져오기 미리 보기가 한다.
 * @param {string} text 문서 원문
 * @param {{provider:object|null, now?:()=>string, random?:()=>number}} opts
 * @returns {Promise<null | {ok:true, doc:object, report:object, method:'llm', model:string, fallback:null, cached:boolean, dropped:object[]} | {ok:false, fallback:{code:string, reason:string}}>}
 *   null: 실시간 공급자가 아님(키 없음). ok:false: 실패 — 화면이 규칙 변환 결과를 대신 보여 준다(R-04 ③)
 */
export async function convertDocumentAsync(text, { provider = null, now = () => new Date().toISOString(), random } = {}) {
  if (!isLive(provider) || typeof provider.convert !== 'function') return null;
  const fail = (reason, code = FALLBACK) => ({ ok: false, fallback: { code, reason } });
  const input = checkConvertInput(text);
  if (!input.ok) return fail(input.reason === 'empty' ? '변환할 문서가 비어 있습니다' : `문서가 너무 깁니다(${input.max.toLocaleString()}자 이하)`);

  const key = `${textFingerprint(text)}|${provider.model || ''}`;
  const memo = convertMemo.get(provider);
  let parsed = memo && memo.key === key ? memo.parsed : null;
  const cached = parsed !== null;
  if (!cached) {
    try {
      parsed = await sharedRequest(provider, `convert|${key}`, () => provider.convert(text));
    } catch (err) {
      return fail(err && err.message ? err.message : '알 수 없는 오류');
    }
  }
  const checked = verifyAiConvert(text, parsed);
  if (!checked.ok) {
    // 항목이 하나도 없는데 뺀 항목도 0개면 인용 문제가 아니라 응답이 비어 있는 것(R10-14)
    if (checked.reason === 'empty' && checked.dropped.length === 0) return fail('응답에 항목이 없음');
    return fail(checked.reason === 'empty'
      ? `원문 인용이 확인된 항목이 하나도 없습니다(뺀 항목 ${checked.dropped.length}개)`
      : '응답 형식 오류', checked.reason === 'empty' ? QUOTE_FAIL : FALLBACK);
  }
  if (!cached) convertMemo.set(provider, { key, parsed });
  const built = aiResultToDocument(checked.kept, { now: now(), model: provider.model || '', dropped: checked.dropped, random });
  if (!built.ok) return fail('변환 결과가 형식 검증을 통과하지 못했습니다');
  return { ok: true, doc: built.doc, report: built.report, method: 'llm', model: provider.model || '', fallback: null, cached, dropped: checked.dropped };
}

// ── AI 연관 후보(CR-15 C, T-38) ──────────────────────────────────────────────
// 캐시: 문서 변환과 같은 이유(C15-7)로 메모리에만, 공급자 하나당 마지막 1건(보낸 업무 목록 지문 + 모델). 업무 글이 저장소에 남지 않게 한다.
// 캐시에 두는 것은 모델의 원 응답이고, 검증(끝 업무·인용·사람이 이미 판정한 쌍)은 부를 때마다 다시 한다 → 그 사이 판정이 바뀌어도 맞다.
const candidatesMemo = new WeakMap();

/**
 * 뜻이 같은 업무 쌍 찾기의 실시간 판. 호출은 공급자의 candidates(works) 하나뿐이고, 모델 응답은 앱이 검증해 통과한 쌍만 돌려준다.
 * 확정은 하지 않는다 — 돌려준 쌍은 통합 확인 목록에 「AI 후보」로 끼워 넣고 사람이 「같은 업무」/「다른 업무」를 고른다.
 * @param {{universe:string, node:string, universe_name?:string, label?:string, text:string}[]} works llm/ai-candidates.js의 collectWorks 결과
 * @param {{provider:object|null, rejected?:Set<string>, confirmed?:Set<string>, canon?:(gid:string)=>string}} opts rejected·confirmed·canon: decidedSets 결과
 * @returns {Promise<null | {ok:true, pairs:object[], dropped:object[], counts:object, method:'llm', model:string, fallback:null, cached:boolean} | {ok:false, fallback:{code:string, reason:string}}>}
 *   null: 실시간 공급자가 아님(키 없음). ok:false: 실패 — 화면이 기존 후보만 보여 준다(R-04 ③)
 */
export async function findCandidatesAsync(works, { provider = null, rejected, confirmed, canon } = {}) {
  if (!isLive(provider) || typeof provider.candidates !== 'function') return null;
  const fail = (reason, code = FALLBACK) => ({ ok: false, fallback: { code, reason } });
  const input = checkCandidatesInput(works);
  if (!input.ok) return fail(candidatesInputMessage(input));

  const key = `${worksFingerprint(works)}|${provider.model || ''}`;
  const memo = candidatesMemo.get(provider);
  let parsed = memo && memo.key === key ? memo.parsed : null;
  const cached = parsed !== null;
  if (!cached) {
    try {
      parsed = await sharedRequest(provider, `candidates|${key}`, () => provider.candidates(works));
    } catch (err) {
      return fail(err && err.message ? err.message : '알 수 없는 오류');
    }
  }
  const checked = verifyAiCandidates(works, parsed, { rejected, confirmed, canon });
  if (!checked.ok) return fail('응답 형식 오류');
  if (!cached) candidatesMemo.set(provider, { key, parsed });
  return { ok: true, pairs: checked.pairs, dropped: checked.dropped, counts: checked.counts, method: 'llm', model: provider.model || '', fallback: null, cached };
}
