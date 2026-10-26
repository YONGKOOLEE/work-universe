// 미해결 이슈 보기(R-20, D-22): 「미해결 n건」 한 줄과 목록 화면, 목록의 「해결로 표시」.
// 판정은 rules/issues.js(인수인계 초안의 「진행 중」과 같은 코드)가 한다. 이 파일은 그린다.
// 저장은 main.js가 넘겨 주는 onResolve(gid, 해결 메모)가 한다(app.resolveMemo). 해결 메모는 선택 한 줄(CR-18 D-11): 비우면 기본 내용, 적으면 그 글이 해결됨 메모의 내용.

/** 「해결로 표시」 옆 선택 입력의 이름 */
export const RESOLVE_NOTE_LABEL = '해결 메모(선택)';
/** 「해결로 표시」 앞의 묻는 말(질문형, 사용자 10-26 저녁) */
export const RESOLVE_Q = '이 일이 끝났나요?';

import { MEMO_CATEGORIES, TEXT_MAX, memoCategoryOf } from '../model/schema.js';
import { groupIssues, memoTarget, openMemos } from '../rules/issues.js';
import { openMemosOf } from '../rules/handover.js';
import { displayName } from '../view/describe.js';
import { el } from './dom.js';
import { messageFor } from './messages.js';

/** 목록에 오를 메모. 꼭지(유니버스 개요)면 보이는 모든 메모, 업무면 초안과 같은 범위(rules/handover.js) */
export function issuesFor(view, targetGid, rootGid = null) {
  return targetGid === rootGid ? openMemos(view) : openMemosOf(view, targetGid);
}

/** 「미해결 n건」 한 줄. 0건이면 누를 수 없는 "미해결 0건". onOpen이 없으면 글자만 */
export function issueEntry(view, targetGid, { rootGid = null, onOpen }) {
  const n = issuesFor(view, targetGid, rootGid).length;
  if (!n) return el('p', { class: 'muted small', 'data-testid': 'issue-count', 'data-count': '0' }, '미해결 0건');
  return el('p', { class: 'notice', 'data-testid': 'issue-count', 'data-count': String(n) },
    el('button', { type: 'button', class: 'link', 'data-testid': 'btn-issues', onclick: onOpen }, `미해결 ${n}건`), ' — 아직 해결 표시하지 않은 이슈·진행 중 메모');
}

// 메모가 가리키는 업무 이름. 대상이 없으면 단 주제, 둘 다 없으면 빈 칸
function whereOf(view, ev, currentUniverse) {
  const t = memoTarget(view, ev);
  const node = t ? view.getNode(t) : null;
  const named = node ? displayName(node) : (ev.node_gids.map((g) => view.getNode(g)).filter(Boolean).map(displayName).join('·') || '(대상 없음)');
  return node && node.universe_id !== currentUniverse ? `${named} · ${node.universe_name}` : named;
}

/**
 * 목록 화면.
 * openKey: 펼쳐 둘 업무 묶음(카드에서 왔을 때 그 업무, FU8-15). 없으면 기본(2건 넘는 묶음은 접힘)
 * @param {{view:object, targetGid:string, openKey?:string|null, rootGid?:string, universeId:string, readOnly:boolean, onResolve:(gid:string)=>object, onFocus:(gid:string)=>void, onClose:()=>void}} o
 */
export function issuePanel(o) {
  const { view } = o;
  const memos = issuesFor(view, o.targetGid, o.rootGid || null);
  const target = view.getNode(o.targetGid);
  const wrap = el('div', { 'data-testid': 'issue-panel' });
  const msg = el('p', { class: 'notice', 'data-testid': 'issue-error', hidden: true });
  msg.hidden = true;
  wrap.append(
    el('div', { class: 'row' }, el('h2', {}, `미해결 ${memos.length}건`), el('button', { type: 'button', 'data-testid': 'issue-close', onclick: o.onClose }, '닫기')),
    el('p', { class: 'muted small' }, `${target ? `「${displayName(target)}」에서 ` : ''}아직 끝났다고 표시하지 않은 이슈·진행 중 메모입니다. 끝난 일은 「해결로 표시」를 누르세요 — 같은 대상에 「해결됨」 메모가 새로 더해지고 원래 메모는 그대로 남습니다. 「해결 메모(선택)」에 적은 글이 그 메모의 내용이 됩니다(비우면 「해결: 원래 메모 앞부분」).`),
    msg,
  );
  if (!memos.length) {
    wrap.append(el('p', { class: 'muted', 'data-testid': 'issue-empty' }, '미해결 메모가 없습니다.'));
    return wrap;
  }
  // 대상(업무)별 묶음. 기본은 펼침, ISSUE_GROUP_OPEN_MAX(2)건 넘는 묶음은 접힘(R7-3, C12-13)
  const list = el('div', { 'data-testid': 'issue-list' });
  for (const g of groupIssues(view, memos)) {
    const ul = el('ul', { class: 'issue-list' });
    for (const ev of g.items) {
      const noteInput = o.readOnly ? null : el('input', { type: 'text', maxlength: String(TEXT_MAX), placeholder: RESOLVE_NOTE_LABEL, 'aria-label': RESOLVE_NOTE_LABEL, 'data-testid': 'resolve-note', style: 'flex:1 1 140px;min-width:0' });
      const resolveBtn = o.readOnly ? null : el('button', {
        type: 'button',
        'data-testid': 'btn-resolve',
        onclick: () => {
          const r = o.onResolve(ev.gid, noteInput.value.trim());
          if (r && !r.ok && !(r.error && r.error.already_resolved)) {
            msg.textContent = messageFor(r.error);
            msg.hidden = false;
          }
        },
      }, '해결로 표시');
      ul.append(el('li', { 'data-testid': 'issue-item', 'data-gid': ev.gid },
        el('div', {}, el('span', { class: 'muted small' }, ev.occurred_at), ' ', el('span', { class: 'chip' }, MEMO_CATEGORIES[memoCategoryOf(ev.payload)]),
          g.target ? null : el('span', {}, ` ${whereOf(view, ev, o.universeId)}`)),
        el('div', {}, ev.note || '(내용 없음)'),
        resolveBtn ? el('div', { class: 'row decide-row', 'data-testid': 'resolve-row' }, el('span', { class: 'decide-q', 'data-testid': 'resolve-q' }, RESOLVE_Q), noteInput, resolveBtn) : null));
    }
    const name = g.target ? whereOf(view, g.items[0], o.universeId) : '주제';
    const head = g.target
      ? el('button', { type: 'button', class: 'link', onclick: () => o.onFocus(g.target) }, name)
      : el('span', {}, name);
    list.append(el('details', { class: 'issue-group', 'data-testid': 'issue-group', 'data-target': g.target || 'topics', 'data-count': String(g.items.length), open: g.collapsed && o.openKey !== (g.target || 'topics') ? null : true },
      el('summary', {}, head, el('span', { class: 'muted small' }, ` · ${g.items.length}건`)),
      ul));
  }
  wrap.append(list);
  return wrap;
}
