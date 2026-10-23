// 처음 사용 점검 3회차(2026-10-24) W6 몫: 키 없음 안내 문구·한 번만, 반복 비효율 중복 문장, 사전 생성의 정체, 초안 맨 아래 안내·「다음에 해 볼 것」,
// rerun 자동 실행, 도움말·설정의 키·데이터 설명. DOM 흉내(tests/dom-stub.js)만 쓴다. 가상 데이터만 쓴다.
// 실제 브라우저 점검(tools/browser-check.mjs 「처음 사용 W6」)을 대신하지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PREGEN } from '../app/data/pregen.js';
import { KEYLESS_CONVERT_REASON, KEYLESS_REASON, REASON_PREFIX, createProvider } from '../app/src/llm/providers.js';
import { DRAFT_NEXT_OVERVIEW, DRAFT_NEXT_RISK, RERUN_NOTE, draftPanel, forgetLastPeople } from '../app/src/ui/draft.js';
import { EXPLAIN_SAME_AS_BELOW, KEY_NOTE, PREGEN_NOTE, PREGEN_NOTE_FULL, SECURITY_ITEMS, pregenDate } from '../app/src/ui/ai-notes.js';
import { HELP_GEN, helpPanel } from '../app/src/ui/help.js';
import { insightPanel } from '../app/src/ui/insight.js';
import { settingsPanel } from '../app/src/ui/settings.js';
import { PREGEN_ASOF } from '../tools/pregen-scenarios.mjs';
import { viewOf } from './helpers.js';
import { FakeEl, installDom, uninstallDom } from './dom-stub.js';

// 설정 화면의 키 칸이 쓰는 after()를 흉내 내는 DOM 스텁에 없어서, 이 시험 파일 안에서만 채운다
if (!FakeEl.prototype.after) {
  FakeEl.prototype.after = function after(node) {
    const parent = this.parentNode;
    parent.childNodes.splice(parent.childNodes.indexOf(this) + 1, 0, node);
    node.parentNode = parent;
  };
}

const keyless = createProvider('claude_api', { pregen: PREGEN, apiKey: '' });
const pregen = createProvider('pregen', { pregen: PREGEN });
const failing = createProvider('fail', {});
const view = viewOf('U-A1');

function openDraft(provider, over = {}) {
  const body = installDom();
  const events = [];
  globalThis.document.dispatchEvent = (e) => { events.push(e); return true; };
  const panel = draftPanel({ view, provider, asOf: PREGEN_ASOF, onFocus() {}, onClose() {}, ...over });
  body.append(panel);
  const q = (id) => panel.querySelector(`[data-testid=${id}]`);
  const make = () => {
    q('draft-target').value = 'U-A1/N-000';
    q('draft-from').value = 'U-A1/N-011';
    q('draft-to').value = 'U-A1/N-012';
    q('draft-form').fire('submit');
  };
  return { q, qa: (sel) => panel.querySelectorAll(sel), make, events, panel };
}
const withDom = (fn) => async () => {
  forgetLastPeople();
  try { await fn(); } finally { uninstallDom(); forgetLastPeople(); }
};

test('키 없음 안내(초안): 「공급자 오류」 머리말·「대체함」·노란 띠 없이 실제 방식에 맞는 한 줄, 원인 코드는 그대로', withDom(() => {
  const { q, make } = openDraft(keyless);
  make();
  const fb = q('draft-fallback');
  assert.equal(fb.textContent, KEYLESS_REASON);
  assert.equal(KEYLESS_REASON, '키가 없어 기록을 그대로 모은 문장(규칙 기반)으로 보여 줍니다 — 「설정」에서 키를 넣으면 Claude가 실시간으로 다시 씁니다');
  assert.ok(!fb.textContent.includes('공급자 오류') && !fb.textContent.includes('사전 생성') && !fb.textContent.includes('대체함'));
  assert.ok(!fb.className.includes('notice'), '고장처럼 읽히는 노란 띠가 아니다');
  assert.equal(fb.dataset.keyless, 'true');
  assert.equal(q('draft-method').textContent, '생성 방식: 규칙 기반'); // 실제로 쓴 방식과 맞는다
  assert.equal(q('draft-live-hint'), null, '같은 말을 하는 안내가 이미 있어 맨 아래 줄은 그리지 않는다');
  assert.ok(q('draft-next'));
}));

test('진짜 오류(호출 실패 흉내)는 지금처럼 노란 띠와 원인, 머리말은 「연결 오류」', withDom(() => {
  const { q, make } = openDraft(failing);
  make();
  const fb = q('draft-fallback');
  assert.equal(fb.textContent, `규칙 기반으로 대체함: ${REASON_PREFIX}호출 실패(점검용 흉내)`);
  assert.ok(fb.className.includes('notice'));
  assert.equal(fb.dataset.keyless, undefined);
  assert.ok(!fb.textContent.includes('공급자 오류'));
  assert.ok(q('draft-live-hint'), '키 없음 안내가 아니면 맨 아래 한 줄은 그대로');
}));

test('초안 맨 아래: 「다음에 해 볼 것」 두 링크가 약속한 이벤트를 보내고, 안내 한 줄이 그 아래 맨 끝이다', withDom(() => {
  const { q, make, events } = openDraft(pregen);
  make();
  const kids = q('draft-result').childNodes.filter((c) => c.nodeType === 1).map((c) => c.dataset.testid);
  assert.deepEqual(kids.slice(-2), ['draft-next', 'draft-live-hint']);
  assert.ok(q('draft-next').textContent.startsWith('다음에 해 볼 것:'));
  q('draft-next-risk').click();
  q('draft-next-overview').click();
  assert.equal(q('draft-next-risk').textContent, DRAFT_NEXT_RISK);
  assert.equal(q('draft-next-overview').textContent, DRAFT_NEXT_OVERVIEW);
  assert.deepEqual(events.map((e) => e.type), ['wu:open-insight', 'wu:overview']);
  assert.deepEqual(events[0].detail, { kind: 'risk' });
}));

test('읽기 전용에서도 「다음에 해 볼 것」은 보인다(보기만 하는 이동)', withDom(() => {
  const { q, make } = openDraft(pregen, { readOnly: true });
  make();
  assert.ok(q('draft-next-risk') && q('draft-next-overview'));
}));

test('rerun: 같은 지도에서 이미 만든 선택으로 초안을 자동으로 다시 만들고 결과 위에 한 줄', withDom(() => {
  const first = openDraft(pregen);
  assert.equal(first.q('draft-rerun-note').hidden, true);
  first.make();
  assert.equal(first.q('draft-rerun-note').hidden, true, '직접 만들었을 때는 한 줄이 없다');
  uninstallDom();
  const again = openDraft(pregen, { rerun: true });
  assert.equal(again.qa('[data-testid^=draft-item-]').length, 10, '누르지 않아도 10개 항목이 그려진다');
  assert.equal(again.q('draft-rerun-note').hidden, false);
  assert.equal(again.q('draft-rerun-note').textContent, RERUN_NOTE);
  assert.equal(RERUN_NOTE, '기록이 바뀌어 초안을 다시 만들었습니다');
  assert.equal(again.q('draft-target').value, 'U-A1/N-000');
  // 사람이 직접 「초안 만들기」를 누르면 한 줄은 사라진다
  again.q('draft-form').fire('submit');
  assert.equal(again.q('draft-rerun-note').hidden, true);
}));

test('rerun: rerun이 아니거나 선택이 불완전하면 자동으로 만들지 않는다', withDom(() => {
  const a = openDraft(pregen);
  a.make();
  uninstallDom();
  const plain = openDraft(pregen); // rerun 없음: 사람이 누를 때까지 결과 없음
  assert.equal(plain.qa('[data-testid^=draft-item-]').length, 0);
  uninstallDom();
  forgetLastPeople(); // 기억이 없으면 선택이 비어 있다
  const empty = openDraft(pregen, { rerun: true });
  assert.equal(empty.qa('[data-testid^=draft-item-]').length, 0);
  assert.equal(empty.q('draft-rerun-note').hidden, true);
  assert.equal(empty.q('draft-message').textContent, '', '오류 문구도 띄우지 않는다');
}));

const insight = (provider, kind, id = 'U-A1') => insightPanel({ view: viewOf(id), provider, kind, asOf: PREGEN_ASOF, today: PREGEN_ASOF, onFocus() {}, onClose() {} });

test('키 없음 안내(인사이트): 탭 맨 위에 한 번만, 설명 상자마다 되풀이하지 않는다', withDom(() => {
  const body = installDom();
  const panel = insight(keyless, 'risk');
  body.append(panel);
  assert.equal(panel.querySelectorAll('[data-testid=insight-keyless]').length, 1);
  assert.equal(panel.querySelector('[data-testid=insight-keyless]').textContent, KEYLESS_REASON);
  assert.ok(panel.querySelectorAll('[data-testid=insight-explain]').length >= 2, '설명 상자는 여러 개');
  assert.equal(panel.querySelectorAll('[data-testid=explain-fallback]').length, 0);
  assert.ok(panel.querySelectorAll('[data-testid=insight-explain]').every((b) => b.dataset.method === 'rule'), '상자의 방식은 규칙 기반 그대로');
  // 첫 번째 탭 버튼보다 앞
  const kids = panel.childNodes.filter((c) => c.nodeType === 1);
  assert.ok(kids.findIndex((k) => k.dataset.testid === 'insight-keyless') < kids.findIndex((k) => k.className === 'tabs'), '탭 줄보다 위');
  // 키가 없는 경우가 아니면 이 줄이 없다
  uninstallDom();
  const body2 = installDom();
  const plain = insight(pregen, 'risk');
  body2.append(plain);
  assert.equal(plain.querySelectorAll('[data-testid=insight-keyless]').length, 0);
}));

test('진짜 오류(호출 실패 흉내)는 인사이트 상자마다 원인이 보인다(머리말 「연결 오류」)', withDom(() => {
  const body = installDom();
  const panel = insight(failing, 'risk');
  body.append(panel);
  const fbs = panel.querySelectorAll('[data-testid=explain-fallback]');
  assert.ok(fbs.length >= 2);
  assert.ok(fbs.every((f) => f.textContent === `규칙 기반으로 대체함: ${REASON_PREFIX}호출 실패(점검용 흉내)`));
  assert.equal(panel.querySelectorAll('[data-testid=insight-keyless]').length, 0);
}));

test('반복 비효율: 규칙 기반 설명이 아래 카드와 같은 글이면 문장을 다시 쓰지 않고 안내만', withDom(() => {
  const body = installDom();
  const panel = insight(keyless, 'repeat', 'U-D1');
  body.append(panel);
  const patterns = panel.querySelector('[data-testid=repeat-patterns]');
  assert.ok(patterns, '이 데이터에는 반복 패턴이 있다');
  const box = panel.querySelector('[data-testid=insight-explain]');
  assert.equal(box.dataset.method, 'rule');
  assert.equal(box.dataset.dup, 'true');
  assert.equal(box.querySelector('[data-testid=explain-same-note]').textContent, EXPLAIN_SAME_AS_BELOW);
  assert.equal(EXPLAIN_SAME_AS_BELOW, '아래 근거를 요약한 문장이 없습니다(규칙 기반)');
  assert.equal(box.querySelectorAll('li').length, 0, '카드와 같은 문장을 목록으로 다시 쓰지 않는다');
  // 카드 문장은 그대로 한 번 보인다
  assert.ok(patterns.querySelectorAll('li').length >= 1);
}));

test('반복 비효율 외 탭은 규칙 기반 설명 문장을 그대로 보인다(카드와 다른 요약 문장)', withDom(() => {
  const body = installDom();
  const panel = insight(keyless, 'density', 'U-D1');
  body.append(panel);
  const box = panel.querySelector('[data-testid=insight-explain]');
  if (box) {
    assert.equal(box.dataset.dup, 'false');
    assert.ok(box.querySelectorAll('li').length >= 1);
  }
}));

test('사전 생성의 정체: 날짜는 pregen.js의 generated_at에서 읽고, 읽을 수 없으면 날짜 없이', () => {
  assert.equal(pregenDate(), PREGEN.generated_at.slice(0, 10));
  assert.match(pregenDate(), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(pregenDate({ generated_at: '아님' }), '');
  assert.equal(pregenDate({}), '');
  assert.equal(pregenDate(null), '');
  assert.ok(PREGEN_NOTE.includes(`(${pregenDate()})`));
  assert.ok(PREGEN_NOTE_FULL.includes('내가 새로 만든 지도에는 미리 받아 둔 문장이 없어, 키가 없으면 기록을 그대로 모은 문장(규칙 기반)으로, 키가 있으면 Claude가 그 자리에서 씁니다.'));
  assert.equal(HELP_GEN.find((g) => g.term === '사전 생성').desc, PREGEN_NOTE_FULL);
});

test('키 없는 문서 변환 이유는 문서 변환에 맞는 말이다(기록을 모은 문장이 아님)', () => {
  assert.ok(KEYLESS_CONVERT_REASON.includes('규칙 변환 결과') && KEYLESS_CONVERT_REASON.includes('「AI로 변환」'));
  assert.throws(() => keyless.convert('x'), (e) => e.message === KEYLESS_CONVERT_REASON && e.keyless === true && e.noPrefix === true);
  assert.throws(() => keyless.refine(), (e) => e.message === KEYLESS_REASON);
});

test('도움말에 「키와 데이터」 절: 저장 위치·밖으로 나가는 것·받은 문장·회사 기준·사내 LLM', withDom(() => {
  const body = installDom();
  const panel = helpPanel({ onTour() {}, onClose() {} });
  body.append(panel);
  const sec = panel.querySelector('[data-testid=help-security]');
  assert.ok(sec);
  assert.equal(sec.querySelector('summary').textContent, '키와 데이터');
  assert.equal(sec.querySelectorAll('dt').length, SECURITY_ITEMS.length);
  const text = sec.textContent;
  for (const must of ['localStorage', '암호화 없이', '내보내기 파일', 'api.anthropic.com', '사번', '이력 한 줄', '최대 200건', '회사의 외부 전송 기준', '연결할 자리만 있고']) assert.ok(text.includes(must), must);
  assert.ok(!text.includes('undefined') && !text.includes('null'));
}));

test('설정의 키 안내: 같은 사실(암호화 없이 localStorage, 보내는 근거 글, 회사 기준)을 짧게', withDom(() => {
  const body = installDom();
  const panel = settingsPanel({ current: 'claude_api', persisted: true, onAuthorName() {}, onChange() {}, onClose() {} });
  body.append(panel);
  const note = panel.querySelector('[data-testid=settings-key-note]');
  assert.equal(note.textContent, KEY_NOTE);
  for (const must of ['localStorage', '암호화 없이', 'api.anthropic.com', '사번', '회사의 외부 전송 기준']) assert.ok(note.textContent.includes(must), must);
  assert.equal(panel.querySelector('[data-testid=settings-key-status]').textContent, '키가 없습니다. 기록을 그대로 모은 문장(규칙 기반)으로 보여 줍니다.');
}));
