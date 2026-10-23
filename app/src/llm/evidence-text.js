// 근거 글 만들기(순수). 노드·이력을 사람이 읽는 한 줄 글로 옮긴다.
// 쓰임: ① tools/pregen-dump.mjs(사전 생성 작성용 덤프) ② 실시간 Claude API 프롬프트 재료 ③ quote 검증(응답 인용이 이 글에 있어야 한다, CR-15).
// "규칙이 고른 근거만 보낸다"를 코드로 보장하려고 세 곳이 같은 함수를 쓴다. 브라우저 기능을 쓰지 않는다.

import { eventText } from '../view/describe.js';

/**
 * 근거 ID 하나를 글로. 노드: 「gid [유형·하위유형] 이름 (사번) — 설명 {속성}」, 이력: 「gid [이력 시각] 문장」, 없으면 「gid (없음)」
 * @param {object} view buildView 결과(lookup, events)
 * @param {string} gid
 */
export function describeEvidence(view, gid) {
  const hit = view.lookup(gid);
  if (hit.found) {
    const n = hit.node;
    const attrs = Object.entries(n.attrs || {}).map(([k, v]) => `${k}=${v}`).join('; ');
    return `${gid} [${n.type_label}${n.subtype ? `·${n.subtype}` : ''}] ${n.label}${n.emp_no ? ` (${n.emp_no})` : ''}${n.description ? ` — ${n.description}` : ''}${attrs ? ` {${attrs}}` : ''}`;
  }
  const ev = view.events.find((e) => e.gid === gid);
  return ev ? `${gid} [이력 ${ev.occurred_at}] ${eventText(view, ev)}` : `${gid} (없음)`;
}

/** 근거 ID 여러 개의 글(한 줄씩) */
export const describeAll = (view, ids) => ids.map((g) => describeEvidence(view, g));

/** quote 비교용 정규화: 공백을 모두 없애고 소문자로(공백·대소문자 무시, CR-15) */
export const normalizeQuote = (s) => String(s).replace(/\s+/g, '').toLowerCase();

/** quote 한 줄의 최소 길이(정규화한 뒤 글자 수). 한두 글자짜리 인용은 어디에나 있어 근거가 되지 못한다 */
export const MIN_QUOTE_LEN = 3;

/**
 * 인용(quote)이 근거 글 안에 실제로 있는가. 근거 글은 그 문장의 근거 ID들의 글을 이어 붙인 것
 * @param {string} quote
 * @param {string[]} evidenceTexts 문장의 근거 ID별 글
 */
export function quoteInEvidence(quote, evidenceTexts) {
  if (typeof quote !== 'string') return false;
  const q = normalizeQuote(quote);
  if (q.length < MIN_QUOTE_LEN) return false;
  return evidenceTexts.some((t) => normalizeQuote(t).includes(q));
}
