// 첫 업무(선택)·「처음 할 일」·「나눠 보세요」 안내(조력자 의견 2026-10-17, R-12·R-16·R-08)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import { SAMPLES } from '../app/data/index.js';
import { addAssignment, addEvent, addNode, createUniverse, updateNode } from '../app/src/model/commands.js';
import { applyStarter } from '../app/src/model/starter.js';
import { validateDocument } from '../app/src/model/validate.js';
import { starterSteps } from '../app/src/rules/starter-steps.js';
import { STANDARD_FORM, splitHint, workFormMissing } from '../app/src/rules/form.js';
import { buildView } from '../app/src/view/view.js';
import { clone } from './helpers.js';

const ctx = { now: '2026-10-17T10:00:00+09:00' };
const fresh = () => createUniverse({ name: '시작 시험', level: '업무', owner: '가상팀' }, ctx).doc;
const viewOf = (d) => buildView(d, () => null);

function memoryStorage() {
  const m = new Map();
  const st = { writes: 0, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { st.writes += 1; m.set(k, String(v)); }, removeItem: (k) => m.delete(k) };
  return st;
}
const open = (storage) => createApp({ store: createStore(storage), samples: SAMPLES, now: () => ctx.now });
const FULL = { 절차: '① a', 주기: '매월', 마감: '5일', 주의사항: '주의', '관련 문서': '문서' };

test('applyStarter: 업무만 — 업무 노드와 꼭지 연결, 주기·마감 속성', () => {
  const d = fresh();
  const snap = JSON.stringify(d);
  const r = applyStarter(d, { work: ' 월말 점검 ', cycle: '매월', due: '매월 5일' }, ctx);
  assert.equal(r.ok, true);
  assert.equal(r.doc.nodes.length, 2);
  assert.equal(r.created.work.label, '월말 점검');
  assert.deepEqual(r.created.work.attrs, { 주기: '매월', 마감: '매월 5일' });
  const e = r.doc.edges.find((x) => x.core_type === 'contains');
  assert.deepEqual([e.source, e.target], [d.universe.root_node_id, r.created.work.id]);
  assert.equal(validateDocument(r.doc).ok, true);
  assert.equal(JSON.stringify(d), snap);
});

test('applyStarter: 주기·마감이 비면 속성을 만들지 않는다', () => {
  const r = applyStarter(fresh(), { work: '업무', cycle: ' ', due: '' }, ctx);
  assert.equal(r.created.work.attrs, undefined);
});

test('applyStarter: 업무+담당자+산출물 — 노드 3개, contains·performs(시작=오늘)·produces, 담당 시작 이력', () => {
  const r = applyStarter(fresh(), { work: '월말 점검', person: '김가상', artifact: '점검표', cycle: '매월' }, ctx);
  assert.equal(r.ok, true);
  assert.equal(r.doc.nodes.length, 4); // 꼭지 + 3
  const { work, person, artifact } = r.created;
  assert.deepEqual([work.core_type, person.core_type, artifact.core_type], ['work', 'person', 'artifact']);
  const edge = (t) => r.doc.edges.find((e) => e.core_type === t);
  assert.deepEqual([edge('performs').source, edge('performs').target, edge('performs').period], [person.id, work.id, { start: '2026-10-17' }]);
  assert.deepEqual([edge('produces').source, edge('produces').target], [work.id, artifact.id]);
  assert.equal(r.doc.edges.filter((e) => e.core_type === 'contains').length, 1);
  const ev = r.doc.events.filter((e) => e.type === 'assign_start');
  assert.equal(ev.length, 1);
  assert.equal(ev[0].occurred_at, '2026-10-17');
  assert.deepEqual([ev[0].payload.person_id, ev[0].payload.work_id], [person.id, work.id]);
  assert.equal(validateDocument(r.doc).ok, true);
});

test('applyStarter: 업무 이름이 비면 건너뛴다(다른 칸은 무시, 문서 그대로)', () => {
  const d = fresh();
  for (const s of [undefined, {}, { work: '  ' }, { work: '', person: '김가상' }]) {
    const r = applyStarter(d, s, ctx);
    assert.deepEqual([r.ok, r.skipped, r.doc === d], [true, true, true]);
  }
});

test('applyStarter: 실패하면 문서는 그대로(전부 아니면 전무) — 너무 긴 이름은 단계별로 거부', () => {
  const d = fresh();
  const snap = JSON.stringify(d);
  const long = 'ㄱ'.repeat(101);
  const w = applyStarter(d, { work: long }, ctx);
  assert.equal(w.ok, false);
  assert.equal(w.error.field, 'starter_work');
  const p = applyStarter(d, { work: '업무', person: long }, ctx);
  assert.equal(p.ok, false);
  assert.equal(p.error.field, 'starter_person');
  const a = applyStarter(d, { work: '업무', person: '김가상', artifact: long }, ctx);
  assert.equal(a.ok, false);
  assert.equal(a.error.field, 'starter_artifact');
  assert.equal(a.doc, undefined);
  assert.equal(JSON.stringify(d), snap);
});

test('applyStarter: 같은 이름이라도 유형이 다르면(업무·사람·산출물) 문제없다 — 중복은 같은 유형일 때만', () => {
  const r = applyStarter(fresh(), { work: '가상', person: '가상', artifact: '가상' }, ctx);
  assert.equal(r.ok, true);
  assert.equal(r.doc.nodes.length, 4);
});

test('app.createUniverse: starter 성공이면 저장은 한 번, 다시 열어도 남는다', () => {
  const storage = memoryStorage();
  const app = open(storage);
  // 저장 한 번이 저장소 쓰기 몇 번인지(문서+목록)는 빈 유니버스 만들기로 잰다
  const b0 = storage.writes;
  app.createUniverse({ name: '기준', level: '업무', owner: '가상팀' });
  const perSave = storage.writes - b0;
  const before = storage.writes;
  const r = app.createUniverse({ name: '새 시작', level: '업무', owner: '가상팀', starter: { work: '월말 점검', person: '김가상', artifact: '점검표' } });
  assert.equal(r.ok, true);
  assert.equal(r.doc.nodes.length, 4);
  assert.equal(storage.writes - before, perSave);
  assert.equal(createStore(storage).loadUniverse(r.doc.universe.id).nodes.length, 4);
});

test('app.createUniverse: starter 없음·업무 비어 있음은 빈 유니버스(기존 동작)', () => {
  const app = open(memoryStorage());
  assert.equal(app.createUniverse({ name: '빈 1', level: '업무', owner: 'x' }).doc.nodes.length, 1);
  assert.equal(app.createUniverse({ name: '빈 2', level: '업무', owner: 'x', starter: { work: ' ' } }).doc.nodes.length, 1);
});

test('app.createUniverse: starter 실패면 아무것도 저장하지 않는다(유니버스도 안 생김)', () => {
  const storage = memoryStorage();
  const app = open(storage);
  const count = app.universes().length;
  const before = storage.writes;
  const r = app.createUniverse({ name: '실패 시험', level: '업무', owner: 'x', starter: { work: '업무', person: 'ㄱ'.repeat(101) } });
  assert.equal(r.ok, false);
  assert.equal(r.error.field, 'starter_person');
  assert.equal(storage.writes, before);
  assert.equal(app.universes().length, count);
});

test('만든 첫 업무는 설명·절차·주의사항이 남아 있다 — 양식 단계는 아직 미완', () => {
  const r = applyStarter(fresh(), { work: '월말 점검', person: '김가상', artifact: '점검표', cycle: '매월', due: '5일' }, ctx);
  assert.deepEqual(workFormMissing(viewOf(r.doc), `${r.doc.universe.id}/${r.created.work.id}`), ['설명', '절차', '주의사항']);
});

// ── 처음 할 일 ──
test('starterSteps: 샘플·묶은 유니버스·업무 0개는 null', () => {
  for (const s of SAMPLES) assert.equal(starterSteps(s, viewOf(s)), null, s.universe.id);
  const d = fresh();
  assert.equal(starterSteps(d, viewOf(d)), null);
  const grouped = { ...clone(applyStarter(d, { work: '업무' }, ctx).doc), refs: [{ child_universe_id: 'U-A1', added_at: ctx.now }] };
  assert.equal(starterSteps(grouped, viewOf(grouped)), null);
});

test('starterSteps: 단계별 완료 판정', () => {
  let d = applyStarter(fresh(), { work: '월말 점검', person: '김가상', artifact: '점검표' }, ctx).doc;
  const done = () => Object.fromEntries(starterSteps(d, viewOf(d)).steps.map((s) => [s.key, s.done]));
  assert.deepEqual(done(), { memo: false, form: false, more: false });
  const wid = d.nodes.find((n) => n.core_type === 'work').id;
  d = addEvent(d, { type: 'memo', occurred_at: '2026-10-17', payload: { target_id: wid, category: 'caution' }, note: '주의' }, ctx).doc;
  assert.deepEqual(done(), { memo: true, form: false, more: false });
  d = updateNode(d, wid, { description: '설명', attrs: FULL }, ctx).doc;
  assert.deepEqual(done(), { memo: true, form: true, more: false });
  // 업무를 더 넣으면 more는 끝, 새 업무의 양식이 비어 form은 다시 미완
  d = addNode(d, { core_type: 'work', label: '둘째 업무' }, ctx).doc;
  assert.deepEqual(done(), { memo: true, form: false, more: true });
});

test('starterSteps: 숨긴 업무는 세지 않는다', () => {
  const d = clone(applyStarter(fresh(), { work: '월말 점검' }, ctx).doc);
  const d2 = addNode(d, { core_type: 'work', label: '둘째' }, ctx).doc;
  const hid = clone(d2);
  hid.nodes.find((n) => n.label === '둘째').hidden = true;
  assert.equal(starterSteps(hid, viewOf(hid)).steps.find((s) => s.key === 'more').done, false);
});

test('starterSteps: 세 단계가 모두 끝나면 null(상자 사라짐)', () => {
  let d = applyStarter(fresh(), { work: '월말 점검', person: '김가상', artifact: '점검표' }, ctx).doc;
  const wid = d.nodes.find((n) => n.core_type === 'work').id;
  const pid = d.nodes.find((n) => n.core_type === 'person').id;
  d = addEvent(d, { type: 'memo', occurred_at: '2026-10-17', payload: { target_id: wid, category: 'caution' }, note: '주의' }, ctx).doc;
  d = updateNode(d, wid, { description: '설명', attrs: FULL }, ctx).doc;
  d = addNode(d, { core_type: 'work', label: '둘째 업무', description: '설명', attrs: FULL }, ctx).doc;
  const w2 = d.nodes.find((n) => n.label === '둘째 업무').id;
  d = addAssignment(d, { type: 'assign_start', occurred_at: '2026-10-17', payload: { person_id: pid, work_id: w2 } }, ctx).doc;
  assert.equal(starterSteps(d, viewOf(d)), null);
});

// ── 나눠 보세요 ──
test('splitHint: 표준 25개 — 샘플 판정(카드승인만 보임)', () => {
  assert.equal(STANDARD_FORM.splitAbove, 25);
  const hint = (id) => splitHint(SAMPLES.find((s) => s.universe.id === id));
  assert.deepEqual(hint('U-K1'), { count: 37, limit: 25 });
  for (const id of ['U-A1', 'U-T1', 'U-D1', 'U-O', 'U-B', 'U-C']) assert.equal(hint(id), null, id);
});

test('splitHint: 경계(25개 안 보임, 26개 보임), 숨긴 노드·꼭지 제외', () => {
  let d = fresh();
  for (let i = 1; i <= 25; i += 1) d = addNode(d, { core_type: 'work', label: `업무 ${i}` }, ctx).doc;
  assert.equal(splitHint(d), null);
  d = addNode(d, { core_type: 'work', label: '업무 26' }, ctx).doc;
  assert.deepEqual(splitHint(d), { count: 26, limit: 25 });
  const e = clone(d);
  e.nodes.find((n) => n.label === '업무 26').hidden = true;
  assert.equal(splitHint(e), null);
});
