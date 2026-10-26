// 처음 사용 점검 9회차 Q 묶음(2026-10-27): 매주 점검 분모·팀별(FU9-17·22), 점검 요약 분모 줄, 통합 확인(FU9-19 샘플 답 칩, RV13-1 다시 물어볼 답),
// 점검 요약 아래 단추(FU9-21), 초안 빈 설명(FU9-13), 확정 작성자 안내(FU9-14), 따라 하기 끝 글(FU9-23). 가상 데이터만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allSamples, viewOf } from './helpers.js';
import { installDom, uninstallDom } from './dom-stub.js';
import { SAMPLES } from '../app/data/index.js';
import { groupRowsWithTeams, inspectionInput, teamRiskRows, teamRiskSummary, teamRowText } from '../app/src/view/risk-summary.js';
import { DENSE_DEFAULT_N, densityGaps } from '../app/src/rules/insight.js';
import { inspectionSummaryText } from '../app/src/rules/daily-use.js';
import { NO_DESCRIPTION_NOTE, buildHandoverDraft } from '../app/src/rules/handover.js';
import { NO_AUTHOR_NOTE, draftPanel } from '../app/src/ui/draft.js';
import { SAMPLE_ANSWER_CHIP, mergePanel } from '../app/src/ui/merge.js';
import { mergePlan } from '../app/src/merge/merge.js';
import { summaryBar } from '../app/src/ui/check-summary.js';
import { endHint } from '../app/src/ui/tour.js';

const ASOF = '2026-10-02';
const N = DENSE_DEFAULT_N;

test('FU9-17 teamRiskSummary: 분모 works는 기준일에 진행 중인 업무 수(밀집·공백 표의 조직별 업무 합과 같다)', () => {
  const v = viewOf('U-D1');
  const s = teamRiskSummary(v, { asOf: ASOF, n: N });
  const d = densityGaps(v, { asOf: ASOF, n: N });
  assert.ok(s.works > 0);
  assert.equal(s.works, d.groups.reduce((a, g) => a + g.works, 0));
});

test('FU9-17 teamRiskRows: 팀(바로 아래 하위 지도)별 숫자의 합이 전체 숫자와 같다(업무·혼자만·빈 일) — 새 판정 없이 나눠 센 것', () => {
  const v = viewOf('U-D1');
  const s = teamRiskSummary(v, { asOf: ASOF, n: N });
  const rows = teamRiskRows(v, { asOf: ASOF, n: N });
  assert.ok(rows.length >= 2, '묶은 지도는 팀이 둘 이상');
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  assert.equal(sum('works'), s.works);
  assert.equal(sum('solo'), s.solo);
  assert.equal(sum('gaps'), s.gaps);
  assert.ok(rows.every((r) => /업무 \d+개 중 혼자만 \d+개 · 일 몰린 \d+명 · 빈 일 \d+개/.test(teamRowText(r))));
  // 일 몰린 사람은 여러 팀에 걸칠 수 있어 합이 전체 이상(같은 사람은 팀 안에서 한 번)
  assert.ok(sum('dense') >= s.dense);
});

test('FU9-17 teamRiskRows: 묶지 않은 지도(팀 하나)는 빈 배열, 못 세는 칸은 null → 「?」', () => {
  assert.deepEqual(teamRiskRows(viewOf('U-A1'), { asOf: ASOF, n: N }), []);
  assert.equal(teamRowText({ name: '가팀', works: 3, solo: null, dense: 0, gaps: null }), '가팀 — 업무 3개 중 혼자만 ?개 · 일 몰린 0명 · 빈 일 ?개');
});

test('FU9-22 groupRowsWithTeams: 한 팀 안에 지도가 둘 이상이면 팀 합계 줄이 그 팀 지도들 위에 끼고, 합계는 지도들의 합', () => {
  const v = viewOf('U-D1');
  const d = densityGaps(v, { asOf: ASOF, n: N });
  const rows = groupRowsWithTeams(v, d.groups, d.dense);
  const teams = rows.filter((r) => r.kind === 'team');
  assert.ok(teams.length >= 1, '정산팀처럼 하위 지도가 둘 이상인 팀');
  assert.equal(rows.filter((r) => r.kind === 'map').length, d.groups.length, '지도 줄은 그대로');
  for (const t of teams) {
    const i = rows.indexOf(t);
    assert.equal(rows[i + 1].kind, 'map', '합계 줄 바로 아래가 그 팀의 지도');
  }
  const works = rows.filter((r) => r.kind === 'map').reduce((a, r) => a + r.works, 0);
  assert.equal(works, d.groups.reduce((a, g) => a + g.works, 0));
  // 지도 하나가 곧 팀인 경우(합계 줄 없음)와 한 지도뿐인 지도
  const one = viewOf('U-A1');
  const d1 = densityGaps(one, { asOf: ASOF, n: N });
  assert.equal(groupRowsWithTeams(one, d1.groups, d1.dense).filter((r) => r.kind === 'team').length, 0);
});

test('FU9-17 점검 요약 글: 기준일 아래에 「센 범위: 기준일에 진행 중인 업무 n개 중」, 업무 수를 모르면 줄 없음', () => {
  const v = viewOf('U-D1');
  const d = inspectionInput(v, { asOf: ASOF, n: N, mapName: '가상 운영부' });
  const text = inspectionSummaryText(d, null);
  assert.ok(d.works > 0);
  assert.ok(text.includes(`센 범위: 기준일에 진행 중인 업무 ${d.works}개 중`));
  const lines = text.split('\n');
  assert.equal(lines[1], `기준일: ${ASOF}`);
  assert.ok(lines[2].startsWith('센 범위:'));
  const none = inspectionSummaryText({ ...d, works: undefined }, null);
  assert.ok(!none.includes('센 범위'));
});

test('FU9-21 점검 요약 줄: 미리 보기 안(펼치면 보이는 곳)에도 복사·내려받기·인쇄 단추가 있고 위 단추를 그대로 누른다', () => {
  const body = installDom();
  try {
    let built = 0;
    const bar = summaryBar({ build: () => { built += 1; return '요약 글'; }, mapName: '가상 운영부', asOf: ASOF });
    body.append(bar);
    const below = bar.querySelector('[data-testid=summary-below-buttons]');
    assert.ok(below);
    assert.deepEqual([...below.querySelectorAll('button')].map((b) => b.textContent), ['복사', '내려받기(.txt)', '인쇄']);
    assert.ok(bar.querySelector('[data-testid=summary-preview]').querySelector('[data-testid=summary-below-buttons]'), '미리 보기(details) 안에 있다');
    assert.equal(bar.querySelector('[data-testid=summary-copy]').textContent, '복사', '위 단추도 그대로');
  } finally {
    uninstallDom();
  }
});

test('FU9-13 초안 「세부 업무·절차」: 설명·절차·사용 시스템이 모두 비어 이름만 나열되는 업무에는 「(설명 없음 — …)」이 붙고, 있는 업무는 그대로', () => {
  const view = viewOf('U-A1');
  const works = view.nodes.filter((n) => n.core_type === 'work' && !n.hidden);
  const bare = works.find((w) => !w.description && !(w.attrs && (w.attrs.절차 || w.attrs['사용 시스템'])));
  const r = buildHandoverDraft(view, { target: 'U-A1/N-000', from: 'U-A1/N-011', to: 'U-A1/N-012', asOf: ASOF });
  const lines = r.draft.items.find((i) => i.key === '세부_업무_절차').sentences;
  assert.ok(lines.length > 0);
  const byGid = new Map(works.map((w) => [w.gid, w]));
  for (const s of lines) {
    if (s.text.startsWith('진행 순서')) continue;
    const w = byGid.get(s.evidence_ids[0]);
    const empty = !w.description && !(w.attrs && (w.attrs.절차 || w.attrs['사용 시스템']));
    assert.equal(s.text.endsWith(NO_DESCRIPTION_NOTE), empty, s.text);
  }
  if (bare) assert.ok(lines.some((s) => s.text.startsWith(bare.label) && s.text.endsWith(NO_DESCRIPTION_NOTE)), '이름만 있는 업무');
  assert.equal(NO_DESCRIPTION_NOTE, ' — (설명 없음 — 카드 「⋯ → 수정」에서 채우기)');
  // 근거(evidence_ids)는 그대로 업무 하나
  assert.ok(lines.every((s) => Array.isArray(s.evidence_ids) && s.evidence_ids.length >= 1));
});

test('FU9-14 확정 확인: 작성자 이름이 비었을 때만(authorName === \'\') 확정 확인 줄에 안내가 붙고, 이름이 있거나 값을 안 주면 없음', () => {
  const make = (over) => {
    const body = installDom();
    const panel = draftPanel({ view: viewOf('U-A1'), provider: null, asOf: ASOF, onFocus() {}, onClose() {}, onConfirm: () => ({ ok: true }), ...over });
    body.append(panel);
    const q = (id) => panel.querySelector(`[data-testid=${id}]`);
    q('draft-target').value = 'U-A1/N-000';
    q('draft-from').value = 'U-A1/N-011';
    q('draft-to').value = 'U-A1/N-012';
    q('draft-form').fire('submit');
    return q;
  };
  try {
    const q1 = make({ authorName: '' });
    assert.equal(q1('confirm-no-author').textContent, NO_AUTHOR_NOTE);
    assert.equal(NO_AUTHOR_NOTE, '작성자 이름이 비어 있어 「사용자(이 브라우저)」로 남습니다 — 「설정」에서 넣을 수 있어요');
    assert.ok(q1('confirm-bar').querySelector('[data-testid=confirm-no-author]'), '확정 확인 줄 안');
    uninstallDom();
    const q2 = make({ authorName: '가상 담당' });
    assert.equal(q2('confirm-no-author'), null);
    uninstallDom();
    const q3 = make({});
    assert.equal(q3('confirm-no-author'), null);
    uninstallDom();
    const q4 = make({ authorName: '', readOnly: true });
    assert.equal(q4('confirm-no-author'), null, '읽기 전용에서는 확정할 수 없으니 안내도 없다');
  } finally {
    uninstallDom();
  }
});

test('FU9-23 따라 하기 끝 안내에는 「흐름 정렬·거르기」 낱말이 없다', () => {
  assert.ok(!endHint('team', true).includes('흐름 정렬'));
  assert.ok(endHint('team', true).includes('도구 더 보기'));
});

// ── 통합 확인 ──
function mergeBase(over = {}) {
  const docs = allSamples();
  const view = viewOf('U-D1');
  const links = over.links || docs['U-D1'].identity_links;
  const plan = mergePlan(view, links);
  const isSampleAnswer = (l) => SAMPLES.some((s) => (s.identity_links || []).some((x) => x.id === l.id && x.a === l.a && x.b === l.b && x.status === l.status && x.method === l.method && (x.decided_by || '') === (l.decided_by || '') && (x.decided_at || '') === (l.decided_at || '')));
  return { view, plan, links, provider: null, readOnly: false, asOf: ASOF, isSampleAnswer, onDecide() {}, onApplyAuto() {}, onFocus() {}, onClose() {}, onReask() {}, ...over };
}

test('FU9-19 통합 확인 「지금까지 고른 답」: 샘플에 처음부터 들어 있던 답에만 「샘플에 미리 넣은 답」 칩, 사람이 새로 고른 답(고른 사람·시각이 다름)에는 없음', () => {
  const body = installDom();
  try {
    const docs = allSamples();
    const sampleLinks = docs['U-D1'].identity_links;
    const mine = { id: 'I-777', a: 'U-A1/N-001', b: 'U-K1/N-104', kind: 'work', method: 'human', status: 'rejected', reason: '시험', decided_by: '가상 담당', decided_at: '2026-10-27T10:00:00+09:00' };
    const root = mergePanel(mergeBase({ links: [...sampleLinks, mine] }));
    body.append(root);
    const rows = root.querySelectorAll('[data-testid=merge-decided] li');
    assert.equal(rows.length, sampleLinks.filter((l) => l.status !== 'pending').length + 1);
    const chipped = [...rows].filter((li) => li.querySelector('[data-testid=merge-sample-answer]'));
    assert.equal(chipped.length, rows.length - 1);
    assert.equal(chipped[0].querySelector('[data-testid=merge-sample-answer]').textContent, SAMPLE_ANSWER_CHIP);
    assert.equal(SAMPLE_ANSWER_CHIP, '샘플에 미리 넣은 답');
    // 같은 id·쌍이라도 답이나 고른 사람이 바뀌었으면(다시 묻고 새로 고름) 샘플 답이 아니다
    const s0 = sampleLinks.find((l) => l.method === 'human' && l.status === 'rejected');
    const changed = { ...s0, status: 'confirmed', decided_by: '가상 담당', decided_at: '2026-10-27T11:00:00+09:00' };
    const root2 = mergePanel(mergeBase({ links: sampleLinks.map((l) => (l.id === s0.id ? changed : l)) }));
    body.replaceChildren(root2);
    assert.equal(root2.querySelectorAll('[data-testid=merge-sample-answer]').length, sampleLinks.filter((l) => l.status !== 'pending').length - 1);
  } finally {
    uninstallDom();
  }
});

test('RV13-1 통합 확인: 후보 목록에 오르지 않는 「다시 묻기」(pending) 쌍은 「다시 물어볼 답 n건」 묶음으로 「지금까지 고른 답」 위에 질문 줄과 함께 보이고, 후보에 오르는 쌍은 중복해서 넣지 않는다', () => {
  const body = installDom();
  try {
    const docs = allSamples();
    const v = viewOf('U-D1');
    const works = v.nodes.filter((n) => n.core_type === 'work' && !n.hidden);
    const by = {};
    for (const n of works) (by[n.universe_id] ||= []).push(n.gid);
    const k = Object.keys(by).find((x) => by[x].length > 1);
    const [a, b] = by[k];
    const pend = { id: 'I-900', a, b, kind: 'work', method: 'human', status: 'pending', reason: '시험' };
    const decided = [];
    const base = mergeBase({ links: [...docs['U-D1'].identity_links, pend], onDecide: (item, status) => decided.push([item.a, item.b, status]) });
    assert.ok(!base.plan.works.some((w) => [w.a, w.b].sort().join() === [a, b].sort().join()), '같은 지도 업무끼리는 후보에 오르지 않는다(규칙은 그대로)');
    const root = mergePanel(base);
    body.append(root);
    const box = root.querySelector('[data-testid=merge-reask-box]');
    assert.ok(box);
    assert.equal(box.querySelector('h3').textContent, '다시 물어볼 답 1건');
    assert.equal(root.querySelectorAll('[data-testid=merge-reask-row]').length, 1);
    assert.equal(root.querySelector('[data-testid=merge-reask-row] [data-testid=merge-decide-q]').textContent, '이 둘이 같은 업무인가요?');
    const kids = [...root.childNodes];
    const h3Decided = kids.find((c) => c.tagName === 'H3' && c.textContent.startsWith('지금까지 고른 답'));
    assert.ok(kids.indexOf(box) < kids.indexOf(h3Decided), '「지금까지 고른 답」 위');
    // 「다른 업무」를 누르면 같은 판정 경로(onDecide)로 간다
    root.querySelector('[data-testid=merge-reask-row] [data-testid=merge-diff]').fire('click');
    assert.deepEqual(decided, [[a, b, 'rejected']]);
    // 후보 목록에 오르는 쌍의 pending은 묶음에 넣지 않는다(후보 줄에서 고른다)
    const listed = base.plan.works[0];
    const pend2 = { id: 'I-901', a: listed.a, b: listed.b, kind: 'work', method: 'human', status: 'pending', reason: '시험' };
    const root2 = mergePanel(mergeBase({ links: [...docs['U-D1'].identity_links, pend2] }));
    body.replaceChildren(root2);
    assert.equal(root2.querySelector('[data-testid=merge-reask-box]'), null);
    // 읽기 전용에서는 묶음이 없다
    const root3 = mergePanel(mergeBase({ links: [...docs['U-D1'].identity_links, pend], readOnly: true }));
    body.replaceChildren(root3);
    assert.equal(root3.querySelector('[data-testid=merge-reask-box]'), null);
  } finally {
    uninstallDom();
  }
});

test('RV13-2 「다시 묻기」 단추 title에 「되감기」가 없다', () => {
  const body = installDom();
  try {
    const root = mergePanel(mergeBase());
    body.append(root);
    const btns = root.querySelectorAll('[data-testid=merge-reask]');
    assert.ok(btns.length > 0);
    for (const b of btns) assert.ok(!b.getAttribute('title').includes('되감기'));
  } finally {
    uninstallDom();
  }
});

test('FU9-13 초안: 설명·절차가 없는 업무 둘만 있으면 두 줄 모두 안내가 붙고, 설명이 있는 업무는 안내 없이 설명만', async () => {
  const { mkDoc, mkEdge, mkNode } = await import('./helpers.js');
  const { buildView } = await import('../app/src/view/view.js');
  const U = 'U-FU9Q';
  const doc = mkDoc(U, [mkNode('N-001', 'work', '가상 점검'), mkNode('N-002', 'work', '가상 보고', { description: '매월 보고서를 낸다' }), mkNode('N-003', 'work', '가상 마감'),
    mkNode('N-101', 'person', '가상인1'), mkNode('N-102', 'person', '가상인2')],
  [mkEdge('N-000', 'N-001', 'contains'), mkEdge('N-000', 'N-002', 'contains'), mkEdge('N-000', 'N-003', 'contains'), mkEdge('N-101', 'N-001', 'performs')]);
  const v = buildView(doc, () => null);
  const r = buildHandoverDraft(v, { target: `${U}/N-000`, from: `${U}/N-101`, to: `${U}/N-102`, asOf: ASOF });
  const t = r.draft.items.find((i) => i.key === '세부_업무_절차').sentences.map((s) => s.text);
  assert.ok(t.includes(`가상 점검${NO_DESCRIPTION_NOTE}`), t.join('|'));
  assert.ok(t.includes(`가상 마감${NO_DESCRIPTION_NOTE}`), t.join('|'));
  assert.ok(t.includes('가상 보고 — 매월 보고서를 낸다'), t.join('|'));
});
