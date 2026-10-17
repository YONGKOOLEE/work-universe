// CR-13 D 노드 삭제: 바로 삭제(canDeleteNow·deleteNodeNow)와 숨긴 뒤 완전히 삭제(purgeNode, 자리표시)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addEdge, addEvent, addNode, canDeleteNow, deleteNodeNow, hideNode, purgeNode, restoreNode, updateNode } from '../app/src/model/commands.js';
import { createApp } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import { validateDocument } from '../app/src/model/validate.js';
import { previewImport } from '../app/src/model/import.js';
import { buildView } from '../app/src/view/view.js';
import { describeNode, displayName, eventText } from '../app/src/view/describe.js';
import { hiddenNodesOf } from '../app/src/rules/hidden.js';
import { SAMPLES } from '../app/data/index.js';
import { EXAMPLE_12_6 } from './fixtures/example-12-6.js';
import { clone, deepFreeze } from './helpers.js';

const T1 = { now: '2026-10-01T10:00:00+09:00' };
const T2 = { now: '2026-10-02T10:00:00+09:00' };
const T3 = { now: '2026-10-03T10:00:00+09:00' };
const base = deepFreeze(clone(EXAMPLE_12_6));
const reasonsOf = (r) => r.error.reasons;

// 막 만든 노드(아무도 가리키지 않음)가 하나 있는 문서
function withFresh() {
  const r = addNode(base, { core_type: 'work', label: '막 만든 실수 노드', description: '실수', tags: ['a'] }, T1);
  assert.equal(r.ok, true);
  return { doc: r.doc, id: r.node.id };
}

// ── canDeleteNow ──
test('canDeleteNow: 막 만든 노드는 가능, 꼭지·없는 노드는 불가', () => {
  const { doc, id } = withFresh();
  assert.deepEqual(canDeleteNow(doc, id), { ok: true, reasons: [], edge_count: 0 });
  assert.deepEqual(canDeleteNow(doc, 'N-000').reasons, ['root', 'edges']);
  assert.deepEqual(canDeleteNow(doc, 'N-999').reasons, ['not_found']);
});

test('canDeleteNow: 연결이 있으면 불가(숨긴 연결도)', () => {
  const { doc, id } = withFresh();
  const e = addEdge(doc, { source: id, target: 'N-030', core_type: 'relates_to' }, T2);
  assert.equal(e.ok, true);
  assert.deepEqual(canDeleteNow(e.doc, id).reasons, ['edges']);
  assert.equal(canDeleteNow(e.doc, id).edge_count, 1);
  const hiddenEdge = { ...e.doc, edges: e.doc.edges.map((x) => (x.id === e.edge.id ? { ...x, hidden: true } : x)) };
  assert.deepEqual(canDeleteNow(hiddenEdge, id).reasons, ['edges']);
});

test('canDeleteNow: 메모·담당·인수인계·소속 변경 이벤트가 가리키면 불가, 자기 수정 이력만 있으면 가능', () => {
  const { doc, id } = withFresh();
  const upd = updateNode(doc, id, { description: '고침' }, T2);
  assert.equal(canDeleteNow(upd.doc, id).ok, true); // 자신의 created·updated만
  const hid = hideNode(upd.doc, id, T3);
  assert.equal(canDeleteNow(hid.doc, id).ok, true); // 숨김 이벤트도 자기 이력
  const memo = addEvent(doc, { type: 'memo', occurred_at: '2026-10-02', note: '메모', payload: { target_id: id } }, T2);
  assert.equal(memo.ok, true);
  assert.deepEqual(canDeleteNow(memo.doc, id).reasons, ['events']);
  const topicMemo = addNode(base, { core_type: 'topic', label: '주제' }, T1);
  const m2 = addEvent(topicMemo.doc, { type: 'memo', occurred_at: '2026-10-02', note: '주제 메모', payload: { target_id: 'N-001', topic_ids: [topicMemo.node.id] } }, T2);
  assert.equal(m2.ok, true);
  assert.deepEqual(canDeleteNow(m2.doc, topicMemo.node.id).reasons, ['events']); // nodeListRefs
  // 인수인계(E-002)가 가리키는 산출물, 소속 변경(E-001)이 가리키는 사람
  assert.ok(canDeleteNow(base, 'N-020').reasons.includes('events'));
  assert.ok(canDeleteNow(base, 'N-010').reasons.includes('events'));
});

test('canDeleteNow: identity_links에 나오면 불가', () => {
  const { doc, id } = withFresh();
  const linked = { ...doc, identity_links: [{ id: 'I-1', a: `U-A1/${id}`, b: 'U-X/N-1', kind: 'work', method: 'human', status: 'pending' }] };
  assert.deepEqual(canDeleteNow(linked, id).reasons, ['identity_links']);
});

test('canDeleteNow: 노드 추가 양식이 자동으로 붙이는 「꼭지 → 노드 포함」 연결만 있으면 가능, 바로 삭제하면 그 연결과 이력도 빠진다', () => {
  const { doc, id } = withFresh();
  const e = addEdge(doc, { source: 'N-000', target: id, core_type: 'contains' }, T2);
  assert.equal(canDeleteNow(e.doc, id).ok, true);
  // 메모가 붙은 연결이나 기간이 있는 연결은 자동 연결로 보지 않는다
  const noted = addEdge(doc, { source: 'N-000', target: id, core_type: 'contains', note: '메모' }, T2);
  assert.deepEqual(canDeleteNow(noted.doc, id).reasons, ['edges']);
  const r = deleteNodeNow(e.doc, id, T3);
  assert.equal(r.ok, true);
  assert.equal(r.doc.edges.length, base.edges.length);
  assert.equal(r.doc.events.length, base.events.length);
  assert.equal(validateDocument(r.doc).ok, true);
});

// ── deleteNodeNow ──
test('deleteNodeNow: 노드와 자기 created·updated 이벤트를 뺀다(검증 통과, 원본 불변)', () => {
  const { doc, id } = withFresh();
  const upd = updateNode(doc, id, { description: '고침' }, T2).doc;
  const frozen = deepFreeze(clone(upd));
  const r = deleteNodeNow(frozen, id, T3);
  assert.equal(r.ok, true);
  assert.equal(r.doc.nodes.some((n) => n.id === id), false);
  assert.equal(r.doc.events.some((e) => e.payload && e.payload.target_id === id), false);
  assert.equal(r.doc.nodes.length, base.nodes.length);
  assert.equal(r.doc.events.length, base.events.length);
  assert.equal(validateDocument(r.doc).ok, true);
  assert.equal(frozen.nodes.some((n) => n.id === id), true);
});

test('deleteNodeNow: 조건이 안 맞으면 E-SCHEMA(in_use, 이유 목록)', () => {
  const r = deleteNodeNow(base, 'N-001', T1);
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'E-SCHEMA');
  assert.equal(r.error.reason, 'in_use');
  assert.ok(reasonsOf(r).includes('edges') && reasonsOf(r).includes('events'));
  assert.equal(deleteNodeNow(base, 'N-000', T1).ok, false);
  assert.equal(deleteNodeNow(base, 'N-999', T1).ok, false);
});

// ── purgeNode ──
test('purgeNode: 숨기지 않은 노드는 거부', () => {
  const r = purgeNode(base, 'N-001', T1);
  assert.equal(r.ok, false);
  assert.equal(r.error.reason, 'not_hidden');
  assert.equal(purgeNode(base, 'N-000', T1).ok, false);
  assert.equal(purgeNode(base, 'N-999', T1).ok, false);
});

test('purgeNode: 아무도 가리키지 않는 숨긴 노드는 통째로 빠진다', () => {
  const { doc, id } = withFresh();
  const hid = hideNode(doc, id, T2).doc;
  const r = purgeNode(hid, id, T3);
  assert.equal(r.ok, true);
  assert.equal(r.removed, true);
  assert.equal(r.doc.nodes.some((n) => n.id === id), false);
  assert.equal(r.doc.events.length, base.events.length);
  assert.equal(validateDocument(r.doc).ok, true);
});

function purgedArtifact() {
  // N-020(산출물): 인수인계 이벤트가 가리킨다. 설명·태그·속성을 넣어 지워지는지 본다
  let d = clone(base);
  d.nodes = d.nodes.map((n) => (n.id === 'N-020' ? { ...n, description: '비밀 설명', tags: ['t1'], attrs: { 키: '값' }, period: { start: '2026-01-01' } } : n));
  const upd = updateNode(d, 'N-020', { label: '고친 이름', description: '더 비밀 설명' }, T1);
  assert.equal(upd.ok, true);
  const hid = hideNode(upd.doc, 'N-020', T2).doc;
  return { hid, r: purgeNode(hid, 'N-020', T3) };
}

test('purgeNode: 자리표시로 비운다(필드 제거·deleted·hidden 유지·이벤트 유지)', () => {
  const { hid, r } = purgedArtifact();
  assert.equal(r.ok, true);
  const n = r.doc.nodes.find((x) => x.id === 'N-020');
  assert.deepEqual(Object.keys(n).sort(), ['core_type', 'created_at', 'deleted', 'hidden', 'id', 'label', 'updated_at']);
  assert.equal(n.label, '(삭제된 노드)');
  assert.equal(n.deleted, true);
  assert.equal(n.hidden, true);
  assert.equal(n.updated_at, T3.now);
  // 다른 이벤트(인수인계)는 그대로
  assert.deepEqual(r.doc.events.find((e) => e.id === 'E-002'), base.events.find((e) => e.id === 'E-002'));
  // 이력 한 줄: deleted false → true, 지운 필드 이름만
  assert.equal(r.event.type, 'updated');
  assert.deepEqual(r.event.payload.before, { deleted: false });
  assert.deepEqual(r.event.payload.after, { deleted: true });
  assert.ok(['label', 'description', 'subtype', 'tags', 'attrs', 'period'].every((k) => r.event.payload.cleared_fields.includes(k)));
  assert.equal(r.doc.events.length, hid.events.length + 1);
  assert.equal(validateDocument(r.doc).ok, true);
});

test('purgeNode: 지운 값은 이력 어디에도 남지 않는다(예전 수정 이력 포함)', () => {
  const { r } = purgedArtifact();
  const text = JSON.stringify(r.doc);
  for (const secret of ['비밀 설명', '더 비밀 설명', '고친 이름', '2026-06 인수인계서', '인수인계서"', '값']) {
    if (secret === '인수인계서"') continue; // 하위 유형 이름은 유니버스 subtypes 목록에 남는다
    if (secret === '값') continue; // 다른 노드의 속성 값과 겹칠 수 있는 한 글자
    assert.equal(text.includes(secret), false, secret);
  }
});

test('purgeNode: 붙은 연결(숨긴 것 포함)과 그 연결의 이력을 뺀다', () => {
  const hid = hideNode(base, 'N-030', T1).doc;
  const hiddenEdge = hideEdgeOf(hid, 'L-003');
  const added = addEdge(base, { source: 'N-010', target: 'N-001', core_type: 'performs', period: { start: '2026-02-01' } }, T1);
  assert.equal(added.ok, true);
  // 연결 3개가 모두 N-030에 붙은 경우: 기존 L-003 + 새로 만든 연결(이력 포함)
  const e2 = addEdge(hid, { source: 'N-001', target: 'N-030', core_type: 'relates_to', period: { start: '2026-03-01' } }, T2);
  // 숨긴 노드에는 새 연결이 안 되므로, 연결을 먼저 만든 뒤 숨긴다
  assert.equal(e2.ok, false);
  const withEdge = addEdge(base, { source: 'N-010', target: 'N-030', core_type: 'relates_to' }, T1);
  assert.equal(withEdge.ok, true);
  const hid2 = hideNode(withEdge.doc, 'N-030', T2).doc;
  const r = purgeNode(hid2, 'N-030', T3);
  assert.equal(r.ok, true);
  assert.equal(r.removed_edges, 2);
  assert.equal(r.doc.edges.some((e) => e.source === 'N-030' || e.target === 'N-030'), false);
  assert.equal(r.doc.events.some((e) => e.payload && e.payload.target_kind === 'edge' && e.payload.target_id === withEdge.edge.id), false);
  assert.equal(validateDocument(r.doc).ok, true);
  assert.ok(hiddenEdge); // 숨긴 연결 보조 함수 사용 확인
  // 숨긴 연결도 뺀다
  const hid3 = hideNode(hideEdgeOf(base, 'L-003'), 'N-030', T2).doc;
  const r3 = purgeNode(hid3, 'N-030', T3);
  assert.equal(r3.doc.edges.some((e) => e.id === 'L-003'), false);
  assert.equal(validateDocument(r3.doc).ok, true);
});

function hideEdgeOf(doc, edgeId) {
  return { ...doc, edges: doc.edges.map((e) => (e.id === edgeId ? { ...e, hidden: true } : e)) };
}

test('purgeNode: 되살리기 거부, 이미 삭제한 노드는 다시 purge해도 변화 없음, 수정 거부', () => {
  const { r } = purgedArtifact();
  const back = restoreNode(r.doc, 'N-020', T3);
  assert.equal(back.ok, false);
  assert.equal(back.error.code, 'E-SCHEMA');
  assert.equal(back.error.deleted, true);
  const again = purgeNode(r.doc, 'N-020', T3);
  assert.equal(again.ok, true);
  assert.equal(again.event, null);
  assert.equal(again.doc, r.doc);
  assert.equal(updateNode(r.doc, 'N-020', { label: '새 이름' }, T3).ok, false);
});

test('purgeNode: 가져오기·내보내기 왕복에서 deleted가 유지된다', () => {
  const { r } = purgedArtifact();
  const copy = JSON.parse(JSON.stringify(r.doc));
  assert.equal(validateDocument(copy).ok, true);
  assert.equal(copy.nodes.find((n) => n.id === 'N-020').deleted, true);
  const p = previewImport(copy, { existing: [], resolve: () => null, sampleIds: [] });
  assert.equal(p.ok, true);
});

test('validate: deleted는 boolean이고, true이면 hidden이어야 한다', () => {
  const bad = clone(base);
  bad.nodes[1].deleted = 'yes';
  assert.equal(validateDocument(bad).ok, false);
  const bad2 = clone(base);
  bad2.nodes[1].deleted = true; // hidden: false
  assert.equal(validateDocument(bad2).ok, false);
  const ok = clone(base);
  ok.nodes[1].deleted = false;
  assert.equal(validateDocument(ok).ok, true);
  const ok2 = clone(base);
  Object.assign(ok2.nodes[1], { deleted: true, hidden: true });
  assert.equal(validateDocument(ok2).ok, true);
});

test('결함 주입: 가리키는 이력이 있는데 통째로 빼면 검증이 깨진다(그래서 자리표시로 남긴다)', () => {
  const broken = { ...base, nodes: base.nodes.filter((n) => n.id !== 'N-020') };
  assert.equal(validateDocument(broken).ok, false);
  const { r } = purgedArtifact();
  assert.equal(validateDocument(r.doc).ok, true);
});

// ── 화면에 보이는 모양 ──
test('메모·인수인계가 자리표시 노드를 가리키면 「(삭제된 노드)」로 보인다', () => {
  const { r } = purgedArtifact();
  const v = buildView(r.doc, () => null);
  const node = v.getNode('U-A1/N-020');
  assert.equal(node.deleted, true);
  assert.equal(displayName(node), '(삭제된 노드)');
  const ev = v.events.find((e) => e.id === 'E-002');
  assert.match(eventText(v, ev), /\(삭제된 노드\)/);
  assert.doesNotMatch(eventText(v, ev), /숨김 처리된/);
  const own = v.events.find((e) => e.payload && e.payload.after && e.payload.after.deleted === true);
  assert.match(eventText(v, own), /^완전히 삭제\(내용 지움: /);
  // 상세에서도 이력 문장이 같다
  const d = describeNode(v, 'U-A1/N-001', { asOf: '2026-10-05' });
  assert.ok(d.history.some((h) => /\(삭제된 노드\)/.test(h.text)));
});

test('숨긴 노드 목록에서 자리표시 노드는 빠지고, 남은 숨긴 노드에는 연결 수가 붙는다', () => {
  const { r } = purgedArtifact();
  assert.deepEqual(hiddenNodesOf(r.doc), []);
  const h = hideNode(base, 'N-030', T1).doc;
  const list = hiddenNodesOf(h);
  assert.equal(list.length, 1);
  assert.equal(list[0].edge_count, 1);
});

test('사번 자동 연결: 자리표시 노드는 대표가 되지 않고 합쳐지지 않는다', () => {
  const mk = (id, empNo, extra = {}) => ({ id, core_type: 'person', label: `사람${id}`, emp_no: empNo, hidden: false, ...extra });
  const A = { ...clone(base), universe: { ...base.universe, id: 'U-A1' } };
  const B = {
    schema_version: '1.0', universe: { id: 'U-B', name: 'B', level: '업무', owner: 'x', root_node_id: 'R-B' },
    nodes: [{ id: 'R-B', core_type: 'root', label: 'B', hidden: false }, mk('P-1', 'V-9001')],
    edges: [{ id: 'LB-1', source: 'R-B', target: 'P-1', core_type: 'contains', hidden: false }],
    events: [], refs: [], identity_links: [],
  };
  A.nodes.push(mk('P-A', 'V-9001'));
  A.refs = [{ child_universe_id: 'U-B', hidden: false }];
  A.identity_links = [{ id: 'I-1', a: 'U-A1/P-A', b: 'U-B/P-1', kind: 'person', method: 'emp_no_auto', status: 'confirmed' }];
  const resolve = (id) => (id === 'U-B' ? B : null);
  const v0 = buildView(A, resolve);
  assert.equal(v0.canonical('U-B/P-1'), v0.canonical('U-A1/P-A'));
  // P-A를 자리표시로(인수인계 이벤트가 가리키도록 해 통째 삭제가 아닌 자리표시가 되게 한다)
  const ref = addEvent(A, { type: 'affiliation_change', occurred_at: '2026-10-01', payload: { person_id: 'P-A' } }, T1);
  assert.equal(ref.ok, true);
  const hid = hideNode(ref.doc, 'P-A', T2).doc;
  const p = purgeNode(hid, 'P-A', T3);
  assert.equal(p.ok, true);
  assert.equal(p.doc.identity_links.length, 1); // 링크는 그대로
  const v = buildView(p.doc, resolve);
  const rep = v.getNode(v.canonical('U-B/P-1'));
  assert.equal(rep.gid, 'U-B/P-1');
  assert.equal(rep.hidden, false);
  assert.equal(v.canonical('U-A1/P-A'), 'U-A1/P-A'); // 합쳐지지 않음
  assert.equal(v.getNode('U-A1/P-A').deleted, true);
  assert.deepEqual(v.staleLinks || [], []); // 「다시 확인」 목록에 오르지 않음
});

test('내장 샘플 7개는 deleted가 없고 buildView 결과에 deleted 노드가 없다', () => {
  for (const s of SAMPLES) {
    assert.equal(s.nodes.some((n) => n.deleted), false);
    const v = buildView(s, () => null);
    assert.equal(v.nodes.some((n) => n.deleted), false);
  }
});

// ── app: 저장 한 번 ──
function memoryStorage() {
  const m = new Map();
  const log = [];
  return { log, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { log.push(k); m.set(k, String(v)); }, removeItem: (k) => m.delete(k) };
}
const open = (storage) => createApp({ store: createStore(storage), samples: SAMPLES, currentId: SAMPLES[0].universe.id, now: () => '2026-10-04T09:00:00+09:00' });
const writes = (s) => s.log.filter((k) => k.startsWith('wu:v1:u:')).length;

test('app.deleteNodeNow·purgeNode: 저장은 문서 1회, 다시 열어도 유지', () => {
  const storage = memoryStorage();
  const app = open(storage);
  const a = app.addNode({ core_type: 'work', label: '삭제할 새 업무' });
  assert.equal(a.ok, true);
  assert.equal(app.canDeleteNow(a.node.id).ok, true);
  const w0 = writes(storage);
  const r = app.deleteNodeNow(a.node.id);
  assert.equal(r.ok, true);
  assert.equal(writes(storage), w0 + 1);
  assert.equal(open(storage).doc.nodes.some((n) => n.id === a.node.id), false);

  // 연결 있는 노드: 바로 삭제 거부 → 숨김 → 완전히 삭제(저장 1회)
  const b = app.addNode({ core_type: 'work', label: '연결 있는 새 업무' });
  const c = app.addNode({ core_type: 'work', label: '이을 상대 업무' });
  const e = app.addEdge({ source: b.node.id, target: c.node.id, core_type: 'contains' });
  assert.equal(e.ok, true);
  assert.equal(app.deleteNodeNow(b.node.id).ok, false);
  assert.equal(app.purgeNode(b.node.id).ok, false); // 숨기기 전
  assert.equal(app.hideNode(b.node.id).ok, true);
  const w1 = writes(storage);
  const p = app.purgeNode(b.node.id);
  assert.equal(p.ok, true);
  assert.equal(writes(storage), w1 + 1);
  const reopened = open(storage).doc;
  const n = reopened.nodes.find((x) => x.id === b.node.id);
  assert.equal(n.deleted, true); // 연결이 있었으므로 자리표시로 남는다
  assert.equal(n.label, '(삭제된 노드)');
  assert.equal(reopened.edges.some((x) => x.id === e.edge.id), false);
});

test('app.purgeNode: 읽기 전용이면 거부', () => {
  const app = createApp({ store: null, samples: SAMPLES, currentId: SAMPLES[0].universe.id, now: () => '2026-10-04T09:00:00+09:00' });
  const id = app.doc.nodes.find((n) => n.core_type !== 'root').id;
  assert.equal(app.purgeNode(id).ok, false);
  assert.equal(app.deleteNodeNow(id).ok, false);
});
