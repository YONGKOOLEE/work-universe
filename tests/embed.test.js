// CR-13 B 내용 포함 HTML: 내장 데이터 만들기·읽기·HTML 글에 넣고 빼기(view/embed.js), 읽기 전용 앱(locked)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLES } from '../app/data/index.js';
import { clone } from './helpers.js';
import { createApp } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import { buildEmbed, collectDocs, embedFileName, embedJson, insertEmbed, parseEmbed, readEmbedFromHtml, stripEmbed } from '../app/src/view/embed.js';

const byId = Object.fromEntries(SAMPLES.map((d) => [d.universe.id, d]));
const resolve = (id) => byId[id] || null;
const PAGE = '<!doctype html>\n<!--라이선스-->\n<html><head><meta charset="utf-8"><title>t</title></head><body><script>var a = "<\\/script>";</script></body></html>';

test('하위 유니버스 재귀 수집: 부서(U-D1)는 팀·업무까지, 하위가 앞, 중복 없음', () => {
  const docs = collectDocs(byId['U-D1'], resolve);
  const ids = docs.map((d) => d.universe.id);
  assert.equal(ids[ids.length - 1], 'U-D1');
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length >= 3, ids.join());
  // 모든 참조 대상이 자신보다 앞에 있다
  docs.forEach((d, i) => {
    for (const r of d.refs || []) if (!r.hidden && byId[r.child_universe_id]) assert.ok(ids.indexOf(r.child_universe_id) < i, `${d.universe.id} → ${r.child_universe_id}`);
  });
});

test('하위가 없는 유니버스는 자기 하나, 순환 참조가 있어도 끝난다', () => {
  assert.deepEqual(collectDocs(byId['U-A1'], resolve).map((d) => d.universe.id), ['U-A1']);
  const a = clone(byId['U-T1']);
  const b = clone(byId['U-A1']);
  b.refs = [{ child_universe_id: a.universe.id, hidden: false }];
  a.refs = [{ child_universe_id: b.universe.id, hidden: false }];
  const m = { [a.universe.id]: a, [b.universe.id]: b };
  assert.equal(collectDocs(a, (id) => m[id]).length, 2);
});

test('왕복: 넣기 → 읽기가 같다, 앱 본문은 그대로', () => {
  const emb = buildEmbed(byId['U-D1'], resolve);
  const html = insertEmbed(PAGE, emb);
  assert.ok(html.indexOf('id="wu-embed"') < html.indexOf('<script>'), '내장 데이터가 앱 스크립트 앞');
  assert.deepEqual(readEmbedFromHtml(html), emb);
  assert.equal(stripEmbed(html), PAGE);
  assert.ok(html.includes('var a = "<\\/script>";'));
});

test('설명에 </script>·<!-- 가 있어도 HTML이 끊기지 않고 값이 그대로 돌아온다', () => {
  const d = clone(byId['U-A1']);
  d.universe.description = 'x</script><script>alert(1)</script><!-- y   z';
  const html = insertEmbed(PAGE, buildEmbed(d, resolve));
  const block = html.slice(html.indexOf('<script id="wu-embed"'), html.indexOf('</head>'));
  assert.equal(block.match(/<\/script>/gi).length, 1, '닫는 태그는 끝의 하나뿐');
  assert.ok(!/<!--/.test(block));
  assert.equal(readEmbedFromHtml(html).docs[0].universe.description, d.universe.description);
  assert.ok(!embedJson(buildEmbed(d, resolve)).includes('<'));
});

test('기존 내장 데이터는 교체된다(두 번 내보내기 왕복)', () => {
  const once = insertEmbed(PAGE, buildEmbed(byId['U-D1'], resolve));
  const twice = insertEmbed(once, buildEmbed(byId['U-A1'], resolve));
  assert.equal(twice.match(/id="wu-embed"/g).length, 1);
  assert.equal(readEmbedFromHtml(twice).root, 'U-A1');
  assert.equal(stripEmbed(twice), PAGE);
});

test('깨진 JSON·모양이 다른 데이터·버전이 다른 데이터는 열지 않는다(null/실패 사유)', () => {
  assert.equal(parseEmbed('{깨짐').reason, 'json');
  assert.equal(parseEmbed('[]').reason, 'shape');
  assert.equal(parseEmbed('{"format":"wu-embed","version":1,"root":"X","docs":[]}').reason, 'shape');
  const emb = buildEmbed(byId['U-A1'], resolve);
  assert.equal(parseEmbed(JSON.stringify({ ...emb, root: 'U-없음' })).reason, 'shape');
  assert.equal(parseEmbed(JSON.stringify({ ...emb, version: 2 })).reason, 'version');
  assert.equal(parseEmbed(JSON.stringify({ ...emb, docs: [{ ...clone(emb.docs[0]), schema_version: '9.9' }] })).reason, 'version');
  assert.ok(parseEmbed(JSON.stringify(emb)).ok);
  assert.equal(readEmbedFromHtml(PAGE), null);
  const broken = PAGE.replace('</head>', '<script id="wu-embed" type="application/json">{깨짐</script></head>');
  assert.equal(readEmbedFromHtml(broken), null);
  assert.equal(insertEmbed('<html>머리 없음</html>', emb), null);
});

test('파일 이름은 확장자만 .html', () => {
  assert.equal(embedFileName('월말_정산-U-A1.json'), '월말_정산-U-A1.html');
});

// 읽기 전용 앱(locked): 저장소 경고 없이 열리고 어떤 쓰기도 거부된다
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

test('locked 앱: 내장 문서를 열고 읽기 전용, 저장소 경고 없음, 쓰기·초기화 거부', () => {
  const store = createStore(memStorage());
  for (const d of buildEmbed(byId['U-D1'], resolve).docs) store.saveUniverse(clone(d));
  const app = createApp({ store, samples: SAMPLES.filter((s) => !['U-D1'].includes(s.universe.id)), currentId: 'U-D1', now: () => '2026-10-18T00:00:00+09:00', locked: true });
  assert.equal(app.doc.universe.id, 'U-D1');
  assert.equal(app.readOnly, true);
  assert.deepEqual(app.warnings, []);
  assert.equal(app.canReset, false);
  assert.equal(app.addNode({ core_type: 'work', label: '막혀야 함' }).ok, false);
  assert.equal(app.docOf('U-D1').universe.id, 'U-D1');
  assert.equal(app.docOf('없는-ID'), null);
});
