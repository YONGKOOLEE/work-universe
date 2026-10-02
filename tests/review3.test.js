// 2026-10-02 두 번째 전체 검토(규칙 RL-1~6) 재발 방지
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildView } from '../app/src/view/view.js';
import { densityGaps, similarExperts } from '../app/src/rules/insight.js';
import { buildHandoverDraft } from '../app/src/rules/handover.js';
import { describeNode, periodStatus, periodText } from '../app/src/view/describe.js';

const S = '2026-09-01T00:00:00+09:00';
const ASOF = '2026-10-02';
const n = (id, t, l, r = {}) => ({ id, core_type: t, label: l, hidden: false, created_at: S, updated_at: S, ...r });
let k = 0;
const e = (s, t, c, r = {}) => ({ id: `L-${++k}`, source: s, target: t, core_type: c, hidden: false, created_at: S, ...r });
const doc = (id, nodes, edges, events = [], extra = {}) => ({
  schema_version: '1.0',
  universe: { id, name: id, level: '팀', root_node_id: 'N-000', subtypes: [], created_at: S },
  nodes: [n('N-000', 'root', id), ...nodes], edges, events, refs: [], identity_links: [], ...extra,
});
const memo = (id, date, rec, target, category, note) => ({ id, type: 'memo', occurred_at: date, recorded_at: rec, source: 't', payload: { target_kind: 'node', target_id: target, ...(category ? { category } : {}) }, note });

test('기간 상태: 시작 전 = 예정, 끝난 뒤 = 종료, 끝나는 날까지 = 현재', () => {
  assert.equal(periodStatus({ start: '2026-12-01' }, ASOF), 'scheduled');
  assert.equal(periodStatus({ start: '2026-01-01', end: '2026-10-01' }, ASOF), 'ended');
  assert.equal(periodStatus({ start: '2026-01-01', end: ASOF }, ASOF), 'current');
  assert.equal(periodStatus(undefined, ASOF), 'current');
  assert.equal(periodText({ start: '2026-12-01' }, ASOF), '2026-12-01부터 (시작 예정)');
  assert.equal(periodText({ start: '2026-12-01' }), '2026-12-01 ~ 진행 중'); // 기준일이 없으면 예전 표시
});

// 시작일이 미래인 담당
const futureDoc = () => doc('U-X',
  [n('N-1', 'work', '작업A'), n('N-2', 'person', '가', { emp_no: 'V-0001' }), n('N-3', 'topic', 'T'), n('N-4', 'work', '작업B'), n('N-5', 'person', '나', { emp_no: 'V-0002' })],
  [e('N-000', 'N-1', 'contains'), e('N-2', 'N-1', 'performs', { period: { start: '2026-12-01' } }), e('N-1', 'N-3', 'relates_to'), e('N-4', 'N-3', 'relates_to'),
    e('N-2', 'N-4', 'performs', { period: { start: '2026-12-01' } }), e('N-5', 'N-4', 'performs', { period: { start: '2026-01-01' } })]);

test('RL-1: 시작 예정 담당자만 있는 업무는 공백 "scheduled"로, 상세 연결은 "예정"으로 보인다', () => {
  const v = buildView(futureDoc());
  const g = densityGaps(v, { asOf: ASOF }).gaps.find((x) => x.gid === 'U-X/N-1');
  assert.equal(g.kind, 'scheduled');
  assert.equal(g.next_person.label, '가');
  assert.equal(g.next_start, '2026-12-01');
  const link = describeNode(v, 'U-X/N-1', { asOf: ASOF }).links.find((l) => l.relation_type === 'performs');
  assert.equal(link.status, '예정');
  assert.equal(link.period, '2026-12-01부터 (시작 예정)');
});

test('RL-2: 아직 시작하지 않은 담당은 유사 경험으로 세지 않는다', () => {
  const s = similarExperts(buildView(futureDoc()), { works: ['U-X/N-1'], asOf: ASOF });
  assert.deepEqual(s.people.map((p) => p.label), ['나']);
});

test('RL-5: 수행 연결이 숨긴 업무에만 있으면 결론 없이 데이터 부족', () => {
  const d = doc('U-Y', [n('N-1', 'work', '작업A', { hidden: true }), n('N-4', 'work', '작업B'), n('N-2', 'person', '가')], [e('N-2', 'N-1', 'performs')]);
  assert.equal(densityGaps(buildView(d), { asOf: ASOF }).status, 'insufficient');
});

test('RL-6: 업무 기간이 끝난 업무는 공백·밀집에서 빼고 개수만 알린다', () => {
  const d = doc('U-W', [n('N-1', 'work', '끝난 업무', { period: { start: '2025-01-01', end: '2025-12-31' } }), n('N-2', 'work', '지금 업무'), n('N-3', 'person', '가')],
    [e('N-3', 'N-2', 'performs')]);
  const r = densityGaps(buildView(d), { asOf: ASOF, n: 1 });
  assert.equal(r.ended_works, 1);
  assert.deepEqual(r.gaps, []);
  assert.equal(r.groups[0].works, 1);
});

test('RL-3: 합쳐진 업무의 다른 유니버스 메모도 인수인계 초안(진행 중·최근 이슈)에 들어간다', () => {
  const a = doc('U-A', [n('N-1', 'work', '정산', { description: 'd' }), n('N-2', 'person', '가', { emp_no: 'V-0001' }), n('N-3', 'person', '나', { emp_no: 'V-0002' })],
    [e('N-000', 'N-1', 'contains'), e('N-2', 'N-1', 'performs')], [],
    { refs: [{ child_universe_id: 'U-B' }], identity_links: [{ id: 'I-1', a: 'U-A/N-1', b: 'U-B/N-1', kind: 'work', method: 'human', status: 'confirmed', decided_by: 'x', decided_at: S }] });
  const b = doc('U-B', [n('N-1', 'work', '정산')], [], [
    memo('E-1', '2026-09-10', S, 'N-1', 'in_progress', 'B쪽 진행중 메모'),
    memo('E-2', '2026-09-11', S, 'N-1', null, 'B쪽 이슈 메모')]);
  const v = buildView(a, (id) => (id === 'U-B' ? b : null));
  const items = buildHandoverDraft(v, { target: 'U-A/N-1', from: 'U-A/N-2', to: 'U-A/N-3' }).draft.items;
  const texts = (key) => items.find((i) => i.key === key).sentences.map((s) => s.text).join(' ');
  assert.ok(texts('진행_중').includes('B쪽 진행중 메모'));
  assert.ok(texts('최근_이슈').includes('B쪽 이슈 메모'));
});

test('RL-4: 같은 날 "해결됨" 다음에 기록한 "진행 중"은 진행 중인 일에 남는다', () => {
  const d = doc('U-M', [n('N-1', 'work', 'W', { description: 'd' }), n('N-2', 'person', '가'), n('N-3', 'person', '나')], [e('N-000', 'N-1', 'contains')], [
    memo('E-1', '2026-09-20', '2026-09-20T09:00:00+09:00', 'N-1', 'resolved', '이전 건 해결'),
    memo('E-2', '2026-09-20', '2026-09-20T15:00:00+09:00', 'N-1', 'in_progress', '새로 생긴 건')]);
  const items = buildHandoverDraft(buildView(d), { target: 'U-M/N-1', from: 'U-M/N-2', to: 'U-M/N-3' }).draft.items;
  assert.ok(items.find((i) => i.key === '진행_중').sentences.some((s) => s.text.includes('새로 생긴 건')));
});

test('이력 문구: 위층에 드러내기 수정은 내부 이름(exposed)·true/false 대신 우리말로', async () => {
  const { updateNode } = await import('../app/src/model/commands.js');
  const { SAMPLE_EVENT } = await import('../app/data/sample-event.js');
  const { eventText } = await import('../app/src/view/describe.js');
  const r = updateNode(SAMPLE_EVENT, 'N-201', { exposed: false }, { now: '2026-10-02T10:00:00+09:00' });
  const v = buildView(r.doc);
  assert.equal(eventText(v, v.events[v.events.length - 1]), '수정 — 위층에 드러내기: (없음) → 아니요');
});
