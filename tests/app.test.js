import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import { SAMPLE_A1 } from '../app/data/sample-a1.js';
import { SAMPLE_T01 } from './fixtures/sample-t01.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const now = () => '2026-10-01T12:00:00+09:00';

test('처음 열면 내장 샘플이 저장된다', () => {
  const store = createStore(memoryStorage());
  const app = createApp({ store, sample: SAMPLE_A1, now });
  assert.equal(app.doc.nodes.length, SAMPLE_A1.nodes.length);
  assert.equal(store.loadUniverse('U-A1').universe.created_at, SAMPLE_A1.universe.created_at);
});

test('추가한 노드는 다시 열어도 남는다', () => {
  const storage = memoryStorage();
  const first = createApp({ store: createStore(storage), sample: SAMPLE_A1, now });
  assert.equal(first.addNode({ core_type: 'artifact', label: '새 문서' }).ok, true);
  const second = createApp({ store: createStore(storage), sample: SAMPLE_A1, now });
  assert.equal(second.doc.nodes.length, SAMPLE_A1.nodes.length + 1);
});

test('내장 샘플의 판이 바뀌면 저장된 이전 판(T-01 샘플)을 새 샘플로 바꾼다', () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  store.saveUniverse(JSON.parse(JSON.stringify(SAMPLE_T01))); // 이전 빌드가 남긴 데이터
  const app = createApp({ store, sample: SAMPLE_A1, now });
  assert.equal(app.doc.nodes.length, SAMPLE_A1.nodes.length);
  assert.equal(store.loadUniverse('U-A1').nodes.length, SAMPLE_A1.nodes.length);
});

test('샘플이 아닌 유니버스는 판이 달라도 바꾸지 않는다', () => {
  const storage = memoryStorage();
  const store = createStore(storage);
  const mine = JSON.parse(JSON.stringify(SAMPLE_T01));
  mine.universe.is_sample = false;
  store.saveUniverse(mine);
  const app = createApp({ store, sample: SAMPLE_A1, now });
  assert.equal(app.doc.nodes.length, SAMPLE_T01.nodes.length);
});

test('저장소가 없으면 샘플을 읽기 전용으로 열고 W-STORAGE 경고', () => {
  const app = createApp({ store: null, sample: SAMPLE_A1, now });
  assert.equal(app.readOnly, true);
  assert.deepEqual(app.warnings, [{ code: 'W-STORAGE' }]);
  assert.equal(app.addNode({ core_type: 'work', label: 'x' }).error.code, 'W-STORAGE');
});
