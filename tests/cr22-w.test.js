// CR-22 W 작업 공간 단위 검증: 공간 상태 규칙(순수 함수), 공간별 패널 구성, 배지, 인수인계·매주 점검 목록 계산, 따라 하기 단계-공간 표, 기능 찾기의 공간, 화면 조각(DOM 흉내).
// 실제 브라우저 점검(tools/browser-check.mjs 「CR-22 W」)을 대신하지 않는다. 가상 데이터만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, uninstallDom } from './dom-stub.js';
import { allSamples, mkDoc, mkEdge, mkNode, viewOf } from './helpers.js';
import { buildView } from '../app/src/view/view.js';
import {
  DEFAULT_WORKSPACE, WORKSPACES, WORKSPACE_KEYS, WORKSPACE, WORK_SCREENS, cleanWorkspace, denseRows, followScreens, gapWorkRows, isWorkspace,
  panelParts, planSwitch, recentHandoverDocs, soloRows, spaceBadges, spaceForScreen, workspaceOf,
} from '../app/src/view/workspace.js';
import { denseBox, docsBox, gapBox, renderWorkspaceNav, soloBox } from '../app/src/ui/workspace.js';
import { FEATURES, searchFeatures } from '../app/src/view/feature-index.js';
import { scenarioOf, teamScenario, TEAM_ORDER, emptyState } from '../app/src/rules/tour-steps.js';
import { endHint } from '../app/src/ui/tour.js';
import { starterSteps } from '../app/src/rules/starter-steps.js';
import { loadSettings, saveSettings } from '../app/src/store/local.js';
import { createUniverse } from '../app/src/model/commands.js';
import { applyStarter } from '../app/src/model/starter.js';

const q = (root, id) => root.querySelector(`[data-testid=${id}]`);
const withDom = (fn) => async () => {
  const body = installDom();
  try { await fn(body); } finally { uninstallDom(); }
};
const ASOF = '2026-10-02';

// ── 공간 이름·기본값 ──
test('CR-22 W 공간 5개: 이름·순서·단추 이름(ws-*)·기본은 지도 보기, 모르는 값은 기본', () => {
  assert.deepEqual(WORKSPACES.map((w) => w.label), ['지도 보기', '기록', '인수인계', '매주 점검', '지도 관리']);
  assert.deepEqual(WORKSPACES.map((w) => w.testid), ['ws-map', 'ws-record', 'ws-handover', 'ws-check', 'ws-edit']);
  assert.deepEqual(WORKSPACE_KEYS, ['map', 'record', 'handover', 'check', 'edit']);
  assert.equal(DEFAULT_WORKSPACE, 'map');
  for (const k of WORKSPACE_KEYS) assert.ok(isWorkspace(k) && cleanWorkspace(k) === k);
  for (const bad of ['', 'nope', null, undefined, 3, {}, 'toString', 'MAP']) assert.equal(cleanWorkspace(bad), 'map', String(bad));
  assert.equal(workspaceOf('check').label, '매주 점검');
  assert.equal(workspaceOf('엉뚱').label, '지도 보기');
  for (const w of WORKSPACES) assert.ok(w.desc.length > 10, w.key);
});

// ── 상태 규칙 ──
test('CR-22 W 상태 규칙 ① 작업 화면을 열면 메뉴가 그 공간으로(초안→인수인계, 인사이트→매주 점검, 통합 확인·되감기·숨긴 항목→지도 관리, 미해결→기록, 설정은 그대로)', () => {
  assert.equal(spaceForScreen('draft'), 'handover');
  assert.equal(spaceForScreen('insight'), 'check');
  assert.equal(spaceForScreen('merge'), 'edit');
  assert.equal(spaceForScreen('rewind'), 'edit');
  assert.equal(spaceForScreen('hidden'), 'edit');
  assert.equal(spaceForScreen('issues'), 'record');
  assert.equal(spaceForScreen('settings'), null);
  assert.equal(spaceForScreen('없는 화면'), null);
  assert.equal(spaceForScreen('toString'), null);
  assert.deepEqual(WORK_SCREENS, ['draft', 'insight', 'merge', 'issues', 'settings', 'rewind', 'hidden']);
  assert.equal(followScreens('map', ['draft']), 'handover');
  assert.equal(followScreens('map', ['insight']), 'check');
  assert.equal(followScreens('record', ['settings']), 'record', '설정은 공간을 바꾸지 않는다');
  assert.equal(followScreens('check', []), 'check', '열린 화면이 없으면 그대로');
  assert.equal(followScreens('엉뚱', []), 'map');
  assert.equal(followScreens('map', ['settings', 'draft']), 'handover', '설정과 함께여도 공간이 정해진 화면을 따른다');
});

test('CR-22 W 상태 규칙 ② 메뉴로 공간을 바꾸면 열린 작업 화면은 모두 닫는다(R11 FU6-1: 항목 카드도 닫으므로 계획에 카드 유지·스크롤은 없다)', () => {
  // R11 FU6-1 변경 이유: 카드를 둔 채 강조만 바뀌면 「메뉴가 안 먹는다」로 보여 keepCard·scroll 규칙을 없앴다. 영향: R-08 ⑧~⑪ 공간 메뉴
  const open = ['draft', 'insight', 'settings'];
  const p = planSwitch({ to: 'record', open });
  assert.deepEqual(p, { space: 'record', closeScreens: ['draft', 'insight', 'settings'] });
  assert.equal('keepCard' in planSwitch({ to: 'edit' }), false);
  assert.equal('scroll' in planSwitch({ to: 'edit' }), false);
  // 같은 공간을 다시 눌러도 작업 화면은 닫힌다(그 공간 첫 화면으로)
  assert.deepEqual(planSwitch({ to: 'check', open: ['insight'] }).closeScreens, ['insight']);
  // 되감기·숨긴 항목·통합 확인도 닫는다
  assert.deepEqual(planSwitch({ to: 'map', open: ['rewind', 'hidden', 'merge', 'issues'] }).closeScreens, ['merge', 'issues', 'rewind', 'hidden']);
  // 모르는 공간은 기본, 열린 화면 목록이 없어도 된다
  assert.equal(planSwitch({ to: '엉뚱' }).space, 'map');
  assert.deepEqual(planSwitch({ to: 'map' }).closeScreens, []);
  // 열린 목록에 없는 이름은 무시
  assert.deepEqual(planSwitch({ to: 'map', open: ['쓰레기'] }).closeScreens, []);
});

test('CR-22 W 배지: 기록 = 미해결 수, 매주 점검 = 혼자만 아는 일 수. 0·셀 수 없음(null)·NaN은 배지 없음', () => {
  assert.deepEqual(spaceBadges({ issues: 3, solo: 2 }), { map: null, record: 3, handover: null, check: 2, edit: null });
  assert.deepEqual(spaceBadges({ issues: 0, solo: null }), { map: null, record: null, handover: null, check: null, edit: null });
  assert.deepEqual(spaceBadges({ issues: NaN, solo: undefined }), { map: null, record: null, handover: null, check: null, edit: null });
});

// ── 공간별 패널 구성 ──
const ctx = (over = {}) => ({ grouped: false, readOnly: false, rewinding: false, starter: false, split: false, empty: false, folder: false, conflicts: false, stale: false, ...over });
test('CR-22 W 패널 구성: 공간마다 위에서부터 보일 조각(읽기 전용·묶은 지도·되감기 반영)', () => {
  assert.deepEqual(panelParts('map', ctx()), ['summary', 'intro', 'help']);
  assert.deepEqual(panelParts('map', ctx({ split: true, starter: true })), ['summary', 'split', 'starter', 'intro', 'help']);
  assert.deepEqual(panelParts('record', ctx()), ['issues', 'weekly', 'recent']);
  assert.deepEqual(panelParts('record', ctx({ readOnly: true })), ['issues', 'recent'], '읽기 전용에서는 기록 양식이 없다');
  assert.deepEqual(panelParts('record', ctx({ rewinding: true })), ['issues', 'recent']);
  assert.deepEqual(panelParts('handover', ctx()), ['draft', 'assignee-hint', 'gaps', 'solo', 'docs']);
  assert.deepEqual(panelParts('handover', ctx({ readOnly: true })), ['draft', 'gaps', 'solo', 'docs']);
  assert.deepEqual(panelParts('check', ctx({ grouped: true })), ['risk', 'insight']);
  assert.deepEqual(panelParts('check', ctx({ grouped: false })), ['map-risk', 'group-hint', 'insight'], '묶지 않은 지도: 이 지도의 위험 목록 + 묶기 안내');
  assert.deepEqual(panelParts('edit', ctx()), ['add-open', 'admin', 'rewind', 'hidden']);
  assert.deepEqual(panelParts('edit', ctx({ readOnly: true, grouped: true, folder: true, conflicts: true, stale: true })), ['admin', 'rewind', 'hidden', 'merge', 'folder', 'conflicts', 'stale']);
  assert.deepEqual(panelParts('엉뚱', ctx()), ['summary', 'intro', 'help'], '모르는 공간은 지도 보기');
});

// ── 인수인계·매주 점검 목록(기존 계산 재사용) ──
const person = (id, label) => mkNode(id, 'person', label);
const work = (id, label) => mkNode(id, 'work', label);
test('CR-22 W 담당 공백 업무: 기존 densityGaps의 담당자 빈 일과 같고, 최대 5개 + 전체 수', () => {
  const works = Array.from({ length: 7 }, (_, i) => work(`N-W${i}`, `업무${i}`));
  const nodes = [person('N-P1', '김가상'), ...works];
  const edges = [mkEdge('N-P1', 'N-W0', 'performs')];
  const v = buildView(mkDoc('U-G', nodes, edges, []), () => null);
  const r = gapWorkRows(v, { asOf: ASOF, n: 3 });
  assert.equal(r.status, 'ok');
  assert.equal(r.total, 6);
  assert.equal(r.rows.length, WORKSPACE.LIST_MAX);
  assert.equal(r.rows.length, 5);
  assert.ok(r.rows.every((x) => x.gid && x.label && x.text), JSON.stringify(r.rows[0]));
  assert.equal(r.rows[0].text, '담당 기록 없음');
  // 숫자는 위험 요약(teamRiskSummary)의 gaps와 같다
  assert.equal(r.total, 6);
});

test('CR-22 W 담당 공백: 이전 담당자만 있으면 「이전 담당 …(…까지)」, 담당 기록이 아예 없는 지도는 셀 수 없음(total null)', () => {
  const nodes = [person('N-P1', '김가상'), person('N-P2', '박가상'), work('N-W1', '끝난 담당'), work('N-W2', '맡은 업무')];
  const edges = [mkEdge('N-P1', 'N-W1', 'performs', { period: { start: '2026-01-01', end: '2026-06-30' } }), mkEdge('N-P2', 'N-W2', 'performs')];
  const v = buildView(mkDoc('U-G2', nodes, edges, []), () => null);
  const r = gapWorkRows(v, { asOf: ASOF, n: 3 });
  assert.equal(r.total, 1);
  assert.equal(r.rows[0].label, '끝난 담당');
  assert.equal(r.rows[0].text, '이전 담당 김가상(2026-06-30까지)');
  const none = buildView(mkDoc('U-G3', [work('N-W1', '혼자')], [], []), () => null);
  assert.deepEqual(gapWorkRows(none, { asOf: ASOF, n: 3 }), { status: 'insufficient', total: null, rows: [] });
  assert.deepEqual(denseRows(none, { asOf: ASOF, n: 3 }), { status: 'insufficient', total: null, rows: [] });
  assert.deepEqual(soloRows(none, { asOf: ASOF }), { status: 'insufficient', total: null, rows: [] });
});

test('CR-22 W 혼자만 아는 일·일 몰린 사람: 인사이트 탭과 같은 순서·개수, 상위 5', () => {
  const v = viewOf('U-D1');
  const s = soloRows(v, { asOf: ASOF });
  assert.ok(s.total > 0, '샘플에 혼자만 아는 일이 있다');
  assert.ok(s.rows.length <= 5 && s.rows.length === Math.min(5, s.total));
  assert.ok(s.rows.every((r) => r.work_gid && r.person_gid && ['high', 'caution'].includes(r.level) && r.text));
  const levels = s.rows.map((r) => r.level);
  assert.deepEqual([...levels].sort((a, b) => (a === 'high' ? -1 : 1) - (b === 'high' ? -1 : 1)), levels, '높음이 먼저');
  const d = denseRows(v, { asOf: ASOF, n: 2 });
  assert.ok(d.rows.length <= 5);
  for (const r of d.rows) assert.ok(r.count >= 2);
});

test('CR-22 W 최근 확정한 인수인계서: 산출물 「인수인계서」만, 확정 시각이 늦은 순, 최대 3개, 숨긴 것 제외', () => {
  const doc = (id, label, stamp, extra = {}) => mkNode(id, 'artifact', label, { subtype: '인수인계서', attrs: stamp ? { '확정 시각': stamp } : {}, ...extra });
  const nodes = [
    doc('N-D1', '2026-09-01 가 인수인계서', '2026-09-01T09:00:00+09:00'),
    doc('N-D2', '2026-10-01 나 인수인계서', '2026-10-01T09:00:00+09:00'),
    doc('N-D3', '2026-09-20 다 인수인계서', '2026-09-20T09:00:00+09:00'),
    doc('N-D4', '2026-08-01 라 인수인계서', '2026-08-01T09:00:00+09:00'),
    doc('N-D5', '2026-10-02 숨김 인수인계서', '2026-10-02T09:00:00+09:00', { hidden: true }),
    mkNode('N-A1', 'artifact', '일반 보고서', { subtype: '보고서' }),
  ];
  const rows = recentHandoverDocs(buildView(mkDoc('U-H', nodes, [], []), () => null));
  assert.equal(WORKSPACE.DOCS_MAX, 3);
  assert.deepEqual(rows.map((r) => r.gid), ['U-H/N-D2', 'U-H/N-D3', 'U-H/N-D1']);
  assert.equal(rows[0].date, '2026-10-01');
  assert.deepEqual(recentHandoverDocs(viewOf('U-A1'), 3).length <= 3, true);
  assert.deepEqual(recentHandoverDocs(buildView(mkDoc('U-H2', [], [], []), () => null)), []);
});

// ── 화면 조각 ──
test('CR-22 W 메뉴: 단추 5개(ws-*), 눌림 표시는 현재 공간 하나, 배지는 기록·매주 점검에만, 누르면 onPick(키)', withDom((body) => {
  const nav = document.createElement('nav');
  body.append(nav);
  const picked = [];
  renderWorkspaceNav(nav, { current: 'record', badges: { record: 4, check: null }, onPick: (k) => picked.push(k) });
  assert.equal(nav.children.length, 5);
  const pressed = nav.children.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.getAttribute('data-testid'));
  assert.deepEqual(pressed, ['ws-record']);
  assert.equal(q(nav, 'ws-badge-record').textContent, '4');
  assert.equal(q(nav, 'ws-badge-check'), null);
  assert.equal(q(nav, 'ws-record').textContent, '기록4');
  q(nav, 'ws-check').click();
  q(nav, 'ws-edit').click();
  assert.deepEqual(picked, ['check', 'edit']);
  // 다시 그리면 눌림이 바뀐다
  renderWorkspaceNav(nav, { current: 'edit', badges: null, onPick() {} });
  assert.deepEqual(nav.children.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.getAttribute('data-testid')), ['ws-edit']);
  assert.equal(nav.children.length, 5);
}));

test('CR-22 W 목록 상자: 담당 공백·혼자만 아는 일·일 몰린 사람·최근 인수인계서 — 제목에 개수, 없음/셀 수 없음 문구, 줄의 이름을 누르면 onSelect(gid)', withDom((body) => {
  const got = [];
  const sel = (g) => got.push(g);
  const gaps = gapBox({ status: 'ok', total: 7, rows: [{ gid: 'U/N-1', label: '업무1', text: '담당 기록 없음' }] }, sel);
  body.append(gaps);
  assert.equal(gaps.getAttribute('data-testid'), 'ws-gaps');
  assert.match(gaps.textContent, /담당 공백 업무 7개/);
  assert.match(gaps.textContent, /외 6개/);
  q(gaps, 'ws-gap-pick').click();
  assert.deepEqual(got, ['U/N-1']);
  assert.match(gapBox({ status: 'none', total: 0, rows: [] }, sel).textContent, /담당 공백 업무 — 없음/);
  assert.match(gapBox({ status: 'insufficient', total: null, rows: [] }, sel).textContent, /셀 수 없음/);
  const solo = soloBox({ status: 'ok', total: 1, rows: [{ work_gid: 'U/N-2', work: '대사', person_gid: 'U/N-3', person: '김가상', level: 'high', text: '인수인계 기록 없음' }] }, sel);
  assert.match(solo.textContent, /혼자만 아는 일 1개/);
  assert.match(solo.textContent, /김가상만 해 봄/);
  q(solo, 'ws-solo-pick').click();
  assert.equal(got[1], 'U/N-2');
  const dense = denseBox({ status: 'ok', total: 1, rows: [{ gid: 'U/N-3', label: '김가상', count: 4 }] }, sel);
  assert.match(dense.textContent, /일 몰린 사람 1명/);
  assert.match(dense.textContent, /지금 맡은 업무 4개/);
  const docs = docsBox([{ gid: 'U/N-9', label: '2026-10-01 대사 인수인계서', date: '2026-10-01' }], sel);
  q(docs, 'ws-doc-pick').click();
  assert.equal(got[2], 'U/N-9');
  assert.ok(q(docsBox([], sel), 'ws-docs-empty'));
}));

// ── 처음 할 일 ──
test('CR-22 W 처음 할 일: 지금 화면 이름으로 쓰고 줄에 갈 공간이 붙는다(기록 → 지도 관리), 「이력 추가」는 없다', () => {
  const ctx0 = { now: '2026-10-17T10:00:00+09:00' };
  const d = applyStarter(createUniverse({ name: '시험', level: '업무', owner: '가상팀' }, ctx0).doc, { work: '월말 점검', person: '김가상', artifact: '점검표' }, ctx0).doc;
  const steps = starterSteps(d, buildView(d, () => null)).steps;
  const by = Object.fromEntries(steps.map((s) => [s.key, s]));
  assert.equal(by.memo.space, 'record');
  assert.ok(by.memo.label.includes('「기록」') && by.memo.label.includes('「월말 점검」'));
  assert.ok(!steps.some((s) => s.label.includes('이력 추가')));
  assert.equal(by.form.space, undefined, '권장 항목 채우기는 글자만');
  assert.equal(by.more.space, 'edit');
  assert.ok(by.more.label.includes('업무 더 넣기') && by.more.label.includes('「지도 관리」'));
  for (const s of steps) if (s.space) assert.ok(isWorkspace(s.space), s.key);
});

// ── 따라 하기: 단계 ↔ 공간 표 ──
test('CR-22 W 따라 하기 단계-공간 표: 인수인계(지도 보기 ×2, 인수인계 ×2, 지도 관리), 팀(매주 점검 ×3, 지도 보기 ×2)', () => {
  const spacesOf = (sc) => sc.steps.map((st) => st.space);
  assert.deepEqual(spacesOf(scenarioOf('handover')), ['map', 'map', 'handover', 'handover', 'edit']);
  assert.equal(TEAM_ORDER, 'weekly');
  assert.deepEqual(scenarioOf('team').steps.map((st) => st.id), ['risk', 'save', 'summary', 'expand', 'find']);
  assert.deepEqual(spacesOf(scenarioOf('team')), ['check', 'check', 'check', 'map', 'map']);
  assert.equal(scenarioOf('team').steps.length, 5);
  assert.equal(scenarioOf('handover').steps.length, 5);
  // 모든 판의 모든 단계가 알려진 공간을 갖는다
  for (const order of ['weekly', 'risk-first', 'd29']) for (const st of teamScenario(order).steps) assert.ok(isWorkspace(st.space), `${order}/${st.id}`);
});

test('CR-22 W 팀 따라 하기 새 단계: 「이번 점검 저장」은 저장했거나 저장할 수 없는 화면이면 끝, 「점검 요약 보기」는 눌렀을 때 끝', () => {
  const [, save, summary] = scenarioOf('team').steps;
  const s = emptyState('U-D1');
  assert.equal(save.done(s), false);
  assert.equal(save.done({ ...s, baselineSaved: true }), true);
  assert.equal(save.done({ ...s, canSaveBaseline: false }), true, '저장할 수 없으면 이 단계에서 막히지 않는다');
  assert.deepEqual(save.target(s), [{ sel: '[data-testid=btn-risk-baseline-save]' }]);
  assert.deepEqual(save.target({ ...s, insightOpen: true }), [{ sel: '[data-testid=insight-close]' }], '인사이트가 열려 있으면 먼저 「닫기」를 짚는다');
  assert.match(save.task, /「이번 점검 저장」/);
  assert.equal(summary.done(s), false);
  assert.equal(summary.done({ ...s, summaryUsed: true, insightOpen: true }), false, '요약을 열어 둔 채로는 끝이 아니다(다 보고 「닫기」)');
  assert.equal(summary.done({ ...s, summaryUsed: true }), true);
  assert.deepEqual(summary.target(s), [{ sel: '[data-testid=btn-risk-summary-open]' }]);
  assert.deepEqual(summary.target({ ...s, insightOpen: true }), [{ sel: '[data-testid=insight-close]' }]);
  assert.match(summary.task, /「점검 요약 보기」/);
});

test('CR-22 W 끝 카드 권유: 인수인계는 공간 안내, 팀은 매주 점검(도구가 접혀 있을 때만 「도구 더 보기」 덧붙임)', () => {
  assert.match(endHint('handover', true), /「인수인계」 공간/);
  assert.ok(!endHint('handover', true).includes('도구 더 보기'), '인수인계 따라 하기에는 도구 권유가 맞지 않는다');
  assert.match(endHint('team', true), /「도구 더 보기」/);
  assert.ok(!endHint('team', false).includes('도구 더 보기'));
  assert.match(endHint('team', false), /「매주 점검」 공간/);
  assert.equal(endHint('모르는', true), '');
});

// ── 기능 찾기: 공간 ──
test('CR-22 W 기능 찾기: 공간이 있는 기능은 결과에 space가 실리고(그 공간으로 바꾼 뒤 이동), 화면 요소(시간 보기·항목 찾기)는 공간 없음', () => {
  const by = (id) => FEATURES.find((f) => f.id === id);
  const expected = { weekly: 'record', issues: 'record', recent: 'record', event: 'record', draft: 'handover', assignee: 'handover', transfer: 'handover', collab: 'handover',
    edit: 'edit', add: 'edit', group: 'edit', create: 'edit', 'json-export': 'edit', rewind: 'edit', hidden: 'edit', merge: 'edit',
    insight: 'check', density: 'check', 'weekly-check': 'check', summary: 'check' };
  for (const [id, sp] of Object.entries(expected)) assert.equal(by(id).space, sp, id);
  for (const id of ['time', 'find', 'tools', 'settings', 'tour']) assert.equal(by(id).space, undefined, id);
  for (const f of FEATURES) if (f.space) assert.ok(isWorkspace(f.space), f.id);
  assert.equal(searchFeatures('미해결')[0].space, 'record');
  assert.equal(searchFeatures('인사이트')[0].space, 'check');
  assert.equal(searchFeatures('담당 바꾸기')[0].space, 'handover');
  assert.equal(searchFeatures('되감기')[0].space, 'edit');
  // 위치 안내 글은 공간 이름을 쓴다(옛 「개요 → …묶음」은 없다)
  for (const f of FEATURES) assert.ok(!/묶음/.test(f.where), `${f.id}: ${f.where}`);
});

// ── 설정에 기억 ──
test('CR-22 W 고른 공간은 이 브라우저 설정에 기억: 저장·읽기 왕복, 모르는 값은 버림', () => {
  const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
  const st = mem();
  const d = { provider: 'pregen' };
  const s1 = loadSettings(st, d);
  assert.equal(s1.workspace, undefined);
  s1.workspace = 'check';
  assert.equal(saveSettings(st, s1), true);
  assert.equal(loadSettings(st, d).workspace, 'check');
  s1.workspace = 'map';
  saveSettings(st, s1);
  assert.equal(loadSettings(st, d).workspace, 'map');
  // 깨진 값
  const st2 = mem();
  st2.setItem('wu:v1:settings', JSON.stringify({ provider: 'pregen', workspace: '엉뚱' }));
  assert.equal(loadSettings(st2, d).workspace, undefined);
  assert.equal(cleanWorkspace(loadSettings(st2, d).workspace), 'map');
  // allSamples는 건드리지 않는다(읽기만)
  assert.ok(allSamples()['U-A1']);
});
