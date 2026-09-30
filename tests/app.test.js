import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import { SAMPLE_A1 } from '../app/data/sample-a1.js';
import { SAMPLES } from '../app/data/index.js';
import { SAMPLE_T01 } from './fixtures/sample-t01.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const now = () => '2026-10-01T12:00:00+09:00';
const open = (storage, currentId) => createApp({ store: createStore(storage), samples: SAMPLES, currentId, now });

test('처음 열면 모든 내장 샘플이 저장되고 첫 샘플이 열린다', () => {
  const storage = memoryStorage();
  const app = open(storage);
  assert.equal(app.doc.universe.id, 'U-A1');
  assert.deepEqual(app.universes().map((u) => u.id).sort(), ['U-A1', 'U-K1', 'U-T1']);
});

test('추가한 노드는 다시 열어도 남는다', () => {
  const storage = memoryStorage();
  assert.equal(open(storage).addNode({ core_type: 'artifact', label: '새 문서' }).ok, true);
  assert.equal(open(storage).doc.nodes.length, SAMPLE_A1.nodes.length + 1);
});

test('내장 샘플의 판이 바뀌면 저장된 이전 판(T-01 샘플)을 새 샘플로 바꾼다', () => {
  const storage = memoryStorage();
  createStore(storage).saveUniverse(JSON.parse(JSON.stringify(SAMPLE_T01)));
  assert.equal(open(storage).doc.nodes.length, SAMPLE_A1.nodes.length);
});

test('샘플이 아닌 유니버스는 판이 달라도 바꾸지 않는다', () => {
  const storage = memoryStorage();
  const mine = JSON.parse(JSON.stringify(SAMPLE_T01));
  mine.universe.is_sample = false;
  createStore(storage).saveUniverse(mine);
  assert.equal(open(storage).doc.nodes.length, SAMPLE_T01.nodes.length);
});

test('저장소가 없으면 샘플을 읽기 전용으로 열고 W-STORAGE 경고', () => {
  const app = createApp({ store: null, samples: SAMPLES, currentId: 'U-T1', now });
  assert.equal(app.readOnly, true);
  assert.deepEqual(app.warnings, [{ code: 'W-STORAGE' }]);
  assert.equal(app.addNode({ core_type: 'work', label: 'x' }).error.code, 'W-STORAGE');
  // 읽기 전용이어도 팀 유니버스는 하위 유니버스를 찾아 펼칠 수 있다
  assert.ok(app.view.nodes.some((n) => n.universe_id === 'U-K1'));
});

test('유니버스 묶기: 사용자가 고른 하위 유니버스를 참조하는 새 유니버스가 생기고 원본은 그대로', () => {
  const storage = memoryStorage();
  const app = open(storage);
  const before = JSON.stringify(app.universes());
  const r = app.groupUniverses({ name: '가상 신규팀', level: '팀', owner: '가상', childIds: ['U-A1', 'U-K1'] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.doc.refs.map((x) => x.child_universe_id), ['U-A1', 'U-K1']);
  const reopened = open(storage, r.doc.universe.id);
  assert.equal(reopened.doc.universe.name, '가상 신규팀');
  assert.ok(reopened.view.nodes.some((n) => n.universe_id === 'U-K1'));
  assert.equal(JSON.parse(before).length + 1, reopened.universes().length);
  assert.equal(open(storage, 'U-A1').doc.nodes.length, SAMPLE_A1.nodes.length); // 원본 불변
});

test('유니버스 묶기: 2개 미만·이름 누락·순환이면 거부', () => {
  const app = open(memoryStorage());
  assert.equal(app.groupUniverses({ name: 'x', level: '팀', owner: 'x', childIds: ['U-A1'] }).error.code, 'E-REQUIRED');
  assert.equal(app.groupUniverses({ name: '', level: '팀', owner: 'x', childIds: ['U-A1', 'U-K1'] }).error.field, 'name');
});

test('하위 유니버스 빼기: 참조만 해제되고 하위 유니버스는 남는다', () => {
  const storage = memoryStorage();
  const app = open(storage, 'U-T1');
  assert.equal(app.removeChild('U-K1').ok, true);
  assert.ok(!app.view.nodes.some((n) => n.universe_id === 'U-K1'));
  assert.ok(open(storage, 'U-K1').doc.nodes.length > 0);
});

test('다른 유니버스 노드의 위로 드러내기를 바꾸면 그 유니버스 문서에 저장된다', () => {
  const storage = memoryStorage();
  const app = open(storage, 'U-T1');
  assert.equal(app.updateNode('U-K1', 'N-304', { exposed: true }).ok, true);
  assert.equal(open(storage, 'U-K1').doc.nodes.find((n) => n.id === 'N-304').exposed, true);
});

test('가상 데이터 초기화: 샘플은 처음 상태로, 사용자가 만든 유니버스는 지워진다', () => {
  const storage = memoryStorage();
  const app = open(storage);
  app.addNode({ core_type: 'artifact', label: '새 문서' });
  app.groupUniverses({ name: '가상 신규팀', level: '팀', owner: '가상', childIds: ['U-A1', 'U-K1'] });
  app.resetAll();
  assert.deepEqual(app.universes().map((u) => u.id).sort(), ['U-A1', 'U-K1', 'U-T1']);
  assert.equal(app.doc.nodes.length, SAMPLE_A1.nodes.length);
});
