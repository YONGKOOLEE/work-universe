// 성공 알림 자리(CR-22 F): 오른쪽 패널 맨 위에 붙어 스크롤과 무관하게 보이는 알림 줄 하나. 몇 초 뒤 사라지거나 「닫기」로 닫는다.
// 문구·대상은 view/record-form.js의 successNotice가 정한다. 여기서는 그린다.
import { NOTICE_LONG_MS, NOTICE_MS } from '../view/record-form.js';
import { el } from './dom.js';

/**
 * @param {HTMLElement} slot 패널 맨 위의 알림 자리(aside의 직접 자식이어야 sticky가 먹는다)
 * @param {{onGo:(goto:object)=>void, topOffset?:()=>number}} o
 */
export function createNotices(slot, o) {
  let timer = null;
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    slot.replaceChildren();
  };
  /**
   * @param {{testid:string, text:string, goto:object|null, long?:boolean, goLabel?:string}} n
   */
  const show = (n) => {
    clear();
    if (!n || !n.text) return;
    // 따라 하기 카드가 같은 자리에 붙어 있으면 그 아래로 내린다
    if (o.topOffset) slot.style.top = `${-16 + o.topOffset()}px`;
    const go = n.goto
      ? el('button', {
        type: 'button', class: 'link', 'data-testid': n.goto.type === 'history' ? 'goto-history' : 'goto-notice',
        title: n.goto.type === 'history' ? '그 업무의 이력에서 방금 기록한 줄로 갑니다' : '그 항목으로 갑니다',
        onclick: () => { clear(); o.onGo(n.goto); },
      }, n.goLabel || '거기로 가기')
      : null;
    const card = el('div', { class: 'ok-notice notice-card', role: 'status', 'data-testid': n.testid },
      el('span', { class: 'notice-text' }, n.text), ' ', go,
      el('button', { type: 'button', class: 'small-btn notice-x', 'data-testid': 'notice-close', 'aria-label': '알림 닫기', onclick: clear }, '닫기'));
    slot.append(card);
    const ms = n.long ? NOTICE_LONG_MS : NOTICE_MS;
    timer = setTimeout(clear, ms);
    // 읽는 중(마우스를 올리거나 초점이 안에 있음)에는 사라지지 않는다
    // 떠나면(마우스가 나가거나 초점이 밖으로) 시간을 다시 건다(R11 RV11C-6: 한 번 올리면 영영 안 사라지던 것)
    const hold = () => { if (timer) clearTimeout(timer); timer = null; };
    const rearm = () => { hold(); timer = setTimeout(clear, ms); };
    card.addEventListener('mouseenter', hold);
    card.addEventListener('focusin', hold);
    card.addEventListener('mouseleave', () => { if (!card.contains(document.activeElement)) rearm(); });
    card.addEventListener('focusout', (e) => { if (!card.contains(e.relatedTarget)) rearm(); });
  };
  return { show, clear };
}
