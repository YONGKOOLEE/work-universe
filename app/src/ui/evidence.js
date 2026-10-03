// 근거 칩(검토5 C-2): 근거 ID(노드·이력의 전역 참조) → 누르면 그래프에서 그 노드를 보여 주는 버튼.
// 초안·인사이트·통합 확인 화면이 함께 쓴다. 숨긴 노드는 이름 뒤에 표시가 붙는다(describe.displayName).

import { displayName } from '../view/describe.js';
import { eventChipLabel } from './chip-label.js';
import { el } from './dom.js';

const button = (gid, label, onclick) => el('button', { type: 'button', class: 'evidence', title: `근거: ${gid}`, onclick }, label);

/**
 * 근거 하나의 버튼. 노드면 이름, 이력이면 날짜와 내용 앞부분(chip-label).
 * @param {object} view
 * @param {string} gid 근거 ID
 * @param {(gid:string)=>void} onFocus
 * @param {{unknown?:boolean}} [opt] unknown: 찾지 못한 근거도 ID 글자 그대로 버튼으로 보인다(초안). 기본은 null(그리지 않음)
 */
export function evidenceChip(view, gid, onFocus, { unknown = false } = {}) {
  const hit = view.lookup(gid);
  if (hit.found) return button(gid, displayName(hit.node), () => onFocus(hit.node.gid));
  const ev = view.events.find((e) => e.gid === gid);
  if (!ev && !unknown) return null;
  const first = ev && ev.node_gids[0];
  return button(gid, ev ? eventChipLabel(view, ev) : gid, () => first && onFocus(first));
}

/**
 * 근거 여러 개를 .evidence-list 하나로.
 * @param {{tag?:'span'|'div', dedupe?:boolean, unknown?:boolean}} [opt]
 *   tag: 감싸는 요소(인사이트는 div). dedupe: 같은 ID를 한 번만(초안은 문장의 근거를 그대로 보인다). unknown: evidenceChip과 같다
 */
export function evidenceChips(view, ids, onFocus, { tag = 'span', dedupe = true, unknown = false } = {}) {
  const list = dedupe ? [...new Set(ids)] : ids;
  return el(tag, { class: 'evidence-list' }, ...list.map((g) => evidenceChip(view, g, onFocus, { unknown })).filter(Boolean));
}
