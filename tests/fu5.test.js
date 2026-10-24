// 처음 사용 점검 5회차(FU5, CR-18 범위 안 보완) 단위 검증: 점검 기준에 이름 목록(바뀐 것 보기)·저장 알림·점검 요약 미리 보기/내려받기 알림·
// 점검 저장한 지도 목록·유사 경험자 안내·담당 넘긴 날 표시·못 쓰는 관계 고를 수 없음·오류 줄 지우기.
// 순수 계산 + DOM 흉내(tests/dom-stub.js)로 돌린다. 실제 브라우저 점검(tools/browser-check.mjs 「처음 사용 5회차(FU5)」)을 대신하지 않는다. 가상 데이터만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeEl, installDom, uninstallDom } from './dom-stub.js';
import { buildView } from '../app/src/view/view.js';
import { mkDoc, mkEdge as e, mkNode as n } from './helpers.js';
import {
  BASELINE_NAMES_MAX, NAMES_CUT_NOTE, baselineSavedNote, checkedLabel, cleanBaselineNames, cleanRiskBaselines, compareRisk, inspectionSummaryText,
  makeBaseline, nameChanges, namesFromInspection, namesText, startMaps,
} from '../app/src/rules/daily-use.js';
import { loadSettings, saveSettings } from '../app/src/store/local.js';
import { inspectionInput } from '../app/src/view/risk-summary.js';
import { renderUniverseSummary } from '../app/src/ui/detail.js';
import { describeNode, describeUniverse, currentHoldersText, handingOverToday } from '../app/src/view/describe.js';
import { workLoad } from '../app/src/rules/insight.js';
import { startScreen } from '../app/src/ui/start.js';
import { summaryBar } from '../app/src/ui/check-summary.js';
import { SIMILAR_PERSON_HINT, insightPanel } from '../app/src/ui/insight.js';
import { edgeForm, markRelationOptions } from '../app/src/ui/editor.js';
import { EDGE_TYPES } from '../app/src/model/schema.js';

const withDom = (fn) => async () => {
  const body = installDom();
  const hadRemove = Object.hasOwn(FakeEl.prototype, 'remove');
  if (!hadRemove) FakeEl.prototype.remove = function remove() { if (this.parentNode) this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1); this.parentNode = null; };
  try { await fn(body); } finally { if (!hadRemove) delete FakeEl.prototype.remove; uninstallDom(); }
};
const q = (root, id) => root.querySelector(`[data-testid=${id}]`);
const ASOF = '2026-10-25';
const AT = '2026-10-25T09:00:00+09:00';
const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
};

// ── A1: 점검 기준의 이름 목록 ──
test('FU5-1 이름 목록 다듬기: 문자열만·공백 뗌·중복 없음, 목록당 BASELINE_NAMES_MAX개에서 자르고 cut 표시, 목록이 없으면 undefined', () => {
  assert.equal(cleanBaselineNames(undefined), undefined);
  assert.equal(cleanBaselineNames('x'), undefined);
  assert.equal(cleanBaselineNames([]), undefined);
  assert.equal(cleanBaselineNames({ solo: 'x' }), undefined);
  assert.deepEqual(cleanBaselineNames({ solo: [' 가 ', '가', '', '나'], dense: [], extra: ['x'] }), { solo: ['가', '나'], dense: [] });
  // 브라우저 점검(FU5-1)에서 찾은 결함: 글자 아닌 값이 섞인 목록을 걸러 남기면 빈 목록과 비교돼 지금 목록 전부가 「늘어남」으로 나왔다 → 그 목록은 통째로 버린다(더 엄격하게)
  assert.deepEqual(cleanBaselineNames({ solo: [' 가 ', 3, null, '나'], dense: [] }), { dense: [] });
  const many = Array.from({ length: BASELINE_NAMES_MAX + 5 }, (_, i) => `업무${i}`);
  const c = cleanBaselineNames({ gaps: many });
  assert.equal(c.gaps.length, BASELINE_NAMES_MAX);
  assert.deepEqual(c.cut, { gaps: true });
  assert.equal(cleanBaselineNames({ solo: ['가'], cut: { solo: true } }).cut.solo, true, '잘렸다는 표시는 다시 읽어도 남는다');
  assert.equal(cleanBaselineNames({ solo: ['가'.repeat(101)] }).solo.length, 0, '이름 길이 상한');
});

test('FU5-1 기준 한 건: 이름을 주면 저장되고, 안 주면 예전 모양 그대로(names 없음)', () => {
  const old = makeBaseline({ solo: 1, dense: 0, gaps: 2 }, { at: AT, asOf: ASOF });
  assert.deepEqual(old, { solo: 1, dense: 0, gaps: 2, at: AT, asOf: ASOF });
  const b = makeBaseline({ solo: 1, dense: 0, gaps: 2 }, { at: AT, asOf: ASOF, names: { solo: ['가'], dense: [], gaps: ['나', '다'] } });
  assert.deepEqual(b.names, { solo: ['가'], dense: [], gaps: ['나', '다'] });
});

test('FU5-1 설정 걸러 내기: 이름 목록은 읽고 되살리며, 깨진 names는 버리고 숫자는 남긴다. 예전 기준(이름 없음)도 그대로', () => {
  const good = { 'M-1': makeBaseline({ solo: 1, dense: 0, gaps: 1 }, { at: AT, asOf: ASOF, names: { solo: ['가'], dense: [], gaps: ['나'] } }) };
  const st = memStorage();
  assert.equal(saveSettings(st, { provider: 'pregen', riskBaseline: good }), true);
  assert.deepEqual(loadSettings(st, { provider: 'pregen' }).riskBaseline, good);
  const broken = cleanRiskBaselines({
    'M-1': { solo: 1, dense: 0, gaps: 1, at: AT, names: 'x' },
    'M-2': { solo: 1, dense: 0, gaps: 1, at: AT, names: { solo: [1, {}], gaps: 'x' } },
    'M-3': { solo: 2, dense: 0, gaps: 0, at: AT },
  });
  assert.deepEqual(broken['M-1'], { solo: 1, dense: 0, gaps: 1, at: AT });
  assert.deepEqual(broken['M-2'], { solo: 1, dense: 0, gaps: 1, at: AT }); // 글자 아닌 값이 섞인 목록은 버려 이름 비교 없음(위 FU5-1 결함)
  assert.deepEqual(broken['M-3'], { solo: 2, dense: 0, gaps: 0, at: AT });
  // 설정이 아예 없거나 저장소가 없을 때
  assert.deepEqual(loadSettings(memStorage(), { provider: 'pregen' }), { provider: 'pregen' });
  assert.deepEqual(loadSettings(null, { provider: 'pregen' }), { provider: 'pregen' });
});

test('FU5-1 이름 비교: 늘어남·줄어듦을 가리고, 예전 기준·못 센 목록은 null/건너뜀, 잘린 기준은 늘어남을 가릴 수 없다고 표시', () => {
  const base = { solo: ['가', '나'], dense: ['다'], gaps: [] };
  const ch = nameChanges({ solo: ['나', '라'], dense: ['다'], gaps: ['마'] }, base);
  assert.deepEqual(ch.map((c) => [c.key, c.added, c.removed]), [['solo', ['라'], ['가']], ['gaps', ['마'], []]]);
  assert.deepEqual(nameChanges({ solo: ['가', '나'], dense: ['다'], gaps: [] }, base), [], '이름도 그대로면 빈 배열(이름 비교는 했음)');
  assert.equal(nameChanges({ solo: ['가'] }, undefined), null, '예전 기준: 이름 목록 없음');
  assert.equal(nameChanges(null, base), null);
  assert.deepEqual(nameChanges({ solo: ['가'] }, base).map((c) => c.key), ['solo'], '지금 못 센 목록은 건너뜀');
  const cut = nameChanges({ solo: ['가', '새로'] }, { solo: ['가', '나'], cut: { solo: true } });
  assert.deepEqual(cut, [{ key: 'solo', label: '혼자만 아는 일', added: [], removed: ['나'], addedUnknown: true }]);
  const cutOnly = nameChanges({ solo: ['가', '나'] }, { solo: ['가', '나'], cut: { solo: true } });
  assert.equal(cutOnly[0].addedUnknown, true);
  assert.ok(NAMES_CUT_NOTE.includes(String(BASELINE_NAMES_MAX)));
  assert.equal(namesText(['가', '나']), '「가」, 「나」');
  assert.equal(namesText(Array.from({ length: 10 }, (_, i) => `x${i}`)), `${Array.from({ length: 8 }, (_, i) => `「x${i}」`).join(', ')} 외 2개`);
});

test('FU5-1 compareRisk: 이름 목록을 주면 changes가 붙고, 숫자 문구는 그대로. 기준 없음·예전 기준은 changes null', () => {
  const nums = { solo: 2, dense: 0, gaps: 0 };
  const base = makeBaseline({ solo: 1, dense: 0, gaps: 0 }, { at: AT, names: { solo: ['가'], dense: [], gaps: [] } });
  const c = compareRisk(nums, base, { solo: ['가', '나'], dense: [], gaps: [] });
  assert.equal(c.text, '지난 점검(2026-10-25) 대비: 혼자만 아는 일 +1 · 일 몰린 사람 변화 없음 · 담당자 빈 일 변화 없음');
  assert.deepEqual(c.changes.map((x) => [x.key, x.added]), [['solo', ['나']]]);
  assert.equal(compareRisk(nums, null, { solo: [] }).changes, null);
  assert.equal(compareRisk(nums, makeBaseline({ solo: 1, dense: 0, gaps: 0 }, { at: AT }), { solo: ['가'] }).changes, null);
  assert.equal(compareRisk(nums, base).changes, null, '지금 이름을 안 주면 이름 비교 안 함(호환)');
});

const people = (...ids) => ids.map((id) => n(id, 'person', `사람${id}`));
const perf = (p, w, period) => e(p, w, 'performs', period ? { period } : {});
const viewOf = (nodes, edges) => buildView(mkDoc('U-R', nodes, edges, []));

test('FU5-1 namesFromInspection·점검 요약 글: 세 목록의 이름을 뽑고, 바뀐 것이 글에 들어간다', () => {
  const v = viewOf([n('W1', 'work', '정산'), n('W2', 'work', '대사'), n('W3', 'work', '빈 업무'), ...people('P1', 'P2')], [perf('P1', 'W1'), perf('P2', 'W2')]);
  const d = inspectionInput(v, { asOf: ASOF, n: 3, mapName: '가상 지도' });
  const names = namesFromInspection(d);
  assert.deepEqual(Object.keys(names).sort(), ['dense', 'gaps', 'solo']);
  assert.deepEqual(names.gaps, ['빈 업무']);
  assert.deepEqual(names.solo.slice().sort(), ['대사', '정산']);
  assert.deepEqual(namesFromInspection({ solo: null, dense: 0, gaps: 0, soloItems: [], denseItems: [], gapItems: [] }), { dense: [], gaps: [] }, '못 센 목록(null)은 뺀다');
  const base = makeBaseline(d, { at: '2026-10-18T09:00:00+09:00', names: { solo: ['정산'], dense: [], gaps: [] } });
  const text = inspectionSummaryText(d, compareRisk(d, base, names));
  assert.match(text, /바뀐 것:\n {2}혼자만 아는 일\n {4}늘어남: 「대사」/);
  assert.ok(!text.includes('줄어듦'));
  const oldText = inspectionSummaryText(d, compareRisk(d, makeBaseline(d, { at: '2026-10-18T09:00:00+09:00' }), names));
  assert.ok(!oldText.includes('바뀐 것:'), '예전 기준이면 숫자만');
});

test('FU5-1·2 개요 화면: 이름이 바뀌었으면 접힌 「바뀐 것 보기」에 늘어남·줄어듦, 예전 기준·변화 없음이면 상자 없음. 저장 직후 알림 한 줄', withDom((body) => {
  const s = describeUniverse(viewOf([n('W1', 'work', '정산')], []));
  const draw = (compare) => {
    const panel = document.createElement('div');
    body.append(panel);
    renderUniverseSummary(panel, s, 3, { riskSummary: { parts: ['가'], onMore() {}, compare } });
    return panel;
  };
  const mk = (extra) => ({ text: '지난 점검(2026-10-18) 대비: 혼자만 아는 일 +1', has: true, canSave: true, onSave() {}, ...extra });
  const changes = [
    { key: 'solo', label: '혼자만 아는 일', added: ['대사'], removed: ['정산'], addedUnknown: false },
    { key: 'gaps', label: '담당자 빈 일', added: [], removed: [], addedUnknown: true },
  ];
  const p = draw(mk({ changes }));
  const box = q(p, 'team-risk-changes');
  assert.equal(box.tagName, 'DETAILS');
  assert.equal(box.children[0].textContent, '바뀐 것 보기');
  assert.equal(q(p, 'risk-change-added').textContent, '늘어남: 「대사」');
  assert.equal(q(p, 'risk-change-removed').textContent, '줄어듦: 「정산」');
  assert.ok(box.textContent.includes(NAMES_CUT_NOTE));
  assert.equal(q(draw(mk({ changes: null })), 'team-risk-changes'), null);
  assert.equal(q(draw(mk({ changes: null })), 'risk-baseline-saved'), null);
  const saved = q(draw(mk({ changes: null, savedNote: baselineSavedNote(AT) })), 'risk-baseline-saved');
  assert.equal(saved.textContent, '이번 점검을 저장했습니다(2026-10-25) — 다음에 열면 이 숫자와 비교합니다');
  assert.equal(saved.getAttribute('role'), 'status');
}));

// ── A3: 점검 요약 미리 보기·내려받기 알림 ──
test('FU5-3 점검 요약 줄: 접힌 「미리 보기」는 열 때 복사·내려받기될 글 그대로를 보이고, 내려받기 뒤 「「파일이름」을 내려받았습니다」', withDom(async (body) => {
  let text = '글 하나';
  const bar = summaryBar({ build: () => text, mapName: '가상 지도', asOf: ASOF });
  body.append(bar);
  const pv = q(bar, 'summary-preview');
  assert.equal(pv.tagName, 'DETAILS');
  assert.equal(pv.children[0].textContent, '미리 보기');
  assert.ok(!pv.open);
  assert.equal(q(bar, 'summary-preview-text').textContent, '', '접힌 동안은 만들지 않음');
  pv.open = true;
  pv.fire('toggle');
  assert.equal(q(bar, 'summary-preview-text').textContent, '글 하나');
  text = '글 둘';
  q(bar, 'summary-download').click();
  assert.equal(q(bar, 'summary-preview-text').textContent, '글 둘', '열려 있으면 단추를 누를 때 같이 새로 만든 글');
  assert.equal(q(bar, 'summary-downloaded').textContent, '「점검요약-가상 지도-2026-10-25.txt」를 내려받았습니다');
  assert.equal(q(bar, 'summary-download-blocked'), null);
}));

// ── A4: 점검 저장한 지도 ──
const U = (id, name, is_sample = false) => ({ id, name, level: '팀', is_sample, node_count: 3, ref_count: 0 });
test('FU5-4 시작 목록: 점검을 저장한 지도는 마지막으로 연 지도가 바뀌어도 남고(샘플도), 마지막 점검 날짜가 붙는다. 기준이 없으면 예전과 같다', withDom((body) => {
  const us = [U('M-1', '내 지도'), U('S-2', '샘플 나', true), U('S-3', '샘플 다', true)];
  const info = { 'M-1': { modified: '2026-10-20', edited: false }, 'S-2': { modified: null, edited: false }, 'S-3': { modified: null, edited: false } };
  const baselines = {
    'S-2': makeBaseline({ solo: 1, dense: 0, gaps: 0 }, { at: '2026-10-24T09:00:00+09:00' }),
    'M-1': makeBaseline({ solo: 0, dense: 0, gaps: 0 }, { at: '2026-10-22T09:00:00+09:00' }),
  };
  const rows = startMaps(us, info, 'S-3', baselines);
  assert.deepEqual(rows.map((r) => [r.id, r.kind, r.checked]), [['M-1', 'mine', '2026-10-22'], ['S-2', 'checked-sample', '2026-10-24'], ['S-3', 'recent-sample', null]]);
  assert.deepEqual(startMaps(us, info, 'S-3').map((r) => r.id), ['M-1', 'S-3'], '기준을 안 주면(예전 호출) 안 고친 샘플은 빠진다');
  assert.deepEqual(startMaps(us, info, '', {}).map((r) => r.id), ['M-1']);
  assert.deepEqual(startMaps(us, info, '', { 'X-9': baselines['S-2'], 'S-2': { at: '날짜 아님' } }).map((r) => r.id), ['M-1'], '깨진 기준·없는 지도는 무시');
  const root = startScreen({ universes: us, maps: rows, resume: null, guide: {}, warnings: [], readOnly: false, onOpen() {}, onCreate() {}, onTour() {} });
  body.append(root);
  const checked = root.querySelectorAll('[data-testid=map-checked]').map((x) => x.textContent);
  assert.deepEqual(checked, [checkedLabel('2026-10-22'), checkedLabel('2026-10-24')]);
  assert.equal(checkedLabel('2026-10-24'), '점검 저장한 지도 · 마지막 점검 2026-10-24');
  assert.ok(q(root, 'mine-card-S-2') && q(root, 'mine-open-S-2'));
}));

// ── A5: 유사 경험자 탭 안내 ──
test('FU5-5 유사 경험자 탭 설명 아래에 사람이 빠질 때 누가 대신하는지 찾는 길 한 줄', withDom((body) => {
  const panel = insightPanel({ view: viewOf([n('W1', 'work', '정산'), ...people('P1')], [perf('P1', 'W1')]), provider: null, kind: 'similar', asOf: ASOF, today: ASOF, mapName: '가상', baseline: null, onFocus() {}, onClose() {} });
  body.append(panel);
  assert.equal(q(panel, 'similar-person-hint').textContent, SIMILAR_PERSON_HINT);
  assert.ok(SIMILAR_PERSON_HINT.includes('사람이 빠질 때 누가 대신하는지는 그래프에서 그 사람을 고르면 「이 사람 일, 누가 대신할 수 있나」에 나옵니다'));
}));

// ── B8: 담당을 넘긴 날 ──
test('FU5-8 담당을 넘긴 날: 끝 날짜가 기준일이고 같은 업무에 기준일 시작한 다른 담당이 있으면 「오늘까지(넘김)」, 규칙(workLoad)은 둘 다 현재 그대로', () => {
  const v = viewOf([n('W1', 'work', '정산'), n('P1', 'person', '가상갑'), n('P2', 'person', '가상을'), n('P3', 'person', '가상병')],
    [perf('P1', 'W1', { start: '2026-01-01', end: ASOF }), perf('P2', 'W1', { start: ASOF }), perf('P3', 'W1', { start: '2026-02-01' })]);
  const w = 'U-R/W1';
  assert.deepEqual([...handingOverToday(v, w, ASOF)], ['U-R/P1']);
  assert.deepEqual([...handingOverToday(v, w, '2026-10-24')], [], '다른 날은 해당 없음');
  const cur = workLoad(v, w, { asOf: ASOF }).current;
  assert.deepEqual(cur.map((p) => p.label).sort(), ['가상갑', '가상병', '가상을'], '규칙 계산은 그대로');
  const link = (person) => describeNode(v, person, { asOf: ASOF }).links.find((l) => l.relation_type === 'performs');
  assert.equal(link('U-R/P1').status, '오늘까지(넘김)');
  assert.equal(link('U-R/P1').status_key, 'handover');
  assert.equal(link('U-R/P2').status, '현재');
  assert.equal(describeNode(v, 'U-R/P1', { asOf: ASOF, past: true }).links.find((l) => l.relation_type === 'performs').status, '그날까지(넘김)');
  assert.equal(currentHoldersText(v, w, ASOF, cur), '가상을, 가상병 (가상갑은 오늘까지)');
  assert.equal(currentHoldersText(v, w, ASOF, cur, { past: true }), '가상을, 가상병 (가상갑은 그날까지)');
});

test('FU5-8 넘김이 아닌 경우: 받는 사람이 없거나(끝만 오늘), 같은 사람의 이어 쓰기, 기간 없음, 기준일 없음은 평소 표시 그대로', () => {
  const only = viewOf([n('W1', 'work', '정산'), ...people('P1')], [perf('P1', 'W1', { start: '2026-01-01', end: ASOF })]);
  assert.equal(handingOverToday(only, 'U-R/W1', ASOF).size, 0);
  assert.equal(describeNode(only, 'U-R/P1', { asOf: ASOF }).links.find((l) => l.relation_type === 'performs').status, '현재');
  assert.equal(currentHoldersText(only, 'U-R/W1', ASOF, workLoad(only, 'U-R/W1', { asOf: ASOF }).current), '사람P1');
  const same = viewOf([n('W1', 'work', '정산'), ...people('P1')], [perf('P1', 'W1', { start: '2026-01-01', end: ASOF }), perf('P1', 'W1', { start: ASOF })]);
  assert.equal(handingOverToday(same, 'U-R/W1', ASOF).size, 0, '같은 사람이 다시 시작한 것은 넘김이 아니다');
  const none = viewOf([n('W1', 'work', '정산'), ...people('P1')], [perf('P1', 'W1')]);
  assert.equal(handingOverToday(none, 'U-R/W1', ASOF).size, 0);
  assert.equal(handingOverToday(none, 'U-R/W1', '').size, 0);
  assert.equal(handingOverToday(none, 'U-R/W1', null).size, 0);
});

// ── B9: 못 쓰는 관계 보기는 고를 수 없음 ──
const node = (id, core_type, label) => ({ id, core_type, label, type_label: { org: '조직', work: '업무', person: '사람', topic: '주제' }[core_type] || core_type });
const pick = (sel, value) => { sel.value = value; sel.fire('change'); };

test('FU5-9 못 쓰는 보기는 고를 수 없음: 「이 조합에는 못 씀」 묶음의 값이 들어오면(change) 직전의 쓸 수 있던 값으로 되돌린다', withDom(() => {
  const person = node('N-1', 'person', '가상갑');
  const work = node('N-2', 'work', '가상 업무');
  const form = edgeForm({ node: person, candidates: [work], onSubmit: () => ({ ok: true }), onCancel() {} });
  const rel = q(form, 'edge-type');
  pick(q(form, 'edge-other'), work.id); // 사람 → 업무: 수행·참조만
  assert.equal(rel.value, 'performs');
  const blocked = rel.querySelector('optgroup').children;
  assert.ok(blocked.length > 0 && blocked.every((o) => o.disabled));
  pick(rel, 'relates_to'); // 못 쓰는 값
  assert.equal(rel.value, 'performs');
  pick(rel, 'references'); // 쓸 수 있는 값은 그대로 바뀐다
  assert.equal(rel.value, 'references');
  pick(rel, 'relates_to');
  assert.equal(rel.value, 'references', '직전의 쓸 수 있던 값');
  assert.ok(!Array.from(rel.options).find((o) => o.value === rel.value).disabled);
}));

test('FU5-9 직접 고른 값이 상대를 고른 뒤 못 쓰게 되면 첫 관계로 바꾸고 알린다(조사 포함). 하나뿐인 조합은 예전 안내 그대로', withDom(() => {
  const mkSel = (value) => {
    const sel = document.createElement('select');
    for (const k of Object.keys(EDGE_TYPES)) { const o = document.createElement('option'); o.setAttribute('value', k); o.value = k; sel.append(o); }
    sel.value = value;
    return sel;
  };
  const sel = mkSel('performs');
  const hint = document.createElement('p');
  markRelationOptions(sel, 'topic', 'work', hint, { touched: true });
  assert.equal(sel.value, 'relates_to');
  assert.equal(hint.hidden, false);
  assert.equal(hint.textContent, '(고른 「수행」은 이 조합에 쓸 수 없어 「관련」으로 바꿨습니다)');
  const sel2 = mkSel('relates_to');
  const hint2 = document.createElement('p');
  markRelationOptions(sel2, 'org', 'work', hint2, { touched: true });
  assert.equal(sel2.value, 'references');
  assert.equal(hint2.textContent, '(이 조합은 「참조」만 됩니다)');
}));

// ── B12: 양식 값이 바뀌면 앞 오류 줄을 지운다 ──
test('FU5-12 연결 추가: 실패한 뒤 양식 값을 바꾸면(change) 오류 줄이 지워지고, 다시 실패하면 새 오류가 뜬다', withDom((body) => {
  const person = node('N-1', 'person', '가상갑');
  const work = node('N-2', 'work', '가상 업무');
  const other = node('N-3', 'person', '가상을');
  const results = [{ ok: false, error: { code: 'E-PAIR' } }, { ok: false, error: { code: 'E-PAIR' } }];
  const form = edgeForm({ node: person, candidates: [work, other], onSubmit: () => results.shift() || { ok: true }, onCancel() {} });
  body.append(form);
  pick(q(form, 'edge-other'), work.id);
  form.fire('submit');
  const msg = q(form, 'form-message');
  assert.equal(msg.dataset.code, 'E-PAIR');
  assert.ok(msg.textContent.length > 0);
  form.fire('change'); // 양식 안의 값이 바뀌면 change가 form까지 올라온다
  assert.equal(msg.textContent, '');
  assert.equal(msg.dataset.code, undefined);
  assert.ok(!msg.className.includes('error'));
  form.fire('submit');
  assert.equal(msg.dataset.code, 'E-PAIR');
}));
