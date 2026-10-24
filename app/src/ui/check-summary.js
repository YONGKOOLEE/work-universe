// 점검 요약 줄(CR-18 D-4): 인사이트 창 위쪽의 「점검 요약  복사 · 내려받기(.txt) · 인쇄」. 글 만들기는 rules/daily-use.js(순수)가 하고,
// 여기는 단추와 브라우저 기능(클립보드·Blob·인쇄)만 맡는다. file://에서 동작한다(클립보드가 막히면 고른 글 상자로 대신한다).
import { el } from './dom.js';
import { printHtml } from './doc-output.js';
import { SUMMARY_FAKE_NOTE, summaryFileName, summaryPrintHtml } from '../rules/daily-use.js';

export const SUMMARY_DOWNLOAD_BLOCKED = '내려받기가 막혔습니다. 「복사」로 글을 가져가거나 「인쇄」에서 PDF로 저장할 수 있습니다.';

/** 글을 .txt 파일로 내려받는다(a[download]). 예외가 나면 { ok: false } */
export function downloadText(name, text) {
  let url = null;
  try {
    url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
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

/**
 * @param {{build:()=>string, mapName:string, asOf:string}} o  build: 누를 때마다 지금 글을 만든다(기준이 바뀌었으면 새 글)
 */
export function summaryBar(o) {
  const note = el('div', { 'data-testid': 'summary-extra' });
  // 미리 보기(FU5-3): 복사·내려받기·인쇄될 글 그대로. 열 때마다, 그리고 단추를 누를 때 다시 만든다
  const previewText = el('pre', { 'data-testid': 'summary-preview-text' });
  const preview = el('details', { class: 'summary-preview', 'data-testid': 'summary-preview' }, el('summary', {}, '미리 보기'), previewText);
  const refreshPreview = () => { if (preview.open) previewText.textContent = o.build(); };
  preview.addEventListener('toggle', refreshPreview);
  const copyBtn = el('button', { type: 'button', class: 'small-btn', 'data-testid': 'summary-copy' }, '복사');
  copyBtn.addEventListener('click', async () => {
    const text = o.build();
    refreshPreview();
    note.replaceChildren();
    copyBtn.textContent = '복사';
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = '복사했습니다';
    } catch {
      // 클립보드를 쓸 수 없는 환경(file:// 등): 글 상자를 보여 주고 직접 복사하게 한다
      const box = el('textarea', { rows: 10, readonly: true, class: 'copy-box', 'data-testid': 'summary-copy-box', 'aria-label': '점검 요약 글' }, text);
      note.replaceChildren(box);
      box.focus();
      if (typeof box.select === 'function') box.select();
    }
  });
  const downBtn = el('button', { type: 'button', class: 'small-btn', 'data-testid': 'summary-download' }, '내려받기(.txt)');
  downBtn.addEventListener('click', () => {
    const name = summaryFileName(o.mapName, o.asOf);
    const r = downloadText(name, o.build());
    refreshPreview();
    // 내려받기 알림(FU5-3): 브라우저가 어디에 저장했는지는 앱이 알 수 없으므로 파일 이름만 알린다
    note.replaceChildren(r.ok
      ? el('p', { class: 'muted small', role: 'status', 'data-testid': 'summary-downloaded' }, `「${name}」를 내려받았습니다`)
      : el('p', { class: 'notice', role: 'alert', 'data-testid': 'summary-download-blocked' }, SUMMARY_DOWNLOAD_BLOCKED));
  });
  const printBtn = el('button', { type: 'button', class: 'small-btn', 'data-testid': 'summary-print' }, '인쇄');
  printBtn.addEventListener('click', () => printHtml(summaryPrintHtml(o.build(), `점검 요약 — ${o.mapName}`)));
  return el('div', { class: 'summary-bar', 'data-testid': 'summary-bar' },
    el('div', { class: 'row' }, el('strong', {}, '점검 요약'), copyBtn, downBtn, printBtn),
    el('p', { class: 'muted small' }, `위험·몰림·공백 숫자를 한 장 글로 모읍니다. ${SUMMARY_FAKE_NOTE}`),
    preview,
    note);
}
