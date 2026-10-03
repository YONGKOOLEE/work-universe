// T-11 밀집/공백(D-08, R-05 ① ② ③)
import { test } from 'node:test';
import { allSamples, viewOf } from './helpers.js';
import assert from 'node:assert/strict';
import { SAMPLE_A1 } from '../app/data/sample-a1.js';
import { SAMPLE_CARD } from '../app/data/sample-card.js';
import { SAMPLE_TEAM } from '../app/data/sample-team.js';
import { SAMPLE_EVENT } from '../app/data/sample-event.js';
import { SAMPLE_DEPT } from '../app/data/sample-dept.js';
import { ANSWERS_V1 } from '../app/data/answers-v1.js';
import { hideEdge, hideNode } from '../app/src/model/commands.js';
import { densityGaps, DENSE_DEFAULT_N, personLoad } from '../app/src/rules/insight.js';

const all = allSamples(); // T-13: 부서(U-D1)는 교육팀(U-C)까지 포함
const ASOF = '2026-10-02';
const now = { now: '2026-10-01T10:00:00+09:00' };

test('정답 표 DG-*: 공백·밀집 결과가 일치한다', () => {
  for (const a of ANSWERS_V1.density_gaps) {
    const r = densityGaps(viewOf(a.view), { asOf: a.asOf, n: a.n });
    assert.equal(r.status, a.status, a.id);
    assert.deepEqual(r.gaps.map((g) => `${g.gid}:${g.kind}`).sort(), [...a.gaps].sort(), a.id);
    assert.deepEqual(r.dense.map((p) => p.gid), a.dense, a.id);
  }
});

test('월말 정산: 서하늘만 현재 담당, 자료 수집·보고는 담당 기록 없음(공백)', () => {
  const r = densityGaps(viewOf('U-A1'), { asOf: ASOF });
  assert.equal(r.groups.length, 1);
  assert.deepEqual(r.groups[0], { universe_id: 'U-A1', name: SAMPLE_A1.universe.name, insufficient: false, works: 3, people: 1, gaps: 2, dense: 0 });
  assert.ok(r.gaps.every((g) => g.kind === 'never' && g.last_person === null));
});

test('기준일이 바뀌면 현재 담당 판정이 바뀐다(인수인계 전에는 윤바다)', () => {
  const v = viewOf('U-A1');
  const before = densityGaps(v, { asOf: '2026-09-15', n: 1 });
  assert.deepEqual(before.dense.map((p) => p.label), ['윤바다']);
  const after = densityGaps(v, { asOf: ASOF, n: 1 });
  assert.deepEqual(after.dense.map((p) => p.label), ['서하늘']);
});

test('끝난 업무(2025 행사)는 "이전 담당자만 있음"으로 마지막 담당자·종료일과 함께 나온다', () => {
  const r = densityGaps(viewOf('U-B'), { asOf: ASOF });
  const g = r.gaps.find((x) => x.gid === 'U-B/N-101');
  assert.equal(g.kind, 'ended');
  assert.equal(g.last_person.label, '윤바다');
  assert.equal(g.last_end, '2025-12-15');
  assert.deepEqual(g.evidence_ids, ['U-B/N-101', g.last_person.gid]);
});

test('밀집 N 조정: 도하람(3개)은 N=3이면 나오고 N=4면 안 나온다', () => {
  const v = viewOf('U-B');
  const r3 = densityGaps(v, { asOf: ASOF, n: 3 });
  assert.deepEqual(r3.dense.map((p) => [p.label, p.count]), [['도하람', 3]]);
  assert.equal(r3.dense[0].evidence_ids.length, 4); // 사람 + 업무 3
  const r4 = densityGaps(v, { asOf: ASOF, n: 4 });
  assert.deepEqual(r4.dense, []);
  assert.equal(r4.status, 'ok'); // 공백(2025 행사)은 남는다
});

test('N이 잘못되면 1 이상 정수로 고치거나 기본값을 쓴다', () => {
  const v = viewOf('U-B');
  assert.equal(densityGaps(v, { asOf: ASOF, n: 0 }).n, DENSE_DEFAULT_N);
  assert.equal(densityGaps(v, { asOf: ASOF, n: -2 }).n, 1);
  assert.equal(densityGaps(v, { asOf: ASOF, n: 2.7 }).n, 2);
  assert.equal(densityGaps(v, { asOf: ASOF, n: 'x' }).n, DENSE_DEFAULT_N);
});

test('상위 업무가 비어 있으면 하위 업무 중 담당자가 있는 수를 함께 준다(카드승인 「승인」)', () => {
  const r = densityGaps(viewOf('U-K1'), { asOf: ASOF });
  const g = r.gaps.find((x) => x.label === '승인');
  assert.equal(g.children, 4);
  assert.equal(g.children_covered, 2);
});

test('부서 화면: 유니버스(조직)별로 집계하고 업무가 없는 꼭지 유니버스는 뺀다', () => {
  const r = densityGaps(viewOf('U-D1'), { asOf: ASOF, n: 2 });
  // T-13: 교육팀(U-C)이 부서에 들어와 한 줄 늘었다
  assert.deepEqual(r.groups.map((g) => g.universe_id).sort(), ['U-A1', 'U-B', 'U-C', 'U-K1']);
  const b = r.groups.find((g) => g.universe_id === 'U-B');
  assert.deepEqual([b.works, b.people, b.gaps, b.dense], [4, 1, 1, 1]);
  // T-13: 교육팀 이든빛도 2개(신입 교육 운영, 강의실·강사 섭외)를 맡아 N=2 밀집에 든다
  assert.deepEqual(r.dense.map((p) => p.label), ['도하람', '운영 담당', '이든빛']);
});

test('오류(R-05 ②): 수행 연결이 없는 유니버스 → 데이터 부족과 마지막 입력 시점만', () => {
  let doc = SAMPLE_EVENT;
  for (const e of SAMPLE_EVENT.edges.filter((x) => x.core_type === 'performs')) doc = hideEdge(doc, e.id, now).doc;
  const r = densityGaps(viewOf('U-B', { 'U-B': doc }), { asOf: ASOF });
  assert.equal(r.status, 'insufficient');
  assert.ok(r.reason.includes('담당자'));
  assert.ok(r.last_input);
  assert.deepEqual([r.gaps, r.dense, r.groups], [[], [], []]);
});

test('오류(R-05 ②): 부서 화면에서 한 유니버스만 수행 연결이 없으면 그 조직만 데이터 부족이고 공백 목록에 넣지 않는다', () => {
  let doc = SAMPLE_CARD;
  for (const e of SAMPLE_CARD.edges.filter((x) => x.core_type === 'performs')) doc = hideEdge(doc, e.id, now).doc;
  const r = densityGaps(viewOf('U-D1', { 'U-K1': doc }), { asOf: ASOF });
  const k = r.groups.find((g) => g.universe_id === 'U-K1');
  assert.equal(k.insufficient, true);
  assert.equal(k.gaps, 0);
  assert.ok(!r.gaps.some((g) => g.universe_id === 'U-K1'));
  assert.ok(r.gaps.some((g) => g.universe_id === 'U-A1'));
});

test('숨긴 업무·숨긴 사람은 세지 않는다', () => {
  const noWork = hideNode(SAMPLE_EVENT, 'N-102', now).doc; // 2026 행사
  const r1 = densityGaps(viewOf('U-B', { 'U-B': noWork }), { asOf: ASOF, n: 3 });
  assert.deepEqual(r1.dense, []);
  assert.equal(r1.groups[0].works, 3);
  const noPerson = hideNode(SAMPLE_EVENT, 'N-201', now).doc; // 도하람
  const r2 = densityGaps(viewOf('U-B', { 'U-B': noPerson }), { asOf: ASOF });
  assert.deepEqual(r2.dense, []);
  assert.equal(r2.gaps.length, 4);
});

test('모든 근거 ID가 실제 데이터에 있다(R-05 ①)', () => {
  for (const id of Object.keys(all)) {
    const v = viewOf(id);
    const r = densityGaps(v, { asOf: ASOF, n: 1 });
    for (const x of [...r.gaps, ...r.dense]) for (const g of x.evidence_ids) assert.ok(v.lookup(g).found, `${id} ${g}`);
  }
});

test('사람 상세의 한 줄(personLoad): 도하람 3개 → 밀집 기준 3에 해당, 4면 아래, 밀집 목록과 같은 판정', () => {
  const v = viewOf('U-D1');
  const gid = v.canonical('U-B/N-201');
  const l3 = personLoad(v, gid, { asOf: ASOF, n: 3 });
  assert.deepEqual([l3.count, l3.n, l3.dense], [3, 3, true]);
  assert.equal(personLoad(v, gid, { asOf: ASOF, n: 4 }).dense, false);
  for (const n of [1, 2, 3, 4]) {
    const dense = densityGaps(v, { asOf: ASOF, n }).dense.map((p) => p.gid);
    for (const p of v.nodes.filter((x) => x.core_type === 'person' && !x.hidden)) {
      assert.equal(personLoad(v, p.gid, { asOf: ASOF, n }).dense, dense.includes(p.gid), `${p.label} n=${n}`);
    }
  }
});

test('personLoad: 끝난 담당만 있으면 0개, 사람이 아니거나 숨긴 사람이면 null', () => {
  const v = viewOf('U-B');
  assert.deepEqual(personLoad(v, 'U-B/N-202', { asOf: ASOF }).count, 0); // 윤바다(2025 행사 종료)
  assert.equal(personLoad(v, 'U-B/N-101', { asOf: ASOF }), null);
  const hidden = hideNode(SAMPLE_EVENT, 'N-201', now).doc;
  assert.equal(personLoad(viewOf('U-B', { 'U-B': hidden }), 'U-B/N-201', { asOf: ASOF }), null);
});
