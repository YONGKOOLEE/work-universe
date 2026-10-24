// 다섯 번째 검토 I-12: 규칙별로 빠져 있던 긍정·부정 조합. 구현은 바꾸지 않고 지금 동작을 고정한다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLES } from '../app/data/index.js';
import { SAMPLE_A1 } from '../app/data/sample-a1.js';
import { createApp } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import { addEdge, addEvent, addNode, createUniverse } from '../app/src/model/commands.js';
import { buildView } from '../app/src/view/view.js';
import { RECENT_MEMO_COUNT, buildHandoverDraft } from '../app/src/rules/handover.js';
import { WEIGHTS, repeatInefficiency, similarExperts } from '../app/src/rules/insight.js';
import { explainInsight } from '../app/src/llm/connector.js';
import { clone } from './helpers.js';

const T0 = { now: '2026-10-03T10:00:00+09:00' };
const ASOF = '2026-10-03';
const texts = (d, key) => d.items.find((i) => i.key === key).sentences.map((s) => s.text);

// 업무 둘과 담당자 하나로 된 작은 유니버스. labels: [기준 업무, 비교 업무]
function twoWorks(labelA, labelB) {
  let doc = createUniverse({ name: '가상 낱말 시험', level: '업무', owner: '가상시험팀' }, T0).doc;
  const add = (input) => { doc = addNode(doc, input, T0).doc; return doc.nodes.at(-1).id; };
  const a = add({ core_type: 'work', label: labelA });
  const b = add({ core_type: 'work', label: labelB });
  const p = add({ core_type: 'person', label: '가상갑', emp_no: 'V-9001' });
  // 낱말 점수(+1)를 보려고 두 업무가 주제 하나를 공유하게 한다(낱말만 같으면 낮은 점수 후보가 된다, CR-17 B ③)
  const topic = add({ core_type: 'topic', label: '공유 주제' });
  doc = addEdge(doc, { source: a, target: topic, core_type: 'relates_to' }, T0).doc;
  doc = addEdge(doc, { source: b, target: topic, core_type: 'relates_to' }, T0).doc;
  doc = addEdge(doc, { source: p, target: b, core_type: 'performs', period: { start: '2026-01-01' } }, T0).doc;
  const gid = (id) => `${doc.universe.id}/${id}`;
  return { view: buildView(doc), a: gid(a), p: gid(p) };
}

test('유사 경험자: 주제를 공유한 업무에서 이름 낱말이 하나 겹치면 +1점(WEIGHTS.token), 흔한 낱말(업무·관리·처리·확인)은 세지 않는다', () => {
  const hit = twoWorks('정산 대사', '행사 정산');
  const r = similarExperts(hit.view, { works: [hit.a], asOf: ASOF });
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.people.map((x) => [x.gid, x.score]), [[hit.p, WEIGHTS.topic + WEIGHTS.token]]);
  const stop = twoWorks('대사 확인', '출석 확인'); // '확인'은 흔한 낱말이라 세지 않는다
  assert.deepEqual(similarExperts(stop.view, { works: [stop.a], asOf: ASOF }).people.map((x) => x.score), [WEIGHTS.topic]);
});

test('반복 비효율: 기준일 당일의 이력은 포함하고, 대상이 업무가 아니거나 없는 메모는 주제 반복에 세지 않는다', () => {
  const base = clone(SAMPLE_A1);
  // 기준일 = E-007(2026-09-30) 당일이면 그 인수인계까지 포함
  const onDay = repeatInefficiency(buildView(base), { asOf: '2026-09-30' }).patterns.find((p) => p.kind === 'handover_chain');
  assert.equal(onDay.total, 2);
  assert.equal(repeatInefficiency(buildView(base), { asOf: '2026-09-29' }).patterns.some((p) => p.kind === 'handover_chain'), false);
  // 대상 없는 메모, 주제 노드가 대상인 메모는 업무 수를 늘리지 않는다
  let doc = addEvent(base, { type: 'memo', occurred_at: '2026-10-01', payload: { topic_ids: ['N-030'], category: 'issue' }, note: '대상 없음' }, T0).doc;
  doc = addEvent(doc, { type: 'memo', occurred_at: '2026-10-01', payload: { target_id: 'N-030', topic_ids: ['N-030'], category: 'issue' }, note: '주제가 대상' }, T0).doc;
  assert.ok(!repeatInefficiency(buildView(doc)).patterns.some((p) => p.kind === 'topic_repeat'));
});

test(`초안 최근 이슈: 이슈가 ${RECENT_MEMO_COUNT}건보다 많으면 최신 ${RECENT_MEMO_COUNT}건만, 최신이 먼저`, () => {
  let doc = clone(SAMPLE_A1);
  for (const [day, note] of [['2026-10-01', '시월 첫 이슈'], ['2026-10-02', '시월 둘째 이슈']]) {
    doc = addEvent(doc, { type: 'memo', occurred_at: day, payload: { target_id: 'N-001', category: 'issue' }, note }, T0).doc;
  }
  const d = buildHandoverDraft(buildView(doc), { target: 'U-A1/N-000', from: 'U-A1/N-011', to: 'U-A1/N-012' }).draft;
  const issues = texts(d, '최근_이슈');
  assert.equal(issues.length, RECENT_MEMO_COUNT);
  assert.deepEqual(issues.slice(0, 2), ['2026-10-02 시월 둘째 이슈', '2026-10-01 시월 첫 이슈']);
  assert.ok(!issues.some((t) => t.includes('7월 점검표')), '가장 오래된 이슈는 빠진다');
});

test('초안 진행 순서: 선후행이 순환이면 순서 문장을 만들지 않고 업무는 그대로 나열한다', () => {
  const doc = clone(SAMPLE_A1);
  const stamp = doc.edges[0].created_at;
  // 명령은 순환을 막으므로(E-CYCLE) 문서를 직접 고친다: 보고(N-003) → 자료 수집(N-002)
  doc.edges.push({ id: 'L-903', source: 'N-003', target: 'N-002', core_type: 'precedes', hidden: false, created_at: stamp });
  const d = buildHandoverDraft(buildView(doc), { target: 'U-A1/N-000', from: 'U-A1/N-011', to: 'U-A1/N-012' }).draft;
  const steps = texts(d, '세부_업무_절차');
  assert.ok(!steps.some((t) => t.startsWith('진행 순서:')));
  assert.equal(steps.filter((t) => /^(대사 확인|자료 수집|보고)/.test(t)).length, 3);
});

test('초안 관계자: 보내는 사람에게 연락처가 없으면 「문의」 줄을 만들지 않는다', () => {
  const doc = clone(SAMPLE_A1);
  delete doc.nodes.find((n) => n.id === 'N-011').attrs.연락처;
  const d = buildHandoverDraft(buildView(doc), { target: 'U-A1/N-000', from: 'U-A1/N-011', to: 'U-A1/N-012' }).draft;
  assert.ok(!texts(d, '관계자_연락처').some((t) => t.startsWith('문의:')));
});

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

test('초안 확정: 같은 날 다른 받는 사람에게 한 번 더 확정하면 인수인계서 이름에 (2)가 붙고, 초안 생성 방식이 속성으로 남는다', () => {
  const storage = memoryStorage();
  const app = createApp({ store: createStore(storage), samples: SAMPLES, currentId: 'U-A1', now: () => '2026-10-03T15:00:00+09:00' });
  const confirm = (to) => app.confirmHandover({ draft: buildHandoverDraft(app.view, { target: 'U-A1/N-001', from: 'U-A1/N-012', to }).draft, text: '[확정] 본문', date: '2026-10-03' });
  const first = confirm('U-A1/N-011');
  const second = confirm('U-A1/N-010');
  assert.equal(first.ok && second.ok, true);
  const name = (r) => app.view.getNode(r.artifact).label;
  assert.notEqual(name(first), name(second));
  assert.ok(name(second).endsWith('(2)'), name(second));
  assert.equal(app.view.getNode(first.artifact).attrs['초안 생성 방식'], '규칙 기반');
});

test('초안 확정: 저장이 실패하면 아무것도 남지 않는다(중간 단계가 반쯤 저장되지 않음)', () => {
  const storage = memoryStorage();
  const app = createApp({ store: createStore(storage), samples: SAMPLES, currentId: 'U-A1', now: () => '2026-10-03T15:00:00+09:00' });
  const before = { nodes: app.doc.nodes.length, edges: app.doc.edges.length, events: app.doc.events.length, stored: storage.getItem('wu:v1:u:U-A1') };
  const draft = buildHandoverDraft(app.view, { target: 'U-A1/N-001', from: 'U-A1/N-012', to: 'U-A1/N-011' }).draft;
  const realSet = storage.setItem;
  storage.setItem = () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; };
  const r = app.confirmHandover({ draft, text: '[확정] 본문', date: '2026-10-03' });
  storage.setItem = realSet;
  assert.equal(r.ok, false);
  assert.deepEqual({ nodes: app.doc.nodes.length, edges: app.doc.edges.length, events: app.doc.events.length, stored: storage.getItem('wu:v1:u:U-A1') }, before);
});

test('인사이트 설명: 공급자 결과가 없으면 규칙 기반 그대로, 근거 범위 밖 문장이면 규칙 기반으로 대체하고 원인을 남긴다', () => {
  const view = buildView(SAMPLE_A1);
  const exists = (g) => view.exists(g);
  const req = { target: 'repeat|U-A1', evidence_ids: ['U-A1/E-002', 'U-A1/E-007'], rule: [{ text: '규칙 문장', evidence_ids: ['U-A1/E-002'] }] };
  const none = explainInsight(req, { provider: { name: 'x', method: 'llm', explain: () => null }, exists });
  assert.deepEqual([none.method, none.fallback, none.sentences], ['rule', null, req.rule]);
  const outside = explainInsight(req, { provider: { name: 'x', method: 'llm', explain: () => ({ sentences: [{ text: '범위 밖', evidence_ids: ['U-A1/N-010'] }] }) }, exists });
  assert.equal(outside.method, 'rule');
  assert.ok(outside.fallback && outside.fallback.reason.includes('근거'));
  const thrown = explainInsight(req, { provider: { name: 'x', method: 'llm', explain: () => { throw new Error('연결 끊김'); } }, exists });
  assert.equal(thrown.method, 'rule');
  assert.ok(thrown.fallback.reason.includes('연결 끊김'));
});
