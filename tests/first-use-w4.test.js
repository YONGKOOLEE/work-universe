// 처음 사용 점검 2회차(2026-10-24, docs/first-use-2026-10-24.md) W4 몫: FU-24 초안 문구·키 없을 때 한 줄, FU-25 설정 순서·「고급」,
// FU-28 첫 카드 설명, FU-29 근거 칩 → 근거 글, FU-36 「＋ 사람 추가」 작은 칸·받는 사람 자동 선택. DOM 흉내(tests/dom-stub.js)만 쓴다. 가상 데이터만 쓴다.
// 실제 브라우저 점검(tools/browser-check.mjs 「처음 사용 W4」)을 대신하지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PREGEN } from '../app/data/pregen.js';
import { createLlmCache } from '../app/src/store/local.js';
import { PROVIDERS, createProvider } from '../app/src/llm/providers.js';
import { createFakeClient } from '../app/src/llm/fake-client.js';
import { LIVE_HINT, PREGEN_NOTE, draftPanel, forgetLastPeople } from '../app/src/ui/draft.js';
import { pickNewPerson } from '../app/src/ui/draft-hints.js';
import { evidenceChips, readableEvidence } from '../app/src/ui/evidence.js';
import { HELP_GEN } from '../app/src/ui/help.js';
import { displayProviders, settingsPanel } from '../app/src/ui/settings.js';
import { startScreen } from '../app/src/ui/start.js';
import { PREGEN_ASOF } from '../tools/pregen-scenarios.mjs';
import { viewOf } from './helpers.js';
import { installDom, uninstallDom } from './dom-stub.js';

const FAKE_KEY = ['sk', 'ant', 'x'.repeat(8), 'FAKEKEY', 'y'.repeat(12)].join('-');
const pregen = createProvider('pregen', { pregen: PREGEN });
const none = createProvider('none', {});
const live = createProvider('claude_api', { pregen: PREGEN, apiKey: FAKE_KEY, client: createFakeClient({ delayMs: 10 }), cache: createLlmCache(null) });
const view = viewOf('U-A1');

function openDraft(provider, over = {}) {
  const body = installDom();
  const events = [];
  globalThis.document.dispatchEvent = (e) => { events.push(e); return true; };
  const panel = draftPanel({ view, provider, asOf: PREGEN_ASOF, onFocus() {}, onClose() {}, ...over });
  body.append(panel);
  const q = (id) => panel.querySelector(`[data-testid=${id}]`);
  const make = (t = 'U-A1/N-000', f = 'U-A1/N-011', to = 'U-A1/N-012') => {
    q('draft-target').value = t;
    q('draft-from').value = f;
    q('draft-to').value = to;
    q('draft-form').fire('submit');
  };
  return { q, qa: (sel) => panel.querySelectorAll(sel), make, events, panel };
}
const withDom = (fn) => async () => {
  forgetLastPeople();
  try { await fn(); } finally { uninstallDom(); forgetLastPeople(); }
};

test('FU-24: 사전 생성 안내는 "써 둔 문장"이라고 말하고, 옛 "개발 중" 문구가 없다', withDom(() => {
  const { q, make, panel } = openDraft(pregen);
  make();
  assert.equal(q('draft-method-note').textContent, 'Claude가 이 기록만 보고 써 둔 문장입니다. 열 때마다 앱이 근거를 검사하고, 맞지 않으면 기록을 그대로 모은 문장으로 바꿉니다.');
  assert.equal(PREGEN_NOTE, q('draft-method-note').textContent);
  assert.ok(!panel.textContent.includes('개발 중'));
  assert.ok(!HELP_GEN.some((g) => g.desc.includes('개발 중')));
  assert.equal(HELP_GEN.find((g) => g.term === '사전 생성').desc, PREGEN_NOTE);
  const chip = q('item-method');
  assert.ok(chip.getAttribute('title').startsWith('Claude가 이 기록만 보고 써 둔 문장'));
}));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('FU-24: 실시간 안내 한 줄(draft-live-hint)은 키가 없고 사전 생성·규칙 기반일 때만, 결과 위(제목 다음)에 보인다', withDom(async () => {
  const a = openDraft(pregen);
  assert.equal(a.q('draft-live-hint'), null, '만들기 전에는 결과가 없다');
  a.make();
  assert.equal(a.q('draft-live-hint').textContent, '실시간으로 다시 쓰려면: 「설정」에서 Claude API를 고르고 본인 키를 넣으세요(선택)');
  assert.equal(LIVE_HINT, a.q('draft-live-hint').textContent);
  const kids = a.q('draft-result').childNodes.filter((c) => c.nodeType === 1);
  const idx = (id) => kids.findIndex((k) => k.dataset.testid === id);
  assert.ok(idx('draft-live-hint') > -1 && idx('draft-live-hint') < idx('draft-item-업무_개요'), '항목보다 위');
  uninstallDom();
  const b = openDraft(none); // 규칙 기반만
  b.make();
  assert.equal(b.q('draft-method').textContent.includes('규칙 기반'), true);
  assert.ok(b.q('draft-live-hint'));
  uninstallDom();
  const c = openDraft(live); // 키가 있으면 그리지 않는다(사전 생성 문장을 먼저 그리는 동안에도)
  c.make();
  assert.equal(c.q('draft-live-hint'), null);
  await sleep(120); // 응답이 와서 다시 그려진 뒤에도 없다
  assert.equal(c.q('draft-live-hint'), null);
}));

test('FU-25: 설정 화면에서 「사내 LLM」은 맨 아래(점검용 실패 흉내 제외), providers.js 배열 순서는 그대로', withDom(() => {
  assert.deepEqual(displayProviders(PROVIDERS).map((p) => p.name), ['pregen', 'none', 'claude_api', 'fail', 'internal']);
  assert.deepEqual(PROVIDERS.map((p) => p.name), ['pregen', 'none', 'claude_api', 'internal', 'fail']); // 원본은 바꾸지 않았다
  const body = installDom();
  const panel = settingsPanel({ current: 'pregen', persisted: true, onAuthorName() {}, onChange() {}, onClose() {} });
  body.append(panel);
  const order = panel.querySelectorAll('[data-testid^=provider-]').map((n) => n.dataset.testid);
  assert.deepEqual(order, ['provider-pregen', 'provider-none', 'provider-claude_api', 'provider-internal']);
  assert.ok(!panel.textContent.includes('개발 중'));
}));

test('FU-28: 첫 카드 설명은 넘기는 쪽도 받는 쪽도', withDom(() => {
  const body = installDom();
  const root = startScreen({ universes: [], guide: {}, warnings: [], readOnly: false, onOpen() {}, onCreate() {}, onTour() {} });
  body.append(root);
  const card = root.querySelector('[data-testid=start-way-handover]');
  assert.ok(card.textContent.includes('넘기는 쪽도 받는 쪽도 — 예시 업무로 인수인계 초안을 봅니다(3분)'));
}));

test('FU-29: 근거 칩을 누르면 칩 묶음 아래에 근거 글 한 줄 — 다시 누르면 접히고 다른 칩이면 바뀐다', withDom(() => {
  const body = installDom();
  const focused = [];
  const ev = view.events.find((e) => e.occurred_at);
  const list = evidenceChips(view, ['U-A1/N-001', ev.gid], (g) => focused.push(g), { dedupe: false, unknown: true, showText: true });
  body.append(list);
  const chips = list.querySelectorAll('button');
  assert.equal(chips.length, 2);
  assert.equal(list.querySelector('[data-testid=evidence-text]'), null);
  chips[0].click();
  assert.equal(focused.length, 1, '그래프에서 빛나는 기존 동작은 그대로');
  const t1 = list.querySelector('[data-testid=evidence-text]').textContent;
  assert.equal(t1, readableEvidence(view, 'U-A1/N-001'));
  assert.ok(t1.startsWith('[업무') && !t1.startsWith('U-A1/'), t1); // 앞의 gid는 뗀다
  assert.equal(chips[0].getAttribute('aria-pressed'), 'true');
  chips[1].click();
  const t2 = list.querySelector('[data-testid=evidence-text]').textContent;
  assert.notEqual(t2, t1);
  assert.match(t2, /^\[이력\] \d{4}-\d{2}-\d{2} /, t2);
  assert.equal(list.querySelectorAll('[data-testid=evidence-text]').length, 1);
  assert.equal(chips[0].getAttribute('aria-pressed'), 'false');
  chips[1].click(); // 같은 칩을 다시
  assert.equal(list.querySelector('[data-testid=evidence-text]'), null);
  // showText를 켜지 않으면 기존 모양 그대로(인사이트 등)
  const plain = evidenceChips(view, ['U-A1/N-001'], () => {});
  body.append(plain);
  plain.querySelector('button').click();
  assert.equal(plain.querySelector('[data-testid=evidence-text]'), null);
  assert.equal(plain.childNodes.length, 1);
}));

test('FU-29: readableEvidence — 노드는 gid만 떼고, 이력은 「[이력] 날짜 내용」, 없는 근거는 안내', () => {
  assert.match(readableEvidence(view, 'U-A1/N-001'), /^\[업무.*\] 대사 확인/);
  assert.equal(readableEvidence(view, 'U-A1/없는것'), '근거 U-A1/없는것: 지금 화면의 기록에서 찾을 수 없습니다');
});

test('FU-29: 초안 화면의 근거 칩이 근거 글을 연다(evidence-text)', withDom(() => {
  const { q, qa, make } = openDraft(pregen);
  make();
  assert.equal(q('evidence-text'), null);
  const first = qa('button').find((b) => b.className.includes('evidence'));
  first.click();
  assert.ok(q('evidence-text').textContent.length > 5);
}));

test('FU-36: 「＋ 사람 추가」 → 작은 칸 → 「넣기」는 wu:add-node(label, 연락처)만 보내고, 이름이 비면 안내만', withDom(() => {
  const { q, events } = openDraft(pregen, { target: 'U-A1/N-000' });
  assert.equal(q('draft-new-person').hidden, true);
  q('draft-add-person').click();
  assert.equal(q('draft-new-person').hidden, false);
  assert.equal(events.length, 0);
  q('draft-new-person-name').value = '  ';
  q('draft-new-person-add').click();
  assert.equal(events.length, 0);
  assert.equal(q('draft-new-person-msg').textContent, '이름을 적으세요.');
  q('draft-new-person-name').value = '새사람';
  q('draft-new-person-contact').value = '내선 1234';
  q('draft-new-person-add').click();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'wu:add-node');
  assert.deepEqual(events[0].detail, { type: 'person', label: '새사람', attrs: { 연락처: '내선 1234' } });
  assert.equal(q('draft-new-person').hidden, true, '넣은 뒤 작은 칸은 닫힌다');
  assert.equal(q('draft-new-person-name').value, '');
}));

test('FU-36: 다시 그려진 초안 창은 새 사람을 받는 사람으로, 앞서 고른 대상·보내는 사람을 되살려 고른다', withDom(() => {
  const a = openDraft(pregen);
  a.q('draft-from').value = 'U-A1/N-011';
  a.q('draft-add-person').click();
  a.q('draft-new-person-name').value = '서하늘'; // 이미 있는 이름이어도 가장 나중 사람을 고른다(샘플의 서하늘 하나)
  a.q('draft-new-person-add').click();
  uninstallDom();
  const b = openDraft(pregen);
  assert.equal(b.q('draft-to').value, 'U-A1/N-012');
  assert.equal(b.q('draft-from').value, 'U-A1/N-011');
  uninstallDom();
  const c = openDraft(pregen); // 한 번만 쓴다
  assert.equal(c.q('draft-to').value, '');
}));

test('FU-36: pickNewPerson — 같은 이름이 여럿이면 맨 끝 사람, 없으면 null', () => {
  const people = [{ gid: 'a', label: '가' }, { gid: 'b', label: '나' }, { gid: 'c', label: '가' }];
  assert.equal(pickNewPerson(people, '가'), 'c');
  assert.equal(pickNewPerson(people, '다'), null);
  assert.equal(pickNewPerson([], '가'), null);
});
