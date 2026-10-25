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

export const DOWNLOAD_BLOCKED = '내려받기가 막혔습니다. 「인쇄」에서 PDF로 저장할 수 있습니다.';

/** HTML 글을 파일로 내려받는다(file://에서도 동작하는 a[download]). 예외가 나면 { ok: false }를 돌려준다(R-19 ④) */
export function downloadHtml(name, html) {
  let url = null;
  try {
    url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const a = el('a', { href: url, download: name });
    document.body.append(a);
    try { a.click(); } finally { a.remove(); }
  } catch {
    if (url) { try { URL.revokeObjectURL(url); } catch { /* 무시 */ } }
    return { ok: false };
  }
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { ok: true };
}

/** 내려받기를 누른 단추 쪽에서 부른다. 막히면 단추 줄 아래에 안내 한 줄을 보인다(성공하면 이전 안내를 치운다) */
export function downloadWithNotice(btn, name, html) {
  const row = btn.closest('.toolbar, .draft-head') || btn.parentElement;
  const host = row.parentElement || row;
  const old = host.querySelector('[data-testid=download-blocked]');
  const r = downloadHtml(name, html);
  if (r.ok) {
    if (old) old.remove();
    return r;
  }
  if (!old) row.after(el('p', { class: 'notice', role: 'alert', 'data-testid': 'download-blocked' }, DOWNLOAD_BLOCKED));
  return r;
}

// 인쇄 문서에는 스크립트가 필요 없다(RV10S-11). 지금은 모든 글이 이스케이프돼 안전하지만, 실수로 새도 실행되지 않게 막는다.
// sandbox 대신 메타를 쓴다: 인쇄는 부모가 iframe의 contentWindow.print()를 부르므로 allow-same-origin·allow-modals가 필요해 sandbox가 인쇄를 깰 위험이 더 크다.
export const PRINT_CSP_META = `<meta http-equiv="Content-Security-Policy" content="script-src 'none'">`;

/** 문서 HTML의 맨 앞(head 안, 없으면 doctype 바로 뒤)에 스크립트 금지 메타를 넣는다. 다른 부분은 그대로 */
export function withNoScript(html) {
  const text = String(html);
  const head = /<head(\s[^>]*)?>/i.exec(text);
  if (head) return text.slice(0, head.index + head[0].length) + PRINT_CSP_META + text.slice(head.index + head[0].length);
  const doctype = /^\s*<!doctype[^>]*>/i.exec(text);
  if (doctype) return text.slice(0, doctype[0].length) + PRINT_CSP_META + text.slice(doctype[0].length);
  return PRINT_CSP_META + text;
}

/** 숨긴 iframe에 HTML을 넣고 그 창의 print()를 부른다(팝업 차단을 피한다). 인쇄 뒤 iframe은 치운다 */
export function printHtml(html) {
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true');
  f.dataset.testid = 'print-frame';
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  f.srcdoc = withNoScript(html);
  f.addEventListener('load', () => {
    const w = f.contentWindow;
    w.addEventListener('afterprint', () => setTimeout(() => f.remove(), 500));
    w.focus();
    w.print();
  });
  document.body.append(f);
}
