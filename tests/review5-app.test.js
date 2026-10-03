// 검토5 C-8: 화면이 app.doc 내부 배열을 직접 뒤지지 않도록 둔 조회 메서드. C-2: view.exists, describe.displayName
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import { SAMPLES } from '../app/data/index.js';
import { displayName } from '../app/src/view/describe.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const now = () => '2026-10-01T12:00:00+09:00';
const open = (storage, currentId) => createApp({ store: createStore(storage), samples: SAMPLES, currentId, now });

test('findNode: 현재 문서의 노드를 ID로 찾고, 없으면 undefined', () => {
  const app = open(memoryStorage());
  const first = app.doc.nodes[0];
  assert.equal(app.findNode(first.id), first);
  assert.equal(app.findNode('없는-ID'), undefined);
  // 방금 추가한 노드도 찾는다(현재 문서를 따라간다)
  const r = app.addNode({ core_type: 'artifact', label: '새 문서' });
  assert.equal(r.ok, true);
  assert.equal(app.findNode(r.node.id).label, '새 문서');
});

test('findEdge: 현재 문서의 연결을 ID로 찾고, 없으면 undefined', () => {
  const app = open(memoryStorage());
  const first = app.doc.edges[0];
  assert.equal(app.findEdge(first.id), first);
  assert.equal(app.findEdge('없는-ID'), undefined);
});

test('subtypes: 등록된 하위 유형 배열, 없으면 빈 배열', () => {
  const storage = memoryStorage();
  const app = open(storage);
  const created = app.createUniverse({ name: '가상 빈 유니버스', level: '업무', owner: '가상' });
  assert.equal(created.ok, true);
  const empty = open(storage, created.doc.universe.id);
  assert.deepEqual(empty.subtypes(), []);
  assert.equal(empty.addSubtype('artifact', '회의록').ok, true);
  assert.deepEqual(empty.subtypes(), [{ core_type: 'artifact', name: '회의록' }]);
  assert.equal(empty.subtypes(), empty.doc.universe.subtypes);
});

test('hasChild: 숨기지 않은 참조에 그 하위 유니버스가 있을 때만 true', () => {
  const storage = memoryStorage();
  const g = open(storage).groupUniverses({ name: '가상 신규팀', level: '팀', owner: '가상', childIds: ['U-A1', 'U-K1'] });
  assert.equal(g.ok, true);
  const app = open(storage, g.doc.universe.id);
  assert.equal(app.hasChild('U-A1'), true);
  assert.equal(app.hasChild('U-K1'), true);
  assert.equal(app.hasChild('U-없음'), false);
  assert.equal(app.removeChild('U-A1').ok, true);
  assert.equal(app.hasChild('U-A1'), false); // 뺀(숨긴) 참조는 세지 않는다
  assert.equal(app.hasChild('U-K1'), true);
  // 참조가 없는 유니버스
  assert.equal(open(memoryStorage()).hasChild('U-K1'), false);
});

test('rootGid: 현재 유니버스 꼭지의 전역 참조', () => {
  const app = open(memoryStorage());
  assert.equal(app.rootGid(), `${app.doc.universe.id}/${app.doc.universe.root_node_id}`);
  assert.equal(app.view.getNode(app.rootGid()).core_type, 'root');
});

test('view.exists: 노드·이력의 전역 참조면 true(숨긴 노드 포함), 그 밖에는 false', () => {
  const app = open(memoryStorage());
  const v = app.view;
  assert.equal(v.exists(app.rootGid()), true);
  assert.equal(v.exists(v.events[0].gid), true);
  assert.equal(v.exists('U-A1/없는-ID'), false);
  assert.equal(v.exists('없는-ID'), false);
  const target = app.doc.nodes.find((n) => n.core_type !== 'root');
  assert.equal(app.hideNode(target.id).ok, true);
  assert.equal(app.view.exists(`${app.doc.universe.id}/${target.id}`), true);
});

test('displayName: 숨긴 노드에만 표시를 붙인다', () => {
  assert.equal(displayName({ label: '점검표', hidden: false }), '점검표');
  assert.equal(displayName({ label: '점검표', hidden: true }), '점검표(숨김 처리된 노드)');
});
