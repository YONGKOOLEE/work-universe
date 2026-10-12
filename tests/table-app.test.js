// T-19 app 층: 묶음 저장은 저장소에 한 번만 쓰고, 실패하면 화면·저장소가 그대로다(R-18 ⑤, D-18, T19-15)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import { SAMPLES } from '../app/data/index.js';
import { newRowsToOps, parseTable } from '../app/src/model/table.js';

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem(k, v) { if (this.failWrites) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); m.set(k, String(v)); },
    removeItem: (k) => m.delete(k),
    failWrites: false,
  };
}
const now = () => '2026-10-12T12:00:00+09:00';
function openCounting(storage, currentId) {
  const store = createStore(storage);
  let saves = 0;
  const original = store.saveUniverse.bind(store);
  store.saveUniverse = (d) => { saves += 1; return original(d); };
  const app = createApp({ store, samples: SAMPLES, currentId, now });
  saves = 0; // 샘플 설치 쓰기는 세지 않는다
  return { app, saves: () => saves };
}
const USER_DOC_NAME = '표 입력 시험';

function openUserUniverse() {
  const storage = memoryStorage();
  const first = createApp({ store: createStore(storage), samples: SAMPLES, now });
  const made = first.createUniverse({ name: USER_DOC_NAME, level: '팀', owner: '가상팀' });
  assert.equal(made.ok, true);
  return { storage, id: made.doc.universe.id };
}

test('R-18 ⑤: 5행 묶음 저장은 저장소에 한 번만 쓰고 그래프에 5개가 생긴다', () => {
  const { storage, id } = openUserUniverse();
  const { app, saves } = openCounting(storage, id);
  const before = app.doc.nodes.length;
  const ops = newRowsToOps(parseTable('유형\t이름\n업무\t가 1\n업무\t가 2\n사람\t가 3\n산출물\t가 4\n조직\t가 5').rows);
  const r = app.applyBatch(ops);
  assert.equal(r.ok, true);
  assert.equal(saves(), 1);
  assert.equal(app.doc.nodes.length, before + 5);
  assert.equal(app.view.nodes.filter((n) => /^가 \d$/.test(n.label)).length, 5);
});

test('R-18 ③: 오류 행이 있으면 저장소를 쓰지 않고 문서도 그대로', () => {
  const { storage, id } = openUserUniverse();
  const { app, saves } = openCounting(storage, id);
  const snap = JSON.stringify(app.doc);
  const r = app.applyBatch(newRowsToOps(parseTable('유형\t이름\n업무\t정상\n업무\t').rows));
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].row, 2);
  assert.equal(saves(), 0);
  assert.equal(JSON.stringify(app.doc), snap);
});

test('T19-15: 저장소 실패를 흉내 내면 W-STORAGE, 화면 문서는 그대로', () => {
  const { storage, id } = openUserUniverse();
  const { app } = openCounting(storage, id);
  const snap = JSON.stringify(app.doc);
  storage.failWrites = true;
  const r = app.applyBatch(newRowsToOps(parseTable('유형\t이름\n업무\t가\n업무\t나').rows));
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'W-STORAGE');
  assert.equal(JSON.stringify(app.doc), snap);
});

test('읽기 전용(샘플 판 불일치·저장소 없음)이면 거부', () => {
  const app = createApp({ store: null, samples: SAMPLES, now });
  const r = app.applyBatch(newRowsToOps(parseTable('업무\t가').rows));
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'W-STORAGE');
});

test('「노드 추가」 한 건도 노드와 꼭지 연결을 한 번의 저장으로 처리한다(D-18)', () => {
  const { storage, id } = openUserUniverse();
  const { app, saves } = openCounting(storage, id);
  const r = app.applyBatch([{ op: 'addNode', input: { core_type: 'work', label: '단건 업무' }, attachRoot: true }]);
  assert.equal(r.ok, true);
  assert.equal(saves(), 1);
  assert.equal(r.created[0].label, '단건 업무');
  assert.equal(app.doc.edges.length, 1);
});
