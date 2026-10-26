// CR-22 마무리 다듬기 단위 검증(X-40~X-43): 통합 확인 목록에서 「주제만 겹친 후보」 접기(Q1), 키보드 접근성 속성·방향키(공간 메뉴·분류 칩).
// 실제 키 입력·초점 테두리는 tools/browser-check.mjs 「CR-22 X」가 브라우저에서 확인한다. 가상 데이터만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, uninstallDom } from './dom-stub.js';
import { allSamples, viewOf } from './helpers.js';
import { candidateEvidenceKinds, isTopicOnlyCandidate, mergePlan } from '../app/src/merge/merge.js';
import { mergePanel } from '../app/src/ui/merge.js';
import { memoParts } from '../app/src/ui/memo-form.js';
import { renderWorkspaceNav } from '../app/src/ui/workspace.js';

const all = allSamples();
const q = (root, id) => root.querySelector(`[data-testid=${id}]`);
const withDom = (fn) => () => {
  installDom();
  try { fn(globalThis.document.body); } finally { uninstallDom(); }
};

test('X-40 이유 문장에서 근거 종류를 센다: 주제 1개뿐일 때만 주제만 겹친 후보', () => {
  const r = (reason) => ({ reason });
  assert.deepEqual(candidateEvidenceKinds(r('같은 주제 「A」, 같은 산출물 유형 「양식」, 이름에 같은 낱말 「보고」. 확인')), { topic: 1, artifact_type: 1, token: 1 });
  assert.equal(isTopicOnlyCandidate(r('같은 주제 「A」. 같은 업무인지 사람이 확인합니다.')), true);
  assert.equal(isTopicOnlyCandidate(r('같은 주제 「A」, 같은 주제 「B」. 확인')), false); // 주제 둘은 근거가 더 많다
  assert.equal(isTopicOnlyCandidate(r('같은 주제 「A」, 이름에 같은 낱말 「보고」. 확인')), false);
  assert.equal(isTopicOnlyCandidate(r('같은 산출물 유형 「양식」. 확인')), false);
  assert.equal(isTopicOnlyCandidate({ source: 'ai', reason: 'AI 후보: 같은 주제 「A」' }), false);
  assert.equal(isTopicOnlyCandidate(null), false);
});

test('X-40 mergePlan이 만든 가상 운영부(U-D1) 후보: 거래 조회·장애 시 재처리는 주제만, 나머지는 낱말 겹침. 점수·개수는 그대로', () => {
  const plan = mergePlan(viewOf('U-D1'), all['U-D1'].identity_links);
  const only = plan.works.filter(isTopicOnlyCandidate).map((w) => w.title);
  assert.equal(only.length, 2);
  assert.ok(only.every((t) => t.includes('대사 확인') && (t.includes('거래 조회') || t.includes('장애 시 재처리'))));
  assert.ok(plan.works.filter((w) => !isTopicOnlyCandidate(w)).every((w) => w.reason.includes('이름에 같은 낱말')));
  assert.equal(plan.works.length, 4);
  assert.equal(plan.counts.works, 4);
  assert.equal(plan.works.filter(isTopicOnlyCandidate).every((w) => w.score === 3), true);
});

test('X-40 통합 확인 화면: 주제만 겹친 후보는 접힌 묶음 안(판정 단추 그대로), 나머지는 위 목록. 제목의 업무 후보 수는 전체', withDom((body) => {
  const view = viewOf('U-D1');
  const plan = mergePlan(view, all['U-D1'].identity_links);
  const decided = [];
  const root = mergePanel({ view, plan, links: [], provider: null, readOnly: false, onDecide: (item, st) => decided.push([item.title, st]), onApplyAuto() {}, onFocus() {}, onClose() {} });
  body.append(root);
  const main = q(root, 'merge-works');
  const fold = q(root, 'merge-works-topic-only');
  assert.equal(main.querySelectorAll('li').length, 2);
  assert.ok(!main.textContent.includes('거래 조회') && !main.textContent.includes('장애 시 재처리'));
  assert.equal(fold.tagName, 'DETAILS');
  assert.equal(fold.querySelector('summary').textContent, '주제만 겹친 후보 2건');
  assert.equal(fold.querySelectorAll('li').length, 2);
  assert.ok(fold.textContent.includes('거래 조회') && fold.textContent.includes('장애 시 재처리'));
  assert.equal(fold.querySelectorAll('[data-testid=merge-same]').length, 2);
  fold.querySelector('[data-testid=merge-diff]').fire('click');
  assert.deepEqual(decided.map((d) => d[1]), ['rejected']);
  assert.ok(root.textContent.includes('업무 후보 4건'));
}));

test('X-40 후보가 주제만 겹친 것뿐이면 위 목록 대신 안내 한 줄, 접힌 묶음에 모두', withDom((body) => {
  const view = viewOf('U-D1');
  const full = mergePlan(view, all['U-D1'].identity_links);
  const plan = { ...full, works: full.works.filter(isTopicOnlyCandidate) };
  const root = mergePanel({ view, plan, links: [], provider: null, readOnly: true, onDecide() {}, onApplyAuto() {}, onFocus() {}, onClose() {} });
  body.append(root);
  assert.equal(q(root, 'merge-works'), null);
  assert.ok(q(root, 'merge-works-none').textContent.includes('접힌 묶음'));
  assert.equal(q(root, 'merge-works-topic-only').querySelectorAll('li').length, 2);
  assert.equal(q(root, 'merge-works-topic-only').querySelectorAll('[data-testid=merge-same]').length, 0); // 읽기 전용: 판정 단추 없음
}));

test('X-41 공간 메뉴: 현재 공간 단추만 aria-current=page(aria-pressed와 함께)', withDom((body) => {
  const nav = document.createElement('nav');
  body.append(nav);
  renderWorkspaceNav(nav, { current: 'check', badges: null, onPick() {} });
  assert.deepEqual(nav.children.filter((b) => b.getAttribute('aria-current') === 'page').map((b) => b.getAttribute('data-testid')), ['ws-check']);
  assert.equal(nav.children.filter((b) => b.getAttribute('aria-pressed') === 'true').length, 1);
}));

test('X-42 분류 칩: Tab은 그룹에 한 번(처음엔 첫 칩), 방향키로 옮기며 고른다(끝에서 처음으로, Home·End)', withDom((body) => {
  const parts = memoParts({ prefix: 'weekly', onChange() {} });
  body.append(parts.chipRow, parts.select);
  const chips = parts.chipRow.children;
  assert.deepEqual(chips.map((c) => c.tabIndex), [0, -1, -1, -1]);
  const key = (c, k) => { let prevented = false; c.fire('keydown', { key: k, preventDefault() { prevented = true; } }); return prevented; };
  assert.equal(key(chips[0], 'ArrowRight'), true);
  assert.equal(parts.category(), 'issue');
  assert.equal(chips[1].focused, true);
  assert.deepEqual(chips.map((c) => c.tabIndex), [-1, 0, -1, -1]);
  assert.equal(chips[1].getAttribute('aria-checked'), 'true');
  key(chips[1], 'ArrowDown');
  key(chips[2], 'ArrowDown');
  assert.equal(parts.category(), 'resolved');
  key(chips[3], 'ArrowRight'); // 끝에서 처음으로
  assert.equal(chips[0].getAttribute('aria-checked'), 'true');
  key(chips[0], 'ArrowLeft'); // 처음에서 끝으로
  assert.equal(parts.category(), 'resolved');
  key(chips[3], 'Home');
  assert.equal(chips[0].getAttribute('aria-checked'), 'true');
  key(chips[0], 'End');
  assert.equal(parts.category(), 'resolved');
  assert.equal(key(chips[0], 'a'), false); // 다른 키는 건드리지 않는다
}));
