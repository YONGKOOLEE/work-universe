// CR-17 F(승인 전 초안 브랜치 cr17-prep): 「관계자·연락처」에 업무와 「참조」로 이은 사람·조직(협업자)을 센다. 가상 문서로 고정한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildView } from '../app/src/view/view.js';
import { buildHandoverDraft } from '../app/src/rules/handover.js';
import { mkDoc, mkEdge, mkNode } from './helpers.js';

const ASOF = '2026-10-24';
const U = 'U-CR17';
const gid = (n) => `${U}/${n}`;
const view = (doc) => buildView(doc, () => null);
const draft = (doc, target, from = 'N-101', to = 'N-102') => buildHandoverDraft(view(doc), { target: gid(target), from: gid(from), to: gid(to), asOf: ASOF });
const item = (r, key) => r.draft.items.find((i) => i.key === key);
const texts = (r, key) => item(r, key).sentences.map((s) => s.text);

// 업무 W(N-001)·W2(N-002), 보내는 사람 N-101·받는 사람 N-102, 협업 후보: 사람 N-103(연락처 있음), 조직 N-200, 사람 N-104
function docWith(extraEdges = [], extraNodes = []) {
  const nodes = [
    mkNode('N-001', 'work', '대사 확인', { description: '매월 말 대조한다', attrs: { 절차: '수집 후 대조', '사용 시스템': '가상정산시스템' } }),
    mkNode('N-002', 'work', '보고 작성', { description: '결과를 보고한다' }),
    mkNode('N-101', 'person', '가상인1', { attrs: { 연락처: 'v1@example.test' } }),
    mkNode('N-102', 'person', '가상인2'),
    mkNode('N-103', 'person', '윤가온', { emp_no: 'V-0103', attrs: { 연락처: 'yoon@example.test' } }),
    mkNode('N-104', 'person', '한도윤'),
    mkNode('N-200', 'org', '회계팀'),
    ...extraNodes,
  ];
  const edges = [mkEdge('N-000', 'N-001', 'contains'), mkEdge('N-000', 'N-002', 'contains'), ...extraEdges];
  return mkDoc(U, nodes, edges);
}

// ── F ──
test('F: 업무가 사람을 「참조」(업무 → 사람)하면 협업자로 나오고 연락처가 함께 붙는다', () => {
  const r = draft(docWith([mkEdge('N-001', 'N-103', 'references')]), 'N-000');
  assert.equal(item(r, '관계자_연락처').insufficient, false);
  const t = texts(r, '관계자_연락처').find((x) => x.startsWith('협업:'));
  assert.equal(t, '협업: 윤가온(V-0103) — 참조 대사 확인. 연락: yoon@example.test');
  assert.deepEqual(item(r, '관계자_연락처').sentences.find((s) => s.text.startsWith('협업:')).evidence_ids, [gid('N-103')]);
});

test('F: 방향이 반대(사람 → 업무)인 「참조」와 조직도 협업자이고, 연락처가 없으면 연락 문구 없이 나온다', () => {
  const r = draft(docWith([mkEdge('N-104', 'N-002', 'references'), mkEdge('N-200', 'N-001', 'references')]), 'N-000');
  const t = texts(r, '관계자_연락처').filter((x) => x.startsWith('협업:'));
  assert.deepEqual(t.sort(), ['협업: 한도윤 — 참조 보고 작성', '협업: 회계팀 — 참조 대사 확인']);
});

test('F: 같은 사람이 여러 업무를 참조하면 한 문장에 업무 이름을 모은다', () => {
  const r = draft(docWith([mkEdge('N-001', 'N-103', 'references'), mkEdge('N-002', 'N-103', 'references')]), 'N-000');
  const t = texts(r, '관계자_연락처').filter((x) => x.startsWith('협업:'));
  assert.equal(t.length, 1);
  assert.match(t[0], /참조 대사 확인, 보고 작성/);
});

test('F: 보내는·받는 사람, 숨긴 노드, 숨긴 연결, 범위 밖 업무의 참조, 사람·조직이 아닌 노드는 세지 않는다', () => {
  const doc = docWith(
    [
      mkEdge('N-001', 'N-101', 'references'), // 보내는 사람
      mkEdge('N-001', 'N-102', 'references'), // 받는 사람
      mkEdge('N-001', 'N-300', 'references'), // 숨긴 사람
      mkEdge('N-001', 'N-103', 'references', { hidden: true }), // 숨긴 연결
      mkEdge('N-001', 'N-301', 'references'), // 산출물(사람·조직이 아님)
      mkEdge('N-400', 'N-104', 'references'), // 범위 밖 업무
    ],
    [mkNode('N-300', 'person', '숨은인', { hidden: true }), mkNode('N-301', 'artifact', '점검표'), mkNode('N-400', 'work', '다른 업무')],
  );
  const r = draft(doc, 'N-001'); // 대상이 업무: 범위는 그 업무뿐
  assert.deepEqual(texts(r, '관계자_연락처').filter((x) => x.startsWith('협업:')), []);
  // 보내는 사람의 연락처 문의 문장은 그대로 남는다(기존 동작)
  assert.match(texts(r, '관계자_연락처')[0], /^문의: 보내는 사람 가상인1/);
});

test('F: 「수행」으로 이은 사람은 기존 문장 그대로이고, 같은 사람을 「참조」로 또 이어도 협업 문장은 겹치지 않는다', () => {
  const r = draft(docWith([mkEdge('N-103', 'N-001', 'performs'), mkEdge('N-001', 'N-103', 'references'), mkEdge('N-001', 'N-200', 'references')]), 'N-000');
  const all = texts(r, '관계자_연락처');
  assert.ok(all.includes('윤가온(V-0103) — 대사 확인. 연락: yoon@example.test'));
  assert.equal(all.filter((x) => x.includes('윤가온')).length, 1);
  assert.ok(all.includes('협업: 회계팀 — 참조 대사 확인'));
});

test('F: 참조도 수행도 없으면 지금처럼 이력 부족(받는 사람에게 자신을 알려 줄 필요가 없는 보내는 사람 문의만 있을 때는 문의만)', () => {
  const none = draft(docWith(), 'N-000');
  assert.equal(item(none, '관계자_연락처').sentences.filter((s) => !s.text.startsWith('문의:')).length, 0);
  const noContact = mkDoc(U, [mkNode('N-001', 'work', '대사 확인'), mkNode('N-101', 'person', '가상인1'), mkNode('N-102', 'person', '가상인2')], [mkEdge('N-000', 'N-001', 'contains')]);
  assert.equal(item(draft(noContact, 'N-000'), '관계자_연락처').insufficient, true);
});
