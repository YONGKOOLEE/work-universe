import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_A1 } from '../app/data/sample-a1.js';
import { SAMPLE_CARD } from '../app/data/sample-card.js';
import { SAMPLE_TEAM } from '../app/data/sample-team.js';
import { SAMPLE_EVENT } from '../app/data/sample-event.js';
import { SAMPLE_DEPT } from '../app/data/sample-dept.js';
import { ANSWERS_V1 } from '../app/data/answers-v1.js';
import { hideNode } from '../app/src/model/commands.js';
import { validateDocument } from '../app/src/model/validate.js';
import { buildView } from '../app/src/view/view.js';
import { isCurrent, similarExperts, similarSentences } from '../app/src/rules/insight.js';
import { buildHandoverDraft } from '../app/src/rules/handover.js';

const all = { 'U-A1': SAMPLE_A1, 'U-K1': SAMPLE_CARD, 'U-T1': SAMPLE_TEAM, 'U-B': SAMPLE_EVENT, 'U-D1': SAMPLE_DEPT };
const viewOf = (id, override = {}) => buildView(override[id] || all[id], (x) => override[x] || all[x] || null);
const ASOF = '2026-10-02';

test('사례 2와 부서 샘플은 검증을 통과한다', () => {
  for (const d of [SAMPLE_EVENT, SAMPLE_DEPT]) assert.deepEqual(validateDocument(d).errors, [], d.universe.id);
});

test('"대사 확인"의 유사 경험자는 윤바다이고 근거가 붙는다(정답 표 SE-1, R-05 ① ④)', () => {
  const se = ANSWERS_V1.similar_experts.find((x) => x.id === 'SE-1');
  const r = similarExperts(viewOf(se.view), { works: [se.work], asOf: se.asOf });
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.people.map((p) => p.gid), se.expected);
  const p = r.people.find((x) => x.gid === 'U-A1/N-011');
  assert.equal(p.emp_no, 'V-1002');
  assert.equal(p.works[0].gid, 'U-B/N-101'); // 근거 업무: 2025 행사
  assert.equal(p.works[0].period, '2025-05-01 ~ 2025-12-15');
  assert.deepEqual([...p.evidence_ids].sort(), [...se.evidence['U-A1/N-011']].sort());
  // 모든 사람의 근거 ID가 실제 데이터에 있다
  const v = viewOf(se.view);
  for (const person of r.people) for (const g of person.evidence_ids) assert.ok(v.lookup(g).found, g);
});

test('현재 담당자(서하늘)와 같은 업무만 했던 한가람은 나오지 않는다', () => {
  const r = similarExperts(viewOf('U-D1'), { works: ['U-A1/N-001'], asOf: ASOF });
  assert.deepEqual(r.excluded.map((x) => x.gid), ['U-A1/N-012']);
  const se = ANSWERS_V1.similar_experts.find((x) => x.id === 'SE-1');
  for (const g of [...se.excluded, ...se.not_expected]) assert.ok(!r.people.some((p) => p.gid === g), g);
});

test('기준 날짜에 윤바다가 대사 확인을 담당 중이면 그는 현재 담당자라 제외된다', () => {
  // 2026-07-01: 윤바다(2026-06-01~2026-09-30)가 담당 중
  const r = similarExperts(viewOf('U-D1'), { works: ['U-A1/N-001'], asOf: '2026-07-01' });
  assert.ok(r.excluded.some((x) => x.label === '윤바다'));
  assert.ok(!r.people.some((p) => p.label === '윤바다'));
});

test('이유: 이름만 같은 주제는 연결 확인 전이라고 밝히고, 주제를 직접 이으면 그 표시가 사라진다', () => {
  const people = similarExperts(viewOf('U-D1'), { works: ['U-A1/N-001'], asOf: ASOF }).people;
  const noLink = people.find((p) => p.label === '윤바다').works[0];
  assert.deepEqual(noLink.reasons, ['같은 주제 「대사 불일치」(이름이 같은 주제, 연결 확인 전)']);
  assert.equal(noLink.score, 3);
  // 사람이 확인해 이은 주제(결제운영팀의 카드승인 "대사")는 확인 전 표시가 없다
  assert.deepEqual(people.find((p) => p.label === '운영 담당').works[0].reasons, ['같은 주제 「대사 불일치」']);

  const linked = JSON.parse(JSON.stringify(SAMPLE_DEPT));
  linked.identity_links.push({ id: 'I-002', a: 'U-A1/N-030', b: 'U-B/N-302', kind: 'topic', method: 'human', status: 'confirmed', decided_by: '가상', decided_at: '2026-10-01T10:00:00+09:00' });
  const r = similarExperts(viewOf('U-D1', { 'U-D1': linked }), { works: ['U-A1/N-001'], asOf: ASOF });
  assert.deepEqual(r.people.find((p) => p.label === '윤바다').works[0].reasons, ['같은 주제 「대사 불일치」']);
});

test('비교할 다른 업무가 없으면 "none"(월말 정산만 열었을 때, 정답 표 SE-2)', () => {
  const se = ANSWERS_V1.similar_experts.find((x) => x.id === 'SE-2');
  const r = similarExperts(viewOf(se.view), { works: [se.work], asOf: se.asOf });
  assert.equal(r.status, 'none');
  assert.deepEqual(r.people, []);
});

test('주제·산출물 연결이 없는 업무는 "데이터 부족"이다(정답 표 SE-3, R-05 ②)', () => {
  const se = ANSWERS_V1.similar_experts.find((x) => x.id === 'SE-3');
  const r = similarExperts(viewOf(se.view), { works: [se.work], asOf: se.asOf });
  assert.equal(r.status, 'insufficient');
  assert.match(r.reason, /주제나 산출물/);
  assert.deepEqual(r.people, []);
  assert.equal(similarExperts(viewOf('U-D1'), { works: ['U-A1/N-999'], asOf: ASOF }).status, 'insufficient');
});

test('숨긴 업무·숨긴 사람은 후보에서 빠진다', () => {
  const labelsOf = (override) => similarExperts(viewOf('U-D1', override), { works: ['U-A1/N-001'], asOf: ASOF }).people.map((p) => p.label);
  assert.ok(labelsOf({}).includes('윤바다'));
  const hiddenWork = hideNode(SAMPLE_EVENT, 'N-101', { now: '2026-10-01T10:00:00+09:00' }).doc;
  assert.ok(!labelsOf({ 'U-B': hiddenWork }).includes('윤바다'));
  // 합쳐진 사람은 한쪽 노드만 숨기면 남고, 모든 노드를 숨겨야 후보에서 빠진다
  const now = { now: '2026-10-01T10:00:00+09:00' };
  const hiddenInB = hideNode(SAMPLE_EVENT, 'N-202', now).doc;
  assert.ok(labelsOf({ 'U-B': hiddenInB }).includes('윤바다'));
  const hiddenInA = hideNode(SAMPLE_A1, 'N-011', now).doc;
  assert.ok(!labelsOf({ 'U-B': hiddenInB, 'U-A1': hiddenInA }).includes('윤바다'));
});

test('점수: 주제 3, 산출물 유형 2, 낱말 1. 더 많이 겹치는 업무를 한 사람이 위로 온다', () => {
  // 카드승인의 "정합성 조치"와 월말 정산 "대사 확인": 둘 다 대사 주제를 다룬다. 카드승인 쪽 업무는 담당자 이름이 역할이다
  const r = similarExperts(viewOf('U-D1'), { works: ['U-A1/N-001'], asOf: ASOF });
  assert.deepEqual(r.people.map((p) => [p.label, p.score]), [['운영 담당', 3], ['윤바다', 3], ['정산 담당', 3]]); // 점수가 같으면 이름순
  assert.deepEqual(r.people.map((p) => p.score), [...r.people.map((p) => p.score)].sort((a, b) => b - a));
  // 산출물 유형이 겹치면 점수가 오른다: 기준 업무가 "인수인계서" 산출물을 만들고, 다른 업무도 같은 유형을 만들면 +2
  const more = JSON.parse(JSON.stringify(SAMPLE_EVENT));
  more.universe.subtypes = [{ core_type: 'artifact', name: '인수인계서' }];
  more.nodes.push({ id: 'N-401', core_type: 'artifact', subtype: '인수인계서', label: '2025 행사 인수인계서', hidden: false });
  more.edges.push({ id: 'L-050', source: 'N-101', target: 'N-401', core_type: 'produces', hidden: false });
  const boosted = similarExperts(viewOf('U-D1', { 'U-B': more }), { works: ['U-A1/N-001'], asOf: ASOF }).people;
  assert.deepEqual(boosted.map((p) => [p.label, p.score]), [['윤바다', 5], ['운영 담당', 3], ['정산 담당', 3]]);
  assert.match(boosted[0].works[0].reasons.join(' '), /같은 산출물 유형 「인수인계서」/);
});

test('날짜 비교: 기간 안에서만 현재 담당이다', () => {
  assert.equal(isCurrent({ start: '2026-06-01', end: '2026-09-30' }, '2026-07-01'), true);
  assert.equal(isCurrent({ start: '2026-06-01', end: '2026-09-30' }, '2026-10-01'), false);
  assert.equal(isCurrent({ start: '2026-10-01' }, '2026-09-30'), false);
  assert.equal(isCurrent({ start: '2026-10-01' }, '2026-12-01'), true);
  assert.equal(isCurrent(undefined, '2026-12-01'), true);
});

test('인수인계 초안의 "유사 경험자" 항목: 근거가 있는 문장이 나오고 받는 사람은 뺀다', () => {
  const v = viewOf('U-D1');
  const sim = similarExperts(v, { works: ['U-A1/N-001'], asOf: ASOF, exclude: ['U-A1/N-012'] });
  const draft = buildHandoverDraft(v, { target: 'U-A1/N-001', from: 'U-A1/N-011', to: 'U-A1/N-012', similar: similarSentences(sim) }).draft;
  const item = draft.items.find((i) => i.key === '유사_경험자');
  assert.equal(item.insufficient, false);
  const mine = item.sentences.find((s) => s.text.startsWith('윤바다'));
  assert.match(mine.text, /^윤바다\(V-1002\) — 「2025 행사」 2025-05-01 ~ 2025-12-15 수행\. 같은 주제 「대사 불일치」/);
  for (const s of item.sentences) {
    assert.ok(s.evidence_ids.length > 0);
    for (const g of s.evidence_ids) assert.ok(v.lookup(g).found, g);
  }
  // 월말 정산만 열면 이력 부족(T-07 정답 표와 같음)
  const solo = viewOf('U-A1');
  const none = buildHandoverDraft(solo, { target: 'U-A1/N-000', from: 'U-A1/N-011', to: 'U-A1/N-012', similar: similarSentences(similarExperts(solo, { works: ['U-A1/N-001'], asOf: ASOF })) }).draft;
  assert.equal(none.items.find((i) => i.key === '유사_경험자').insufficient, true);
});
