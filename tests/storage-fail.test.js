// 2026-10-02 전체 검토(실행 조건 RT-1·RT-3·RT-4) 재발 방지: 저장소 용량 부족·쓰기 실패
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, storageFailReason } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import { SAMPLES } from '../app/data/index.js';

const now = () => '2026-10-02T12:00:00+09:00';

// 글자 수 한도가 있는 가짜 localStorage(key·length 포함). failKey가 있으면 그 키 쓰기만 실패
function limitedStorage(limit = Infinity) {
  const m = new Map();
  const size = () => [...m].reduce((a, [k, v]) => a + k.length + v.length, 0);
  const quota = () => { const e = new Error('full'); e.name = 'QuotaExceededError'; e.code = 22; return e; };
  const s = {
    failKey: null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      if (k === s.failKey) throw quota();
      const old = m.get(k) || '';
      if (size() - old.length + String(v).length + (m.has(k) ? 0 : k.length) > limit) throw quota();
      m.set(k, String(v));
    },
    removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
    keys: () => [...m.keys()],
  };
  return s;
}

test('RT-1: 처음 열 때 샘플을 넣을 공간이 없으면 빈 화면 대신 샘플을 읽기 전용으로 연다', () => {
  for (const limit of [100, 30000]) {
    const app = createApp({ store: createStore(limitedStorage(limit)), samples: SAMPLES, now });
    assert.equal(app.doc.universe.id, 'U-A1', `limit ${limit}`);
    assert.equal(app.readOnly, true);
    assert.deepEqual(app.warnings.find((w) => w.code === 'W-STORAGE'), { code: 'W-STORAGE', reason: 'install', quota: true });
    assert.equal(app.addNode({ core_type: 'work', label: 'x' }).ok, false);
    assert.ok(app.view.nodes.length > 0); // 합성 뷰(하위 유니버스 참조)도 메모리 샘플로 만들어진다
  }
});

test('RT-3: 본문은 썼는데 목록 쓰기가 실패하면 본문을 되돌려 보이지 않는 키를 남기지 않는다', () => {
  const storage = limitedStorage();
  const app = createApp({ store: createStore(storage), samples: SAMPLES, now });
  storage.failKey = 'wu:v1:index';
  const r = app.createUniverse({ name: '새 업무', level: '업무', owner: '가상팀' });
  assert.equal(r.ok, false);
  assert.equal(r.error.reason, 'quota');
  assert.ok(!storage.keys().some((k) => k.startsWith('wu:v1:u:') && !SAMPLES.some((s) => k === `wu:v1:u:${s.universe.id}`)));
  // 기존 유니버스 수정이 실패하면 이전 본문이 그대로 남는다
  const before = storage.getItem('wu:v1:u:U-A1');
  assert.equal(app.addNode({ core_type: 'work', label: '목록 실패 때 추가' }).ok, false);
  assert.equal(storage.getItem('wu:v1:u:U-A1'), before);
});

test('RT-3: 초기화는 목록에 없는 유니버스 키(이전 실패로 남은 것)도 지운다', () => {
  const storage = limitedStorage();
  const app = createApp({ store: createStore(storage), samples: SAMPLES, now });
  storage.setItem('wu:v1:u:U-ORPHAN', JSON.stringify({ universe: { id: 'U-ORPHAN', name: '고아' }, nodes: [], edges: [], events: [], refs: [], identity_links: [] }));
  assert.ok(app.createUniverse({ name: '지울 것', level: '업무', owner: '가상팀' }).ok);
  assert.deepEqual(app.resetAll(), { ok: true });
  assert.deepEqual(storage.keys().filter((k) => k.startsWith('wu:v1:u:')).sort(), SAMPLES.map((s) => `wu:v1:u:${s.universe.id}`).sort());
});

test('RT-1: 공간 부족으로 읽기 전용이 된 뒤 초기화에 성공하면 다시 쓸 수 있다', () => {
  const storage = limitedStorage();
  storage.failKey = 'wu:v1:index';
  const app = createApp({ store: createStore(storage), samples: SAMPLES, now });
  assert.equal(app.addNode({ core_type: 'work', label: 'x' }).ok, false);
  storage.failKey = null;
  assert.deepEqual(app.resetAll(), { ok: true });
  assert.equal(app.addNode({ core_type: 'work', label: '초기화 뒤 추가' }).ok, true);
});

test('RT-1: 초기화도 실패하면 {ok:false}와 원인을 돌려준다', () => {
  const storage = limitedStorage();
  const app = createApp({ store: createStore(storage), samples: SAMPLES, now });
  storage.failKey = 'wu:v1:index';
  assert.deepEqual(app.resetAll(), { ok: false, error: { code: 'W-STORAGE', reason: 'quota' } });
});

test('RT-4: 브라우저마다 다른 용량 초과 표시를 모두 quota로 본다', () => {
  assert.equal(storageFailReason({ name: 'QuotaExceededError' }), 'quota');
  assert.equal(storageFailReason({ name: 'NS_ERROR_DOM_QUOTA_REACHED', code: 1014 }), 'quota');
  assert.equal(storageFailReason({ name: 'Error', code: 22 }), 'quota');
  assert.equal(storageFailReason({ name: 'SecurityError', code: 18 }), 'write');
  assert.equal(storageFailReason(null), 'write');
});
