import { test } from 'node:test';
import { allSamples, mkDoc, mkEdge, mkNode, viewOf } from './helpers.js';
import assert from 'node:assert/strict';
import { SAMPLE_A1 } from '../app/data/sample-a1.js';
import { SAMPLE_CARD } from '../app/data/sample-card.js';
import { SAMPLE_TEAM } from '../app/data/sample-team.js';
import { SAMPLE_EVENT } from '../app/data/sample-event.js';
import { SAMPLE_DEPT } from '../app/data/sample-dept.js';
import { ANSWERS_V1 } from '../app/data/answers-v1.js';
import { addEdge, addEvent, addNode, createUniverse, hideNode } from '../app/src/model/commands.js';
import { validateDocument } from '../app/src/model/validate.js';
import { buildView } from '../app/src/view/view.js';
import { WEIGHTS, isCurrent, repeatInefficiency, similarExperts, similarSentences } from '../app/src/rules/insight.js';
import { buildHandoverDraft } from '../app/src/rules/handover.js';

const all = allSamples(); // T-13: 부서(U-D1)는 교육팀(U-C)까지 포함
const ASOF = '2026-10-02';

test('사례 2와 부서 샘플은 검증을 통과한다', () => {
  for (const d of [SAMPLE_EVENT, SAMPLE_DEPT]) assert.deepEqual(validateDocument(d).errors, [], d.universe.id);
});

test('"대사 확인"의 유사 경험자는 윤바다이고 근거가 붙는다(정답 표 SE-1, R-05 ① ④)', () => {
  // CR-17 B로 기대값 변경(2026-10-24): 역할 이름 노드(운영 담당·정산 담당)는 사람 목록에서 roles로 분리됐다
  const se = ANSWERS_V1.similar_experts.find((x) => x.id === 'SE-1');
  const r = similarExperts(viewOf(se.view), { works: [se.work], asOf: se.asOf });
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.people.map((p) => p.gid), se.expected);
  assert.deepEqual(r.roles.map((p) => p.gid), se.expected_roles);
  const p = r.people.find((x) => x.gid === 'U-A1/N-011');
  assert.equal(p.emp_no, 'V-1002');
  assert.equal(p.works[0].gid, 'U-B/N-101'); // 근거 업무: 2025 행사
  assert.equal(p.works[0].period, '2025-05-01 ~ 2025-12-15');
  assert.deepEqual([...p.evidence_ids].sort(), [...se.evidence['U-A1/N-011']].sort());
  // 모든 사람의 근거 ID가 실제 데이터에 있다
  const v = viewOf(se.view);
  for (const person of [...r.direct, ...r.people, ...r.roles]) for (const g of person.evidence_ids) assert.ok(v.lookup(g).found, g);
});

// ── CR-17 B: 「직접 해 본 사람」·역할 이름 분리·이름 낱말 후보 ──
test('B ①: 기준 업무의 이전 담당(윤바다·한가람)이 「직접 해 봄」 묶음으로 맨 위에 오고, 기간과 이유가 붙는다', () => {
  const se = ANSWERS_V1.similar_experts.find((x) => x.id === 'SE-1');
  const r = similarExperts(viewOf('U-D1'), { works: ['U-A1/N-001'], asOf: ASOF });
  assert.deepEqual(r.direct.map((p) => p.gid), se.expected_direct); // 최근에 끝난 순: 윤바다(2026-09-30) → 한가람(2026-05-31)
  const [yun, han] = r.direct;
  assert.deepEqual(yun.direct_works.map((d) => [d.gid, d.period, d.reason]), [['U-A1/N-001', '2026-06-01 ~ 2026-09-30', '이 업무를 직접 해 봄(2026-06-01 ~ 2026-09-30)']]);
  assert.equal(han.direct_works[0].period, '2025-03-01 ~ 2026-05-31');
  assert.deepEqual(han.works, []); // 한가람은 다른 업무를 한 적이 없어 비슷한 일 줄이 없다
  assert.equal(yun.works[0].gid, 'U-B/N-101'); // 윤바다는 비슷한 일(2025 행사)도 센다
  assert.ok(yun.evidence_ids.includes('U-A1/N-001') && yun.evidence_ids.includes('U-A1/N-011'));
  // 현재 담당자(서하늘)는 직접 해 본 사람이 아니라 제외 대상이다
  assert.ok(![...r.direct, ...r.people, ...r.roles].some((p) => p.gid === 'U-A1/N-012'));
  // 기준일이 윤바다 담당 중이면 그는 직접 해 본 사람이 아니라 현재 담당자다(앞의 제외 규칙 그대로)
  const mid = similarExperts(viewOf('U-D1'), { works: ['U-A1/N-001'], asOf: '2026-07-01' });
  assert.deepEqual(mid.direct.map((p) => p.label), ['한가람']);
  // exclude로 뺀 사람은 직접 해 본 사람에도 나오지 않는다
  const ex = similarExperts(viewOf('U-D1'), { works: ['U-A1/N-001'], asOf: ASOF, exclude: ['U-A1/N-011'] });
  assert.deepEqual(ex.direct.map((p) => p.label), ['한가람']);
});

test('B ①: 같은 업무를 두 번 맡았으면 기간을 이어 보이고 한 줄이며, 아직 시작 전인 담당은 직접 해 본 것이 아니다', () => {
  const v = buildView(mkDoc('U-B1', [mkNode('W1', 'work', '대사 확인'), mkNode('P1', 'person', '가상갑', { emp_no: 'V-9101' }), mkNode('P2', 'person', '가상을', { emp_no: 'V-9102' })],
    [mkEdge('P1', 'W1', 'performs', { period: { start: '2025-01-01', end: '2025-06-30' } }), mkEdge('P1', 'W1', 'performs', { period: { start: '2026-01-01', end: '2026-03-31' } }),
      mkEdge('P2', 'W1', 'performs', { period: { start: '2027-01-01' } })]));
  const r = similarExperts(v, { works: ['U-B1/W1'], asOf: ASOF });
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.direct.map((p) => p.label), ['가상갑']); // 가상을은 시작 예정
  assert.equal(r.direct[0].direct_works.length, 1);
  assert.equal(r.direct[0].direct_works[0].period, '2025-01-01 ~ 2025-06-30, 2026-01-01 ~ 2026-03-31');
  assert.deepEqual([r.people, r.roles], [[], []]);
});

test('B ②: 역할 이름 노드(하위 유형 「역할」)는 사람 목록에서 빠지고 roles로 분리된다', () => {
  const r = similarExperts(viewOf('U-D1'), { works: ['U-A1/N-001'], asOf: ASOF });
  assert.deepEqual(r.roles.map((p) => p.label), ['운영 담당', '정산 담당']);
  assert.ok(r.roles.every((p) => viewOf('U-D1').getNode(p.gid).subtype === '역할'));
  assert.ok(!r.people.some((p) => ['운영 담당', '정산 담당'].includes(p.label)));
  // 역할 이름만 나오는 업무도 결과 없음이 아니다(status ok, roles만)
  const only = similarExperts(viewOf('U-D1'), { works: ['U-K1/N-101'], asOf: ASOF });
  assert.equal(only.status, 'ok');
  assert.deepEqual([only.direct.length, only.people.length, only.roles.length > 0], [0, 0, true]);
});

test('B ③: 주제·산출물을 공유하지 않아도 이름에 같은 낱말이 있는 업무의 담당자는 낮은 점수 후보이고 「같은 일인지 확인」 이유가 붙는다', () => {
  // 「2026 행사」 → 「2025 행사」를 한 윤바다(현재 담당 도하람은 제외)
  const r = similarExperts(viewOf('U-D1'), { works: ['U-B/N-102'], asOf: ASOF });
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.people.map((p) => [p.label, p.score]), [['윤바다', WEIGHTS.token]]);
  const w = r.people[0].works[0];
  assert.deepEqual([w.gid, w.name_only, w.reasons], ['U-B/N-101', true, ['이름에 같은 낱말 「행사」 — 같은 일인지 확인']]);
  assert.ok(r.excluded.some((x) => x.label === '도하람'));
  // 주제·산출물을 공유한 후보는 name_only가 아니다
  assert.equal(similarExperts(viewOf('U-D1'), { works: ['U-A1/N-001'], asOf: ASOF }).people[0].works[0].name_only, false);
  // 흔한 낱말(업무·관리·처리·확인)만 같으면 후보가 아니다 — 「대사 확인」과 「출석 확인」
  const stop = buildView(mkDoc('U-B3', [mkNode('A', 'work', '대사 확인'), mkNode('B', 'work', '출석 확인'), mkNode('P', 'person', '가상갑', { emp_no: 'V-9103' })], [mkEdge('P', 'B', 'performs')]));
  assert.equal(similarExperts(stop, { works: ['U-B3/A'], asOf: ASOF }).status, 'insufficient');
});

test('B: 「데이터 부족」은 주제·산출물·이름 낱말·이전 담당이 모두 없을 때만이다', () => {
  const lone = buildView(mkDoc('U-B4', [mkNode('A', 'work', '가나다'), mkNode('B', 'work', '라마바')], []));
  assert.equal(similarExperts(lone, { works: ['U-B4/A'], asOf: ASOF }).status, 'insufficient');
  // 주제가 있으면 비교는 했으므로 데이터 부족이 아니라 결과 없음
  const topic = buildView(mkDoc('U-B5', [mkNode('A', 'work', '가나다'), mkNode('T', 'topic', '주제')], [mkEdge('A', 'T', 'relates_to')]));
  assert.equal(similarExperts(topic, { works: ['U-B5/A'], asOf: ASOF }).status, 'none');
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
  // 사람이 확인해 이은 주제(정산팀의 카드승인 "대사")는 확인 전 표시가 없다
  const roles = similarExperts(viewOf('U-D1'), { works: ['U-A1/N-001'], asOf: ASOF }).roles; // 역할 이름은 사람 목록과 분리(CR-17 B ②)
  assert.deepEqual(roles.find((p) => p.label === '운영 담당').works[0].reasons, ['같은 주제 「대사 불일치」']);

  const linked = JSON.parse(JSON.stringify(SAMPLE_DEPT));
  linked.identity_links.push({ id: 'I-002', a: 'U-A1/N-030', b: 'U-B/N-302', kind: 'topic', method: 'human', status: 'confirmed', decided_by: '가상', decided_at: '2026-10-01T10:00:00+09:00' });
  const r = similarExperts(viewOf('U-D1', { 'U-D1': linked }), { works: ['U-A1/N-001'], asOf: ASOF });
  assert.deepEqual(r.people.find((p) => p.label === '윤바다').works[0].reasons, ['같은 주제 「대사 불일치」']);
});

test('비교할 다른 업무가 없으면 비슷한 일을 해 본 사람은 없다(월말 정산만 열었을 때, 정답 표 SE-2). 이전 담당은 직접 해 본 사람으로 나온다', () => {
  // CR-17 B로 기대값 변경(2026-10-24): 예전에는 status 'none'이었다. 이제 이전 담당(한가람·윤바다)이 「직접 해 봄」으로 나온다
  const se = ANSWERS_V1.similar_experts.find((x) => x.id === 'SE-2');
  const r = similarExperts(viewOf(se.view), { works: [se.work], asOf: se.asOf });
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.people, []);
  assert.deepEqual(r.direct.map((p) => p.gid), se.expected_direct);
  // 이전 담당도 없고 비슷한 일도 없으면 "none"
  const none = buildView(mkDoc('U-B6', [mkNode('A', 'work', '가나다'), mkNode('T', 'topic', '주제'), mkNode('P', 'person', '가상갑', { emp_no: 'V-9104' })], [mkEdge('A', 'T', 'relates_to'), mkEdge('P', 'A', 'performs', { period: { start: '2026-01-01' } })]));
  const rn = similarExperts(none, { works: ['U-B6/A'], asOf: ASOF });
  assert.equal(rn.status, 'none');
  assert.deepEqual([rn.direct, rn.people, rn.roles], [[], [], []]);
});

test('주제·산출물 연결이 없는 업무는 "데이터 부족"이다(정답 표 SE-3, R-05 ②)', () => {
  const se = ANSWERS_V1.similar_experts.find((x) => x.id === 'SE-3');
  const r = similarExperts(viewOf(se.view), { works: [se.work], asOf: se.asOf });
  assert.equal(r.status, 'insufficient');
  assert.match(r.reason, /주제나 산출물/);
  assert.deepEqual(r.people, []);
  assert.equal(similarExperts(viewOf('U-D1'), { works: ['U-A1/N-999'], asOf: ASOF }).status, 'insufficient');
  // 「보고」(U-A1/N-003)는 이제 데이터 부족이 아니다: 이전 담당(윤바다)이 직접 해 봤고, 「교육 결과 보고」가 이름 낱말이 같다(CR-17 B)
  const report = similarExperts(viewOf('U-D1'), { works: ['U-A1/N-003'], asOf: ASOF });
  assert.equal(report.status, 'ok');
  assert.deepEqual(report.direct.map((p) => p.label), ['윤바다']);
  assert.ok(report.people.every((p) => p.works.every((w) => w.name_only)));
});

test('숨긴 업무·숨긴 사람은 후보에서 빠진다', () => {
  const labelsOf = (override) => similarExperts(viewOf('U-D1', override), { works: ['U-A1/N-001'], asOf: ASOF }).people.map((p) => p.label);
  assert.ok(labelsOf({}).includes('윤바다'));
  const hiddenWork = hideNode(SAMPLE_EVENT, 'N-101', { now: '2026-10-01T10:00:00+09:00' }).doc;
  assert.ok(!labelsOf({ 'U-B': hiddenWork }).includes('윤바다'));
  // 합쳐진 사람은 한쪽 노드만 숨기면 사람 노드는 남는다. 다만 숨긴 쪽(행사팀 기록)에 붙은 수행 연결은 되살리지 않으므로(검토8 R8-1, D-04 숨김=삭제)
  // 행사팀 경력으로만 후보가 되던 윤바다는 후보에서 빠진다. 2026-10-17 기대값 변경: 이전에는 후보에 남는다고 봤다(decisions-pending 13절 R8-1)
  const now = { now: '2026-10-01T10:00:00+09:00' };
  const hiddenInB = hideNode(SAMPLE_EVENT, 'N-202', now).doc;
  assert.ok(viewOf('U-D1', { 'U-B': hiddenInB }).nodes.some((n) => n.label === '윤바다' && !n.hidden));
  assert.ok(!labelsOf({ 'U-B': hiddenInB }).includes('윤바다'));
  const hiddenInA = hideNode(SAMPLE_A1, 'N-011', now).doc;
  assert.ok(!labelsOf({ 'U-B': hiddenInB, 'U-A1': hiddenInA }).includes('윤바다'));
});

test('점수: 주제 3, 산출물 유형 2, 낱말 1. 더 많이 겹치는 업무를 한 사람이 위로 온다', () => {
  // 카드승인의 "정합성 조치"와 월말 정산 "대사 확인": 둘 다 대사 주제를 다룬다. 카드승인 쪽 업무는 담당자 이름이 역할이다
  const r = similarExperts(viewOf('U-D1'), { works: ['U-A1/N-001'], asOf: ASOF });
  assert.deepEqual(r.people.map((p) => [p.label, p.score]), [['윤바다', 3]]);
  assert.deepEqual(r.roles.map((p) => [p.label, p.score]), [['운영 담당', 3], ['정산 담당', 3]]); // 역할 이름은 따로(CR-17 B ②). 점수가 같으면 이름순
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
  assert.deepEqual(boosted.map((p) => [p.label, p.score]), [['윤바다', 7]]); // 윤바다는 자료 수집(같은 산출물 유형 +2)도 맡았다(검토6 P-2). 역할 이름 둘은 roles로 분리(CR-17 B ②)
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
  // CR-17 B: 직접 해 본 사람이 먼저(이전 담당), 비슷한 일은 그 뒤에 붙는다. 한가람(이전 담당)도 나온다
  assert.match(mine.text, /^윤바다\(V-1002\) — 「대사 확인」을 직접 해 봄\(2026-06-01 ~ 2026-09-30\)\. 비슷한 일도 해 봄: 「2025 행사」 수행\(2025-05-01 ~ 2025-12-15\)\. 같은 주제 「대사 불일치」/);
  assert.deepEqual(item.sentences.map((s) => s.text.split(' — ')[0]), ['윤바다(V-1002)', '한가람(V-1001)', '운영 담당(V-4002)', '정산 담당(V-4004)']);
  assert.match(item.sentences[1].text, /^한가람\(V-1001\) — 「대사 확인」을 직접 해 봄\(2025-03-01 ~ 2026-05-31\)$/);
  assert.match(item.sentences[2].text, /^운영 담당\(V-4002\) — 역할 이름\(사람 미확인\) — 「장애 시 재처리」 수행/);
  for (const s of item.sentences) {
    assert.ok(s.evidence_ids.length > 0);
    for (const g of s.evidence_ids) assert.ok(v.lookup(g).found, g);
  }
  // 월말 정산만 열면 비슷한 일은 없다. 보내는·받는 사람을 뺀 이전 담당(한가람)만 「직접 해 봄」으로 나온다
  // CR-17 B로 기대값 변경(2026-10-24): 예전에는 이력 부족이었다(이전 담당은 세지 않았음)
  const solo = viewOf('U-A1');
  const only = buildHandoverDraft(solo, { target: 'U-A1/N-000', from: 'U-A1/N-011', to: 'U-A1/N-012', similar: similarSentences(similarExperts(solo, { works: ['U-A1/N-001'], asOf: ASOF, exclude: ['U-A1/N-012', 'U-A1/N-011'] })) }).draft;
  assert.deepEqual(only.items.find((i) => i.key === '유사_경험자').sentences.map((s) => s.text), ['한가람(V-1001) — 「대사 확인」을 직접 해 봄(2025-03-01 ~ 2026-05-31)']);
  // 이전 담당도 비교할 연결도 없으면 이력 부족
  const lone = buildView(mkDoc('U-B7', [mkNode('A', 'work', '가나다'), mkNode('P', 'person', '가상갑', { emp_no: 'V-9105' }), mkNode('Q', 'person', '가상을', { emp_no: 'V-9106' })], []));
  const none = buildHandoverDraft(lone, { target: 'U-B7/A', from: 'U-B7/P', to: 'U-B7/Q', similar: similarSentences(similarExperts(lone, { works: ['U-B7/A'], asOf: ASOF })) }).draft;
  assert.equal(none.items.find((i) => i.key === '유사_경험자').insufficient, true);
});

// ── 반복 비효율(T-11, R-05 ⑤) ──


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

  let doc = addNode(JSON.parse(JSON.stringify(SAMPLE_A1)), { core_type: 'artifact', subtype: '인수인계서', label: '2026-09 인수인계서' }, T0).doc; // 깊은 복사: 공용 샘플을 바꾸지 않게
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

// D2-6 가(사용자 결정 2026-10-03): 바로 앞 인수인계(가장 최근 인수인계서)만 이어받은 것으로 인정
test('인수인계 3회: 바로 앞 인수인계서를 건너뛰고 더 오래된 것만 쓰면 이어받지 않은 것이다', () => {
  // 1차 E-002(인수인계서 N-020) → 2차 E-007(새 인수인계서 B, N-020 참조) → 3차
  let base = addNode(JSON.parse(JSON.stringify(SAMPLE_A1)), { core_type: 'artifact', subtype: '인수인계서', label: '2026-09 인수인계서' }, T0).doc; // 깊은 복사
  const b = base.nodes.at(-1).id;
  base = addEdge(base, { source: b, target: 'N-020', core_type: 'references' }, T0).doc;
  base.events.find((e) => e.id === 'E-007').payload.artifact_id = b;
  const third = (payload) => {
    const d = addEvent(base, { type: 'handover', occurred_at: '2026-12-01', payload: { work_id: 'N-001', from_person_id: 'N-012', to_person_id: 'N-010', ...payload } }, T0).doc;
    return repeatInefficiency(buildView(d)).patterns.find((x) => x.kind === 'handover_chain');
  };
  const skipped = third({ artifact_id: 'N-020' }); // B를 건너뛰고 A만 봄
  assert.deepEqual([skipped.total, skipped.missed], [3, 1]);
  assert.equal(skipped.steps[2].referenced, false);
  assert.equal(third({ previous_handover_id: 'E-002' }).steps[2].referenced, false, '1차를 가리켜도 바로 앞(2차)이 아니면 인정하지 않음');
  assert.equal(third({ artifact_id: b }), undefined, '바로 앞 인수인계서를 쓰면 반복 아님');
  // 바로 앞(2차)이 문서 없이 했으면 그 전의 가장 최근 문서(A)를 쓰면 이어받은 것
  const oral = JSON.parse(JSON.stringify(SAMPLE_A1));
  const d = addEvent(oral, { type: 'handover', occurred_at: '2026-12-01', payload: { work_id: 'N-001', from_person_id: 'N-012', to_person_id: 'N-010', artifact_id: 'N-020' } }, T0).doc;
  const p = repeatInefficiency(buildView(d)).patterns.find((x) => x.kind === 'handover_chain');
  assert.deepEqual([p.total, p.missed, p.steps[2].referenced], [3, 1, true]);
});

test('반복 비효율 ②: 같은 주제가 여러 업무에서 반복되면 근거와 함께 나온다(부서 화면)', () => {
  const r = repeatInefficiency(viewOf('U-D1'));
  // D3-32(검토5 I-5): 교육팀의 「강의실 부족」은 상위 「신입 교육 운영」의 이슈 2건 + 하위 「강의실·강사 섭외」의 주의사항 메모뿐이라
  // (a) 포함 관계는 한 업무로 묶고 (b) 주의사항·해결됨 메모는 세지 않으므로 주제 반복이 아니다
  assert.ok(!r.patterns.some((x) => x.kind === 'topic_repeat' && x.topic.label === '강의실 부족'));
  const t = r.patterns.find((x) => x.kind === 'topic_repeat' && x.topic.label === '대사 불일치');
  assert.deepEqual(t.works.map((w) => w.label).sort(), ['2025 행사', '거래 조회', '대사 확인', '망취소']);
  const v = viewOf('U-D1');
  for (const g of t.evidence_ids) assert.ok(v.lookup(g).found || v.events.some((e) => e.gid === g), g);
  assert.match(t.summary, /4개 업무에서 반복됩니다/);
  // 월말 정산 하나만 보면 한 업무에서만 나오므로 주제 반복은 없다
  assert.ok(!repeatInefficiency(viewOf('U-A1')).patterns.some((x) => x.kind === 'topic_repeat'));
});

test('반복 비효율 ②(D3-32): 포함 관계 업무는 한 곳으로 묶고, 주의사항·해결됨 메모는 근거로 세지 않는다', () => {
  // 월말 정산: 「자료 수집」(N-002)에 주제 「대사 불일치」(N-030) 이슈 메모를 달면 「대사 확인」과 2곳 → 반복
  const base = JSON.parse(JSON.stringify(SAMPLE_A1));
  const memo = (doc, target, category) => addEvent(doc, { type: 'memo', occurred_at: '2026-10-01', payload: { target_id: target, topic_ids: ['N-030'], category }, note: '불일치' }, T0).doc;
  const twoWorks = repeatInefficiency(buildView(memo(base, 'N-002', 'issue'))).patterns.find((x) => x.kind === 'topic_repeat');
  assert.ok(twoWorks, '서로 다른 두 업무면 반복');
  // (b) 같은 메모가 주의사항·해결됨 범주면 세지 않는다
  for (const cat of ['caution', 'resolved']) {
    assert.ok(!repeatInefficiency(buildView(memo(base, 'N-002', cat))).patterns.some((x) => x.kind === 'topic_repeat'), cat);
  }
  // (a) 「자료 수집」을 「대사 확인」의 하위 업무로 묶으면 한 곳으로 센다
  const nested = addEdge(base, { source: 'N-001', target: 'N-002', core_type: 'contains' }, T0).doc;
  assert.ok(!repeatInefficiency(buildView(memo(nested, 'N-002', 'issue'))).patterns.some((x) => x.kind === 'topic_repeat'));
});

test('반복 비효율(검토5 I-2): 기준일을 주면 미래 날짜 이력은 세지 않는다', () => {
  const doc = addEvent(JSON.parse(JSON.stringify(SAMPLE_A1)), { type: 'handover', occurred_at: '2027-01-01', payload: { work_id: 'N-001', from_person_id: 'N-012', to_person_id: 'N-010' } }, T0).doc;
  const v = buildView(doc);
  assert.equal(repeatInefficiency(v).patterns.find((x) => x.kind === 'handover_chain').total, 3, '기준일 없음 → 전체');
  const r = repeatInefficiency(v, { asOf: '2026-10-03' });
  assert.equal(r.patterns.find((x) => x.kind === 'handover_chain').total, 2);
  assert.equal(r.last_input, '2026-10-01');
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
