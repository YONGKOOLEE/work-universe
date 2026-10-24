// 다시 뽑은 초안의 「새로」 표시 판정(CR-18 D-13). 순수 함수이며 view만 입력으로 받는다(DOM·저장소를 쓰지 않는다).
// 지난번에 같은 대상으로 초안을 만든 시각(since) 이후에 기록된(recorded_at) 이력이 근거에 들어 있는 문장이 「새로」다.
// 시각을 저장하는 곳은 store/draft-seen.js(이 브라우저 설정 전용)이고, 문서·내보내기·백업에는 들어가지 않는다.

const instant = (s) => {
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
};

/**
 * 문장의 근거 중 since 이후에 기록된 이력이 있는가.
 * since가 없거나 시각으로 읽을 수 없으면(처음 만드는 초안) 항상 false. 노드·연결 근거는 기록 시각(recorded_at)이 없으므로 보지 않는다.
 * @param {{events:object[]}} view
 * @param {{evidence_ids:string[]}} sentence
 * @param {string|null} since 지난번 초안을 만든 시각(ISO)
 */
export function isNewSentence(view, sentence, since) {
  const cut = instant(since);
  if (cut === null || !sentence || !Array.isArray(sentence.evidence_ids)) return false;
  const ids = new Set(sentence.evidence_ids);
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
