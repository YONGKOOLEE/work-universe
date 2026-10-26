// 작업 공간 메뉴(왼쪽 세로 5개 단추)와 인수인계·매주 점검 공간의 목록 상자(CR-22 W). 내용 계산은 view/workspace.js, 어느 공간이 무엇을 보이는지는 main.js·detail.js가 정한다.
import { el } from './dom.js';
import { WORKSPACES } from '../view/workspace.js';

const BADGE_TITLE = { record: (n) => `미해결 ${n}건`, check: (n) => `혼자만 아는 일 ${n}개` };

/**
 * 메뉴를 그린다. 같은 단추를 다시 만들어 끼우므로 부를 때마다 처음부터 그린다(눌림 표시·배지가 늘 지금 값).
 * @param {HTMLElement} nav
 * @param {{current:string, badges:Record<string,number|null>, onPick:(key:string)=>void}} o
 */
export function renderWorkspaceNav(nav, o) {
  // 키보드로 단추를 눌러 다시 그려져도 초점이 사라지지 않게 같은 공간의 새 단추로 옮긴다
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  const keep = active && active.dataset && nav.contains(active) ? active.dataset.space : null;
  let byKey = false;
  nav.replaceChildren(...WORKSPACES.map((w) => {
    const n = o.badges ? o.badges[w.key] : null;
    return el('button', {
      type: 'button',
      class: 'ws-btn',
      'data-testid': w.testid,
      'data-space': w.key,
      'aria-pressed': String(o.current === w.key),
      'aria-current': o.current === w.key ? 'page' : null, // 현재 공간을 스크린리더에도(X-40)
      title: n && BADGE_TITLE[w.key] ? `${w.desc} — ${BADGE_TITLE[w.key](n)}` : w.desc,
      // 배지의 뜻을 스크린리더에도(R11 FU6-16): 「기록, 미해결 3건」
      'aria-label': n && BADGE_TITLE[w.key] ? `${w.label}, ${BADGE_TITLE[w.key](n)}` : null,
      // 키보드(Enter·Space)로 눌렀는지 알려 준다 — 키보드일 때만 공간 첫 화면으로 초점을 옮긴다(R12 FU7-8). 마우스·프로그램 click은 false
      onkeydown: (e) => { byKey = e.key === 'Enter' || e.key === ' '; },
      onmousedown: () => { byKey = false; },
      onclick: () => { const k = byKey; byKey = false; o.onPick(w.key, k); },
    }, el('span', { class: 'ws-label' }, w.label), n ? el('span', { class: 'ws-badge', 'data-testid': `ws-badge-${w.key}`, title: BADGE_TITLE[w.key] ? BADGE_TITLE[w.key](n) : null }, String(n)) : null);
  }));
  if (keep) {
    const again = [...nav.children].find((b) => b.dataset.space === keep);
    if (again && typeof again.focus === 'function') again.focus({ preventScroll: true });
  }
}

/** 목록 상자 하나: 제목(개수) + 줄들. total이 null이면 셀 수 없음, 0이면 없음 문구 */
function listBox(testid, title, { total, rows, unit, lack, none, more }, rowEl) {
  const head = total === null ? `${title} — ${lack}` : total === 0 ? `${title} — ${none}` : `${title} ${total}${unit}`;
  return el('div', { class: 'ws-list', 'data-testid': testid, 'data-total': total === null ? '' : String(total) },
    el('p', { class: 'small' }, el('strong', {}, head)),
    rows.length ? el('ul', { class: 'ws-rows' }, ...rows.map(rowEl)) : null,
    total !== null && total > rows.length ? el('p', { class: 'muted small' }, `외 ${total - rows.length}${unit} — ${more}`) : null);
}

const pick = (onSelect, gid, text, testid) => el('button', { type: 'button', class: 'link', 'data-testid': testid, 'data-gid': gid, title: '이 항목의 카드를 엽니다', onclick: () => onSelect(gid) }, text);

/** 인수인계 공간: 담당 공백 업무(최대 5) */
export function gapBox(g, onSelect) {
  return listBox('ws-gaps', '담당 공백 업무', { ...g, unit: '개', lack: '담당(수행) 기록이 부족해 셀 수 없음', none: '없음', more: '「매주 점검」의 인사이트 「밀집·공백」 탭에서 모두 봅니다' },
    (r) => el('li', { 'data-testid': 'ws-gap-row' }, pick(onSelect, r.gid, r.label, 'ws-gap-pick'), el('span', { class: 'muted small' }, ` ${r.text}`)));
}

/** 인수인계 공간·매주 점검(묶지 않은 지도): 혼자만 아는 일 상위 5 */
export function soloBox(sg, onSelect) {
  return listBox('ws-solo', '혼자만 아는 일', { ...sg, unit: '개', lack: '담당(수행) 기록이 부족해 셀 수 없음', none: '없음', more: '「매주 점검」의 인사이트 「인수인계 위험」 탭에서 모두 봅니다' },
    (r) => el('li', { 'data-testid': 'ws-solo-row', 'data-level': r.level },
      pick(onSelect, r.work_gid, r.work, 'ws-solo-pick'), el('span', { class: 'muted small' }, ' — '),
      // 사람 이름은 눌러서 그 사람 카드를 연다(R11 FU6-8: 위험 목록에서 바로 연락처·맡은 업무를 보게)
      el('button', { type: 'button', class: 'link', 'data-testid': 'ws-solo-person', 'data-gid': r.person_gid, title: '이 사람의 카드를 엽니다', onclick: () => onSelect(r.person_gid) }, r.person),
      el('span', { class: 'muted small' }, `만 해 봄 · ${r.text}`)));
}

/** 매주 점검(묶지 않은 지도): 일이 몰린 사람 상위 5 */
export function denseBox(dg, onSelect) {
  return listBox('ws-dense', '일 몰린 사람', { ...dg, unit: '명', lack: '담당(수행) 기록이 부족해 셀 수 없음', none: '없음', more: '「밀집·공백」 탭에서 모두 봅니다' },
    (r) => el('li', { 'data-testid': 'ws-dense-row' }, pick(onSelect, r.gid, r.label, 'ws-dense-pick'), el('span', { class: 'muted small' }, ` 지금 맡은 업무 ${r.count}개`)));
}

/** 인수인계 공간: 최근 확정한 인수인계서(최대 3). 누르면 그 산출물이 골라진다(내려받기·인쇄는 카드에서) */
export function docsBox(docs, onSelect) {
  return el('div', { class: 'ws-list', 'data-testid': 'ws-docs' },
    el('p', { class: 'small' }, el('strong', {}, '최근 확정한 인수인계서')),
    docs.length
      ? el('ul', { class: 'ws-rows' }, ...docs.map((d) => el('li', { 'data-testid': 'ws-doc-row' }, pick(onSelect, d.gid, d.label, 'ws-doc-pick'), d.date ? el('span', { class: 'muted small' }, ` ${d.date}`) : null)))
      : el('p', { class: 'muted small', 'data-testid': 'ws-docs-empty' }, '아직 확정한 인수인계서가 없습니다 — 「인수인계 초안 만들기」에서 확정하면 여기에 보입니다'));
}
