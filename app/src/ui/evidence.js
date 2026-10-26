// 근거 칩(검토5 C-2): 근거 ID(노드·이력의 전역 참조) → 누르면 그래프에서 그 노드를 보여 주는 버튼.
// 초안·인사이트·통합 확인 화면이 함께 쓴다. 숨긴 노드는 이름 뒤에 표시가 붙는다(describe.displayName).

import { displayName, eventText } from '../view/describe.js';
import { describeEvidence } from '../llm/evidence-text.js';
import { eventChipLabel } from './chip-label.js';
import { el } from './dom.js';

// 긴 이름은 칩에서 말줄임되므로 전체 이름을 title에 함께 둔다(화면 점검 S-1)
// 이력 칩은 글자를 줄여 보이므로 title에는 줄이지 않은 문장을 넣는다(재검증: 「…— 대…」만 보이던 문제)
const button = (gid, label, onclick, full = label) => el('button', { type: 'button', class: 'evidence', title: `${full} (근거: ${gid})`, onclick }, label);

/**
 * 근거 하나의 버튼. 노드면 이름, 이력이면 날짜와 내용 앞부분(chip-label).
 * @param {object} view
 * @param {string} gid 근거 ID
 * @param {(gid:string)=>void} onFocus
 * @param {{unknown?:boolean}} [opt] unknown: 찾지 못한 근거도 ID 글자 그대로 버튼으로 보인다(초안). 기본은 null(그리지 않음)
 */
export function evidenceChip(view, gid, onFocus, { unknown = false, onShow = null, onCard = null } = {}) {
  const hit = view.lookup(gid);
  let btn;
  const after = (fn) => () => { fn(); if (onShow) onShow(gid, btn); };
  if (hit.found) {
    btn = button(gid, displayName(hit.node), after(() => onFocus(hit.node.gid)));
    // 사람 칩은 눌러도 그래프 강조뿐이라 카드가 안 열렸다(R12 FU7-2). onCard가 있으면 옆에 작은 「카드」 단추를 둔다 — 칩 동작(근거 글·강조)은 그대로
    if (onCard && hit.node.core_type === 'person') {
      return el('span', { class: 'evidence-person' }, btn,
        el('button', { type: 'button', class: 'link small evidence-card', 'data-testid': 'evidence-card', 'data-gid': hit.node.gid, title: `${displayName(hit.node)}의 카드를 엽니다(연락처·맡은 업무)`, onclick: () => onCard(hit.node.gid) }, '카드'));
    }
    return btn;
  }
  const ev = view.events.find((e) => e.gid === gid);
  if (!ev && !unknown) return null;
  const first = ev && ev.node_gids[0];
  btn = button(gid, ev ? eventChipLabel(view, ev) : gid, after(() => first && onFocus(first)), ev ? `${ev.occurred_at} ${eventText(view, ev)}` : gid);
  return btn;
}

/**
 * 근거 칩을 눌렀을 때 그 항목 아래에 보여 줄 근거 글(FU-29, 처음 사용 점검 2026-10-24).
 * describeEvidence(앞에 `gid`가 붙은 한 줄)에서 gid를 떼고, 이력은 「[이력] 날짜 내용」, 없는 근거는 안내 글로 바꾼다.
 */
export function readableEvidence(view, gid) {
  const raw = describeEvidence(view, gid);
  if (raw === `${gid} (없음)`) return `근거 ${gid}: 지금 화면의 기록에서 찾을 수 없습니다`;
  const body = raw.startsWith(`${gid} `) ? raw.slice(gid.length + 1) : raw;
  return body.replace(/^\[이력 ([^\]]+)\]\s*/, '[이력] $1 ');
}

/**
 * 근거 여러 개를 .evidence-list 하나로.
 * @param {{tag?:'span'|'div', dedupe?:boolean, unknown?:boolean}} [opt]
 *   tag: 감싸는 요소(인사이트는 div). dedupe: 같은 ID를 한 번만(초안은 문장의 근거를 그대로 보인다). unknown: evidenceChip과 같다
 *   showText: 칩을 누르면 이 칩 묶음 맨 아래에 근거 글 한 줄(data-testid=evidence-text)을 보인다. 같은 칩을 다시 누르면 접히고, 다른 칩을 누르면 글이 바뀐다.
 *     textOf: 글을 만드는 함수(gid → 문자열). 없으면 view로 만든 readableEvidence
 */
export function evidenceChips(view, ids, onFocus, { tag = 'span', dedupe = true, unknown = false, showText = false, textOf = null, onCard = null } = {}) {
  const list = dedupe ? [...new Set(ids)] : ids;
  if (!showText) return el(tag, { class: 'evidence-list' }, ...list.map((g) => evidenceChip(view, g, onFocus, { unknown, onCard })).filter(Boolean));
  const slot = el('span', { class: 'evidence-slot' }); // 비어 있으면 CSS가 감춘다
  const text = textOf || ((g) => readableEvidence(view, g));
  let shown = null; // 글을 보이고 있는 칩
  const onShow = (gid, btn) => {
    if (shown) shown.setAttribute('aria-pressed', 'false');
    if (shown === btn) {
      shown = null;
      slot.replaceChildren();
      return;
    }
    shown = btn;
    btn.setAttribute('aria-pressed', 'true');
    slot.replaceChildren(el('span', { class: 'evidence-text', 'data-testid': 'evidence-text' }, text(gid)));
  };
  return el(tag, { class: 'evidence-list' }, ...list.map((g) => evidenceChip(view, g, onFocus, { unknown, onShow, onCard })).filter(Boolean), slot);
}
