// 2026-10-03 세 번째 전체 검토(규칙 RULES-1·2·3·5·6) 재발 방지
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allSamples, viewOf, mkNode as n, mkEdge as e, FIXTURE_TS as S } from './helpers.js';
import { updateNode } from '../app/src/model/commands.js';
import { buildView } from '../app/src/view/view.js';
import { flowChange, lastInput } from '../app/src/rules/flow.js';
import { densityGaps, personLoad, repeatInefficiency, repeatPatternsFor, workLoad } from '../app/src/rules/insight.js';
import { densityExplain } from '../app/src/rules/explain.js';
import { describeNode } from '../app/src/view/describe.js';

const all = allSamples();
const ASOF = '2026-10-03';
const ctx = { now: '2026-10-03T09:00:00+09:00' };

test('RULES-1: 설명 오타를 고친 수정 이력은 "입력"이 아니다 — 조직관리의 입력 중단 기간이 그대로 데이터 부족', () => {
  const edited = updateNode(all['U-O'], 'N-001', { description: '가상본부(오타 수정)' }, ctx).doc;
  const v = viewOf('U-O', { 'U-O': edited });
  const r = flowChange(v, { asOf: ASOF });
  assert.equal(r.last_input, '2026-03-10');
  assert.ok(r.no_data_periods >= 7);
  assert.equal(lastInput(v, ASOF), '2026-03-10');
  assert.equal(densityGaps(v, { asOf: ASOF }).last_input, '2026-03-10');
});

test('RULES-2: 반복 비효율은 기준일까지의 기록만 본다(2026-03에는 아직 인수인계가 없다)', () => {
  const v = viewOf('U-A1');
  assert.notEqual(repeatInefficiency(v, { asOf: '2026-03-31' }).status, 'ok');
  assert.equal(repeatPatternsFor(v, 'U-A1/N-001', '2026-03-31').length, 0);
  assert.equal(repeatPatternsFor(v, 'U-A1/N-001', ASOF).length, 1);
  assert.equal(repeatInefficiency(v).status, 'ok'); // 기준일이 없으면 전체
});

// 업무 기간이 끝났는데 수행 연결은 열려 있는 경우, 시작 전 업무
const doc = (nodes, edges) => ({ schema_version: '1.0', universe: { id: 'U-R', name: 'R', level: '팀', root_node_id: 'N-000', subtypes: [], created_at: S }, nodes: [n('N-000', 'root', 'R'), ...nodes], edges, events: [], refs: [], identity_links: [] });

test('RULES-3: 기간이 끝난 업무는 사람의 "맡은 업무"에서도 빠진다(밀집·공백·흐름과 같은 기준), 사유도 구분', () => {
  const v = buildView(doc([n('N-1', 'work', '끝난 일', { period: { start: '2026-01-01', end: '2026-06-30' } }), n('N-2', 'person', '가')], [e('N-2', 'N-1', 'performs', { period: { start: '2026-01-01' } })]));
  const load = personLoad(v, 'U-R/N-2', { asOf: ASOF, n: 1 });
  assert.deepEqual([load.count, load.dense], [0, false]);
  const d = densityGaps(v, { asOf: ASOF, n: 1 });
  assert.equal(d.status, 'insufficient');
  assert.match(d.reason, /기간이 끝났거나 시작 전/);
});

test('RULES-5: 시작 전 업무는 공백·업무 수에 넣지 않고 따로 센다, 업무 상세는 "시작 전 업무"', () => {
  const v = buildView(doc([n('N-1', 'work', '지금 일'), n('N-3', 'work', '신규 과제', { period: { start: '2026-12-01' } }), n('N-2', 'person', '가')], [e('N-2', 'N-1', 'performs')]));
  const d = densityGaps(v, { asOf: ASOF });
  assert.equal(d.scheduled_works, 1);
  assert.ok(!d.gaps.some((g) => g.gid === 'U-R/N-3'));
  assert.equal(d.groups[0].works, 1);
  const w = workLoad(v, 'U-R/N-3', { asOf: ASOF });
  assert.equal(w.work_scheduled, true);
  assert.equal(w.work_start, '2026-12-01');
});

test('RULES-6: 밀집·공백 설명 문장에 "지금"이 없고, 마지막 입력은 기준일까지의 기록', () => {
  const v = viewOf('U-D1');
  const req = densityExplain(densityGaps(v, { asOf: ASOF }), 'U-D1');
  assert.ok(req.rule.every((s) => !s.text.includes('지금')));
  assert.equal(densityGaps(viewOf('U-A1'), { asOf: '2025-06-30' }).last_input, '2025-03-01');
});

test('UI-5: 지난 날짜로 보면 수행 연결 표시가 "그때 담당"(오늘이면 "현재")', () => {
  const v = viewOf('U-A1');
  const past = describeNode(v, 'U-A1/N-001', { asOf: '2025-06-30', past: true }).links.filter((l) => l.relation_type === 'performs');
  assert.equal(past.find((l) => l.other.label === '한가람').status, '그때 담당');
  assert.equal(past.find((l) => l.other.label === '한가람').status_key, 'current');
  const now = describeNode(v, 'U-A1/N-001', { asOf: ASOF }).links.filter((l) => l.relation_type === 'performs');
  assert.equal(now.find((l) => l.other.label === '서하늘').status, '현재');
});
