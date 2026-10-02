import { test } from 'node:test';
import { SAMPLES } from '../app/data/index.js';
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

const all = Object.fromEntries(SAMPLES.map((d) => [d.universe.id, d])); // T-13: 부서(U-D1)는 교육팀(U-C)까지 포함
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
  // 산출물 유형이 겹치면 점수가 오른다: 기준 업무(대사 확인)가 「정산표」 산출물을 만들고, 다른 업무도 같은 유형을 만들면 +2
  const a1 = JSON.parse(JSON.stringify(SAMPLE_A1));
  a1.universe.subtypes.push({ core_type: 'artifact', name: '정산표' });
  a1.nodes.find((n) => n.id === 'N-021').subtype = '정산표';
  a1.edges.push({ id: 'L-090', source: 'N-001', target: 'N-021', core_type: 'produces', hidden: false });
  const more = JSON.parse(JSON.stringify(SAMPLE_EVENT));
  more.universe.subtypes = [{ core_type: 'artifact', name: '정산표' }, { core_type: 'artifact', name: '인수인계서' }];
  more.nodes.push({ id: 'N-401', core_type: 'artifact', subtype: '정산표', label: '행사 정산표', hidden: false });
  more.edges.push({ id: 'L-050', source: 'N-101', target: 'N-401', core_type: 'produces', hidden: false });
  const boosted = similarExperts(viewOf('U-D1', { 'U-A1': a1, 'U-B': more }), { works: ['U-A1/N-001'], asOf: ASOF }).people;
  assert.deepEqual(boosted.map((p) => [p.label, p.score]), [['윤바다', 5], ['운영 담당', 3], ['정산 담당', 3]]);
  assert.match(boosted[0].works[0].reasons.join(' '), /같은 산출물 유형 「정산표」/);
  // T-13: 「인수인계서」는 어떤 업무든 인계 때 생기므로 같아도 점수를 주지 않는다(GENERIC_ARTIFACT_TYPES)
  const handoverOnly = JSON.parse(JSON.stringify(SAMPLE_EVENT));
  handoverOnly.universe.subtypes = [{ core_type: 'artifact', name: '인수인계서' }];
  handoverOnly.nodes.push({ id: 'N-401', core_type: 'artifact', subtype: '인수인계서', label: '2025 행사 인수인계서', hidden: false });
  handoverOnly.edges.push({ id: 'L-050', source: 'N-101', target: 'N-401', core_type: 'produces', hidden: false });
  const same = similarExperts(viewOf('U-D1', { 'U-B': handoverOnly }), { works: ['U-A1/N-001'], asOf: ASOF }).people;
  assert.equal(same.find((p) => p.label === '윤바다').score, 3);
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

// ── 반복 비효율(T-11, R-05 ⑤) ──

import { repeatInefficiency } from '../app/src/rules/insight.js';
import { addEvent, addEdge, addNode, createUniverse } from '../app/src/model/commands.js';

const T0 = { now: '2026-10-02T10:00:00+09:00' };

test('반복 비효율 ①: 인수인계가 두 번인데 두 번째가 이전 인수인계서를 이어받지 않았다(정답 표 RI-A1-1)', () => {
  const ri = ANSWERS_V1.repeat_inefficiency[0];
  const r = repeatInefficiency(viewOf('U-A1'));
  assert.equal(r.status, 'ok');
  const p = r.patterns.find((x) => x.kind === 'handover_chain');
  assert.equal(p.work.gid, ri.work);
  assert.deepEqual([...p.evidence_ids].sort(), [...ri.evidence].sort());
  assert.deepEqual([p.total, p.missed], [2, 1]);
  assert.match(p.steps[0].text, /^2026-06-01 한가람 → 윤바다 \(인수인계서: 2026-06 인수인계서\)$/);
  assert.match(p.steps[1].text, /^2026-09-30 윤바다 → 서하늘 \(인수인계서 없음\) — 이전 인수인계서를 이어받지 않음$/);
  assert.match(p.summary, /인수인계 2회 중 1회가 이전 인수인계서를 이어받지 않아/);
});

test('이전 인수인계를 가리키면(previous_handover_id) 반복으로 보지 않는다', () => {
  const doc = JSON.parse(JSON.stringify(SAMPLE_A1));
  doc.events.find((e) => e.id === 'E-007').payload.previous_handover_id = 'E-002';
  assert.ok(!repeatInefficiency(buildView(doc)).patterns.some((p) => p.kind === 'handover_chain'));
});

test('같은 인수인계서를 이어서 쓰거나, 새 인수인계서가 이전 것을 참조해도 이어받은 것이다', () => {
  const same = JSON.parse(JSON.stringify(SAMPLE_A1));
  same.events.find((e) => e.id === 'E-007').payload.artifact_id = 'N-020';
  assert.ok(!repeatInefficiency(buildView(same)).patterns.some((p) => p.kind === 'handover_chain'));

  let doc = addNode(SAMPLE_A1, { core_type: 'artifact', subtype: '인수인계서', label: '2026-09 인수인계서' }, T0).doc;
  const art = doc.nodes.at(-1).id;
  doc = addEdge(doc, { source: art, target: 'N-020', core_type: 'references' }, T0).doc;
  doc.events.find((e) => e.id === 'E-007').payload.artifact_id = art;
  assert.ok(!repeatInefficiency(buildView(doc)).patterns.some((p) => p.kind === 'handover_chain'));
});

test('인수인계가 세 번이면 이어받지 않은 횟수를 센다', () => {
  let doc = JSON.parse(JSON.stringify(SAMPLE_A1));
  doc = addEvent(doc, { type: 'handover', occurred_at: '2026-12-01', payload: { work_id: 'N-001', from_person_id: 'N-012', to_person_id: 'N-010', previous_handover_id: 'E-007' } }, T0).doc;
  const p = repeatInefficiency(buildView(doc)).patterns.find((x) => x.kind === 'handover_chain');
  assert.deepEqual([p.total, p.missed], [3, 1]); // 두 번째만 이어받지 않음
  assert.equal(p.steps[2].referenced, true);
  assert.equal(p.evidence_ids.length, 3);
});

test('반복 비효율 ②: 같은 주제가 여러 업무에서 반복되면 근거와 함께 나온다(부서 화면)', () => {
  const r = repeatInefficiency(viewOf('U-D1'));
  // T-13: 교육팀의 「강의실 부족」도 주제 반복으로 잡히므로 대사 불일치 패턴을 이름으로 찾는다
  assert.ok(r.patterns.some((x) => x.kind === 'topic_repeat' && x.topic.label === '강의실 부족'));
  const t = r.patterns.find((x) => x.kind === 'topic_repeat' && x.topic.label === '대사 불일치');
  assert.deepEqual(t.works.map((w) => w.label).sort(), ['2025 행사', '거래 조회', '대사 확인', '망취소']);
  const v = viewOf('U-D1');
  for (const g of t.evidence_ids) assert.ok(v.lookup(g).found || v.events.some((e) => e.gid === g), g);
  assert.match(t.summary, /4개 업무에서 반복됩니다/);
  // 월말 정산 하나만 보면 한 업무에서만 나오므로 주제 반복은 없다
  assert.ok(!repeatInefficiency(viewOf('U-A1')).patterns.some((x) => x.kind === 'topic_repeat'));
});

test('데이터 부족: 인수인계·메모 기록이 2건 미만이면 결론 없이 마지막 입력 시점만 보인다(R-05 ②)', () => {
  let doc = createUniverse({ name: '신규 교육 과정', level: '업무', owner: '가상교육팀' }, T0).doc;
  let r = repeatInefficiency(buildView(doc));
  assert.equal(r.status, 'insufficient');
  assert.deepEqual(r.patterns, []);
  // 검토3 RULES-1: 생성·수정 같은 시스템 이력은 '입력'이 아니다 → 업무 이력이 없으면 마지막 입력도 없음
  assert.equal(r.last_input, null);
  doc = addNode(doc, { core_type: 'work', label: '교육 안내' }, T0).doc;
  doc = addEvent(doc, { type: 'memo', occurred_at: '2026-10-02', payload: { target_id: doc.nodes.at(-1).id }, note: '첫 메모' }, T0).doc;
  r = repeatInefficiency(buildView(doc));
  assert.equal(r.status, 'insufficient'); // 메모 1건뿐
  doc = addEvent(doc, { type: 'memo', occurred_at: '2026-10-03', payload: { target_id: doc.nodes.at(-1).id }, note: '둘째 메모' }, T0).doc;
  assert.equal(repeatInefficiency(buildView(doc)).status, 'none'); // 기록은 충분하지만 반복이 없음
});

test('숨긴 업무의 기록은 반복 계산에서 빠진다', async () => {
  const { hideNode } = await import('../app/src/model/commands.js');
  const hidden = hideNode(SAMPLE_A1, 'N-001', T0).doc;
  const r = repeatInefficiency(buildView(hidden));
  assert.ok(!r.patterns.some((p) => p.kind === 'handover_chain'));
});
