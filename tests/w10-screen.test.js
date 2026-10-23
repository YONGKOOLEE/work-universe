// W10(재검증 R11 반영): 초안 다시 그리기(rerun)의 지금 칸 값 우선·실시간 호출 금지, 사람 고르기의 gid 우선(같은 이름 둘), 새 사람 고르기,
// 판 표지(sameMark), 사전 생성+규칙 섞임 안내, 팀 따라 하기 두 순서. DOM 흉내(tests/dom-stub.js)만 쓴다. 가상 데이터만 쓴다.
// 브라우저에서만 보이는 것(R11-5 스크롤·근거 글 유지, 읽기 전용 중 wu:add-node 무시, 「관련 문서」 단추)은 tools/browser-check.mjs 「W10」 블록이 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PREGEN } from '../app/data/pregen.js';
import { createLlmCache } from '../app/src/store/local.js';
import { createProvider } from '../app/src/llm/providers.js';
import { createFakeClient } from '../app/src/llm/fake-client.js';
import { buildView } from '../app/src/view/view.js';
import { TEAM_ORDER, TEAM_ORDERS, advance, emptyState, quotedNames, scenarioOf, teamScenario } from '../app/src/rules/tour-steps.js';
import { LIVE_RERUN_NOTE, RERUN_NOTE, draftPanel, forgetLastPeople } from '../app/src/ui/draft.js';
import { choosePeople, pickNewPerson, recall, remember } from '../app/src/ui/draft-hints.js';
import { LIVE_HINT_MIXED, LIVE_HINT_PREGEN, LIVE_HINT_RULE, PREGEN_MINE, SECURITY_ITEMS, liveHintFor } from '../app/src/ui/ai-notes.js';
import { keepDraftPick, sameMark } from '../app/src/ui/flow-helpers.js';
import { PREGEN_ASOF } from '../tools/pregen-scenarios.mjs';
import { allSamples, clone, mkDoc, mkEdge, mkNode, viewOf } from './helpers.js';
import { installDom, uninstallDom } from './dom-stub.js';

const FAKE_KEY = ['sk', 'ant', 'x'.repeat(8), 'FAKEKEY', 'y'.repeat(12)].join('-');
const rule = createProvider('none', {});

// 업무 하나와 사람 셋(둘은 같은 이름 「가상인」). 같은 이름 사람이 있어도 gid로 고른 사람이 유지되는지 본다
function docWith(extraPersons = []) {
  const nodes = [
    mkNode('N-001', 'work', '점검'),
    mkNode('N-101', 'person', '가상인'),
    mkNode('N-102', 'person', '가상인'),
    mkNode('N-103', 'person', '다른이'),
    ...extraPersons,
  ];
  const edges = [mkEdge('N-000', 'N-001', 'contains')];
  return mkDoc('U-W10A', nodes, edges);
}
const viewOfDoc = (doc) => buildView(doc, () => null);
const G = (n) => `U-W10A/${n}`;

function openDraft(view, over = {}) {
  const body = installDom();
  globalThis.document.dispatchEvent = () => true;
  const panel = draftPanel({ view, provider: rule, asOf: PREGEN_ASOF, onFocus() {}, onClose() {}, ...over });
  body.append(panel);
  const q = (id) => panel.querySelector(`[data-testid=${id}]`);
  return { q, qa: (sel) => panel.querySelectorAll(sel), panel };
}
const withDom = (fn) => async () => {
  forgetLastPeople();
  try { await fn(); } finally { uninstallDom(); forgetLastPeople(); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── R11-6: gid 우선, 이름은 대체 ──
test('R11-6 choosePeople: gid가 목록에 있으면 같은 이름의 다른 사람이 아니라 그 gid를 쓰고, 없으면 이름으로 대신 찾는다', () => {
  const people = [{ gid: 'a', label: '가상인' }, { gid: 'b', label: '가상인' }, { gid: 'c', label: '다른이' }];
  assert.deepEqual(choosePeople({ people, preset: { from: '가상인', from_gid: 'b', to: '다른이', to_gid: 'c' }, remembered: null }), { from: 'b', to: 'c' });
  assert.deepEqual(choosePeople({ people, preset: { from: '가상인', to: '다른이' }, remembered: null }), { from: 'a', to: 'c' }, 'gid가 없으면 이름의 첫 사람(예전 동작)');
  assert.deepEqual(choosePeople({ people, preset: { from: '가상인', from_gid: 'zzz', to: '다른이' }, remembered: null }), { from: 'a', to: 'c' }, '없어진 gid는 이름으로 대신');
  assert.deepEqual(choosePeople({ people, preset: null, remembered: { from: 'b', fromName: '가상인', to: 'c', toName: '다른이' } }), { from: 'b', to: 'c' }, '기억도 gid 먼저');
  assert.deepEqual(choosePeople({ people, preset: null, remembered: { from: 'gone', fromName: '다른이', to: 'a', toName: '가상인' } }), { from: 'c', to: 'a' }, '기억한 gid가 없으면 기억한 이름으로');
  assert.deepEqual(choosePeople({ people, preset: { from: '', from_gid: '', to: '', to_gid: '' }, remembered: null }), { from: null, to: null }, '빈 값은 이름 없는 사람을 찾지 않는다');
  assert.deepEqual(choosePeople({ people, preset: { from_gid: 'b', to_gid: 'b' }, remembered: null }), { from: 'b', to: null }, '같은 사람이면 받는 사람 비움');
});

test('R11-6 remember·recall: 이름도 함께 기억한다(예전 호출 모양도 그대로)', () => {
  const m = new Map();
  remember(m, 'U-1', 'a', 'b');
  assert.deepEqual(recall(m, 'U-1'), { from: 'a', to: 'b', fromName: '', toName: '' });
  remember(m, 'U-2', 'a', 'b', { from: '가', to: '나' });
  assert.deepEqual(recall(m, 'U-2'), { from: 'a', to: 'b', fromName: '가', toName: '나' });
});

test('R11-6 pickNewPerson: 넣기 전에 있던 사람(before)은 빼고, 같은 이름이 이미 있어도 새로 만든 사람을 고른다', () => {
  const people = [{ gid: 'a', label: '가' }, { gid: 'b', label: '나' }, { gid: 'c', label: '가' }];
  assert.equal(pickNewPerson(people, '가', ['a', 'b']), 'c');
  assert.equal(pickNewPerson(people, '나', ['a', 'b']), 'b', '새 사람이 보이지 않으면(이름만 같은 기존 사람) 예전처럼 이름으로');
  assert.equal(pickNewPerson(people, '가'), 'c', 'before가 없으면 예전 동작(맨 끝)');
  assert.equal(pickNewPerson(people, '다', ['a']), null);
  // 같은 이름 둘 중 앞 사람이 새로 만들어진 경우에도 before로 가린다
  assert.equal(pickNewPerson([{ gid: 'n', label: '가' }, { gid: 'o', label: '가' }], '가', ['o']), 'n');
});

test('R11-6 초안 창: 같은 이름 사람이 둘이어도 preset의 gid로 고른 사람(둘째)이 선택된다', withDom(() => {
  const view = viewOfDoc(docWith());
  const { q } = openDraft(view, { preset: { target: G('N-001'), from: '가상인', from_gid: G('N-102'), to: '다른이', to_gid: G('N-103') } });
  assert.equal(q('draft-from').value, G('N-102'));
  assert.equal(q('draft-to').value, G('N-103'));
  // 이름만 있는 예전 preset은 첫 사람
  uninstallDom();
  const old = openDraft(view, { preset: { target: G('N-001'), from: '가상인', to: '다른이' } });
  assert.equal(old.q('draft-from').value, G('N-101'));
}));

test('R11-6 초안을 만든 뒤 같은 지도에서 다시 열면 같은 이름 둘 중 고른 사람이 기억된다', withDom(() => {
  const view = viewOfDoc(docWith());
  const a = openDraft(view);
  a.q('draft-target').value = G('N-001');
  a.q('draft-from').value = G('N-102');
  a.q('draft-to').value = G('N-103');
  a.q('draft-form').fire('submit');
  uninstallDom();
  const b = openDraft(view);
  assert.equal(b.q('draft-from').value, G('N-102'));
  assert.equal(b.q('draft-to').value, G('N-103'));
}));

test('R11-6 keepDraftPick: 고른 gid를 preset에 함께 적는다', () => {
  const k = keepDraftPick({ target: 't0' }, { target: 't', from: G('N-102'), to: '' }, (g) => (g === G('N-102') ? '가상인' : ''));
  assert.deepEqual(k.preset, { target: 't', from: '가상인', to: '', from_gid: G('N-102'), to_gid: '' });
});

// ── R11-13 ①: 초안을 만든 뒤 rerun + 새 사람 ──
test('R11-13 ①: 초안을 만든 뒤 창이 다시 그려질 때(rerun) 「＋ 사람 추가」로 넣은 사람이 받는 사람으로 골라지고, 같은 이름이 이미 있어도 새 사람이다', withDom(() => {
  const view1 = viewOfDoc(docWith());
  const a = openDraft(view1);
  a.q('draft-target').value = G('N-001');
  a.q('draft-from').value = G('N-101');
  a.q('draft-to').value = G('N-103');
  a.q('draft-form').fire('submit'); // 초안을 만들어 기억한다(마지막 받는 사람 = 다른이)
  a.q('draft-add-person').click();
  a.q('draft-new-person-name').value = '다른이'; // 이미 있는 이름
  a.q('draft-new-person-add').click();
  uninstallDom();
  // main이 사람을 만들고 창을 다시 그린다: 지금 칸 값을 preset으로, 만든 적이 있으니 rerun:true
  const view2 = viewOfDoc(docWith([mkNode('N-104', 'person', '다른이')]));
  const picked = keepDraftPick({ target: G('N-001') }, { target: G('N-001'), from: G('N-101'), to: G('N-103') }, (g) => (view2.getNode(g) || {}).label || '');
  const b = openDraft(view2, { target: picked.target, preset: picked.preset, rerun: true });
  assert.equal(b.q('draft-to').value, G('N-104'), '새로 만든 사람(같은 이름의 기존 N-103이 아님)');
  assert.equal(b.q('draft-from').value, G('N-101'));
  assert.equal(b.qa('[data-testid^=draft-item-]').length, 10, '같은 선택으로 초안이 다시 만들어진다');
}));

// ── R11-7: 지금 칸 값 우선, 실시간 호출 금지 ──
test('R11-7: 다시 그려진 창(rerun)은 기억한 마지막 선택이 아니라 지금 칸 값(preset·target)을 쓴다', withDom(() => {
  const view = viewOfDoc(docWith());
  const a = openDraft(view);
  a.q('draft-target').value = G('N-001');
  a.q('draft-from').value = G('N-101');
  a.q('draft-to').value = G('N-103');
  a.q('draft-form').fire('submit'); // 기억: 101 → 103
  uninstallDom();
  // 사람이 칸을 102 → 101로 바꾼 뒤 기록이 바뀌어 다시 그려짐
  const b = openDraft(view, { target: G('N-001'), preset: { target: G('N-001'), from: '가상인', from_gid: G('N-102'), to: '가상인', to_gid: G('N-101') }, rerun: true });
  assert.equal(b.q('draft-from').value, G('N-102'));
  assert.equal(b.q('draft-to').value, G('N-101'));
  assert.equal(b.qa('[data-testid^=draft-item-]').length, 10);
  assert.equal(b.q('draft-rerun-note').hidden, false);
}));

test('R11-7: 지금 칸의 받는 사람이 일부러 비어 있으면(preset) 기억으로 채워 자동으로 만들지 않는다', withDom(() => {
  const view = viewOfDoc(docWith());
  const a = openDraft(view);
  a.q('draft-target').value = G('N-001');
  a.q('draft-from').value = G('N-101');
  a.q('draft-to').value = G('N-103');
  a.q('draft-form').fire('submit');
  uninstallDom();
  const b = openDraft(view, { target: G('N-001'), preset: { target: G('N-001'), from: '가상인', from_gid: G('N-101'), to: '', to_gid: '' }, rerun: true });
  assert.equal(b.q('draft-to').value, '');
  assert.equal(b.qa('[data-testid^=draft-item-]').length, 0);
  assert.equal(b.q('draft-message').textContent, '');
}));

test('R11-7: 대상 칸이 비어 있을 때만 마지막으로 만든 대상을 쓴다', withDom(() => {
  const view = viewOfDoc(docWith());
  const a = openDraft(view);
  a.q('draft-target').value = G('N-001');
  a.q('draft-from').value = G('N-101');
  a.q('draft-to').value = G('N-103');
  a.q('draft-form').fire('submit');
  uninstallDom();
  const b = openDraft(view, { rerun: true });
  assert.equal(b.q('draft-target').value, G('N-001'));
  uninstallDom();
  const c = openDraft(view, { target: G('N-000'), preset: { target: G('N-000'), from: '가상인', from_gid: G('N-101'), to: '다른이', to_gid: G('N-103') }, rerun: true });
  assert.equal(c.q('draft-target').value, G('N-000'), '지금 칸의 대상이 우선');
}));

test('R11-7: rerunNote:false(기록은 그대로, 화면 조건만 바뀐 다시 그리기)면 초안은 다시 만들되 「기록이 바뀌어」 안내는 없다', withDom(() => {
  const view = viewOfDoc(docWith());
  const a = openDraft(view);
  a.q('draft-target').value = G('N-001');
  a.q('draft-from').value = G('N-101');
  a.q('draft-to').value = G('N-103');
  a.q('draft-form').fire('submit');
  uninstallDom();
  const b = openDraft(view, { rerun: true, rerunNote: false });
  assert.equal(b.qa('[data-testid^=draft-item-]').length, 10);
  assert.equal(b.q('draft-rerun-note').hidden, true);
  assert.equal(RERUN_NOTE, '기록이 바뀌어 초안을 다시 만들었습니다');
}));

test('R11-7: 키가 있어도 자동으로 다시 만든 초안은 Claude를 부르지 않는다 — 「초안 만들기」를 눌러야 호출한다', async () => {
  // 받아 둔 응답(캐시)이 호출을 가리지 않도록 빈 캐시의 새 공급자를 쓴다
  const fake = createFakeClient({ delayMs: 5 });
  const live = createProvider('claude_api', { pregen: PREGEN, apiKey: FAKE_KEY, client: fake, cache: createLlmCache(null) });
  forgetLastPeople();
  const view = viewOf('U-A1'); // 근거가 있는 항목이 있어야 실시간 호출이 일어난다
  const pick = (o) => { o.q('draft-target').value = 'U-A1/N-000'; o.q('draft-from').value = 'U-A1/N-011'; o.q('draft-to').value = 'U-A1/N-012'; };
  try {
    // 사람이 한 번 만들어 마지막 선택을 기억시킨다(이 호출은 다른 공급자로: 위의 fake에는 기록하지 않는다)
    const other = createProvider('claude_api', { pregen: PREGEN, apiKey: FAKE_KEY, client: createFakeClient({ delayMs: 5 }), cache: createLlmCache(null) });
    const a = openDraft(view, { provider: other });
    pick(a);
    a.q('draft-form').fire('submit');
    await sleep(100);
    uninstallDom();
    // 다시 그려진 창(rerun): 자동으로 다시 만들지만 Claude는 부르지 않는다
    const b = openDraft(view, { provider: live, rerun: true, onConfirm: () => ({ ok: true }) });
    await sleep(100);
    assert.equal(fake.calls.length, 0, '자동 다시 만들기는 호출하지 않는다');
    assert.equal(b.qa('[data-testid^=draft-item-]').length, 10, '동기 결과(규칙·사전 생성)는 그려진다');
    assert.equal(b.q('draft-live').textContent, LIVE_RERUN_NOTE);
    assert.equal(b.q('draft-confirm').disabled, false, '생성 중이 아니므로 확정이 잠기지 않는다');
    b.q('draft-form').fire('submit'); // 사람이 누르면 호출한다
    await sleep(100);
    assert.ok(fake.calls.length >= 1, '누르면 호출');
  } finally {
    uninstallDom();
    forgetLastPeople();
  }
});

// ── R11-5 판 표지 ──
test('R11-5 sameMark: 값이 모두 === 로 같을 때만 같은 판, 없으면 다른 판', () => {
  const doc = {};
  assert.equal(sameMark({ doc, n: 3 }, { doc, n: 3 }), true);
  assert.equal(sameMark({ doc, n: 3 }, { doc: {}, n: 3 }), false, '문서 객체가 다르면 다른 판');
  assert.equal(sameMark({ doc, n: 3 }, { doc, n: 4 }), false);
  assert.equal(sameMark({ doc, n: 3 }, { doc }), false, '칸 수가 다르면 다른 판');
  assert.equal(sameMark(null, { doc }), false);
  assert.equal(sameMark({ doc }, null), false);
  assert.equal(sameMark({}, {}), true);
});

// ── R11-10 문구 ──
test('R11-10: 사전 생성+규칙 섞임 안내, 내 지도 안내, 연관 찾기 전송 내용', () => {
  assert.equal(liveHintFor('pregen', { rule: 0, provider: 10 }), LIVE_HINT_PREGEN);
  assert.equal(liveHintFor('pregen', { rule: 3, provider: 7 }), LIVE_HINT_MIXED);
  assert.equal(liveHintFor('pregen'), LIVE_HINT_PREGEN);
  assert.equal(liveHintFor('rule', { rule: 10 }), LIVE_HINT_RULE);
  assert.match(LIVE_HINT_MIXED, /^일부는 미리 받아 둔 문장, 나머지는 기록을 모은 문장입니다\./);
  assert.match(PREGEN_MINE, /「설정」에서 Claude API를 고르고 키를 넣으면 Claude가 그 자리에서 씁니다/);
  assert.ok(!PREGEN_MINE.includes('키가 있으면 Claude가'));
  const sent = SECURITY_ITEMS.find((i) => i.term === '밖으로 무엇이 나가나요').desc;
  assert.ok(sent.includes('업무가 속한 지도 이름'), '연관 찾기는 업무가 속한 지도 이름도 보낸다(llm/ai-candidates.js collectWorks의 universe_name)');
});

test('R11-10 ④: 사전 생성 초안에 규칙 기반 항목이 섞이면 맨 아래 안내가 「일부는 미리 받아 둔…」, 전부 사전 생성이면 「지금 문장은 미리 받아 둔 것」', withDom(() => {
  const pregen = createProvider('pregen', { pregen: PREGEN });
  const make = (view) => {
    const o = openDraft(view, { provider: pregen });
    o.q('draft-target').value = 'U-A1/N-000';
    o.q('draft-from').value = 'U-A1/N-011';
    o.q('draft-to').value = 'U-A1/N-012';
    o.q('draft-form').fire('submit');
    return o;
  };
  const same = make(viewOf('U-A1'));
  assert.equal(same.q('draft-live-hint').textContent, LIVE_HINT_PREGEN);
  uninstallDom();
  // 설명을 바꿔 두 항목의 지문이 달라지면 그 항목만 규칙 기반이 된다
  const doc = clone(allSamples()['U-A1']);
  for (const n of doc.nodes) if (n.id === 'N-000' || n.core_type === 'work') n.description = `${n.description || ''} 추가`;
  const mixed = make(viewOf('U-A1', { 'U-A1': doc }));
  assert.match(mixed.q('draft-counts').textContent, /나머지 2개는/);
  assert.equal(mixed.q('draft-live-hint').textContent, LIVE_HINT_MIXED);
}));

// ── R11-11: 팀 따라 하기 두 순서 ──
test('R11-11·CR-17 K: 기본 순서는 위험 요약 먼저(TEAM_ORDER), D-29 판(펼치기 → 찾기 → 주변만 → 전체 보기 → 「인사이트 보기」 → 「반복 비효율」 탭)도 상수만 바꾸면', () => {
  assert.equal(TEAM_ORDER, 'risk-first');
  assert.deepEqual(Object.keys(TEAM_ORDERS).sort(), ['d29', 'risk-first']);
  const d29 = teamScenario('d29');
  assert.deepEqual(scenarioOf('team').steps.map((s) => s.id), ['risk', 'expand', 'find', 'neighborhood', 'full']);
  assert.deepEqual(d29.steps.map((s) => s.id), ['expand', 'find', 'neighborhood', 'full', 'insight']);
  assert.deepEqual(teamScenario('d29').steps.map((s) => s.id), ['expand', 'find', 'neighborhood', 'full', 'insight']);
  assert.deepEqual(teamScenario('risk-first').steps.map((s) => s.id), ['risk', 'expand', 'find', 'neighborhood', 'full']);
  assert.deepEqual(teamScenario('모르는 이름').steps.map((s) => s.id), scenarioOf('team').steps.map((s) => s.id), '모르는 이름은 기본 순서');
  for (const order of Object.keys(TEAM_ORDERS)) assert.equal(teamScenario(order).steps.length, 5, order);
  assert.equal(teamScenario('risk-first').universeId, 'U-D1');
});

test('R11-11: D-29 판의 마지막 단계 — 「인사이트 보기」 → 「반복 비효율」 탭을 눌러야 끝, 열린 탭이 인수인계 위험이면 아직', () => {
  const last = teamScenario('d29').steps[4];
  assert.equal(last.id, 'insight');
  assert.equal(last.task, '빈 곳을 눌러 선택을 풀고 「인사이트 보기」를 누르세요. 맨 먼저 「인수인계 위험」(한 사람만 해 본 일)이 열립니다. 이어서 「반복 비효율」 탭을 누르세요.');
  assert.deepEqual(quotedNames(last.task), ['인사이트 보기', '인수인계 위험', '반복 비효율']);
  const s = emptyState('U-D1');
  assert.equal(last.done(s), false);
  assert.equal(last.done({ ...s, insightOpen: true, insightKind: 'risk' }), false, '기본 탭만 열린 것은 끝이 아니다');
  assert.equal(last.done({ ...s, insightOpen: true, insightKind: 'similar' }), false);
  assert.equal(last.done({ ...s, insightOpen: true, insightKind: 'repeat' }), true);
  assert.equal(last.target(s)[0].sel, '[data-testid=btn-insight-universe]');
  assert.equal(last.target({ ...s, selected: 'U-A1/N-001' })[0].hint, '여기 빈 곳을 누르세요');
  assert.equal(last.target({ ...s, insightOpen: true, insightKind: 'risk' })[0].sel, '[data-testid=tab-repeat]');
});

test('R11-11: D-29 판 advance — 찾기·주변만 보기·전체 보기를 차례로, 마지막은 반복 비효율 탭에서 끝', () => {
  const sc = teamScenario('d29');
  const s = emptyState('U-D1');
  assert.equal(advance(sc, 0, s), 0);
  assert.equal(advance(sc, 0, { ...s, expandedCount: 1 }), 1);
  assert.equal(advance(sc, 1, { ...s, expandedCount: 1, foundGid: 'U-A1/N-001' }), 2);
  assert.equal(advance(sc, 2, { ...s, nbhd: true }), 3, '주변만 보기를 누르면 「전체 보기」 단계로');
  const base = { ...s, expandedCount: 1, foundGid: 'U-A1/N-001' };
  assert.equal(advance(sc, 0, { ...base, nbhd: true }), 3, '주변만 보기를 누른 직후에는 「전체 보기」 단계에서 멈춘다');
  assert.equal(advance(sc, 0, { ...base, nbhd: false }), 2, '아직 주변만 보기를 누르지 않았다');
  assert.equal(advance(sc, 3, { ...base, nbhd: false }), 4, '전체 보기로 돌아오면 마지막 단계(인사이트)');
  assert.equal(advance(sc, 4, { ...base, insightOpen: true, insightKind: 'risk' }), 4);
  assert.equal(advance(sc, 4, { ...base, insightOpen: true, insightKind: 'repeat' }), 5, '반복 비효율 탭에서 끝');
});

test('R11-11: 위험 요약 먼저 판 — 「자세히」로 인수인계 위험을 열면 첫 단계가 끝나고, 마지막은 전체 보기', () => {
  const sc = teamScenario('risk-first');
  const s = emptyState('U-D1');
  assert.equal(advance(sc, 0, s), 0);
  assert.equal(advance(sc, 0, { ...s, insightOpen: true, insightKind: 'similar' }), 0);
  assert.equal(advance(sc, 0, { ...s, insightOpen: true, insightKind: 'risk' }), 1);
  const base = { ...s, expandedCount: 1, foundGid: 'U-A1/N-001', insightOpen: true, insightKind: 'risk' };
  assert.equal(advance(sc, 0, { ...base, nbhd: true }), 4);
  assert.equal(advance(sc, 4, { ...base, nbhd: false }), 5);
  assert.equal(sc.steps[0].target(s)[0].sel, '[data-testid=btn-team-risk-more]');
  assert.deepEqual(sc.steps[0].target({ ...s, selected: 'U-A1/N-001' })[1], { sel: '#graph', hint: '여기 빈 곳을 누르세요' });
});
