// 여덟 번째 검토(2026-10-17): 합쳐진 노드 숨김 연결 정리(1)와 층별 보기 성능 정리(7b) 검증
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { SAMPLES } from '../app/data/index.js';
import { buildView } from '../app/src/view/view.js';
import { exposureOf, exposureIndex, projectView } from '../app/src/view/collapse.js';
import { hideNode } from '../app/src/model/commands.js';
import { workLoad, personLoad, densityGaps } from '../app/src/rules/insight.js';
import { describeNode } from '../app/src/view/describe.js';
import { allSamples, clone, mkNode, mkEdge, mkDoc } from './helpers.js';

const ctx = { now: '2026-10-01T09:00:00+09:00' };
const asOf = '2026-10-01';

function mergedFixture() {
  const person = (id) => mkNode('N-1', 'person', '가상갑', { emp_no: 'V-0001' });
  const mk = (id, work) => mkDoc(id, [person(), mkNode('N-2', 'work', work)], [
    mkEdge('N-000', 'N-2', 'contains'),
    mkEdge('N-1', 'N-2', 'performs', { period: { start: '2026-01-01' } }),
  ]);
  const u1 = mk('U-1', '업무 하나');
  const u2 = mk('U-2', '업무 둘');
  const team = mkDoc('U-T', [], [], [], {
    refs: [{ child_universe_id: 'U-1', added_at: ctx.now }, { child_universe_id: 'U-2', added_at: ctx.now }],
    identity_links: [{ id: 'I-1', a: 'U-1/N-1', b: 'U-2/N-1', kind: 'person', method: 'emp_no_auto', status: 'confirmed' }],
  });
  return { u1, u2, team };
}

test('1: 합쳐진 사람의 한쪽을 숨기면 묶음 화면에서 그 쪽 담당 연결이 대표 노드에 남지 않는다', () => {
  const { u1, u2, team } = mergedFixture();
  const hidden1 = hideNode(u1, 'N-1', ctx).doc;
  const docs = { 'U-1': hidden1, 'U-2': u2, 'U-T': team };
  const v = buildView(team, (id) => docs[id]);
  // U-1 단독 화면과 같은 상태
  assert.equal(workLoad(buildView(hidden1), 'U-1/N-2', { asOf }).kind, 'never');
  assert.equal(workLoad(v, 'U-1/N-2', { asOf }).kind, 'never');
  assert.deepEqual(personLoad(v, 'U-2/N-1', { asOf }).works.map((w) => w.label), ['업무 둘']);
  assert.deepEqual(describeNode(v, 'U-2/N-1', { asOf }).links.map((l) => `${l.relation} ${l.other.label}`), ['수행 업무 둘']);
  assert.ok(!densityGaps(v, { asOf }).gaps.some((g) => g.label === '업무 하나'));
  const pv = projectView(v, { expanded: new Set(['U-1', 'U-2']) });
  assert.deepEqual(pv.edges.filter((e) => e.core_type === 'performs').map((e) => `${e.source}->${e.target}`), ['U-2/N-1->U-2/N-2']);
  // 대표 노드(합쳐진 사람)는 한쪽이 남아 있으므로 보이고, 숨긴 쪽 연결만 hidden
  const perf = v.edges.filter((e) => e.core_type === 'performs');
  assert.equal(perf.length, 2);
  assert.deepEqual(perf.map((e) => e.hidden).sort(), [false, true]);
});

test('1: 합쳐진 두 사람을 모두 숨기면 대표 노드도 숨김이고, 합쳐지지 않은 숨긴 노드의 연결은 그대로(기존 동작)', () => {
  const { u1, u2, team } = mergedFixture();
  const docs = { 'U-1': hideNode(u1, 'N-1', ctx).doc, 'U-2': hideNode(u2, 'N-1', ctx).doc, 'U-T': team };
  const v = buildView(team, (id) => docs[id]);
  assert.equal(v.getNode('U-1/N-1').hidden, true);
  assert.equal(v.visible().edges.filter((e) => e.core_type === 'performs').length, 0);
  // 합쳐지지 않은 경우: 숨긴 노드의 연결 hidden 플래그는 원래 값 그대로
  const single = buildView(hideNode(u1, 'N-1', ctx).doc);
  assert.equal(single.visible().edges.filter((e) => e.core_type === 'performs').length, 0);
});

test('1: 샘플(숨김 없음)에서는 모든 연결의 hidden이 원본 문서 값과 같다', () => {
  const docs = allSamples();
  for (const d of SAMPLES) {
    const v = buildView(d, (id) => docs[id] || null);
    const orig = new Map(Object.values(docs).flatMap((x) => x.edges.map((e) => [`${x.universe.id}/${e.id}`, !!e.hidden])));
    for (const e of v.edges) if (!e.synthetic) assert.equal(e.hidden, orig.get(e.gid), e.gid);
  }
});

test('1: 샘플 팀 화면에서 U-A1 업무를 숨기면 대사 주제 연결이 사라진다', () => {
  const docs = clone(allSamples());
  const rel = (v) => v.visible().edges.filter((e) => e.core_type === 'relates_to' && e.target === v.canonical('U-K1/N-314') && e.source.startsWith('U-A1/')).length;
  const before = rel(buildView(docs['U-T1'], (id) => docs[id]));
  assert.ok(before > 0);
  docs['U-A1'] = hideNode(docs['U-A1'], 'N-030', ctx).doc;
  assert.equal(rel(buildView(docs['U-T1'], (id) => docs[id])), 0);
});

// ── 7b: 옛 방식(노드마다 연결 전체를 거름)과 결과 비교 ──
function legacyExposureOf(view, gid) {
  const node = view.rawNode(gid);
  if (!node) return { exposed: false, explicit: false, reason: '' };
  if (node.core_type === 'root') return { exposed: true, explicit: false, reason: '꼭지' };
  if (typeof node.exposed === 'boolean') return { exposed: node.exposed, explicit: true, reason: node.exposed ? '직접 드러냄' : '직접 숨김' };
  const own = view.edges.filter((e) => !e.hidden && !e.synthetic && e.universe_id === node.universe_id);
  const canon = view.canonical(gid);
  switch (node.core_type) {
    case 'person': { const p = own.some((e) => e.core_type === 'performs' && e.source === canon); return { exposed: p, explicit: false, reason: p ? '담당자' : '담당 업무 없음' }; }
    case 'work': { const u = own.some((e) => e.core_type === 'contains' && e.target === canon && view.getNode(e.source)?.core_type === 'work'); return { exposed: !u, explicit: false, reason: u ? '하위 업무' : '최상위 업무' }; }
    case 'topic': { const s = view.getNode(gid).merged_from.length > 0; return { exposed: s, explicit: false, reason: s ? '다른 업무 지도와 공유한 주제' : '이 업무 안의 주제' }; }
    default: return { exposed: false, explicit: false, reason: '세부 정보' };
  }
}

test('7b: 미리 계산한 표를 쓴 exposureOf가 옛 방식과 모든 샘플·모든 노드에서 같다', () => {
  const docs = allSamples();
  for (const d of SAMPLES) {
    const v = buildView(d, (id) => docs[id] || null);
    const idx = exposureIndex(v);
    for (const n of v.raw_nodes) {
      const old = legacyExposureOf(v, n.gid);
      assert.deepEqual(exposureOf(v, n.gid), old, n.gid);
      assert.deepEqual(exposureOf(v, n.gid, idx), old, n.gid);
    }
  }
});

// 고치기 전(옛 exposureOf로 계산한 projectView) 결과의 요약값. 고치기 전 코드로 한 번 떠서 고정했다.
const BEFORE = {
  'U-A1': ['2a9ffccd0c00565a', '2a9ffccd0c00565a'], 'U-K1': ['a8d00814fe3ab914', 'a8d00814fe3ab914'],
  'U-T1': ['2f2a1a5fc105e9ad', '3be1aa9276989d98'], 'U-B': ['aad742a8df7a9326', 'aad742a8df7a9326'],
  'U-D1': ['44f894318042fd63', '1e742e0b9d445337'], 'U-C': ['66813175ebafc5ff', '66813175ebafc5ff'],
  'U-O': ['03a32cea4cbea20e', '03a32cea4cbea20e'],
};

test('7b: projectView 결과가 고치기 전과 같다(7개 샘플 x 기본·모두 펼침)', () => {
  const docs = allSamples();
  for (const d of SAMPLES) {
    const v = buildView(d, (id) => docs[id] || null);
    const all = new Set(v.universes.keys());
    [new Set(), all].forEach((expanded, i) => {
      const p = projectView(v, { expanded });
      const dig = createHash('sha256').update(JSON.stringify({ n: p.nodes.map((x) => x.gid), e: p.edges, c: [...p.collapsed], x: [...p.expandable], r: p.rootGid })).digest('hex').slice(0, 16);
      assert.equal(dig, BEFORE[d.universe.id][i], `${d.universe.id} ${i ? '펼침' : '기본'}`);
    });
  }
  assert.equal(Object.keys(BEFORE).length, SAMPLES.length);
});
