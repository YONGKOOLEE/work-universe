// 인수인계서 HTML을 내려받거나 인쇄한다(R-19, D-21). 브라우저 기능을 쓰므로 단위 테스트 대상이 아니다.
import { el } from './dom.js';
import { displayName, eventText } from '../view/describe.js';
import { confirmedNameParts, handoverDocHtml, handoverFileName } from '../view/handover-doc.js';

/** 근거 ID → 사람이 읽는 이름(노드는 이름, 이력은 날짜와 문장). 찾지 못하면 ID 글자 그대로 */
export function evidenceLabeler(view) {
  return (gid) => {
    const hit = view.lookup(gid);
    if (hit.found) return displayName(hit.node);
    const ev = view.events.find((e) => e.gid === gid);
    return ev ? `${ev.occurred_at} ${eventText(view, ev)}` : gid;
  };
}

/** 초안 → { name, html } */
export function draftDoc(view, draft, date) {
  const target = (view.getNode(draft.target) || {}).label || draft.title;
  return { name: handoverFileName({ date, target, confirmed: false }), html: handoverDocHtml({ kind: 'draft', draft, labelOf: evidenceLabeler(view) }) };
}

/** 확정 인수인계서 노드 → { name, html } */
export function confirmedDoc(node) {
  const { date, target } = confirmedNameParts(node);
  return { name: handoverFileName({ date, target, confirmed: true }), html: handoverDocHtml({ kind: 'confirmed', node }) };
}

/** HTML 글을 파일로 내려받는다(file://에서도 동작하는 a[download]) */
export function downloadHtml(name, html) {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 숨긴 iframe에 HTML을 넣고 그 창의 print()를 부른다(팝업 차단을 피한다). 인쇄 뒤 iframe은 치운다 */
export function printHtml(html) {
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true');
  f.dataset.testid = 'print-frame';
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  f.srcdoc = html;
  f.addEventListener('load', () => {
    const w = f.contentWindow;
    w.addEventListener('afterprint', () => setTimeout(() => f.remove(), 500));
    w.focus();
    w.print();
  });
  document.body.append(f);
}
