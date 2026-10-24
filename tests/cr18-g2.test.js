// CR-18 G2(2026-10-24 승인, 일상 사용 점검 CR-18-8): D-5 사람 인수인계 초안 대상 지도 · D-6 「누가 대신할 수 있나」 표 · D-8 협업자 추가 ·
// D-10 이번 주 기록 · D-12 이미 끝난 일(해결됨으로 기록) · D-14 이력 목록의 [이슈] 꼬리표 · D-15 사번 없음 안내
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLES } from '../app/data/index.js';
import { createApp } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import { buildView } from '../app/src/view/view.js';
import { describeNode, eventText } from '../app/src/view/describe.js';
import { openMemos } from '../app/src/rules/issues.js';
import { similarExperts } from '../app/src/rules/insight.js';
import {
  BACKUP_NONE_TEXT, COLLAB_ATTR_AFFILIATION, COLLAB_ATTR_CONTACT, COLLAB_FROM_WORK, PERSON_BACKUP_TOP, WEEKLY_DEFAULT_CATEGORY,
  backupRows, collabPlan, draftCenterFor, weeklyMemoInput,
} from '../app/src/view/quick-input.js';
import { eventForm, markRelationOptions, relationOptionText } from '../app/src/ui/editor.js';
import { NO_EMPNO_TEXT, messageFor } from '../app/src/ui/messages.js';
import { MEMO_CATEGORIES, pairAllowed } from '../app/src/model/schema.js';
import { installDom, uninstallDom } from './dom-stub.js';
import { mkDoc, mkEdge, mkNode, FIXTURE_TS } from './helpers.js';
import { validateDocument } from '../app/src/model/validate.js';

const TODAY = '2026-10-24';
const NOW = '2026-10-24T15:00:00+09:00';
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const openApp = (id = 'U-A1', opts = {}) => createApp({ store: createStore(memoryStorage()), samples: SAMPLES, currentId: id, now: () => NOW, ...opts });
const sampleView = (id) => {
  const by = Object.fromEntries(SAMPLES.map((d) => [d.universe.id, d]));
  return buildView(by[id], (x) => by[x] || null);
};
const withDom = (fn) => () => {
  const body = installDom();
  try { fn(body); } finally { uninstallDom(); }
};

// ── D-5: 사람 인수인계 초안의 대상 지도 ──

// 부서(U-Z)가 팀 X(P가 업무 2개)·팀 Y(같은 사람이 업무 1개)를 묶은 가상 문서. 두 사람은 동일성 연결로 하나
function groupedDocs({ order = ['U-X', 'U-Y'], xWorks = 2, yWorks = 1, xEnded = false } = {}) {
  const perf = (p, w, period = { start: '2026-01-01' }) => mkEdge(p, w, 'performs', { period });
  const X = mkDoc('U-X', [mkNode('N-001', 'person', '가상인물'), mkNode('N-002', 'work', 'X 업무 1'), mkNode('N-003', 'work', 'X 업무 2')],
    [perf('N-001', 'N-002', xEnded ? { start: '2025-01-01', end: '2025-12-31' } : undefined), ...(xWorks > 1 ? [perf('N-001', 'N-003', xEnded ? { start: '2025-01-01', end: '2025-12-31' } : undefined)] : [])]);
  const Y = mkDoc('U-Y', [mkNode('N-001', 'person', '가상인물'), mkNode('N-002', 'work', 'Y 업무 1'), mkNode('N-003', 'work', 'Y 업무 2')],
    [perf('N-001', 'N-002'), ...(yWorks > 1 ? [perf('N-001', 'N-003')] : [])]);
  const Z = mkDoc('U-Z', [], [], [], {
    refs: order.map((id) => ({ child_universe_id: id, added_at: FIXTURE_TS })),
    identity_links: [{ id: 'I-001', a: 'U-X/N-001', b: 'U-Y/N-001', kind: 'person', method: 'human', status: 'confirmed', reason: '테스트' }],
  });
  const all = { 'U-X': X, 'U-Y': Y, 'U-Z': Z };
  return { view: buildView(Z, (id) => all[id] || null), person: 'U-X/N-001' };
}

test('D-5: 샘플 부서 화면에서 서하늘의 인수인계 초안 대상은 부서 전체가 아니라 그가 맡은 업무가 있는 월말 정산 점검 지도 중심', () => {
  const view = sampleView('U-D1');
  const c = draftCenterFor(view, 'U-A1/N-012', { asOf: TODAY });
  assert.ok(c);
  assert.equal(c.root_gid, 'U-A1/N-000');
  assert.equal(c.universe_id, 'U-A1');
  assert.notEqual(c.root_gid, 'U-D1/N-000');
  assert.equal(view.getNode(c.root_gid).core_type, 'root');
});

test('D-5: 지도 하나만 연 화면에서는 지금 지도 중심과 같다(지금 동작 그대로)', () => {
  const app = openApp('U-A1');
  const c = draftCenterFor(app.view, 'U-A1/N-012', { asOf: TODAY });
  assert.equal(c.root_gid, app.rootGid());
});

test('D-5: 하위 지도 여럿에 있는 사람은 진행 중 수행 업무가 가장 많은 하위 지도', () => {
  const { view, person } = groupedDocs({ xWorks: 2, yWorks: 1 });
  const c = draftCenterFor(view, person, { asOf: TODAY });
  assert.equal(c.universe_id, 'U-X');
  assert.equal(c.root_gid, 'U-X/N-000');
  assert.deepEqual(c.counts.map((x) => [x.universe_id, x.count]), [['U-X', 2], ['U-Y', 1]]);
  // 뒤집어서 Y가 더 많으면 Y
  const flip = groupedDocs({ xWorks: 1, yWorks: 2 });
  assert.equal(draftCenterFor(flip.view, flip.person, { asOf: TODAY }).universe_id, 'U-Y');
});

test('D-5: 같으면 화면 순서(묶은 순서) 앞쪽, 묶는 순서를 바꾸면 따라 바뀐다', () => {
  const a = groupedDocs({ xWorks: 1, yWorks: 1, order: ['U-X', 'U-Y'] });
  assert.equal(draftCenterFor(a.view, a.person, { asOf: TODAY }).universe_id, 'U-X');
  const b = groupedDocs({ xWorks: 1, yWorks: 1, order: ['U-Y', 'U-X'] });
  assert.equal(draftCenterFor(b.view, b.person, { asOf: TODAY }).universe_id, 'U-Y');
});

test('D-5: 끝난 담당은 세지 않는다 — X의 담당이 모두 끝났으면 Y. 맡은 업무가 하나도 없으면 null(지금 지도 전체로 되돌림)', () => {
  const ended = groupedDocs({ xWorks: 2, yWorks: 1, xEnded: true });
  assert.equal(draftCenterFor(ended.view, ended.person, { asOf: TODAY }).universe_id, 'U-Y');
  // 한가람(U-A1)은 담당이 모두 끝났다
  assert.equal(draftCenterFor(sampleView('U-D1'), 'U-A1/N-010', { asOf: TODAY }), null);
});

test('D-5: 오류 입력 — 사람이 아닌 노드·없는 노드는 null', () => {
  const view = sampleView('U-D1');
  assert.equal(draftCenterFor(view, 'U-A1/N-001', { asOf: TODAY }), null); // 업무
  assert.equal(draftCenterFor(view, 'U-없음/N-1', { asOf: TODAY }), null);
});

// ── D-6: 이 사람 일, 누가 대신할 수 있나 ──

test('D-6: 맡은 업무마다 후보 — 서하늘의 대사 확인은 직접 해 본 윤바다·한가람(기존 유사 경험자 계산과 같은 사람·순서)', () => {
  const view = sampleView('U-A1');
  const rows = backupRows(view, 'U-A1/N-012', { asOf: TODAY });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].work.label, '대사 확인');
  assert.deepEqual(rows[0].candidates.map((c) => c.label), ['윤바다', '한가람']);
  assert.ok(rows[0].candidates.every((c) => c.kind === 'direct' && c.state === 'direct' && /직접 해 봄\(/.test(c.text)));
  // 기존 계산을 그대로 읽는다
  const r = similarExperts(view, { works: ['U-A1/N-001'], asOf: TODAY, exclude: ['U-A1/N-012'] });
  assert.deepEqual(rows[0].candidates.map((c) => c.gid), r.direct.map((p) => p.gid));
});

test('D-6: 비슷한 일 후보는 지금 담당 중인지 끝났는지를 state로 구분한다', () => {
  const view = sampleView('U-D1');
  const rows = backupRows(view, 'U-K1/N-503', { asOf: TODAY });
  const retry = rows.find((r) => r.work.label === '장애 시 재처리');
  assert.deepEqual(retry.candidates.map((c) => [c.label, c.kind, c.state]).sort(), [['서하늘', 'similar', 'current'], ['윤바다', 'similar', 'ended'], ['한가람', 'similar', 'ended']].sort());
  assert.ok(retry.candidates.find((c) => c.label === '서하늘').text.includes('지금 담당 중'));
});

test('D-6: 후보가 없으면 빈 후보 목록 + 안내 문구 상수, 최대 인원(상수 3)과 top 인자', () => {
  const view = sampleView('U-D1');
  const none = backupRows(view, 'U-K1/N-501', { asOf: TODAY })[0];
  assert.deepEqual(none.candidates, []);
  assert.equal(BACKUP_NONE_TEXT, '후보 없음 — 비슷한 일을 해 본 기록이 없습니다');
  assert.equal(PERSON_BACKUP_TOP, 3);
  // 후보 5명(이전 담당) → 상위 3명만, total은 5
  const ppl = ['A', 'B', 'C', 'D', 'E'].map((x, i) => mkNode(`N-1${i}`, 'person', `후보${x}`));
  const doc = mkDoc('U-S', [mkNode('N-001', 'person', '떠날사람'), mkNode('N-002', 'work', '정산 업무'), ...ppl],
    [mkEdge('N-001', 'N-002', 'performs', { period: { start: '2026-06-01' } }), ...ppl.map((p, i) => mkEdge(p.id, 'N-002', 'performs', { period: { start: '2025-0' + (i + 1) + '-01', end: '2025-0' + (i + 1) + '-28' } }))]);
  const v = buildView(doc, () => null);
  const row = backupRows(v, 'U-S/N-001', { asOf: TODAY })[0];
  assert.equal(row.candidates.length, 3);
  assert.equal(row.total, 5);
  assert.equal(backupRows(v, 'U-S/N-001', { asOf: TODAY, top: 1 })[0].candidates.length, 1);
  assert.equal(backupRows(v, 'U-S/N-001', { asOf: TODAY, top: 0 })[0].candidates.length, 3); // 잘못된 값은 기본 3
});

test('D-6: 맡은 업무가 없는 사람·사람이 아닌 노드는 빈 목록(상자를 그리지 않는다)', () => {
  const view = sampleView('U-A1');
  assert.deepEqual(backupRows(view, 'U-A1/N-010', { asOf: TODAY }), []); // 한가람: 담당이 끝남
  assert.deepEqual(backupRows(view, 'U-A1/N-001', { asOf: TODAY }), []); // 업무
  assert.deepEqual(backupRows(view, 'U-없음/N-1', { asOf: TODAY }), []);
});

// ── D-8: 협업자 추가 ──

test('D-8: 협업 연결의 방향은 schema의 허용 쌍(references)을 따른다', () => {
  assert.equal(COLLAB_FROM_WORK, true);
  assert.equal(pairAllowed('references', 'work', 'person'), true);
  assert.equal(pairAllowed('references', 'person', 'work'), true);
  assert.equal(COLLAB_ATTR_AFFILIATION, '소속');
  assert.equal(COLLAB_ATTR_CONTACT, '연락처');
});

test('D-8 collabPlan: 새 사람이면 사람 노드(속성 소속·연락처) + 참조 연결의 두 명령, 비운 칸은 속성에 넣지 않는다', () => {
  const p = collabPlan([], { name: '  오하늘 ', affiliation: '가상결제팀', contact: '' }, 'N-001');
  assert.equal(p.ok, true);
  assert.equal(p.existing, false);
  assert.deepEqual(p.ops[0].input, { core_type: 'person', label: '오하늘', attrs: { 소속: '가상결제팀' } });
  assert.equal(p.ops[0].attachRoot, false);
  assert.deepEqual(p.ops[1], { op: 'addEdge', row: 2, input: { core_type: 'references', source: 'N-001', target: '@1' } });
  const none = collabPlan([], { name: '오하늘' }, 'N-001');
  assert.equal('attrs' in none.ops[0].input, false);
});

test('D-8 collabPlan: 같은 이름(공백·표기 달라도)의 사람이 있으면 새로 만들지 않고 연결만, 소속·연락처를 적었으면 반영 안 함을 알린다', () => {
  const persons = [{ id: 'N-010', label: '오하늘' }];
  const p = collabPlan(persons, { name: '오하늘', contact: '내선 1234' }, 'N-001');
  assert.equal(p.existing, true);
  assert.equal(p.ignored, true);
  assert.equal(p.ops.length, 1);
  assert.deepEqual(p.ops[0].input, { core_type: 'references', source: 'N-001', target: 'N-010' });
  assert.equal(collabPlan(persons, { name: ' 오하늘 ' }, 'N-001').ignored, false);
});

test('D-8 collabPlan 오류: 이름 비면 empty, 같은 이름 둘이면 ambiguous', () => {
  assert.deepEqual(collabPlan([], { name: '   ' }, 'N-001'), { ok: false, reason: 'empty' });
  assert.deepEqual(collabPlan([], { name: undefined }, 'N-001'), { ok: false, reason: 'empty' });
  assert.deepEqual(collabPlan([{ id: 'N-1', label: '같음' }, { id: 'N-2', label: '같음' }], { name: '같음' }, 'N-001'), { ok: false, reason: 'ambiguous' });
});

test('D-8: 한 번의 묶음 저장 — 사람 노드 + 업무→사람 참조 연결, 되감기 시점은 한 개 늘고 사번 없음 경고가 나온다', () => {
  const app = openApp('U-A1');
  const before = app.editPoints().length;
  const persons = app.view.nodes.filter((n) => n.core_type === 'person' && n.universe_id === 'U-A1');
  const plan = collabPlan(persons, { name: '오하늘', affiliation: '가상결제팀', contact: '내선 1234' }, 'N-001');
  const b = app.applyBatch(plan.ops);
  assert.equal(b.ok, true);
  assert.equal(b.created.length, 1);
  const person = b.created[0];
  assert.equal(person.core_type, 'person');
  assert.deepEqual(person.attrs, { 소속: '가상결제팀', 연락처: '내선 1234' });
  assert.ok(b.warnings.some((w) => w.code === 'W-NO-EMPNO'));
  const edge = app.doc.edges.find((e) => e.core_type === 'references' && e.source === 'N-001' && e.target === person.id);
  assert.ok(edge, '업무(N-001) → 협업자 참조');
  assert.equal(app.editPoints().length, before + 1, '되감기 한 점');
  // 저장 형식은 그대로(문서 검증 통과)
  assert.equal(validateDocument(app.doc).ok, true);
  const v = app.view;
  assert.equal(describeNode(v, 'U-A1/N-001').links.some((l) => l.relation_type === 'references' && l.other.label === '오하늘'), true);
});

test('D-8: 같은 이름을 다시 넣으면 새 사람을 만들지 않고, 이미 이어졌으면 연결 중복 오류로 아무것도 저장하지 않는다', () => {
  const app = openApp('U-A1');
  const people = () => app.view.nodes.filter((n) => n.core_type === 'person' && n.universe_id === 'U-A1');
  assert.equal(app.applyBatch(collabPlan(people(), { name: '오하늘' }, 'N-001').ops).ok, true);
  const nodes = app.doc.nodes.length;
  // 다른 업무에 같은 사람 연결: 노드 수 그대로
  const other = collabPlan(people(), { name: '오하늘', contact: '무시됨' }, 'N-002');
  assert.equal(other.existing, true);
  assert.equal(app.applyBatch(other.ops).ok, true);
  assert.equal(app.doc.nodes.length, nodes);
  // 같은 업무에 또: 중복 연결
  const edges = app.doc.edges.length;
  const dup = app.applyBatch(collabPlan(people(), { name: '오하늘' }, 'N-001').ops);
  assert.equal(dup.ok, false);
  assert.equal(dup.errors[0].error.code, 'E-DUP');
  assert.equal(app.doc.edges.length, edges);
});

test('D-8: 읽기 전용이면 저장하지 않는다', () => {
  const app = createApp({ store: null, samples: SAMPLES, currentId: 'U-A1', now: () => NOW });
  assert.equal(app.readOnly, true);
  const r = app.applyBatch(collabPlan([], { name: '오하늘' }, 'N-001').ops);
  assert.equal(r.ok, false);
});

test('D-8: 관계 고르기 목록의 「참조」 보기 글에 (협업·공유·참고) 설명, 값은 그대로 references, 다른 관계 글은 그대로', withDom(() => {
  assert.equal(relationOptionText('references'), '참조 (협업·공유·참고)');
  assert.equal(relationOptionText('performs'), '수행');
  const sel = document.createElement('select');
  for (const v of ['performs', 'references', 'relates_to']) { const o = document.createElement('option'); o.setAttribute('value', v); o.textContent = v; sel.append(o); }
  markRelationOptions(sel, 'work', 'person');
  const ref = sel.options.find((o) => o.value === 'references');
  assert.equal(ref.textContent, '참조 (협업·공유·참고)');
  assert.equal(ref.disabled, false);
  assert.equal(sel.options.find((o) => o.value === 'performs').textContent, '수행');
}));

// ── D-10: 이번 주 기록 ──

test('D-10 weeklyMemoInput: 분류 처음 값은 상수, 이력 추가 메모와 같은 모양, 내용 앞뒤 공백 제거', () => {
  assert.equal(WEEKLY_DEFAULT_CATEGORY, 'in_progress');
  const m = weeklyMemoInput({ workId: 'N-001', note: '  대사 2건 정리 ', date: TODAY });
  assert.deepEqual(m, { ok: true, input: { type: 'memo', occurred_at: TODAY, payload: { target_id: 'N-001', category: 'in_progress', topic_ids: [] }, note: '대사 2건 정리' } });
  assert.equal(weeklyMemoInput({ workId: 'N-001', category: 'caution', note: 'x', date: TODAY }).input.payload.category, 'caution');
});

test('D-10 오류: 업무를 안 골랐거나 내용이 비면 거부', () => {
  assert.deepEqual(weeklyMemoInput({ workId: '', note: 'x', date: TODAY }), { ok: false, field: 'work_id' });
  assert.deepEqual(weeklyMemoInput({ workId: 'N-001', note: '   ', date: TODAY }), { ok: false, field: 'note' });
  assert.deepEqual(weeklyMemoInput({ workId: 'N-001', note: undefined, date: TODAY }), { ok: false, field: 'note' });
});

test('D-10: 기존 이력 메모 추가 명령(app.addEvent)으로 저장 — 업무 이력에 오늘 날짜로 보이고 분류 꼬리표가 붙는다', () => {
  const app = openApp('U-A1');
  const before = app.doc.events.length;
  const m = weeklyMemoInput({ workId: 'N-001', category: 'in_progress', note: '이번 주 대사 2건 정리', date: TODAY });
  const r = app.addEvent(m.input);
  assert.equal(r.ok, true);
  assert.equal(app.doc.events.length, before + 1);
  const last = describeNode(app.view, 'U-A1/N-001').history.find((h) => h.text.includes('이번 주 대사 2건 정리'));
  assert.ok(last);
  assert.equal(last.date, TODAY);
  assert.equal(last.text, '[진행 중] 이번 주 대사 2건 정리');
  // 읽기 전용이면 거부
  const ro = createApp({ store: null, samples: SAMPLES, currentId: 'U-A1', now: () => NOW });
  assert.equal(ro.addEvent(m.input).ok, false);
});

// ── D-12: 이미 끝난 일(해결됨으로 기록) ──

const issueInput = (extra = {}) => ({ type: 'memo', occurred_at: '2026-09-15', payload: { target_id: 'N-001', category: 'issue', topic_ids: [] }, note: '9월 말 대사 불일치 3건', ...extra });

test('D-12: 이슈 + 해결됨을 한 번의 저장(같은 날짜·같은 기록 시각)으로 남기고 이슈는 미해결에 오르지 않는다', () => {
  let saves = 0;
  const base = createStore(memoryStorage());
  const store = { ...base, saveUniverse: (d) => { saves += 1; return base.saveUniverse(d); }, loadUniverse: (id) => base.loadUniverse(id), listUniverses: () => base.listUniverses(), removeUniverse: (id) => base.removeUniverse(id) };
  const app = createApp({ store, samples: SAMPLES, currentId: 'U-A1', now: () => NOW });
  const countBefore = saves;
  const pointsBefore = app.editPoints().length;
  const eventsBefore = app.doc.events.length;
  const r = app.addMemoResolved(issueInput());
  assert.equal(r.ok, true);
  assert.equal(saves - countBefore, 1, '저장 한 번');
  assert.equal(app.doc.events.length, eventsBefore + 2);
  assert.equal(app.editPoints().length, pointsBefore + 1, '되감기 한 점');
  const [a, b] = [r.event, r.resolvedEvent];
  assert.equal(a.payload.category, 'issue');
  assert.equal(b.payload.category, 'resolved');
  assert.equal(b.payload.resolves_id, a.id);
  assert.equal(b.payload.target_id, 'N-001');
  assert.equal(a.occurred_at, '2026-09-15');
  assert.equal(b.occurred_at, '2026-09-15', '같은 날짜');
  assert.equal(a.recorded_at, b.recorded_at, '같은 기록 시각');
  // 미해결 목록에 이 이슈가 없다
  const open = openMemos(app.view);
  assert.equal(open.some((x) => x.id === a.id), false);
  assert.equal(validateDocument(app.doc).ok, true, '저장 형식은 그대로(기존 필드만)');
  // 이력 순서: 이슈가 해결됨보다 앞
  const order = app.view.events.filter((e) => e.id === a.id || e.id === b.id).map((e) => e.id);
  assert.deepEqual(order, [a.id, b.id]);
});

test('D-12: ID가 무작위여도 늘 이슈가 해결됨보다 앞(300번 반복)', () => {
  for (let i = 0; i < 300; i += 1) {
    const app = openApp('U-A1');
    const r = app.addMemoResolved(issueInput({ occurred_at: TODAY }));
    assert.equal(r.ok, true);
    assert.equal(openMemos(app.view).some((x) => x.id === r.event.id), false, `반복 ${i}`);
  }
});

test('D-12 오류: 이슈가 아닌 분류·없는 업무·숨긴 업무·읽기 전용이면 아무것도 저장하지 않는다', () => {
  const app = openApp('U-A1');
  const snap = JSON.stringify(app.doc);
  assert.equal(app.addMemoResolved(issueInput({ payload: { target_id: 'N-001', category: 'caution' } })).ok, false);
  assert.equal(app.addMemoResolved(issueInput({ payload: { target_id: 'N-없음', category: 'issue' } })).ok, false);
  assert.equal(app.addMemoResolved(issueInput({ occurred_at: '2026-13-45' })).ok, false);
  assert.equal(app.addMemoResolved(null).ok, false);
  assert.equal(JSON.stringify(app.doc), snap, '실패하면 문서가 그대로');
  assert.equal(app.hideNode('N-001').ok, true);
  const snap2 = JSON.stringify(app.doc);
  assert.equal(app.addMemoResolved(issueInput()).ok, false, '숨긴 업무');
  assert.equal(JSON.stringify(app.doc), snap2);
  const ro = createApp({ store: null, samples: SAMPLES, currentId: 'U-A1', now: () => NOW });
  assert.equal(ro.addMemoResolved(issueInput()).ok, false);
});

test('D-12 양식: 「이미 끝난 일」 칸은 분류가 이슈일 때만 보이고, 켜고 기록하면 also_resolved가 실려 나간다', withDom(() => {
  let sent = null;
  const form = eventForm({ node: { id: 'N-001', core_type: 'work', label: '가상 업무' }, nodes: [], handovers: [], onSubmit: (v) => { sent = v; return { ok: true }; }, onCancel() {} });
  const box = form.querySelector('[data-testid=event-past-box]');
  const check = form.querySelector('[data-testid=event-past-resolved]');
  const cat = form.querySelector('[data-testid=event-category]');
  const note = form.querySelector('[data-testid=event-note]');
  assert.equal(box.hidden, false, '처음 분류는 이슈');
  cat.value = 'caution';
  cat.fire('change');
  assert.equal(box.hidden, true);
  cat.value = 'issue';
  cat.fire('change');
  assert.equal(box.hidden, false);
  note.value = '지난달 일';
  form.fire('submit');
  assert.equal('also_resolved' in sent, false, '끄면 예전과 같다');
  check.checked = true;
  form.fire('submit');
  assert.equal(sent.also_resolved, true);
  assert.equal(sent.payload.category, 'issue');
  // 분류를 바꾸면 켜 둔 칸이 실려 나가지 않는다
  cat.value = 'in_progress';
  cat.fire('change');
  form.fire('submit');
  assert.equal('also_resolved' in sent, false);
  assert.equal(MEMO_CATEGORIES.issue, '이슈');
}));

// ── D-14: 이력 목록의 [이슈] 꼬리표 ──

test('D-14: 업무 이력 목록에서 이슈 메모에도 다른 분류와 같이 꼬리표 [이슈]가 붙는다(범주가 없는 옛 메모 포함)', () => {
  const app = openApp('U-A1');
  app.addEvent({ type: 'memo', occurred_at: TODAY, payload: { target_id: 'N-001', category: 'issue' }, note: '이슈 메모' });
  app.addEvent({ type: 'memo', occurred_at: TODAY, payload: { target_id: 'N-001' }, note: '범주 없는 메모' });
  app.addEvent({ type: 'memo', occurred_at: TODAY, payload: { target_id: 'N-001', category: 'caution' }, note: '주의 메모' });
  const texts = describeNode(app.view, 'U-A1/N-001').history.map((h) => h.text);
  assert.ok(texts.includes('[이슈] 이슈 메모'));
  assert.ok(texts.includes('[이슈] 범주 없는 메모'));
  assert.ok(texts.includes('[주의사항] 주의 메모'));
  // 샘플에 원래 있던 이슈 메모도 꼬리표가 붙는다: 꼬리표 없는 메모 줄은 메모가 아닌 것뿐
  const memoLines = describeNode(sampleView('U-A1'), 'U-A1/N-001').history.filter((h) => h.type_label === '메모');
  assert.ok(memoLines.length > 0);
  assert.ok(memoLines.every((h) => /^\[(이슈|주의사항|진행 중|해결됨)\] /.test(h.text)), memoLines.map((h) => h.text).join(' / '));
});

test('D-14: 근거 글(eventText 기본)은 그대로 — LLM 입력·근거 칩 문장이 바뀌지 않는다', () => {
  const view = sampleView('U-A1');
  const issue = view.events.find((e) => e.type === 'memo' && (e.payload.category || 'issue') === 'issue');
  assert.ok(issue);
  assert.equal(eventText(view, issue).startsWith('[이슈]'), false);
  assert.equal(eventText(view, issue, { tagIssue: true }).startsWith('[이슈] '), true);
});

// ── D-15: 사번 없음 안내 ──

test('D-15: 사번 없는 사람 저장 안내에 「다른 팀 사람이면 사번 없이 두어도 됩니다」가 들어 있다', () => {
  const text = messageFor({ code: 'W-NO-EMPNO', target_id: 'N-1' });
  assert.equal(text, NO_EMPNO_TEXT);
  assert.ok(text.includes('다른 팀 사람이면 사번 없이 두어도 됩니다'));
  assert.ok(text.startsWith('사번 없이 저장했습니다.'));
});
