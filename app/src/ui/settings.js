// 생성 방식 설정(R-15, 12.4 wu:v1:settings). 공급자를 고른다. 키 입력은 없다(Claude API는 다음 단계).
import { PROVIDERS } from '../llm/providers.js';
import { LABEL_MAX } from '../model/schema.js';
import { el } from './dom.js';

/**
 * @param {{current:string, authorName?:string, onAuthorName:(v:string)=>void, persisted:boolean, showCheckTools?:boolean, onChange:(name:string)=>void, onClose:()=>void}} o
 *   persisted: 저장소를 쓸 수 있는지(없으면 이번 화면에서만 유지)
 */
export function settingsPanel(o) {
  const list = el('div', { class: 'settings-list', role: 'radiogroup', 'data-testid': 'settings-providers' },
    // 「실패 흉내」는 개발 점검용이라 점검 주소(?check)에서만 보인다(여섯 번째 검토 U-13)
    ...PROVIDERS.filter((p) => p.name !== 'fail' || o.showCheckTools).map((p) => {
      const input = el('input', { type: 'radio', name: 'provider', value: p.name, checked: p.name === o.current, 'data-testid': `provider-${p.name}` });
      input.addEventListener('change', () => o.onChange(p.name));
      return el('label', { class: 'setting' }, input, el('span', {}, el('strong', {}, p.label), el('span', { class: 'muted small' }, p.help)));
    }));
  const authorInput = el('input', { type: 'text', maxlength: String(LABEL_MAX), value: o.authorName || '', placeholder: '사용자(이 브라우저)', 'aria-label': '작성자 이름', 'data-testid': 'settings-author' });
  authorInput.addEventListener('change', () => o.onAuthorName(authorInput.value));
  return el('div', { class: 'settings', 'data-testid': 'settings' },
    el('h2', {}, '생성 방식'),
    el('p', { class: 'muted small' }, '인수인계 초안 문장과 인사이트 설명을 어떻게 만들지 고릅니다. 어느 방식이든 계산(근거 찾기)은 규칙으로 하고, 근거가 확인되지 않는 문장은 쓰지 않습니다.'),
    list,
    el('h2', {}, '작성자 이름'),
    el('p', { class: 'muted small' }, '인수인계 확정자와 통합 확인 목록에서 「같음/다름」을 정한 기록에 이 이름이 쓰입니다. 비워 두면 「사용자(이 브라우저)」로 기록합니다. 로그인이 아니며 이 브라우저에만 저장됩니다(누구나 바꿀 수 있음).'),
    authorInput,
    o.persisted ? null : el('p', { class: 'notice' }, '브라우저 저장소를 쓸 수 없어 이 설정은 새로고침하면 사라집니다.'),
    el('div', { class: 'row' }, el('button', { type: 'button', onclick: o.onClose, 'data-testid': 'settings-close' }, '닫기')),
  );
}
