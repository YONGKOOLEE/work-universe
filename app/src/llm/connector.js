// LLM 연결부(D-07, 5.4). 화면·기능 코드는 이 함수들만 쓴다(R-15). 공급자는 providers.js에서 이름으로 만든다.
// 규칙:
//   - 공급자 문장마다 근거 ID를 검증한다. 근거가 비었거나, 데이터에 없거나, 그 항목의 규칙 기반 근거 밖이면
//     그 항목은 규칙 기반 문장으로 대체한다("근거로 고른 것만" 쓴다, 5.4 · 검토 3-11).
//   - 근거가 없는 항목(이력 부족)에는 문장을 지어내지 않는다.
//   - 공급자가 실패하거나 형식이 깨지면 전체를 규칙 기반으로 두고 원인을 남긴다(R-04 ③).
//   - 사전 생성 결과가 없는 항목(새로 입력한 데이터 등)은 규칙 기반 문장이 그대로 남는다(CR-1).
// 브라우저 기능을 쓰지 않는다.

import { itemEvidence } from './providers.js';
import { validateDocument } from '../model/validate.js';

export const METHOD_LABELS = { rule: '규칙 기반', pregen: '사전 생성(개발 시 Claude로 작성)', llm: 'LLM' };
const FALLBACK = 'W-LLM-FALLBACK';

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
    return asRule({ code: FALLBACK, reason: `공급자 오류: ${err && err.message ? err.message : err}` });
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
  return {
    ...draft,
    items,
    method: used ? provider.method : 'rule',
    fallback: replaced ? { code: FALLBACK, reason: `근거가 확인되지 않은 항목 ${replaced}개는 규칙 기반 문장으로 대체` } : null,
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
    return { ...rule, fallback: { code: FALLBACK, reason: `공급자 오류: ${err && err.message ? err.message : err}` } };
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
  const rule = (fallback, note = null) => ({ ...ruleConvert(text), method: 'rule', fallback, note });
  if (!provider || provider.name === 'none') return rule(null);
  if (typeof provider.convert !== 'function') return rule(null, '사전 생성 결과는 내장 샘플용이라, 새 문서는 규칙 기반으로 변환했습니다');
  let got;
  try {
    got = provider.convert('doc_to_universe', text);
  } catch (err) {
    return rule({ code: FALLBACK, reason: `공급자 오류: ${err && err.message ? err.message : err}` });
  }
  const d = got && got.doc;
  // 작성 주체는 미리 보기에서 사람이 채우므로 비어 있어도 된다
  const blocking = d ? validateDocument(d).errors.filter((e) => e.path !== 'universe.owner') : [null];
  if (blocking.length) {
    return rule({ code: FALLBACK, reason: '변환 결과가 형식 검증을 통과하지 못해 규칙 기반으로 변환했습니다' });
  }
  if (!d.nodes.every((n) => n && n.attrs && typeof n.attrs.원문 === 'string' && n.attrs.원문.trim())) {
    return rule({ code: FALLBACK, reason: '원문 근거가 없는 노드가 있어 규칙 기반으로 변환했습니다' });
  }
  return { ok: true, doc: d, report: got.report || null, method: provider.method, fallback: null, note: null };
}
