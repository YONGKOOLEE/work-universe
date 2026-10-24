// CR-18-8 묶음 G3(다시 열기·매주 점검) 단위 검증: D-1 시작 화면 목록·이어서 보기, D-2 따라 하기 한 번만, D-3 지난 점검 대비, D-4 점검 요약, D-6 유사 경험자 미리 고름, D-7 새로 맡음 표시.
// 순수 계산 + DOM 흉내(tests/dom-stub.js)로 돌린다. 실제 브라우저 점검(tools/browser-check.mjs 「일상 사용 G3」)을 대신하지 않는다. 가상 데이터만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeEl, installDom, uninstallDom } from './dom-stub.js';
import { buildView } from '../app/src/view/view.js';
import { FIXTURE_TS as S, mkDoc, mkEdge as e, mkNode as n } from './helpers.js';
import {
  BASELINE_MAX, SUMMARY_FAKE_NOTE, TOUR_ONCE, TOUR_ONCE_NOTE, cleanLastOpenedId, cleanRiskBaselines, cleanTourDone, compareRisk, deltaText,
  inspectionSummaryText, isEditedSample, lastModifiedDate, makeBaseline, modifiedLabel, resumeLabel, resumeTarget, shouldAutoStartTour, startMaps,
  summaryFileName, summaryPrintHtml,
} from '../app/src/rules/daily-use.js';
import { loadSettings, saveSettings } from '../app/src/store/local.js';
import { RISK, knowledgeConcentration, newOwnerStart, newOwnerText } from '../app/src/rules/insight-risk.js';
import { inspectionInput, teamRiskSummary } from '../app/src/view/risk-summary.js';
import { startScreen } from '../app/src/ui/start.js';
import { createTour } from '../app/src/ui/tour.js';
import { insightPanel } from '../app/src/ui/insight.js';
import { summaryBar } from '../app/src/ui/check-summary.js';

const withDom = (fn) => async () => {
  const body = installDom();
  const hadRemove = Object.hasOwn(FakeEl.prototype, 'remove');
  if (!hadRemove) FakeEl.prototype.remove = function remove() { if (this.parentNode) this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1); this.parentNode = null; };
  try { await fn(body); } finally { if (!hadRemove) delete FakeEl.prototype.remove; uninstallDom(); }
};
const q = (root, id) => root.querySelector(`[data-testid=${id}]`);

const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), raw: m };
};
const SETTINGS = 'wu:v1:settings';

// ── D-1: 시작 화면 목록 ──
const ev = (source, at) => ({ id: `E-${at}`, type: 'note', occurred_at: at.slice(0, 10), recorded_at: at, source, payload: {}, note: '' });
test('D-1 마지막 수정일: 사람이 한 변경(source user) 중 가장 늦은 날짜, 없으면 null', () => {
  assert.equal(lastModifiedDate({ events: [ev('user', '2026-10-01T09:00:00+09:00'), ev('user', '2026-10-24T18:00:00+09:00'), ev('system', '2026-11-01T00:00:00+09:00')] }), '2026-10-24');
  assert.equal(lastModifiedDate({ events: [ev('system', '2026-10-01T09:00:00+09:00')] }), null);
  assert.equal(lastModifiedDate({ events: [{ source: 'user', recorded_at: '깨진 값' }] }), null);
  assert.equal(lastModifiedDate(null), null);
  assert.equal(lastModifiedDate({}), null);
});

test('D-1 고친 샘플: 샘플이고 사람이 한 변경이 있을 때만(내가 만든 지도·안 고친 샘플은 아님)', () => {
  assert.equal(isEditedSample({ universe: { is_sample: true }, events: [ev('user', '2026-10-02T00:00:00+09:00')] }), true);
  assert.equal(isEditedSample({ universe: { is_sample: true }, events: [ev('system', '2026-10-02T00:00:00+09:00')] }), false);
  assert.equal(isEditedSample({ universe: { is_sample: false }, events: [ev('user', '2026-10-02T00:00:00+09:00')] }), false);
  assert.equal(isEditedSample(null), false);
});

const U = (id, name, is_sample = false) => ({ id, name, level: '팀', is_sample, node_count: 3, ref_count: 0 });
test('D-1 목록: 내가 만든 지도 + 고친 샘플 + 마지막에 연 지도, 수정일 늦은 것이 먼저, 안 고친 샘플은 빠진다', () => {
  const us = [U('S-1', '샘플 가'), U('S-2', '샘플 나', true), U('S-3', '샘플 다', true), U('M-1', '내 지도 A'), U('M-2', '내 지도 B')];
  const info = {
    'S-1': { modified: null, edited: false }, 'S-2': { modified: '2026-10-20', edited: true }, 'S-3': { modified: null, edited: false },
    'M-1': { modified: '2026-10-10', edited: false }, 'M-2': { modified: '2026-10-24', edited: false },
  };
  // 'S-1'은 is_sample이 아니라 내가 만든 지도로 취급된다(위 U의 세 번째 인자 생략). 샘플 가/나/다 중 가 = 내 지도
  const rows = startMaps(us, info, 'S-3');
  assert.deepEqual(rows.map((r) => [r.id, r.kind]), [['M-2', 'mine'], ['S-2', 'edited-sample'], ['M-1', 'mine'], ['S-3', 'recent-sample'], ['S-1', 'mine']]);
  assert.equal(rows[0].modified, '2026-10-24');
  assert.equal(rows[3].modified, null);
  // 마지막에 연 지도가 없으면 안 고친 샘플은 보이지 않는다
  assert.deepEqual(startMaps(us, info, '').map((r) => r.id), ['M-2', 'S-2', 'M-1', 'S-1']);
  assert.deepEqual(startMaps(us, info, 'M-9').map((r) => r.id), ['M-2', 'S-2', 'M-1', 'S-1']); // 없어진 지도 id
  assert.deepEqual(startMaps([], {}, 'S-3'), []);
  assert.deepEqual(startMaps(undefined, undefined), []);
});

test('D-1 이어서 보기 대상: 있으면 {id, name}, 없어졌거나 기록이 없으면 null', () => {
  const us = [U('M-1', '내 지도 A'), U('M-2', '내 지도 B')];
  assert.deepEqual(resumeTarget(us, 'M-2'), { id: 'M-2', name: '내 지도 B' });
  assert.equal(resumeTarget(us, 'M-9'), null); // 그 지도가 없어졌다
  assert.equal(resumeTarget(us, ''), null);
  assert.equal(resumeTarget(null, 'M-1'), null);
  assert.equal(resumeLabel('내 지도 B'), '지난번 지도 이어서 보기: 내 지도 B');
  assert.equal(modifiedLabel('2026-10-24'), '마지막 수정 2026-10-24');
  assert.equal(modifiedLabel(null), '수정한 적 없음');
});

test('D-1 시작 화면: 이어서 보기 단추가 「무엇을 하고 싶어요?」 위에 있고 누르면 그 지도를 연다. 없으면 단추 없음. 목록에 마지막 수정일', withDom((body) => {
  const opened = [];
  const us = [U('M-1', '내 지도 A'), U('S-2', '샘플 나', true), U('S-3', '샘플 다', true)];
  const maps = startMaps(us, { 'M-1': { modified: '2026-10-24', edited: false }, 'S-2': { modified: '2026-10-20', edited: true }, 'S-3': { modified: null, edited: false } }, 'S-3');
  const root = startScreen({ universes: us, maps, resume: resumeTarget(us, 'M-1'), guide: {}, warnings: [], readOnly: false, onOpen: (id) => opened.push(id), onCreate() {}, onTour() {} });
  body.append(root);
  const btn = q(root, 'start-resume');
  assert.equal(btn.textContent, '지난번 지도 이어서 보기: 내 지도 A');
  const hero = root.children[0].children;
  const idx = (pred) => hero.findIndex(pred);
  assert.ok(idx((c) => c.querySelector && c.querySelector('[data-testid=start-resume]')) < idx((c) => c.tagName === 'H2'), '이어서 보기가 첫 제목(무엇을 하고 싶어요?)보다 위');
  btn.click();
  assert.deepEqual(opened, ['M-1']);
  const list = q(root, 'start-mine');
  assert.ok(list.textContent.includes('마지막 수정 2026-10-24'));
  assert.ok(list.textContent.includes('고친 샘플') && list.textContent.includes('마지막 수정 2026-10-20'));
  assert.ok(list.textContent.includes('최근 연 샘플') && list.textContent.includes('수정한 적 없음'));
  // 샘플 카드는 샘플 목록의 카드와 testid가 겹치지 않는다
  assert.ok(q(root, 'mine-open-S-2') && q(root, 'open-M-1'));
  q(root, 'mine-open-S-2').click();
  assert.deepEqual(opened, ['M-1', 'S-2']);
  // 지도가 없어졌으면(resume=null) 단추가 없다
  const none = startScreen({ universes: us, maps, resume: null, guide: {}, warnings: [], readOnly: false, onOpen() {}, onCreate() {}, onTour() {} });
  assert.equal(q(none, 'start-resume'), null);
  // maps 없이(예전 호출) 부르면 내가 만든 지도만
  const old = startScreen({ universes: us, guide: {}, warnings: [], readOnly: false, onOpen() {}, onCreate() {}, onTour() {} });
  assert.ok(q(old, 'start-mine').textContent.includes('내 지도 A') && !q(old, 'start-mine').textContent.includes('샘플 나'));
}));

// ── 설정 저장(D-1·D-2·D-3 공통) ──
test('설정: 마지막 연 지도·따라 하기 끝낸 기록·점검 기준을 저장하고 다시 읽는다(다른 설정은 유지)', () => {
  const st = memStorage();
  const s = { provider: 'pregen', authorName: '가상갑', lastOpenedId: 'M-1', tourDone: { handover: '2026-10-24T10:00:00+09:00' }, riskBaseline: { 'M-1': { solo: 2, dense: null, gaps: 1, at: '2026-10-17T09:00:00+09:00', asOf: '2026-10-17' } } };
  assert.equal(saveSettings(st, s), true);
  const back = loadSettings(st, { provider: 'pregen' });
  assert.equal(back.lastOpenedId, 'M-1');
  assert.deepEqual(back.tourDone, s.tourDone);
  assert.deepEqual(back.riskBaseline, s.riskBaseline);
  assert.equal(back.authorName, '가상갑');
});

test('설정이 없거나 깨졌으면 없는 것으로 본다(오류 입력)', () => {
  assert.equal(loadSettings(memStorage(), { provider: 'pregen' }).lastOpenedId, undefined);
  assert.equal(loadSettings(null, { provider: 'pregen' }).tourDone, undefined);
  const broken = memStorage({ [SETTINGS]: JSON.stringify({ provider: 'pregen', lastOpenedId: 5, tourDone: ['handover'], riskBaseline: 'x' }) });
  const b = loadSettings(broken, { provider: 'pregen' });
  assert.equal(b.lastOpenedId, undefined);
  assert.equal(b.tourDone, undefined);
  assert.equal(b.riskBaseline, undefined);
  assert.equal(cleanLastOpenedId('x'.repeat(101)), '');
  assert.equal(cleanLastOpenedId(''), '');
  assert.deepEqual(cleanTourDone({ handover: '2026-10-24T10:00:00+09:00', Team: '2026-10-24', bad: '날짜 아님', 'x y': '2026-10-24' }), { handover: '2026-10-24T10:00:00+09:00' });
  assert.equal(cleanTourDone({}), undefined);
  assert.equal(cleanRiskBaselines({ 'M-1': { solo: 1, at: '날짜 아님' } }), undefined);
  assert.deepEqual(cleanRiskBaselines({ 'M-1': { solo: -1, dense: 1.5, gaps: 2, at: '2026-10-17T09:00:00+09:00', asOf: 'x' } }), { 'M-1': { solo: null, dense: null, gaps: 2, at: '2026-10-17T09:00:00+09:00' } });
});

test('설정: 점검 기준은 BASELINE_MAX개까지만(저장 시각이 오래된 것부터 버림)', () => {
  const many = {};
  for (let i = 0; i < BASELINE_MAX + 5; i += 1) many[`M-${i}`] = { solo: i, dense: 0, gaps: 0, at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString() };
  const out = cleanRiskBaselines(many);
  assert.equal(Object.keys(out).length, BASELINE_MAX);
  assert.ok(out[`M-${BASELINE_MAX + 4}`] && !out['M-0']);
});

test('설정: 점검 기준·따라 하기 기록은 문서(지도 JSON)에 들어가지 않는다 — 저장소 키는 설정 하나뿐', () => {
  const st = memStorage();
  saveSettings(st, { provider: 'pregen', riskBaseline: { 'M-1': makeBaseline({ solo: 1, dense: 0, gaps: 0 }, { at: '2026-10-24T09:00:00+09:00', asOf: '2026-10-24' }) }, tourDone: { team: '2026-10-24T09:00:00+09:00' } });
  assert.deepEqual([...st.raw.keys()], [SETTINGS]);
});

// ── D-2: 따라 하기는 한 번만 ──
test('D-2 상수 TOUR_ONCE = true, 안내 문구는 「?」 → 「따라 하기 다시 보기」', () => {
  assert.equal(TOUR_ONCE, true);
  assert.equal(TOUR_ONCE_NOTE, '따라 하기는 머리글 「?」 → 「따라 하기 다시 보기」에서 다시 볼 수 있습니다');
});

test('D-2 자동 시작 판단: 처음이면 뜨고, 끝낸·건너뛴 시나리오는 안 뜨고, 「?」로 고르면 언제나 뜨고, TOUR_ONCE=false면 예전대로', () => {
  assert.equal(shouldAutoStartTour({ done: null, scenario: 'handover' }), true);
  assert.equal(shouldAutoStartTour({ done: {}, scenario: 'handover' }), true);
  assert.equal(shouldAutoStartTour({ done: { handover: '2026-10-24T10:00:00+09:00' }, scenario: 'handover' }), false);
  assert.equal(shouldAutoStartTour({ done: { handover: '2026-10-24T10:00:00+09:00' }, scenario: 'team' }), true); // 시나리오별
  assert.equal(shouldAutoStartTour({ done: { handover: '2026-10-24T10:00:00+09:00' }, scenario: 'handover', forced: true }), true);
  assert.equal(shouldAutoStartTour({ tourOnce: false, done: { handover: '2026-10-24T10:00:00+09:00' }, scenario: 'handover' }), true);
});

import { emptyState } from '../app/src/rules/tour-steps.js';

function makeTour() {
  const slot = document.createElement('div');
  slot.hidden = true;
  document.querySelector = () => null;
  const state = emptyState('U-A1');
  const finished = [];
  const tour = createTour({ slot, getState: () => state, getCy: () => ({ nodes: () => ({ nonempty: () => false }) }), universeId: () => state.universeId, onOpenUniverse() {}, onMake() {}, onFinish: (id) => finished.push(id) });
  return { slot, state, tour, finished };
}

test('D-2 따라 하기: 단계 중 「건너뛰기」를 누르면 onFinish(시나리오)가 한 번 불린다', withDom(() => {
  const t = makeTour();
  t.tour.start('handover');
  assert.deepEqual(t.finished, []);
  q(t.slot, 'tour-skip').click();
  assert.deepEqual(t.finished, ['handover']);
  assert.equal(t.tour.info().mode, 'off');
}));

test('D-2 따라 하기: 끝 카드에 이르면 onFinish가 한 번 불리고(다시 그려도 한 번), 「닫기」를 눌러도 더 부르지 않는다', withDom(() => {
  const t = makeTour();
  t.tour.start('handover');
  Object.assign(t.state, { selected: 'U-A1/N-001' });
  t.tour.check();
  q(t.slot, 'tour-next').click();
  Object.assign(t.state, { draftShown: true, evidenceUsed: true });
  t.tour.check();
  Object.assign(t.state, { rewinding: true });
  t.tour.check();
  assert.equal(t.tour.info().mode, 'end');
  assert.deepEqual(t.finished, ['handover']);
  t.tour.check();
  q(t.slot, 'tour-skip').click();
  assert.deepEqual(t.finished, ['handover']);
}));

test('D-2 따라 하기: 시나리오를 고르는 카드(pick)를 닫는 것은 「한 번 했음」이 아니다', withDom(() => {
  const t = makeTour();
  t.state.universeId = 'U-K1';
  t.tour.openHelp();
  assert.equal(t.tour.info().mode, 'pick');
  q(t.slot, 'tour-skip').click();
  assert.deepEqual(t.finished, []);
}));

// ── D-3: 지난 점검 대비 ──
const NOW = { solo: 3, dense: 1, gaps: 0 };
const MINUS = '−';
test('D-3 증감 글: +n / −n / 변화 없음 / 비교 못 함', () => {
  assert.equal(deltaText(3, 2), '+1');
  assert.equal(deltaText(1, 2), `${MINUS}1`);
  assert.equal(deltaText(2, 2), '변화 없음');
  assert.equal(deltaText(null, 2), '비교 못 함');
  assert.equal(deltaText(2, null), '비교 못 함');
  assert.equal(deltaText(2, undefined), '비교 못 함');
});

test('D-3 기준이 없으면 안내 한 줄만(has=false)', () => {
  const c = compareRisk(NOW, null);
  assert.equal(c.has, false);
  assert.equal(c.text, '아직 저장한 점검 없음 — 「이번 점검 저장」을 누르면 다음에 비교합니다');
  assert.deepEqual(c.rows, []);
  assert.equal(compareRisk(NOW, undefined).has, false);
});

test('D-3 기준이 있으면 항목별 증감(혼자만 아는 일 +1, 담당 공백 −1), 같으면 「변화 없음」', () => {
  const base = makeBaseline({ solo: 2, dense: 1, gaps: 1 }, { at: '2026-10-17T09:00:00+09:00', asOf: '2026-10-17' });
  const c = compareRisk(NOW, base);
  assert.equal(c.has, true);
  assert.equal(c.same, false);
  assert.equal(c.savedDate, '2026-10-17');
  assert.deepEqual(c.rows.map((r) => [r.key, r.delta, r.text]), [['solo', 1, '+1'], ['dense', 0, '변화 없음'], ['gaps', -1, `${MINUS}1`]]);
  assert.equal(c.text, `지난 점검(2026-10-17) 대비: 혼자만 아는 일 +1 · 일 몰린 사람 변화 없음 · 담당 공백 ${MINUS}1`);
  const same = compareRisk(NOW, makeBaseline(NOW, { at: '2026-10-17T09:00:00+09:00' }));
  assert.equal(same.same, true);
  assert.equal(same.text, '지난 점검(2026-10-17) 대비: 변화 없음');
});

test('D-3 못 센 숫자(null)는 0으로 취급하지 않고 「비교 못 함」', () => {
  const base = makeBaseline({ solo: null, dense: 1, gaps: 0 }, { at: '2026-10-17T09:00:00+09:00' });
  const c = compareRisk({ solo: 2, dense: null, gaps: 0 }, base);
  assert.deepEqual(c.rows.map((r) => r.text), ['비교 못 함', '비교 못 함', '변화 없음']);
  assert.equal(c.same, false);
  assert.equal(makeBaseline({ solo: 'x', dense: -1, gaps: 2.5 }, { at: 'a' }).solo, null);
});

// ── 위험 요약 view와 점검 요약 글(D-4) ──
const day = (d) => ({ start: d });
const perf = (p, w, period) => e(p, w, 'performs', period ? { period } : {});
const risk = (nodes, edges, events = []) => buildView(mkDoc('U-R', nodes, edges, events));
const ASOF = '2026-10-24';
const people = (...ids) => ids.map((id) => n(id, 'person', `사람${id}`));

test('D-4 점검 요약 입력: 화면 위험 요약(teamRiskSummary)과 같은 숫자, 목록은 높음이 먼저', () => {
  const v = risk([n('W1', 'work', '정산'), n('W2', 'work', '대사'), n('W3', 'work', '빈 업무'), ...people('P1', 'P2')],
    [perf('P1', 'W1'), perf('P2', 'W2')]);
  const d = inspectionInput(v, { asOf: ASOF, n: 2, mapName: '가상 팀 지도' });
  const s = teamRiskSummary(v, { asOf: ASOF, n: 2 });
  assert.deepEqual([d.solo, d.dense, d.gaps], [s.solo, s.dense, s.gaps]);
  assert.equal(d.solo, 2);
  assert.equal(d.gaps, 1);
  assert.deepEqual(d.gapItems, [{ work: '빈 업무' }]);
  assert.equal(d.soloItems.length, 2);
  assert.ok(d.soloItems.every((x) => x.level === 'high'));
  assert.equal(d.mapName, '가상 팀 지도');
});

test('D-4 점검 요약 글: 지도 이름·기준일·숫자·상위 항목·증감·가상 안내가 들어간다', () => {
  const d = {
    mapName: '가상 팀 지도', asOf: ASOF, solo: 7, dense: 1, gaps: 2,
    soloItems: Array.from({ length: 7 }, (_, i) => ({ work: `업무${i + 1}`, person: '가상갑', level: i === 0 ? 'high' : 'caution' })),
    denseItems: [{ person: '가상을', count: 4 }], gapItems: [{ work: '빈 일 하나' }, { work: '빈 일 둘' }],
  };
  const cmp = compareRisk(d, makeBaseline({ solo: 6, dense: 1, gaps: 3 }, { at: '2026-10-17T09:00:00+09:00' }));
  const t = inspectionSummaryText(d, cmp);
  assert.ok(t.startsWith('점검 요약 — 가상 팀 지도\n기준일: 2026-10-24'));
  assert.ok(t.includes('혼자만 아는 일: 7개') && t.includes('일 몰린 사람: 1명') && t.includes('담당 공백: 2개'));
  assert.ok(t.includes('「업무1」 (가상갑, 높음)') && t.includes('「업무5」') && !t.includes('「업무6」') && t.includes('외 2건'), '상위 5개만, 나머지는 건수');
  assert.ok(t.includes('가상을 (4개 담당)') && t.includes('「빈 일 하나」'));
  assert.ok(t.includes(`지난 점검(2026-10-17) 대비: 혼자만 아는 일 +1 · 일 몰린 사람 변화 없음 · 담당 공백 ${MINUS}1`));
  assert.ok(t.includes('혼자만 아는 일: 6 → 7 (+1)'));
  assert.ok(t.endsWith(SUMMARY_FAKE_NOTE));
  assert.ok(/가상/.test(SUMMARY_FAKE_NOTE));
});

test('D-4 점검 요약 글: 기준이 없으면 그 사실, 못 센 숫자는 「기록이 부족해 셀 수 없음」', () => {
  const t = inspectionSummaryText({ mapName: '지도', asOf: ASOF, solo: null, dense: null, gaps: 0, soloItems: [], denseItems: [], gapItems: [] }, null);
  assert.ok(t.includes('혼자만 아는 일: 기록이 부족해 셀 수 없음') && t.includes('일 몰린 사람: 기록이 부족해 셀 수 없음') && t.includes('담당 공백: 0개'));
  assert.ok(t.includes('지난 점검 대비: 아직 저장한 점검 없음'));
  assert.ok(!/null|undefined|NaN/.test(t));
});

test('D-4 파일 이름·인쇄용 HTML: 이름의 금지 글자는 _로, 글은 이스케이프', () => {
  assert.equal(summaryFileName('가상/팀: 지도?', '2026-10-24'), '점검요약-가상_팀_ 지도_-2026-10-24.txt');
  assert.equal(summaryFileName('', '2026-10-24'), '점검요약-지도-2026-10-24.txt');
  const h = summaryPrintHtml('<b>1 & 2</b>', '제목 "x"');
  assert.ok(h.includes('&lt;b&gt;1 &amp; 2&lt;/b&gt;') && h.includes('<title>제목 &quot;x&quot;</title>') && !h.includes('<b>1'));
});

test('D-4 점검 요약 줄: 복사가 막히면 고른 글 상자로 대신하고, 내려받기는 Blob으로 막힘 안내 없이 동작', withDom(async (body) => {
  let built = 0;
  const bar = summaryBar({ build: () => { built += 1; return '요약 글'; }, mapName: '가상 지도', asOf: ASOF });
  body.append(bar);
  assert.ok(bar.textContent.includes('점검 요약') && bar.textContent.includes('복사') && bar.textContent.includes('내려받기(.txt)') && bar.textContent.includes('인쇄'));
  assert.ok(bar.textContent.includes(SUMMARY_FAKE_NOTE));
  // 클립보드가 없는 환경(Node에는 navigator.clipboard가 없다): 글 상자
  q(bar, 'summary-copy').fire('click');
  await new Promise((r) => setTimeout(r, 0));
  const box = q(bar, 'summary-copy-box');
  assert.ok(box && box.textContent === '요약 글');
  assert.equal(built, 1);
  q(bar, 'summary-download').click();
  assert.equal(q(bar, 'summary-download-blocked'), null);
  assert.equal(built, 2, '누를 때마다 지금 글을 다시 만든다');
}));

test('D-4 인사이트 창 위쪽에 점검 요약 줄(복사·내려받기·인쇄)이 있다(탭보다 위)', withDom((body) => {
  const v = risk([n('W1', 'work', '정산'), n('W2', 'work', '대사'), ...people('P1', 'P2')], [perf('P1', 'W1'), perf('P2', 'W2')]);
  const base = makeBaseline({ solo: 1, dense: 0, gaps: 0 }, { at: '2026-10-17T09:00:00+09:00', asOf: '2026-10-17' });
  const panel = insightPanel({ view: v, provider: null, kind: 'risk', asOf: ASOF, today: ASOF, mapName: '가상 팀 지도', baseline: base, onFocus() {}, onClose() {} });
  body.append(panel);
  assert.ok(q(panel, 'summary-copy') && q(panel, 'summary-download') && q(panel, 'summary-print'));
  const order = panel.children.map((c) => c.dataset.testid || c.className || c.tagName);
  assert.ok(order.indexOf('summary-bar') >= 0 && order.indexOf('summary-bar') < order.indexOf('tabs'), `순서: ${order.join(',')}`);
}));

// ── D-6: 유사 경험자 미리 고름 ──
test('D-6 인사이트 「유사 경험자」 탭: 넘겨 준 업무(work)가 미리 골라져 있다. 없으면 「업무를 고르세요」', withDom((body) => {
  const v = risk([n('W1', 'work', '정산'), n('W2', 'work', '대사'), ...people('P1')], [perf('P1', 'W1')]);
  const withWork = insightPanel({ view: v, provider: null, kind: 'similar', work: 'U-R/W2', asOf: ASOF, today: ASOF, onFocus() {}, onClose() {} });
  body.append(withWork);
  assert.equal(q(withWork, 'insight-work').value, 'U-R/W2');
  const without = insightPanel({ view: v, provider: null, kind: 'similar', work: '', asOf: ASOF, today: ASOF, onFocus() {}, onClose() {} });
  body.append(without);
  assert.equal(q(without, 'insight-work').value, '');
}));

// ── D-7: 새로 맡음 표시 ──
const item = (v) => knowledgeConcentration(v, { asOf: ASOF }).items[0];
test('D-7 상수: 기준일에서 30일 안', () => {
  assert.equal(RISK.NEW_OWNER_DAYS, 30);
});

test('D-7 시작 날짜가 30일 안(경계 포함)이면 새로 맡음, 31일 전·시작일 없음은 아님. 세는 숫자는 그대로', () => {
  const mk = (period) => risk([n('W1', 'work', '정산'), ...people('P1')], [perf('P1', 'W1', period)]);
  assert.equal(item(mk(day('2026-10-20'))).new_owner, '2026-10-20');
  assert.equal(item(mk(day('2026-09-24'))).new_owner, '2026-09-24'); // 정확히 30일 전
  assert.equal(item(mk(day('2026-09-23'))).new_owner, null); // 31일 전
  assert.equal(item(mk(undefined)).new_owner, null); // 시작일 모름
  assert.equal(item(mk({ end: '2027-01-01' })).new_owner, null);
  // 숫자: 새로 맡았든 아니든 혼자만 아는 일은 1개 높음
  for (const p of [day('2026-10-20'), day('2020-01-01'), undefined]) {
    const c = knowledgeConcentration(mk(p), { asOf: ASOF });
    assert.deepEqual([c.counts.one, c.counts.high, c.counts.caution], [1, 1, 0]);
  }
});

test('D-7 예전에 맡았다가 다시 맡은 사람은 가장 이른 시작일 기준이라 새로 맡음이 아니다. 끝난 담당은 아님', () => {
  const again = risk([n('W1', 'work', '정산'), ...people('P1')], [perf('P1', 'W1', { start: '2025-01-01', end: '2025-12-31' }), perf('P1', 'W1', day('2026-10-20'))]);
  assert.equal(item(again).new_owner, null);
  const ended = risk([n('W1', 'work', '정산'), ...people('P1')], [perf('P1', 'W1', { start: '2026-10-01', end: '2026-10-10' })]);
  assert.equal(item(ended).new_owner, null); // 지금 담당이 아님
  assert.equal(newOwnerStart(null, ASOF), null);
});

test('D-7 표시 글: 높음이면 「인수인계 기록을 남기면 줄어듭니다」, 주의면 사실만, 해당 없으면 빈 글', () => {
  assert.equal(newOwnerText({ level: 'high', new_owner: '2026-10-20' }), '새로 맡음(시작 2026-10-20) — 인수인계 기록을 남기면 줄어듭니다');
  assert.equal(newOwnerText({ level: 'caution', new_owner: '2026-10-20' }), '새로 맡음(시작 2026-10-20)');
  assert.equal(newOwnerText({ level: 'high', new_owner: null }), '');
  assert.equal(newOwnerText(null), '');
});

test('D-7 위험 목록 화면: 새로 맡은 혼자만 아는 일에만 표시가 붙는다', withDom((body) => {
  const v = risk([n('W1', 'work', '새 업무'), n('W2', 'work', '오래된 업무'), ...people('P1', 'P2')], [perf('P1', 'W1', day('2026-10-20')), perf('P2', 'W2', day('2024-01-01'))]);
  const panel = insightPanel({ view: v, provider: null, kind: 'risk', asOf: ASOF, today: ASOF, onFocus() {}, onClose() {} });
  body.append(panel);
  const marks = panel.querySelectorAll('[data-testid=risk-new-owner]');
  assert.equal(marks.length, 1);
  assert.equal(marks[0].textContent, '새로 맡음(시작 2026-10-20) — 인수인계 기록을 남기면 줄어듭니다');
}));
