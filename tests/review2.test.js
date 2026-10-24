// 2026-10-02 전체 검토(범주 2: 변경·누락·중복·쓰기 불가)에서 재현된 결함의 재발 방지
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLES } from '../app/data/index.js';
import { SAMPLE_A1 } from '../app/data/sample-a1.js';
import { addEdge, addEvent, addNode, hideNode, updateNode } from '../app/src/model/commands.js';
import { buildView } from '../app/src/view/view.js';
import { describeUniverse } from '../app/src/view/describe.js';
import { buildHandoverDraft } from '../app/src/rules/handover.js';
import { similarExperts, repeatInefficiency } from '../app/src/rules/insight.js';
import { messageFor } from '../app/src/ui/messages.js';

const ctx = { now: '2026-10-02T10:00:00+09:00' };
const docs = () => Object.fromEntries(SAMPLES.map((s) => [s.universe.id, JSON.parse(JSON.stringify(s))]));
const deptView = (all) => buildView(all['U-D1'], (id) => all[id] || null);

test('E5 같은 사번·다른 이름은 사번 충돌로 알린다(자동으로 합치지 않음)', () => {
  const all = docs();
  all['U-B'] = updateNode(all['U-B'], 'N-201', { emp_no: 'V-1001' }, ctx).doc; // 도하람에게 한가람의 사번
  const v = deptView(all);
  const c = v.empno_conflicts.find((x) => x.emp_no === 'V-1001');
  assert.deepEqual(c.nodes.map((n) => n.label).sort(), ['도하람', '한가람']);
  // T-13: 원래 샘플에도 교육팀 윤바다라(V-1002) 사번 충돌 1건이 예외 사례로 있다 → 더한 충돌과 합쳐 2건
  assert.equal(describeUniverse(v).empno_conflicts.length, 2);
  assert.deepEqual(deptView(docs()).empno_conflicts.map((x) => x.emp_no), ['V-1002']);
});

test('E6 사번 자동 연결 뒤 사번이 바뀌면 합치지 않고 "다시 확인" 목록에 올린다', () => {
  const all = docs();
  all['U-A1'] = updateNode(all['U-A1'], 'N-011', { emp_no: 'V-9999' }, ctx).doc;
  const v = deptView(all);
  assert.deepEqual(v.stale_links, ['I-001']);
  assert.notEqual(v.canonical('U-B/N-202'), v.canonical('U-A1/N-011'));
});

test('E7 합쳐진 사람의 한쪽을 숨기면 숨기지 않은 쪽이 대표가 된다', () => {
  const all = docs();
  all['U-A1'] = hideNode(all['U-A1'], 'N-011', ctx).doc;
  const v = deptView(all);
  const rep = v.getNode('U-A1/N-011');
  assert.equal(rep.gid, 'U-B/N-202');
  assert.equal(rep.hidden, false);
});

test('E9 표기만 다른 같은 이름·사번은 중복으로 본다(자모 분리, 공백 여러 칸, NBSP, 소문자 사번)', () => {
  for (const label of ['대사 확인'.normalize('NFD'), '대사  확인', '대사 확인']) {
    assert.equal(addNode(SAMPLE_A1, { core_type: 'work', label }, ctx).error.code, 'E-DUP', JSON.stringify(label));
  }
  assert.equal(addNode(SAMPLE_A1, { core_type: 'person', label: '다른 이름', emp_no: 'v-1001' }, ctx).error.code, 'E-DUP');
});

test('E10 같은 주제가 연결된 노드와 이름만 같은 노드로 둘 붙어도 점수는 한 번만 센다', () => {
  const all = docs();
  // 행사팀 2025 행사에 새 주제를 붙이고, 부서에서 그 주제를 카드승인 "대사" 주제와 같다고 확정한다
  let b = addNode(all['U-B'], { core_type: 'topic', label: '정산 대사' }, ctx);
  const tid = b.node.id;
  b = addEdge(b.doc, { source: 'N-101', target: tid, core_type: 'relates_to' }, ctx);
  all['U-B'] = b.doc;
  all['U-D1'].identity_links.push({ id: 'I-009', a: 'U-B/' + tid, b: 'U-K1/N-314', kind: 'topic', method: 'human', status: 'confirmed', decided_by: '가상', decided_at: ctx.now });
  const r = similarExperts(deptView(all), { works: ['U-A1/N-001'], asOf: '2026-10-02' });
  const yun = r.people.find((p) => p.label === '윤바다');
  assert.equal(yun.score, 3); // 예전에는 6(같은 주제를 두 번 셈)
  assert.deepEqual(yun.works[0].reasons, ['같은 주제 「대사 불일치」']); // 연결 확인된 쪽을 쓴다
});

test('E11 인수인계의 보내는 사람과 받는 사람이 같으면 거부한다', () => {
  const r = addEvent(SAMPLE_A1, { type: 'handover', occurred_at: '2026-10-02', payload: { work_id: 'N-001', from_person_id: 'N-012', to_person_id: 'N-012' } }, ctx);
  assert.deepEqual(r.error, { code: 'E-SCHEMA', field: 'to_person_id', same_person: true });
  assert.equal(messageFor(r.error), '보내는 사람과 받는 사람이 같습니다.');
});

test('E11 찾을 수 없는 다른 유니버스 참조는 "undefined"가 아니라 "(찾을 수 없는 항목)"로 표시한다', () => { // CR-18-2
  const d = addEvent(SAMPLE_A1, { type: 'handover', occurred_at: '2026-10-02', payload: { work_id: 'N-001', from_person_id: 'U-NOPE/N-1', to_person_id: 'N-012' } }, ctx).doc;
  const v = buildView(d);
  const p = repeatInefficiency(v).patterns.find((x) => x.kind === 'handover_chain');
  assert.ok(p.steps.some((s) => s.text.includes('(찾을 수 없는 항목) → 서하늘'))); // CR-18-2
  assert.ok(!JSON.stringify(p).includes('undefined'));
  const draft = buildHandoverDraft(v, { target: 'U-A1/N-000', from: 'U-A1/N-011', to: 'U-A1/N-010' }).draft;
  assert.ok(!JSON.stringify(draft).includes('U-NOPE/N-1 →'));
});

test('E12 숨긴 노드를 새 이력의 대상으로 쓰지 않고, 이전 인수인계는 인수인계 이벤트만 가리킨다', () => {
  const hidden = hideNode(SAMPLE_A1, 'N-012', ctx).doc;
  const r = addEvent(hidden, { type: 'assign_start', occurred_at: '2026-10-02', payload: { person_id: 'N-012', work_id: 'N-001' } }, ctx);
  assert.deepEqual(r.error, { code: 'E-SCHEMA', field: 'person_id', hidden: true });
  const memoRef = addEvent(SAMPLE_A1, { type: 'handover', occurred_at: '2026-10-02', payload: { work_id: 'N-001', from_person_id: 'N-012', to_person_id: 'N-010', previous_handover_id: 'E-006' } }, ctx);
  assert.equal(memoRef.error.field, 'previous_handover_id');
});

test('E13 숨긴 사람·숨긴 업무로는 인수인계 초안을 만들지 않는다', () => {
  const v1 = buildView(hideNode(SAMPLE_A1, 'N-012', ctx).doc);
  assert.deepEqual(buildHandoverDraft(v1, { target: 'U-A1/N-000', from: 'U-A1/N-011', to: 'U-A1/N-012' }).error, { code: 'E-SCHEMA', field: 'to', hidden: true });
  const v2 = buildView(hideNode(SAMPLE_A1, 'N-001', ctx).doc);
  assert.equal(buildHandoverDraft(v2, { target: 'U-A1/N-001', from: 'U-A1/N-011', to: 'U-A1/N-012' }).error.hidden, true);
});

test('E14 숨긴 노드는 고칠 수 없다(근거 내용 보존)', () => {
  const hidden = hideNode(SAMPLE_A1, 'N-020', ctx).doc;
  const r = updateNode(hidden, 'N-020', { label: '바꾼 이름' }, ctx);
  assert.deepEqual(r.error, { code: 'E-SCHEMA', field: 'id', hidden: true });
  assert.match(messageFor(r.error), /숨긴 항목은 고칠 수 없습니다/); // CR-18-2
});

test('E16 긴 글 상한: 메모 내용·설명·속성 값 2000자, 단위·작성 주체 100자', async () => {
  const long = 'ㄱ'.repeat(2001);
  assert.equal(addEvent(SAMPLE_A1, { type: 'memo', occurred_at: '2026-10-02', payload: { target_id: 'N-001' }, note: long }, ctx).error.too_long, 2000);
  assert.equal(addNode(SAMPLE_A1, { core_type: 'work', label: '새 업무', description: long }, ctx).error.field, 'description');
  assert.equal(addNode(SAMPLE_A1, { core_type: 'work', label: '새 업무', attrs: { 절차: long } }, ctx).error.field, 'attrs');
  const { createUniverse } = await import('../app/src/model/commands.js');
  assert.equal(createUniverse({ name: 'x', level: 'ㄱ'.repeat(101), owner: 'x' }, ctx).error.field, 'level');
  assert.match(messageFor({ code: 'E-SCHEMA', field: 'note', too_long: 2000 }), /너무 깁니다\(최대 2000자\)/);
  assert.equal(addEdge(SAMPLE_A1, { source: 'N-001', target: 'N-021', core_type: 'references', note: '짧은 메모' }, ctx).ok, true);
});
