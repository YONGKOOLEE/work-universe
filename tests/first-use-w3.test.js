// 처음 사용 점검(2026-10-24) W3: FU-15 속성 수정 이력 글, FU-10 묶은 지도 위험 요약, FU-12 사람 상세의 「이 사람만 아는 일」.
// 요약 숫자는 인사이트 탭이 쓰는 계산(knowledgeConcentration·densityGaps)과 같아야 한다 — 같은 기준일·같은 밀집 기준.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allSamples, viewOf, mkNode as n, mkEdge as e, mkDoc } from './helpers.js';
import { buildView } from '../app/src/view/view.js';
import { ATTR_VALUE_MAX, attrsChangeText, eventText } from '../app/src/view/describe.js';
import { SOLO_SHOW, soloWorksOf, soloWorksText, teamRiskParts, teamRiskSummary } from '../app/src/view/risk-summary.js';
import { knowledgeConcentration } from '../app/src/rules/insight-risk.js';
import { DENSE_DEFAULT_N, densityGaps } from '../app/src/rules/insight.js';
import { updateNode } from '../app/src/model/commands.js';

const ASOF = '2026-10-02';

// ── FU-15 속성 수정 이력 ──
test('FU-15 attrsChangeText: 새 속성은 「키: 값」, 바뀐 값은 「키: 이전 → 새」, 지운 속성은 「키: 지움(이전)」, 같은 값은 뺀다', () => {
  assert.equal(attrsChangeText(undefined, { 주기: '매월', 마감: '매월 말' }), '주기: 매월 · 마감: 매월 말');
  assert.equal(attrsChangeText({ 주기: '분기', 마감: '5일' }, { 주기: '매월', 마감: '5일' }), '주기: 분기 → 매월');
  assert.equal(attrsChangeText({ 주기: '매월', 마감: '5일' }, { 주기: '매월' }), '마감: 지움(5일)');
  assert.equal(attrsChangeText({ 주기: '매월' }, { 주기: '매월' }), '');
  assert.equal(attrsChangeText({ 주기: 3 }, { 주기: '3' }), '', '숫자와 같은 글자는 바뀐 값이 아니다');
});

test('FU-15 attrsChangeText: 긴 값은 줄이고 줄바꿈은 공백으로, 깨진 입력(배열·글자)은 null', () => {
  const long = 'ㄱ'.repeat(ATTR_VALUE_MAX + 30);
  const t = attrsChangeText({}, { 절차: long });
  assert.equal(t, `절차: ${'ㄱ'.repeat(ATTR_VALUE_MAX)}…`);
  assert.equal(attrsChangeText({}, { 절차: '① 열기\n② 닫기' }), '절차: ① 열기 ② 닫기');
  assert.equal(attrsChangeText([], { a: 1 }), null);
  assert.equal(attrsChangeText({}, '글자'), null);
});

test('FU-15 eventText: 노드 수정 이력의 속성 변경에 원문 JSON({ " :)이 보이지 않고 바뀐 값만 보인다', () => {
  const T = { now: '2026-10-01T10:00:00+09:00' };
  const base = allSamples()['U-A1'];
  const w = base.nodes.find((x) => x.core_type === 'work');
  const r = updateNode(base, w.id, { attrs: { ...(w.attrs || {}), 주기: '매월(변경)', 마감: '매월 말' } }, T);
  const v = buildView(r.doc);
  const last = v.events.find((x) => x.id === r.event.id);
  const text = eventText(v, last);
  assert.match(text, /^수정 — 속성: /);
  assert.ok(!text.includes('{') && !text.includes('"'), text);
  assert.ok(text.includes('주기: 매월 → 매월(변경)') && text.includes('마감: 월 마감 후 3영업일 이내 → 매월 말'), text);
});

test('FU-15 eventText: 샘플 월말 정산 대사 확인의 속성 수정 이력(E-021)은 바뀐 마감 값만 읽기 쉽게', () => {
  const v = viewOf('U-A1');
  const ev = v.events.find((x) => x.id === 'E-021');
  assert.equal(eventText(v, ev), '수정 — 속성: 마감: 월 마감 후 5영업일 이내 → 월 마감 후 3영업일 이내');
});

test('FU-15 eventText: 속성 말고 다른 칸 수정 문장은 예전 그대로', () => {
  const T = { now: '2026-10-01T10:00:00+09:00' };
  const base = allSamples()['U-A1'];
  const w = base.nodes.find((x) => x.core_type === 'work');
  const r = updateNode(base, w.id, { label: `${w.label}(수정)` }, T);
  const v = buildView(r.doc);
  const last = v.events.find((x) => x.id === r.event.id);
  assert.equal(eventText(v, last), `수정 — 이름: ${w.label} → ${w.label}(수정)`);
});

// ── FU-10 위험 요약 ──
test('FU-10 teamRiskSummary: 가상 운영부(U-D1) 숫자가 인수인계 위험·밀집·공백 계산과 같다', () => {
  const v = viewOf('U-D1');
  assert.ok(v.ref_links.length > 0, 'U-D1은 묶은 지도');
  const s = teamRiskSummary(v, { asOf: ASOF, n: DENSE_DEFAULT_N });
  const c = knowledgeConcentration(v, { asOf: ASOF });
  const d = densityGaps(v, { asOf: ASOF, n: DENSE_DEFAULT_N });
  assert.equal(s.solo, c.items.length);
  assert.equal(s.solo, c.counts.one);
  assert.equal(s.solo_high, c.items.filter((x) => x.level === 'high').length);
  assert.equal(s.dense, d.dense.length);
  assert.equal(s.gaps, d.gaps.length);
  assert.equal(s.insufficient, false);
  assert.ok(s.solo > 0, '가상 운영부에는 혼자만 아는 일이 있다');
});

test('FU-10 teamRiskSummary: 밀집 기준 n이 바뀌면 일 몰린 사람 수도 같은 기준으로 바뀐다', () => {
  const v = viewOf('U-D1');
  const a = teamRiskSummary(v, { asOf: ASOF, n: 1 });
  const b = teamRiskSummary(v, { asOf: ASOF, n: 99 });
  assert.equal(a.dense, densityGaps(v, { asOf: ASOF, n: 1 }).dense.length);
  assert.equal(b.dense, 0);
  assert.ok(a.dense > b.dense);
});

test('FU-10 teamRiskParts: 숫자가 0이면 「없음」, 담당 기록이 없으면 한 문장', () => {
  assert.deepEqual(teamRiskParts({ solo: 8, dense: 2, gaps: 3, insufficient: false }), ['혼자만 아는 일 8개', '일 몰린 사람 2명', '담당자 빈 일 3개']);
  assert.deepEqual(teamRiskParts({ solo: 0, dense: 0, gaps: 0, insufficient: false }), ['혼자만 아는 일 없음', '일 몰린 사람 없음', '담당자 빈 일 없음']);
  assert.deepEqual(teamRiskParts({ solo: null, dense: 1, gaps: 0, insufficient: false }), ['혼자만 아는 일 기록 부족', '일 몰린 사람 1명', '담당자 빈 일 없음']);
  assert.equal(teamRiskParts({ solo: null, dense: null, gaps: null, insufficient: true }).length, 1);
  // 담당(수행) 연결이 하나도 없는 지도: 둘 다 데이터 부족
  const empty = buildView(mkDoc('U-E', [n('W1', 'work', '정산')], []));
  const s = teamRiskSummary(empty, { asOf: ASOF, n: 3 });
  assert.equal(s.insufficient, true);
});

// ── FU-12 사람 상세 ──
test('FU-12 soloWorksOf: 그 사람만 해 본 업무만, 인수인계 위험 탭 목록(높음 먼저)과 같은 순서', () => {
  const v = viewOf('U-D1');
  const c = knowledgeConcentration(v, { asOf: ASOF });
  const owners = [...new Set(c.items.map((x) => x.person.gid))];
  assert.ok(owners.length > 0);
  let total = 0;
  for (const g of owners) {
    const mine = soloWorksOf(v, g, ASOF);
    assert.deepEqual(mine.map((x) => x.gid), c.items.filter((x) => x.person.gid === g).map((x) => x.work.gid));
    total += mine.length;
  }
  assert.equal(total, c.items.length, '모든 항목이 정확히 한 사람의 것');
  // 사람이 아닌 노드·해당 없는 사람은 빈 목록
  assert.deepEqual(soloWorksOf(v, v.nodes.find((x) => x.core_type === 'work').gid, ASOF), []);
});

test('FU-12 soloWorksOf: 둘이 해 본 업무는 어느 쪽 사람 것도 아니다', () => {
  const doc = mkDoc('U-S', [n('W1', 'work', '정산'), n('W2', 'work', '대사'), n('P1', 'person', '가나'), n('P2', 'person', '다라')],
    [e('P1', 'W1', 'performs'), e('P2', 'W1', 'performs'), e('P1', 'W2', 'performs')]);
  const v = buildView(doc);
  assert.deepEqual(soloWorksOf(v, 'U-S/P1', ASOF).map((x) => x.label), ['대사']);
  assert.deepEqual(soloWorksOf(v, 'U-S/P2', ASOF), []);
});

test('FU-12 soloWorksText: 0개면 빈 글, 많으면 앞 5개와 「외 n개」', () => {
  assert.equal(soloWorksText([]), '');
  assert.equal(soloWorksText([{ label: '가' }, { label: '나' }]), '이 사람만 아는 일 2개: 「가」, 「나」');
  const many = Array.from({ length: SOLO_SHOW + 2 }, (_, i) => ({ label: `일${i}` }));
  const t = soloWorksText(many);
  assert.ok(t.startsWith(`이 사람만 아는 일 ${many.length}개: 「일0」`));
  assert.ok(t.endsWith('외 2개'));
  assert.ok(!t.includes(`「일${SOLO_SHOW}」`));
});

// ── 화면(DOM 흉내): 실제 브라우저 점검(tools/browser-check.mjs 「처음 사용 W3」)을 대신하지 않는다 ──
import { installDom, uninstallDom } from './dom-stub.js';
import { renderUniverseSummary } from '../app/src/ui/detail.js';
import { describeUniverse } from '../app/src/view/describe.js';

test('FU-10·13 개요: 위험 요약 한 줄(+ 「자세히」)과 접힌 「사번 확인 필요 n건」, 요약을 안 주면 그리지 않음', () => {
  const body = installDom();
  try {
    const v = viewOf('U-D1');
    const s = describeUniverse(v);
    const panel = document.createElement('div');
    body.append(panel);
    let more = 0;
    renderUniverseSummary(panel, s, 10, { riskSummary: { parts: teamRiskParts(teamRiskSummary(v, { asOf: ASOF, n: 3 })), onMore: () => { more += 1; } } });
    const line = panel.querySelector('[data-testid=team-risk-summary]');
    assert.ok(line);
    assert.match(line.textContent, /혼자만 아는 일 \d+개 · 일 몰린 사람 \d+명 · 담당자 빈 일 \d+개/);
    panel.querySelector('[data-testid=btn-team-risk-more]').fire('click');
    assert.equal(more, 1);
    const fold = panel.querySelector('[data-testid=empno-conflicts]');
    assert.ok(fold, '사번 충돌이 있는 샘플');
    assert.equal(fold.tagName, 'DETAILS');
    assert.equal(panel.querySelector('[data-testid=empno-conflicts-summary]').textContent, `사번 확인 필요 ${s.empno_conflicts.length}건`);
    assert.ok(panel.querySelector('[data-testid=empno-conflict]').textContent.includes('V-1002'));
    // 요약을 주지 않으면(업무 하나짜리 지도) 줄이 없다
    const panel2 = document.createElement('div');
    renderUniverseSummary(panel2, describeUniverse(viewOf('U-A1')), 10, {});
    assert.equal(panel2.querySelector('[data-testid=team-risk-summary]'), null);
    assert.equal(panel2.querySelector('[data-testid=empno-conflicts]'), null);
  } finally {
    uninstallDom();
  }
});
