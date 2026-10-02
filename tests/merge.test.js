// T-10 통합(R-11 AC ①~⑤, D-03, 12.7 흐름 3): 사번 자동 연결, 확인 목록(사번 충돌·없음), 업무 후보, 사람 판정, 원본 불변
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLES } from '../app/data/index.js';
import { ANSWERS_V1 } from '../app/data/answers-v1.js';
import { createApp } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import { decideIdentity } from '../app/src/model/commands.js';
import { validateDocument } from '../app/src/model/validate.js';
import { buildView } from '../app/src/view/view.js';
import { describeNode, eventText } from '../app/src/view/describe.js';
import { mergePlan } from '../app/src/merge/merge.js';
import { buildHandoverDraft } from '../app/src/rules/handover.js';

const all = Object.fromEntries(SAMPLES.map((d) => [d.universe.id, d]));
const viewOf = (id, override = {}) => buildView(override[id] || all[id], (x) => override[x] || all[x] || null);
const ctx = { now: '2026-10-03T10:00:00+09:00' };
const pairIn = (list, a, b) => list.some((x) => [x.a, x.b].sort().join('|') === [a, b].sort().join('|'));
function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
const openApp = (storage, currentId) => createApp({ store: createStore(storage), samples: SAMPLES, currentId, now: () => ctx.now });

test('R-11 ①: A팀·B팀·C팀을 묶으면 부서 유니버스가 생기고, 사번·이름이 같은 사람(윤바다)은 노드 하나', () => {
  const storage = memStorage();
  const app = openApp(storage);
  const r = app.groupUniverses({ name: '가상 통합부', level: '부서', owner: '가상 통합부', childIds: ['U-T1', 'U-B', 'U-C'] });
  assert.equal(r.ok, true);
  assert.equal(r.auto_linked, 1);
  const link = r.doc.identity_links.find((l) => l.method === 'emp_no_auto');
  assert.deepEqual([link.kind, link.status], ['person', 'confirmed']);
  const v = buildView(r.doc, (x) => (x === r.doc.universe.id ? r.doc : createStore(storage).loadUniverse(x)));
  assert.equal(v.canonical('U-B/N-202'), v.canonical('U-A1/N-011'));
  assert.equal(v.nodes.filter((n) => n.core_type === 'person' && n.label === '윤바다').length, 1);
  assert.deepEqual(validateDocument(r.doc).errors, []);
});

test('R-11 ③: 사번 충돌(윤바다/윤바다라)과 사번 없음(임가온)은 자동으로 판단하지 않고 확인 목록에 오른다(한 번씩만)', () => {
  const plan = mergePlan(viewOf('U-D1'), all['U-D1'].identity_links);
  const conflicts = plan.persons.filter((p) => p.type === 'conflict');
  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0].reason, /V-1002.*윤바다.*윤바다라/);
  assert.ok(plan.persons.some((p) => p.type === 'no_empno' && p.a === 'U-C/N-204'));
  assert.equal(plan.auto.length, 0); // 샘플 부서는 이미 윤바다를 이어 두었다
});

test('R-11 ②: 업무는 자동으로 합치지 않고 후보로만 나온다 — 정답 표의 같은 업무 쌍이 모두 후보에 있다', () => {
  for (const sw of ANSWERS_V1.same_work_pairs) {
    const plan = mergePlan(viewOf(sw.view), all[sw.view].identity_links);
    assert.ok(pairIn(plan.works, sw.a, sw.b), `${sw.id} ${sw.why}`);
  }
  const v = viewOf('U-D1');
  assert.notEqual(v.canonical('U-B/N-103'), v.canonical('U-C/N-102')); // 판정 전에는 따로
  for (const w of mergePlan(v, []).works) {
    assert.ok(w.reason && w.evidence_ids.includes(w.a) && w.evidence_ids.includes(w.b));
    for (const g of w.evidence_ids) assert.ok(v.lookup(g).found, g);
  }
});

test('R-11 ② ④ ⑤: 사람이 "같은 업무"로 확정하면 통합 화면에서 한 노드, 원본 유니버스는 그대로, 다시 묻지 않음', () => {
  const storage = memStorage();
  const app = openApp(storage, 'U-D1');
  const before = { b: storage.getItem('wu:v1:u:U-B'), c: storage.getItem('wu:v1:u:U-C') };
  const r = app.decideIdentity({ a: 'U-B/N-103', b: 'U-C/N-102', kind: 'work', status: 'confirmed', reason: '장소 예약 업무' });
  assert.equal(r.ok, true);
  const v = app.view;
  assert.equal(v.canonical('U-C/N-102'), v.canonical('U-B/N-103'));
  assert.ok(!pairIn(app.mergePlan().works, 'U-B/N-103', 'U-C/N-102'));
  assert.deepEqual({ b: storage.getItem('wu:v1:u:U-B'), c: storage.getItem('wu:v1:u:U-C') }, before); // R-11 ⑤
  // R-11 ④: 통합 결과도 같은 방식으로 탐색·초안
  const d = describeNode(v, 'U-B/N-103', { asOf: '2026-10-03' });
  assert.ok(d.found && d.rows.some((x) => x.label === '같은 노드'));
  assert.ok(d.history.some((h) => h.text.includes('같은 업무로 확인')));
  const draft = buildHandoverDraft(v, { target: 'U-C/N-101', from: 'U-C/N-202', to: 'U-C/N-201' });
  assert.equal(draft.ok, true);
  assert.deepEqual(validateDocument(app.doc).errors, []);
});

test('R-11 ③: "다른 사람"으로 판정한 사번 충돌은 목록과 개요 알림에서 빠지고 다시 묻지 않는다', () => {
  const app = openApp(memStorage(), 'U-D1');
  assert.equal(app.view.empno_conflicts.length, 1);
  assert.equal(app.decideIdentity({ a: 'U-A1/N-011', b: 'U-C/N-205', kind: 'person', status: 'rejected' }).ok, true);
  assert.equal(app.view.empno_conflicts.length, 0);
  assert.equal(app.mergePlan().persons.filter((p) => p.type === 'conflict').length, 0);
  // 행사팀 쪽 윤바다 노드(같은 사람으로 이미 합쳐짐)로도 다시 묻지 않는다
  assert.ok(!pairIn(app.mergePlan().persons, 'U-B/N-202', 'U-C/N-205'));
  const ev = app.view.events.at(-1);
  assert.equal(eventText(app.view, ev), '통합 확인 — 윤바다(월말 정산 점검) · 윤바다라(가상교육팀): 다른 사람으로 판정');
});

test('판정 기록 규칙: 같은 노드·판정자 없음·같은 판정 반복은 거부, 바꾸면 수정 이벤트(이전 값 남음)', () => {
  const doc = all['U-D1'];
  assert.equal(decideIdentity(doc, { a: 'U-B/N-103', b: 'U-B/N-103', kind: 'work', status: 'confirmed', decided_by: 'x' }, ctx).ok, false);
  assert.equal(decideIdentity(doc, { a: 'U-B/N-103', b: 'U-C/N-102', kind: 'work', status: 'confirmed' }, ctx).error.field, 'decided_by');
  assert.equal(decideIdentity(doc, { a: 'U-B/N-103', b: 'U-C/N-102', kind: 'work', method: 'emp_no_auto', status: 'confirmed' }, ctx).error.field, 'method');
  const once = decideIdentity(doc, { a: 'U-B/N-103', b: 'U-C/N-102', kind: 'work', status: 'confirmed', decided_by: 'x' }, ctx).doc;
  assert.equal(decideIdentity(once, { a: 'U-C/N-102', b: 'U-B/N-103', kind: 'work', status: 'confirmed', decided_by: 'x' }, ctx).error.code, 'E-DUP');
  const changed = decideIdentity(once, { a: 'U-C/N-102', b: 'U-B/N-103', kind: 'work', status: 'rejected', decided_by: 'x' }, ctx);
  assert.equal(changed.ok, true);
  assert.equal(changed.doc.identity_links.length, once.identity_links.length);
  assert.deepEqual(changed.event.payload.before, { status: 'confirmed', method: 'human' });
  assert.deepEqual(validateDocument(changed.doc).errors, []);
});

// 순환 참조 거부는 tests/t13.test.js 예외 8(E-CYCLE)에서 확인한다
test('묶기 입력 오류: 같은 하위 유니버스를 두 번 고르면 거부, 부서와 그 아래 팀을 함께 고르는 것은 허용', () => {
  const app = openApp(memStorage(), 'U-A1');
  const r = app.groupUniverses({ name: '고리', level: '부서', owner: 'x', childIds: ['U-D1', 'U-T1'] });
  assert.equal(r.ok, true); // U-D1과 U-T1을 함께 묶는 것은 고리가 아니다(부서 아래 팀)
  const appT = openApp(memStorage(), 'U-T1');
  assert.equal(appT.groupUniverses({ name: 'x', level: '팀', owner: 'x', childIds: ['U-A1', 'U-A1'] }).ok, false);
});

test('합쳐진 업무는 품은 노드의 유니버스 업무와 다시 짝짓지 않는다(장소 섭외=강의실·강사 섭외 확정 뒤 신입 교육 운영과 후보 아님)', () => {
  const app = openApp(memStorage(), 'U-D1');
  app.decideIdentity({ a: 'U-B/N-103', b: 'U-C/N-102', kind: 'work', status: 'confirmed' });
  const works = app.mergePlan().works;
  const merged = app.view.canonical('U-B/N-103');
  assert.ok(!works.some((w) => (w.a === merged || w.b === merged) && [w.a, w.b].some((g) => g.startsWith('U-C/'))));
});
