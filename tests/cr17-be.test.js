// CR-17 B(유사 경험자 → 대신할 수 있는 사람) · E(초안 「받는 범위와 담당 공백」)의 화면·설명·문장 점검.
// 규칙 자체의 시험은 tests/insight.test.js(B)·tests/handover.test.js(E). 여기서는 화면(DOM 흉내)과 설명 요청, 초안 항목 표를 본다.
// 실제 브라우저 점검(tools/browser-check.mjs)을 대신하지 않는다. 가상 데이터만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewOf } from './helpers.js';
import { installDom, uninstallDom } from './dom-stub.js';
import { insightPanel } from '../app/src/ui/insight.js';
import { FILL_HINTS } from '../app/src/ui/draft-hints.js';
import { HANDOVER_ITEMS } from '../app/src/rules/handover.js';
import { similarExperts } from '../app/src/rules/insight.js';
import { similarExplain } from '../app/src/rules/explain.js';

const ASOF = '2026-10-02';
const withDom = (fn) => () => {
  const body = installDom();
  try { fn(body); } finally { uninstallDom(); }
};
const similarPanel = (work) => insightPanel({ view: viewOf('U-D1'), provider: null, kind: 'similar', work, asOf: ASOF, today: ASOF, onFocus() {}, onClose() {} });
const q = (panel, id) => panel.querySelector(`[data-testid=${id}]`);

test('B 화면: 「대사 확인」은 직접 해 본 사람 묶음(윤바다·한가람) → 사람 미확인(역할 이름) 묶음 순서이고, 비슷한 일만 한 사람 묶음은 없다', withDom((body) => {
  const panel = similarPanel('U-A1/N-001');
  body.append(panel);
  const direct = q(panel, 'insight-direct');
  const roles = q(panel, 'insight-roles');
  assert.ok(direct && roles);
  assert.equal(q(panel, 'insight-people'), null, '직접 해 본 사람이 이미 비슷한 일도 보여 주므로 두 번 그리지 않는다');
  assert.match(direct.textContent, /윤바다/);
  assert.match(direct.textContent, /이 업무를 직접 해 봄\(2026-06-01 ~ 2026-09-30\)/);
  assert.match(direct.textContent, /이 업무를 직접 해 봄\(2025-03-01 ~ 2026-05-31\)/);
  assert.ok(direct.textContent.indexOf('윤바다') < direct.textContent.indexOf('한가람'), '최근에 끝난 순');
  assert.match(direct.textContent, /2025 행사/); // 윤바다 카드에 비슷한 일도 함께
  assert.equal(direct.querySelectorAll('[data-testid=direct-chip]').length, 2);
  assert.equal(direct.querySelectorAll('[data-testid=role-chip]').length, 0);
  assert.equal(roles.querySelectorAll('[data-testid=role-chip]').length, 2);
  assert.match(roles.textContent, /운영 담당/);
  assert.match(roles.textContent, /정산 담당/);
  // 묶음 순서: 직접 해 본 사람 위, 역할 이름 아래
  const res = q(panel, 'insight-result');
  const groups = res.children.filter((c) => c.tagName === 'SECTION').map((g) => g.getAttribute('data-testid'));
  assert.deepEqual(groups, ['insight-direct-group', 'insight-roles-group']);
  assert.match(q(panel, 'insight-excluded').textContent, /서하늘/);
}));

test('B 화면: 이름 낱말만 같은 후보는 「이름만 같음」 표시와 「같은 일인지 확인」 이유, 비슷한 일 묶음에 있다', withDom((body) => {
  const panel = similarPanel('U-B/N-102');
  body.append(panel);
  const people = q(panel, 'insight-people');
  assert.ok(people);
  assert.equal(q(panel, 'insight-direct'), null);
  assert.match(people.textContent, /윤바다/);
  assert.match(people.textContent, /1점/);
  assert.match(people.textContent, /이름에 같은 낱말 「행사」 — 같은 일인지 확인/);
  assert.equal(people.querySelectorAll('[data-testid=name-only-chip]').length, 1);
}));

test('B 화면: 연결도 이름 낱말도 이전 담당도 없는 업무는 데이터 부족만 보인다', withDom((body) => {
  const panel = similarPanel('U-B/N-104');
  body.append(panel);
  assert.match(q(panel, 'insight-insufficient').textContent, /데이터 부족/);
  for (const id of ['insight-direct', 'insight-people', 'insight-roles']) assert.equal(q(panel, id), null, id);
}));

test('B 설명 요청: 직접 해 본 사람 → 비슷한 일 → 역할 이름 순서의 규칙 문장이고, 문장마다 근거가 있으며 첫 근거 글이 인용 가능한 길이다', () => {
  const v = viewOf('U-D1');
  const req = similarExplain(similarExperts(v, { works: ['U-A1/N-001'], asOf: ASOF }), 'U-A1/N-001');
  assert.equal(req.target, 'similar|U-A1/N-001');
  assert.deepEqual(req.rule.map((s) => s.text.split(' ')[0]), ['이', '비슷한', '사람']);
  assert.match(req.rule[0].text, /^이 업무를 직접 해 본 사람은 2명입니다: 윤바다\(2026-06-01 ~ 2026-09-30\), 한가람\(2025-03-01 ~ 2026-05-31\)\.$/);
  assert.match(req.rule[1].text, /^비슷한 업무를 해 본 사람은 1명입니다\. 점수가 높은 순서로 윤바다\(3점\)입니다\.$/);
  assert.match(req.rule[2].text, /^사람 이름이 아니라 역할 이름만 있는 항목이 2개 있습니다: 운영 담당, 정산 담당\./); // CR-18-2
  for (const s of req.rule) {
    assert.ok(s.evidence_ids.length > 0);
    for (const g of s.evidence_ids) assert.ok(v.lookup(g).found, g);
  }
  assert.deepEqual(req.evidence_ids, [...new Set(req.rule.flatMap((s) => s.evidence_ids))].sort());
  // 결과가 없으면 설명하지 않는다
  assert.equal(similarExplain(similarExperts(viewOf('U-B'), { works: ['U-B/N-104'], asOf: ASOF }), 'U-B/N-104'), null);
});

test('E 항목 표: 「받는 범위와 담당 공백」은 「업무 개요」 다음의 두 번째 항목이고 「채우려면」 안내가 있다', () => {
  assert.deepEqual(HANDOVER_ITEMS.slice(0, 3).map((i) => i.key), ['업무_개요', '받는_범위', '세부_업무_절차']);
  assert.equal(HANDOVER_ITEMS.find((i) => i.key === '받는_범위').title, '받는 범위와 담당 공백');
  assert.equal(HANDOVER_ITEMS.length, 11);
  assert.match(FILL_HINTS.받는_범위, /수행/);
});

// 재검증 R14-3: 이름 낱말만 같은 후보에서 숫자·날짜 꼴 낱말(「2025」「1월」)은 세지 않는다
test('R14-3: 「2025 결산」과 「2025 행사」처럼 숫자 낱말만 같으면 유사 경험자 후보가 아니다, 「연말 정산」↔「월말 정산」은 「정산」으로 후보', async () => {
  const { mkNode, mkEdge, mkDoc } = await import('./helpers.js');
  const { buildView } = await import('../app/src/view/view.js');
  const doc = mkDoc('U-X', [
    mkNode('N-000', 'root', '가상 시험'),
    mkNode('N-001', 'work', '2025 결산'), mkNode('N-002', 'work', '2025 행사'), mkNode('N-003', 'work', '연말 정산'), mkNode('N-004', 'work', '월말 정산'),
    mkNode('N-011', 'person', '가상갑'), mkNode('N-012', 'person', '가상을'),
  ], [
    mkEdge('N-011', 'N-002', 'performs', { period: { start: '2025-01-01', end: '2025-12-31' } }),
    mkEdge('N-012', 'N-004', 'performs', { period: { start: '2025-01-01', end: '2025-12-31' } }),
  ]);
  const v = buildView(doc, () => null);
  const a = similarExperts(v, { works: ['U-X/N-001'], asOf: '2026-10-24' });
  assert.ok(!a.people.some((p) => p.label === '가상갑'), JSON.stringify(a.people.map((p) => p.label)));
  const b = similarExperts(v, { works: ['U-X/N-003'], asOf: '2026-10-24' });
  assert.ok(b.people.some((p) => p.label === '가상을' && p.works.some((w) => w.name_only)), JSON.stringify(b.people));
});
