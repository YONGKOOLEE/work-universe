// RV10S-4·RV10C-5: 공유 폴더 거울 저장 — 같은 이름의 남의 파일 보호, 1MB 넘는 파일 알림
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as folderApi from '../app/src/store/folder.js';
import { createFolderLink, FOLDER_TEXT } from '../app/src/ui/folder-link.js';
import { createApp } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import { SAMPLES } from '../app/data/index.js';
import { addEvent, addNode, createUniverse } from '../app/src/model/commands.js';
import { rewind, rewindOps } from '../app/src/model/rewind.js';
import { limitTexts, confirmText } from '../app/src/ui/rewind.js';
import { SAMPLE_A1 } from '../app/data/sample-a1.js';

const now = () => '2026-10-25T12:00:00+09:00';
const FILE = '월말_정산_점검(가상_담당).json';

// getFile까지 있는 메모리 폴더
function dir(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    kind: 'directory', name: '가상폴더', files,
    async getFileHandle(name, opt = {}) {
      if (!files.has(name) && !opt.create) throw Object.assign(new Error('없음'), { name: 'NotFoundError' });
      return {
        kind: 'file', name,
        async getFile() { const t = files.get(name); return { size: new TextEncoder().encode(t).length, lastModified: 1, text: async () => t }; },
        async createWritable() { let b = ''; return { write: async (t) => { b += t; }, close: async () => { files.set(name, b); } }; },
      };
    },
    async *values() {
      for (const [name, t] of files) yield { kind: 'file', name, async getFile() { return { size: new TextEncoder().encode(t).length, lastModified: 1, text: async () => t }; } };
    },
  };
}
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const mk = () => {
  const app = createApp({ store: createStore(mem()), samples: SAMPLES, currentId: 'U-A1', now });
  const link = createFolderLink({ app, getAuthor: () => '가상 담당', api: { ...folderApi, folderSupported: () => true }, setTimer: () => ({}), clearTimer: () => {} });
  return { app, link };
};
const otherDoc = () => JSON.stringify({ ...JSON.parse(JSON.stringify(SAMPLE_A1)), universe: { ...SAMPLE_A1.universe, id: 'U-ZZ9' } });

test('RV10S-4: 같은 이름의 파일이 다른 유니버스 ID면 ID를 붙인 이름으로 쓰고 알린다(남의 파일은 그대로)', async () => {
  const d = dir({ [FILE]: otherDoc() });
  const before = d.files.get(FILE);
  const { link } = mk();
  await link.useHandle(d);
  await link.saveNow();
  assert.equal(d.files.get(FILE), before);
  const alt = [...d.files.keys()].find((n) => n !== FILE);
  assert.match(alt, /-U-A1\.json$/);
  assert.equal(JSON.parse(d.files.get(alt)).universe.id, 'U-A1');
  assert.match(link.state.warning, /같은 이름의 다른 업무 지도 파일/);
  assert.equal(link.myFile(), alt);
  // 다음 저장도 같은 이름, 남의 파일은 「내 파일」이 아님
  await link.saveNow();
  assert.equal(d.files.size, 2);
  assert.equal(link.state.plan.find((p) => p.name === FILE).mine, false);
  assert.equal(link.state.plan.find((p) => p.name === alt).mine, true);
});

test('RV10S-4: 같은 ID의 파일이면 지금대로 덮어쓰고 알림 없음', async () => {
  const same = JSON.stringify(SAMPLE_A1);
  const d = dir({ [FILE]: same });
  const { link } = mk();
  await link.useHandle(d);
  await link.saveNow();
  assert.equal(d.files.size, 1);
  assert.notEqual(d.files.get(FILE), same);
  assert.equal(link.state.warning, '');
});

test('RV10S-4: 깨진 파일·없는 파일은 지금대로 그 이름으로 쓴다', async () => {
  for (const initial of [{}, { [FILE]: '{"universe":' }]) {
    const d = dir(initial);
    const { link } = mk();
    await link.useHandle(d);
    await link.saveNow();
    assert.equal(d.files.size, 1);
    assert.equal(JSON.parse(d.files.get(FILE)).universe.id, 'U-A1');
    assert.equal(link.state.warning, '');
  }
});

test('RV10S-4: 연결만 한 뒤(쓰기 전)에도 같은 이름의 남의 파일은 「내 파일」로 보지 않는다', async () => {
  const d = dir({ [FILE]: otherDoc() });
  const { link } = mk();
  await link.useHandle(d);
  const p = link.state.plan.find((x) => x.name === FILE);
  assert.equal(p.mine, false);
  assert.equal(link.state.selected.get(FILE), true);
});

test('RV10C-5: 쓴 파일이 1MB를 넘으면 쓰되 읽지 못한다는 알림', async () => {
  const d = dir();
  const { app, link } = mk();
  await link.useHandle(d);
  const real = app.exportJson.bind(app);
  app.exportJson = () => real() + ' '.repeat(folderApi.FOLDER_MAX_BYTES);
  await link.saveNow();
  assert.equal(d.files.size, 1);
  assert.match(link.state.warning, /1MB를 넘어 다른 사람이 폴더에서 읽지 못합니다/);
  assert.equal(link.state.warning.includes(FOLDER_TEXT.tooBig), true);
  app.exportJson = real;
  await link.saveNow();
  assert.equal(link.state.warning, '');
});

test('RV10C-5: 한글처럼 글자 수는 작아도 바이트로 1MB를 넘으면 알린다', async () => {
  const d = dir();
  const { app, link } = mk();
  await link.useHandle(d);
  const real = app.exportJson.bind(app);
  app.exportJson = () => real() + '가'.repeat(Math.ceil(folderApi.FOLDER_MAX_BYTES / 3) + 10);
  await link.saveNow();
  assert.match(link.state.warning, /1MB를 넘어/);
});

test('peekFile: 없음·있음·1MB 초과(내용 안 읽음)', async () => {
  const d = dir({ 'a.json': '{}', 'big.json': 'x'.repeat(folderApi.FOLDER_MAX_BYTES + 1) });
  assert.deepEqual(await folderApi.peekFile(d, 'none.json'), { ok: true, exists: false });
  assert.equal((await folderApi.peekFile(d, 'a.json')).text, '{}');
  const big = await folderApi.peekFile(d, 'big.json');
  assert.equal(big.exists, true);
  assert.equal(big.text, null);
});

// ── RV10C-10: 되감기 limits에 「남는 사용자 이력 n건」 ──
test('RV10C-10: 시점 뒤의 사용자 이력(메모·인수인계 …)은 limits에 건수로, 화면 문구에 나온다', () => {
  let n = 0;
  const t = (m) => ({ now: `2026-10-02T00:0${m}:00Z`, random: () => { n += 1; return (n * 0.37) % 1; } });
  let d = createUniverse({ name: '빈 유니버스', level: '팀', owner: '시험' }, { now: '2026-10-01T00:00:00Z', random: () => 0.5 }).doc;
  const a = addNode(d, { core_type: 'work', label: '업무' }, t(1)); d = a.doc;
  d = addEvent(d, { type: 'memo', occurred_at: '2026-10-02', payload: { target_id: a.node.id }, note: '메모 1' }, t(2)).doc;
  d = addEvent(d, { type: 'memo', occurred_at: '2026-10-02', payload: { target_id: a.node.id }, note: '메모 2' }, t(3)).doc;
  d = addNode(d, { core_type: 'work', label: '뒤에 생김' }, t(4)).doc;
  const at = '2026-10-02T00:01:00Z';
  const r = rewind(d, at);
  assert.deepEqual(r.limits.filter((l) => l.code === 'user_events_kept'), [{ code: 'user_events_kept', count: 2 }]);
  const ops = rewindOps(d, at);
  assert.equal(ops.limits.find((l) => l.code === 'user_events_kept').count, 2);
  assert.ok(limitTexts(r.limits).some((x) => /사용자 이력 2건/.test(x)));
  assert.match(confirmText(ops, at), /사용자 이력\(메모·인수인계·담당 등\) 2건/);
  // 시점 뒤에 사용자 이력이 없으면 알림 없음(자동 기록인 생성·수정·숨김은 세지 않음)
  const none = rewind(d, '2026-10-02T00:04:00Z');
  assert.equal(none.limits.some((l) => l.code === 'user_events_kept'), false);
  assert.equal(limitTexts([]).length, 1);
});

// ── RV10S-11: 인쇄 문서에 스크립트 금지 메타 ──
test('RV10S-11: withNoScript — head 안 맨 앞에 메타를 넣고 나머지는 그대로, head가 없어도 doctype 뒤·맨 앞에', async () => {
  const { withNoScript, PRINT_CSP_META } = await import('../app/src/ui/doc-output.js');
  assert.match(PRINT_CSP_META, /Content-Security-Policy.*script-src 'none'/);
  const page = '<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><title>t</title></head><body>x</body></html>\n';
  const out = withNoScript(page);
  assert.equal(out.replace(PRINT_CSP_META, ''), page);
  assert.ok(out.startsWith('<!doctype html>')); // doctype이 앞이어야 표준 모드 유지
  assert.ok(out.indexOf(PRINT_CSP_META) < out.indexOf('<meta charset'));
  assert.equal(withNoScript('<!DOCTYPE html><p>a</p>'), `<!DOCTYPE html>${PRINT_CSP_META}<p>a</p>`);
  assert.equal(withNoScript('<p>a</p>'), `${PRINT_CSP_META}<p>a</p>`);
  assert.equal(withNoScript('<header>x</header>'), `${PRINT_CSP_META}<header>x</header>`); // <header>는 head가 아님
});

// ── RV10S-12: secret-scan 확장 ──
test('RV10S-12: 시험 파일은 통째로 빼지 않고 가짜 값 표지 줄만 뺀다', async () => {
  const { scanFile, scanHistory, isFakeKeyLine } = await import('../tools/secret-scan.mjs');
  const key = ['sk-ant-', 'a'.repeat(40)].join('');
  assert.equal(scanFile('tests\\x.test.js', `const k = '${key}'; // 가짜 키`).length, 0);
  assert.equal(scanFile('tests/x.test.js', `const fake_key = '${key}';`).length, 0);
  assert.equal(scanFile('tests/x.test.js', `const k = '${key}';`).length, 1); // 표지 없으면 걸림
  assert.equal(scanFile('app/x.js', `const k = '${key}'; // 가짜 키`).length, 1); // tests 밖은 표지로 못 뺌
  assert.equal(isFakeKeyLine('아무 줄'), false);
  // 이력: 추가된 줄만, 지워진 줄·표지 줄(tests)은 안 걸림
  const log = [
    'commit ' + 'a'.repeat(40), '', '+++ b/scripts/run.ps1', `+$env:K = '${key}'`, `-old ${key}`,
    'commit ' + 'b'.repeat(40), '+++ b/tests/t.test.js', `+const k = '${key}'; // 가짜 값`, '+++ b/docs/a.md', '+정상 글',
  ].join('\n');
  const hits = scanHistory(log);
  assert.equal(hits.length, 1);
  assert.deepEqual([hits[0].commit, hits[0].file, hits[0].rule], ['aaaaaaaa', 'scripts/run.ps1', 'Anthropic API 키']);
  assert.ok(!JSON.stringify(hits).includes('a'.repeat(10))); // 값은 가려진다
});
