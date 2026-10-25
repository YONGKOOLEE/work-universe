// 일상 사용 점검 2회차 S 묶음(CR-18 범위 안 보완) 단위 검증:
// T4 「이번 주 기록」 날짜 검사, T5 협업자 메모(연결 note), T6 보내는·받는 사람 목록 순서·추가 단추 설명,
// M1 점검 기준 최근 둘, M2 「점검 요약 보기」, M3 담당 바꾸기(app.changeAssignee), M4 묶은 지도 마지막 수정일, M6 바뀐 것에 담당 변경.
// 순수 계산 + DOM 흉내(tests/dom-stub.js). 실제 브라우저 점검(tools/browser-check.mjs 「일상 사용 2회차 S」)을 대신하지 않는다. 가상 데이터만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLES } from '../app/data/index.js';
import { FakeEl, installDom, uninstallDom } from './dom-stub.js';
import { clone, mkDoc, mkEdge as e, mkNode as n } from './helpers.js';
import { createApp } from '../app/src/app/app.js';
import { createStore, loadSettings, saveSettings } from '../app/src/store/local.js';
import { buildView } from '../app/src/view/view.js';
import { editPoints } from '../app/src/model/rewind.js';
import { validateDocument } from '../app/src/model/validate.js';
import { SUBTYPE_ROLE } from '../app/src/model/schema.js';
import { collabPlan } from '../app/src/view/quick-input.js';
import { describeNode, describeUniverse } from '../app/src/view/describe.js';
import { peopleByScope } from '../app/src/view/transfer.js';
import {
  BASELINE_KEEP, BASELINE_OWNERS_MAX, OWNERS_NONE, OWNERS_SHOW, TODAY_SAVED_TEXT, WEEKLY_DATE_MESSAGES, baselineList, baselineSavedNote,
  cleanOwners, cleanRiskBaselines, compareRisk, currentOwnersByWork, inspectionSummaryText, lastModifiedDeep, latestBaseline, makeBaseline, ownerChanges, ownerChangesText,
  pickBaseline, saveBaseline, startMaps, weeklyDateError,
} from '../app/src/rules/daily-use.js';
import { renderUniverseSummary } from '../app/src/ui/detail.js';
import { draftPanel, PEOPLE_IN_SCOPE_LABEL, PEOPLE_OTHERS_LABEL } from '../app/src/ui/draft.js';
import { insightPanel } from '../app/src/ui/insight.js';
import { inspectionInput } from '../app/src/view/risk-summary.js';
import { namesFromInspection } from '../app/src/rules/daily-use.js';

const withDom = (fn) => async () => {
  const body = installDom();
  const hadRemove = Object.hasOwn(FakeEl.prototype, 'remove');
  if (!hadRemove) FakeEl.prototype.remove = function remove() { if (this.parentNode) this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1); this.parentNode = null; };
  try { await fn(body); } finally { if (!hadRemove) delete FakeEl.prototype.remove; uninstallDom(); }
};
const q = (root, id) => root.querySelector(`[data-testid=${id}]`);
const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, raw: m };
};
const ASOF = '2026-10-25';
const row = (day, extra = {}) => ({ solo: 1, dense: 0, gaps: 0, at: `${day}T09:00:00+09:00`, asOf: day, ...extra });

// ── T4: 「이번 주 기록」 날짜 ──────────────────────────────────────────────
test('T4 날짜 검사: 오늘·지난 날짜는 통과, 비었거나 읽을 수 없거나 달력에 없거나 오늘 뒤면 코드', () => {
  assert.equal(weeklyDateError('2026-10-25', ASOF), null, '오늘');
  assert.equal(weeklyDateError('2026-10-23', ASOF), null, '주말에 몰아 넣을 때의 지난 요일');
  assert.equal(weeklyDateError(' 2026-10-20 ', ASOF), null, '앞뒤 공백은 무시');
  assert.equal(weeklyDateError('', ASOF), 'empty');
  assert.equal(weeklyDateError(undefined, ASOF), 'empty');
  assert.equal(weeklyDateError('   ', ASOF), 'empty');
  assert.equal(weeklyDateError('2026-10-26', ASOF), 'future', '내일은 거부');
  assert.equal(weeklyDateError('2200-01-01', ASOF), 'future');
  assert.equal(weeklyDateError('2026/10/20', ASOF), 'invalid');
  assert.equal(weeklyDateError('abc', ASOF), 'invalid');
  assert.equal(weeklyDateError('2026-02-30', ASOF), 'invalid', '달력에 없는 날');
  assert.equal(weeklyDateError('1899-12-31', ASOF), 'invalid', '1900년보다 이전');
  for (const code of ['empty', 'invalid', 'future']) assert.ok(WEEKLY_DATE_MESSAGES[code], code);
});

test('T4 지난 날짜의 주간 메모가 그 날짜로 저장된다(기존 메모 명령 그대로)', () => {
  const app = createApp({ store: createStore(memStorage()), samples: SAMPLES, currentId: 'U-A1', now: () => '2026-10-25T10:00:00+09:00' });
  const before = app.doc.events.length;
  const r = app.addEvent({ type: 'memo', occurred_at: '2026-10-23', payload: { target_id: 'N-001', category: 'in_progress', topic_ids: [] }, note: '금요일 진행 상황' });
  assert.equal(r.ok, true);
  const last = app.doc.events[app.doc.events.length - 1];
  assert.equal(app.doc.events.length, before + 1);
  assert.deepEqual([last.occurred_at, last.type, last.note], ['2026-10-23', 'memo', '금요일 진행 상황']);
});

// ── T5: 협업자 메모(연결 note) ─────────────────────────────────────────────
test('T5 협업자 추가 묶음의 「참조」 연결 명령에 메모를 넣으면 연결의 note로 저장되고 연결된 항목에 보인다', () => {
  const app = createApp({ store: createStore(memStorage()), samples: SAMPLES, currentId: 'U-A1', now: () => '2026-10-25T10:00:00+09:00' });
  const plan = collabPlan(app.view.nodes.filter((x) => x.universe_id === 'U-A1' && x.core_type === 'person'), { name: '가상 감사담당', affiliation: '가상감사팀', contact: '내선 0000' }, 'N-001');
  assert.equal(plan.ok, true);
  // main.js가 하는 일: 묶음의 마지막 addEdge 명령에 메모를 더한다
  const edgeOp = [...plan.ops].reverse().find((o) => o.op === 'addEdge');
  edgeOp.input = { ...edgeOp.input, note: '대사 결과 공유' };
  const b = app.applyBatch(plan.ops);
  assert.equal(b.ok, true);
  const edge = app.doc.edges.find((x) => x.core_type === 'references' && x.note === '대사 결과 공유');
  assert.ok(edge, '연결 메모가 저장됨');
  const links = describeNode(app.view, 'U-A1/N-001', { asOf: ASOF }).links;
  assert.ok(links.some((l) => l.relation === '참조' && l.note === '대사 결과 공유'), '「연결된 항목」의 그 연결 줄에 메모가 나온다');
  assert.equal(validateDocument(app.doc).ok, true);
});

test('T5 메모를 비우면 연결에 note가 없다(예전 모양 그대로)', () => {
  const app = createApp({ store: createStore(memStorage()), samples: SAMPLES, currentId: 'U-A1', now: () => '2026-10-25T10:00:00+09:00' });
  const plan = collabPlan([], { name: '가상 협업자2' }, 'N-001');
  assert.equal(app.applyBatch(plan.ops).ok, true);
  const edge = app.doc.edges.filter((x) => x.core_type === 'references').pop();
  assert.equal(Object.hasOwn(edge, 'note'), false);
});

// ── T6: 사람 목록 순서 ─────────────────────────────────────────────────────
// 노드 순서: 협업자(C)가 맨 앞 → 예전에는 목록 맨 위에 왔다
const scopeDoc = () => mkDoc('U-S', [
  n('PC', 'person', '가상협업자'),
  n('PA', 'person', '가상갑'),
  n('PB', 'person', '가상을'),
  n('W1', 'work', '업무하나'),
  n('W2', 'work', '업무둘'),
], [
  e('N-000', 'W1', 'contains'), e('N-000', 'W2', 'contains'),
  e('PA', 'W1', 'performs', { period: { start: '2026-01-01' } }),
  e('PB', 'W2', 'performs', { period: { start: '2026-01-01', end: '2026-05-31' } }), // 끝난 담당도 「수행한 사람」
  e('W1', 'PC', 'references'),
], []);
const names = (list) => list.map((p) => p.label);
const peopleOf = (view) => view.nodes.filter((x) => x.core_type === 'person' && !x.hidden);

test('T6 peopleByScope: 대상 업무를 수행한 사람이 먼저, 그 밖의 사람이 뒤(각 묶음 안은 받은 순서). 지도 중심이면 범위 업무 전체의 수행자', () => {
  const v = buildView(scopeDoc());
  const people = peopleOf(v);
  const w1 = peopleByScope(v, 'U-S/W1', people);
  assert.deepEqual([names(w1.inScope), names(w1.others)], [['가상갑'], ['가상협업자', '가상을']]);
  const w2 = peopleByScope(v, 'U-S/W2', people);
  assert.deepEqual([names(w2.inScope), names(w2.others)], [['가상을'], ['가상협업자', '가상갑']], '끝난 담당도 수행한 사람');
  const root = peopleByScope(v, 'U-S/N-000', people);
  assert.deepEqual([names(root.inScope), names(root.others)], [['가상갑', '가상을'], ['가상협업자']]);
  // 오류·경계: 대상이 없거나 업무·지도 중심이 아니면 순서 그대로
  for (const bad of ['', 'U-S/없음', 'U-S/PA']) {
    const r = peopleByScope(v, bad, people);
    assert.deepEqual([r.inScope.length, names(r.others)], [0, ['가상협업자', '가상갑', '가상을']], bad);
  }
});

test('T6 초안 화면: 보내는·받는 사람 목록이 수행한 사람 → 그 밖의 사람 순(묶음 이름 포함), 대상을 바꾸면 다시 줄 서고 고른 사람은 유지', withDom((body) => {
  const v = buildView(scopeDoc());
  const panel = draftPanel({ view: v, provider: null, asOf: ASOF, seenStorage: memStorage(), onFocus() {}, onClose() {} });
  body.append(panel);
  const opts = (id) => q(panel, id).options.filter((o) => o.value).map((o) => o.getAttribute('value'));
  const groups = (id) => q(panel, id).children.filter((c) => c.tagName === 'OPTGROUP').map((g) => g.getAttribute('label'));
  q(panel, 'draft-target').value = 'U-S/W1';
  q(panel, 'draft-target').fire('change');
  assert.deepEqual(opts('draft-from'), ['U-S/PA', 'U-S/PC', 'U-S/PB'], '업무하나: 갑 → 협업자·을');
  assert.deepEqual(opts('draft-to'), ['U-S/PA', 'U-S/PC', 'U-S/PB']);
  assert.deepEqual(groups('draft-from'), [PEOPLE_IN_SCOPE_LABEL, PEOPLE_OTHERS_LABEL]);
  // 고른 사람은 순서가 바뀌어도 유지
  q(panel, 'draft-to').value = 'U-S/PC';
  q(panel, 'draft-target').value = 'U-S/W2';
  q(panel, 'draft-target').fire('change');
  assert.deepEqual(opts('draft-to'), ['U-S/PB', 'U-S/PC', 'U-S/PA'], '업무둘: 을 → 협업자·갑');
  assert.equal(q(panel, 'draft-to').value, 'U-S/PC');
  // 대상을 비우면(범위 없음) 묶음 이름 없이 받은 순서
  q(panel, 'draft-target').value = '';
  q(panel, 'draft-target').fire('change');
  assert.deepEqual(opts('draft-from'), ['U-S/PC', 'U-S/PA', 'U-S/PB']);
  assert.deepEqual(groups('draft-from'), []);
}));

test('T6 수행한 사람이 모두 같은 묶음이면(한쪽이 비면) 묶음 이름 없이 그대로', withDom((body) => {
  const doc = mkDoc('U-S', [n('PA', 'person', '가상갑'), n('W1', 'work', '업무하나')], [e('N-000', 'W1', 'contains'), e('PA', 'W1', 'performs', { period: { start: '2026-01-01' } })], []);
  const panel = draftPanel({ view: buildView(doc), provider: null, asOf: ASOF, seenStorage: memStorage(), onFocus() {}, onClose() {} });
  body.append(panel);
  q(panel, 'draft-target').value = 'U-S/W1';
  q(panel, 'draft-target').fire('change');
  assert.deepEqual(q(panel, 'draft-from').children.filter((c) => c.tagName === 'OPTGROUP').length, 0);
  assert.deepEqual(q(panel, 'draft-from').options.map((o) => o.getAttribute('value')), ['', 'U-S/PA']);
}));

// ── M1: 점검 기준 최근 둘 ──────────────────────────────────────────────────
test('M1 상수: 지도마다 최근 둘', () => {
  assert.equal(BASELINE_KEEP, 2);
});

test('M1 읽기: 예전 형식(객체 하나)은 그대로, 새 형식(배열)은 오래된 것 → 최근 것, 같은 날은 늦은 것 하나, 셋 이상이면 최근 둘', () => {
  const legacy = row('2026-10-17');
  assert.deepEqual(baselineList(legacy), [legacy]);
  assert.deepEqual(cleanRiskBaselines({ 'M-1': legacy }), { 'M-1': legacy }, '하나짜리는 예전 모양(객체) 그대로 다시 쓴다');
  const a = row('2026-10-10');
  const b = row('2026-10-17');
  assert.deepEqual(cleanRiskBaselines({ 'M-1': [b, a] }), { 'M-1': [a, b] }, '순서가 뒤바뀌어도 날짜순으로 바로잡는다');
  const c = row('2026-10-24');
  assert.deepEqual(baselineList([a, b, c]), [b, c], '셋이면 오래된 것을 버림');
  const sameDayEarly = row('2026-10-17', { solo: 7, at: '2026-10-17T08:00:00+09:00' });
  assert.deepEqual(baselineList([sameDayEarly, b]), [b], '같은 날은 늦게 저장한 것 하나');
  assert.deepEqual(cleanRiskBaselines({ 'M-1': [legacy] }), { 'M-1': legacy }, '한 건짜리 배열은 객체로');
  // 깨진 값: 읽을 수 없는 항목은 버리고, 전부 깨지면 지도를 뺀다
  assert.deepEqual(baselineList([null, 'x', { at: '날짜 아님' }, b]), [b]);
  assert.deepEqual(baselineList('x'), []);
  assert.deepEqual(baselineList(undefined), []);
  assert.equal(cleanRiskBaselines({ 'M-1': [null, { at: 'x' }] }), undefined);
});

test('M1 저장: 처음엔 한 건, 같은 날 다시 저장하면 그날 것을 바꾸고(replaced), 날이 바뀌면 새로 더하고, 둘을 넘으면 오래된 것을 버린다', () => {
  const s1 = saveBaseline(undefined, row('2026-10-17'));
  assert.deepEqual([s1.replaced, Array.isArray(s1.entry), s1.entry.asOf], [false, false, '2026-10-17']);
  const s1b = saveBaseline(s1.entry, row('2026-10-17', { solo: 9, at: '2026-10-17T18:00:00+09:00' }));
  assert.equal(s1b.replaced, true);
  assert.equal(s1b.entry.solo, 9, '그날 것을 바꿈');
  assert.equal(Array.isArray(s1b.entry), false);
  const s2 = saveBaseline(s1b.entry, row('2026-10-24', { solo: 3 }));
  assert.equal(s2.replaced, false);
  assert.deepEqual(s2.entry.map((r) => r.asOf), ['2026-10-17', '2026-10-24']);
  // 둘이 있을 때 같은 날 다시 저장 → 최근 것만 바뀌고 앞의 것은 그대로
  const s2b = saveBaseline(s2.entry, row('2026-10-24', { solo: 4, at: '2026-10-24T17:00:00+09:00' }));
  assert.equal(s2b.replaced, true);
  assert.deepEqual(s2b.entry.map((r) => [r.asOf, r.solo]), [['2026-10-17', 9], ['2026-10-24', 4]]);
  const s3 = saveBaseline(s2b.entry, row('2026-10-31'));
  assert.deepEqual(s3.entry.map((r) => r.asOf), ['2026-10-24', '2026-10-31'], '셋째 날에 가장 오래된 것을 버림');
  // 오류: 날짜를 읽을 수 없는 새 기준은 저장하지 않고 기존 것 그대로
  const bad = saveBaseline(s3.entry, { solo: 1, at: '날짜 아님' });
  assert.equal(bad.replaced, false);
  assert.deepEqual(bad.entry.map((r) => r.asOf), ['2026-10-24', '2026-10-31']);
});

test('M1 비교 기준 고르기: 오늘보다 앞선 날의 가장 최근 기준, 없고 오늘 것만 있으면 savedToday, 아무것도 없으면 둘 다 아님', () => {
  const old = row('2026-10-10');
  const last = row('2026-10-17');
  const today = row('2026-10-25');
  assert.deepEqual(pickBaseline([last, today], ASOF), { base: last, savedToday: false }, '오늘 저장해도 지난 점검과 비교한다');
  assert.deepEqual(pickBaseline(today, ASOF), { base: null, savedToday: true }, '오늘 저장한 것뿐이면 비교 대신 안내');
  assert.deepEqual(pickBaseline(legacyOf(last), ASOF), { base: last, savedToday: false }, '예전 형식(하나짜리)');
  assert.deepEqual(pickBaseline([old, last], ASOF).base, last, '앞선 날이 둘이면 더 최근 것');
  assert.deepEqual(pickBaseline(undefined, ASOF), { base: null, savedToday: false });
  assert.deepEqual(pickBaseline(null, ASOF), { base: null, savedToday: false });
  // 시계가 뒤로 간 경우(저장한 날이 오늘보다 뒤): 비교할 앞선 기준도, 오늘 저장한 것도 아님
  assert.deepEqual(pickBaseline(row('2026-11-02'), ASOF), { base: null, savedToday: false });
  assert.equal(latestBaseline([old, last]).asOf, '2026-10-17');
  assert.equal(latestBaseline(undefined), null);
});
const legacyOf = (r) => ({ ...r });

test('M1 비교 글: savedToday면 안내 글(비교 아님), 기준이 있으면 예전과 같은 「지난 점검(날짜) 대비」', () => {
  const now = { solo: 1, dense: 0, gaps: 0 };
  const t = compareRisk(now, null, null, { savedToday: true });
  assert.deepEqual([t.has, t.savedToday, t.text], [false, true, TODAY_SAVED_TEXT]);
  assert.equal(TODAY_SAVED_TEXT, '오늘 저장한 점검 — 다음 점검 날부터 비교합니다');
  const none = compareRisk(now, null);
  assert.deepEqual([none.has, none.savedToday], [false, false]);
  assert.match(none.text, /^아직 저장한 점검 없음/);
  const c = compareRisk(now, row('2026-10-17'));
  assert.equal(c.text, '지난 점검(2026-10-17) 대비: 변화 없음');
  assert.equal(c.savedToday, false);
});

test('M1 저장 알림 문구: 새로 저장 / 같은 날 것을 바꿈, 모두 「다음 점검 날부터」', () => {
  assert.equal(baselineSavedNote('2026-10-25T09:00:00+09:00'), '이번 점검을 저장했습니다(2026-10-25) — 다음 점검 날부터 이 숫자와 비교합니다');
  assert.equal(baselineSavedNote('2026-10-25T09:00:00+09:00', { replaced: true }), '오늘 저장한 점검을 이번 점검으로 바꿨습니다(2026-10-25) — 다음 점검 날부터 이 숫자와 비교합니다');
  assert.match(baselineSavedNote(undefined), /\(\?\)/);
});

test('M1 설정 저장·읽기: 최근 둘(배열)과 예전 형식이 함께 있어도 그대로 돌아온다, 시작 목록의 마지막 점검은 가장 최근 것', () => {
  const st = memStorage();
  const entry = [row('2026-10-17'), row('2026-10-24')];
  const settings = { provider: 'pregen', riskBaseline: { 'M-1': entry, 'M-2': row('2026-10-20') } };
  assert.equal(saveSettings(st, settings), true);
  const back = loadSettings(st, { provider: 'pregen' });
  assert.deepEqual(back.riskBaseline['M-1'], entry);
  assert.deepEqual(back.riskBaseline['M-2'], row('2026-10-20'), '예전 형식(객체 하나)은 그대로');
  const maps = startMaps([{ id: 'M-1', name: '가', is_sample: true }, { id: 'M-2', name: '나', is_sample: true }], {}, '', back.riskBaseline);
  assert.deepEqual(Object.fromEntries(maps.map((m) => [m.id, m.checked])), { 'M-1': '2026-10-24', 'M-2': '2026-10-20' });
});

// ── M6: 바뀐 것에 담당 변경 ────────────────────────────────────────────────
const ownersDoc = (extraEdges = [], extraNodes = []) => mkDoc('U-O2', [
  n('PA', 'person', '도하람'), n('PB', 'person', '윤바다'), n('R1', 'person', '담당 역할', { subtype: SUBTYPE_ROLE }),
  n('W1', 'work', '장소 섭외'), n('W2', 'work', '예산 정리'), n('W3', 'work', '담당 없는 일'), ...extraNodes,
], [
  e('N-000', 'W1', 'contains'), e('N-000', 'W2', 'contains'), e('N-000', 'W3', 'contains'),
  e('PA', 'W1', 'performs', { period: { start: '2026-01-01' } }),
  e('PA', 'W2', 'performs', { period: { start: '2026-01-01' } }),
  e('PB', 'W2', 'performs', { period: { start: '2026-02-01' } }),
  e('R1', 'W3', 'performs', { period: { start: '2026-01-01' } }), // 역할 노드는 사람이 아니라 뺀다
  ...extraEdges,
], []);

test('M6 currentOwnersByWork: 업무별 지금 담당 이름(가나다순, 여럿이면 ", "), 담당 없는 업무·역할만 있는 업무는 빈 글, 이름순 정렬', () => {
  const o = currentOwnersByWork(buildView(ownersDoc()), ASOF);
  assert.deepEqual(o, { '담당 없는 일': '', '예산 정리': '도하람, 윤바다', '장소 섭외': '도하람' });
  assert.deepEqual(Object.keys(o), ['담당 없는 일', '예산 정리', '장소 섭외'].sort((a, b) => a.localeCompare(b, 'ko')));
});

test('M6 넘긴 날에는 끝나는 사람을 뺀다, 끝난 담당·시작 전 담당·숨긴 업무·같은 이름 업무는 제외', () => {
  const doc = ownersDoc([
    e('PB', 'W1', 'performs', { period: { start: ASOF } }), // 오늘 시작
  ]);
  doc.edges.find((x) => x.source === 'PA' && x.target === 'W1').period = { start: '2026-01-01', end: ASOF }; // 오늘 끝남 → 넘김
  doc.edges.find((x) => x.source === 'PB' && x.target === 'W2').period = { start: '2026-12-01' }; // 시작 전
  doc.edges.find((x) => x.source === 'PA' && x.target === 'W2').period = { start: '2026-01-01', end: '2026-06-01' }; // 끝남
  const o = currentOwnersByWork(buildView(doc), ASOF);
  assert.equal(o['장소 섭외'], '윤바다', '넘긴 날: 끝나는 도하람은 빠짐');
  assert.equal(o['예산 정리'], '', '끝난 담당과 시작 전 담당은 지금 담당이 아님');
  // 숨긴 업무·같은 이름 업무
  const dup = ownersDoc([], [n('W4', 'work', '장소 섭외'), n('W5', 'work', '숨긴 일', { hidden: true })]);
  const od = currentOwnersByWork(buildView(dup), ASOF);
  assert.equal(Object.hasOwn(od, '장소 섭외'), false, '같은 이름의 업무가 둘이면 어느 쪽인지 가릴 수 없어 뺀다');
  assert.equal(Object.hasOwn(od, '숨긴 일'), false);
  // 어제 기준으로 보면(시간 보기) 어제의 담당
  assert.equal(currentOwnersByWork(buildView(doc), '2026-10-24')['장소 섭외'], '도하람');
});

test('M6 cleanOwners·makeBaseline: 글자만, 이름순 앞에서부터 BASELINE_OWNERS_MAX개, 비면 없음. 예전 기준에는 owners 없음', () => {
  assert.equal(BASELINE_OWNERS_MAX, 100);
  assert.equal(cleanOwners(undefined), undefined);
  assert.equal(cleanOwners([]), undefined);
  assert.equal(cleanOwners({ '': '가', 업무: 3 }), undefined);
  assert.deepEqual(cleanOwners({ ' 일 ': ' 가 ', 공백: '' }), { 공백: '', 일: '가' });
  const many = Object.fromEntries(Array.from({ length: 130 }, (_, i) => [`업무${String(i).padStart(3, '0')}`, '가']));
  assert.equal(Object.keys(cleanOwners(many)).length, 100);
  assert.equal(Object.hasOwn(cleanOwners(many), 'W'), false);
  const b = makeBaseline({ solo: 1, dense: 0, gaps: 0 }, { at: '2026-10-17T09:00:00+09:00', owners: { 일: '가' } });
  assert.deepEqual(b.owners, { 일: '가' });
  assert.equal(Object.hasOwn(makeBaseline({ solo: 1, dense: 0, gaps: 0 }, { at: '2026-10-17T09:00:00+09:00' }), 'owners'), false);
  // 설정을 거쳐도 남는다
  const st = memStorage();
  saveSettings(st, { provider: 'pregen', riskBaseline: { 'M-1': b } });
  assert.deepEqual(loadSettings(st, { provider: 'pregen' }).riskBaseline['M-1'].owners, { 일: '가' });
});

test('M6 ownerChanges·글: 양쪽 업무가 모두 있고 담당이 다른 것만, 예전 기준(목록 없음)은 null, 담당 없음은 「담당 없음」', () => {
  const base = { '장소 섭외': '도하람', '예산 정리': '윤바다', 사라진: '가', 그대로: '나' };
  const now = { '장소 섭외': '윤바다', '예산 정리': '윤바다', 새로생김: '다', 그대로: '나' };
  assert.deepEqual(ownerChanges(now, base), [{ work: '장소 섭외', before: '도하람', after: '윤바다' }]);
  assert.equal(ownerChanges(now, undefined), null);
  assert.equal(ownerChanges(undefined, base), null);
  assert.equal(ownerChanges('x', base), null);
  assert.deepEqual(ownerChanges({ 일: '가' }, { 일: '가' }), []);
  assert.equal(ownerChangesText([{ work: '장소 섭외', before: '도하람', after: '윤바다' }]), '담당이 바뀐 업무: 「장소 섭외」 도하람 → 윤바다');
  assert.equal(ownerChangesText([{ work: 'A', before: '', after: '가' }, { work: 'B', before: '나', after: '' }]), `담당이 바뀐 업무: 「A」 ${OWNERS_NONE} → 가 · 「B」 나 → ${OWNERS_NONE}`);
  assert.equal(ownerChangesText([]), '');
  const long = Array.from({ length: OWNERS_SHOW + 2 }, (_, i) => ({ work: `업${i}`, before: '가', after: '나' }));
  assert.match(ownerChangesText(long), / 외 2개$/);
});

test('M6 compareRisk: 기준에 owners가 있고 지금 owners를 주면 ownerChanges가 붙고, 예전 기준·owners 안 줌은 null, 숫자 문구는 그대로', () => {
  const nums = { solo: 1, dense: 0, gaps: 0 };
  const base = makeBaseline(nums, { at: '2026-10-17T09:00:00+09:00', owners: { '장소 섭외': '도하람' } });
  const c = compareRisk(nums, base, { solo: [], owners: { '장소 섭외': '윤바다' } });
  assert.deepEqual(c.ownerChanges, [{ work: '장소 섭외', before: '도하람', after: '윤바다' }]);
  assert.equal(c.text, '지난 점검(2026-10-17) 대비: 변화 없음');
  assert.equal(compareRisk(nums, makeBaseline(nums, { at: '2026-10-17T09:00:00+09:00' }), { owners: { 일: '가' } }).ownerChanges, null, '예전 기준');
  assert.equal(compareRisk(nums, base, { solo: [] }).ownerChanges, null, '지금 담당을 안 줌');
  assert.equal(compareRisk(nums, null, { owners: {} }).ownerChanges, null);
});

test('M6·M1 점검 요약 글: 「바뀐 것:」에 담당이 바뀐 업무 줄, 오늘 저장한 점검뿐이면 안내, 예전 기준은 그 줄 없음', () => {
  const d = { mapName: '가상 팀', asOf: ASOF, solo: 1, dense: 0, gaps: 0, soloItems: [{ work: '장소 섭외', person: '윤바다', level: 'high' }], denseItems: [], gapItems: [] };
  const base = makeBaseline(d, { at: '2026-10-17T09:00:00+09:00', owners: { '장소 섭외': '도하람' } });
  const text = inspectionSummaryText(d, compareRisk(d, base, { owners: { '장소 섭외': '윤바다' } }));
  assert.ok(text.includes('바뀐 것:\n  담당이 바뀐 업무: 「장소 섭외」 도하람 → 윤바다'), text);
  const old = inspectionSummaryText(d, compareRisk(d, makeBaseline(d, { at: '2026-10-17T09:00:00+09:00' }), { owners: { '장소 섭외': '윤바다' } }));
  assert.ok(!old.includes('담당이 바뀐'), '예전 기준');
  const same = inspectionSummaryText(d, compareRisk(d, base, { owners: { '장소 섭외': '도하람' } }));
  assert.ok(!same.includes('바뀐 것:'), '그대로면 줄 없음');
  const today = inspectionSummaryText(d, compareRisk(d, null, null, { savedToday: true }));
  assert.ok(today.includes(`지난 점검 대비: ${TODAY_SAVED_TEXT}`), today);
  assert.ok(inspectionSummaryText(d, null).includes('지난 점검 대비: 아직 저장한 점검 없음'));
});

// ── 화면: 위험 요약(M2·M6) ────────────────────────────────────────────────
test('M2·M6 위험 요약 줄: 「이번 점검 저장」 옆에 「점검 요약 보기」(누르면 onSummary), 바뀐 것 상자에 담당이 바뀐 업무 줄', withDom((body) => {
  const s = describeUniverse(buildView(ownersDoc()));
  const draw = (compare) => {
    const panel = document.createElement('div');
    body.append(panel);
    renderUniverseSummary(panel, s, 3, { space: 'check', riskSummary: { parts: ['가'], onMore() {}, compare } });
    return panel;
  };
  let opened = 0;
  const p = draw({ text: '지난 점검(2026-10-17) 대비: 변화 없음', has: true, canSave: true, onSave() {}, onSummary: () => { opened += 1; }, changes: null, ownerChanges: [{ work: '장소 섭외', before: '도하람', after: '윤바다' }] });
  const line = q(p, 'team-risk-compare');
  assert.ok(q(line, 'btn-risk-baseline-save') && q(line, 'btn-risk-summary-open'), '저장 옆에 요약 보기');
  assert.equal(q(line, 'btn-risk-summary-open').textContent, '점검 요약 보기');
  q(line, 'btn-risk-summary-open').click();
  assert.equal(opened, 1);
  const box = q(p, 'team-risk-changes');
  assert.equal(box.children[0].textContent, '바뀐 것 보기');
  assert.equal(q(p, 'risk-change-owner').textContent, '담당이 바뀐 업무: 「장소 섭외」 도하람 → 윤바다');
  // 저장할 수 없는 화면(읽기 전용 등)에서도 요약 보기는 있다
  const ro = draw({ text: '아직 저장한 점검 없음', has: false, canSave: false, onSummary() {}, changes: null, ownerChanges: null });
  assert.equal(q(ro, 'btn-risk-baseline-save'), null);
  assert.ok(q(ro, 'btn-risk-summary-open'));
  assert.equal(q(ro, 'team-risk-changes'), null, '바뀐 것이 없으면 상자 없음');
  // onSummary가 없으면(예전 호출) 단추 없음, 이름 변화만 있어도 상자는 그대로 뜬다
  const old = draw({ text: 't', has: true, canSave: true, onSave() {}, changes: [{ key: 'solo', label: '혼자만 아는 일', added: ['가'], removed: [], addedUnknown: false }] });
  assert.equal(q(old, 'btn-risk-summary-open'), null);
  assert.ok(q(old, 'team-risk-changes') && !q(old, 'risk-change-owner'));
}));

test('M1·M6 인사이트의 점검 요약 글: 오늘 저장한 점검뿐이면 안내, 기준이 있으면 담당이 바뀐 업무까지', withDom((body) => {
  const v = buildView(ownersDoc());
  const d = inspectionInput(v, { asOf: ASOF, n: 3, mapName: '가상' });
  const base = makeBaseline(d, { at: '2026-10-17T09:00:00+09:00', owners: { '장소 섭외': '표나래', '예산 정리': '도하람, 윤바다' }, names: undefined });
  const mk = (extra) => {
    const panel = insightPanel({ view: v, provider: null, kind: 'risk', asOf: ASOF, today: ASOF, mapName: '가상', onFocus() {}, onClose() {}, ...extra });
    body.append(panel);
    const det = q(panel, 'summary-preview');
    det.open = true;
    det.fire('toggle');
    return q(panel, 'summary-preview-text').textContent;
  };
  const withBase = mk({ baseline: base });
  assert.ok(withBase.includes('담당이 바뀐 업무: 「장소 섭외」 표나래 → 도하람'), withBase);
  assert.ok(!withBase.includes('예산 정리」'), '그대로인 업무는 안 나옴');
  const todayOnly = mk({ baseline: null, baselineToday: true });
  assert.ok(todayOnly.includes(`지난 점검 대비: ${TODAY_SAVED_TEXT}`), todayOnly);
  assert.ok(mk({ baseline: null }).includes('지난 점검 대비: 아직 저장한 점검 없음'));
  void namesFromInspection; // (이름 비교는 FU5 시험이 맡는다)
}));

// ── M4: 묶은 지도의 마지막 수정일 ──────────────────────────────────────────
test('M4 lastModifiedDeep: 자기 문서와 하위 지도(숨기지 않은 참조)의 가장 늦은 수정일, 순환·숨긴 참조·읽기 실패·깊이 제한', () => {
  const user = (day) => ({ id: `E-${day}`, type: 'memo', source: 'user', occurred_at: day, recorded_at: `${day}T10:00:00+09:00`, payload: {} });
  const mk = (id, refs, events = []) => ({ universe: { id }, nodes: [], edges: [], events, refs: refs.map((c) => (typeof c === 'string' ? { child_universe_id: c } : c)) });
  const docs = {
    P: mk('P', ['A', 'B', { child_universe_id: 'H', hidden: true }]),
    A: mk('A', ['P'], [user('2026-10-20')]), // P를 다시 가리키는 순환
    B: mk('B', ['C']),
    C: mk('C', [], [user('2026-10-23')]),
    H: mk('H', [], [user('2026-10-24')]), // 숨긴 참조의 지도는 보지 않는다
  };
  const load = (id) => docs[id] || null;
  assert.equal(lastModifiedDeep(docs.P, load), '2026-10-23', '손자 지도(C)까지');
  assert.equal(lastModifiedDeep(docs.P, load, 1), '2026-10-20', '깊이 1이면 B 아래 C는 안 봄');
  assert.equal(lastModifiedDeep(docs.P, null), null, '읽기 함수가 없으면 자기 문서만(수정 없음)');
  assert.equal(lastModifiedDeep(docs.P, () => { throw new Error('x'); }), null, '읽다가 예외가 나면 그 지도는 건너뜀');
  assert.equal(lastModifiedDeep(null, load), null);
  assert.equal(lastModifiedDeep({}, load), null);
  const own = mk('P2', ['A'], [user('2026-10-26')]);
  assert.equal(lastModifiedDeep(own, load), '2026-10-26', '자기 것이 더 늦으면 자기 것');
  // 샘플: 아무도 고치지 않았으면 null, 하위 지도(월말 정산 점검)를 고치면 묶은 부서 지도에도 그 날짜가 보인다
  const byId = Object.fromEntries(SAMPLES.map((s) => [s.universe.id, clone(s)]));
  const dept = byId['U-D1'];
  assert.equal(lastModifiedDeep(dept, (id) => byId[id] || null), null);
  const child = (dept.refs || []).map((r) => r.child_universe_id).find((id) => byId[id]);
  byId[child].events.push(user('2026-10-22'));
  assert.equal(lastModifiedDeep(dept, (id) => byId[id] || null), '2026-10-22');
});

// ── M3: 담당 바꾸기 ────────────────────────────────────────────────────────
const NOW = '2026-10-25T15:00:00+09:00';
const openApp = (storage = memStorage(), id = 'U-A1') => createApp({ store: createStore(storage), samples: SAMPLES, currentId: id, now: () => NOW });
const saveCount = (storage) => { let c = 0; const orig = storage.setItem; storage.setItem = (k, v) => { if (k === 'wu:v1:u:U-A1') c += 1; orig(k, v); }; return () => c; };

test('M3 담당 바꾸기: 한 번의 저장·한 번의 기록으로 보내는 사람의 수행이 끝나고 받는 사람의 수행이 시작된다(담당 종료·시작 이력 둘)', () => {
  const storage = memStorage();
  const app = openApp(storage);
  const count = saveCount(storage);
  const before = { events: app.doc.events.length, edges: app.doc.edges.length, points: editPoints(app.doc).length };
  const r = app.changeAssignee({ workId: 'N-001', fromId: 'N-012', toId: 'N-011', date: '2026-10-25' });
  assert.equal(r.ok, true);
  assert.equal(count(), 1, '저장 한 번');
  assert.equal(app.doc.edges.length, before.edges + 1);
  // 담당 종료·시작 이력 하나씩(연결 수정·생성 이력이 함께 남는다) — 전부 같은 기록 시각
  const added = app.doc.events.slice(before.events);
  assert.deepEqual(added.filter((x) => x.type === 'assign_end' || x.type === 'assign_start').map((x) => [x.type, x.occurred_at, x.payload.person_id, x.payload.work_id, x.source]), [['assign_end', '2026-10-25', 'N-012', 'N-001', 'user'], ['assign_start', '2026-10-25', 'N-011', 'N-001', 'user']]);
  assert.equal(new Set(added.map((x) => x.recorded_at)).size, 1, '한 번의 기록(같은 기록 시각)');
  assert.equal(editPoints(app.doc).length, before.points + 1, '되감기 한 점');
  const ended = app.doc.edges.find((x) => x.source === 'N-012' && x.target === 'N-001' && x.core_type === 'performs');
  assert.deepEqual(ended.period, { start: '2026-10-01', end: '2026-10-25' });
  const started = app.doc.edges.find((x) => x.source === 'N-011' && x.target === 'N-001' && x.period && x.period.start === '2026-10-25');
  assert.ok(started && !started.period.end);
  assert.equal(validateDocument(app.doc).ok, true);
  // 다시 열어도 남아 있다
  assert.equal(openApp(storage).doc.events.length, app.doc.events.length);
  // 새 담당이 오늘부터 지금 담당, 넘긴 날이라 끝나는 사람은 현재 담당에서 빠짐
  assert.deepEqual(currentOwnersByWork(app.view, '2026-10-25')['대사 확인'], '윤바다');
});

test('M3 「인수인계 기록도 남기기」: 같은 저장에 인수인계 이력이 더해지고 바로 앞 인수인계를 가리킨다. 끄면 이력은 둘뿐', () => {
  const app = openApp();
  const n0 = app.doc.events.length;
  const off = app.changeAssignee({ workId: 'N-001', fromId: 'N-012', toId: 'N-011', date: '2026-10-25', handover: false });
  assert.equal(off.ok, true);
  const offAdded = app.doc.events.length - n0;
  assert.equal(app.doc.events.slice(n0).some((x) => x.type === 'handover'), false);
  const app2 = openApp();
  const r = app2.changeAssignee({ workId: 'N-001', fromId: 'N-012', toId: 'N-011', date: '2026-10-25', handover: true });
  assert.equal(r.ok, true);
  assert.equal(r.handover, true);
  assert.equal(app2.doc.events.length, n0 + offAdded + 1, '인수인계 이력 하나만 더해진다');
  const h = app2.doc.events[app2.doc.events.length - 1];
  assert.equal(h.type, 'handover');
  assert.deepEqual(h.payload, { work_id: 'N-001', from_person_id: 'N-012', to_person_id: 'N-011', previous_handover_id: 'E-007' });
  assert.equal(h.occurred_at, '2026-10-25');
  assert.equal(editPoints(app2.doc).length, editPoints(openApp().doc).length + 1, '인수인계까지 합쳐 되감기 한 점');
});

test('M3 이름을 넣으면 같은 이름의 사람이 있으면 그 사람, 없으면 사람을 새로 만들어 받는 사람으로 한다', () => {
  const app = openApp();
  const nodes0 = app.doc.nodes.length;
  const same = app.changeAssignee({ workId: 'N-001', fromId: 'N-012', toName: '  윤바다  ', date: '2026-10-25' });
  assert.equal(same.ok, true);
  assert.deepEqual([same.created, same.to.id, app.doc.nodes.length], [false, 'N-011', nodes0]);
  const app2 = openApp();
  const r = app2.changeAssignee({ workId: 'N-001', fromId: 'N-012', toName: '가상신입', date: '2026-10-25', handover: true });
  assert.equal(r.ok, true);
  assert.equal(r.created, true);
  assert.equal(r.to.label, '가상신입');
  assert.equal(app2.doc.nodes.length, nodes0 + 1);
  const p = app2.doc.nodes.find((x) => x.label === '가상신입');
  assert.equal(p.core_type, 'person');
  assert.ok(app2.doc.edges.some((x) => x.source === p.id && x.target === 'N-001' && x.core_type === 'performs' && x.period.start === '2026-10-25'));
  assert.equal(validateDocument(app2.doc).ok, true);
});

test('M3 거부는 아무것도 저장하지 않는다: 보내는 사람이 진행 중 아님·받는 사람이 이미 담당 중·같은 사람·오늘 뒤 날짜·빈 받는 사람·없는 업무', () => {
  const storage = memStorage();
  const app = openApp(storage);
  const snap = () => JSON.stringify(app.doc);
  const base = snap();
  const raw = storage.getItem('wu:v1:u:U-A1');
  const expectFail = (input, check) => {
    const r = app.changeAssignee({ date: '2026-10-25', ...input });
    assert.equal(r.ok, false, JSON.stringify(input));
    check(r.error);
    assert.equal(snap(), base, '문서 그대로');
    assert.equal(storage.getItem('wu:v1:u:U-A1'), raw, '저장소 그대로');
  };
  // 윤바다는 대사 확인을 이미 끝냄 → 보내는 사람이 진행 중이 아님. 새 이름을 함께 줘도 사람이 만들어지지 않는다
  expectFail({ workId: 'N-001', fromId: 'N-011', toName: '가상신입2' }, (er) => assert.deepEqual([er.code, er.field, er.no_active], ['E-SCHEMA', 'work_id', true]));
  expectFail({ workId: 'N-001', fromId: 'N-012', toId: 'N-012' }, (er) => assert.equal(er.same_person, true));
  expectFail({ workId: 'N-001', fromId: 'N-012', toId: 'N-011', date: '2026-10-26' }, (er) => assert.deepEqual([er.field, er.future], ['occurred_at', true]));
  expectFail({ workId: 'N-001', fromId: 'N-012', toId: 'N-011', date: '' }, (er) => assert.equal(er.field, 'occurred_at'));
  expectFail({ workId: 'N-001', fromId: 'N-012' }, (er) => assert.deepEqual([er.code, er.field], ['E-REQUIRED', 'to_person_id']));
  expectFail({ workId: 'N-001', fromId: 'N-012', toName: '   ' }, (er) => assert.equal(er.field, 'to_person_id'));
  expectFail({ workId: 'N-999', fromId: 'N-012', toId: 'N-011' }, (er) => assert.equal(er.field, 'work_id'));
  expectFail({ workId: 'N-001', fromId: 'N-999', toId: 'N-011' }, (er) => assert.equal(er.field, 'person_id'));
  expectFail({ workId: 'N-010', fromId: 'N-012', toId: 'N-011' }, (er) => assert.equal(er.field, 'work_id')); // 사람 노드는 업무가 아님
  // 받는 사람이 이미 담당 중: 한가람을 먼저 담당 시작으로 넣은 뒤 서하늘 → 한가람
  assert.equal(app.addEvent({ type: 'assign_start', occurred_at: '2026-10-20', payload: { person_id: 'N-010', work_id: 'N-001' } }).ok, true);
  const base2 = snap();
  const dup = app.changeAssignee({ workId: 'N-001', fromId: 'N-012', toId: 'N-010', date: '2026-10-25' });
  assert.equal(dup.ok, false);
  assert.equal(dup.error.already_active, true);
  assert.equal(snap(), base2, '서하늘의 수행도 끝나지 않았다(전부 아니면 전무)');
  // 보내는 사람의 시작일보다 이른 날짜는 거부되고 아무것도 바뀌지 않는다
  const early = app.changeAssignee({ workId: 'N-001', fromId: 'N-012', toId: 'N-011', date: '2026-09-01' });
  assert.equal(early.ok, false);
  assert.equal(snap(), base2);
});

test('M3 읽기 전용(저장소 없음·되감기 중)에서는 거부', () => {
  const ro = createApp({ store: null, samples: SAMPLES, currentId: 'U-A1', now: () => NOW });
  assert.equal(ro.changeAssignee({ workId: 'N-001', fromId: 'N-012', toId: 'N-011', date: '2026-10-25' }).error.code, 'W-STORAGE');
  const app = openApp();
  app.setRewinding(true);
  const r = app.changeAssignee({ workId: 'N-001', fromId: 'N-012', toId: 'N-011', date: '2026-10-25' });
  assert.deepEqual([r.ok, r.error.reason], [false, 'rewinding']);
  app.setRewinding(false);
  assert.equal(app.changeAssignee({ workId: 'N-001', fromId: 'N-012', toId: 'N-011', date: '2026-10-25' }).ok, true);
});

test('M3 하위 지도 항목(다른 지도)의 업무는 이 지도의 문서에 없어 거부된다(화면은 「…」 열기 안내)', () => {
  const app = openApp(memStorage(), 'U-D1');
  const r = app.changeAssignee({ workId: 'N-001', fromId: 'N-012', toId: 'N-011', date: '2026-10-25' });
  assert.equal(r.ok, false);
});
