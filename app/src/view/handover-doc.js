// 인수인계서 내려받기·인쇄용 HTML 만들기(R-19 CR-12 A, D-21). DOM·저장소를 쓰지 않는 순수 함수.
// 파일 하나(외부 파일·스크립트 없음). 사용자 입력 글은 모두 이스케이프한다.

const METHOD_LABELS = { rule: '규칙 기반', pregen: '사전 생성(개발 시 Claude로 작성)', llm: 'Claude API(실시간)' };
const ITEM_METHOD = { rule: '규칙 기반', pregen: '사전 생성', llm: 'Claude API' };
export const DOC_SUFFIX = '인수인계서';

export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const safe = (s) => String(s ?? '').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60);

/** 파일 이름: 날짜-대상-인수인계서(초안|확정).html. 파일 이름에 못 쓰는 글자는 _ */
export function handoverFileName({ date, target, confirmed }) {
  return `${[safe(date), safe(target)].filter(Boolean).join('-')}-${DOC_SUFFIX}(${confirmed ? '확정' : '초안'}).html`;
}

/** 확정본 노드 → 파일 이름 재료(날짜는 확정 시각, 대상은 이름에서 날짜·꼬리 제거) */
export function confirmedNameParts(node) {
  const a = node.attrs || {};
  const day = (s) => (/^\d{4}-\d{2}-\d{2}/.exec(String(s || '')) || [''])[0];
  const date = day(a['확정 시각']) || day(node.label); // 날짜를 알 수 없으면 비운다(파일 이름에서 빠짐)
  const target = String(node.label || '').replace(/^\d{4}-\d{2}-\d{2}\s+/, '').replace(/\s*\(\d+\)$/, '').replace(/\s*인수인계서$/, '');
  return { date, target: target || node.label || '' };
}

/** 확정본 본문: 설명 + 「본문(이어서 N)」을 N 순서대로 이어 붙인다 */
export function confirmedBody(node) {
  const a = node.attrs || {};
  const parts = Object.keys(a)
    .map((k) => ({ k, m: /^본문\(이어서 (\d+)\)$/.exec(k) }))
    .filter((x) => x.m)
    .sort((x, y) => Number(x.m[1]) - Number(y.m[1]))
    .map((x) => String(a[x.k]));
  return [String(node.description || ''), ...parts].join('');
}

const CSS = `
@page { size: A4 portrait; margin: 18mm 16mm; }
* { box-sizing: border-box; }
body { font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; color: #111; line-height: 1.6; max-width: 800px; margin: 24px auto; padding: 0 16px; font-size: 14px; }
h1 { font-size: 20px; margin: 0 0 6px; }
h2 { font-size: 15px; margin: 18px 0 4px; border-bottom: 1px solid #999; padding-bottom: 2px; break-after: avoid; }
.badge { display: inline-block; border: 1px solid #333; border-radius: 3px; padding: 0 6px; font-size: 12px; margin-right: 6px; }
.meta { color: #444; font-size: 12px; margin: 2px 0; }
.chip { font-size: 11px; color: #444; border: 1px solid #aaa; border-radius: 3px; padding: 0 4px; margin-left: 6px; white-space: nowrap; }
.muted { color: #555; }
.ev { font-size: 12px; color: #444; }
section { break-inside: avoid; }
li { margin: 2px 0; }
pre { white-space: pre-wrap; word-break: break-word; font-family: inherit; margin: 8px 0; }
.foot { margin-top: 24px; font-size: 12px; color: #444; border-top: 1px solid #999; padding-top: 6px; }
@media print { body { margin: 0; max-width: none; padding: 0; } }
`;

const page = (title, body) => `<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${CSS}</style></head><body>\n${body}\n</body></html>\n`;

function draftBody(draft, labelOf) {
  const name = (g) => { const v = labelOf ? labelOf(g) : null; return v == null || v === '' ? String(g) : String(v); };
  const out = [`<h1><span class="badge">초안</span>${escapeHtml(draft.title)}</h1>`, `<p class="meta">생성 방식: ${escapeHtml(METHOD_LABELS[draft.method] || draft.method)}</p>`];
  for (const i of draft.items || []) {
    const chip = !i.insufficient ? `<span class="chip">${escapeHtml(ITEM_METHOD[i.method || 'rule'] || i.method)}</span>` : '';
    out.push(`<section><h2>${escapeHtml(i.title)}${chip}</h2>`);
    if (i.insufficient) {
      out.push(i.empty_reason ? `<p class="muted">해당 없음 — ${escapeHtml(i.empty_reason)}</p>` : '<p class="muted">이력 부족 — 근거가 되는 기록이 없어 내용을 만들지 않았습니다.</p>');
    } else {
      out.push('<ul>');
      for (const s of i.sentences || []) {
        const ev = (s.evidence_ids || []).map(name);
        out.push(`<li>${escapeHtml(s.text)}${ev.length ? `<div class="ev">근거: ${ev.map(escapeHtml).join(' · ')}</div>` : ''}</li>`);
      }
      out.push('</ul>');
    }
    out.push('</section>');
  }
  out.push('<p class="foot">※ 축적된 이력으로 만든 초안입니다. 담당자가 확인하고 확정하세요.</p>');
  return { title: draft.title, body: out.join('\n') };
}

function confirmedHtml(node) {
  const a = node.attrs || {};
  const rows = ['보내는 사람', '받는 사람', '확정자', '확정 시각', '초안 생성 방식'].filter((k) => a[k]).map((k) => `<p class="meta">${escapeHtml(k)}: ${escapeHtml(a[k])}</p>`);
  const body = [`<h1><span class="badge">확정</span>${escapeHtml(node.label)}</h1>`, ...rows, `<pre>${escapeHtml(confirmedBody(node))}</pre>`,
    '<p class="foot">※ 축적된 이력으로 만든 초안을 담당자가 확인하고 확정한 인수인계서입니다.</p>'].join('\n');
  return { title: node.label, body };
}

/**
 * @param {{kind:'draft', draft:object, labelOf?:(gid:string)=>string} | {kind:'confirmed', node:object}} input
 * @returns {string} 완전한 HTML
 */
export function handoverDocHtml(input) {
  const r = input.kind === 'confirmed' ? confirmedHtml(input.node) : draftBody(input.draft, input.labelOf);
  return page(r.title, r.body);
}
