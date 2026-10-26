// 머리글 「무엇을 할까요?」 기능 찾기 칸(CR-21 A). 검색 계산은 view/feature-index.js(순수), 이 파일은 입력·결과 목록·업무 고르기만 그린다.
// 키보드: 입력 칸에서 Enter = 첫 결과로, ↓ = 결과 목록으로, 목록에서 ↑↓로 옮기고 Enter, Esc = 닫기.
import { el } from './dom.js';

/**
 * @param {{
 *   container: HTMLElement,
 *   search: (q:string) => {id:string,name:string,where:string,blocked:string|null}[],
 *   onGo: (result:object) => (void|{pick:{works:{gid:string,label:string}[], note?:string}}),
 *   onPick: (gid:string, result:object) => void,
 *   records?: (q:string) => {query:string, total:number, rows:object[]},   // 쓴 것 찾기(R11 FU6-4): 기능 결과가 없거나 적을 때 아래에 「기록에서 …」를 더한다
 *   recordFew?: number,                                                    // 기능 결과가 이 수 이하일 때만
 *   onRecord?: (row:object) => void, onRecordsAll?: (q:string) => void,
 * }} o  onGo가 {pick}을 돌려주면 「그래프에서 업무를 먼저 고르세요」와 업무 이름 목록을 보이고, 이름을 누르면 onPick(gid, result)
 */
export function featureFind(o) {
  const input = el('input', { type: 'search', placeholder: '무엇을 할까요? 예: 담당, 미해결, 점검', 'aria-label': '무엇을 할까요?', 'data-testid': 'feature-find', autocomplete: 'off', 'aria-controls': 'feature-find-list' });
  const list = el('ul', { id: 'feature-find-list', class: 'feature-results', 'data-testid': 'feature-find-list', hidden: true, 'aria-label': '기능 찾기 결과' });
  o.container.replaceChildren(input, list);
  let hits = [];

  const close = () => { list.hidden = true; };
  const buttons = () => [...list.querySelectorAll('button')].filter((b) => b.getAttribute('aria-disabled') !== 'true');

  function showPick(result, pick) {
    list.replaceChildren(
      el('li', { class: 'pick-head', role: 'status', 'data-testid': 'feature-find-pick' }, pick.note || '그래프에서 업무를 먼저 고르세요. 아래에서 골라도 됩니다.'),
      ...(pick.works.length
        ? [el('li', {}, el('div', { class: 'pick-list' }, ...pick.works.map((w) => el('button', { type: 'button', class: 'link', 'data-testid': 'feature-find-work', 'data-gid': w.gid, onclick: () => { close(); input.value = ''; o.onPick(w.gid, result); } }, w.label))))]
        : [el('li', { class: 'none' }, '이 지도에는 고를 업무가 없습니다.')]));
    list.hidden = false;
  }

  function choose(result) {
    if (!result || result.blocked) return; // 흐린 결과는 눌러도 가지 않는다(이유가 글로 보인다)
    const r = o.onGo(result);
    if (r && r.pick) return showPick(result, r.pick);
    close();
    input.value = '';
    input.blur();
  }

  const noneRow = (q, quiet) => el('li', { class: quiet ? 'none quiet muted small' : 'none', role: 'status', 'data-testid': 'feature-find-none' }, `찾는 기능 없음: 「${q}」 — 다른 낱말(예: 담당, 미해결, 점검, 글로)로 찾아 보세요`);

  function show() {
    const q = input.value.trim();
    if (!q) {
      hits = [];
      return close();
    }
    hits = o.search(q);
    const rec = o.records && hits.length <= (o.recordFew ?? Infinity) ? o.records(q) : null;
    const recordItems = rec && rec.rows.length ? [
      el('li', { class: 'rec-head', 'data-testid': 'feature-find-records-head' }, `기록에서 「${rec.query}」 ${rec.total}건`),
      ...rec.rows.map((r) => el('li', { class: 'rec-row' }, el('button', { type: 'button', class: 'feature-hit', 'data-testid': 'feature-find-record', 'data-gid': r.gid, onclick: () => { close(); input.value = ''; o.onRecord(r); } },
        el('span', { class: 'feat-name' }, `${r.date} · ${r.target}`),
        el('span', { class: 'feat-where' }, `[${r.kind}] ${r.text}`, r.source_chip ? el('span', { class: 'chip muted small src-chip', 'data-testid': 'feature-find-source-chip' }, r.source_chip) : null),
        el('span', { class: 'feat-go' }, '보기'))))
      , rec.total > rec.rows.length && o.onRecordsAll
        ? el('li', { class: 'rec-more' }, el('button', { type: 'button', class: 'link', 'data-testid': 'feature-find-records-all', onclick: () => { close(); input.value = ''; o.onRecordsAll(q); } }, `외 ${rec.total - rec.rows.length}건 — 기록 표에서 모두 보기`))
        : null,
    ].filter(Boolean) : [];
    list.replaceChildren(...(hits.length
      ? hits.map((h) => el('li', {}, el('button', { type: 'button', class: 'feature-hit', 'data-testid': 'feature-find-result', 'data-id': h.id, 'aria-disabled': h.blocked ? 'true' : null, onclick: () => choose(h) },
        el('span', { class: 'feat-name' }, h.name),
        el('span', { class: 'feat-where' }, h.blocked ? `이 화면에서는 쓸 수 없음(${h.blocked})` : h.where),
        el('span', { class: 'feat-go' }, '바로 가기'))))
      // 기록 결과가 있으면 「찾는 기능 없음」은 보이지 않는다(사용자 2026-10-26 저녁 "찾아지는데 왜 없음이 나와?" — FU7-9의 흐린 줄도 뺌)
      : recordItems.length ? [] : [noneRow(q, false)]).concat(recordItems));
    list.hidden = false;
  }

  input.addEventListener('input', show);
  input.addEventListener('focus', () => { if (input.value.trim()) show(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      if (!hits.length || list.hidden) show();
      choose(hits.find((h) => !h.blocked));
    } else if (e.key === 'ArrowDown' && !list.hidden && buttons().length) {
      e.preventDefault();
      buttons()[0].focus();
    } else if (e.key === 'Escape') {
      e.stopPropagation(); // 화면 전체의 Esc(선택 해제)와 겹치지 않게
      if (!list.hidden) {
        e.preventDefault(); // type=search의 기본 동작(입력 글자 지우기)을 막는다: 목록만 닫고 글자는 남긴다
        close();
      }
    }
  });
  list.addEventListener('keydown', (e) => {
    const bs = buttons();
    const i = bs.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' && i < bs.length - 1) {
      e.preventDefault();
      bs[i + 1].focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (i > 0) bs[i - 1].focus();
      else input.focus();
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      input.focus();
    }
  });
  // 칸 밖을 누르면 닫는다
  document.addEventListener('mousedown', (e) => { if (!o.container.contains(e.target)) close(); });
  return { input, close, focus: () => input.focus() };
}
