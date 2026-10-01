// LLM 연결부(D-07, 5.4)의 최소 형태(T-07). 화면·기능 코드는 이 함수만 쓴다(R-15).
// 공급자: none(기본, 규칙 기반 그대로) — pregen(T-12)·claude_api(P2)·internal(P2)은 같은 자리에 붙인다.
// 규칙: 공급자 결과의 문장마다 근거 ID를 검증하고, 근거가 없거나 데이터에 없는 문장은 규칙 기반 문장으로 대체한다.
//       공급자가 실패하거나 형식이 깨지면 전체를 규칙 기반으로 두고 원인을 남긴다(R-04 ③).
// 브라우저 기능을 쓰지 않는다.

export const METHOD_LABELS = { rule: '규칙 기반', pregen: '사전 생성(개발 시 Claude로 작성)', llm: 'LLM' };

/**
 * @param {object} draft 규칙 기반 결과(rules/handover.js의 draft)
 * @param {{provider?: {name:string, method:'pregen'|'llm', refine:(task:string, draft:object)=>{items:object[]}}, exists:(gid:string)=>boolean}} opts
 *   exists(gid)는 근거 ID가 실제 데이터에 있는지 확인한다(view.lookup / 이벤트 목록).
 * @returns {object} draft와 같은 모양. method, fallback({code, reason})이 붙는다
 */
export function refineDraft(draft, { provider = null, exists }) {
  if (!provider || provider.name === 'none') return { ...draft, method: 'rule', fallback: null };

  let result;
  try {
    result = provider.refine('handover', draft);
  } catch (err) {
    return { ...draft, method: 'rule', fallback: { code: 'W-LLM-FALLBACK', reason: `공급자 오류: ${err && err.message ? err.message : err}` } };
  }
  if (!result || !Array.isArray(result.items)) {
    return { ...draft, method: 'rule', fallback: { code: 'W-LLM-FALLBACK', reason: '응답 형식 오류' } };
  }

  // 항목 단위 검증: 공급자 문장의 근거가 모두 실제로 있어야 쓴다. 아니면 그 항목은 규칙 기반 문장 유지
  let replaced = 0;
  const items = draft.items.map((ruleItem) => {
    const got = result.items.find((i) => i && i.key === ruleItem.key);
    if (!got || !Array.isArray(got.sentences)) return { ...ruleItem, method: 'rule' };
    const valid = got.sentences.every(
      (s) => s && typeof s.text === 'string' && Array.isArray(s.evidence_ids) && s.evidence_ids.length > 0 && s.evidence_ids.every(exists),
    );
    if (!valid) {
      replaced += 1;
      return { ...ruleItem, method: 'rule', replaced: true };
    }
    // 근거가 없는 항목(이력 부족)에는 문장을 지어내지 않는다
    if (ruleItem.insufficient) return { ...ruleItem, method: 'rule' };
    return { ...ruleItem, sentences: got.sentences, method: provider.method };
  });
  return {
    ...draft,
    items,
    method: provider.method,
    fallback: replaced ? { code: 'W-LLM-FALLBACK', reason: `근거가 확인되지 않은 항목 ${replaced}개는 규칙 기반 문장으로 대체` } : null,
  };
}
