// 앱 안 따라 하기(CR-13 A, 2026-10-18): 오른쪽 패널 맨 위의 이야기형 카드 + 대상 짚기(깜빡임).
// 단계 문구·완료 조건·대상은 rules/tour-steps.js 한 곳에 있다. 이 파일은 그리기와 상태 기계만 맡는다.
// 진행은 실제 행동으로만: 앱이 화면을 다시 그린 뒤(renderPanel·refresh 등) tour.check()를 부른다. 시간 간격으로 상태를 확인하지 않는다
// (setInterval은 노드 깜빡임 그리기 전용이다). 진행 상태는 저장하지 않는다 — 새로 열면 꺼진다.

import { el } from './dom.js';
import { advance, scenarioFor, scenarioOf } from '../rules/tour-steps.js';

const BLINK_MS = 650;

// 끝 카드의 안내 한 줄(CR-18-3)
export const END_GUIDE = '예시를 봤으면, 내 업무 이름 하나로 작은 지도를 만들어 보세요.';

/**
 * @param {{
 *   slot: HTMLElement,
 *   getState: () => object,               // rules/tour-steps.js의 state 모양
 *   getCy: () => object,                  // cytoscape 인스턴스
 *   universeId: () => string,             // 지금 연 유니버스 ID
 *   onOpenUniverse: (universeId:string, tourId:string) => void, // 다른 유니버스에서 시작해야 할 때(「?」로 고른 경우)
 *   onStart?: () => void,                 // 시작할 때 앱 쪽 표시(초안·근거·찾기)를 지운다
 *   onMake: () => void,                   // 끝 카드의 「이제 내 업무로 해 보기」·「내 업무 지도 만들기」(둘 다 「내 업무 지도 만들기」 창을 연다)
 *   canMake?: boolean,
 *   toolsHint?: () => boolean,            // 끝 카드에 「도구 더 보기」 안내 한 줄을 띄울지
 *   onFinish?: (scenarioId:string) => void, // 끝 카드에 이르렀거나 단계 중 건너뛰었을 때(CR-18 D-2: 앱이 이 브라우저 설정에 「한 번 했음」을 남긴다)
 * }} o
 */
export function createTour(o) {
  let mode = 'off'; // 'off' | 'step' | 'end' | 'pick'
  let sc = null; // 지금 시나리오
  let index = 0; // 단계 번호(0부터)
  let blinkOn = true;
  let timer = null;
  let marked = { dom: null, cy: null };
  let hintEl = null; // 「빈 곳을 누르세요」 표지(그래프 안쪽, 재검증 N-2)
  let subEl = null; // 보조 문구(단계에 sub가 있을 때, 재검증 N-6)
  let reduced = false;
  let finishedFor = null; // 이번 시작에서 onFinish를 이미 불렀음(같은 시작에서 두 번 부르지 않는다)
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* 모르면 깜빡임 */ }

  // 접힌 <details> 안의 단추는 크기를 가져도 보이지 않는다: checkVisibility()로 판정한다(없는 브라우저는 offsetParent)
  const visible = (e) => !!e && (typeof e.checkVisibility === 'function' ? e.checkVisibility() : e.offsetParent !== null);

  // 오른쪽 패널 안의 대상이 스크롤로 가려졌거나 따라 하기 카드 밑에 숨었으면 가운데로 올린다(인사이트·초안은 열면 「닫기」로 초점이 가 아래로 내려가 있다)
  function ensureVisible(e) {
    const aside = e.closest('aside');
    if (!aside) return;
    const r = e.getBoundingClientRect();
    const a = aside.getBoundingClientRect();
    const top = a.top + (o.slot.hidden ? 0 : o.slot.offsetHeight);
    if (r.top < top || r.bottom > a.bottom) e.scrollIntoView({ block: 'center' });
  }

  function currentTargets() {
    if (mode !== 'step' || !sc) return [];
    const st = sc.steps[index];
    return st && st.target ? st.target(o.getState()) : [];
  }

  function setHint(parent, text) {
    if (!text || !parent) {
      if (hintEl) { hintEl.remove(); hintEl = null; }
      return;
    }
    if (hintEl && hintEl.parentNode === parent && hintEl.textContent === text) return;
    if (hintEl) hintEl.remove();
    hintEl = el('div', { class: 'tour-blank-hint', 'data-testid': 'tour-blank-hint', 'aria-hidden': 'true' }, text);
    parent.append(hintEl);
  }

  function updateSub() {
    if (!subEl) return;
    const st = mode === 'step' && sc ? sc.steps[index] : null;
    const txt = st && st.sub ? st.sub(o.getState()) : '';
    subEl.hidden = !txt;
    subEl.textContent = txt || '';
  }

  function unmark() {
    setHint(null, '');
    if (marked.dom) marked.dom.classList.remove('tour-target', 'tour-inset');
    if (marked.cy && !marked.cy.removed()) marked.cy.removeClass('tour-target');
    marked = { dom: null, cy: null };
  }

  // 지금 단계의 대상을 짚는다. 화면을 다시 그리면(그래프·패널) 표시가 사라지므로 check()마다 다시 짚는다
  function paint() {
    const targets = currentTargets();
    let dom = null;
    let node = null;
    let noScroll = false;
    let hint = '';
    for (const t of targets) {
      if (t.sel) {
        const e = document.querySelector(t.sel);
        if (visible(e)) { dom = e; noScroll = !!t.noScroll; hint = t.hint || ''; break; }
      } else if (t.cy) {
        const found = o.getCy().nodes(t.cy);
        if (found.nonempty()) { node = found[0]; break; }
      }
    }
    const newDom = !!dom && dom !== marked.dom;
    if (marked.dom && marked.dom !== dom) marked.dom.classList.remove('tour-target', 'tour-inset');
    if (marked.cy && marked.cy !== node && !marked.cy.removed()) marked.cy.removeClass('tour-target');
    marked = { dom, cy: node };
    if (dom) {
      dom.classList.add('tour-target'); // 깜빡임은 CSS 애니메이션(prefers-reduced-motion이면 고정 테두리)
      dom.classList.toggle('tour-inset', !!hint); // 표지가 있는 큰 대상은 테두리를 안쪽에
    }
    setHint(dom, hint);
    if (newDom && !noScroll) ensureVisible(dom);
    if (node) {
      if (reduced || blinkOn) node.addClass('tour-target');
      else node.removeClass('tour-target');
    }
    // 그래프 노드만 깜빡임을 타이머로 그린다. 노드를 짚는 단계에서만 돌린다
    const needTimer = !!node && !reduced;
    if (needTimer && !timer) timer = setInterval(() => { blinkOn = !blinkOn; paint(); }, BLINK_MS);
    if (!needTimer && timer) { clearInterval(timer); timer = null; blinkOn = true; }
  }

  function stop() {
    mode = 'off';
    sc = null;
    subEl = null;
    if (timer) { clearInterval(timer); timer = null; }
    blinkOn = true;
    unmark();
    o.slot.hidden = true;
    o.slot.replaceChildren();
  }

  function card(...children) {
    return el('div', { class: 'tour-card', role: 'region', 'aria-label': '따라 하기', 'data-testid': 'tour-card' }, ...children);
  }
  // 끝 카드에 이르거나 단계 중에 건너뛰면 「한 번 했음」(D-2). 시나리오를 고르는 카드(pick)에서 닫는 것은 해당 없음
  function finish() {
    if (!sc || finishedFor === sc) return;
    finishedFor = sc;
    if (o.onFinish) o.onFinish(sc.id);
  }
  const skipBtn = (label = '건너뛰기') => el('button', { type: 'button', class: 'small-btn', 'data-testid': 'tour-skip', onclick: () => { if (mode === 'step' || mode === 'end') finish(); stop(); } }, label);

  function render() {
    if (mode === 'off') return stop();
    o.slot.hidden = false;
    if (mode === 'pick') {
      o.slot.replaceChildren(card(
        el('div', { class: 'tour-head' }, el('span', { class: 'tour-count' }, '따라 하기')),
        el('p', { class: 'tour-task' }, '어떤 걸 따라 해 볼까요? 예시 업무 지도를 열고 하나씩 안내합니다.'),
        el('div', { class: 'row' },
          el('button', { type: 'button', class: 'primary small-btn', 'data-testid': 'tour-pick-handover', onclick: () => o.onOpenUniverse(scenarioOf('handover').universeId, 'handover') }, '인수인계 초안 만들기'),
          el('button', { type: 'button', class: 'small-btn', 'data-testid': 'tour-pick-team', onclick: () => o.onOpenUniverse(scenarioOf('team').universeId, 'team') }, '팀 업무 한눈에 보기'),
          skipBtn('닫기')),
      ));
      return paint();
    }
    if (mode === 'end') {
      finish();
      o.slot.replaceChildren(card(
        el('div', { class: 'tour-head' }, el('span', { class: 'tour-count' }, `따라 하기 ${sc.steps.length}/${sc.steps.length} 끝`)),
        el('p', { class: 'tour-task', 'data-testid': 'tour-end' }, '끝! 이제 내 업무로 해 볼까요?'),
        el('p', { class: 'muted small', 'data-testid': 'tour-end-guide' }, END_GUIDE),
        o.toolsHint && o.toolsHint() ? el('p', { class: 'tour-hint', 'data-testid': 'tour-tools-hint' }, '이제 「도구 더 보기」에서 흐름 정렬·거르기도 써 보세요.') : null,
        el('div', { class: 'row' },
          // CR-18-3: 따라 하기를 닫고 「내 업무 지도 만들기」 창을 연다(시작 화면 「내 업무를 정리해 두고 싶어요」와 같은 창). 같은 일을 하던 예전 「내 업무 지도 만들기」 단추는 뺐다(한 카드에 같은 일 단추 둘)
          el('button', { type: 'button', class: 'primary small-btn', 'data-testid': 'tour-mine', disabled: o.canMake === false, onclick: () => { stop(); o.onMake(); } }, '이제 내 업무로 해 보기'),
          skipBtn('닫기')),
      ));
      return paint();
    }
    const st = sc.steps[index];
    subEl = st.sub ? el('p', { class: 'tour-sub', 'data-testid': 'tour-sub', role: 'status' }) : null;
    o.slot.replaceChildren(card(
      el('div', { class: 'tour-head' },
        el('span', { class: 'tour-count', 'data-testid': 'tour-count' }, `따라 하기 ${index + 1}/${sc.steps.length}`),
        skipBtn()),
      index === 0 ? el('p', { class: 'tour-story', 'data-testid': 'tour-story' }, sc.story) : null,
      el('p', { class: 'tour-task', 'data-testid': 'tour-task' }, st.task),
      subEl,
      st.next ? el('div', { class: 'row' }, el('button', { type: 'button', class: 'primary small-btn', 'data-testid': 'tour-next', onclick: goNext }, '다음')) : null,
    ));
    updateSub();
    paint();
  }

  function goNext() {
    if (mode !== 'step') return;
    index = advance(sc, index + 1, o.getState());
    if (index >= sc.steps.length) mode = 'end';
    render();
  }

  return {
    /** 시나리오 시작(앱이 그 유니버스를 이미 연 뒤) */
    start(id) {
      const next = scenarioOf(id);
      if (!next) return;
      if (o.onStart) o.onStart();
      sc = next;
      finishedFor = null;
      mode = 'step';
      index = advance(sc, 0, o.getState());
      if (index >= sc.steps.length) mode = 'end';
      render();
    },
    /** 머리글 「?」: U-A1이면 handover, U-D1이면 team, 그 밖이면 고르기 */
    openHelp() {
      const id = scenarioFor(o.universeId());
      if (id) return this.start(id);
      mode = 'pick';
      sc = null;
      render();
    },
    /** 앱이 화면을 다시 그린 뒤·사용자 행동 뒤에 부른다: 완료 조건을 보고 다음 단계로 */
    check() {
      if (mode === 'step') {
        const ni = advance(sc, index, o.getState());
        if (ni !== index) {
          index = ni;
          if (index >= sc.steps.length) mode = 'end';
          return render();
        }
      }
      if (mode !== 'off') {
        updateSub();
        paint(); // 그래프·패널이 다시 그려졌으면 짚기를 다시 한다
      }
    },
    /** 초안 화면이 미리 골라 둘 보내는·받는 사람(지금 단계에 있을 때만) */
    preset() {
      return mode === 'step' && sc.steps[index].preset ? sc.steps[index].preset : undefined;
    },
    close: stop,
    /** 점검용 요약 */
    info() {
      return { mode, scenario: sc ? sc.id : null, index, total: sc ? sc.steps.length : 0, marked: !!(marked.dom || marked.cy), hint: !!hintEl };
    },
  };
}
