// 이력(이벤트) 근거 칩의 이름. 같은 날 이력이 여러 건이어도 구분되도록 날짜와 내용 앞부분을 쓴다(검토3 UI-8).
import { eventText } from '../view/describe.js';

const MAX = 18;

export function eventChipLabel(view, ev) {
  const text = eventText(view, ev).replace(/\s+/g, ' ').trim();
  return `${ev.occurred_at} ${text.length > MAX ? `${text.slice(0, MAX)}…` : text}`;
}
