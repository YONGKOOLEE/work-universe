// 생성 방식 설정(R-15, 12.4 wu:v1:settings). 공급자를 고른다. 키 입력은 없다(Claude API는 P2, 1차 제출 범위 밖).
import { PROVIDERS } from '../llm/providers.js';
import { el } from './dom.js';

/**
 * @param {{current:string, persisted:boolean, onChange:(name:string)=>void, onClose:()=>void}} o
 *   persisted: 저장소를 쓸 수 있는지(없으면 이번 화면에서만 유지)
 */
export function settingsPanel(o) {
  const list = el('div', { class: 'settings-list', role: 'radiogroup', 'data-testid': 'settings-providers' },
    ...PROVIDERS.map((p) => {
      const input = el('input', { type: 'radio', name: 'provider', value: p.name, checked: p.name === o.current, 'data-testid': `provider-${p.name}` });
      input.addEventListener('change', () => o.onChange(p.name));
      return el('label', { class: 'setting' }, input, el('span', {}, el('strong', {}, p.label), el('span', { class: 'muted small' }, p.help)));
    }));
  return el('div', { class: 'settings', 'data-testid': 'settings' },
    el('h2', {}, '생성 방식'),
    el('p', { class: 'muted small' }, '인수인계 초안 문장과 인사이트 설명을 어떻게 만들지 고릅니다. 어느 방식이든 계산(근거 찾기)은 규칙으로 하고, 근거가 확인되지 않는 문장은 쓰지 않습니다.'),
    list,
    o.persisted ? null : el('p', { class: 'notice' }, '브라우저 저장소를 쓸 수 없어 이 설정은 새로고침하면 사라집니다.'),
    el('div', { class: 'row' }, el('button', { type: 'button', onclick: o.onClose, 'data-testid': 'settings-close' }, '닫기')),
  );
}
