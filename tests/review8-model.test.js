// 코드 검토(2026-10-17) 결함 3~10: 가져오기 자료형·ID 겹침·숨긴 사람/조직·상속 속성·중복 검사 성능·읽기 전용 하위 문서
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDocument } from '../app/src/model/validate.js';
import { previewImport } from '../app/src/model/import.js';
import { editableRows } from '../app/src/model/table.js';
import { findDuplicateEdge, findDuplicateNode } from '../app/src/model/checks.js';
import { TEXT_MAX, edgeTypeLabel, eventTypeLabel, nodeTypeLabel, pairAllowed } from '../app/src/model/schema.js';
import { hideNode } from '../app/src/model/commands.js';
import { buildView } from '../app/src/view/view.js';
import { describeNode } from '../app/src/view/describe.js';
import { workFormMissing } from '../app/src/rules/form.js';
import { createApp } from '../app/src/app/app.js';
import { SAMPLES } from '../app/data/index.js';
import { FIXTURE_TS as TS, mkEdge as E, mkNode as N } from './helpers.js';

const D = (id, nodes, edges, events = [], extra = {}) => ({
  schema_version: '1.0',
  universe: { id, name: id, level: '팀', owner: '가상', root_node_id: 'N-000', subtypes: [], created_at: TS },
  nodes: [N('N-000', 'root', id), ...nodes], edges, events, refs: [], identity_links: [], ...extra,
});
const NOW = '2026-10-17T09:00:00+09:00';
const codes = (r) => r.errors.map((e) => `${e.code}@${e.path}`);

// ── 3. 글자 칸 자료형·길이 ──
test('R8-3: 설명·사번이 숫자·배열이면 E-SCHEMA, 너무 길면 거부', () => {
  const bad = (n) => validateDocument(D('U-1', [n], []));
  assert.ok(codes(bad(N('N-1', 'work', '업무', { description: 2026 }))).includes('E-SCHEMA@nodes[1].description'));
  assert.ok(codes(bad(N('N-1', 'work', '업무', { description: ['a'] }))).includes('E-SCHEMA@nodes[1].description'));
  assert.ok(codes(bad(N('N-1', 'work', '업무', { description: 'x'.repeat(TEXT_MAX + 1) }))).includes('E-SCHEMA@nodes[1].description'));
  assert.ok(codes(bad(N('N-1', 'person', '가상갑', { emp_no: 1001 }))).includes('E-SCHEMA@nodes[1].emp_no'));
  assert.ok(codes(bad(N('N-1', 'person', '가상갑', { emp_no: 'V'.repeat(101) }))).includes('E-SCHEMA@nodes[1].emp_no'));
  // 정상(경계 값)은 통과
  assert.equal(bad(N('N-1', 'work', '업무', { description: 'x'.repeat(TEXT_MAX) })).ok, true);
  assert.equal(bad(N('N-1', 'person', '가상갑', { emp_no: 'V-1001', description: '' })).ok, true);
});

test('R8-3: 연결·이벤트의 note가 글자가 아니거나 길면 E-SCHEMA', () => {
  const n = [N('N-1', 'work', '업무')];
  const edge = (note) => validateDocument(D('U-1', n, [E('N-000', 'N-1', 'contains', { note })]));
  assert.ok(codes(edge(['x'])).includes('E-SCHEMA@edges[0].note'));
  assert.ok(codes(edge('x'.repeat(TEXT_MAX + 1))).includes('E-SCHEMA@edges[0].note'));
  assert.equal(edge('메모').ok, true);
  const ev = (note) => validateDocument(D('U-1', n, [], [{ id: 'E-1', type: 'memo', occurred_at: '2026-09-01', recorded_at: TS, source: 'user', payload: {}, note }]));
  assert.ok(codes(ev(7)).includes('E-SCHEMA@events[0].note'));
  assert.ok(codes(ev('x'.repeat(TEXT_MAX + 1))).includes('E-SCHEMA@events[0].note'));
  assert.equal(ev('메모').ok, true);
});

test('R8-3: 깊은 배열 설명도 미리 보기가 멈추지 않고 거부, 표 행 값은 글자', () => {
  const deep = JSON.parse(`${'['.repeat(6000)}${']'.repeat(6000)}`);
  const doc = D('U-1', [N('N-1', 'work', '업무', { description: deep })], []);
  let p;
  assert.doesNotThrow(() => { p = previewImport(doc, {}); });
  assert.equal(p.ok, false);
  // 방어: 검증을 거치지 않은 문서라도 표 행 칸은 글자
  const rows = editableRows(D('U-2', [N('N-1', 'person', '가상갑', { emp_no: 1001, description: 2026 })], []));
  assert.equal(rows[0].cells.emp_no, '1001');
  assert.equal(rows[0].cells.description, '2026');
});

// ── 4. ID 겹침 ──
test('R8-4: 노드·연결·이벤트 ID가 서로 겹치면 E-DUP', () => {
  const ev = (id) => ({ id, type: 'memo', occurred_at: '2026-09-01', recorded_at: TS, source: 'user', payload: {} });
  const nodes = [N('1', 'work', '업무 가')];
  const e = (id) => ({ ...E('N-000', '1', 'contains'), id });
  const r1 = validateDocument(D('U-1', nodes, [e('1')]));
  assert.ok(r1.errors.some((x) => x.code === 'E-DUP' && x.path === 'edges[0].id'), JSON.stringify(r1.errors));
  const r2 = validateDocument(D('U-1', nodes, [e('L-9')], [ev('1')]));
  assert.ok(r2.errors.some((x) => x.code === 'E-DUP' && x.path === 'events[0].id'));
  const r3 = validateDocument(D('U-1', nodes, [e('L-9')], [ev('L-9')]));
  assert.ok(r3.errors.some((x) => x.code === 'E-DUP' && x.path === 'events[0].id'));
  assert.equal(validateDocument(D('U-1', nodes, [e('L-9')], [ev('E-9')])).ok, true);
});

// ── 5. 표준 양식: 숨긴 사람은 담당으로 세지 않음 ──
test('R8-5: 숨긴 사람의 수행 연결은 담당 있음으로 보지 않는다', () => {
  let d = D('U-1', [N('N-1', 'person', '가상갑', { emp_no: 'V-0001' }), N('N-2', 'work', '업무 하나')],
    [E('N-000', 'N-2', 'contains'), E('N-1', 'N-2', 'performs', { period: { start: '2026-01-01' } })]);
  assert.ok(!workFormMissing(buildView(d), 'U-1/N-2').includes('담당자'), '보이는 사람이면 담당 있음');
  d = hideNode(d, 'N-1', { now: NOW }).doc;
  assert.ok(workFormMissing(buildView(d), 'U-1/N-2').some((m) => /담당/.test(m)), workFormMissing(buildView(d), 'U-1/N-2').join());
});

// ── 6. 상속 속성 ──
test('R8-6: constructor·toString 같은 이름은 유형 목록에 없는 것으로 본다', () => {
  assert.equal(nodeTypeLabel('constructor'), '기타');
  assert.equal(edgeTypeLabel('toString'), '기타');
  assert.equal(eventTypeLabel('constructor'), '기타');
  assert.equal(nodeTypeLabel('work'), '업무');
  assert.equal(pairAllowed('toString', 'work', 'work'), true); // 모르는 관계는 허용(1.3)
  assert.equal(pairAllowed('hasOwnProperty', 'root', 'root'), true);
  assert.equal(pairAllowed('performs', 'work', 'work'), false); // 알려진 규칙은 그대로
  assert.equal(pairAllowed('contains', 'constructor', 'work'), true);
  assert.equal(editableRowsType('constructor'), '');
  assert.equal(editableRowsType('work'), '업무');
});
function editableRowsType(t) {
  return editableRows(D('U-1', [N('N-1', t, '노드')], []))[0].cells.type;
}

test('R8-6: 이력 유형·메모 범주·하위 유형 이름이 상속 속성이면 거부', () => {
  const ev = (type, payload = {}) => ({ id: 'E-1', type, occurred_at: '2026-09-01', recorded_at: TS, source: 'user', payload });
  const n = [N('N-1', 'work', '업무')];
  assert.ok(codes(validateDocument(D('U-1', n, [], [ev('constructor')]))).includes('E-SCHEMA@events[0].type'));
  assert.ok(codes(validateDocument(D('U-1', n, [], [ev('toString')]))).includes('E-SCHEMA@events[0].type'));
  assert.ok(codes(validateDocument(D('U-1', n, [], [ev('memo', { category: 'constructor' })]))).some((c) => c.includes('category')));
  const sub = D('U-1', n, [], [], {});
  sub.universe.subtypes = [{ core_type: 'constructor', name: '가' }];
  assert.ok(codes(validateDocument(sub)).includes('E-SCHEMA@universe.subtypes[0]'));
  // 정상 유형은 통과
  assert.equal(validateDocument(D('U-1', n, [], [ev('memo', { category: 'issue' })])).ok, true);
});

// ── 7a. 중복 검사: 느린 기준(전체 비교)과 같은 결과 ──
function referenceDup(doc) {
  const out = [];
  const seen = [];
  doc.nodes.forEach((n, i) => {
    if (n.hidden) return;
    const dup = findDuplicateNode(seen, n);
    if (dup) out.push(`nodes[${i}]>${dup.id}`);
    seen.push(n);
  });
  const seenE = [];
  doc.edges.forEach((e, i) => {
    if (e.hidden) return;
    const dup = findDuplicateEdge(seenE, e);
    if (dup) out.push(`edges[${i}]>${dup.id}`);
    seenE.push(e);
  });
  return out;
}
test('R8-7a: 중복 판정 결과·안내 순서가 전체 비교와 같다(무작위 문서)', () => {
  let seed = 12345;
  const rnd = (k) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % k; };
  const types = ['person', 'work', 'org'];
  const dates = [undefined, '2026-01-01', '2026-03-01', '2026-06-01'];
  for (let round = 0; round < 40; round += 1) {
    const nodes = [];
    for (let i = 0; i < 25; i += 1) {
      const t = types[rnd(3)];
      nodes.push(N(`N-${i + 1}`, t, ` 이름${rnd(6)}${rnd(2) ? ' ' : ''}`.replace('이름', rnd(2) ? 'ABC' : 'abc'), {
        hidden: rnd(6) === 0, ...(t === 'person' && rnd(4) ? { emp_no: rnd(2) ? `V-100${rnd(4)}` : ` v-100${rnd(4)} ` } : {}),
      }));
    }
    const edges = [];
    for (let i = 0; i < 30; i += 1) {
      const s = rnd(25) + 1; const t = rnd(25) + 1; const c = ['performs', 'relates_to', 'contains'][rnd(3)];
      const a = dates[rnd(4)]; const b = dates[rnd(4)];
      const period = a && b && b < a ? { start: b, end: a } : { ...(a ? { start: a } : {}), ...(rnd(2) && b && (!a || b >= a) ? { end: b } : {}) };
      edges.push({ ...E(`N-${s}`, `N-${t}`, c, { hidden: rnd(8) === 0 }), id: `L-r${round}-${i}`, period });
    }
    const doc = D('U-1', nodes, edges);
    const got = validateDocument(doc).errors.filter((e) => e.code === 'E-DUP' && e.existing_id !== undefined && /^(nodes|edges)\[\d+\]$/.test(e.path))
      .map((e) => `${e.path}>${e.existing_id}`);
    assert.deepEqual(got, referenceDup(doc), `round ${round}`);
  }
});
test('R8-7a: 노드 2000개 검증이 빠르다(제곱 비교 아님)', () => {
  const nodes = [];
  for (let i = 0; i < 2000; i += 1) nodes.push(N(`N-${i + 1}`, 'work', `가상 업무 ${i}`));
  const edges = nodes.map((n) => E('N-000', n.id, 'contains'));
  const doc = D('U-1', nodes, edges);
  const t0 = performance.now();
  const r = validateDocument(doc);
  const ms = performance.now() - t0;
  assert.equal(r.ok, true);
  assert.ok(ms < 400, `${ms.toFixed(0)}ms`);
});

// ── 9. 소속(기준일): 숨긴 조직 제외 ──
test('R8-9: 숨긴 조직으로 가는 소속 연결은 소속(기준일)에 나오지 않는다', () => {
  let d = D('U-1', [N('N-1', 'person', '가상갑', { emp_no: 'V-0001' }), N('N-2', 'org', '없어진 팀'), N('N-3', 'org', '남은 팀')],
    [E('N-1', 'N-2', 'belongs_to', { period: { start: '2026-01-01' } })]);
  const rowOf = (doc) => describeNode(buildView(doc), 'U-1/N-1', { asOf: '2026-10-01' }).rows.find((r) => r.label === '소속(기준일)');
  assert.match(JSON.stringify(rowOf(d)), /없어진 팀/);
  d = hideNode(d, 'N-2', { now: NOW }).doc;
  const row = rowOf(d);
  assert.ok(!row || !/없어진 팀/.test(JSON.stringify(row)), JSON.stringify(row));
});

// ── 10. 하위 문서가 읽기 전용이면 묶음 화면에서도 쓰지 않음 ──
function readOnlyChildApp() {
  const child = D('U-OLD', [N('N-1', 'work', '옛 업무'), N('N-2', 'person', '가상갑', { emp_no: 'V-0001' }), N('N-3', 'person', '가상을', { emp_no: 'V-0002' })],
    [E('N-000', 'N-1', 'contains'), E('N-2', 'N-1', 'performs')]);
  child.schema_version = '0.9';
  const group = D('U-GRP', [], [], [], { refs: [{ child_universe_id: 'U-OLD', added_at: TS }] });
  const mem = new Map([['U-OLD', child], ['U-GRP', group]]);
  const store = {
    loadUniverse: (id) => (mem.has(id) ? JSON.parse(JSON.stringify(mem.get(id))) : null),
    saveUniverse: (d) => mem.set(d.universe.id, JSON.parse(JSON.stringify(d))),
    removeUniverse: (id) => mem.delete(id),
    listUniverses: () => [...mem.values()].map((d) => ({ id: d.universe.id, name: d.universe.name })),
  };
  return { app: createApp({ store, samples: SAMPLES, currentId: 'U-GRP', now: () => NOW }), mem };
}
test('R8-10: 읽기 전용(다른 형식 버전) 하위 유니버스에는 노드 수정·초안 확정을 저장하지 않는다', () => {
  const { app, mem } = readOnlyChildApp();
  const before = JSON.stringify(mem.get('U-OLD'));
  const r1 = app.updateNode('U-OLD', 'N-1', { description: '고침' });
  assert.equal(r1.ok, false);
  assert.equal(r1.error.reason, 'version');
  const r2 = app.confirmHandover({ draft: { target: 'U-OLD/N-1', from: 'U-OLD/N-2', to: 'U-OLD/N-3', title: 't', method: 'rule' }, text: '본문', date: '2026-10-17' });
  assert.equal(r2.ok, false);
  assert.equal(r2.error.reason, 'version');
  assert.equal(JSON.stringify(mem.get('U-OLD')), before, '하위 문서는 그대로');
});

test('R8-6: 명령(addNode·addEdge·addSubtype)도 constructor·toString 같은 유형 이름을 거부하고, 뷰는 모르는 유형으로 본다', async () => {
  const { createUniverse, addNode, addEdge, addSubtype } = await import('../app/src/model/commands.js');
  const { buildView } = await import('../app/src/view/view.js');
  const ctx = { now: '2026-10-17T10:00:00+09:00' };
  const doc = createUniverse({ name: '가상 시험', level: '업무', owner: '가상 시험팀' }, ctx).doc;
  assert.equal(addNode(doc, { core_type: 'constructor', label: '가' }, ctx).ok, false);
  const a = addNode(doc, { core_type: 'work', label: '가' }, ctx);
  const b = addNode(a.doc, { core_type: 'work', label: '나' }, ctx);
  assert.equal(addEdge(b.doc, { source: a.node.id, target: b.node.id, core_type: 'toString' }, ctx).ok, false);
  assert.equal(addSubtype(doc, { core_type: 'constructor', name: '가' }).ok, false);
  const odd = JSON.parse(JSON.stringify(doc));
  odd.nodes.push({ id: 'N-x', core_type: 'constructor', label: '이상한 유형', hidden: false, created_at: ctx.now, updated_at: ctx.now });
  assert.equal(buildView(odd).getNode(odd.universe.id + '/N-x').known_type, false);
});

test('R8-3 재검증: 명령도 가져오기 검증과 같은 상한을 지켜, 앱이 저장한 문서는 다시 가져올 수 있다(사번 100자, 연결 메모 2000자)', async () => {
  const { createUniverse, addNode, addEdge, updateEdge, updateNode } = await import('../app/src/model/commands.js');
  const ctx = { now: '2026-10-17T10:00:00+09:00' };
  const doc = createUniverse({ name: '가상 시험', level: '업무', owner: '가상 시험팀' }, ctx).doc;
  assert.equal(addNode(doc, { core_type: 'person', label: '가상갑', emp_no: 'V-' + '1'.repeat(99) }, ctx).ok, false);
  const p = addNode(doc, { core_type: 'person', label: '가상갑', emp_no: 'V-1001' }, ctx);
  assert.equal(updateNode(p.doc, p.node.id, { emp_no: 'V-' + '2'.repeat(99) }, ctx).ok, false);
  const w = addNode(p.doc, { core_type: 'work', label: '가상 업무' }, ctx);
  assert.equal(addEdge(w.doc, { source: p.node.id, target: w.node.id, core_type: 'performs', note: '가'.repeat(2001) }, ctx).ok, false);
  const e = addEdge(w.doc, { source: p.node.id, target: w.node.id, core_type: 'performs', note: '가'.repeat(2000) }, ctx);
  assert.equal(e.ok, true);
  assert.equal(updateEdge(e.doc, e.edge.id, { note: '나'.repeat(2001) }, ctx).ok, false);
  // 상한 안에서 만든 문서는 내보내 다시 검증해도 통과
  assert.equal(validateDocument(JSON.parse(JSON.stringify(e.doc))).ok, true);
});
