import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildView } from '../app/src/view/view.js';
import { describeNode, describeUniverse, eventText, periodText } from '../app/src/view/describe.js';
import { hideNode, updateNode } from '../app/src/model/commands.js';
import { SAMPLE_A1 } from '../app/data/sample-a1.js';
import { EXAMPLE_12_6 } from './fixtures/example-12-6.js';

const view = buildView(SAMPLE_A1);
const T = { now: '2026-10-01T10:00:00+09:00' };

test('기간 표시: 끝이 없으면 진행 중, 없으면 빈 문자열', () => {
  assert.equal(periodText({ start: '2026-10-01' }), '2026-10-01 ~ 진행 중');
  assert.equal(periodText({ start: '2025-03-01', end: '2026-05-31' }), '2025-03-01 ~ 2026-05-31');
  assert.equal(periodText(undefined), '');
});

test('노드 상세(R-01 ①): 속성과 연결된 노드가 함께 나온다', () => {
  const d = describeNode(view, 'U-A1/N-001');
  assert.equal(d.found, true);
  assert.equal(d.title, '대사 확인');
  const row = (label) => d.rows.find((r) => r.label === label)?.value;
  assert.equal(row('유형'), '업무');
  assert.equal(row('주기'), '매월');
  assert.match(row('설명'), /원천 자료와 대조/);
  assert.equal(row('출처'), '이 유니버스(월말 정산 점검)');
  const rels = d.links.map((l) => `${l.direction}:${l.relation}:${l.other.label}`);
  assert.ok(rels.includes('in:포함:월말 정산 점검'));
  assert.ok(rels.includes('in:수행:서하늘'));
  assert.ok(rels.includes('out:관련:대사 불일치'));
  assert.ok(rels.includes('out:산출:2026-06 인수인계서'));
  assert.equal(d.no_links, false);
});

test('연결 표시: 담당 기간이 붙고 관계 유형 순서로 정렬된다', () => {
  const d = describeNode(view, 'U-A1/N-001');
  const performs = d.links.filter((l) => l.relation_type === 'performs');
  assert.deepEqual(
    performs.map((l) => `${l.other.label} ${l.period}`).sort(),
    ['서하늘 2026-10-01 ~ 진행 중', '윤바다 2026-06-01 ~ 2026-09-30', '한가람 2025-03-01 ~ 2026-05-31'],
  );
  const order = ['contains', 'performs', 'produces', 'precedes', 'relates_to'];
  const seen = d.links.map((l) => l.relation_type);
  assert.deepEqual(seen, [...seen].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
});

test('연결 없는 노드는 no_links이고 이력만 보인다(R-01 ②)', () => {
  const v = buildView(EXAMPLE_12_6);
  const d = describeNode(v, 'U-A1/N-010'); // 한가람: 이 예시에는 연결이 없다
  assert.equal(d.found, true);
  assert.equal(d.no_links, true);
  assert.deepEqual(d.links, []);
  assert.ok(d.history.length >= 1);
});

test('이력: 시간순이고 사람이 읽는 문장으로 나온다(R-14)', () => {
  const d = describeNode(view, 'U-A1/N-010');
  assert.deepEqual(d.history.map((h) => h.date), [...d.history.map((h) => h.date)].sort());
  const texts = d.history.map((h) => `${h.date} ${h.type_label}: ${h.text}`);
  assert.ok(texts.includes('2025-03-01 담당 시작: 한가람 담당 시작 — 대사 확인'));
  assert.ok(texts.some((t) => t.startsWith('2026-01-01 소속 변경: 한가람 소속 변경: 조직개편')));
  assert.ok(texts.includes('2026-06-01 인수인계: 한가람 → 윤바다 인수인계 — 대사 확인 (근거: 2026-06 인수인계서). 문서로 인수인계'));
});

test('이벤트 문장: 인수인계서가 없으면 그렇게 밝히고, 메모는 내용을 그대로 보인다', () => {
  const byId = (id) => view.events.find((e) => e.id === id);
  assert.match(eventText(view, byId('E-007')), /윤바다 → 서하늘 인수인계 — 대사 확인 \(인수인계서 없음\)/);
  assert.equal(eventText(view, byId('E-006')), '대사 불일치 3건 재발');
});

test('수정 이벤트는 바뀐 필드와 변경 전 값을 보인다', () => {
  const doc = updateNode(SAMPLE_A1, 'N-020', { label: '2026-06 인수인계서(수정)' }, T).doc;
  const d = describeNode(buildView(doc), 'U-A1/N-020');
  const last = d.history.at(-1);
  assert.equal(last.type_label, '수정');
  assert.equal(last.text, '수정 — 라벨: 2026-06 인수인계서 → 2026-06 인수인계서(수정)');
});

test('숨긴 노드도 상세는 나오고 hidden으로 알린다. 이력 문장에는 "숨김 처리된 노드"가 붙는다', () => {
  const v = buildView(hideNode(SAMPLE_A1, 'N-020', T).doc);
  const d = describeNode(v, 'U-A1/N-020');
  assert.equal(d.found, true);
  assert.equal(d.hidden, true);
  assert.equal(d.title, '2026-06 인수인계서');
  const h = describeNode(v, 'U-A1/N-011').history.find((x) => x.type_label === '인수인계');
  assert.match(h.text, /근거: 2026-06 인수인계서\(숨김 처리된 노드\)/);
});

test('없는 노드는 found:false', () => {
  assert.deepEqual(describeNode(view, 'U-A1/N-999'), { found: false });
});

test('유니버스 개요: 유형별 개수와 이력 기간', () => {
  const s = describeUniverse(view);
  assert.equal(s.name, '월말 정산 점검');
  assert.equal(s.node_total, 10);
  assert.equal(s.edge_total, 11);
  assert.deepEqual(s.counts.find((c) => c.type_label === '사람'), { type_label: '사람', count: 3 });
  assert.deepEqual(s.period, { first: '2025-03-01', last: '2026-10-01' });
});
