// 아홉 번째 검토(2026-10-23) 보안 묶음: S-1 수정 이력 키 가드, S-2 길이·개수 상한, C-7 상태 값 셈, S-8 비밀값 패턴
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDocument } from '../app/src/model/validate.js';
import { previewImport } from '../app/src/model/import.js';
import { rewind } from '../app/src/model/rewind.js';
import { addNode } from '../app/src/model/commands.js';
import { ATTRS_MAX_KEYS, LABEL_MAX, TAGS_MAX, TEXT_MAX } from '../app/src/model/schema.js';
import { scanText } from '../tools/secret-scan.mjs';
import { FIXTURE_TS as TS, mkEdge as E, mkNode as N } from './helpers.js';
import { SAMPLES } from '../app/data/index.js';

const D = (nodes, edges = [], events = [], universe = {}) => ({
  schema_version: '1.0',
  universe: { id: 'U-1', name: '가상', level: '팀', owner: '가상', root_node_id: 'N-000', subtypes: [], created_at: TS, ...universe },
  nodes: [N('N-000', 'root', '가상'), ...nodes], edges, events, refs: [], identity_links: [],
});
const codes = (r) => r.errors.map((e) => `${e.code}@${e.path}`);
const T1 = '2026-09-02T09:00:00+09:00';
const T2 = '2026-09-03T09:00:00+09:00';
const ev = (id, type, at, payload, extra = {}) => ({ id, type, occurred_at: at.slice(0, 10), recorded_at: at, source: 'user', payload, ...extra });

// ── S-1: 수정 이력의 키 ──
function jsonDoc(beforeJson, afterJson, kind = 'node') {
  const target = kind === 'node' ? 'N-1' : 'L-1';
  const doc = {
    schema_version: '1.0',
    universe: { id: 'U-1', name: '가상', level: '팀', owner: '가상', root_node_id: 'N-000', subtypes: [], created_at: TS },
    nodes: [N('N-000', 'root', '가상'), N('N-1', 'work', '새 이름')],
    edges: [{ id: 'L-1', source: 'N-000', target: 'N-1', core_type: 'contains', hidden: false, created_at: TS, note: '새 메모' }],
    events: [
      ev('E-1', 'created', T1, { target_kind: kind, target_id: target }),
      JSON.parse(`{"id":"E-2","type":"updated","occurred_at":"2026-09-03","recorded_at":"${T2}","source":"user","payload":{"target_kind":"${kind}","target_id":"${target}","before":${beforeJson},"after":${afterJson}}}`),
    ],
    refs: [], identity_links: [],
  };
  return doc;
}

test('S-1: 되감기는 이력 before의 __proto__·허용 밖 키를 무시하고 허용 키만 되돌린다(노드)', () => {
  const doc = jsonDoc('{"label":"옛 이름","__proto__":{"polluted":1},"constructor":"x","prototype":"y","extra":"z","core_type":"person"}', '{"label":"새 이름"}');
  const r = rewind(doc, T1);
  assert.equal(r.ok, true);
  const n = r.doc.nodes.find((x) => x.id === 'N-1');
  assert.equal(n.label, '옛 이름');
  assert.equal(Object.getPrototypeOf(n), Object.prototype, '__proto__ 대입으로 원형이 바뀌면 안 된다');
  assert.equal(n.polluted, undefined);
  assert.equal(Object.hasOwn(n, 'extra'), false);
  assert.equal(Object.hasOwn(n, 'constructor'), false);
  assert.equal(Object.hasOwn(n, 'prototype'), false);
  assert.equal(n.core_type, 'work', '핵심 유형은 편집 필드가 아니므로 되돌리지 않는다');
  assert.equal({}.polluted, undefined);
});

test('S-1: 되감기는 연결 이력의 허용 밖 키도 무시한다', () => {
  const doc = jsonDoc('{"note":"옛 메모","__proto__":{"polluted":1},"source":"N-1","target":"N-000"}', '{"note":"새 메모"}', 'edge');
  const r = rewind(doc, T1);
  const e = r.doc.edges.find((x) => x.id === 'L-1');
  assert.equal(e.note, '옛 메모');
  assert.equal(Object.getPrototypeOf(e), Object.prototype);
  assert.equal(e.source, 'N-000');
  assert.equal(e.target, 'N-1');
});

test('S-1: validate는 updated의 before/after에 허용 밖 키(__proto__ 포함)가 있으면 E-SCHEMA', () => {
  const nodeBad = jsonDoc('{"label":"옛","__proto__":{"a":1}}', '{"label":"새"}');
  assert.ok(codes(validateDocument(nodeBad)).includes('E-SCHEMA@events[1].payload.before'));
  const afterBad = jsonDoc('{"label":"옛"}', '{"label":"새","extra":1}');
  assert.ok(codes(validateDocument(afterBad)).includes('E-SCHEMA@events[1].payload.after'));
  const coreType = jsonDoc('{"core_type":"person"}', '{"core_type":"work"}');
  assert.ok(codes(validateDocument(coreType)).includes('E-SCHEMA@events[1].payload.before'));
  const edgeBad = jsonDoc('{"note":"옛","label":"x"}', '{"note":"새"}', 'edge');
  assert.ok(codes(validateDocument(edgeBad)).includes('E-SCHEMA@events[1].payload.before'));
  // 연결에는 노드 전용 키(label·deleted)가 없다
  assert.ok(codes(validateDocument(jsonDoc('{"deleted":false}', '{"deleted":true}', 'edge'))).includes('E-SCHEMA@events[1].payload.before'));
});

test('S-1: 허용 키는 통과한다(노드 편집 필드·hidden·deleted, 연결 편집 필드·hidden)', () => {
  const nodeOk = jsonDoc('{"label":"옛","description":null,"attrs":null,"tags":null,"period":null,"subtype":null,"emp_no":null,"exposed":null,"hidden":true,"deleted":false}', '{"label":"새","hidden":false,"deleted":true}');
  assert.deepEqual(codes(validateDocument(nodeOk)).filter((c) => c.includes('events[1].payload')), []);
  const edgeOk = jsonDoc('{"subtype":null,"period":null,"note":"옛","hidden":true}', '{"note":"새","hidden":false}', 'edge');
  assert.deepEqual(codes(validateDocument(edgeOk)).filter((c) => c.includes('events[1].payload')), []);
});

// ── S-2: 길이·개수 상한(경계값) ──
test('S-2: 노드 설명 2000자 통과·2001자 거부', () => {
  assert.equal(TEXT_MAX, 2000);
  assert.equal(validateDocument(D([N('N-1', 'work', '업무', { description: 'x'.repeat(2000) })])).ok, true);
  assert.ok(codes(validateDocument(D([N('N-1', 'work', '업무', { description: 'x'.repeat(2001) })]))).includes('E-SCHEMA@nodes[1].description'));
});

test('S-2: attrs 값 2000자 통과·2001자 거부, 키 수 50 통과·51 거부', () => {
  assert.equal(ATTRS_MAX_KEYS, 50);
  assert.equal(validateDocument(D([N('N-1', 'work', '업무', { attrs: { 항목: 'x'.repeat(2000) } })])).ok, true);
  assert.ok(codes(validateDocument(D([N('N-1', 'work', '업무', { attrs: { 항목: 'x'.repeat(2001) } })]))).includes('E-SCHEMA@nodes[1].attrs'));
  const keys = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`키${i}`, 'v']));
  assert.equal(validateDocument(D([N('N-1', 'work', '업무', { attrs: keys(50) })])).ok, true);
  assert.ok(codes(validateDocument(D([N('N-1', 'work', '업무', { attrs: keys(51) })]))).includes('E-SCHEMA@nodes[1].attrs'));
});

test('S-2: tags 개수 50 통과·51 거부, 원소 2000자 통과·2001자 거부(노드·유니버스)', () => {
  assert.equal(TAGS_MAX, 50);
  const tags = (n) => Array.from({ length: n }, (_, i) => `t${i}`);
  assert.equal(validateDocument(D([N('N-1', 'work', '업무', { tags: tags(50) })])).ok, true);
  assert.ok(codes(validateDocument(D([N('N-1', 'work', '업무', { tags: tags(51) })]))).includes('E-SCHEMA@nodes[1].tags'));
  assert.equal(validateDocument(D([N('N-1', 'work', '업무', { tags: ['x'.repeat(2000)] })])).ok, true);
  assert.ok(codes(validateDocument(D([N('N-1', 'work', '업무', { tags: ['x'.repeat(2001)] })]))).includes('E-SCHEMA@nodes[1].tags'));
  assert.equal(validateDocument(D([], [], [], { tags: tags(50) })).ok, true);
  assert.ok(codes(validateDocument(D([], [], [], { tags: tags(51) }))).includes('E-SCHEMA@universe.tags'));
  assert.ok(codes(validateDocument(D([], [], [], { tags: ['x'.repeat(2001)] }))).includes('E-SCHEMA@universe.tags'));
});

test('S-2: 유니버스 설명 2000자 통과·2001자 거부, 단위·담당 100자 통과·101자 거부', () => {
  assert.equal(LABEL_MAX, 100);
  assert.equal(validateDocument(D([], [], [], { description: 'x'.repeat(2000) })).ok, true);
  assert.ok(codes(validateDocument(D([], [], [], { description: 'x'.repeat(2001) }))).includes('E-SCHEMA@universe.description'));
  assert.equal(validateDocument(D([], [], [], { level: 'x'.repeat(100), owner: 'x'.repeat(100) })).ok, true);
  assert.ok(codes(validateDocument(D([], [], [], { level: 'x'.repeat(101) }))).includes('E-SCHEMA@universe.level'));
  assert.ok(codes(validateDocument(D([], [], [], { owner: 'x'.repeat(101) }))).includes('E-SCHEMA@universe.owner'));
});

test('S-2: 이벤트 payload 글자(메모 본문 note 포함) 2000자 통과·2001자 거부', () => {
  const memo = (text) => D([N('N-1', 'work', '업무')], [], [ev('E-9', 'memo', T1, { target_id: 'N-1', text })]);
  assert.equal(validateDocument(memo('x'.repeat(2000))).ok, true);
  assert.ok(codes(validateDocument(memo('x'.repeat(2001)))).includes('E-SCHEMA@events[0].payload.text'));
  const upd = (label) => D([N('N-1', 'work', '업무')], [], [ev('E-9', 'updated', T1, { target_kind: 'node', target_id: 'N-1', before: { label }, after: { label: '새' } })]);
  assert.equal(validateDocument(upd('x'.repeat(2000))).ok, true);
  assert.ok(codes(validateDocument(upd('x'.repeat(2001)))).includes('E-SCHEMA@events[0].payload.before.label'));
  // 이벤트 note는 기존 상한 그대로
  const note = (s) => D([N('N-1', 'work', '업무')], [], [ev('E-9', 'memo', T1, { target_id: 'N-1' }, { note: s })]);
  assert.equal(validateDocument(note('x'.repeat(2000))).ok, true);
  assert.ok(codes(validateDocument(note('x'.repeat(2001)))).includes('E-SCHEMA@events[0].note'));
});

test('S-2: 샘플 7개는 새 상한을 모두 통과한다', () => {
  assert.equal(Object.keys(SAMPLES).length >= 7, true);
  for (const [id, doc] of Object.entries(SAMPLES)) {
    const r = validateDocument(doc);
    assert.equal(r.ok, true, `${id}: ${JSON.stringify(r.errors.slice(0, 3))}`);
  }
});

// ── C-7: 상태 값이 상속 속성 이름이어도 셈이 깨지지 않는다 ──
test("C-7: 속성 상태가 'constructor'·'toString'·'__proto__'여도 가정·미확인 셈은 NaN이 되지 않는다", () => {
  const nodes = [
    N('N-1', 'work', '가', { attrs: { 상태: 'constructor' } }),
    N('N-2', 'work', '나', { attrs: { 상태: 'toString' } }),
    N('N-3', 'work', '다', { attrs: { 상태: '__proto__' } }),
    N('N-4', 'work', '라', { attrs: { 상태: '가정' } }),
    N('N-5', 'work', '마', { attrs: { 상태: '미확인' } }),
    N('N-6', 'work', '바', { attrs: { 상태: '미확인' } }),
  ];
  const p = previewImport(D(nodes));
  assert.deepEqual(p.marks, { 가정: 1, 미확인: 2 });
});

// ── S-8: 비밀값 패턴 (가짜 값은 나눠 이어 붙여, 이 파일 자체가 점검에 걸리지 않게 한다) ──
test('S-8: GitHub·Slack·api_key 대입 형식을 찾고, 평범한 글은 찾지 않는다', () => {
  const hit = (s) => scanText(s).map((h) => h.rule);
  assert.ok(hit(`token = ghp_${'A1b2'.repeat(9)}`).includes('GitHub 토큰'));
  assert.ok(hit(`github_pat_${'a1B2c3'.repeat(5)}`).includes('GitHub 토큰'));
  assert.ok(hit(['xox', 'b-1234567890-abcdefghij'].join('')).includes('Slack 토큰'));
  assert.ok(hit(['api_key = "', 'abcd1234efgh5678ijkl"'].join('')).includes('api_key 대입(긴 값)'));
  assert.ok(hit(["apiKey: '", "abcd1234efgh5678ijkl'"].join('')).includes('api_key 대입(긴 값)'));
  assert.deepEqual(hit('apiKey 입력칸에 키를 붙여 넣습니다. api_key = "짧음" ghp_ 와 xox 는 접두어일 뿐'), []);
  assert.deepEqual(hit('const apiKey = readKey(); apiKey: string'), []);
});

// ── S-2 보강: 앱 명령도 같은 상한을 지킨다(저장한 문서를 다시 가져오지 못하는 일 방지) ──
test('S-2: addNode는 attrs 키 51개·tags 51개·태그 2001자를 거부하고 50개·2000자는 받는다', () => {
  const ctx = { now: '2026-10-23T09:00:00+09:00' };
  const base = D([]);
  const keys = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`키${i}`, 'v']));
  const tags = (n) => Array.from({ length: n }, (_, i) => `t${i}`);
  assert.equal(addNode(base, { core_type: 'work', label: '가', attrs: keys(50) }, ctx).ok, true);
  assert.equal(addNode(base, { core_type: 'work', label: '가', attrs: keys(51) }, ctx).ok, false);
  assert.equal(addNode(base, { core_type: 'work', label: '가', tags: tags(50) }, ctx).ok, true);
  assert.equal(addNode(base, { core_type: 'work', label: '가', tags: tags(51) }, ctx).ok, false);
  assert.equal(addNode(base, { core_type: 'work', label: '가', tags: ['x'.repeat(2000)] }, ctx).ok, true);
  assert.equal(addNode(base, { core_type: 'work', label: '가', tags: ['x'.repeat(2001)] }, ctx).ok, false);
});
