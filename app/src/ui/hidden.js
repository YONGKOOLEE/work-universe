// 숨긴 노드 되살리기(R-21, D-23): 개요의 「숨긴 노드 n개」 한 줄과 목록 화면, 목록의 「되살리기」.
// 목록은 rules/hidden.js가 만들고, 저장은 main.js가 넘겨 주는 onRestore(app.restoreNode)가 한다.

import { el } from './dom.js';
import { messageFor } from './messages.js';

/** 「숨긴 노드 n개」 한 줄. 0개면 아무것도 그리지 않는다(null) */
export function hiddenEntry(nodes, { onOpen }) {
  if (!nodes.length) return null;
  return el('p', { class: 'notice', 'data-testid': 'hidden-count', 'data-count': String(nodes.length) },
    el('button', { type: 'button', class: 'link', 'data-testid': 'btn-hidden', onclick: onOpen }, `숨긴 노드 ${nodes.length}개`), ' 그래프에서 숨긴 노드를 다시 보이게 할 수 있습니다');
}

/**
 * 목록 화면.
 * @param {{nodes:{id:string,label:string,type_label:string,hidden_at:string}[], readOnly:boolean, labelOf:(id:string)=>string, onRestore:(id:string)=>object, onPurge?:(id:string)=>object, onClose:()=>void}} o
 */
export function hiddenPanel(o) {
  const wrap = el('div', { 'data-testid': 'hidden-panel' });
  const msg = el('p', { class: 'notice', 'data-testid': 'hidden-error', hidden: true });
  wrap.append(
    el('div', { class: 'row' }, el('h2', {}, `숨긴 노드 ${o.nodes.length}개`), el('button', { type: 'button', 'data-testid': 'hidden-close', onclick: o.onClose }, '닫기')),
    el('p', { class: 'muted small' }, '「되살리기」를 누르면 노드가 그래프에 다시 나타나고, 숨기기 전의 연결과 이력이 그대로 보입니다. 이력에는 「되살림」이 한 줄 남습니다. 필요 없는 노드는 「완전히 삭제」로 지울 수 있습니다(되돌릴 수 없음).'),
    msg,
  );
  if (!o.nodes.length) {
    wrap.append(el('p', { class: 'muted', 'data-testid': 'hidden-empty' }, '숨긴 노드가 없습니다.'));
    return wrap;
  }
  const ul = el('ul', { class: 'issue-list', 'data-testid': 'hidden-list' });
  for (const n of o.nodes) {
    const restoreBtn = o.readOnly ? null : el('button', {
      type: 'button',
      'data-testid': 'btn-restore',
      onclick: () => {
        const r = o.onRestore(n.id);
        if (r && !r.ok) {
          const dup = r.error && r.error.existing_id ? o.labelOf(r.error.existing_id) : '';
          msg.textContent = `${messageFor(r.error)}${dup ? ` 같은 이름의 보이는 노드: 「${dup}」. 그 노드를 고치거나 이름을 바꾼 뒤 다시 시도하세요.` : ''}`;
          msg.dataset.code = r.error.code;
          msg.hidden = false;
        }
      },
    }, '되살리기');
    const purgeBtn = o.readOnly || !o.onPurge ? null : el('button', {
      type: 'button',
      class: 'danger',
      'data-testid': 'btn-purge',
      onclick: () => {
        const r = o.onPurge(n.id);
        if (r && !r.ok) {
          msg.textContent = messageFor(r.error);
          msg.dataset.code = r.error.code;
          msg.hidden = false;
        }
      },
    }, '완전히 삭제');
    ul.append(el('li', { 'data-testid': 'hidden-item', 'data-id': n.id },
      el('div', {}, el('span', { class: 'chip' }, n.type_label), ' ', el('strong', {}, n.label), ' ', n.hidden_at ? el('span', { class: 'muted small' }, `${n.hidden_at}에 숨김`) : null),
      el('div', { class: 'row' }, restoreBtn, purgeBtn)));
  }
  wrap.append(ul);
  return wrap;
}
