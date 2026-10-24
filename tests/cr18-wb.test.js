// CR-18-4(관계 고르기: 쓸 수 있는 관계 위·하나면 자동)와 CR-18-3(따라 하기 끝 카드 「이제 내 업무로 해 보기」) 단위 검증.
// DOM 흉내(tests/dom-stub.js)로 돌린다. 실제 브라우저 점검(tools/browser-check.mjs 「처음 사용 W-B」)을 대신하지 않는다. 가상 데이터만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, uninstallDom } from './dom-stub.js';
import { EDGE_TYPES, allowedRelations } from '../app/src/model/schema.js';
import { PAIR_BLOCKED_GROUP, edgeEditForm, edgeForm, markRelationOptions, nodeForm } from '../app/src/ui/editor.js';
import { END_GUIDE, createTour } from '../app/src/ui/tour.js';
import { emptyState } from '../app/src/rules/tour-steps.js';

const withDom = (fn) => () => {
  const body = installDom();
  try { fn(body); } finally { uninstallDom(); }
};
const q = (root, id) => root.querySelector(`[data-testid=${id}]`);
const pick = (sel, value) => { sel.value = value; sel.fire('change'); };
const usableKeys = (a, b) => new Set(allowedRelations(a, b).map((x) => x.relation));

const makeSelect = (value = 'relates_to') => {
  const sel = document.createElement('select');
  for (const v of Object.keys(EDGE_TYPES)) {
    const o = document.createElement('option');
    o.setAttribute('value', v);
    o.textContent = EDGE_TYPES[v];
    if (v === value) o.setAttribute('selected', '');
    sel.append(o);
  }
  sel.value = value;
  return sel;
};
const makeHint = () => { const p = document.createElement('p'); p.hidden = true; return p; };
const groupOf = (sel) => sel.querySelector('optgroup');

const node = (id, core_type, label) => ({ id, core_type, label, type_label: { org: '조직', work: '업무', person: '사람', artifact: '문서' }[core_type] || core_type });

// ── CR-18-4: markRelationOptions ──

test('CR-18-4 조직 → 업무: 쓸 수 있는 관계는 「참조」 하나, 자동 선택되고 한 줄 안내가 보인다', withDom(() => {
  const sel = makeSelect('relates_to');
  const hint = makeHint();
  const r = markRelationOptions(sel, 'org', 'work', hint);
  assert.deepEqual(r, { only: 'references', changed: true });
  assert.equal(sel.value, 'references');
  assert.equal(sel.options[0].value, 'references');
  assert.equal(sel.options[0].disabled, false);
  assert.equal(hint.hidden, false);
  assert.equal(hint.textContent, '(이 조합은 「참조」만 됩니다)');
  const g = groupOf(sel);
  assert.equal(g.getAttribute('label'), '이 조합에는 못 씀');
  assert.equal(g.getAttribute('label'), PAIR_BLOCKED_GROUP);
  assert.equal(g.children.length, Object.keys(EDGE_TYPES).length - 1);
  assert.ok(g.children.every((o) => o.disabled));
}));

test('CR-18-4 사람 → 업무: 「수행」·「참조」가 위, 「관련」 등은 아래 묶음(disabled), 하나가 아니므로 안내 없음, 못 쓰는 기본값은 첫 관계(수행)로', withDom(() => {
  const sel = makeSelect('relates_to');
  const hint = makeHint();
  const r = markRelationOptions(sel, 'person', 'work', hint);
  assert.equal(r.only, null);
  assert.equal(hint.hidden, true);
  assert.equal(hint.textContent, '');
  const ok = usableKeys('person', 'work');
  const top = sel.children.filter((c) => c.tagName === 'OPTION').map((o) => o.value);
  assert.deepEqual(top, Object.keys(EDGE_TYPES).filter((k) => ok.has(k)));
  assert.deepEqual(top, ['performs', 'references']);
  const below = groupOf(sel).children.map((o) => o.value);
  assert.ok(below.includes('relates_to') && below.every((v) => !ok.has(v)));
  assert.equal(sel.children.indexOf(groupOf(sel)), sel.children.length - 1, '묶음은 맨 아래');
  assert.equal(sel.value, 'performs');
  assert.equal(r.changed, true);
}));

test('CR-18-4 사용자가 이미 고른 값이 쓸 수 있으면 그대로 둔다(하나가 아닌 조합·하나뿐인 조합 모두)', withDom(() => {
  const sel = makeSelect('references');
  const r = markRelationOptions(sel, 'person', 'work', makeHint());
  assert.equal(sel.value, 'references');
  assert.equal(r.changed, false);
  const sel2 = makeSelect('references');
  const r2 = markRelationOptions(sel2, 'org', 'work', makeHint());
  assert.equal(sel2.value, 'references');
  assert.equal(r2.changed, false);
  assert.equal(r2.only, 'references');
}));

test('CR-18-4 opts.keep: 값을 바꾸지 않는다(못 쓰는 값이어도). 상대가 없으면 원래 순서로 되돌리고 안내를 숨긴다', withDom(() => {
  const sel = makeSelect('relates_to');
  const hint = makeHint();
  const r = markRelationOptions(sel, 'org', 'work', hint, { keep: true });
  assert.equal(sel.value, 'relates_to');
  assert.equal(r.changed, false);
  assert.equal(r.only, 'references');
  markRelationOptions(sel, null, null, hint);
  assert.equal(sel.value, 'relates_to');
  assert.deepEqual(sel.options.map((o) => o.value), Object.keys(EDGE_TYPES));
  assert.equal(sel.querySelectorAll('optgroup').length, 0);
  assert.equal(hint.hidden, true);
}));

// ── CR-18-4: 세 양식 ──

test('CR-18-4 연결 추가: 조직 → 업무를 고르면 「참조」 자동 선택 + 안내, 사람 → 업무는 「수행」 위·「관련」 아래 묶음, 먼저 고른 값은 유지', withDom(() => {
  const org = node('N-100', 'org', '가상조직');
  const work = node('N-101', 'work', '가상 업무');
  const form = edgeForm({ node: org, candidates: [work], onSubmit: () => ({ ok: true }), onCancel() {} });
  const rel = q(form, 'edge-type');
  const note = q(form, 'edge-only');
  assert.equal(note.hidden, true, '상대를 고르기 전에는 안내가 없다');
  assert.equal(rel.querySelectorAll('optgroup').length, 0, '상대를 고르기 전에는 전부 켜져 있다');
  pick(q(form, 'edge-other'), work.id);
  assert.equal(rel.value, 'references');
  assert.equal(note.hidden, false);
  assert.equal(note.textContent, '(이 조합은 「참조」만 됩니다)');

  const person = node('N-102', 'person', '가상 담당');
  const form2 = edgeForm({ node: person, candidates: [work], onSubmit: () => ({ ok: true }), onCancel() {} });
  const rel2 = q(form2, 'edge-type');
  pick(q(form2, 'edge-other'), work.id);
  assert.deepEqual(rel2.children.filter((c) => c.tagName === 'OPTION').map((o) => o.value), ['performs', 'references']);
  assert.ok(groupOf(rel2).children.some((o) => o.value === 'relates_to' && o.disabled));
  assert.equal(q(form2, 'edge-only').hidden, true);

  // 사용자가 「참조」를 먼저 고른 뒤 상대를 바꾸면 그대로
  const form3 = edgeForm({ node: person, candidates: [work, node('N-103', 'artifact', '가상 문서')], onSubmit: () => ({ ok: true }), onCancel() {} });
  q(form3, 'edge-type').value = 'references';
  pick(q(form3, 'edge-other'), work.id);
  assert.equal(q(form3, 'edge-type').value, 'references');
  pick(q(form3, 'edge-other'), 'N-103');
  assert.equal(q(form3, 'edge-type').value, 'references');
  assert.equal(q(form3, 'edge-only').textContent, '(이 조합은 「참조」만 됩니다)');
}));

test('CR-18-4 연결 추가: 관계가 자동으로 바뀌면 그 관계가 되는 방향으로 맞춘다(업무 → 사람의 수행은 사람 → 업무 방향만 가능)', withDom(() => {
  // 업무에서 사람을 이을 때 허용: 수행(사람→업무 = 반대 방향만) + 참조(양방향). 기본 「관련」은 못 쓰므로 「수행」으로 바뀌고 방향도 따라간다
  const w = node('N-110', 'work', '가상 업무');
  const p = node('N-111', 'person', '가상 담당');
  const form = edgeForm({ node: w, candidates: [p], onSubmit: () => ({ ok: true }), onCancel() {} });
  pick(q(form, 'edge-other'), p.id);
  assert.equal(q(form, 'edge-type').value, 'performs');
  assert.equal(q(form, 'edge-direction').value, 'in', '수행은 상대(사람) → 이 업무 방향만 되므로 방향도 맞춘다');
}));

test('CR-18-4 사람·업무·문서 추가의 「함께 이을」 관계: 조직 → 업무면 「참조」 하나가 자동 선택·안내, 사람 → 업무면 「수행」 위·「관련」 아래 묶음', withDom(() => {
  const work = node('N-120', 'work', '가상 업무');
  const form = nodeForm({ mode: 'add', subtypes: [], getCandidates: () => [work], onSubmit: () => ({ ok: true }), onCancel() {} });
  const type = q(form, 'node-type');
  const other = q(form, 'node-link-other');
  const rel = q(form, 'node-link-type');
  const note = q(form, 'node-link-only');
  assert.equal(note.hidden, true);
  pick(type, 'org');
  pick(other, work.id);
  assert.equal(rel.value, 'references');
  assert.equal(note.hidden, false);
  assert.equal(note.textContent, '(이 조합은 「참조」만 됩니다)');
  assert.equal(groupOf(rel).getAttribute('label'), '이 조합에는 못 씀');
  pick(type, 'person');
  assert.equal(rel.value, 'performs');
  assert.equal(note.hidden, true);
  assert.deepEqual(rel.children.filter((c) => c.tagName === 'OPTION').map((o) => o.value), ['performs', 'references']);
  assert.ok(groupOf(rel).children.some((o) => o.value === 'relates_to' && o.disabled));
  pick(other, '');
  assert.equal(groupOf(rel), null, '연결하지 않음으로 돌리면 묶음이 사라진다');
  assert.equal(note.hidden, true);
}));

test('CR-18-4 연결 수정: 처음 열 때는 지금 관계를 그대로 두고 순서만 정리, 상대를 바꿔 못 쓰게 되면 쓸 수 있는 관계로(하나뿐이면 자동 + 안내)', withDom(() => {
  const p = node('N-130', 'person', '가상 담당');
  const w = node('N-131', 'work', '가상 업무');
  const o = node('N-132', 'org', '가상 조직');
  const d = node('N-133', 'artifact', '가상 문서');
  const edge = { id: 'E-1', source: p.id, target: w.id, core_type: 'performs', note: '' };
  const form = edgeEditForm({ edge, node: p, candidates: [p, w, o, d], title: '가상 담당 → 가상 업무', onSubmit: () => ({ ok: true }), onCancel() {} });
  const rel = q(form, 'edge-edit-type');
  const note = q(form, 'edge-edit-only');
  assert.equal(rel.value, 'performs');
  assert.equal(note.hidden, true);
  assert.deepEqual(rel.children.filter((c) => c.tagName === 'OPTION').map((x) => x.value), ['performs', 'references']);
  assert.ok(groupOf(rel).children.every((x) => x.disabled));
  // 상대를 문서로: 쓸 수 있는 것은 「참조」뿐 → 자동
  pick(q(form, 'edge-edit-other'), d.id);
  assert.equal(rel.value, 'references');
  assert.equal(note.hidden, false);
  assert.equal(note.textContent, '(이 조합은 「참조」만 됩니다)');
  // 상대를 조직으로: 소속·참조 둘 → 지금 값 「참조」는 쓸 수 있으므로 유지, 안내는 사라짐
  pick(q(form, 'edge-edit-other'), o.id);
  assert.equal(rel.value, 'references');
  assert.equal(note.hidden, true);
  // 업무로 돌아가고 「수행」을 직접 고르면 상대를 바꾸지 않는 한 그대로
  pick(q(form, 'edge-edit-other'), w.id);
  rel.value = 'performs';
  assert.equal(rel.value, 'performs');
}));

// ── CR-18-3: 따라 하기 끝 카드 ──

function makeTour(overrides = {}) {
  const slot = document.createElement('div');
  slot.hidden = true;
  document.querySelector = () => null;
  const calls = [];
  const state = emptyState('U-A1');
  const tour = createTour({
    slot,
    getState: () => state,
    getCy: () => ({ nodes: () => ({ nonempty: () => false }) }),
    universeId: () => state.universeId,
    onOpenUniverse() {},
    onMake: () => calls.push('make'),
    ...overrides,
  });
  return { slot, state, tour, calls };
}

function driveHandoverToEnd(t) {
  t.tour.start('handover');
  Object.assign(t.state, { selected: 'U-A1/N-001' });
  t.tour.check();
  q(t.slot, 'tour-next').click();
  Object.assign(t.state, { draftShown: true, evidenceUsed: true });
  t.tour.check();
  Object.assign(t.state, { rewinding: true });
  t.tour.check();
}

test('CR-18-3 인수인계 따라 하기 끝 카드: 안내 한 줄 + 「이제 내 업무로 해 보기」 단추, 누르면 따라 하기를 닫고 내 업무 지도 만들기(onMake)를 연다', withDom(() => {
  const t = makeTour();
  driveHandoverToEnd(t);
  assert.equal(t.tour.info().mode, 'end');
  assert.equal(q(t.slot, 'tour-end').textContent, '끝! 이제 내 업무로 해 볼까요?');
  assert.equal(q(t.slot, 'tour-end-guide').textContent, '예시를 봤으면, 내 업무 이름 하나로 작은 지도를 만들어 보세요.');
  assert.equal(END_GUIDE, '예시를 봤으면, 내 업무 이름 하나로 작은 지도를 만들어 보세요.');
  const mine = q(t.slot, 'tour-mine');
  assert.ok(mine);
  assert.equal(mine.textContent, '이제 내 업무로 해 보기');
  // 같은 일을 하던 예전 「내 업무 지도 만들기」(tour-make)는 없다
  assert.equal(q(t.slot, 'tour-make'), null);
  assert.ok(q(t.slot, 'tour-skip'));
  assert.equal(q(t.slot, 'tour-skip').textContent, '닫기');
  mine.click();
  assert.deepEqual(t.calls, ['make']);
  assert.equal(t.tour.info().mode, 'off');
  assert.equal(t.slot.hidden, true);
}));

test('CR-18-3 팀 따라 하기 끝 카드에도 같은 단추·안내가 있다', withDom(() => {
  const t = makeTour();
  t.state.universeId = 'U-D1';
  t.tour.start('team');
  // risk-first: 위험 → 펼치기 → 찾기 → 주변만 보기 → 전체 보기
  Object.assign(t.state, { insightOpen: true, insightKind: 'risk' });
  t.tour.check();
  Object.assign(t.state, { expandedCount: 1 });
  t.tour.check();
  Object.assign(t.state, { foundGid: 'U-D1/N-001' });
  t.tour.check();
  Object.assign(t.state, { nbhd: true });
  t.tour.check();
  Object.assign(t.state, { nbhd: false });
  t.tour.check();
  assert.equal(t.tour.info().mode, 'end');
  assert.ok(q(t.slot, 'tour-end-guide'));
  assert.ok(q(t.slot, 'tour-mine'));
  q(t.slot, 'tour-mine').click();
  assert.deepEqual(t.calls, ['make']);
  assert.equal(t.tour.info().mode, 'off');
}));

test('CR-18-3 읽기 전용(canMake:false)이면 끝 카드의 만들기 단추가 disabled, 눌러도 열리지 않는다. 「닫기」는 그대로', withDom(() => {
  const t = makeTour({ canMake: false });
  driveHandoverToEnd(t);
  assert.equal(t.tour.info().mode, 'end');
  assert.equal(q(t.slot, 'tour-mine').disabled, true);
  q(t.slot, 'tour-mine').click();
  assert.deepEqual(t.calls, []);
  q(t.slot, 'tour-skip').click();
  assert.equal(t.tour.info().mode, 'off');
}));

// 변경(FU5-9, CR-18 범위 안 보완): 예전에는 직접 먼저 고른 못 쓰는 관계를 두어 저장할 때 E-PAIR 오류를 보였다. 처음 사용 점검 5회차에서 실무자가
// 「이 조합에는 못 씀」 묶음의 「관련」이 골라진 채 남아 오류를 봤다 → 못 쓰는 값은 고른 채 두지 않고 쓸 수 있는 첫 관계로 바꾸며 한 줄로 알린다(영향: R-02 연결 추가, CR-18-4)
test('FU5-9 사용자가 먼저 고른 관계가 상대를 고른 뒤 못 쓰게 되면 쓸 수 있는 첫 관계로 바꾸고 한 줄로 알린다. 하나뿐이면 자동으로 바꾼다', withDom(() => {
  const topic = node('N-140', 'topic', '가상 주제');
  const work = node('N-141', 'work', '가상 업무');
  const org = node('N-142', 'org', '가상 조직');
  const form = edgeForm({ node: topic, candidates: [work, org], onSubmit: () => ({ ok: true }), onCancel() {} });
  const rel = q(form, 'edge-type');
  pick(rel, 'performs'); // 주제는 업무를 수행할 수 없다(쓸 수 있는 것: 관련·참조 둘)
  pick(q(form, 'edge-other'), work.id);
  assert.equal(rel.value, 'relates_to', '못 쓰는 값을 고른 채 두지 않음');
  assert.ok(groupOf(rel).children.some((o) => o.value === 'performs' && o.disabled));
  const note = q(form, 'edge-only');
  assert.equal(note.hidden, false);
  assert.equal(note.textContent, '(고른 「수행」은 이 조합에 쓸 수 없어 「관련」으로 바꿨습니다)');
  // 손대지 않은 기본값이면 쓸 수 있는 첫 관계로(알림 없이)
  const form2 = edgeForm({ node: topic, candidates: [work], onSubmit: () => ({ ok: true }), onCancel() {} });
  pick(q(form2, 'edge-other'), work.id);
  assert.equal(q(form2, 'edge-type').value, 'relates_to');
  assert.equal(q(form2, 'edge-only').hidden, true);
}));
