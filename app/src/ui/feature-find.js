// 머리글 「무엇을 할까요?」 기능 찾기 칸(CR-21 A). 검색 계산은 view/feature-index.js(순수), 이 파일은 입력·결과 목록·업무 고르기만 그린다.
// 키보드: 입력 칸에서 Enter = 첫 결과로, ↓ = 결과 목록으로, 목록에서 ↑↓로 옮기고 Enter, Esc = 닫기.
import { el } from './dom.js';
import { josa } from '../model/josa.js';

/**
 * @param {{
 *   container: HTMLElement,
 *   search: (q:string) => {id:string,name:string,where:string,blocked:string|null}[],
 *   onGo: (result:object) => (void|{pick:{works:{gid:string,label:string}[], note?:string, onPick?:(gid:string, result:object)=>void}}),   // pick.onPick이 있으면 그것으로(묶은 지도의 「어느 업무 지도에 쓸까요?」, FU8-28)
 *   onPick: (gid:string, result:object) => void,
 *   common?: () => {id:string,name:string,where:string,blocked:string|null}[],   // 빈 칸을 누르면 보이는 「자주 하는 일」(사용자 의견 10-26 저녁)
 *   items?: (q:string) => {query:string, total:number, rows:{gid:string,label:string,type_label:string}[]},   // 지도 안 항목 이름 찾기 — 「지도에서」 묶음
 *   onItem?: (row:object) => void,
 *   records?: (q:string) => {query:string, total:number, rows:object[]},   // 쓴 것 찾기(R11 FU6-4): 기능 결과가 없거나 적을 때 아래에 「기록에서 …」를 더한다
 *   recordFew?: number,                                                    // 기능 결과가 이 수 이하일 때만
 *   onRecord?: (row:object) => void, onRecordsAll?: (q:string) => void,
 * }} o  onGo가 {pick}을 돌려주면 「그래프에서 업무를 먼저 고르세요」와 업무 이름 목록을 보이고, 이름을 누르면 onPick(gid, result)
 */
export const MINE_NONE_TEXT = '아직 직접 쓴 기록이 없습니다 — 「기록」 공간에서 남겨 보세요';

export function featureFind(o) {
  const input = el('input', { type: 'search', placeholder: '무엇을 할까요? 예: 메모 남기기, 대사 확인', 'aria-label': '무엇을 할까요?', 'data-testid': 'feature-find', autocomplete: 'off', 'aria-controls': 'feature-find-list' });
  const list = el('ul', { id: 'feature-find-list', class: 'feature-results', 'data-testid': 'feature-find-list', hidden: true, 'aria-label': '기능 찾기 결과' });
  o.container.replaceChildren(input, list);
  let hits = [];

  const close = () => { list.hidden = true; };
  const buttons = () => [...list.querySelectorAll('button')].filter((b) => b.getAttribute('aria-disabled') !== 'true');

  function showPick(result, pick) {
    list.replaceChildren(
      el('li', { class: 'pick-head', role: 'status', 'data-testid': 'feature-find-pick' }, pick.note || '그래프에서 업무를 먼저 고르세요. 아래에서 골라도 됩니다.'),
      ...(pick.works.length
        ? [el('li', {}, el('div', { class: 'pick-list' }, ...pick.works.map((w) => el('button', { type: 'button', class: 'link', 'data-testid': 'feature-find-work', 'data-gid': w.gid, onclick: () => { close(); input.value = ''; (pick.onPick || o.onPick)(w.gid, result); } }, w.label))))]
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

  // 기능 한 줄(찾기 결과·자주 하는 일 공용)
  const featureRow = (h, testid = 'feature-find-result') => el('li', {}, el('button', { type: 'button', class: 'feature-hit', 'data-testid': testid, 'data-id': h.id, 'aria-disabled': h.blocked ? 'true' : null, onclick: () => choose(h) },
    el('span', { class: 'feat-name' }, h.name),
    el('span', { class: 'feat-where' }, h.blocked ? `이 화면에서는 쓸 수 없음(${h.blocked})` : h.where),
    el('span', { class: 'feat-go' }, '바로 가기')));
  const head = (text, testid) => el('li', { class: 'rec-head', 'data-testid': testid }, text);

  // 자주 하는 일(빈 칸을 눌렀을 때, 그리고 아무것도 못 찾았을 때)
  const commonRows = () => (o.common ? o.common().map((h) => featureRow(h, 'feature-find-common')) : []);

  // 아무것도 안 맞을 때: 못 찾았다고 끝내지 않고 어떻게 치면 되는지 보여 준다
  const noneRows = (q) => [
    el('li', { class: 'none', role: 'status', 'data-testid': 'feature-find-none' }, `「${q}」${josa(q, '은/는')} 못 찾았어요. 이렇게 쳐 보세요 — 하고 싶은 일을 짧게 (예: 메모 남기기, 담당 넘기기, 쓴 것 찾기), 또는 업무·사람 이름 일부 (예: 대사)`),
    ...(o.common ? [head('자주 하는 일', 'feature-find-common-head'), ...commonRows()] : []),
  ];

  function show() {
    const q = input.value.trim();
    if (!q) {
      hits = [];
      if (!o.common) return close();
      list.replaceChildren(head('자주 하는 일', 'feature-find-common-head'), ...commonRows());
      list.hidden = false;
      return undefined;
    }
    hits = o.search(q);
    const found = o.items ? o.items(q) : null;
    const rec = o.records && hits.length <= (o.recordFew ?? Infinity) ? o.records(q) : null;
    // 같은 이름이 지도·기록 두 묶음에 함께 나오면 줄 앞에 출처를 붙인다(FU9-16: 어느 줄이 항목이고 어느 줄이 기록인지)
    const both = !!(found && found.rows.length && rec && rec.rows.length);
    const srcTag = (t) => (both ? el('span', { class: 'chip muted small src-tag', 'data-testid': 'feature-find-src' }, t) : null);
    const itemRows = found && found.rows.length ? [
      head(`지도에서 ${found.total}건`, 'feature-find-items-head'),
      ...found.rows.map((r) => el('li', {}, el('button', { type: 'button', class: 'feature-hit', 'data-testid': 'feature-find-item', 'data-gid': r.gid, onclick: () => { close(); input.value = ''; o.onItem(r); } },
        el('span', { class: 'feat-name' }, srcTag('지도'), r.label),
        el('span', { class: 'feat-where' }, r.type_label),
        el('span', { class: 'feat-go' }, '보기'))))
      , found.total > found.rows.length ? el('li', { class: 'rec-more muted small' }, `외 ${found.total - found.rows.length}건 — 이름을 더 쳐서 좁혀 보세요`) : null,
    ].filter(Boolean) : [];
    const mineNoneRow = rec && rec.mineNone ? [el('li', { class: 'none muted small', role: 'status', 'data-testid': 'feature-find-mine-none' }, MINE_NONE_TEXT)] : [];
    const recordItems = rec && rec.rows.length ? [
      ...mineNoneRow,
      head(rec.mine ? `최근에 내가 직접 쓴 기록 ${rec.total}건` : `기록에서 「${rec.query}」 ${rec.total}건`, 'feature-find-records-head'),
      ...rec.rows.map((r) => el('li', { class: 'rec-row' }, el('button', { type: 'button', class: 'feature-hit', 'data-testid': 'feature-find-record', 'data-gid': r.gid, onclick: () => { close(); input.value = ''; o.onRecord(r); } },
        el('span', { class: 'feat-name' }, srcTag('기록'), `${r.date} · ${r.target}`),
        el('span', { class: 'feat-where' }, `[${r.kind}] ${r.text}`, r.source_chip ? el('span', { class: 'chip muted small src-chip', 'data-testid': 'feature-find-source-chip' }, r.source_chip) : null),
        el('span', { class: 'feat-go' }, '보기'))))
      , rec.total > rec.rows.length && o.onRecordsAll
        ? el('li', { class: 'rec-more' }, el('button', { type: 'button', class: 'link', 'data-testid': 'feature-find-records-all', onclick: () => { close(); input.value = ''; o.onRecordsAll(q); } }, `외 ${rec.total - rec.rows.length}건 — 기록 표에서 모두 보기`))
        : null,
    ].filter(Boolean) : [];
    // 순서: 기능 → 지도에서(항목) → 기록에서. 기능 묶음은 다른 묶음이 같이 있을 때만 머리글을 단다
    const featureItems = hits.map((h) => featureRow(h));
    const several = itemRows.length > 0 || recordItems.length > 0;
    if (!recordItems.length && mineNoneRow.length) recordItems.push(...mineNoneRow);
    // 아무것도 안 맞으면 「못 찾았어요 + 이렇게 쳐 보세요 + 자주 하는 일」(사용자 2026-10-26 저녁 "찾아지는데 왜 없음이 나와?"도 그대로: 기록·항목이 하나라도 있으면 이 안내는 없다)
    const empty = !hits.length && !itemRows.length && !recordItems.length;
    list.replaceChildren(...(empty ? noneRows(q) : [
      ...(hits.length && several ? [head('할 수 있는 일', 'feature-find-features-head')] : []),
      ...featureItems, ...itemRows, ...recordItems,
    ]));
    list.hidden = false;
    return undefined;
  }

  input.addEventListener('input', show);
  input.addEventListener('focus', () => show()); // 빈 칸이면 「자주 하는 일」
  input.addEventListener('click', () => { if (list.hidden) show(); }); // Esc로 닫은 뒤 다시 눌러도 보인다
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      if (!input.value.trim()) { // 빈 칸에서 Enter: 자주 하는 일 목록으로 내려가 고르게 한다(실수로 바로 실행하지 않음)
        if (list.hidden) show();
        if (buttons()[0]) buttons()[0].focus();
        return;
      }
      if (!hits.length || list.hidden) show();
      const usable = hits.find((h) => !h.blocked);
      if (usable) return choose(usable);
      const item = list.querySelector('[data-testid=feature-find-item]'); // 기능은 없고 항목 이름만 맞으면 그 첫 항목으로
      if (item) item.click();
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
