// 테스트 전용 아주 작은 DOM 흉내(ui/dom.js의 el()과 ui 패널의 기본 동작만 돌린다). 실제 브라우저 점검(tools/browser-check.mjs)을 대신하지 않는다.
// 지원: createElement, setAttribute/getAttribute, className/classList.add, dataset, append/prepend/replaceChildren/childNodes,
//   isConnected(문서 body까지 이어져 있는가), addEventListener + fire(type), textContent, querySelector(All)(`tag`, `[data-testid=x]`, `[data-testid^=x]`, 공백으로 이은 자손)
//   disabled·hidden·value·selected·checked는 속성을 주면 같은 이름의 프로퍼티가 됨.

const PROPS = new Set(['disabled', 'hidden', 'selected', 'checked', 'value']);

class FakeText {
  constructor(text) {
    this.nodeType = 3;
    this.data = String(text);
    this.parentNode = null;
  }

  get textContent() { return this.data; }
}

export class FakeEl {
  constructor(tag) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.attrs = new Map();
    this.dataset = {};
    this.childNodes = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.className = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.focused = false;
    this.classList = { add: (c) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), c])].join(' '); } };
  }

  setAttribute(k, v) {
    const val = String(v);
    this.attrs.set(k, val);
    if (k === 'class') this.className = val;
    if (PROPS.has(k)) this[k] = k === 'value' ? val : true;
    if (k.startsWith('data-')) this.dataset[k.slice(5)] = val;
  }

  getAttribute(k) {
    if (k === 'class') return this.className;
    if (k.startsWith('data-') && k.slice(5) in this.dataset) return this.dataset[k.slice(5)];
    return this.attrs.has(k) ? this.attrs.get(k) : null;
  }

  get isConnected() {
    let n = this;
    while (n.parentNode) n = n.parentNode;
    return n === globalThis.document.body;
  }

  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }

  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }

  set textContent(v) {
    this.replaceChildren(...(v === '' || v === null || v === undefined ? [] : [String(v)]));
  }

  #adopt(c) {
    const node = typeof c === 'string' || typeof c === 'number' ? new FakeText(c) : c;
    if (node.parentNode) node.parentNode.childNodes.splice(node.parentNode.childNodes.indexOf(node), 1);
    node.parentNode = this;
    return node;
  }

  append(...cs) {
    for (const c of cs) {
      const node = this.#adopt(c);
      this.childNodes.push(node);
      // select에 selected 보기를 붙이면 select의 값이 그 보기가 된다(실제 브라우저와 같음)
      if (this.tagName === 'SELECT' && node.tagName === 'OPTION' && node.selected) this.value = node.value;
    }
  }

  prepend(...cs) { this.childNodes.unshift(...cs.map((c) => this.#adopt(c))); }

  replaceChildren(...cs) {
    for (const old of this.childNodes) old.parentNode = null;
    this.childNodes = [];
    this.append(...cs);
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  /** 이벤트를 일으킨다(없는 이벤트 객체는 preventDefault만 있는 것으로) */
  fire(type, evt = {}) {
    const e = { preventDefault() {}, target: this, ...evt };
    for (const fn of this.listeners.get(type) || []) fn(e);
  }

  click() { if (!this.disabled) this.fire('click'); }

  focus() { this.focused = true; }

  #matches(part) {
    const m = /^([a-z0-9]*)(?:\[data-testid(\^?=)([^\]]+)\])?$/i.exec(part);
    if (!m) throw new Error(`지원하지 않는 선택자: ${part}`);
    if (m[1] && this.tagName !== m[1].toUpperCase()) return false;
    if (m[2] === '=') return this.dataset.testid === m[3];
    if (m[2] === '^=') return typeof this.dataset.testid === 'string' && this.dataset.testid.startsWith(m[3]);
    return true;
  }

  #find(parts, all, out) {
    for (const c of this.children) {
      let sub = parts;
      if (c.#matches(parts[0])) {
        if (parts.length === 1) { out.push(c); if (!all) return true; } else sub = parts.slice(1);
      }
      if (c.#find(sub, all, out) && !all) return true;
    }
    return false;
  }

  querySelectorAll(sel) {
    const out = [];
    this.#find(sel.trim().split(/\s+/), true, out);
    return out;
  }

  querySelector(sel) {
    const out = [];
    this.#find(sel.trim().split(/\s+/), false, out);
    return out[0] || null;
  }
}

/** 전역 document를 흉내로 바꾼다(el()이 document.createElement를 쓴다). 돌려주는 body에 붙이면 isConnected가 참이 된다 */
export function installDom() {
  const body = new FakeEl('body');
  globalThis.document = { createElement: (tag) => new FakeEl(tag), body };
  return body;
}

export const uninstallDom = () => { delete globalThis.document; };
