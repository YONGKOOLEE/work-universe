// CR-13 나란히 재검증(2026-10-18) 뒤 고친 것: 상위 묶음 동일성 연결이 가리키는 노드는 통째 삭제하지 않음,
// 완전히 삭제한 노드의 옛 수정 이력 표시, 표 연결 칸 이름 길이 오류의 칸
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addNode, canDeleteNow, createUniverse, deleteNodeNow, hideNode, purgeNode, updateNode } from '../app/src/model/commands.js';
import { newRowsToOps, parseTable } from '../app/src/model/table.js';
import { buildView } from '../app/src/view/view.js';
import { eventText } from '../app/src/view/describe.js';

const ctx = { now: '2026-10-18T10:00:00+09:00' };
const base = () => createUniverse({ name: '가상 시험', level: '업무', owner: '가상 시험팀' }, ctx).doc;

test('다른 유니버스가 가리키면(externalRefs) 바로 삭제 거부, 완전히 삭제는 통째가 아니라 자리표시', () => {
  const a = addNode(base(), { core_type: 'person', label: '가상갑' }, ctx);
  assert.equal(canDeleteNow(a.doc, a.node.id).ok, true);
  const can = canDeleteNow(a.doc, a.node.id, { externalRefs: true });
  assert.equal(can.ok, false);
  assert.ok(can.reasons.includes('external'));
  assert.equal(deleteNodeNow(a.doc, a.node.id, ctx, { externalRefs: true }).ok, false);
  const h = hideNode(a.doc, a.node.id, ctx);
  const p = purgeNode(h.doc, a.node.id, ctx, { externalRefs: true });
  assert.equal(p.ok, true);
  assert.ok(!p.removed);
  const left = p.doc.nodes.find((n) => n.id === a.node.id);
  assert.equal(left.deleted, true);
  // 가리키는 곳이 없으면 지금처럼 통째로
  assert.equal(purgeNode(h.doc, a.node.id, ctx).removed, true);
});

test('완전히 삭제한 노드의 옛 수정 이력은 「수정(내용 지움)」으로 보이고 옛 값은 남지 않음', () => {
  const a = addNode(base(), { core_type: 'work', label: '비밀 업무 이름' }, ctx);
  const b = addNode(a.doc, { core_type: 'person', label: '가상을' }, ctx); // 다른 노드 — 자리표시가 되도록 아래에서 이력을 걸지 않으므로 통째 삭제됨
  const u = updateNode(b.doc, a.node.id, { description: '지워야 할 설명' }, ctx);
  const h = hideNode(u.doc, a.node.id, ctx);
  const p = purgeNode(h.doc, a.node.id, ctx, { externalRefs: true }); // 자리표시 경로
  assert.ok(!JSON.stringify(p.doc).includes('지워야 할 설명'));
  assert.ok(!JSON.stringify(p.doc).includes('비밀 업무 이름'));
  const view = buildView(p.doc);
  const old = p.doc.events.find((ev) => ev.type === 'updated' && ev.payload.cleared);
  assert.ok(old, '값을 지운 수정 이력에 cleared 표시');
  assert.equal(eventText(view, old), '수정(내용 지움)');
});

test('표 연결 칸의 이름이 너무 길면 이름 칸이 아니라 연결 칸 오류(field links)', () => {
  const doc = base();
  const ops = newRowsToOps(parseTable(`유형\t이름\t담당자\n업무\t가상 업무\t${'가'.repeat(101)}`).rows, { doc });
  const bad = ops.find((o) => o.op === 'invalid');
  assert.ok(bad);
  assert.equal(bad.error.field, 'links');
  assert.equal(bad.error.too_long, 100);
});
