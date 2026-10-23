// 생성 방식 설정(R-15, 12.4 wu:v1:settings). 공급자를 고른다. 「Claude API」를 고르면 키·모델 칸이 나타난다(CR-15, 키는 이 브라우저에만).
import { DEFAULT_LLM_MODEL, PROVIDERS } from '../llm/providers.js';
import { LABEL_MAX } from '../model/schema.js';
import { API_KEY_MAX, LLM_MODEL_MAX } from '../store/local.js';
import { el } from './dom.js';
import { KEY_NOTE, PREGEN_CHECK, PREGEN_WHAT } from './ai-notes.js';

/**
 * @param {{current:string, authorName?:string, onAuthorName:(v:string)=>void, persisted:boolean, showCheckTools?:boolean, onChange:(name:string)=>void, onClose:()=>void,
 *   apiKey?:string, llmModel?:string, onApiKey?:(v:string)=>void, onLlmModel?:(v:string)=>void, onClearKey?:()=>void}} o
 *   persisted: 저장소를 쓸 수 있는지(없으면 이번 화면에서만 유지)
 *   apiKey·llmModel·onApiKey·onLlmModel·onClearKey: 「Claude API」를 골랐을 때 보이는 키·모델 칸(CR-15)
 */
// 화면에서만 바꾸는 부분(llm/providers.js는 그대로): 「사내 LLM」은 맨 아래로(FU-25), 사전 생성 설명은 실시간이 아닌 "써 둔 문장"임을 그대로 쓴다(FU-24)
const HELP_OVERRIDE = { pregen: ['기본값. ', PREGEN_WHAT, ' ', PREGEN_CHECK, ' 내가 새로 만든 지도 등 받아 둔 문장이 없는 항목은 규칙 기반 문장으로 보입니다.'].join('') };
/** 설정 화면에 보일 공급자 순서: 사내 LLM만 맨 아래로(나머지는 PROVIDERS 순서 그대로) */
export const displayProviders = (all) => [...all.filter((p) => p.name !== 'internal'), ...all.filter((p) => p.name === 'internal')];

export function settingsPanel(o) {
  const list = el('div', { class: 'settings-list', role: 'radiogroup', 'data-testid': 'settings-providers' },
    // 「실패 흉내」는 개발 점검용이라 점검 주소(?check)에서만 보인다(여섯 번째 검토 U-13)
    ...displayProviders(PROVIDERS).filter((p) => p.name !== 'fail' || o.showCheckTools).map((p) => {
      const input = el('input', { type: 'radio', name: 'provider', value: p.name, checked: p.name === o.current, 'data-testid': `provider-${p.name}` });
      input.addEventListener('change', () => { o.onChange(p.name); syncKeyBox(p.name); });
      return el('label', { class: 'setting' }, input, el('span', {}, el('strong', {}, p.label), el('span', { class: 'muted small' }, HELP_OVERRIDE[p.name] || p.help)));
    }));
  const authorInput = el('input', { type: 'text', maxlength: String(LABEL_MAX), value: o.authorName || '', placeholder: '사용자(이 브라우저)', 'aria-label': '작성자 이름', 'data-testid': 'settings-author' });
  authorInput.addEventListener('change', () => o.onAuthorName(authorInput.value));
  // 「Claude API」를 고를 때만 키·모델 칸을 만든다(다른 방식에서는 화면에 아무것도 없다)
  let keyBox = null;
  const keyBoxFor = () => {
    const keyInput = el('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', maxlength: String(API_KEY_MAX), value: o.apiKey || '', placeholder: '키를 붙여 넣으세요', 'aria-label': 'API 키', 'data-testid': 'settings-apikey' });
    const modelInput = el('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: String(LLM_MODEL_MAX), value: o.llmModel || '', placeholder: DEFAULT_LLM_MODEL, 'aria-label': '모델', 'data-testid': 'settings-model' });
    const status = el('p', { class: 'muted small', 'aria-live': 'polite', 'data-testid': 'settings-key-status' });
    const showStatus = (hasKey) => { status.textContent = hasKey ? '키가 입력되어 있습니다. 초안과 인사이트 설명을 실시간으로 다듬습니다.' : '키가 없습니다. 미리 받아 둔 문장(사전 생성)으로, 없으면 기록을 그대로 모은 문장(규칙 기반)으로 보여 줍니다.'; };
    showStatus(!!(o.apiKey && o.apiKey.trim()));
    const sendKey = () => { if (o.onApiKey) o.onApiKey(keyInput.value); showStatus(!!keyInput.value.trim()); };
    keyInput.addEventListener('input', sendKey);
    keyInput.addEventListener('change', sendKey);
    modelInput.addEventListener('change', () => { if (o.onLlmModel) o.onLlmModel(modelInput.value); });
    const clear = el('button', { type: 'button', 'data-testid': 'settings-clear-key' }, '키 지우기');
    clear.addEventListener('click', () => {
      keyInput.value = '';
      if (o.onClearKey) o.onClearKey();
      showStatus(false);
    });
    return el('div', { class: 'settings-key', 'data-testid': 'settings-key-box' },
      el('h3', {}, 'Claude API'),
      el('p', { class: 'muted small', 'data-testid': 'settings-key-note' }, KEY_NOTE),
      el('label', { class: 'field' }, el('span', {}, 'API 키'), keyInput),
      el('label', { class: 'field' }, el('span', {}, '모델'), modelInput),
      el('p', { class: 'muted small' }, `비워 두면 ${DEFAULT_LLM_MODEL}을(를) 씁니다.`),
      el('div', { class: 'row' }, clear),
      status);
  };
  const syncKeyBox = (name) => {
    if (name === 'claude_api' && !keyBox) {
      keyBox = keyBoxFor();
      list.after(keyBox);
    } else if (name !== 'claude_api' && keyBox) {
      keyBox.remove();
      keyBox = null;
    }
  };
  const root = el('div', { class: 'settings', 'data-testid': 'settings' },
    el('h2', {}, '설정'),
    el('h3', {}, '생성 방식'),
    el('p', { class: 'muted small' }, '인수인계 초안 문장과 인사이트 설명을 어떻게 만들지 고릅니다. 어느 방식이든 계산(근거 찾기)은 규칙으로 하고, 근거가 확인되지 않는 문장은 쓰지 않습니다.'),
    list,
    el('h3', {}, '작성자 이름'),
    el('p', { class: 'muted small' }, '인수인계 확정자와 통합 확인 목록에서 「같음/다름」을 정한 기록에 이 이름이 쓰입니다. 비워 두면 「사용자(이 브라우저)」로 기록합니다. 로그인이 아니며 이 브라우저에만 저장됩니다(누구나 바꿀 수 있음).'),
    authorInput,
    o.persisted ? null : el('p', { class: 'notice' }, '브라우저 저장소를 쓸 수 없어 이 설정은 새로고침하면 사라집니다.'),
    el('div', { class: 'row' }, el('button', { type: 'button', onclick: o.onClose, 'data-testid': 'settings-close' }, '닫기')),
  );
  syncKeyBox(o.current);
  return root;
}
