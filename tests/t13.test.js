// T-13 가상 데이터 완성(기본안): R-13 ①②, R-07, R-06, 02-design 4절 예외 사례 9건, 정답 표 v2
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SAMPLES } from '../app/data/index.js';
import { allSamples, viewOf } from './helpers.js';
import { ANSWERS_V1 } from '../app/data/answers-v1.js';
import { NODE_TYPES, EDGE_TYPES } from '../app/src/model/schema.js';
import { addNode, addRef, hideNode, updateNode } from '../app/src/model/commands.js';
import { validateDocument } from '../app/src/model/validate.js';
import { affiliationAt, describeUniverse } from '../app/src/view/describe.js';
import { buildHandoverDraft } from '../app/src/rules/handover.js';
import { densityGaps } from '../app/src/rules/insight.js';
import { flowChange } from '../app/src/rules/flow.js';
import { scanVirtualData } from '../tools/virtual-data-check.mjs';

const all = allSamples();
const ctx = { now: '2026-10-02T10:00:00+09:00' };
const ASOF = '2026-10-02';

// ── R-13 ① 네 유니버스(A·B·C·조직관리)가 같은 틀로 불러와진다 ──
const FOUR = { A: 'U-T1', B: 'U-B', C: 'U-C', O: 'U-O' };

test('R-13 ①: A·B·C팀과 조직관리 유니버스가 모두 같은 틀(노드 6유형·관계 7유형)로 오류 없이 불러와진다', () => {
  const nodeTypes = new Set(Object.keys(NODE_TYPES));
  const edgeTypes = new Set(Object.keys(EDGE_TYPES));
  for (const [team, id] of Object.entries(FOUR)) {
    const doc = all[id];
    assert.ok(doc, `${team}팀 유니버스 ${id}가 내장 샘플에 있다`);
    assert.deepEqual(validateDocument(doc).errors, [], id);
    const v = viewOf(id);
    assert.ok(v.nodes.length > 1, id);
    for (const n of v.nodes) assert.ok(nodeTypes.has(n.core_type), `${id} ${n.core_type}`);
    for (const e of v.edges.filter((x) => !x.synthetic)) assert.ok(edgeTypes.has(e.core_type), `${id} ${e.core_type}`);
  }
});

test('R-13: 두 사용법(A팀 참조, B·C팀 직접 생성)과 조직관리가 모두 있다(D-02)', () => {
  assert.ok(all['U-T1'].refs.length >= 2 && all['U-T1'].nodes.length === 1); // 꼭지만 두고 참조
  for (const id of ['U-B', 'U-C']) assert.ok(all[id].nodes.some((n) => n.core_type === 'work'), id);
  assert.ok(all['U-O'].nodes.some((n) => n.core_type === 'org'));
});

test('DA-1 규모: 가상 인물 20~30명(역할 노드 제외, 사번이 같아도 이름이 다르면 따로), 조직개편 2회 이상', () => {
  // 검토3 DATA-4: 카드승인의 역할 노드(subtype 역할)는 사람이 아니고, 사번 충돌(윤바다/윤바다라)은 서로 다른 사람이다
  const people = new Set();
  for (const s of SAMPLES) for (const n of s.nodes) if (n.core_type === 'person' && n.subtype !== '역할') people.add(n.emp_no ? `${n.emp_no}:${n.label}` : `${s.universe.id}:${n.label}`);
  assert.ok(people.size >= 20 && people.size <= 30, `${people.size}명`);
  const changes = all['U-O'].events.filter((e) => e.type === 'affiliation_change').map((e) => e.occurred_at.slice(0, 7));
  assert.ok(new Set(changes).size >= 2);
});

test('R-06: 새 샘플도 형식 점검을 통과한다(사번 V-####, 조직 이름 "가상", 연락처·주소 형식 없음)', () => {
  for (const id of ['U-C', 'U-O', 'U-D1']) assert.deepEqual(scanVirtualData(all[id]), [], id);
});

// ── 02-design 4절 예외 사례 9건 ──
test('예외 1 중복 추가: 월말 정산에 "대사 확인"을 다시 추가하면 거부하고 기존 노드를 알린다(R-02 ④)', () => {
  const r = addNode(all['U-A1'], { core_type: 'work', label: ' 대사 확인 ' }, ctx);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'E-DUP');
});

test('예외 2 필수값 누락: 라벨 없는 산출물은 거부(R-02 ③)', () => {
  const r = addNode(all['U-C'], { core_type: 'artifact', label: '' }, ctx);
  assert.equal(r.error.code, 'E-REQUIRED');
});

test('예외 3 사번 없음: 교육팀 임가온은 사번이 없고 저장 경고(W-NO-EMPNO)가 있다', () => {
  const ex = ANSWERS_V1.exceptions.no_empno;
  const v = viewOf('U-C');
  assert.equal(v.getNode(ex.node).label, '임가온');
  assert.equal(v.getNode(ex.node).emp_no, undefined);
  assert.ok(validateDocument(all['U-C']).warnings.some((w) => w.code === 'W-NO-EMPNO' && w.target_id === 'N-204'));
});

test('예외 4 사번 충돌: 부서 화면에서 V-1002 윤바다/윤바다라를 충돌로 알리고 합치지 않는다(R-11 ③)', () => {
  const ex = ANSWERS_V1.exceptions.empno_conflict;
  const v = viewOf(ex.view);
  const c = v.empno_conflicts.find((x) => x.emp_no === ex.emp_no);
  assert.deepEqual(c.nodes.map((n) => n.label).sort(), [...ex.labels].sort());
  assert.notEqual(v.canonical('U-C/N-205'), v.canonical('U-A1/N-011'));
  assert.equal(describeUniverse(v).empno_conflicts.length, 1);
});

test('예외 5 이력 부족: 「신규 교육 과정」 초안은 대부분 "이력 부족"(R-03 ②)', () => {
  const ex = ANSWERS_V1.exceptions.history_short;
  const d = buildHandoverDraft(viewOf(ex.view), { target: ex.target, from: ex.from, to: ex.to }).draft;
  const short = d.items.filter((i) => i.insufficient).map((i) => i.key);
  assert.deepEqual(short, ex.insufficient_items);
  assert.equal(all['U-C'].events.filter((e) => JSON.stringify(e.payload).includes('"N-105"')).length, 0); // 이벤트 0건
});

test('예외 6 값 변경: 산출물 라벨을 고치면 수정 이벤트에 변경 전 값이 남는다(R-02 ②)', () => {
  const r = updateNode(all['U-C'], 'N-401', { label: '교육 안내문 양식 v2' }, ctx);
  assert.equal(r.ok, true);
  assert.equal(r.event.type, 'updated');
  assert.equal(r.event.payload.before.label, '교육 안내문 양식');
  assert.equal(r.event.payload.after.label, '교육 안내문 양식 v2');
});

test('예외 7 숨김 후 참조: 이전 인수인계 근거인 인수인계서를 숨겨도 근거는 "숨김"으로 남는다', () => {
  const hidden = hideNode(all['U-C'], 'N-404', ctx).doc;
  const v = viewOf('U-C', { 'U-C': hidden });
  const d = buildHandoverDraft(v, { target: 'U-C/N-101', from: 'U-C/N-202', to: 'U-C/N-201' }).draft;
  const prev = d.items.find((i) => i.key === '이전_인수인계');
  assert.ok(prev.sentences.some((s) => s.evidence_ids.includes('U-C/N-404')));
  const hit = v.lookup('U-C/N-404');
  assert.ok(hit.found && hit.hidden);
});

test('예외 8 순환 참조: 팀이 이미 참조하는 업무 유니버스가 그 팀을 다시 참조하면 거부', () => {
  const r = addRef(all['U-A1'], 'U-T1', ctx, (id) => all[id] || null);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'E-CYCLE');
});

test('예외 9 재입사로 사번 변경: 지원 범위 제외 — 한계 목록에 기록되어 있다(R-07 ③)', () => {
  const limits = readFileSync(new URL('../docs/limits.md', import.meta.url), 'utf8');
  assert.match(limits, /재입사/);
  assert.match(limits, /사번 두 개/);
});

// ── R-14·R-05 ②: 조직관리 유니버스 ──
test('R-14: 조직개편 전후 기준일 소속이 바뀐다(정답 표 AF-*)', () => {
  for (const a of ANSWERS_V1.affiliations) {
    const v = viewOf(a.view);
    for (const [date, label] of Object.entries(a.at)) assert.equal(affiliationAt(v, a.person, date).label, label, `${a.id} ${date}`);
  }
});

test('R-14: 2026-01 개편으로 교육 기능이 옮겨 가도 교육팀의 신입 교육 운영 이력은 한 줄로 이어진다', () => {
  const v = viewOf('U-C');
  const evs = v.events.filter((e) => e.node_gids.includes('U-C/N-101')).map((e) => e.occurred_at);
  assert.ok(evs.some((d) => d < '2026-01-01') && evs.some((d) => d > '2026-01-01'));
  assert.deepEqual(evs, [...evs].sort());
});

test('R-05 ②: 조직관리는 2026-03 이후 입력이 없어 흐름은 "입력 없음", 밀집·공백은 데이터 부족(정답 표 FC-O·DG-O)', () => {
  const a = ANSWERS_V1.flow_changes.find((x) => x.id === 'FC-O');
  const r = flowChange(viewOf(a.view), { unit: a.unit, asOf: a.asOf });
  assert.equal(r.last_input, a.last_input);
  assert.equal(r.periods[0].key, a.first_period);
  assert.equal(r.periods.find((p) => p.no_data).key, a.no_data_from);
  for (const [k, n] of Object.entries(a.counts)) assert.equal(r.periods.find((p) => p.key === k).counts.total, n, k);
  const d = densityGaps(viewOf('U-O'), { asOf: ASOF });
  assert.equal(d.status, 'insufficient');
  assert.equal(d.last_input, a.last_input);
});

test('정답 표 v2의 노드·이벤트 ID는 모두 데이터에 있다(근거 ID 유효율 100%)', () => {
  const ids = [ANSWERS_V1.exceptions.no_empno.node, ANSWERS_V1.exceptions.history_short.target, ...ANSWERS_V1.affiliations.map((a) => a.person)];
  for (const g of ANSWERS_V1.density_gaps.flatMap((x) => [...x.gaps.map((y) => y.split(':')[0]), ...x.dense])) ids.push(g);
  const v = viewOf('U-D1');
  const o = viewOf('U-O');
  for (const g of ids) assert.ok(v.lookup(g).found || o.lookup(g).found || viewOf(g.split('/')[0]).lookup(g).found, g);
});

test('검토3 DATA-1: 기간이 있는 수행 연결마다 같은 날 담당 시작(끝이 있으면 담당 종료) 이벤트가 있다', () => {
  for (const d of SAMPLES) {
    for (const e of d.edges.filter((x) => x.core_type === 'performs' && x.period?.start)) {
      const has = (type, date) => d.events.some((ev) => ev.type === type && ev.occurred_at === date && ev.payload.person_id === e.source && ev.payload.work_id === e.target);
      assert.ok(has('assign_start', e.period.start), `${d.universe.id} ${e.id} 담당 시작 ${e.period.start}`);
      if (e.period.end) assert.ok(has('assign_end', e.period.end), `${d.universe.id} ${e.id} 담당 종료 ${e.period.end}`);
    }
  }
});

test('검토3 DATA-2: 교육팀 진행 순서는 강의실·강사 섭외 → 만족도 조사 → 교육 결과 보고(하위가 상위를 앞서지 않음)', () => {
  const v = viewOf('U-C');
  const d = buildHandoverDraft(v, { target: 'U-C/N-000', from: 'U-C/N-202', to: 'U-C/N-201' }).draft;
  const order = d.items.find((i) => i.key === '세부_업무_절차').sentences[0].text;
  assert.ok(order.indexOf('강의실·강사 섭외') < order.indexOf('만족도 조사') && order.indexOf('만족도 조사') < order.indexOf('교육 결과 보고'), order);
});
