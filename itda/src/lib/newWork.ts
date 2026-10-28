// 어느 메뉴에서든 '새 업무 등록' 창을 여는 신호 (창은 Layout에 하나만 둠)
export const NEW_WORK = '__new_work__';
export const openNewWork = () => window.dispatchEvent(new CustomEvent('open-new-work'));
