// 미해결 이슈 보기(R-20, D-22, T-24). 닫힘 판정은 인수인계 초안의 「진행 중」과 같은 함수를 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import { SAMPLES } from '../app/data/index.js';
import { SAMPLE_A1 } from '../app/data/sample-a1.js';
import { ANSWERS_V1 } from '../app/data/answers-v1.js';
import { addEvent, addNode } from '../app/src/model/commands.js';
import { buildView } from '../app/src/view/view.js';
import { buildHandoverDraft, openMemosOf } from '../app/src/rules/handover.js';
import { openMemos, resolveMemoInput } from '../app/src/rules/issues.js';
import { viewOf } from './helpers.js';

const ctx = { now: '2026-10-01T10:00:00+09:00' };
const memo = (doc, occurred_at, payload, note) => addEvent(doc, { type: 'memo', occurred_at, payload, note }, ctx).doc;
const notesOf = (list) => list.map((ev) => ev.note);
const ids = (list) => list.map((ev) => ev.id);

function memoryStorage(failing = () => false) {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (failing()) throw new Error('quota'); m.set(k, String(v)); },
    removeItem: (k) => m.delete(k),
  };
}
const open = (currentId, storage = memoryStorage()) => createApp({ store: createStore(storage), samples: SAMPLES, currentId, now: () => '2026-10-02T09:00:00+09:00' });

test('월말 정산 샘플: 미해결은 이슈 2건·진행 중 2건, 6월 진행 중(해결됨이 뒤에 있음)·해결됨·주의사항은 빠진다', () => {
  const got = ids(openMemos(viewOf('U-A1')));
  assert.deepEqual([...got].sort(), ['E-006', 'E-012', 'E-014', 'E-015']);
  for (const x of ['E-010', 'E-011', 'E-013']) assert.ok(!got.includes(x), x);
});

test('초안의 「진행 중」과 같은 결과: 대사 확인 업무의 진행 중 범주 미해결이 초안 문장과 일치한다', () => {
  const v = viewOf('U-A1');
  const a = ANSWERS_V1.handover_drafts[0];
  const d = buildHandoverDraft(v, { target: a.target, from: a.from, to: a.to }).draft;
  const draftTexts = d.items.find((i) => i.key === '진행_중').sentences.map((s) => s.text);
  const fromList = openMemosOf(v, a.target).filter((ev) => ev.payload.category === 'in_progress');
  assert.ok(draftTexts.length >= 1);
  assert.deepEqual(draftTexts.map((t) => t.slice(0, 10)), fromList.map((ev) => ev.occurred_at));
});

test('닫힘 규칙: 뒤의 해결됨만 닫고, 앞의 해결됨은 닫지 않는다. 같은 대상만 닫는다', () => {
  let doc = memo(SAMPLE_A1, '2026-10-01', { target_id: 'N-002', category: 'resolved' }, '해결'); // E-012(07-10)보다 뒤
  assert.ok(!ids(openMemos(buildView(doc))).includes('E-012'));
  // 해결 뒤에 새로 쓴 이슈는 열려 있다(앞의 해결됨은 닫지 않는다)
  doc = memo(doc, '2026-10-02', { target_id: 'N-002', category: 'issue' }, '해결 뒤에 다시 생긴 문제');
  assert.deepEqual(notesOf(openMemos(buildView(doc)).filter((e) => e.payload.target_id === 'N-002')), ['해결 뒤에 다시 생긴 문제']);
  // 다른 대상의 해결됨은 닫지 않는다
  doc = memo(doc, '2026-10-03', { target_id: 'N-003', category: 'resolved' }, 'N-003만 해결');
  assert.ok(ids(openMemos(buildView(doc))).includes('E-014')); // 대상 N-001
  assert.ok(!ids(openMemos(buildView(doc))).includes('E-015')); // 대상 N-003
});

test('같은 날짜면 기록 순서로 본다(해결됨이 먼저 기록되면 안 닫힘)', () => {
  let doc = memo(SAMPLE_A1, '2026-10-01', { target_id: 'N-002', category: 'resolved' }, '먼저 기록한 해결');
  doc = addEvent(doc, { type: 'memo', occurred_at: '2026-10-01', payload: { target_id: 'N-002', category: 'issue' }, note: '나중 기록한 이슈' }, { now: '2026-10-01T11:00:00+09:00' }).doc;
  assert.ok(notesOf(openMemos(buildView(doc))).includes('나중 기록한 이슈'));
});

test('대상 없는 메모는 단 주제 집합이 같은 해결됨으로 닫힌다', () => {
  const withTopic = addNode(SAMPLE_A1, { core_type: 'topic', label: '다른 주제' }, ctx);
  const other = withTopic.node ? withTopic.node.id : withTopic.doc.nodes.at(-1).id;
  let doc = memo(withTopic.doc, '2026-10-01', { topic_ids: ['N-030'], category: 'in_progress' }, '대상 없는 진행 중');
  assert.ok(notesOf(openMemos(buildView(doc))).includes('대상 없는 진행 중'));
  doc = memo(doc, '2026-10-01', { topic_ids: ['N-030', other], category: 'resolved' }, '주제 집합이 다른 해결');
  assert.ok(notesOf(openMemos(buildView(doc))).includes('대상 없는 진행 중'));
  doc = memo(doc, '2026-10-02', { topic_ids: ['N-030'], category: 'resolved' }, '같은 주제 해결');
  assert.ok(!notesOf(openMemos(buildView(doc))).includes('대상 없는 진행 중'));
});

test('범주 인자: 진행 중만 달라고 하면 이슈는 빠진다', () => {
  assert.deepEqual(ids(openMemos(viewOf('U-A1'), { categories: ['in_progress'] })).sort(), ['E-014', 'E-015']);
});

test('업무 범위: 대사 확인 업무는 그 업무를 가리키는 미해결만 센다', () => {
  const mine = ids(openMemosOf(viewOf('U-A1'), ANSWERS_V1.handover_drafts[0].target));
  assert.ok(mine.includes('E-014') && mine.includes('E-006'));
  assert.ok(!mine.includes('E-010'));
});

test('해결로 표시: 새 해결됨 메모가 하나 생기고 목록에서 빠지며 원래 메모는 그대로다', () => {
  const app = open('U-A1');
  const before = app.doc.events.length;
  const original = JSON.parse(JSON.stringify(app.doc.events.find((e) => e.id === 'E-014')));
  const r = app.resolveMemo('U-A1/E-014', '2026-10-02');
  assert.equal(r.ok, true);
  assert.equal(app.doc.events.length, before + 1);
  const added = app.doc.events.at(-1);
  assert.equal(added.type, 'memo');
  assert.equal(added.payload.category, 'resolved');
  assert.equal(added.payload.target_id, 'N-001');
  assert.deepEqual(added.payload.topic_ids, ['N-030']);
  assert.equal(added.occurred_at, '2026-10-02');
  assert.match(added.note, /^해결: 9월 불일치 3건/);
  assert.deepEqual(app.doc.events.find((e) => e.id === 'E-014'), original);
  const rest = ids(openMemos(app.view));
  assert.ok(!rest.includes('E-014'));
  // C12-8(사용자 승인 2026-10-13): 「해결로 표시」는 그 메모 하나만 닫는다(resolves_id). 같은 대상(N-001)의 앞선 이슈 E-006은 열린 채로 남는다
  // (이전 판의 단언 "E-006도 닫힌다"는 이 요구사항 변경으로 뒤집었다)
  assert.ok(rest.includes('E-006'));
  assert.equal(added.payload.resolves_id, 'E-014');
  assert.ok(rest.includes('E-015') && rest.includes('E-012'));
});

test('같은 메모를 두 번 해결로 표시해도 해결 메모는 하나만 는다', () => {
  const app = open('U-A1');
  const before = app.doc.events.length;
  assert.equal(app.resolveMemo('U-A1/E-015', '2026-10-02').ok, true);
  const second = app.resolveMemo('U-A1/E-015', '2026-10-02');
  assert.equal(second.ok, false);
  assert.equal(second.error.already_resolved, true);
  assert.equal(app.doc.events.length, before + 1);
  // 이미 해결된 6월 건, 해결됨, 주의사항, 없는 메모도 거부
  for (const g of ['U-A1/E-010', 'U-A1/E-011', 'U-A1/E-013', 'U-A1/E-999']) assert.equal(app.resolveMemo(g, '2026-10-02').ok, false, g);
  assert.equal(app.doc.events.length, before + 1);
});

test('해결 메모 입력: 원래 메모가 오늘보다 나중 날짜여도 날짜는 원래 메모 이상이다. 긴 내용은 앞부분만 쓴다', () => {
  const a = resolveMemoInput({ occurred_at: '2026-12-01', note: '먼 날짜', payload: { target_id: 'N-002' } }, '2026-10-02');
  assert.equal(a.occurred_at, '2026-12-01');
  assert.equal(a.note, '해결: 먼 날짜');
  const b = resolveMemoInput({ occurred_at: '2026-09-01', note: '가'.repeat(100), payload: { target_id: 'N-002' } }, '2026-10-02');
  assert.equal(b.note, `해결: ${'가'.repeat(40)}…`);
  assert.equal(b.occurred_at, '2026-10-02');
});

test('묶음 화면(팀): 하위 유니버스의 미해결이 보이고, 해결 표시는 그 하위 유니버스 문서에 저장된다', () => {
  const app = open('U-T1');
  const list = openMemos(app.view);
  assert.ok(ids(list).includes('E-014'));
  assert.ok(list.every((e) => e.universe_id !== 'U-T1'));
  const teamEvents = app.doc.events.length;
  const a1Events = () => app.view.events.filter((e) => e.universe_id === 'U-A1').length;
  const a1Before = a1Events();
  const target = list.find((e) => e.universe_id === 'U-A1' && e.id === 'E-014');
  assert.equal(app.resolveMemo(target.gid, '2026-10-02').ok, true);
  assert.equal(app.doc.events.length, teamEvents); // 팀 문서는 그대로
  assert.equal(a1Events(), a1Before + 1); // 월말 정산 문서에 하나 늘었다
  assert.ok(!ids(openMemos(app.view)).includes('E-014'));
  assert.equal(app.resolveMemo(target.gid, '2026-10-02').ok, false); // 두 번째는 거부
  assert.equal(a1Events(), a1Before + 1);
});

test('저장소 쓰기 실패를 흉내 내면 W-STORAGE이고 문서·목록은 그대로다', () => {
  let failing = false;
  const app = open('U-A1', memoryStorage(() => failing));
  failing = true;
  const before = app.doc.events.length;
  const r = app.resolveMemo('U-A1/E-015', '2026-10-02');
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'W-STORAGE');
  assert.equal(app.doc.events.length, before);
  assert.ok(ids(openMemos(app.view)).includes('E-015'));
});

test('미해결 없음 → 0건', () => {
  const v = buildView({ ...SAMPLE_A1, events: SAMPLE_A1.events.filter((e) => e.type !== 'memo') });
  assert.deepEqual(openMemos(v), []);
});

// ── C12-8: 해결 메모가 가리킨 메모 하나만 닫는다 ──
test('C12-8: 같은 업무의 미해결 두 건 중 하나만 해결로 표시하면 다른 하나는 남고, 그다음 나머지도 따로 닫을 수 있다', () => {
  const app = open('U-A1');
  assert.equal(app.resolveMemo('U-A1/E-006', '2026-10-02').ok, true);
  let rest = ids(openMemos(app.view));
  assert.ok(!rest.includes('E-006'));
  assert.ok(rest.includes('E-014'));
  assert.equal(app.resolveMemo('U-A1/E-014', '2026-10-02').ok, true);
  rest = ids(openMemos(app.view));
  assert.ok(!rest.includes('E-014'));
});

test('C12-8: resolves_id가 없는 해결됨 메모(이력 추가로 직접 쓴 것·샘플)는 지금 규칙대로 같은 대상의 앞선 메모를 닫는다', () => {
  const ctx = { now: '2026-10-02T09:00:00+09:00' };
  const doc = JSON.parse(JSON.stringify(SAMPLE_A1));
  const r = addEvent(doc, { type: 'memo', occurred_at: '2026-10-02', payload: { target_id: 'N-001', topic_ids: ['N-030'], category: 'resolved' }, note: '모두 해결' }, ctx);
  assert.equal(r.ok, true);
  const view = buildView(r.doc, () => null);
  const rest = ids(openMemos(view));
  assert.ok(!rest.includes('E-014') && !rest.includes('E-006'));
});

test('C12-8: resolves_id 검증 — 없는 이벤트, 메모가 아닌 이벤트, 해결됨이 아닌 범주는 거부', () => {
  const ctx = { now: '2026-10-02T09:00:00+09:00' };
  const doc = JSON.parse(JSON.stringify(SAMPLE_A1));
  const memo = (payload) => addEvent(doc, { type: 'memo', occurred_at: '2026-10-02', payload: { target_id: 'N-001', ...payload }, note: 'x' }, ctx);
  assert.equal(memo({ category: 'resolved', resolves_id: 'E-999' }).ok, false);
  assert.equal(memo({ category: 'resolved', resolves_id: 'E-002' }).ok, false); // 인수인계 이벤트
  assert.equal(memo({ category: 'issue', resolves_id: 'E-014' }).ok, false);
  assert.equal(memo({ category: 'resolved', resolves_id: 'E-014' }).ok, true);
});

test('C12-8: 초안의 「진행 중」도 같은 규칙 — E-014만 해결하면 초안의 진행 중에서 E-014만 빠진다', () => {
  const app = open('U-A1');
  const before = buildHandoverDraft(app.view, { target: 'U-A1/N-001', from: 'U-A1/N-012', to: 'U-A1/N-010', asOf: '2026-10-02' });
  assert.equal(app.resolveMemo('U-A1/E-014', '2026-10-02').ok, true);
  const after = buildHandoverDraft(app.view, { target: 'U-A1/N-001', from: 'U-A1/N-012', to: 'U-A1/N-010', asOf: '2026-10-02' });
  const evs = (r) => (r.draft.items.find((i) => i.key === '진행_중')?.sentences || []).flatMap((x) => x.evidence_ids);
  assert.ok(evs(before).includes('U-A1/E-014'));
  assert.ok(!evs(after).includes('U-A1/E-014'));
});
