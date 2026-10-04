// T-11 흐름 변화·시간 슬라이더(D-08, R-05, R-14)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_A1 } from '../app/data/sample-a1.js';
import { SAMPLE_EVENT } from '../app/data/sample-event.js';
import { buildView } from '../app/src/view/view.js';
import { activeAt, flowChange, monthAsOf, periodKey, periodRange, timeMonths } from '../app/src/rules/flow.js';
import { affiliationAt, describeNode } from '../app/src/view/describe.js';

const ASOF = '2026-10-02';
const S = '2026-09-01T00:00:00+09:00';
const a1 = () => buildView(SAMPLE_A1);

test('기간 키와 범위: 월·분기, 윤년 2월', () => {
  assert.equal(periodKey('2026-06-15', 'month'), '2026-06');
  assert.equal(periodKey('2026-06-15', 'quarter'), '2026-Q2');
  assert.deepEqual(periodRange('2026-Q4', 'quarter'), { start: '2026-10-01', end: '2026-12-31' });
  assert.deepEqual(periodRange('2028-02', 'month'), { start: '2028-02-01', end: '2028-02-29' });
  assert.equal(monthAsOf('2026-06', ASOF), '2026-06-30');
  assert.equal(monthAsOf('2026-10', ASOF), ASOF); // 이번 달이면 오늘
});

test('월말 정산 월별 흐름: 첫 이력 달부터 이번 달까지, 2026-01 소속 변경, 2026-06 인계·담당', () => {
  const r = flowChange(a1(), { unit: 'month', asOf: ASOF });
  assert.equal(r.status, 'ok');
  assert.equal(r.periods[0].key, '2025-03');
  assert.equal(r.periods.at(-1).key, '2026-10');
  const by = Object.fromEntries(r.periods.map((p) => [p.key, p]));
  assert.equal(by['2026-01'].counts.affiliation_change, 1);
  assert.equal(by['2026-06'].counts.handover, 1);
  assert.ok(by['2026-06'].counts.assign_start >= 1);
  // 근거: 그 기간 이력의 ID(R-05 ①)
  assert.ok(by['2026-01'].evidence_ids.includes('U-A1/E-001'));
  // 기간 말 담당: 2025-06은 한가람(1명·1업무), 2026-07은 윤바다(1명·대사 확인·자료 수집·보고 3업무, 검토6 P-2)
  assert.deepEqual([by['2025-06'].active_people, by['2025-06'].active_works], [1, 1]);
  assert.deepEqual([by['2026-07'].active_people, by['2026-07'].active_works], [1, 3]);
  // 개편(2026-01) 전후로 같은 업무의 담당이 끊기지 않는다(R-14)
  assert.ok(['2025-12', '2026-01', '2026-02'].every((k) => by[k].active_works === 1));
});

test('분기 단위는 분기마다 한 줄', () => {
  const r = flowChange(a1(), { unit: 'quarter', asOf: ASOF });
  assert.deepEqual(r.periods.map((p) => p.key).slice(0, 2), ['2025-Q1', '2025-Q2']);
  assert.equal(r.periods.at(-1).key, '2026-Q4');
  assert.equal(r.periods.reduce((a, p) => a + p.counts.total, 0), flowChange(a1(), { unit: 'month', asOf: ASOF }).periods.reduce((a, p) => a + p.counts.total, 0));
});

const doc = (events) => ({
  schema_version: '1.0',
  universe: { id: 'U-O', name: '조직관리', level: '본부', root_node_id: 'N-000', subtypes: [], created_at: S },
  nodes: [{ id: 'N-000', core_type: 'root', label: '조직관리', hidden: false, created_at: S, updated_at: S }, { id: 'N-1', core_type: 'person', label: '가', hidden: false, created_at: S, updated_at: S }],
  edges: [], events, refs: [], identity_links: [],
});
const aff = (id, d) => ({ id, type: 'affiliation_change', occurred_at: d, recorded_at: S, source: 't', payload: { person_id: 'N-1' } });

test('오류(R-05 ②): 이력이 한 달 안에만 있으면 데이터 부족과 마지막 입력', () => {
  const r = flowChange(buildView(doc([aff('E-1', '2026-01-05'), aff('E-2', '2026-01-20')])), { asOf: ASOF });
  assert.equal(r.status, 'insufficient');
  assert.equal(r.last_input, '2026-01-20');
  assert.deepEqual(r.periods, []);
  assert.equal(flowChange(buildView(doc([])), { asOf: ASOF }).status, 'insufficient');
});

test('오류(R-05 ②): 입력이 2026-03에 끊기면 그 뒤 기간은 0건이 아니라 "입력 없음"', () => {
  const r = flowChange(buildView(doc([aff('E-1', '2026-01-05'), aff('E-2', '2026-03-10')])), { asOf: ASOF });
  assert.equal(r.status, 'ok');
  assert.equal(r.last_input, '2026-03-10');
  const nodata = r.periods.filter((p) => p.no_data).map((p) => p.key);
  assert.deepEqual(nodata, ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  assert.equal(r.no_data_periods, 7);
  assert.equal(r.periods.find((p) => p.key === '2026-03').no_data, false);
});

test('기준일 이후 이력은 세지 않는다(미래 날짜 입력)', () => {
  const r = flowChange(buildView(doc([aff('E-1', '2026-01-05'), aff('E-2', '2026-03-10'), aff('E-3', '2027-01-01')])), { asOf: ASOF });
  assert.equal(r.last_input, '2026-03-10');
});

test('시간 슬라이더 범위: 가장 이른 이력·담당 시작 달부터 이번 달까지', () => {
  const m = timeMonths(a1(), ASOF);
  assert.equal(m[0], '2025-03');
  assert.equal(m.at(-1), '2026-10');
  assert.equal(new Set(m).size, m.length);
  const e = timeMonths(buildView(SAMPLE_EVENT), ASOF);
  assert.equal(e[0], '2025-05');
});

test('기준일 담당(activeAt): 2025-06 한가람, 2026-09-15 윤바다, 오늘 서하늘', () => {
  const v = a1();
  const who = (d) => [...activeAt(v, d).people].map((g) => v.getNode(g).label);
  assert.deepEqual(who('2025-06-30'), ['한가람']);
  assert.deepEqual(who('2026-09-15'), ['윤바다']);
  assert.deepEqual(who(ASOF), ['서하늘']);
});

test('R-14: 기준일 소속 — 개편 전에는 기록 없음, 개편 후에는 "미기재 — 소속 변경 메모"', () => {
  const v = a1();
  assert.equal(affiliationAt(v, 'U-A1/N-010', '2025-12-31').from, null);
  const after = affiliationAt(v, 'U-A1/N-010', '2026-02-01');
  assert.equal(after.label, '미기재');
  assert.ok(after.note.includes('가상정산팀'));
  const rows = describeNode(v, 'U-A1/N-010', { asOf: '2026-02-01' }).rows;
  assert.ok(rows.find((r) => r.label === '소속(기준일)').value.startsWith('미기재 — 2026-01-01 소속 변경'));
  assert.ok(!describeNode(v, 'U-A1/N-010', { asOf: '2025-12-31' }).rows.some((r) => r.label === '소속(기준일)'));
});

test('기준일 이후 이력은 상세에서 after 표시(흐리게)', () => {
  const h = describeNode(a1(), 'U-A1/N-001', { asOf: '2026-06-30' }).history;
  assert.ok(h.some((x) => x.after) && h.some((x) => !x.after));
  assert.ok(h.filter((x) => x.after).every((x) => x.date > '2026-06-30'));
});
