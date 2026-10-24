// CR-14 A 편집 되감기(R-25, D-30): 속성 시험(무작위 편집 → 시점마다 찍은 문서와 되감기 결과 비교)·되돌리기·오류·결함 주입
import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLES } from '../app/data/index.js';
import {
  addAssignment, addEdge, addEvent, addNode, addRef, createUniverse, decideIdentity, deleteNodeNow, hideEdge, hideNode, hideRef,
  purgeNode, replaceEdge, restoreNode, updateEdge, updateNode,
} from '../app/src/model/commands.js';
import { applyRewindOps, editPoints, rewind, rewindOps, validAt } from '../app/src/model/rewind.js';
import { createApp } from '../app/src/app/app.js';
import { validateDocument } from '../app/src/model/validate.js';
import { clone } from './helpers.js';

// ── 도구 ──
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const stamp = (base, step) => new Date(Date.parse(base) + step * 60000).toISOString().replace('.000Z', 'Z');
const canon = (x) => {
  if (Array.isArray(x)) return x.map(canon);
  if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).filter((k) => x[k] !== undefined).sort().map((k) => [k, canon(x[k])]));
  return x;
};
const REFS = { 'U-X1': { universe: { id: 'U-X1' }, refs: [] }, 'U-X2': { universe: { id: 'U-X2' }, refs: [] } };
const resolve = (id) => REFS[id] || null;
// 시각은 문자열이 아니라 순간으로 비교한다: 샘플은 +09:00, 시험이 만드는 시각은 Z라 문자열 순서가 어긋난다(검토9: 샘플 판 표시가 10-20 이후로 가며 드러남)
const maxTime = (doc) => [...doc.events.map((e) => e.recorded_at), doc.universe.created_at].filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b)).pop();

// 빈 유니버스(꼭지 + 이력 한 줄)
const emptyDoc = () => createUniverse({ name: '빈 유니버스', level: '팀', owner: '시험' }, { now: '2026-10-01T00:00:00Z', random: rng(7) }).doc;

// 노드 하나·연결 하나를 지우는 단계(바로 삭제·완전히 삭제)가 만든 한계 집합 — 비교에서 뺀다
function makeRun(startDoc, seed, steps) {
  const r = rng(seed);
  const int = (n) => Math.floor(r() * n);
  const pick = (arr) => (arr.length ? arr[int(arr.length)] : undefined);
  const base = maxTime(startDoc) < '2026-10-20' ? '2026-10-20T00:00:00Z' : maxTime(startDoc);
  let doc = clone(startDoc);
  const snaps = [{ at: maxTime(startDoc), doc: clone(doc) }];
  const lost = new Set();
  const lostEdges = new Set();
  let seq = 0;
  const types = ['work', 'person', 'artifact', 'org', 'topic'];
  for (let step = 1; step <= steps; step += 1) {
    const now = stamp(base, step);
    const ctx = { now, random: r };
    const vis = doc.nodes.filter((n) => !n.hidden && n.core_type !== 'root');
    const hid = doc.nodes.filter((n) => n.hidden && !n.deleted);
    const edgesV = doc.edges.filter((e) => !e.hidden);
    const k = int(100);
    let res = null;
    seq += 1;
    if (k < 14) res = addNode(doc, { core_type: pick(types), label: `새노드${seed}-${seq}`, description: r() < 0.5 ? `설명${seq}` : undefined }, ctx);
    else if (k < 30 && vis.length) {
      const n = pick(vis);
      const c = pick([{ label: `이름${seed}-${seq}` }, { description: `설명${seq}` }, { description: '' }, { tags: [`t${seq}`] }, { attrs: { 키: `값${seq}` } }, { period: { start: '2026-01-01' } }, { label: `이름${seed}-${seq}`, description: `d${seq}` }]);
      res = updateNode(doc, n.id, c, ctx);
    } else if (k < 38 && vis.length) res = hideNode(doc, pick(vis).id, ctx);
    else if (k < 45 && hid.length) res = restoreNode(doc, pick(hid).id, ctx);
    else if (k < 58 && vis.length > 1) {
      const a = pick(doc.nodes.filter((n) => !n.hidden));
      const b = pick(vis);
      const t = pick(['contains', 'performs', 'produces', 'precedes', 'belongs_to', 'relates_to', 'references']);
      res = addEdge(doc, { source: a.id, target: b.id, core_type: t, ...(r() < 0.4 ? { note: `메모${seq}` } : {}) }, ctx);
    } else if (k < 66 && edgesV.length) res = updateEdge(doc, pick(edgesV).id, pick([{ note: `연결메모${seq}` }, { note: '' }, { period: { start: '2026-02-01' } }, { period: null }]), ctx);
    else if (k < 72 && edgesV.length) res = hideEdge(doc, pick(edgesV).id, ctx);
    else if (k < 77 && edgesV.length) {
      const e = pick(edgesV);
      const t = pick(vis);
      if (t) res = replaceEdge(doc, e.id, { source: e.source, target: t.id, core_type: e.core_type }, ctx);
    } else if (k < 82 && vis.length) res = addEvent(doc, { type: 'memo', occurred_at: '2026-10-01', payload: { target_id: pick(vis).id }, note: `사용자 메모${seq}` }, ctx);
    else if (k < 86) {
      const ids = ['U-A/N-1', 'U-B/N-2', 'U-C/N-3', 'U-A/N-4'];
      const a = pick(ids);
      const b = pick(ids.filter((x) => x !== a));
      const status = pick(['pending', 'confirmed', 'rejected']);
      res = decideIdentity(doc, { a, b, kind: 'person', method: pick(['human', 'human', 'emp_no_auto']), status, decided_by: '시험자' }, ctx);
    } else if (k < 90) res = r() < 0.5 ? addRef(doc, pick(['U-X1', 'U-X2']), ctx, resolve) : hideRef(doc, pick(['U-X1', 'U-X2']), ctx);
    else if (k < 94) {
      const people = vis.filter((n) => n.core_type === 'person');
      const works = vis.filter((n) => n.core_type === 'work');
      if (people.length && works.length) {
        const p = pick(people);
        const w = pick(works);
        const active = doc.edges.find((e) => !e.hidden && e.core_type === 'performs' && e.source === p.id && e.target === w.id && !(e.period && e.period.end));
        res = addAssignment(doc, { type: active ? 'assign_end' : 'assign_start', occurred_at: active ? '2026-10-05' : '2026-09-05', payload: { person_id: p.id, work_id: w.id } }, ctx);
      }
    } else if (k < 97 && hid.length) {
      const n = pick(hid);
      const touching = doc.edges.filter((e) => e.source === n.id || e.target === n.id).map((e) => e.id);
      res = purgeNode(doc, n.id, ctx);
      if (res.ok) {
        lost.add(n.id);
        touching.forEach((id) => lostEdges.add(id));
      }
    } else if (vis.length) {
      const n = pick(vis);
      const touching = doc.edges.filter((e) => e.source === n.id || e.target === n.id).map((e) => e.id);
      res = deleteNodeNow(doc, n.id, ctx);
      if (res.ok && res.removed) {
        lost.add(n.id);
        touching.forEach((id) => lostEdges.add(id));
      }
    }
    if (res && res.ok && res.doc !== doc) {
      doc = res.doc;
      snaps.push({ at: now, doc: clone(doc) });
    }
  }
  return { start: startDoc, final: doc, snaps, lost, lostEdges };
}

// 한계로 알려진 노드·연결(바로 삭제·완전히 삭제)을 뺀 비교용 문서
function strip(doc, run, { identityLoose = false } = {}) {
  const lostIds = [...run.lost];
  const hit = (s) => lostIds.some((id) => s.includes(id));
  const d = clone(doc);
  d.nodes = d.nodes.filter((n) => !run.lost.has(n.id));
  d.edges = d.edges.filter((e) => !run.lostEdges.has(e.id) && !run.lost.has(e.source) && !run.lost.has(e.target));
  d.events = d.events.filter((ev) => !hit(JSON.stringify(ev.payload)) && !(ev.payload && run.lostEdges.has(ev.payload.target_id)));
  if (identityLoose) d.identity_links = d.identity_links.map(({ id, a, b, kind, status, method }) => ({ id, a, b, kind, status, method }));
  return canon(d);
}

// 되돌림 뒤 문서와 옛 문서의 비교: 숨김으로 처리된 차이는 허용
function sameVisible(then, now, run) {
  const lost = run.lost;
  const nNow = new Map(now.nodes.map((n) => [n.id, n]));
  for (const t of then.nodes) {
    if (lost.has(t.id)) continue;
    const n = nNow.get(t.id);
    assert.ok(n, `노드 ${t.id} 없음`);
    assert.equal(!!n.hidden, !!t.hidden, `노드 ${t.id} 숨김`);
    if (!t.hidden) {
      const { updated_at: _a, ...x } = n;
      const { updated_at: _b, ...y } = t;
      assert.deepEqual(canon(x), canon(y), `노드 ${t.id} 칸`);
    }
  }
  const thenIds = new Set(then.nodes.map((n) => n.id));
  for (const n of now.nodes) if (!thenIds.has(n.id) && !lost.has(n.id)) assert.equal(n.hidden, true, `뒤에 생긴 노드 ${n.id}는 숨김`);
  const key = (e) => JSON.stringify([e.source, e.target, e.core_type, e.subtype ?? null, e.period ?? null, e.note ?? null]);
  const vis = (d) => d.edges.filter((e) => !e.hidden && !lost.has(e.source) && !lost.has(e.target) && !run.lostEdges.has(e.id)).map(key).sort();
  assert.deepEqual(vis(now), vis(then), '보이는 연결');
  const kids = (d) => (d.refs || []).filter((x) => !x.hidden).map((x) => x.child_universe_id).sort();
  assert.deepEqual(kids(now), kids(then), '묶기');
  for (const l of then.identity_links || []) {
    const m = (now.identity_links || []).find((x) => x.id === l.id);
    assert.ok(m, `판정 ${l.id}`);
    assert.equal(`${m.status}/${m.method}`, `${l.status}/${l.method}`);
  }
}

const STARTS = [
  ['U-A1', () => SAMPLES.find((s) => s.universe.id === 'U-A1')],
  ['U-C1', () => SAMPLES.find((s) => s.universe.id === 'U-CARD' || s.universe.id === 'U-C1') || SAMPLES[1]],
  ['U-T1', () => SAMPLES.find((s) => s.universe.id === 'U-T1')],
  ['빈', emptyDoc],
];

// ── 속성 시험 ──
test('속성 시험: 무작위 편집 순서 240회, 시점마다 찍은 문서 = rewind(최종, 시점)', () => {
  let runs = 0;
  let checks = 0;
  let withIdentity = 0;
  for (const [name, get] of STARTS) {
    for (let i = 0; i < 60; i += 1) {
      const run = makeRun(get(), (name.length + 1) * 1000 + i, 28);
      runs += 1;
      const loose = true; // 동일성 연결의 점수·이유·판정자는 복원하지 못한다(한계)
      for (const s of run.snaps) {
        const got = rewind(run.final, s.at);
        assert.ok(got.ok, `${name}#${i} ${s.at}`);
        const want = strip(s.doc, run, { identityLoose: loose });
        const have = strip(got.doc, run, { identityLoose: loose });
        // updated_at: 규칙대로 복원 — 그 노드의 남은 이력 중 마지막 시각(없으면 created_at). 이력 없이 들어온 노드는 비교에서 같은 규칙을 쓴다
        assert.deepEqual(have, want, `${name}#${i} 시점 ${s.at}`);
        checks += 1;
        if ((got.doc.identity_links || []).length) withIdentity += 1;
      }
    }
  }
  assert.ok(runs >= 200, `회수 ${runs}`);
  assert.ok(checks > 1000);
  assert.ok(withIdentity > 50, '통합 판정이 든 문서도 시험했다');
});

test('rewind는 입력 문서를 바꾸지 않는다(동결 문서 가능)와 diff·limits 모양', () => {
  const run = makeRun(emptyDoc(), 5, 30);
  const frozen = JSON.stringify(run.final);
  const first = run.snaps[1];
  const r = rewind(run.final, first.at);
  assert.equal(JSON.stringify(run.final), frozen);
  assert.ok(Array.isArray(r.diff.added) && Array.isArray(r.diff.changed) && Array.isArray(r.diff.hidden) && Array.isArray(r.limits));
  const latest = rewind(run.final, run.snaps[run.snaps.length - 1].at);
  assert.deepEqual(latest.diff, { added: [], changed: [], hidden: [] });
  assert.deepEqual(canon(latest.doc), canon(run.final));
});

test('editPoints: 같은 기록 시각은 한 판, 오래된 순', () => {
  const run = makeRun(emptyDoc(), 11, 20);
  const pts = editPoints(run.final);
  assert.ok(pts.length >= 3);
  for (let i = 1; i < pts.length; i += 1) assert.ok(Date.parse(pts[i - 1].at) < Date.parse(pts[i].at));
  assert.equal(pts.reduce((s, p) => s + p.count, 0), run.final.events.length);
  // replaceEdge는 숨김+생성 두 줄이 같은 시각 = 한 판
  const d0 = emptyDoc();
  const a = addNode(d0, { core_type: 'work', label: 'A' }, { now: '2026-10-02T00:00:00Z' });
  const b = addNode(a.doc, { core_type: 'work', label: 'B' }, { now: '2026-10-02T00:01:00Z' });
  const e = addEdge(b.doc, { source: a.node.id, target: b.node.id, core_type: 'precedes' }, { now: '2026-10-02T00:02:00Z' });
  const rep = replaceEdge(e.doc, e.edge.id, { source: b.node.id, target: a.node.id, core_type: 'precedes' }, { now: '2026-10-02T00:03:00Z' });
  const last = editPoints(rep.doc).pop();
  assert.equal(last.count, 2);
  assert.deepEqual(last.kinds, ['hidden', 'created']);
});

// ── 되돌리기 ──
test('rewindOps 적용 뒤: 보이는 부분이 그 시점과 같고, 다시 되감으면 직전 문서가 나온다', () => {
  let applied = 0;
  let failed = 0;
  for (const [name, get] of STARTS) {
    for (let i = 0; i < 30; i += 1) {
      const run = makeRun(get(), (name.length + 3) * 777 + i, 26);
      const final = run.final;
      const finalAt = maxTime(final);
      for (const pickIdx of [1, Math.floor(run.snaps.length / 2), run.snaps.length - 2]) {
        const s = run.snaps[pickIdx];
        if (!s) continue;
        const plan = rewindOps(final, s.at);
        assert.ok(plan.ok);
        if (!plan.ops.length) continue;
        const now = stamp(finalAt, 5);
        const res = applyRewindOps(final, plan.ops, { now, random: rng(i + 1) }, { resolve, label: s.at });
        if (!res.ok) {
          failed += 1;
          assert.fail(`${name}#${i} 적용 실패 ${JSON.stringify(res.error)} ${JSON.stringify(res.op)}`);
        }
        applied += 1;
        sameVisible(rewind(final, s.at).doc, res.doc, run);
        // 새 이력은 모두 같은 시각의 한 판이고 note가 붙는다
        const added = res.doc.events.slice(final.events.length);
        assert.ok(added.length > 0 && added.every((ev) => ev.recorded_at === now && ev.note === `편집 되감기: ${s.at}으로 되돌림`));
        // 되돌림도 되감기 목록에 한 판으로 남고, 다시 되감으면 되돌리기 직전 문서
        const back = rewind(res.doc, finalAt);
        assert.deepEqual(strip(back.doc, run, { identityLoose: true }), strip(final, run, { identityLoose: true }), `${name}#${i} 재되감기`);
      }
    }
  }
  assert.ok(applied > 100, `적용 ${applied}`);
  assert.equal(failed, 0);
});

test('되돌리기: 사용자 이력(메모)은 지우지 않는다, 뒤에 생긴 노드는 숨김(지우지 않음), 완전히 삭제한 항목는 되살리지 않는다', () => { // CR-18-2
  const t = (n) => ({ now: `2026-10-02T00:0${n}:00Z`, random: rng(n + 40) });
  let d = emptyDoc();
  const a = addNode(d, { core_type: 'work', label: '옛 이름' }, t(1)); d = a.doc;
  const m = addEvent(d, { type: 'memo', occurred_at: '2026-10-02', payload: { target_id: a.node.id }, note: '사실 기록' }, t(2)); d = m.doc;
  const u = updateNode(d, a.node.id, { label: '새 이름' }, t(3)); d = u.doc;
  const b = addNode(d, { core_type: 'work', label: '뒤에 생김' }, t(4)); d = b.doc;
  const plan = rewindOps(d, '2026-10-02T00:02:00Z');
  assert.deepEqual(plan.ops.map((o) => o.op), ['hideNode', 'updateNode']);
  const res = applyRewindOps(d, plan.ops, t(5), { label: '10-02 00:02' });
  assert.ok(res.ok);
  assert.equal(res.doc.nodes.find((n) => n.id === a.node.id).label, '옛 이름');
  assert.equal(res.doc.nodes.find((n) => n.id === b.node.id).hidden, true); // 지우지 않음
  assert.ok(res.doc.events.some((ev) => ev.type === 'memo' && ev.note === '사실 기록'));
  assert.ok(res.doc.events.filter((ev) => ev.recorded_at === '2026-10-02T00:05:00Z').every((ev) => /편집 되감기/.test(ev.note)));
  // 완전히 삭제: 내용은 되살리지 못하고 자리표시로만 남는다
  let e = hideNode(d, a.node.id, t(6)); e = purgeNode(e.doc, a.node.id, t(7)); d = e.doc;
  const r2 = rewind(d, '2026-10-02T00:02:00Z');
  assert.ok(r2.limits.some((l) => l.code === 'purged' && l.id === a.node.id));
  const plan2 = rewindOps(d, '2026-10-02T00:02:00Z');
  assert.ok(!plan2.ops.some((o) => o.op === 'restoreNode' && o.id === a.node.id));
  // 재검증 결함 2(2026-10-23): 완전히 삭제한 항목는 숨기기 전 시점에서도 숨긴 채(보이는 자리표시는 검증 규칙 deleted ⇒ hidden 위반) // CR-18-2
  const pastA = r2.doc.nodes.find((n) => n.id === a.node.id);
  assert.equal(pastA.deleted, true);
  assert.equal(pastA.hidden, true);
  assert.equal(validateDocument(r2.doc).ok, true, JSON.stringify(validateDocument(r2.doc).errors));
});

test('통합 판정: 상태가 표현되면 되돌리고, 그 뒤 새로 생긴 판정은 건너뛴다(limits)', () => {
  const t = (n) => ({ now: `2026-10-03T00:0${n}:00Z`, random: rng(n + 90) });
  let d = emptyDoc();
  d = decideIdentity(d, { a: 'U-A/N-1', b: 'U-B/N-1', kind: 'person', method: 'human', status: 'pending' }, t(1)).doc;
  d = decideIdentity(d, { a: 'U-A/N-1', b: 'U-B/N-1', kind: 'person', method: 'human', status: 'confirmed', decided_by: '시험' }, t(2)).doc;
  d = decideIdentity(d, { a: 'U-A/N-2', b: 'U-B/N-2', kind: 'person', method: 'human', status: 'rejected', decided_by: '시험' }, t(3)).doc;
  const plan = rewindOps(d, '2026-10-03T00:01:00Z');
  assert.equal(plan.counts.identity, 1);
  assert.ok(plan.limits.some((l) => l.code === 'identity_created_after' && l.count === 1));
  const res = applyRewindOps(d, plan.ops, t(5), { label: 'x' });
  assert.ok(res.ok);
  assert.equal(res.doc.identity_links.find((l) => l.a === 'U-A/N-1').status, 'pending');
  assert.equal(res.doc.identity_links.length, 2);
});

test('묶기(참조)와 숨긴 연결: 그 뒤 해제한 묶기는 다시 묶고, 그 뒤 숨긴 연결은 같은 내용으로 새로 만든다', () => {
  const t = (n) => ({ now: `2026-10-04T00:0${n}:00Z`, random: rng(n + 5) });
  let d = emptyDoc();
  d = addRef(d, 'U-X1', t(1), resolve).doc;
  const a = addNode(d, { core_type: 'work', label: 'A' }, t(1)); d = a.doc;
  const b = addNode(d, { core_type: 'work', label: 'B' }, t(1)); d = b.doc;
  const e = addEdge(d, { source: a.node.id, target: b.node.id, core_type: 'precedes', note: '순서' }, t(1)); d = e.doc;
  d = hideEdge(d, e.edge.id, t(2)).doc;
  d = hideRef(d, 'U-X1', t(3)).doc;
  const plan = rewindOps(d, '2026-10-04T00:01:00Z');
  assert.deepEqual(plan.ops.map((o) => o.op).sort(), ['addEdge', 'addRef']);
  const res = applyRewindOps(d, plan.ops, t(5), { resolve, label: 'x' });
  assert.ok(res.ok);
  const live = res.doc.edges.filter((x) => !x.hidden);
  assert.equal(live.length, 1);
  assert.equal(live[0].note, '순서');
  assert.equal(res.doc.refs.filter((x) => !x.hidden).length, 1);
  // 묶기 추가가 실패하면(하위를 찾지 못함) 건너뛰고 나머지는 적용
  const res2 = applyRewindOps(d, plan.ops, t(5), { resolve: () => null, label: 'x' });
  assert.ok(res2.ok);
  assert.equal(res2.skipped.length, 1);
});

test('명령 하나가 실패하면 전부 아니면 전무: 문서 그대로', () => {
  const t = (n) => ({ now: `2026-10-05T00:0${n}:00Z`, random: rng(n) });
  let d = emptyDoc();
  const a = addNode(d, { core_type: 'work', label: 'A' }, t(1)); d = a.doc;
  const res = applyRewindOps(d, [{ op: 'hideNode', id: a.node.id }, { op: 'updateNode', id: 'N-없음', changes: { label: 'x' } }], t(2), { label: 'x' });
  assert.equal(res.ok, false);
  assert.equal(res.doc, d);
  assert.equal(d.nodes.find((n) => n.id === a.node.id).hidden, false);
});

// ── 오류 ──
test('오류: 시점 하나·잘못된 at·되돌릴 것 없음', () => {
  const d0 = emptyDoc();
  assert.equal(editPoints(d0).length, 1);
  assert.equal(rewind(d0, '아무거나').ok, false);
  assert.equal(rewind(d0, undefined).error.field, 'at');
  assert.equal(rewind(null, '2026-10-01T00:00:00Z').ok, false);
  assert.equal(validAt('2026-10-01T00:00:00Z'), true);
  assert.equal(validAt(''), false);
  const same = rewindOps(d0, editPoints(d0)[0].at);
  assert.ok(same.ok);
  assert.equal(same.ops.length, 0);
  assert.equal(applyRewindOps(d0, [], { now: '2026-10-01T00:00:00Z' }, {}).ok, false);
  // 가장 오래된 샘플(월말 정산 점검)은 되감기 시연용 수정 이력 둘이 있어 시점이 셋(처음 입력, 마감 수정, 보고 설명 보강, 검토9 R9-1 가). 다른 샘플은 한 시각뿐
  assert.equal(editPoints(SAMPLES[0]).length, 3);
  assert.equal(editPoints(SAMPLES.find((x) => x.universe.id === 'U-C')).length, 1);
});

test('앱: editPoints·viewAt·rewindTo — 읽기 전용이면 거부, 성공하면 저장, 저장 실패는 문서 그대로', () => {
  const mem = new Map();
  const mkStore = (failSave = false) => ({
    loadUniverse: (id) => (mem.has(id) ? JSON.parse(JSON.stringify(mem.get(id))) : null),
    saveUniverse: (d) => { if (failSave) throw Object.assign(new Error('q'), { name: 'QuotaExceededError', code: 22 }); mem.set(d.universe.id, JSON.parse(JSON.stringify(d))); },
    removeUniverse: (id) => mem.delete(id),
    listUniverses: () => [...mem.values()].map((d) => ({ id: d.universe.id, name: d.universe.name })),
  });
  let clock = 0;
  const now = () => stamp('2026-10-23T00:00:00Z', (clock += 1));
  const app = createApp({ store: mkStore(), samples: SAMPLES, currentId: 'U-A1', now });
  const k = app.editPoints().length; // 샘플 자체의 시점 수(월말 정산 점검은 3, 검토9 R9-1 가). 아래 「직전 시점」은 샘플의 마지막 시점이다
  assert.equal(k, 3);
  const node = app.doc.nodes.find((n) => !n.hidden && n.core_type === 'work');
  const oldLabel = node.label;
  assert.ok(app.updateNode('U-A1', node.id, { label: '고친 이름' }).ok);
  const pts = app.editPoints();
  assert.equal(pts.length, k + 1);
  const before = pts[k - 1];
  const past = app.viewAt(before.at);
  assert.ok(past.ok);
  assert.equal(past.view.getNode(`U-A1/${node.id}`).label, oldLabel);
  assert.equal(past.diff.changed.length, 1);
  assert.equal(app.viewAt('이상한 값').ok, false);
  assert.equal(app.doc.nodes.find((n) => n.id === node.id).label, '고친 이름'); // 보기만 한다
  assert.equal(app.rewindPreview(before.at).counts.update_nodes, 1);
  const done = app.rewindTo(before.at);
  assert.ok(done.ok, JSON.stringify(done));
  assert.equal(app.doc.nodes.find((n) => n.id === node.id).label, oldLabel);
  assert.equal(app.editPoints().length, k + 2);
  assert.equal(app.rewindTo(app.editPoints()[k + 1].at).ok, false); // 되돌릴 것 없음
  // 저장 실패: 문서 그대로
  const base = mkStore();
  const flaky = createApp({ store: base, samples: SAMPLES, currentId: 'U-A1', now });
  const n2 = flaky.doc.nodes.find((n) => !n.hidden && n.core_type === 'work');
  flaky.updateNode('U-A1', n2.id, { label: '고침2' });
  const p2 = flaky.editPoints();
  const keep = JSON.stringify(flaky.doc);
  base.saveUniverse = () => { throw Object.assign(new Error('q'), { name: 'QuotaExceededError', code: 22 }); };
  const bad = flaky.rewindTo(p2[p2.length - 2].at);
  assert.equal(bad.ok, false);
  assert.equal(bad.error.code, 'W-STORAGE');
  assert.equal(JSON.stringify(flaky.doc), keep);
  // 읽기 전용(내용 포함 HTML 보기)
  const locked = createApp({ store: mkStore(), samples: SAMPLES, currentId: 'U-A1', now, locked: true });
  assert.equal(locked.readOnly, true);
  assert.equal(locked.rewindTo('2026-10-01T00:00:00Z').ok, false);
});

// ── 결함 주입(수동 확인용으로 환경변수가 있을 때만 실행하지 않고, 아래에서 모듈 사본을 변조해 잡히는지 본다) ──
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve as pathResolve } from 'node:path';
import { pathToFileURL } from 'node:url';

async function mutated(patch) {
  // 복사본에서도 같은 폴더의 모듈(commands·checks·schema …)을 찾도록 상대 경로를 모두 절대 경로로
  const src = readFileSync(pathResolve('app/src/model/rewind.js'), 'utf8').replace(/from '\.\/([\w-]+\.js)'/g, (m, f) => `from '${pathToFileURL(pathResolve(`app/src/model/${f}`)).href}'`);
  const out = patch(src);
  assert.notEqual(out, src, '변조가 적용되지 않았다');
  const dir = mkdtempSync(join(tmpdir(), 'rw-'));
  const file = join(dir, 'rewind-mut.mjs');
  writeFileSync(file, out);
  try {
    return await import(`${pathToFileURL(file).href}?${Math.random()}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function propertyHolds(mod) {
  for (const [name, get] of STARTS) {
    for (let i = 0; i < 8; i += 1) {
      const run = makeRun(get(), (name.length + 1) * 1000 + i, 28);
      for (const s of run.snaps) {
        const got = mod.rewind(run.final, s.at);
        if (JSON.stringify(strip(got.doc, run, { identityLoose: true })) !== JSON.stringify(strip(s.doc, run, { identityLoose: true }))) return false;
      }
    }
  }
  return true;
}

test('결함 주입: 정순 적용·after 사용·숨김 되돌리기 누락을 속성 시험이 잡는다', async () => {
  assert.equal(propertyHolds({ rewind }), true); // 기준: 원본은 통과
  // 재검증(2026-10-23)으로 코드가 바뀌어(기록 순서로 자르기, 자리표시 숨김 유지) 같은 결함을 새 코드에 넣는다
  const forward = await mutated((s) => s.replace('for (let i = work.events.length - 1; i >= cut; i -= 1) reverseEvent', 'for (let i = cut; i < work.events.length; i += 1) reverseEvent'));
  assert.equal(propertyHolds(forward), false, '정순 적용을 잡아야 한다');
  const useAfter = await mutated((s) => s.replace('setBefore(n, p.before, NODE_REWIND_KEYS, [\'deleted\']);', 'setBefore(n, p.after, NODE_REWIND_KEYS, [\'deleted\']);'));
  assert.equal(propertyHolds(useAfter), false, 'before 대신 after를 잡아야 한다');
  const noHidden = await mutated((s) => s.replace('      if (!n.deleted) n.hidden = false;\n', ''));
  assert.equal(propertyHolds(noHidden), false, '숨김 되돌리기 누락을 잡아야 한다');
});

// ── 앱: 되감기 보기 중에는 읽기 전용과 같은 길로 모든 편집을 막는다 ──
test('앱: setRewinding(true)이면 readOnly이고 편집 명령이 거부된다, rewindTo는 보기 중에도 동작한다', () => {
  const mem = new Map();
  const store = {
    loadUniverse: (id) => (mem.has(id) ? JSON.parse(JSON.stringify(mem.get(id))) : null),
    saveUniverse: (d) => mem.set(d.universe.id, JSON.parse(JSON.stringify(d))),
    removeUniverse: (id) => mem.delete(id),
    listUniverses: () => [...mem.values()].map((d) => ({ id: d.universe.id, name: d.universe.name })),
  };
  let clock = 0;
  const app = createApp({ store, samples: SAMPLES, currentId: 'U-A1', now: () => stamp('2026-10-23T00:00:00Z', (clock += 1)) });
  const node = app.doc.nodes.find((n) => !n.hidden && n.core_type === 'work');
  app.updateNode('U-A1', node.id, { label: '바꾼 이름' });
  assert.equal(app.readOnly, false);
  assert.equal(app.baseReadOnly, false);
  app.setRewinding(true);
  assert.equal(app.readOnly, true);
  assert.equal(app.baseReadOnly, false);
  const before = JSON.stringify(app.doc);
  assert.equal(app.hideNode(node.id).ok, false);
  assert.equal(app.addNode({ core_type: 'work', label: '막혀야 함' }).ok, false);
  assert.equal(app.updateNode('U-A1', node.id, { label: 'x' }).ok, false);
  assert.equal(JSON.stringify(app.doc), before);
  const res = app.rewindTo(app.editPoints()[0].at);
  assert.ok(res.ok, JSON.stringify(res));
  app.setRewinding(false);
  assert.equal(app.hideNode(node.id).ok, true);
});

// ── 화면 문구(순수 함수) ──
import { confirmText, diffText, doneText, failText, limitTexts, revertBlock, valueText } from '../app/src/ui/rewind.js';

test('화면 문구: 확인 창에 숨김·되살림·되돌림 개수와 사용자 기록 보존이 들어간다', () => {
  const counts = { hide_nodes: 2, restore_nodes: 1, update_nodes: 3, hide_edges: 1, add_edges: 1, update_edges: 0, hide_refs: 0, add_refs: 0, identity: 0 };
  const text = confirmText({ counts, limits: [{ code: 'purged_skip', id: 'N-1' }] }, '2026-10-23T14:05:00+09:00');
  assert.match(text, /2026-10-23 14:05 시점으로 되돌립니다/);
  assert.match(text, /3개는 숨겨집니다/);
  assert.match(text, /2개는 다시 보입니다/);
  assert.match(text, /3건은 그때 값/);
  assert.match(text, /사용자 기록은 그대로/);
  assert.match(text, /완전히 삭제한 항목/); // CR-18-2
  assert.equal(diffText({ added: ['a'], changed: [1, 2], hidden: [] }), '이 시점 뒤 생김 1 · 바뀜 2 · 숨김 0');
  assert.match(doneText('2026-10-23T14:05:00+09:00', counts), /되돌렸습니다/);
  assert.match(failText({ code: 'E-SCHEMA', nothing: true }), /되돌릴 것이 없습니다/);
  assert.match(failText({ code: 'E-SCHEMA', reason: 'grouped' }), /하위 업무 지도를 열어/);
  assert.match(failText({ code: 'W-STORAGE' }), /아무것도 바뀌지 않았습니다/);
  assert.match(revertBlock({ baseReadOnly: true, nothing: false }), /읽기 전용/);
  assert.match(revertBlock({ baseReadOnly: false, nothing: true }), /되돌릴 것이 없습니다/);
  assert.equal(revertBlock({ baseReadOnly: false, nothing: false }), '');
  assert.equal(valueText(null), '(없음)');
  assert.equal(valueText({ a: 1 }), 'a: 1');
  assert.ok(limitTexts([{ code: 'purged', id: 'N-1' }]).length === 2);
});

// ── 나란히 재검증(2026-10-23) 결함 1~4: 다시 생기지 않게 ──
const visibleOf = (d) => Object.fromEntries(d.nodes.filter((n) => !n.hidden && n.core_type !== 'root').map((n) => [n.id, `${n.core_type}|${n.label}|${n.emp_no || ''}`]));
function revertTo(doc, at, now) {
  const plan = rewindOps(doc, at);
  assert.ok(plan.ok, JSON.stringify(plan.error));
  return applyRewindOps(doc, plan.ops, { now, random: rng(3) }, { resolve, label: at });
}

test('결함 1: 이름 맞바꾸기·숨긴 동안 다른 노드가 그 이름을 씀·원상 복귀·같은 사번도 되돌리기가 실패하지 않는다', () => {
  const t = (n) => ({ now: `2026-10-04T00:${String(n).padStart(2, '0')}:00Z`, random: rng(n + 40) });
  // a) 맞바꾸기: A "P", B "Q" → A "R" → B "P" → A "Q"
  let d = emptyDoc();
  const a = addNode(d, { core_type: 'work', label: 'P' }, t(1)); d = a.doc;
  const b = addNode(d, { core_type: 'work', label: 'Q' }, t(2)); d = b.doc;
  d = updateNode(d, a.node.id, { label: 'R' }, t(3)).doc;
  d = updateNode(d, b.node.id, { label: 'P' }, t(4)).doc;
  d = updateNode(d, a.node.id, { label: 'Q' }, t(5)).doc;
  const ra = revertTo(d, '2026-10-04T00:02:00Z', '2026-10-04T00:06:00Z');
  assert.ok(ra.ok, JSON.stringify(ra.error));
  assert.deepEqual(visibleOf(ra.doc), visibleOf(rewind(d, '2026-10-04T00:02:00Z').doc));
  assert.equal(validateDocument(ra.doc).ok, true);
  // b) A "X" 숨김 → B를 "X"로 → A가 보이던 시점으로
  let d2 = emptyDoc();
  const a2 = addNode(d2, { core_type: 'work', label: 'X' }, t(1)); d2 = a2.doc;
  const b2 = addNode(d2, { core_type: 'work', label: 'Y' }, t(2)); d2 = b2.doc;
  d2 = hideNode(d2, a2.node.id, t(3)).doc;
  d2 = updateNode(d2, b2.node.id, { label: 'X' }, t(4)).doc;
  const rb = revertTo(d2, '2026-10-04T00:02:00Z', '2026-10-04T00:05:00Z');
  assert.ok(rb.ok, JSON.stringify(rb.error));
  assert.deepEqual(visibleOf(rb.doc), visibleOf(rewind(d2, '2026-10-04T00:02:00Z').doc));
  // c) 원상 복귀: A "X" 숨김 → 새 B "X" → 숨기기 전으로 되돌리기 → 그 되돌림을 다시 되돌리기(사람·같은 사번도)
  for (const kind of ['work', 'person']) {
    const inp = kind === 'person' ? { core_type: 'person', label: '가상 갑', emp_no: 'V-0001' } : { core_type: 'work', label: 'X' };
    let d3 = emptyDoc();
    const a3 = addNode(d3, inp, t(1)); d3 = a3.doc;
    d3 = hideNode(d3, a3.node.id, t(2)).doc;
    d3 = addNode(d3, kind === 'person' ? { ...inp, label: '가상 을' } : inp, t(3)).doc;
    const before = clone(d3);
    const r1 = revertTo(d3, '2026-10-04T00:01:00Z', '2026-10-04T00:04:00Z');
    assert.ok(r1.ok, `${kind} 되돌리기 ${JSON.stringify(r1.error)}`);
    const r2 = revertTo(r1.doc, '2026-10-04T00:03:00Z', '2026-10-04T00:05:00Z');
    assert.ok(r2.ok, `${kind} 원상 복귀 ${JSON.stringify(r2.error)}`);
    assert.deepEqual(visibleOf(r2.doc), visibleOf(before));
  }
});

test('결함 1: 이름 4개로 무작위 편집(겹침 많음) — 되돌리기·원상 복귀가 실패하지 않고, 건너뛴 것이 없으면 보이는 노드가 그 시점과 같다', () => {
  const pool = ['가', '나', '다', '라'];
  let tried = 0;
  let fail = 0;
  let mismatch = 0;
  for (let run = 0; run < 120; run += 1) {
    const r = rng(1000 + run);
    const int = (n) => Math.floor(r() * n);
    let d = emptyDoc();
    let step = 0;
    const tick = () => ({ now: stamp('2026-10-05T00:00:00Z', (step += 1)), random: r });
    for (let k = 0; k < 16; k += 1) {
      const vis = d.nodes.filter((n) => !n.hidden && n.core_type !== 'root');
      const hid = d.nodes.filter((n) => n.hidden && !n.deleted);
      const roll = int(4);
      let res = null;
      if (roll === 0 || !vis.length) res = addNode(d, { core_type: 'work', label: pool[int(4)] }, tick());
      else if (roll === 1) res = updateNode(d, vis[int(vis.length)].id, { label: pool[int(4)] }, tick());
      else if (roll === 2) res = hideNode(d, vis[int(vis.length)].id, tick());
      else if (hid.length) res = restoreNode(d, hid[int(hid.length)].id, tick());
      if (res && res.ok) d = res.doc;
    }
    const points = editPoints(d);
    for (const p of points.slice(0, -1)) {
      const now = stamp('2026-10-05T00:00:00Z', step + 1);
      if (!rewindOps(d, p.at).ops.length) continue; // 되돌릴 것이 없는 시점(지금과 같음) — 앱은 버튼을 막는다
      tried += 1;
      const res = revertTo(d, p.at, now);
      if (!res.ok) { fail += 1; continue; }
      if (!res.skipped.length && JSON.stringify(visibleOf(res.doc)) !== JSON.stringify(visibleOf(rewind(d, p.at).doc))) mismatch += 1;
      const back = revertTo(res.doc, points[points.length - 1].at, stamp('2026-10-05T00:00:00Z', step + 2));
      if (!back.ok && !(back.error && back.error.field === 'ops')) fail += 1;
    }
  }
  assert.ok(tried > 300, `시험 수 ${tried}`);
  assert.equal(fail, 0, `실패 ${fail}/${tried}`);
  assert.equal(mismatch, 0, `불일치 ${mismatch}/${tried}`);
});

test('결함 3: 미래 시각 이력(다른 PC 시계)이 섞여도 과거 문서가 검증을 통과한다(기록 순서로 자름)', () => {
  let d = emptyDoc();
  const a = addNode(d, { core_type: 'work', label: 'A' }, { now: '2026-10-06T00:01:00Z', random: rng(1) }); d = a.doc;
  const b = addNode(d, { core_type: 'work', label: 'B' }, { now: '2099-01-01T00:00:00Z', random: rng(2) }); d = b.doc;
  d = updateNode(d, b.node.id, { label: 'B2' }, { now: '2026-10-06T00:03:00Z', random: rng(3) }).doc;
  d = addEdge(d, { source: a.node.id, target: b.node.id, core_type: 'precedes' }, { now: '2026-10-06T00:04:00Z', random: rng(4) }).doc;
  for (const at of ['2026-10-06T00:02:00Z', '2026-10-06T00:03:00Z', '2026-10-06T00:04:00Z']) {
    const past = rewind(d, at);
    assert.ok(past.ok);
    assert.equal(validateDocument(past.doc).ok, true, `${at} ${JSON.stringify(validateDocument(past.doc).errors)}`);
  }
});

test('결함 4: 되돌림이 마지막 편집과 같은 초면 1초 뒤로 기록해 판이 합쳐지지 않는다(시간대 표기 유지)', async () => {
  const { laterThanLast } = await import('../app/src/model/rewind.js');
  const ev = (t) => ({ recorded_at: t });
  assert.equal(laterThanLast('2026-10-23T11:53:12+09:00', [ev('2026-10-23T11:53:12+09:00')]), '2026-10-23T11:53:13+09:00');
  assert.equal(laterThanLast('2026-10-23T11:53:13+09:00', [ev('2026-10-23T11:53:12+09:00')]), '2026-10-23T11:53:13+09:00');
  assert.equal(laterThanLast('2026-10-23T23:59:59+09:00', [ev('2026-10-23T14:59:59Z')]), '2026-10-24T00:00:00+09:00');
  assert.equal(laterThanLast('2026-10-23T00:00:00Z', [ev('2026-10-23T00:00:05Z')]), '2026-10-23T00:00:06Z');
  // 앱: 같은 초에 되돌려도 되돌리기 직전 시점이 목록에 남는다
  const mem = new Map();
  const store = {
    loadUniverse: (id) => (mem.has(id) ? JSON.parse(JSON.stringify(mem.get(id))) : null),
    saveUniverse: (x) => mem.set(x.universe.id, JSON.parse(JSON.stringify(x))),
    removeUniverse: (id) => mem.delete(id),
    listUniverses: () => [...mem.values()].map((x) => ({ id: x.universe.id, name: x.universe.name })),
  };
  let frozen = '2026-10-23T09:00:00Z';
  const app = createApp({ store, samples: SAMPLES, currentId: 'U-A1', now: () => frozen });
  const node = app.doc.nodes.find((n) => !n.hidden && n.core_type === 'work');
  app.updateNode('U-A1', node.id, { label: '같은 초 시험' });
  const before = app.editPoints().length;
  const res = app.rewindTo(app.editPoints()[0].at); // 시계가 멈춰 같은 초
  assert.ok(res.ok, JSON.stringify(res));
  assert.equal(app.editPoints().length, before + 1);
  frozen = '2026-10-23T09:00:00Z';
});

test('결함 1: 같은 이름으로 숨겨진 노드 둘(하나는 그때 다른 이름) — 이름이 바뀔 노드부터 되살려 둘 다 돌아온다', () => {
  const t = (n) => ({ now: `2026-10-07T00:${String(n).padStart(2, '0')}:00Z`, random: rng(n + 70) });
  let d = emptyDoc();
  const g = addNode(d, { core_type: 'work', label: '다' }, t(1)); d = g.doc; // 먼저 만든 노드(목록 앞)는 그때도 「다」
  const m = addNode(d, { core_type: 'work', label: '가' }, t(2)); d = m.doc; // 그때 「가」
  d = hideNode(d, g.node.id, t(3)).doc;
  d = updateNode(d, m.node.id, { label: '다' }, t(4)).doc;
  d = hideNode(d, m.node.id, t(5)).doc;
  const res = revertTo(d, '2026-10-07T00:02:00Z', '2026-10-07T00:06:00Z');
  assert.ok(res.ok, JSON.stringify(res.error));
  assert.deepEqual(res.skipped, []);
  assert.deepEqual(visibleOf(res.doc), visibleOf(rewind(d, '2026-10-07T00:02:00Z').doc));
});

// ── 시점 라벨(9차 검토 U9-8b): 같은 분에 시점이 둘 이상이면 초까지 보인다 ──
import { pointLabeler, pointText } from '../app/src/ui/rewind.js';

test('pointLabeler: 분이 겹치지 않으면 기존 분 표시 그대로, 겹치는 시점만 초까지, 초까지 같으면 순번', () => {
  const pt = (at) => ({ at, count: 1, kinds: ['updated'] });
  // 겹치지 않음: 기존 pointLabel과 같다
  const plain = pointLabeler([pt('2026-10-23T14:05:10+09:00'), pt('2026-10-23T14:06:10+09:00')]);
  assert.equal(plain('2026-10-23T14:05:10+09:00'), '2026-10-23 14:05');
  assert.equal(plain('2026-10-23T14:06:10+09:00'), '2026-10-23 14:06');
  // 같은 분에 둘: 그 둘만 초까지(다른 분은 그대로)
  const mixed = pointLabeler([pt('2026-10-23T14:04:59+09:00'), pt('2026-10-23T14:05:10+09:00'), pt('2026-10-23T14:05:42+09:00')]);
  assert.equal(mixed('2026-10-23T14:04:59+09:00'), '2026-10-23 14:04');
  assert.equal(mixed('2026-10-23T14:05:10+09:00'), '2026-10-23 14:05:10');
  assert.equal(mixed('2026-10-23T14:05:42+09:00'), '2026-10-23 14:05:42');
  // 초까지 같고 밀리초만 다름: 오래된 순으로 순번
  const ms = pointLabeler([pt('2026-10-23T14:05:10.100+09:00'), pt('2026-10-23T14:05:10.700+09:00')]);
  assert.equal(ms('2026-10-23T14:05:10.100+09:00'), '2026-10-23 14:05:10 (1번째)');
  assert.equal(ms('2026-10-23T14:05:10.700+09:00'), '2026-10-23 14:05:10 (2번째)');
  // 목록에 없는 시점·빈 목록·읽히지 않는 값은 안전하게 분까지/원문
  assert.equal(mixed('2026-10-23T09:00:00Z'), '2026-10-23 09:00');
  assert.equal(pointLabeler([])('2026-10-23T14:05:10+09:00'), '2026-10-23 14:05');
  assert.equal(pointLabeler(null)('이상한 값'), '이상한 값');
  // 목록 한 줄과 확인·완료 문구가 같은 라벨을 쓴다
  assert.equal(pointText(pt('2026-10-23T14:05:10+09:00'), mixed), '2026-10-23 14:05:10 · 바뀐 1건');
  assert.equal(pointText(pt('2026-10-23T14:05:10+09:00')), '2026-10-23 14:05 · 바뀐 1건'); // labelOf를 안 주면 기존 표시
  const counts = { hide_nodes: 0, restore_nodes: 0, update_nodes: 1, hide_edges: 0, add_edges: 0, update_edges: 0, hide_refs: 0, add_refs: 0, identity: 0 };
  assert.match(confirmText({ counts, limits: [] }, '2026-10-23T14:05:42+09:00', mixed), /2026-10-23 14:05:42 시점으로 되돌립니다/);
  assert.match(doneText('2026-10-23T14:05:42+09:00', counts, 0, mixed), /^2026-10-23 14:05:42 시점으로 되돌렸습니다/);
});
