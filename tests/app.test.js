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
  assert.deepEqual(app.universes().map((u) => u.id).sort(), SAMPLES.map((s) => s.universe.id).sort());
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

test('parentsOf(검토5 U-4): 이 유니버스를 묶은 상위 유니버스 이름. 없으면 빈 배열, 참조를 빼면 사라진다', () => {
  const storage = memoryStorage();
  const app = open(storage, 'U-A1');
  assert.deepEqual(app.parentsOf('U-A1').map((u) => u.id), ['U-T1']);
  assert.deepEqual(app.parentsOf('U-O'), []); // 조직관리는 아무도 묶지 않음
  assert.equal(open(storage, 'U-T1').removeChild('U-A1').ok, true);
  assert.deepEqual(open(storage, 'U-A1').parentsOf('U-A1'), []);
});

test('가상 데이터 초기화: 샘플은 처음 상태로, 사용자가 만든 유니버스는 지워진다', () => {
  const storage = memoryStorage();
  const app = open(storage);
  app.addNode({ core_type: 'artifact', label: '새 문서' });
  app.groupUniverses({ name: '가상 신규팀', level: '팀', owner: '가상', childIds: ['U-A1', 'U-K1'] });
  app.resetAll();
  assert.deepEqual(app.universes().map((u) => u.id).sort(), SAMPLES.map((s) => s.universe.id).sort());
  assert.equal(app.doc.nodes.length, SAMPLE_A1.nodes.length);
});

test('새 유니버스(R-12): 만들면 꼭지가 생기고 저장되며, 이어서 노드를 추가할 수 있다', () => {
  const storage = memoryStorage();
  const app = open(storage);
  const r = app.createUniverse({ name: '연말 교육 운영', level: '업무', owner: '가상 교육팀', description: '연말 교육 준비' });
  assert.equal(r.ok, true);
  assert.equal(r.doc.nodes.length, 1);
  assert.equal(r.doc.nodes[0].core_type, 'root');
  assert.equal(r.doc.universe.is_sample, false);
  const reopened = open(storage, r.doc.universe.id);
  assert.equal(reopened.doc.universe.name, '연말 교육 운영');
  assert.equal(reopened.addNode({ core_type: 'work', label: '교육 안내' }).ok, true);
  assert.ok(reopened.universes().some((u) => u.name === '연말 교육 운영' && !u.is_sample));
});

test('새 유니버스: 이름·단위·작성 주체가 비면 만들지 않는다(R-12 ②)', () => {
  const app = open(memoryStorage());
  const before = app.universes().length;
  assert.deepEqual(app.createUniverse({ name: ' ', level: '업무', owner: 'x' }).error, { code: 'E-REQUIRED', field: 'name' });
  assert.deepEqual(app.createUniverse({ name: 'x', level: '', owner: 'x' }).error, { code: 'E-REQUIRED', field: 'level' });
  assert.deepEqual(app.createUniverse({ name: 'x', level: '업무', owner: '' }).error, { code: 'E-REQUIRED', field: 'owner' });
  assert.equal(app.universes().length, before);
});

test('같은 이름·단위의 유니버스를 찾아 준다(공백·대소문자 무시)', () => {
  const app = open(memoryStorage());
  assert.equal(app.findSameUniverse(' 월말 정산 점검 ', '업무').id, 'U-A1');
  assert.equal(app.findSameUniverse('월말 정산 점검', '팀'), null);
});

test('하위 유형 추가: 등록하면 쓸 수 있고 중복·비어 있음은 거부하며, 노드·연결 모두에 쓸 수 있다(1.3 ②)', () => {
  const app = open(memoryStorage());
  assert.equal(app.addNode({ core_type: 'artifact', label: '회의록 1', subtype: '회의록' }).error.code, 'E-SUBTYPE');
  assert.equal(app.addSubtype('artifact', '회의록').ok, true);
  assert.equal(app.addNode({ core_type: 'artifact', label: '회의록 1', subtype: '회의록' }).ok, true);
  assert.equal(app.addSubtype('artifact', '회의록').error.code, 'E-DUP');
  assert.equal(app.addSubtype('artifact', ' ').error.code, 'E-REQUIRED');
  assert.equal(app.addSubtype('references', '검토함').ok, true);
  const art = app.doc.nodes.find((n) => n.label === '회의록 1').id;
  assert.equal(app.addEdge({ source: art, target: 'N-001', core_type: 'references', subtype: '검토함' }).ok, true);
  // 다른 유니버스에는 영향이 없다
  assert.equal(open(memoryStorage(), 'U-K1').doc.universe.subtypes.some((s) => s.name === '회의록'), false);
});

test('저장소가 없으면 새 유니버스도 만들 수 없다(읽기 전용)', () => {
  const app = createApp({ store: null, samples: SAMPLES, now });
  assert.equal(app.createUniverse({ name: 'x', level: '업무', owner: 'x' }).error.code, 'W-STORAGE');
  assert.equal(app.addSubtype('artifact', '회의록').error.code, 'W-STORAGE');
});
