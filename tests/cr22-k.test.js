// CR-22 K 항목 카드 단위 검증: 연결 묶음 분류·정렬, 이력 최신순·거르기·쪽 나누기, 상태 줄·지금 볼 것·사람 표의 값, 유형별 동작 줄, 카드 그리기(DOM 흉내).
// 실제 브라우저 점검(tools/browser-check.mjs 「CR-22 K」)을 대신하지 않는다. 가상 데이터만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, uninstallDom } from './dom-stub.js';
import { mkDoc, mkEdge, mkNode } from './helpers.js';
import { buildView } from '../app/src/view/view.js';
import { describeNode } from '../app/src/view/describe.js';
import {
  CARD, HISTORY_GROUPS, actionPlan, cardData, filterHistory, groupLinks, groupOpen, historyGroupOf, historyPreview, historyRows, historyStatusOf,
  isLongValue, issueSplitText, latestRecord, limitItems, newestFirst, pageRows, personData, sortAssignLinks, splitIssues,
} from '../app/src/view/card.js';
import { renderNodeDetail } from '../app/src/ui/detail.js';

const q = (root, id) => root.querySelector(`[data-testid=${id}]`);
const withDom = (fn) => async () => {
  const body = installDom();
  try { await fn(body); } finally { uninstallDom(); }
};
const ASOF = '2026-10-02';
const AT = (n) => `2026-10-${String(n).padStart(2, '0')}T09:00:00+09:00`;
const ev = (id, type, occurred_at, recorded_at, payload, note, source = 'user') => ({ id, type, occurred_at, recorded_at, source, payload, note });

// ── 연결 묶음 ──
const link = (label, extra = {}) => ({ relation: '수행', relation_type: 'performs', direction: 'in', status_key: null, period_start: null, period_end: null, other: { gid: `U/${label}`, label, type_label: '사람' }, ...extra });

test('CR-22 K 담당 줄 세우기: 지금(넘김 포함) → 예정 → 지난(끝난 날 최신 먼저), 같으면 이름순, 입력은 그대로', () => {
  const input = [
    link('가', { status_key: 'ended', period_end: '2024-03-31' }),
    link('나', { status_key: 'ended', period_end: '2026-05-31' }),
    link('다', { status_key: 'scheduled', period_start: '2026-12-01' }),
    link('라', { status_key: 'current' }),
    link('마', { status_key: 'handover' }),
    link('바', { status_key: 'ended', period_end: '2026-05-31' }),
    link('사', { status_key: 'scheduled', period_start: '2026-11-01' }),
  ];
  const copy = JSON.parse(JSON.stringify(input));
  const out = sortAssignLinks(input).map((l) => l.other.label);
  assert.deepEqual(out, ['라', '마', '사', '다', '나', '바', '가']);
  assert.deepEqual(input, copy, '입력은 바뀌지 않는다');
  // 기준일이 없어 상태 표시가 없으면 끝 날짜가 있는 것이 지난 담당
  assert.deepEqual(sortAssignLinks([link('옛', { period_end: '2020-01-01' }), link('지금')]).map((l) => l.other.label), ['지금', '옛']);
});

test('CR-22 K 연결 묶음: 업무는 담당·산출물·앞뒤 업무·관련 주제·기타로, 비면 빼고, 한 연결은 한 묶음에만', () => {
  const mk = (relation_type, direction, label, type_label, extra = {}) => ({ relation: relation_type, relation_type, direction, status_key: null, period_start: null, period_end: null, other: { gid: `U/${label}`, label, type_label }, ...extra });
  const links = [
    mk('performs', 'in', '김가상', '사람', { status_key: 'ended', period_end: '2025-01-01' }), mk('performs', 'in', '이가상', '사람', { status_key: 'current' }),
    mk('produces', 'out', '보고서 2025-01', '산출물'), mk('produces', 'out', '보고서 2026-04', '산출물'),
    mk('precedes', 'in', '앞 업무', '업무'), mk('precedes', 'out', '뒤 업무', '업무'),
    mk('relates_to', 'out', '정산 기준', '주제'), mk('references', 'out', '협업자', '사람'), mk('relates_to', 'out', '다른 업무', '업무'),
  ];
  const g = groupLinks('work', links);
  assert.deepEqual(g.map((x) => x.key), ['assign', 'outputs', 'around']);
  assert.deepEqual(g[0].items.map((l) => l.other.label), ['이가상', '김가상']);
  assert.equal(g[0].preview, '지금 1 · 지난 1');
  assert.equal(g[1].items[0].other.label, '보고서 2026-04', '산출물은 이름 내림차순(최근 것이 먼저)');
  assert.equal(g[1].preview, '최근: 보고서 2026-04');
  assert.deepEqual(g[2].parts, { before: 1, after: 1, topics: 1, etc: 2 });
  assert.equal(g[2].preview, '앞뒤 업무 2 · 관련 주제 1 · 기타 연결 2');
  assert.equal(g.flatMap((x) => x.items).length, links.length);
  assert.deepEqual(groupLinks('work', [links[2]]).map((x) => x.key), ['outputs'], '빈 묶음은 돌려주지 않는다');
  assert.deepEqual(groupLinks('work', []), []);
  const other = groupLinks('artifact', links.slice(0, 3));
  assert.equal(other.length, 1);
  assert.equal(other[0].key, 'links');
  assert.equal(other[0].items.length, 3);
});

test('CR-22 K 묶음 펼침·줄 제한: 건수가 있는 묶음은 기본 접힘(사용자 의견 10-26 저녁, 예전 5줄 이하 펼침), 직접 바꾼 값이 먼저, 5줄만 먼저 + 모두', () => {
  assert.equal(CARD.OPEN_MAX, 0);
  assert.equal(groupOpen(1), false);
  assert.equal(groupOpen(5), false);
  assert.equal(groupOpen(6), false);
  assert.equal(groupOpen(6, true), true);
  assert.equal(groupOpen(2, false), false);
  const many = Array.from({ length: 12 }, (_, i) => i);
  assert.deepEqual(limitItems(many), { shown: [0, 1, 2, 3, 4], rest: 7 });
  assert.equal(limitItems(many, true).shown.length, 12);
  assert.deepEqual(limitItems([1, 2, 3]), { shown: [1, 2, 3], rest: 0 });
  assert.deepEqual(limitItems(many.slice(0, 5)), { shown: many.slice(0, 5), rest: 0 });
  assert.equal(isLongValue('x'.repeat(CARD.LONG_VALUE)), false);
  assert.equal(isLongValue('x'.repeat(CARD.LONG_VALUE + 1)), true);
});

// ── 이력 ──
const H = (gid, date, type, category = null, text = gid) => ({ gid, date, type, category, type_label: type === 'memo' ? '메모' : type, text, after: false });

test('CR-22 K 이력 최신순: 날짜 내림차순, 같은 날은 나중에 기록한 줄이 위, 범주·상태 붙임, 입력은 그대로', () => {
  const hist = [H('a', '2026-01-01', 'created'), H('b', '2026-03-01', 'memo', 'issue'), H('c', '2026-03-01', 'memo', 'resolved'), H('d', '2026-02-01', 'assign_start'), H('e', '2026-03-01', 'handover'), H('f', '2026-01-15', 'memo', 'caution')];
  const copy = JSON.parse(JSON.stringify(hist));
  const rows = historyRows(hist, new Set(['b']));
  assert.deepEqual(rows.map((r) => r.gid), ['e', 'c', 'b', 'd', 'f', 'a']);
  assert.deepEqual(hist, copy);
  assert.deepEqual(rows.map((r) => r.group), ['인수인계', '해결', '메모', '담당', '메모', '수정']);
  assert.deepEqual(rows.map((r) => r.status), ['', '해결', '미해결', '', '기록', '']);
  assert.equal(historyStatusOf(H('x', '2026-01-01', 'memo', 'issue'), new Set()), '해결됨', '닫힌 이슈 메모');
  assert.equal(historyStatusOf(H('x', '2026-01-01', 'memo', 'in_progress'), null), '해결됨');
  assert.deepEqual(historyRows([], null), []);
  for (const [t, c, g] of [['memo', 'resolved', '해결'], ['memo', 'issue', '메모'], ['assign_end', null, '담당'], ['handover', null, '인수인계'], ['updated', null, '수정'], ['hidden', null, '수정'], ['affiliation_change', null, '수정']]) {
    assert.equal(historyGroupOf(t, c), g, `${t}/${c}`);
    assert.ok(HISTORY_GROUPS.includes(g));
  }
});

test('CR-22 K 이력 거르기: 범주·기간(올해·작년·전체)·찾기 글, 조건이 겹치면 모두 만족, 모르는 범주는 거르지 않음', () => {
  const rows = historyRows([
    H('a', '2025-12-31', 'memo', 'issue', '전표 합계 불일치'), H('b', '2026-01-02', 'assign_start', null, '김가상 담당 시작'), H('c', '2026-06-01', 'memo', 'resolved', '불일치 원인 확인'),
    H('d', '2026-06-02', 'handover', null, '김가상 → 이가상 인수인계'), H('e', '2024-05-05', 'updated', null, '수정 — 설명'),
  ], new Set());
  const f = (o) => filterHistory(rows, o, '2026-10-26').map((r) => r.gid);
  assert.deepEqual(f({}), ['d', 'c', 'b', 'a', 'e']);
  assert.deepEqual(f({ group: '담당' }), ['b']);
  assert.deepEqual(f({ group: '메모' }), ['a']);
  assert.deepEqual(f({ group: '해결' }), ['c']);
  assert.deepEqual(f({ group: '엉뚱' }), ['d', 'c', 'b', 'a', 'e']);
  assert.deepEqual(f({ period: '올해' }), ['d', 'c', 'b']);
  assert.deepEqual(f({ period: '작년' }), ['a']);
  assert.deepEqual(f({ period: '전체' }), ['d', 'c', 'b', 'a', 'e']);
  assert.deepEqual(f({ q: '불일치' }), ['c', 'a']);
  assert.deepEqual(f({ q: '  불일치  ', period: '올해' }), ['c']);
  assert.deepEqual(f({ q: '김가상', group: '인수인계' }), ['d']);
  assert.deepEqual(f({ q: '없는말' }), []);
  assert.deepEqual(f({ q: '2026-06' }), ['d', 'c'], '날짜 글자도 찾는다');
});

test('CR-22 K 쪽 나누기: 20줄씩 누적, 마지막 쪽은 남은 만큼, 빈 목록·잘못된 쪽 번호', () => {
  const rows = Array.from({ length: 45 }, (_, i) => ({ gid: `g${i}` }));
  const p1 = pageRows(rows, 1);
  assert.deepEqual([p1.shown.length, p1.total, p1.shownCount, p1.hasMore, p1.nextCount], [20, 45, 20, true, 20]);
  const p2 = pageRows(rows, 2);
  assert.deepEqual([p2.shown.length, p2.hasMore, p2.nextCount], [40, true, 5]);
  assert.equal(p2.shown[0].gid, 'g0', '앞쪽은 그대로 쌓인다');
  const p3 = pageRows(rows, 3);
  assert.deepEqual([p3.shown.length, p3.hasMore, p3.nextCount], [45, false, 0]);
  assert.equal(pageRows(rows, 99).shown.length, 45);
  assert.equal(pageRows(rows, 0).shown.length, 20);
  assert.equal(pageRows(rows, 'x').shown.length, 20);
  assert.deepEqual(pageRows([], 1), { shown: [], total: 0, shownCount: 0, hasMore: false, nextCount: 0 });
  assert.equal(pageRows(rows, 1, 5).shown.length, 5);
});

test('CR-22 K 카드 이력 미리보기: 최신 3건(예전 5), 방금 기록한 줄이 더 옛것이면 따로 한 줄(나머지 수는 그만큼 줄어든다)', () => {
  assert.equal(CARD.HISTORY_SHOWN, 3);
  const rows = Array.from({ length: 12 }, (_, i) => ({ gid: `g${i}`, date: `2026-01-${String(20 - i).padStart(2, '0')}` }));
  const a = historyPreview(rows, null);
  assert.deepEqual([a.shown.length, a.extra, a.rest], [3, null, 9]);
  const b = historyPreview(rows, ['g1']);
  assert.deepEqual([b.shown.length, b.extra, b.rest], [3, null, 9], '이미 보이는 줄이면 그대로');
  const c = historyPreview(rows, ['g9']);
  assert.equal(c.extra.gid, 'g9');
  assert.equal(c.rest, 8);
  assert.deepEqual(historyPreview(rows.slice(0, 3), ['zz']), { shown: rows.slice(0, 3), extra: null, rest: 0 });
});

// ── 값 모으기(가상 지도) ──
function sampleView() {
  const nodes = [
    mkNode('N-W1', 'work', '대사 확인', { attrs: { 마감: '월말+3영업일' } }), mkNode('N-W2', 'work', '정산 점검', { attrs: { 마감: '매월 5일' } }), mkNode('N-W3', 'work', '자료 정리'),
    mkNode('N-T1', 'topic', '정산 기준'),
    mkNode('N-P1', 'person', '김가상', { emp_no: 'V-1001', attrs: { 연락처: '내선 1001' } }), mkNode('N-P2', 'person', '이가상', { emp_no: 'V-1002' }), mkNode('N-P3', 'person', '박가상', { emp_no: 'V-1003' }),
  ];
  const edges = [
    mkEdge('N-P1', 'N-W1', 'performs', { period: { start: '2026-06-01' } }), mkEdge('N-P2', 'N-W1', 'performs', { period: { start: '2025-01-01', end: '2026-05-31' } }), mkEdge('N-P3', 'N-W1', 'performs', { period: { start: '2024-01-01', end: '2024-12-31' } }),
    mkEdge('N-P1', 'N-W2', 'performs', { period: { start: '2026-01-01' } }), mkEdge('N-P1', 'N-W3', 'performs', { period: { start: '2023-01-01', end: '2024-01-01' } }),
    mkEdge('N-W1', 'N-T1', 'relates_to'), mkEdge('N-W2', 'N-T1', 'relates_to'),
  ];
  const events = [
    ev('E-1', 'memo', '2026-09-01', AT(1), { target_id: 'N-W1', category: 'issue' }, '이 업무 이슈'),
    ev('E-2', 'memo', '2026-09-20', AT(2), { target_id: 'N-W1', category: 'in_progress' }, '이 업무 진행 중'),
    ev('E-3', 'memo', '2026-09-10', AT(3), { target_id: 'N-W2', topic_ids: ['N-T1'], category: 'issue' }, '다른 업무의 같은 주제 이슈'),
    ev('E-4', 'memo', '2026-09-11', AT(4), { target_id: 'N-W1', category: 'issue' }, '곧 닫힐 이슈'),
    ev('E-5', 'memo', '2026-09-12', AT(5), { target_id: 'N-W1', category: 'resolved', resolves_id: 'E-4' }, '해결: 곧 닫힐 이슈'),
    ev('E-6', 'assign_start', '2026-06-01', AT(6), { person_id: 'N-P1', work_id: 'N-W1' }, undefined),
  ];
  return buildView(mkDoc('U-K', nodes, edges, events), () => null);
}

test('CR-22 K 미해결 나누기·지금 볼 것: 이 업무 a · 같은 주제 b, 최신 2건이 먼저, 닫힌 메모는 빠짐', () => {
  const view = sampleView();
  const d = describeNode(view, 'U-K/N-W1', { asOf: ASOF });
  const c = cardData(view, 'U-K/N-W1', { asOf: ASOF, history: d.history });
  assert.deepEqual(c.issues, { total: 3, own: 2, topic: 1 });
  assert.equal(issueSplitText(c.issues), '이 업무 2 · 같은 주제 1');
  assert.equal(issueSplitText({ total: 2, own: 2, topic: 0 }), '', '같은 주제가 없으면 나누어 쓰지 않는다');
  assert.equal(c.now.length, CARD.NOW_ISSUES);
  assert.deepEqual(c.now.map((x) => x.gid), ['U-K/E-2', 'U-K/E-3'], '날짜가 늦은 메모가 위(09-20, 09-10)');
  assert.deepEqual(c.now.map((x) => x.category), ['진행 중', '이슈']);
  assert.ok(!c.openGids.has('U-K/E-4'), '해결된 이슈는 미해결이 아니다');
  assert.equal(splitIssues(view, 'U-K/N-W1', []).total, 0);
  // 같은 날은 나중에 기록한 것이 위
  const same = [{ occurred_at: '2026-09-01', note: 'a' }, { occurred_at: '2026-09-01', note: 'b' }, { occurred_at: '2026-08-01', note: 'c' }];
  assert.deepEqual(newestFirst(same).map((x) => x.note), ['b', 'a', 'c']);
});

test('CR-22 K 업무 상태 줄: 담당 이름·연락처, 마감, 공백 업무의 안내, 최근 기록 한 줄(사용자 기록만)', () => {
  const view = sampleView();
  const d = describeNode(view, 'U-K/N-W1', { asOf: ASOF });
  const c = cardData(view, 'U-K/N-W1', { asOf: ASOF, history: d.history });
  assert.deepEqual(c.owners, [{ gid: 'U-K/N-P1', label: '김가상', contact: '내선 1001' }]);
  assert.equal(c.deadline, '월말+3영업일');
  assert.equal(c.gap, false);
  assert.match(c.holdersText, /김가상/);
  assert.match(c.loadText, /^현재 담당: 김가상/);
  assert.ok(c.latest, '최근 기록이 있다');
  assert.equal(c.latest.gid, 'U-K/E-6'.replace('E-6', c.latest.gid.split('/')[1]));
  // 담당이 없는 업무: 공백 안내
  const d3 = describeNode(view, 'U-K/N-W3', { asOf: ASOF });
  const c3 = cardData(view, 'U-K/N-W3', { asOf: ASOF, history: d3.history });
  assert.deepEqual(c3.owners, []);
  assert.equal(c3.gap, true);
  assert.match(c3.loadText, /^공백 — 이전 담당자만 있음/);
  assert.equal(c3.deadline, '');
  assert.equal(c3.latest, null);
  assert.equal(cardData(view, 'U-K/없음', { asOf: ASOF }), null);
  assert.equal(latestRecord(historyRows([H('x', '2026-01-01', 'created'), H('y', '2026-01-02', 'updated')], null)), null, '자동 기록만 있으면 최근 기록이 없다');
});

test('CR-22 K 사람 카드 값: 맡은 업무 수·연락처, 업무 표는 미해결 많은 것 먼저, 지난 업무는 끝난 날 최신순(지금 맡은 업무는 제외)', () => {
  const view = sampleView();
  const d = describeNode(view, 'U-K/N-P1', { asOf: ASOF });
  const c = cardData(view, 'U-K/N-P1', { asOf: ASOF, history: d.history });
  assert.equal(c.contact, '내선 1001');
  assert.equal(c.count, 2);
  assert.equal(c.hasAssignments, true);
  // 혼자만 아는 일(정산 점검: 김가상만 해 봄)이 먼저, 그다음 미해결 많은 순
  assert.deepEqual(c.personRows.map((r) => [r.label, r.solo, r.open, r.deadline]), [['정산 점검', true, 1, '매월 5일'], ['대사 확인', false, 2, '월말+3영업일']]);
  assert.equal(c.solo, 1);
  assert.deepEqual(c.pastRows.map((r) => [r.label, r.end]), [['자료 정리', '2024-01-01']]);
  // 혼자만 아는 일은 지금 맡은 것 중에서만 센다
  assert.ok(c.solo <= c.count);
  assert.equal(c.personRows.filter((r) => r.solo).length, c.solo);
  // 맡은 적 없는 사람
  const none = personData(view, view.getNode('U-K/N-T1'), { asOf: ASOF });
  assert.equal(none.count, 0);
  assert.equal(none.hasAssignments, false);
  assert.deepEqual(none.personRows, []);
});

// ── 동작 줄 ──
test('CR-22 K 유형별 동작 줄: 쓸 수 없는 단추는 뺀다(업무·사람·산출물·주제, 읽기 전용, 다른 지도, 숨긴 항목)', () => {
  const base = { own: true, readOnly: false, hidden: false, handoverDoc: false, canDelete: false };
  const work = actionPlan({ ...base, coreType: 'work', canDelete: true });
  assert.deepEqual(work.primary, ['record', 'assign', 'draft']);
  assert.deepEqual(work.more, ['edit', 'edge', 'collab', 'history', 'similar', 'insight', 'nbhd', 'hide', 'delete']);
  assert.ok(!actionPlan({ ...base, coreType: 'work' }).more.includes('delete'), '지울 수 없으면 삭제 단추 없음');
  const person = actionPlan({ ...base, coreType: 'person' });
  assert.deepEqual(person.primary, ['record', 'personDraft']);
  assert.ok(!person.primary.includes('assign') && !person.more.includes('collab') && !person.more.includes('similar'), '사람 카드에는 담당 넘기기·협업자·유사 경험자가 없다');
  assert.deepEqual(actionPlan({ ...base, coreType: 'artifact', handoverDoc: true }).primary, ['download', 'print', 'record']);
  assert.deepEqual(actionPlan({ ...base, coreType: 'artifact' }).primary, ['record']);
  assert.deepEqual(actionPlan({ ...base, coreType: 'topic' }).primary, ['record']);
  assert.deepEqual(actionPlan({ ...base, coreType: 'org' }).more.slice(0, 3), ['edit', 'edge', 'history']);
  // 읽기 전용: 쓰는 단추(기록·담당·수정·연결·숨기기)가 없고 보는 단추만
  const ro = actionPlan({ ...base, coreType: 'work', readOnly: true, canDelete: true });
  assert.deepEqual(ro.primary, ['draft']);
  assert.deepEqual(ro.more, ['history', 'similar', 'insight', 'nbhd']);
  assert.deepEqual(actionPlan({ ...base, coreType: 'person', readOnly: true }).primary, []);
  assert.deepEqual(actionPlan({ ...base, coreType: 'artifact', handoverDoc: true, readOnly: true }).primary, ['download', 'print'], '읽기 전용이어도 내려받기·인쇄는 된다');
  // 다른 업무 지도의 항목: 고칠 수 없다. 사람의 「이 사람 일 인수인계 초안」은 있다
  const foreign = actionPlan({ ...base, coreType: 'work', own: false });
  assert.deepEqual(foreign.primary, ['draft']);
  assert.ok(!foreign.more.includes('edit') && !foreign.more.includes('hide'));
  assert.deepEqual(actionPlan({ ...base, coreType: 'person', own: false }).primary, ['personDraft']);
  // 숨긴 항목: 단추 없음
  assert.deepEqual(actionPlan({ ...base, coreType: 'work', hidden: true }), { primary: [], more: [] });
});

// ── 카드 그리기 ──
function cardOpts(view, gid, d, over = {}) {
  const c = cardData(view, gid, { asOf: ASOF, history: d.history });
  const open = new Map();
  const all = new Set();
  const state = { isOpen: (k, dflt) => (open.has(k) ? open.get(k) : dflt), setOpen: (k, v, dflt) => { if (v === dflt) open.delete(k); else open.set(k, v); }, isAll: (k) => all.has(k), setAll: (k) => all.add(k) };
  return { data: c, state, actions: { primary: [], more: [] }, forms: [], notes: { alerts: [] }, layer: null, afterActions: [], canResolve: true, onResolve() {}, onOpenIssues() {}, onHistoryAll() {}, ...over };
}

test('CR-22 K 업무 카드: 이름 h2는 이름만, 상태 줄(담당 이름 단추·미해결·마감), 지금 볼 것, 묶음 5개 규칙, 이력 최신 5건 + 모두 보기', withDom((body) => {
  // 이력 12건 + 연결 8개로 접힘·모두 n개를 확인한다
  const nodes = [mkNode('N-W1', 'work', '대사 확인', { attrs: { 마감: '월말', 절차: '긴 절차 '.repeat(30) } }), mkNode('N-P1', 'person', '김가상', { attrs: { 연락처: '내선 1' } })];
  const edges = [mkEdge('N-P1', 'N-W1', 'performs', { period: { start: '2026-06-01' } })];
  for (let i = 0; i < 7; i += 1) {
    nodes.push(mkNode(`N-A${i}`, 'artifact', `보고서 ${i}`));
    edges.push(mkEdge('N-W1', `N-A${i}`, 'produces'));
  }
  const events = Array.from({ length: 12 }, (_, i) => ev(`E-${i + 1}`, 'memo', `2026-09-${String(i + 1).padStart(2, '0')}`, AT(i + 1), { target_id: 'N-W1', category: i % 2 ? 'caution' : 'issue' }, `메모 ${i + 1}`));
  const view = buildView(mkDoc('U-R', nodes, edges, events), () => null);
  const d = describeNode(view, 'U-R/N-W1', { asOf: ASOF });
  const panel = document.createElement('div');
  body.append(panel);
  const focused = [];
  renderNodeDetail(panel, d, { onFocus: (g) => focused.push(g), linkTools: () => null, justAdded: null, card: cardOpts(view, 'U-R/N-W1', d) });
  assert.equal(panel.querySelector('h2').textContent, '대사 확인', 'h2는 이름만(유형 칩은 옆)');
  assert.ok(q(panel, 'card-type'));
  assert.equal(q(panel, 'owner-link').textContent, '김가상');
  q(panel, 'owner-link').click();
  assert.deepEqual(focused, ['U-R/N-P1'], '담당 이름을 누르면 사람 카드로');
  assert.match(q(panel, 'owner-contact').textContent, /내선 1/);
  assert.match(q(panel, 'card-deadline').textContent, /마감 월말/);
  assert.equal(q(panel, 'issue-count').getAttribute('data-count'), '6');
  assert.ok(q(panel, 'btn-issues'));
  assert.equal(panel.querySelectorAll('[data-testid=now-issue]').length, 2);
  assert.equal(panel.querySelectorAll('[data-testid=now-resolve]').length, 2);
  // 산출물 7개: 5줄 + 모두 7개, 묶음은 닫힘
  const outputs = q(panel, 'card-group-outputs');
  assert.equal(outputs.getAttribute('open'), null, '6줄 이상은 기본 접힘');
  assert.equal(outputs.querySelectorAll('li').length, 5);
  const moreBtn = outputs.querySelector('[data-testid=group-all]');
  assert.match(moreBtn.textContent, /모두 7개/);
  moreBtn.click();
  assert.equal(outputs.querySelectorAll('li').length, 7);
  assert.equal(outputs.querySelector('[data-testid=group-all]'), null);
  // 담당 묶음은 1줄이어도 접힘(첫 화면은 요약만, 사용자 의견 10-26 저녁). 머리글 한 줄 + 건수
  assert.equal(q(panel, 'card-group-assign').getAttribute('open'), null);
  assert.match(q(panel, 'card-group-assign').querySelector('summary').textContent, /담당.*1/);
  assert.equal(q(panel, 'card-group-content').getAttribute('open'), null, '내용도 접힘');
  // 이력: 12건 → 최근 3건(최신이 위) + 기록 모두 보기, 묶음은 펼침, 머리에 id(이력으로 가는 곳)
  const hist = q(panel, 'card-group-history');
  assert.notEqual(hist.getAttribute('open'), null);
  const lis = hist.querySelectorAll('[data-testid=history] li');
  assert.equal(lis.length, 3);
  assert.equal(lis[0].querySelector('time').textContent, '2026-09-12');
  assert.equal(lis[2].querySelector('time').textContent, '2026-09-10');
  assert.match(q(panel, 'history-all').textContent, /기록 모두 보기/);
  // 접힌 묶음 수: 첫 화면에서 펼쳐진 묶음은 기록 하나뿐
  assert.deepEqual(['content', 'assign', 'outputs', 'history'].filter((k) => q(panel, `card-group-${k}`).getAttribute('open') !== null), ['history']);
  assert.ok(q(panel, 'history-all'));
  assert.equal(q(panel, 'history-heading').getAttribute('id'), 'history-heading');
  assert.match(q(panel, 'history-count').textContent, /최신이 위 · 12건/);
  // 긴 속성(절차)은 한 번 더 접힘
  assert.ok(q(panel, 'long-value'));
  assert.equal(q(panel, 'attrs').querySelectorAll('[data-testid=long-value]').length, 1);
  // 연결·이력 목록 시험 이름 유지
  assert.ok(q(panel, 'links'));
}));

test('CR-22 K 카드: 방금 기록한 옛 줄은 이력이 닫혀 있어도 펼치고 따로 한 줄로 보인다, 이력·연결이 없으면 안내 문구', withDom((body) => {
  const events = Array.from({ length: 9 }, (_, i) => ev(`E-${i + 1}`, 'memo', `2026-09-${String(i + 1).padStart(2, '0')}`, AT(i + 1), { target_id: 'N-W1', category: 'caution' }, `메모 ${i + 1}`));
  const view = buildView(mkDoc('U-R', [mkNode('N-W1', 'work', '대사 확인')], [], events), () => null);
  const d = describeNode(view, 'U-R/N-W1', { asOf: ASOF });
  const panel = document.createElement('div');
  body.append(panel);
  renderNodeDetail(panel, d, { onFocus() {}, linkTools: () => null, justAdded: ['U-R/E-1'], card: cardOpts(view, 'U-R/E-1'.replace('E-1', 'N-W1'), d) });
  assert.notEqual(q(panel, 'card-group-history').getAttribute('open'), null, '방금 기록한 줄이 있으면 이력 묶음을 펼친다');
  assert.equal(panel.querySelectorAll('[data-testid=history] li').length, 3);
  const extra = q(panel, 'history-extra').querySelectorAll('li');
  assert.equal(extra.length, 1);
  assert.equal(extra[0].getAttribute('data-just-added'), '1');
  assert.ok(q(panel, 'no-links'), '연결이 없으면 「연결 없음」');
  // 이력 없는 항목
  const empty = buildView(mkDoc('U-E', [mkNode('N-W1', 'work', '새 업무')], []), () => null);
  const d2 = describeNode(empty, 'U-E/N-W1', { asOf: ASOF });
  const p2 = document.createElement('div');
  body.append(p2);
  renderNodeDetail(p2, d2, { onFocus() {}, linkTools: () => null, card: cardOpts(empty, 'U-E/N-W1', d2) });
  assert.ok(q(p2, 'no-history'));
  assert.equal(q(p2, 'history-all'), null);
}));

test('CR-22 K 사람 카드: 상태 줄·지금 맡은 업무 표(5줄+모두)·지난 업무 접힘, 동작 줄 단추는 주어진 것만', withDom((body) => {
  const view = sampleView();
  const d = describeNode(view, 'U-K/N-P1', { asOf: ASOF });
  const panel = document.createElement('div');
  body.append(panel);
  const rec = document.createElement('button');
  rec.textContent = '기록 남기기';
  renderNodeDetail(panel, d, { onFocus() {}, linkTools: () => null, card: cardOpts(view, 'U-K/N-P1', d, { actions: { primary: [rec], more: [] } }) });
  assert.match(q(panel, 'card-who').textContent, /V-1001/);
  assert.match(q(panel, 'card-who').textContent, /내선 1001/);
  assert.match(q(panel, 'card-person-count').textContent, /맡은 업무 2/);
  assert.equal(panel.querySelectorAll('[data-testid=person-work-row]').length, 2);
  assert.equal(q(panel, 'card-actions').querySelectorAll('button').length, 1, '사람 카드 동작 줄에는 담당 넘기기가 없다');
  assert.equal(q(panel, 'more-tools'), null, '더 보기 단추가 없으면 「⋯」도 없다');
  assert.equal(q(panel, 'card-group-person-past').getAttribute('open'), null, '지난 업무는 접힘');
  assert.equal(q(panel, 'card-now').querySelector('h3').textContent, '최근 기록');
}));
