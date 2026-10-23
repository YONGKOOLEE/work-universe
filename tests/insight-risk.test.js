// CR-14 B 인수인계 위험 인사이트(R-26, D-31): 지식 집중 · 준비도 · 파급 영향.
// 규칙마다 "읽혀야 하는 것"과 "읽히면 안 되는 것"을 함께 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allSamples, viewOf, mkNode as n, mkEdge as e, mkDoc, FIXTURE_TS as S } from './helpers.js';
import { buildView } from '../app/src/view/view.js';
import {
  RISK, knowledgeConcentration, handoverReadiness, ripple, riskNoteFor, concentrationExplain, readinessExplain, rippleExplain,
} from '../app/src/rules/insight-risk.js';

const ASOF = '2026-10-02';
const ev = (id, type, date, payload, note = '') => ({ id, type, occurred_at: date, recorded_at: S, source: 'user', payload, note });
const person = (id, label, r = {}) => n(id, 'person', label, r);
const role = (id, label) => n(id, 'person', label, { subtype: '역할' });
const work = (id, label, r = {}) => n(id, 'work', label, r);
const art = (id, label, r = {}) => n(id, 'artifact', label, r);
const performs = (p, w, period) => e(p, w, 'performs', period ? { period } : {});
const view = (nodes, edges, events = [], extra = {}) => buildView(mkDoc('U-R', nodes, edges, events, extra));
const find = (r, workId) => r.items.find((x) => x.work.gid === `U-R/${workId}`);

// ── ① 지식 집중 ──
test('① 혼자 해 본 업무 + 인수인계 기록 없음 → 높음 (근거에 업무·사람)', () => {
  const v = view([work('W1', '정산'), person('P1', '가나')], [performs('P1', 'W1')]);
  const r = knowledgeConcentration(v, { asOf: ASOF });
  assert.equal(r.status, 'ok');
  assert.equal(find(r, 'W1').level, 'high');
  assert.deepEqual(find(r, 'W1').evidence.sort(), ['U-R/P1', 'U-R/W1']);
  assert.equal(r.counts.high, 1);
});

test('① 해 본 사람 2명(과거 1·현재 1)은 집중이 아니다. 과거 1명뿐이어도 1명으로 센다', () => {
  const two = view([work('W1', '정산'), person('P1', '가나'), person('P2', '다라')],
    [performs('P1', 'W1', { start: '2025-01-01', end: '2026-05-31' }), performs('P2', 'W1', { start: '2026-06-01' })]);
  const r = knowledgeConcentration(two, { asOf: ASOF });
  assert.equal(r.items.length, 0);
  assert.equal(r.counts.many, 1);
  assert.equal(r.status, 'none');
  const past = view([work('W1', '정산'), person('P1', '가나')], [performs('P1', 'W1', { start: '2025-01-01', end: '2026-05-31' })]);
  assert.equal(find(knowledgeConcentration(past, { asOf: ASOF }), 'W1').level, 'high'); // 지금은 아무도 안 하지만 해 본 사람은 1명
});

test('① 같은 사람이 기간을 나눠 두 번 맡아도 1명이다', () => {
  const v = view([work('W1', '정산'), person('P1', '가나')], [performs('P1', 'W1', { start: '2025-01-01', end: '2025-12-31' }), performs('P1', 'W1', { start: '2026-03-01' })]);
  assert.equal(find(knowledgeConcentration(v, { asOf: ASOF }), 'W1').level, 'high');
});

test('① 1명 + 인수인계서만 / 1명 + handover 이력만 → 주의, 둘 다 없으면 높음', () => {
  const nodes = [work('W1', '문서만'), work('W2', '이력만'), work('W3', '없음'), person('P1', '가나'), person('P2', '다라'), art('A1', '인계서', { subtype: '인수인계서' }), art('A2', '일반 문서')];
  const edges = [performs('P1', 'W1'), performs('P1', 'W2'), performs('P2', 'W3'), e('W1', 'A1', 'produces'), e('W3', 'A2', 'produces')];
  const events = [ev('E-1', 'handover', '2026-09-01', { work_id: 'W2', from_person_id: 'P1', to_person_id: 'P2' })];
  const r = knowledgeConcentration(view(nodes, edges, events), { asOf: ASOF });
  assert.equal(find(r, 'W1').level, 'caution');
  assert.equal(find(r, 'W1').handover_docs, 1);
  assert.equal(find(r, 'W2').level, 'caution');
  assert.ok(find(r, 'W2').evidence.includes('U-R/E-1'));
  assert.equal(find(r, 'W3').level, 'high'); // 인수인계서가 아닌 일반 산출물은 인수인계 기록이 아니다
  assert.deepEqual(r.items.map((x) => x.level), ['high', 'caution', 'caution']); // 높음이 먼저
});

test('① 역할 노드만 → 사람 미확인(role_only), 역할 + 실제 1명 → 실제 1명 기준', () => {
  const v = view([work('W1', '역할만'), work('W2', '역할과 사람'), role('R1', '담당 역할'), person('P1', '가나')],
    [performs('R1', 'W1'), performs('R1', 'W2'), performs('P1', 'W2')]);
  const r = knowledgeConcentration(v, { asOf: ASOF });
  assert.equal(r.counts.role_only, 1);
  assert.equal(find(r, 'W1'), undefined);
  assert.equal(find(r, 'W2').person.gid, 'U-R/P1');
  assert.equal(find(r, 'W2').level, 'high');
});

test('① 수행 연결 없는 업무는 unknown으로 따로 센다. 모두 없으면 데이터 부족', () => {
  const some = view([work('W1', '있음'), work('W2', '없음'), person('P1', '가나')], [performs('P1', 'W1')]);
  const r = knowledgeConcentration(some, { asOf: ASOF });
  assert.equal(r.counts.unknown, 1);
  assert.equal(find(r, 'W2'), undefined);
  assert.equal(r.status, 'ok');
  const none = knowledgeConcentration(view([work('W1', '없음')], []), { asOf: ASOF });
  assert.equal(none.status, 'insufficient');
  assert.equal(none.insufficient, true);
  assert.match(none.reason, /수행/);
  assert.equal(knowledgeConcentration(view([], []), { asOf: ASOF }).status, 'insufficient');
});

test('① 숨긴 업무·숨긴 사람·끝난 업무는 세지 않는다', () => {
  const v = view([work('W1', '숨김', { hidden: true }), work('W2', '끝남', { period: { start: '2025-01-01', end: '2026-01-01' } }), work('W3', '살아있음'), person('P1', '가나'), person('P2', '숨긴 사람', { hidden: true })],
    [performs('P1', 'W1'), performs('P1', 'W2'), performs('P1', 'W3'), performs('P2', 'W3')]);
  const r = knowledgeConcentration(v, { asOf: ASOF });
  assert.equal(r.counts.works, 1);
  assert.deepEqual(r.items.map((x) => x.work.gid), ['U-R/W3']); // 숨긴 P2는 해 본 사람이 아니라 P1 혼자
});

test('① 통합: 같은 사람 두 유니버스는 1명, 다른 사람이면 2명 (묶은 지도 기준)', () => {
  const a = mkDoc('U-A', [work('W1', '정산'), person('P1', '가나', { emp_no: 'V-1001' })], [performs('P1', 'W1')], [], { refs: [{ child_universe_id: 'U-B' }] });
  const b = mkDoc('U-B', [work('W1', '정산'), person('P1', '가나', { emp_no: 'V-1001' })], [performs('P1', 'W1')]);
  const link = (id, x, y, kind) => ({ id, a: x, b: y, kind, method: 'human', status: 'confirmed', decided_by: 't', decided_at: S });
  const resolve = (id) => (id === 'U-B' ? b : null);
  // 업무만 합침(사람은 따로) → 서로 다른 두 사람이 한 업무를 했다
  const workOnly = buildView({ ...a, identity_links: [link('I-1', 'U-A/W1', 'U-B/W1', 'work')] }, resolve);
  assert.equal(knowledgeConcentration(workOnly, { asOf: ASOF }).counts.many, 1);
  assert.equal(knowledgeConcentration(workOnly, { asOf: ASOF }).items.length, 0);
  // 업무·사람 모두 합침 → 한 사람이 한 업무
  const both = buildView({ ...a, identity_links: [link('I-1', 'U-A/W1', 'U-B/W1', 'work'), link('I-2', 'U-A/P1', 'U-B/P1', 'person')] }, resolve);
  const r = knowledgeConcentration(both, { asOf: ASOF });
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].level, 'high');
  // 합치지 않으면 업무가 둘, 각각 1명
  assert.equal(knowledgeConcentration(buildView(a, resolve), { asOf: ASOF }).items.length, 2);
});

test('① 기준일: 시작 전 담당은 경험이 아니고, 기준일 뒤의 인수인계 이력은 세지 않는다', () => {
  const nodes = [work('W1', '정산'), person('P1', '가나'), person('P2', '다라')];
  const edges = [performs('P1', 'W1', { start: '2025-01-01' }), performs('P2', 'W1', { start: '2026-12-01' })];
  const events = [ev('E-1', 'handover', '2026-11-01', { work_id: 'W1', from_person_id: 'P1', to_person_id: 'P2' })];
  const v = view(nodes, edges, events);
  const now = find(knowledgeConcentration(v, { asOf: ASOF }), 'W1');
  assert.equal(now.level, 'high'); // 12월 시작 담당 P2와 11월 인수인계는 기준일에 아직 없다
  assert.equal(now.person.gid, 'U-R/P1');
  const later = knowledgeConcentration(v, { asOf: '2026-12-15' });
  assert.equal(later.counts.many, 1); // 미래 기준일에는 둘
});

test('① riskNoteFor: 높음이면 사람, 주의·둘 이상·업무 아님이면 null', () => {
  const nodes = [work('W1', '높음'), work('W2', '주의'), work('W3', '둘'), person('P1', '가나'), person('P2', '다라'), art('A1', '인계서', { subtype: '인수인계서' })];
  const edges = [performs('P1', 'W1'), performs('P1', 'W2'), e('W2', 'A1', 'produces'), performs('P1', 'W3'), performs('P2', 'W3')];
  const v = view(nodes, edges);
  assert.deepEqual(riskNoteFor(v, 'U-R/W1', ASOF).person, { gid: 'U-R/P1', label: '가나' });
  assert.equal(riskNoteFor(v, 'U-R/W1', ASOF).level, 'high');
  assert.equal(riskNoteFor(v, 'U-R/W2', ASOF), null);
  assert.equal(riskNoteFor(v, 'U-R/W3', ASOF), null);
  assert.equal(riskNoteFor(v, 'U-R/P1', ASOF), null);
  assert.equal(riskNoteFor(v, 'U-R/없음', ASOF), null);
});

// ── ② 준비도 ──
const fullWork = (id, label, extra = {}) => work(id, label, { description: '설명', attrs: { 절차: 'a', 주기: 'b', 마감: 'c', 주의사항: 'd', ...(extra.attrs || {}) }, ...extra });

function readyFixture(eventDate) {
  // 6항목을 모두 채운 업무 W1. eventDate는 최근 이력 판정용 이력 날짜
  const nodes = [fullWork('W1', '완비'), person('P1', '가나'), art('A1', '문서', { subtype: '인수인계서' })];
  const edges = [performs('P1', 'W1', { start: '2025-01-01' }), e('W1', 'A1', 'produces')];
  const events = [ev('E-1', 'memo', eventDate, { target_id: 'W1', category: 'caution' }, '주의')];
  return view(nodes, edges, events);
}

test('② 6항목 모두 충족하면 6/6, 빠진 항목 없음', () => {
  const r = handoverReadiness(readyFixture('2026-09-30'), { asOf: ASOF });
  const x = find(r, 'W1');
  assert.equal(x.score, 6);
  assert.deepEqual(x.missing, []);
  assert.equal(x.total, 6);
});

test('② 최근 이력 경계: 179일·180일은 충족, 181일은 미충족 / 기준일 뒤 이력은 세지 않는다', () => {
  assert.equal(RISK.RECENT_DAYS, 180);
  // 2026-10-02 - 180일 = 2026-04-05
  for (const [date, ok] of [['2026-04-06', true], ['2026-04-05', true], ['2026-04-04', false]]) {
    const x = find(handoverReadiness(readyFixture(date), { asOf: ASOF }), 'W1');
    assert.equal(x.flags.recent, ok, date);
    assert.equal(x.score, ok ? 6 : 5, date);
    if (!ok) assert.deepEqual(x.missing.map((m) => m.key), ['recent']);
  }
  const future = find(handoverReadiness(readyFixture('2026-10-10'), { asOf: ASOF }), 'W1');
  assert.equal(future.flags.recent, false);
  assert.match(future.missing[0].detail, /이력이 없음|전/);
});

test('② 항목별: 양식·산출물·담당·인수인계 각각 빠지면 그 항목만 빠진다', () => {
  const nodes = [work('W1', '빈 업무'), person('P1', '가나')];
  const r = handoverReadiness(view(nodes, []), { asOf: ASOF });
  const x = find(r, 'W1');
  assert.deepEqual(x.flags, { form: false, noOpenIssues: true, hasArtifact: false, hasCurrent: false, hasHandover: false, recent: false });
  assert.equal(x.score, 1);
  assert.match(x.missing.find((m) => m.key === 'form').detail, /절차/);
  // 담당이 과거뿐이면 현재 담당 없음, 역할만 있어도 현재 담당 없음
  const past = find(handoverReadiness(view([fullWork('W1', '업무'), person('P1', '가나'), role('R1', '역할')], [performs('P1', 'W1', { start: '2024-01-01', end: '2025-01-01' }), performs('R1', 'W1')]), { asOf: ASOF }), 'W1');
  assert.equal(past.flags.hasCurrent, false);
  const withPerson = find(handoverReadiness(view([fullWork('W1', '업무'), person('P1', '가나')], [performs('P1', 'W1')]), { asOf: ASOF }), 'W1');
  assert.equal(withPerson.flags.hasCurrent, true);
  assert.equal(withPerson.flags.hasArtifact, false); // 참조(references)는 산출이 아니다
  const ref = find(handoverReadiness(view([fullWork('W1', '업무'), art('A1', '문서')], [e('W1', 'A1', 'references')]), { asOf: ASOF }), 'W1');
  assert.equal(ref.flags.hasArtifact, false);
});

test('② 미해결 이슈: 있으면 빠짐 + 근거 이벤트, 해결로 표시하면 충족', () => {
  const nodes = [fullWork('W1', '업무'), fullWork('W2', '다른 업무')];
  const issue = ev('E-1', 'memo', '2026-09-20', { target_id: 'W1', category: 'issue' }, '불일치');
  const open = handoverReadiness(view(nodes, [], [issue]), { asOf: ASOF });
  const x = find(open, 'W1');
  assert.equal(x.flags.noOpenIssues, false);
  assert.deepEqual(x.missing.find((m) => m.key === 'noOpenIssues').evidence, ['U-R/E-1']);
  assert.equal(find(open, 'W2').flags.noOpenIssues, true); // 다른 업무의 이슈가 아니다
  const done = ev('E-2', 'memo', '2026-09-25', { target_id: 'W1', category: 'resolved', resolves_id: 'E-1' }, '해결: 불일치');
  assert.equal(find(handoverReadiness(view(nodes, [], [issue, done]), { asOf: ASOF }), 'W1').flags.noOpenIssues, true);
  // 해결 메모가 기준일 뒤면 기준일에는 아직 열려 있다
  const late = ev('E-2', 'memo', '2026-10-20', { target_id: 'W1', category: 'resolved', resolves_id: 'E-1' }, '해결');
  assert.equal(find(handoverReadiness(view(nodes, [], [issue, late]), { asOf: ASOF }), 'W1').flags.noOpenIssues, false);
  // 주의사항 메모는 이슈가 아니다
  assert.equal(find(handoverReadiness(view(nodes, [], [ev('E-3', 'memo', '2026-09-20', { target_id: 'W1', category: 'caution' })]), { asOf: ASOF }), 'W1').flags.noOpenIssues, true);
});

test('② 낮은 순 정렬, 같은 점수는 이름 순, 숨김·끝난 업무 제외, 업무 없으면 데이터 부족', () => {
  const v = view([work('W1', '나'), work('W2', '가'), fullWork('W3', '완비'), work('W4', '숨김', { hidden: true }), work('W5', '끝', { period: { end: '2025-01-01' } })], []);
  const r = handoverReadiness(v, { asOf: ASOF });
  assert.deepEqual(r.items.map((x) => x.work.label), ['가', '나', '완비']);
  assert.ok(r.items[0].score <= r.items[2].score);
  const none = handoverReadiness(view([], []), { asOf: ASOF });
  assert.equal(none.status, 'insufficient');
  assert.equal(none.insufficient, true);
});

test('② 인수인계 항목: handover 이력만 / 인수인계서만 / 둘 다 없음 / 기준일 뒤 이력', () => {
  const nodes = [work('W1', '이력'), work('W2', '문서'), work('W3', '없음'), work('W4', '미래'), person('P1', '가나'), person('P2', '다라'), art('A1', '인계서', { subtype: '인수인계서' })];
  const edges = [e('W2', 'A1', 'produces')];
  const events = [ev('E-1', 'handover', '2026-08-01', { work_id: 'W1', from_person_id: 'P1', to_person_id: 'P2' }), ev('E-2', 'handover', '2026-12-01', { work_id: 'W4', from_person_id: 'P1', to_person_id: 'P2' })];
  const r = handoverReadiness(view(nodes, edges, events), { asOf: ASOF });
  assert.equal(find(r, 'W1').flags.hasHandover, true);
  assert.equal(find(r, 'W2').flags.hasHandover, true);
  assert.equal(find(r, 'W3').flags.hasHandover, false);
  assert.equal(find(r, 'W4').flags.hasHandover, false);
});

// ── ③ 파급 영향 ──
test('③ 선후행: a→b→c 이면 a는 2개, b는 1개, c는 0개(목록에 없음). 경로 예시는 최단·가장 먼 업무', () => {
  const v = view([work('A', '가'), work('B', '나'), work('C', '다')], [e('A', 'B', 'precedes'), e('B', 'C', 'precedes')]);
  const r = ripple(v, { asOf: ASOF });
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.works.map((x) => [x.work.label, x.count]), [['가', 2], ['나', 1]]);
  assert.equal(r.works[0].path.text, '「가」 → 「나」 → 「다」');
  assert.deepEqual(r.works[0].evidence.sort(), ['U-R/A', 'U-R/B', 'U-R/C']);
});

test('③ 산출 → 참조: w produces a, x references a 이면 w → x. 참조만/산출만이면 닿지 않고, 방향을 거꾸로 읽지 않는다', () => {
  const nodes = [work('W', '만드는'), work('X', '쓰는'), work('Y', '무관'), art('A', '보고서')];
  const ok = ripple(view(nodes, [e('W', 'A', 'produces'), e('X', 'A', 'references')]), { asOf: ASOF });
  assert.deepEqual(ok.works.map((x) => [x.work.gid, x.count]), [['U-R/W', 1]]); // X→W 방향은 없음
  assert.equal(ok.works[0].path.text, '「만드는」 →(산출물 「보고서」)→ 「쓰는」');
  assert.ok(ok.works[0].evidence.includes('U-R/A'));
  // 산출만
  assert.equal(ripple(view(nodes, [e('W', 'A', 'produces')]), { asOf: ASOF }).status, 'insufficient');
  // 참조만
  assert.equal(ripple(view(nodes, [e('X', 'A', 'references')]), { asOf: ASOF }).status, 'insufficient');
  // 둘 다 산출(참조 아님)은 의존이 아니다
  assert.equal(ripple(view(nodes, [e('W', 'A', 'produces'), e('X', 'A', 'produces')]), { asOf: ASOF }).status, 'insufficient');
  // 자기 산출물을 자기가 참조 → 자기 연결 없음
  assert.equal(ripple(view(nodes, [e('W', 'A', 'produces'), e('W', 'A', 'references')]), { asOf: ASOF }).status, 'insufficient');
});

test('③ 순환(a→b→a)에서도 끝나고 자기 자신은 세지 않는다', () => {
  const v = view([work('A', '가'), work('B', '나'), work('C', '다')], [e('A', 'B', 'precedes'), e('B', 'A', 'precedes'), e('B', 'C', 'precedes')]);
  const r = ripple(v, { asOf: ASOF });
  const byLabel = Object.fromEntries(r.works.map((x) => [x.work.label, x.count]));
  assert.deepEqual(byLabel, { 가: 2, 나: 2 });
});

test('③ 자기 연결(precedes w→w)은 닿는 업무가 아니다. 숨긴 업무·연결은 따르지 않는다', () => {
  const self = ripple(view([work('A', '가')], [e('A', 'A', 'precedes')]), { asOf: ASOF });
  assert.equal(self.status, 'insufficient');
  const v = view([work('A', '가'), work('B', '나', { hidden: true }), work('C', '다')], [e('A', 'B', 'precedes'), e('A', 'C', 'precedes', { hidden: true })]);
  assert.equal(ripple(v, { asOf: ASOF }).status, 'insufficient');
});

test('③ 선후행·참조가 없으면 데이터 부족(다른 연결 종류는 의존이 아니다)', () => {
  const r = ripple(view([work('A', '가'), work('B', '나')], [e('A', 'B', 'relates_to'), e('A', 'B', 'contains')]), { asOf: ASOF });
  assert.equal(r.status, 'insufficient');
  assert.equal(r.insufficient, true);
  assert.deepEqual([r.works, r.people], [[], []]);
});

test('③ 상위 TOP_WORKS개만, 많은 순', () => {
  const ids = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const v = view(ids.map((i) => work(i, `업무${i}`)), ids.slice(0, -1).map((i, k) => e(i, ids[k + 1], 'precedes'))); // 사슬: A가 7, B가 6, …
  const r = ripple(v, { asOf: ASOF });
  assert.equal(r.works.length, RISK.TOP_WORKS);
  assert.deepEqual(r.works.map((x) => x.count), [7, 6, 5, 4, 3]);
});

test('③ 사람: 혼자 현재 담당인 업무만 센다. 둘이 맡은 업무·과거 담당·역할은 세지 않는다', () => {
  const nodes = [work('A', '혼자'), work('B', '둘이'), work('X', '뒤1'), work('Y', '뒤2'), person('P1', '가나'), person('P2', '다라'), person('P3', '마바'), role('R1', '역할')];
  const edges = [e('A', 'X', 'precedes'), e('B', 'Y', 'precedes'),
    performs('P1', 'A'), performs('P2', 'B'), performs('P3', 'B'), performs('R1', 'A')];
  const r = ripple(view(nodes, edges), { asOf: ASOF });
  assert.deepEqual(r.people.map((x) => [x.person.label, x.count, x.sole_works]), [['가나', 1, 1]]); // 역할 R1은 사람이 아니고, A는 P1 혼자
  // 과거 담당만 있으면 혼자 담당이 아니다
  const past = ripple(view(nodes, [e('A', 'X', 'precedes'), performs('P1', 'A', { start: '2024-01-01', end: '2025-01-01' })]), { asOf: ASOF });
  assert.deepEqual(past.people, []);
  assert.equal(past.status, 'ok'); // 길목 업무는 그대로
});

test('③ 사람: 혼자 맡은 업무 여러 개의 닿는 업무는 합집합(겹치면 한 번)', () => {
  const nodes = [work('A', '혼자1'), work('B', '혼자2'), work('X', '공통'), work('Y', '뒤'), person('P1', '가나')];
  const edges = [e('A', 'X', 'precedes'), e('B', 'X', 'precedes'), e('B', 'Y', 'precedes'), performs('P1', 'A'), performs('P1', 'B')];
  const p = ripple(view(nodes, edges), { asOf: ASOF }).people[0];
  assert.equal(p.count, 2); // {X, Y}, 합이 아니라 합집합
  assert.equal(p.sole_works, 2);
});

test('③ 사람 상위 TOP_PEOPLE명', () => {
  const nodes = []; const edges = [];
  for (let i = 1; i <= 7; i += 1) {
    nodes.push(work(`A${i}`, `업무${i}`), work(`X${i}`, `뒤${i}`), person(`P${i}`, `사람${i}`));
    edges.push(e(`A${i}`, `X${i}`, 'precedes'), performs(`P${i}`, `A${i}`));
  }
  assert.equal(ripple(view(nodes, edges), { asOf: ASOF }).people.length, RISK.TOP_PEOPLE);
});

// ── 설명 문장 ──
test('설명 문장: 근거는 모두 뷰에 있고, 데이터 부족이면 null, 수치는 결과와 같다', () => {
  const nodes = [work('A', '가'), work('B', '나'), person('P1', '가나')];
  const v = view(nodes, [e('A', 'B', 'precedes'), performs('P1', 'A')]);
  const c = concentrationExplain(knowledgeConcentration(v, { asOf: ASOF }), v.universe_id);
  const r = readinessExplain(handoverReadiness(v, { asOf: ASOF }), v.universe_id);
  const p = rippleExplain(ripple(v, { asOf: ASOF }), v.universe_id);
  for (const req of [c, r, p]) {
    assert.ok(req.rule.length > 0);
    for (const s of req.rule) for (const g of s.evidence_ids) assert.ok(v.exists(g), g);
    assert.deepEqual(req.evidence_ids, [...new Set(req.rule.flatMap((s) => s.evidence_ids))].sort());
  }
  assert.equal(c.target, 'risk_concentration|U-R');
  assert.equal(r.target, 'risk_readiness|U-R');
  assert.equal(p.target, 'risk_ripple|U-R');
  assert.match(c.rule[0].text, /1개/);
  assert.match(p.rule[0].text, /1개 업무/);
  const empty = view([], []);
  assert.equal(concentrationExplain(knowledgeConcentration(empty, { asOf: ASOF }), 'U-R'), null);
  assert.equal(readinessExplain(handoverReadiness(empty, { asOf: ASOF }), 'U-R'), null);
  assert.equal(rippleExplain(ripple(empty, { asOf: ASOF }), 'U-R'), null);
});

// ── 내장 샘플 7개 고정 비교(숫자가 바뀌면 깨진다) ──
test('내장 샘플 7개: ①②③ 요약 숫자 고정', () => {
  const summary = {};
  for (const id of Object.keys(allSamples())) {
    const v = viewOf(id);
    const c = knowledgeConcentration(v, { asOf: ASOF });
    const r = handoverReadiness(v, { asOf: ASOF });
    const p = ripple(v, { asOf: ASOF });
    const k = c.counts;
    const dist = {};
    for (const x of r.items) dist[x.score] = (dist[x.score] || 0) + 1;
    summary[id] = {
      c: [c.status, k.works, k.high, k.caution, k.unknown, k.role_only, k.many],
      r: [r.status, r.items.length, JSON.stringify(dist)],
      p: [p.status, p.edges, p.works.map((x) => x.count).join(','), p.people.map((x) => x.count).join(',')],
    };
  }
  // 재검증(2026-10-23) 뒤 갱신: U-K1 ①은 역할 이름만 있어 해 본 사람을 알 수 없으므로 데이터 부족(D1),
  // U-B·U-D1 ③ 사람에서 도하람이 빠짐 — 닿던 「참가자 모집」이 도하람 자신이 혼자 맡은 업무라 "함께 막히는 업무"가 아님(D2)
  assert.deepEqual(summary, {
    'U-A1': { c: ['ok', 3, 2, 0, 0, 0, 1], r: ['ok', 3, '{"2":1,"3":1,"5":1}'], p: ['ok', 2, '2,1', '1'] },
    'U-K1': { c: ['insufficient', 10, 0, 0, 5, 5, 0], r: ['ok', 10, '{"1":7,"2":3}'], p: ['ok', 4, '4,3,2,1', ''] },
    'U-T1': { c: ['ok', 13, 2, 0, 5, 5, 1], r: ['ok', 13, '{"1":7,"2":4,"3":1,"5":1}'], p: ['ok', 6, '4,3,2,2,1', '1'] },
    'U-B': { c: ['ok', 4, 4, 0, 0, 0, 0], r: ['ok', 4, '{"1":1,"3":3}'], p: ['ok', 1, '1', ''] },
    'U-D1': { c: ['ok', 22, 8, 0, 6, 5, 3], r: ['ok', 22, '{"1":9,"2":4,"3":5,"4":2,"5":1,"6":1}'], p: ['ok', 9, '4,3,2,2,2', '2,1,1'] },
    'U-C': { c: ['ok', 5, 2, 0, 1, 0, 2], r: ['ok', 5, '{"1":1,"3":1,"4":2,"6":1}'], p: ['ok', 2, '2,1', '2,1'] },
    'U-O': { c: ['insufficient', 0, 0, 0, 0, 0, 0], r: ['insufficient', 0, '{}'], p: ['insufficient', 0, '', ''] },
  });
});

// 나란히 재검증(2026-10-23) D1·D2: 다시 생기지 않게
test('D1 해 본 사람을 한 명도 알 수 없으면(수행 없음·역할만뿐) 결론 없이 데이터 부족, 실제 사람이 한 명이라도 있으면 판정', () => {
  const onlyRoles = view([work('W1', '정산'), work('W2', '대사'), role('R1', '정산 담당')], [performs('R1', 'W1')]);
  const r = knowledgeConcentration(onlyRoles, { asOf: ASOF });
  assert.equal(r.status, 'insufficient');
  assert.ok(r.reason.includes('역할 이름만'));
  const withPerson = view([work('W1', '정산'), work('W2', '대사'), role('R1', '정산 담당'), person('P1', '가나'), person('P2', '다라')], [performs('R1', 'W1'), performs('P1', 'W2'), performs('P2', 'W2')]);
  assert.equal(knowledgeConcentration(withPerson, { asOf: ASOF }).status, 'none'); // 실제 사람이 있는 업무가 있으니 "없음"은 결론
});

test('D2 혼자 맡은 사람이 빠질 때 함께 막히는 업무에 그 사람 자신의 업무는 세지 않는다(사슬·순환)', () => {
  const chain = view([work('A', '가'), work('B', '나'), work('C', '다'), person('P1', '가나')],
    [performs('P1', 'A'), performs('P1', 'B'), e('A', 'B', 'precedes'), e('B', 'C', 'precedes')]);
  const p = ripple(chain, { asOf: ASOF }).people.find((x) => x.person.gid === 'U-R/P1');
  assert.equal(p.count, 1);
  assert.deepEqual(p.reached, ['U-R/C']);
  const loop = view([work('A', '가'), work('B', '나'), work('C', '다'), person('P1', '가나')],
    [performs('P1', 'A'), performs('P1', 'B'), e('A', 'B', 'precedes'), e('B', 'C', 'precedes'), e('C', 'A', 'precedes')]);
  assert.equal(ripple(loop, { asOf: ASOF }).people.find((x) => x.person.gid === 'U-R/P1').count, 1);
  const ownOnly = view([work('A', '가'), work('B', '나'), person('P1', '가나')], [performs('P1', 'A'), performs('P1', 'B'), e('A', 'B', 'precedes')]);
  assert.equal(ripple(ownOnly, { asOf: ASOF }).people.length, 0); // 닿는 업무가 모두 자기 업무면 목록에 없다
});

test('② 현재 담당이 역할 이름뿐이면 「역할 이름만 있고 담당 중인 실제 사람이 없음」', () => {
  const v = view([work('W1', '정산'), role('R1', '정산 담당')], [performs('R1', 'W1')]);
  const m = find(handoverReadiness(v, { asOf: ASOF }), 'W1').missing.find((x) => x.key === 'hasCurrent');
  assert.equal(m.detail, '역할 이름만 있고 담당 중인 실제 사람이 없음');
});
