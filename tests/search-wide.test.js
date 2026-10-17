// T-26 찾기 넓히기(R-22 ①, D-24)와 작성자 이름(R-22 ②): 설명·속성까지 찾기, 확정자·표준 통합 확인의 기록 주체
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLES } from '../app/data/index.js';
import { createApp } from '../app/src/app/app.js';
import { cleanAuthorName, createStore, loadSettings, saveSettings } from '../app/src/store/local.js';
import { buildHandoverDraft } from '../app/src/rules/handover.js';
import { buildView } from '../app/src/view/view.js';
import { searchNodes } from '../app/src/view/explore.js';
import { LABEL_MAX } from '../app/src/model/schema.js';
import { mkDoc, mkNode, viewOf } from './helpers.js';

const wide = { wide: true };

// ── 찾기 ──
test('R-22 ① 월말 정산: 설명·속성에만 있는 낱말(가상정산시스템)은 끄면 못 찾고, 켜면 위치와 함께 찾는다', () => {
  const v = viewOf('U-A1');
  assert.deepEqual(searchNodes(v, '가상정산시스템'), []);
  assert.deepEqual(searchNodes(v, '가상정산시스템', { wide: false }), []);
  const hits = searchNodes(v, '가상정산시스템', wide);
  assert.deepEqual(hits.map((h) => h.gid).sort(), ['U-A1/N-001', 'U-A1/N-002']);
  const byGid = Object.fromEntries(hits.map((h) => [h.gid, h.where]));
  // 대사 확인은 「사용 시스템」 칸에만, 자료 수집은 「절차」 칸이 먼저 맞는다(샘플 데이터 순서)
  assert.equal(byGid['U-A1/N-001'], '속성 「사용 시스템」');
  assert.equal(byGid['U-A1/N-002'], '속성 「절차」');
  for (const h of hits) assert.ok(h.type_label && h.universe_name === '월말 정산 점검');
});

test('R-22 ① 이름 일치가 먼저, 설명·속성 일치는 그 아래(이름 일치에는 where 없음). 끄면 이름만(기존과 같음)', () => {
  const v = viewOf('U-A1');
  const hits = searchNodes(v, '점검표', wide);
  const firstWide = hits.findIndex((h) => h.where);
  assert.ok(firstWide > 0, '이름 일치(점검표 양식)가 있고 그 뒤에 설명·속성 일치가 있다');
  assert.ok(hits.slice(0, firstWide).every((h) => !h.where && h.label.includes('점검표')));
  assert.ok(hits.slice(firstWide).every((h) => h.where && !h.label.includes('점검표')));
  assert.ok(hits.some((h) => h.where === '설명' || (h.where || '').startsWith('속성 「')));
  assert.deepEqual(searchNodes(v, '점검표'), hits.slice(0, firstWide));
  // 이름에도 맞고 설명·속성에도 맞는 노드는 한 번만
  assert.equal(new Set(hits.map((h) => h.gid)).size, hits.length);
});

test('R-22 ① 위치 표시: 설명 먼저, 없으면 속성 값(속성 이름은 값 일치로 보지 않음)', () => {
  const doc = mkDoc('U-X', [
    mkNode('N-1', 'work', '가 업무', { description: '월말 마감 안내' }),
    mkNode('N-2', 'work', '나 업무', { attrs: { 주의사항: '월말 전에 확인', 비고: '월말' } }),
    mkNode('N-3', 'work', '다 업무', { attrs: { 월말: '값 없음' } }), // 속성 이름만 맞음 → 못 찾음
    mkNode('N-4', 'work', '월말 라 업무', { description: '월말 이야기' }), // 이름 일치
    mkNode('N-5', 'work', '마 업무', { description: '월말 숨김', hidden: true }), // 숨김 제외
    mkNode('N-6', 'work', '바 업무', { description: '월 말 설명 둘 다', attrs: { 비고: '월말' } }), // 설명이 먼저
  ], []);
  const hits = searchNodes(buildView(doc), ' 월 말 ', wide);
  assert.deepEqual(hits.map((h) => [h.label, h.where || null]), [
    ['월말 라 업무', null],
    ['가 업무', '설명'],
    ['나 업무', '속성 「주의사항」'],
    ['바 업무', '설명'],
  ]);
});

test('R-22 ① 정규화: 대소문자·공백은 이름 찾기와 같다', () => {
  const doc = mkDoc('U-X', [mkNode('N-1', 'work', '가 업무', { description: 'VAN 정산 안내' }), mkNode('N-2', 'work', '나 업무', { attrs: { 비고: '대 사 확인' } })], []);
  const v = buildView(doc);
  assert.deepEqual(searchNodes(v, 'van정산', wide).map((h) => h.gid), ['U-X/N-1']);
  assert.deepEqual(searchNodes(v, '대사', wide).map((h) => h.where), ['속성 「비고」']);
  assert.deepEqual(searchNodes(v, '   ', wide), []);
});

test('R-22 오류: 숨긴 노드는 설명·속성으로도 찾지 않고, 못 찾으면 빈 목록', () => {
  assert.deepEqual(searchNodes(viewOf('U-A1'), '없는낱말xyz', wide), []);
  const doc = mkDoc('U-X', [mkNode('N-1', 'work', '가 업무', { description: '비밀낱말', hidden: true })], []);
  assert.deepEqual(searchNodes(buildView(doc), '비밀낱말', wide), []);
});

test('R-22 ① 상한은 화면 규칙을 따른다: 이름 일치가 앞에 와서 상한(30) 안을 먼저 채운다', () => {
  const nodes = [
    ...Array.from({ length: 40 }, (_, i) => mkNode(`N-${i + 1}`, 'work', `설명만 ${String(i + 1).padStart(2, '0')}`, { description: '점검 대상' })),
    ...Array.from({ length: 35 }, (_, i) => mkNode(`N-${i + 101}`, 'work', `점검 ${String(i + 1).padStart(2, '0')}`)),
  ];
  const hits = searchNodes(buildView(mkDoc('U-M', nodes, [])), '점검', wide);
  assert.equal(hits.length, 75);
  assert.ok(hits.slice(0, 30).every((h) => !h.where), '화면이 자르는 앞 30개는 모두 이름 일치');
  assert.ok(hits.slice(35).every((h) => h.where));
});

// ── 작성자 이름 ──
function memStorage(initial) {
  const m = new Map(initial === undefined ? [] : [['wu:v1:settings', initial]]);
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const NOW = '2026-10-13T15:00:00+09:00';
const DEF = { provider: 'pregen' };
const openApp = (storage, id, authorName) => createApp({ store: createStore(storage), samples: SAMPLES, currentId: id, now: () => NOW, authorName });
const confirmed = (app) => {
  const draft = buildHandoverDraft(app.view, { target: 'U-A1/N-001', from: 'U-A1/N-012', to: 'U-A1/N-011' }).draft;
  const r = app.confirmHandover({ draft, text: '[확정] 시험', date: '2026-10-13' });
  assert.equal(r.ok, true);
  const art = app.doc.nodes.find((n) => `U-A1/${n.id}` === r.artifact);
  return { art, ev: app.doc.events.filter((e) => e.type === 'handover').pop() };
};

test('R-22 ② 작성자 이름이 있으면 확정자(속성)·이력 메모에 그 이름이 쓰인다. 이름은 부를 때마다 읽는다', () => {
  let name = '가상작성자';
  const { art, ev } = confirmed(openApp(memStorage(), 'U-A1', () => name));
  assert.equal(art.attrs.확정자, '가상작성자');
  assert.ok(ev.note.includes('확정: 가상작성자') && !ev.note.includes('이 브라우저'));
  name = '  ';
  assert.equal(confirmed(openApp(memStorage(), 'U-A1', () => name)).art.attrs.확정자, '사용자(이 브라우저)');
});

test('R-22 ② 이름이 비었거나 없거나 깨졌으면 기존 문구 "사용자(이 브라우저)"', () => {
  for (const arg of [undefined, () => '', () => undefined, () => 42, () => ({}), '']) {
    const { art, ev } = confirmed(openApp(memStorage(), 'U-A1', arg));
    assert.equal(art.attrs.확정자, '사용자(이 브라우저)');
    assert.ok(ev.note.includes('확정: 사용자(이 브라우저)'));
  }
});

test('R-22 ② 통합 확인 판정(decideIdentity)의 decided_by도 같은 원칙', () => {
  // 2026-10-17 D8-2: 부서 샘플에 다른 업무 판정 3건이 미리 있어 첫 human 연결이 아닌 이번 쌍으로 찾는다
  const pair = { a: 'U-B/N-103', b: 'U-C/N-102', kind: 'work', status: 'confirmed', reason: '시험' };
  const named = openApp(memStorage(), 'U-D1', () => '가상작성자');
  assert.equal(named.decideIdentity(pair).ok, true);
  assert.equal(named.doc.identity_links.find((l) => l.method === 'human' && l.a === pair.a).decided_by, '가상작성자');
  const plain = openApp(memStorage(), 'U-D1', () => '');
  assert.equal(plain.decideIdentity(pair).ok, true);
  assert.equal(plain.doc.identity_links.find((l) => l.method === 'human' && l.a === pair.a).decided_by, '사용자(이 브라우저)');
});

test('R-22 ② 설정: 작성자 이름 저장·읽기, 공백 정리, 상한(LABEL_MAX), 깨진 값은 기본값, 비면 저장 안 함', () => {
  const s = memStorage();
  assert.equal(saveSettings(s, { provider: 'pregen', authorName: '  가상작성자 ' }), true);
  assert.deepEqual(JSON.parse(s.getItem('wu:v1:settings')), { provider: 'pregen', authorName: '가상작성자' });
  assert.deepEqual(loadSettings(s, DEF), { provider: 'pregen', authorName: '가상작성자' });
  const long = 'ㄱ'.repeat(LABEL_MAX + 20);
  assert.equal(cleanAuthorName(long).length, LABEL_MAX);
  saveSettings(s, { provider: 'pregen', authorName: long });
  assert.equal(loadSettings(s, DEF).authorName.length, LABEL_MAX);
  saveSettings(s, { provider: 'pregen', authorName: '   ' });
  assert.equal('authorName' in JSON.parse(s.getItem('wu:v1:settings')), false);
  for (const bad of ['{깨짐', JSON.stringify({ provider: 'pregen', authorName: 123 }), JSON.stringify({ provider: 'pregen', authorName: { a: 1 } }), JSON.stringify([1])]) {
    assert.deepEqual(loadSettings(memStorage(bad), DEF), DEF);
  }
  assert.deepEqual(loadSettings(null, DEF), DEF);
  // 다른 설정 필드와 함께 보존
  saveSettings(s, { provider: 'none', authorName: '가', lastExportAt: '2026-10-13T10:00:00+09:00' });
  assert.deepEqual(loadSettings(s, DEF), { provider: 'none', authorName: '가', lastExportAt: '2026-10-13T10:00:00+09:00' });
});
