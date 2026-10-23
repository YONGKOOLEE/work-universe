// CR-14 C 폴더 연결(R-27, D-32): 이름 규칙·목록 판정(순수), store/folder.js(가짜 손잡이), 조정기(거울 저장 디바운스·팀 지도로 묶기)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { myFileName, planFolder } from '../app/src/view/folder-plan.js';
import * as folderApi from '../app/src/store/folder.js';
import { createFolderLink, GROUP_NAME } from '../app/src/ui/folder-link.js';
import { createApp } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import { SAMPLES } from '../app/data/index.js';
import { SAMPLE_A1 } from '../app/data/sample-a1.js';
import { SAMPLE_CARD } from '../app/data/sample-card.js';
import { SAMPLE_TEAM } from '../app/data/sample-team.js';

const now = () => '2026-10-23T12:00:00+09:00';
const json = (d) => JSON.stringify(d);

// ── 가짜 폴더 손잡이: getFileHandle·values·getFile·createWritable만 있는 메모리 폴더 ──
function fakeDir(initial = {}, { failWrite = false, failRead = [] } = {}) {
  const files = new Map(Object.entries(initial).map(([n, t]) => [n, { text: t, lastModified: 1000 }]));
  const writes = [];
  return {
    kind: 'directory',
    name: '가상폴더',
    files,
    writes,
    async getFileHandle(name, opt = {}) {
      if (!files.has(name) && !opt.create) throw Object.assign(new Error('없음'), { name: 'NotFoundError' });
      return {
        kind: 'file',
        name,
        async createWritable() {
          if (failWrite) throw Object.assign(new Error('쓸 수 없음'), { name: 'NotAllowedError' });
          let buf = '';
          return { write: async (t) => { buf += t; }, close: async () => { files.set(name, { text: buf, lastModified: 2000 }); writes.push(name); } };
        },
      };
    },
    async *values() {
      for (const [name, f] of files) {
        yield {
          kind: 'file',
          name,
          async getFile() {
            if (failRead.includes(name)) throw Object.assign(new Error('읽기 실패'), { name: 'NotReadableError' });
            return { size: f.text.length, lastModified: f.lastModified, text: async () => f.text };
          },
        };
      }
      yield { kind: 'directory', name: '하위.json' }; // 폴더는 이름이 .json이어도 읽지 않는다
    },
  };
}

// ── 이름 규칙 ──
test('myFileName: 유니버스 이름(작성자).json, 작성자가 없으면 유니버스 이름.json, 못 쓰는 글자는 _', () => {
  assert.equal(myFileName({ authorName: '가상 담당', universeName: '월말 정산 점검', universeId: 'U-A1' }), '월말_정산_점검(가상_담당).json');
  assert.equal(myFileName({ authorName: '', universeName: '월말 정산 점검', universeId: 'U-A1' }), '월말_정산_점검.json');
  assert.equal(myFileName({ universeName: '월말 정산 점검', universeId: 'U-A1' }), '월말_정산_점검.json');
  // 유니버스 이름이 비면 ID로 대신한다
  assert.equal(myFileName({ authorName: '가상 담당', universeId: 'U-A1' }), 'U-A1(가상_담당).json');
  assert.equal(myFileName({ universeId: 'U-A1' }), 'U-A1.json');
  const bad = myFileName({ authorName: 'a\\b/c:d*e?f"g<h>i|j', universeName: 'x*y?z', universeId: 'U-1' });
  assert.equal(bad, 'x_y_z(a_b_c_d_e_f_g_h_i_j).json');
  assert.ok(!/[\\/:*?"<>|]/.test(bad));
  // 같은 이름이 둘 이상이면(withId) ID를 붙여 서로 덮어쓰지 않는다. 이름이 없으면 이미 ID이므로 붙이지 않는다
  const one = myFileName({ authorName: '가', universeName: '정산', universeId: 'U-1', withId: true });
  const two = myFileName({ authorName: '가', universeName: '정산', universeId: 'U-2', withId: true });
  assert.equal(one, '정산(가)-U-1.json');
  assert.notEqual(one, two);
  assert.equal(myFileName({ authorName: '가', universeId: 'U-1', withId: true }), 'U-1(가).json');
  // 점·밑줄만 남는 이름은 없는 것으로 본다(숨김 파일·상위 경로 방지)
  assert.equal(myFileName({ authorName: '..', universeName: '정산', universeId: 'U-1' }), '정산.json');
  assert.equal(myFileName({ authorName: '가', universeName: '..', universeId: 'U-1' }), 'U-1(가).json');
  // 각 부분은 60자까지
  const long = myFileName({ authorName: '가'.repeat(100), universeName: '나'.repeat(100), universeId: 'U-1' });
  assert.equal(long, `${'나'.repeat(60)}(${'가'.repeat(60)}).json`);
});

// ── 목록 판정 ──
test('planFolder: 읽히는 것(정상 파일·내 파일·이미 있는 ID)과 읽히면 안 되는 것(깨짐·형식 다름·버전 다름)', () => {
  const files = [
    { name: 'a.json', text: json(SAMPLE_A1) },
    { name: '내-U.json', text: json(SAMPLE_CARD) },
    { name: 'broken.json', text: '{"universe":' },
    { name: 'array.json', text: '[1,2]' },
    { name: 'empty.json', text: '  ' },
    { name: 'shape.json', text: json({ hello: 1 }) },
    { name: 'ver.json', text: json({ ...SAMPLE_TEAM, schema_version: '9.9' }) },
  ];
  const plan = planFolder(files, { myFiles: new Set(['내-U.json']), existingIds: new Set([SAMPLE_A1.universe.id]), currentId: SAMPLE_CARD.universe.id });
  const by = Object.fromEntries(plan.map((p) => [p.name, p]));
  assert.equal(by['a.json'].ok, true);
  assert.deepEqual(by['a.json'].universe, { id: SAMPLE_A1.universe.id, name: SAMPLE_A1.universe.name, level: SAMPLE_A1.universe.level });
  assert.equal(by['a.json'].exists, true);
  assert.equal(by['a.json'].mine, false);
  assert.equal(by['내-U.json'].mine, true);
  assert.equal(by['내-U.json'].current, true);
  assert.equal(by['내-U.json'].exists, false);
  for (const n of ['broken.json', 'array.json', 'empty.json', 'shape.json', 'ver.json']) {
    assert.equal(by[n].ok, false, n);
    assert.equal(by[n].universe, null, n);
    assert.ok(by[n].reason, n);
  }
  assert.match(by['broken.json'].reason, /JSON/);
  assert.match(by['ver.json'].reason, /버전/);
  assert.equal(plan.length, files.length); // 깨진 파일이 있어도 나머지를 계속 판정
});

test('planFolder: 비정상 입력(배열 아님·null 항목)에도 던지지 않는다', () => {
  assert.deepEqual(planFolder(null), []);
  const p = planFolder([null, { name: 'x.json' }]);
  assert.equal(p.length, 2);
  assert.ok(p.every((x) => x.ok === false));
});

// ── store/folder.js (가짜 손잡이) ──
test('writeMine: 가짜 폴더에 내 파일이 생기고 다른 파일은 그대로', async () => {
  const dir = fakeDir({ 'other.json': '{"x":1}' });
  const r = await folderApi.writeMine(dir, '나-U.json', '{"a":2}');
  assert.deepEqual(r, { ok: true, name: '나-U.json' });
  assert.equal(dir.files.get('나-U.json').text, '{"a":2}');
  assert.equal(dir.files.get('other.json').text, '{"x":1}');
  assert.deepEqual(dir.writes, ['나-U.json']);
  await folderApi.writeMine(dir, '나-U.json', '{"a":3}'); // 다시 쓰면 바뀐다
  assert.equal(dir.files.get('나-U.json').text, '{"a":3}');
});

test('writeMine: 이름에 경로가 있거나 쓰기 거부면 예외 없이 ok:false, 파일은 안 생김', async () => {
  const dir = fakeDir();
  for (const bad of ['../x.json', 'a/b.json', 'a\\b.json', '', '..', null]) {
    const r = await folderApi.writeMine(dir, bad, 'x');
    assert.equal(r.ok, false, String(bad));
    assert.equal(r.error.name, 'BadName');
  }
  assert.equal(dir.files.size, 0);
  const deny = fakeDir({}, { failWrite: true });
  const r = await folderApi.writeMine(deny, 'a.json', 'x');
  assert.equal(r.ok, false);
  assert.equal(r.error.name, 'NotAllowedError');
  assert.equal((await folderApi.writeMine(null, 'a.json', 'x')).ok, false);
});

test('listJson: .json만 읽고 폴더·다른 확장자는 건너뜀, 1MB 초과·읽기 실패는 notes로', async () => {
  const big = 'x'.repeat(folderApi.FOLDER_MAX_BYTES + 1);
  const dir = fakeDir({ 'b.json': '{"b":1}', 'a.JSON': '{"a":1}', 'c.txt': 'text', 'big.json': big, 'bad.json': '{}' }, { failRead: ['bad.json'] });
  const r = await folderApi.listJson(dir);
  assert.equal(r.ok, true);
  assert.deepEqual(r.files.map((f) => f.name), ['a.JSON', 'b.json']); // 이름순
  assert.equal(r.files[1].text, '{"b":1}');
  assert.equal(r.files[1].size, 7);
  assert.deepEqual(r.notes.map((n) => [n.name, n.reason]).sort(), [['bad.json', 'read_failed'], ['big.json', 'too_big']]);
  assert.equal((await folderApi.listJson(null)).ok, false);
  assert.equal((await folderApi.listJson({})).ok, false);
});

test('pickFolder: 취소는 cancelled, 그 밖의 실패는 error, 기능 없음, 성공은 손잡이', async () => {
  const dir = fakeDir();
  assert.deepEqual(await folderApi.pickFolder(async (opt) => { assert.equal(opt.mode, 'readwrite'); return dir; }), { ok: true, handle: dir });
  const cancelled = await folderApi.pickFolder(async () => { throw Object.assign(new Error('취소'), { name: 'AbortError' }); });
  assert.equal(cancelled.ok, false);
  assert.equal(cancelled.cancelled, true);
  const other = await folderApi.pickFolder(async () => { throw Object.assign(new Error('막힘'), { name: 'SecurityError' }); });
  assert.equal(other.ok, false);
  assert.equal(other.cancelled, undefined);
  assert.equal(other.error.name, 'SecurityError');
  assert.equal((await folderApi.pickFolder(null)).error.name, 'Unsupported');
});

test('restoreFolder·askPermission: granted면 바로, prompt면 허락 필요, 거부는 ok:false', async () => {
  const mk = (q, req) => ({ name: 'd', queryPermission: async () => q, requestPermission: async () => req });
  const grantedHandle = mk('granted');
  const granted = await folderApi.restoreFolder({ handle: grantedHandle });
  assert.equal(granted.ok, true);
  assert.equal(granted.handle, grantedHandle);
  assert.equal(granted.needsPermission, undefined);
  const prompt = await folderApi.restoreFolder({ handle: mk('prompt') });
  assert.equal(prompt.needsPermission, true);
  const denied = await folderApi.restoreFolder({ handle: mk('denied') });
  assert.equal(denied.needsPermission, true);
  assert.equal((await folderApi.askPermission(mk('prompt', 'granted'))).ok, true);
  const no = await folderApi.askPermission(mk('prompt', 'denied'));
  assert.equal(no.ok, false);
  assert.equal(no.denied, true);
  assert.equal((await folderApi.askPermission(null)).ok, false);
  // 질의 자체가 던져도 예외로 새지 않는다
  const thrower = { queryPermission: async () => { throw new Error('boom'); } };
  assert.equal((await folderApi.restoreFolder({ handle: thrower })).ok, false);
});

test('IndexedDB가 없는 환경(Node): 기억·되살리기·지우기가 조용히 실패하고 연결 안 됨으로 본다', async () => {
  assert.equal(folderApi.folderSupported(), false);
  assert.equal((await folderApi.rememberFolder({})).ok, false);
  assert.equal((await folderApi.forgetFolder()).ok, false);
  assert.equal((await folderApi.recallFolder()).ok, false);
  assert.deepEqual(await folderApi.restoreFolder(), { ok: true, handle: null });
});

test('observeFolder: 기능이 없으면 null, 있으면 해제 함수와 바뀐 파일 이름', () => {
  assert.equal(folderApi.observeFolder(fakeDir(), () => {}), null);
  let cb = null;
  let disconnected = false;
  class Obs {
    constructor(fn) { cb = fn; }
    observe() { return Promise.resolve(); }
    disconnect() { disconnected = true; }
  }
  const seen = [];
  const stop = folderApi.observeFolder(fakeDir(), (names) => seen.push(names), Obs);
  assert.equal(typeof stop, 'function');
  cb([{ relativePathComponents: ['a.json'] }, { changedHandle: { name: 'b.json' } }, {}]);
  assert.deepEqual(seen[0], ['a.json', 'b.json', '']);
  stop();
  assert.equal(disconnected, true);
  class Bad { constructor() { throw new Error('no'); } }
  assert.equal(folderApi.observeFolder(fakeDir(), () => {}, Bad), null);
});

// ── 조정기: 거울 저장·디바운스·팀 지도로 묶기 ──
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
function fakeTimers() {
  const q = [];
  return { setTimer: (fn, ms) => { const t = { fn, ms, off: false }; q.push(t); return t; }, clearTimer: (t) => { t.off = true; }, async fire() { for (const t of q.splice(0)) if (!t.off) await t.fn(); }, pending: () => q.filter((t) => !t.off).length };
}

const mkLink = (currentId, extra = {}) => {
  const app = createApp({ store: createStore(memoryStorage()), samples: SAMPLES, currentId, now });
  const timers = fakeTimers();
  const link = createFolderLink({ app, getAuthor: () => '가상 담당', api: { ...folderApi, folderSupported: () => true }, ...timers, ...extra });
  return { app, link, timers };
};

test('거울 저장: 연결 전·허락 필요·거울 금지(canMirror false)이면 쓰지 않고, 연결되면 1초 디바운스로 마지막 한 번만 쓴다', async () => {
  const dir = fakeDir();
  const { app, link, timers } = mkLink('U-A1');
  assert.equal(link.mirror(), false); // 연결 전
  await link.useHandle(dir);
  assert.equal(dir.files.size, 0); // 연결만으로는 쓰지 않음(점검용 주입)
  assert.equal(link.mirror(), true);
  app.updateNode('U-A1', 'N-002', { label: '첫 번째 이름' });
  link.mirror();
  app.updateNode('U-A1', 'N-002', { label: '마지막 이름' });
  link.mirror();
  assert.equal(timers.pending(), 1); // 앞의 두 번은 취소
  assert.equal(dir.writes.length, 0);
  await timers.fire();
  assert.deepEqual(dir.writes, ['월말_정산_점검(가상_담당).json']);
  const written = JSON.parse(dir.files.get('월말_정산_점검(가상_담당).json').text);
  assert.equal(written.universe.id, 'U-A1');
  assert.equal(written.nodes.find((n) => n.id === 'N-002').label, '마지막 이름');
  assert.equal(link.state.warning, '');
  assert.ok(link.state.plan.some((p) => p.mine)); // 쓴 뒤 목록을 다시 읽어 내 파일로 구분
});

test('거울 저장: canMirror가 false(읽기 전용·되감기·HTML 보기)면 쓰지 않는다', async () => {
  let allowed = false;
  const dir = fakeDir();
  const { link, timers } = mkLink('U-A1', { canMirror: () => allowed });
  await link.useHandle(dir);
  assert.equal(link.mirror(), false);
  assert.equal(timers.pending(), 0);
  allowed = true;
  assert.equal(link.mirror(), true);
});

test('거울 저장 실패: 머리글 경고만 남기고 앱 저장은 그대로, 다음 성공 때 경고가 사라짐', async () => {
  const dir = fakeDir({}, { failWrite: true });
  const { app, link, timers } = mkLink('U-A1');
  await link.useHandle(dir);
  app.updateNode('U-A1', 'N-002', { label: '앱에는 저장됨' });
  link.mirror();
  await timers.fire();
  assert.match(link.state.warning, /폴더에 저장하지 못했습니다/);
  assert.equal(app.doc.nodes.find((n) => n.id === 'N-002').label, '앱에는 저장됨');
  assert.equal(dir.files.size, 0);
  const ok = fakeDir();
  link.state.handle = ok;
  link.mirror();
  await timers.fire();
  assert.equal(link.state.warning, '');
  assert.equal(ok.files.size, 1);
});

test('허락 다시 필요(needsPermission)이면 거울 저장 안 함', async () => {
  const dir = fakeDir();
  dir.queryPermission = async () => 'prompt';
  const { link, timers } = mkLink('U-A1', { api: { ...folderApi, folderSupported: () => true, restoreFolder: async () => folderApi.restoreFolder({ handle: dir }) } });
  await link.init();
  assert.equal(link.state.needsPermission, true);
  assert.equal(link.mirror(), false);
  assert.equal(timers.pending(), 0);
});

test('팀 지도로 묶기: 체크한 동료 파일만 가져와 지금 유니버스와 묶음, 깨진 파일·내 파일은 제외, 내 파일은 고치지 않음', async () => {
  const dir = fakeDir({
    'card.json': json(SAMPLE_CARD),
    'team.json': json(SAMPLE_TEAM),
    'broken.json': '{"universe":',
    '월말_정산_점검(가상_담당).json': json(SAMPLE_A1),
  });
  const { app, link } = mkLink('U-A1');
  await link.useHandle(dir);
  const names = link.state.plan.map((p) => `${p.name}:${p.ok ? (p.mine ? 'mine' : 'peer') : 'bad'}`).sort();
  assert.deepEqual(names, ['broken.json:bad', 'card.json:peer', 'team.json:peer', '월말_정산_점검(가상_담당).json:mine']);
  link.setSelected('team.json', false);
  let asked = '';
  const r = await link.bundle({ confirm: (m) => { asked = m; return true; } });
  assert.equal(r.ok, true);
  assert.match(asked, /동료 파일 1개로 이 브라우저의 사본을 바꿉니다/);
  const group = app.docOf(r.id);
  assert.equal(group.universe.name, GROUP_NAME);
  assert.equal(group.universe.level, '팀');
  const children = group.refs.filter((x) => !x.hidden).map((x) => x.child_universe_id).sort();
  assert.deepEqual(children, [SAMPLE_CARD.universe.id, 'U-A1'].sort());
  assert.ok(!children.includes(SAMPLE_TEAM.universe.id));
  // 남의 파일(폴더)은 그대로
  assert.equal(dir.files.get('card.json').text, json(SAMPLE_CARD));
  assert.equal(dir.writes.length, 0);
  // 한 번 더 묶으면 이름이 겹치지 않게 번호가 붙는다
  const again = await link.bundle({ confirm: () => true });
  assert.equal(again.ok, true);
  assert.equal(app.docOf(again.id).universe.name, `${GROUP_NAME} 2`);
});

test('팀 지도로 묶기: 확인 창에서 취소하면 아무것도 가져오지 않고, 체크가 없으면 거부', async () => {
  const dir = fakeDir({ 'card.json': json(SAMPLE_CARD) });
  const { app, link } = mkLink('U-A1');
  await link.useHandle(dir);
  const before = app.universes().length;
  const no = await link.bundle({ confirm: () => false });
  assert.equal(no.ok, false);
  assert.equal(app.universes().length, before);
  link.setSelected('card.json', false);
  const none = await link.bundle({ confirm: () => true });
  assert.equal(none.ok, false);
  assert.match(none.message, /체크/);
});

test('팀 지도로 묶기: 지금 연 유니버스와 같은 ID의 파일은 동료 파일로 보지 않음(덮어써 내 작업을 잃지 않게)', async () => {
  const stale = { ...SAMPLE_A1, universe: { ...SAMPLE_A1.universe, name: '옛날 사본' } };
  const dir = fakeDir({ 'old-copy.json': json(stale), 'card.json': json(SAMPLE_CARD) });
  const { app, link } = mkLink('U-A1');
  await link.useHandle(dir);
  const old = link.state.plan.find((p) => p.name === 'old-copy.json');
  assert.equal(old.current, true);
  const r = await link.bundle({ confirm: () => true });
  assert.equal(r.ok, true);
  assert.equal(app.docOf('U-A1').universe.name, SAMPLE_A1.universe.name);
});

test('변화 알림: 남의 .json 변화만 changed로, 내 파일·임시 파일은 무시, 새로 고침하면 꺼짐', async () => {
  let cb = null;
  const dir = fakeDir({ 'card.json': json(SAMPLE_CARD) });
  const observed = (handle, fn) => { cb = fn; return () => {}; };
  const { link } = mkLink('U-A1', { api: { ...folderApi, folderSupported: () => true, observeFolder: observed } });
  await link.useHandle(dir);
  cb(['월말_정산_점검(가상_담당).json', '월말_정산_점검(가상_담당).json.crswap']);
  assert.equal(link.state.changed, false);
  cb(['card.json']);
  assert.equal(link.state.changed, true);
  await link.refresh();
  assert.equal(link.state.changed, false);
});

test('연결 끊기: 손잡이를 잊고 보류 중인 저장을 취소, 폴더 파일은 그대로', async () => {
  const dir = fakeDir({ 'card.json': json(SAMPLE_CARD) });
  const { link, timers } = mkLink('U-A1');
  await link.useHandle(dir);
  link.mirror();
  await link.disconnect();
  await timers.fire();
  assert.equal(link.state.handle, null);
  assert.equal(dir.writes.length, 0);
  assert.equal(dir.files.size, 1);
  assert.equal(link.mirror(), false);
});

test('내 파일 이름: 같은 이름의 유니버스가 이 브라우저에 하나면 이름(작성자).json, 둘 이상이면 ID를 붙임(R9-3)', () => {
  const { app, link } = mkLink('U-A1');
  assert.equal(link.myFile(), '월말_정산_점검(가상_담당).json');
  const made = app.createUniverse({ name: SAMPLE_A1.universe.name, level: '팀', owner: '가상 담당' });
  assert.equal(made.ok, true, JSON.stringify(made));
  assert.equal(link.myFile(), '월말_정산_점검(가상_담당)-U-A1.json'); // 지금 연 유니버스(U-A1)에 ID가 붙는다
});
