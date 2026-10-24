// CR-18 W-A(2026-10-24 승인): ① 묶은 지도 첫 배율·접힘 안내의 순수 계산 ⑥ 확정 때 「담당도 넘기기」(같은 묶음 명령·되감기·원자성·읽기 전용)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLES } from '../app/data/index.js';
import { createApp } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import { buildView } from '../app/src/view/view.js';
import { projectView } from '../app/src/view/collapse.js';
import { firstViewZoom, foldedInside } from '../app/src/view/explore.js';
import { transferPlan, handoverWorks, localIdIn } from '../app/src/view/transfer.js';
import { buildHandoverDraft } from '../app/src/rules/handover.js';
import { validateDocument } from '../app/src/model/validate.js';
import { draftPanel, forgetLastPeople, transferListText, TRANSFER_LABEL } from '../app/src/ui/draft.js';
import { installDom, uninstallDom } from './dom-stub.js';
import { EXPLORE } from '../app/src/ui/explore.js';
import { clone } from './helpers.js';

// ── ① 첫 배율 고르기 ──
test('CR-18-1: 묶은 지도에서 fit 결과의 이름이 기준보다 작으면 읽히는 배율로 올린다', () => {
  const r = firstViewZoom({ fitZoom: 0.3, fontPx: 14, readPx: 11, grouped: true, minZoom: 0.2, maxZoom: 1.8 });
  assert.equal(r.raised, true);
  assert.ok(Math.abs(r.zoom - 11 / 14) < 1e-9);
  assert.ok(r.zoom * 14 >= 11 - 1e-9);
});

test('CR-18-1: 업무 하나짜리(묶음 아님)이거나 이미 읽히면 fit 그대로, 배율을 낮추지도 않는다', () => {
  assert.deepEqual(firstViewZoom({ fitZoom: 0.3, fontPx: 14, readPx: 11, grouped: false }), { zoom: 0.3, raised: false });
  assert.deepEqual(firstViewZoom({ fitZoom: 0.9, fontPx: 14, readPx: 11, grouped: true }), { zoom: 0.9, raised: false });
  // 정확히 기준과 같으면 올리지 않는다(11px는 읽힘)
  assert.deepEqual(firstViewZoom({ fitZoom: 11 / 14, fontPx: 14, readPx: 11, grouped: true }), { zoom: 11 / 14, raised: false });
  // 라이브러리 최대 배율에 막혀 fit보다 올릴 수 없으면 그대로
  assert.deepEqual(firstViewZoom({ fitZoom: 0.3, fontPx: 14, readPx: 11, grouped: true, maxZoom: 0.3 }), { zoom: 0.3, raised: false });
});

test('CR-18-1: 잘못된 입력(0·NaN·기준 끔)은 fit 그대로', () => {
  assert.equal(firstViewZoom({ fitZoom: 0, fontPx: 14, readPx: 11, grouped: true }).raised, false);
  assert.equal(firstViewZoom({ fitZoom: 0.3, fontPx: 0, readPx: 11, grouped: true }).raised, false);
  assert.equal(firstViewZoom({ fitZoom: 0.3, fontPx: 14, readPx: 0, grouped: true }).raised, false); // FIRST_READ_PX = 0이면 끔
  assert.equal(firstViewZoom({ fitZoom: NaN, fontPx: 14, readPx: 11, grouped: true }).raised, false);
  assert.equal(EXPLORE.FIRST_READ_PX, 11);
});

const sampleView = (id) => {
  const by = Object.fromEntries(SAMPLES.map((d) => [d.universe.id, d]));
  return buildView(by[id], (x) => by[x] || null);
};

test('CR-18-1: 부서 화면에서 팀을 펼치면 그 안의 접힌 묶음(업무 지도 둘)을 센다, 안 접힌 팀은 0', () => {
  const view = sampleView('U-D1');
  const expanded = new Set(['U-T1']);
  const display = projectView(view, { expanded });
  assert.deepEqual(foldedInside(view, display, 'U-T1').sort(), ['U-A1', 'U-K1']);
  // 안쪽까지 다 펼치면 접힌 것이 없다
  const all = projectView(view, { expanded: new Set(['U-T1', 'U-A1', 'U-K1']) });
  assert.deepEqual(foldedInside(view, all, 'U-T1'), []);
  // 하위가 없는 팀(가상행사팀)을 펼쳐도 0
  assert.deepEqual(foldedInside(view, projectView(view, { expanded: new Set(['U-B']) }), 'U-B'), []);
  // 모르는 유니버스
  assert.deepEqual(foldedInside(view, display, 'U-없음'), []);
});

// ── ⑥ 담당도 넘기기 ──
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const DATE = '2026-10-24';
const NOW = '2026-10-24T15:00:00+09:00';
const TEXT = '[확정] 서하늘 → 윤바다 인수인계 초안: 대사 확인\n■ 업무 개요\n  - …';
const openApp = (storage, id = 'U-A1') => createApp({ store: createStore(storage), samples: SAMPLES, currentId: id, now: () => NOW });
const draftOf = (app, target, from, to) => buildHandoverDraft(app.view, { target, from, to }).draft;
const performs = (doc) => doc.edges.filter((e) => e.core_type === 'performs').map((e) => `${e.source}->${e.target} ${JSON.stringify(e.period || null)}${e.hidden ? ' H' : ''}`).sort();
const D_NEW = () => ['U-A1/N-001', 'U-A1/N-012', 'U-A1/N-011'];

test('CR-18-6: 담당 넘기기를 끄면 수행 연결은 그대로(기존 동작), 결과에 transfer가 없다', () => {
  const app = openApp(memoryStorage());
  const before = performs(app.doc);
  const r = app.confirmHandover({ draft: draftOf(app, ...D_NEW()), text: TEXT, date: DATE });
  assert.equal(r.ok, true);
  assert.equal(r.transfer, undefined);
  assert.deepEqual(performs(app.doc), before);
});

test('CR-18-6: 켜고 확정하면 보내는 사람의 수행이 오늘로 끝나고 받는 사람의 수행이 오늘 시작한다(한 번의 저장·같은 기록 시각)', () => {
  const storage = memoryStorage();
  const app = openApp(storage);
  const evBefore = app.doc.events.length;
  const r = app.confirmHandover({ draft: draftOf(app, ...D_NEW()), text: TEXT, date: DATE, transfer: true });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(r.transfer, { moved: ['U-A1/N-001'], already: [], elsewhere: [] });
  const doc = openApp(storage).doc; // 다시 열어도 남아 있다
  assert.equal(validateDocument(doc).ok, true);
  assert.ok(performs(doc).includes('N-012->N-001 {"start":"2026-10-01","end":"2026-10-24"}'));
  assert.ok(performs(doc).includes('N-011->N-001 {"start":"2026-10-24"}'));
  // 이력: 확정(인수인계) + 담당 종료 + 담당 시작이 모두 같은 기록 시각
  const added = doc.events.slice(evBefore);
  const kinds = added.map((e) => e.type);
  assert.ok(kinds.includes('handover') && kinds.includes('assign_end') && kinds.includes('assign_start'), kinds.join());
  assert.equal(new Set(added.map((e) => e.recorded_at)).size, 1);
  const end = added.find((e) => e.type === 'assign_end');
  const start = added.find((e) => e.type === 'assign_start');
  assert.deepEqual([end.occurred_at, end.payload.person_id, end.payload.work_id], [DATE, 'N-012', 'N-001']);
  assert.deepEqual([start.occurred_at, start.payload.person_id, start.payload.work_id], [DATE, 'N-011', 'N-001']);
  // 지금 담당이 받는 사람으로 바뀌어 보인다
  const cur = app.view.edges.filter((e) => e.core_type === 'performs' && e.target === 'U-A1/N-001' && !(e.period && e.period.end)).map((e) => e.source);
  assert.deepEqual(cur, ['U-A1/N-011']);
});

test('CR-18-6: 지도 중심 대상이면 보내는 사람이 수행 중인 업무 전부를 넘긴다', () => {
  const app = openApp(memoryStorage());
  // 서하늘은 대사 확인 하나만 수행 중. 윤바다(끝난 담당)를 보내는 사람으로 하면 넘길 업무가 없다
  const plan = transferPlan(app.view, { target: 'U-A1/N-000', from: 'U-A1/N-011', to: 'U-A1/N-012' }, 'U-A1');
  assert.deepEqual(plan.moves, []);
  const ok = transferPlan(app.view, { target: 'U-A1/N-000', from: 'U-A1/N-012', to: 'U-A1/N-011' }, 'U-A1');
  assert.deepEqual(ok.moves.map((m) => m.work), ['U-A1/N-001']);
  assert.equal(ok.persons_ok, true);
  assert.deepEqual(handoverWorks(app.view, { target: 'U-A1/N-001', from: 'U-A1/N-012' }), ['U-A1/N-001']);
  // 넘길 업무가 없으면 켜고 확정해도 연결은 그대로, 안내용 transfer.moved는 빈 목록
  const before = performs(app.doc);
  const r = app.confirmHandover({ draft: draftOf(app, 'U-A1/N-000', 'U-A1/N-011', 'U-A1/N-012'), text: TEXT, date: DATE, transfer: true });
  assert.equal(r.ok, true);
  assert.deepEqual(r.transfer.moved, []);
  assert.deepEqual(performs(app.doc), before);
});

test('CR-18-6: 받는 사람이 이미 수행 중이면 건너뛰고 보내는 사람의 연결도 건드리지 않는다', () => {
  const app = openApp(memoryStorage());
  const p = app.addNode({ core_type: 'person', label: '가상 후임', emp_no: 'V-7001' });
  assert.ok(app.addEvent({ type: 'assign_start', occurred_at: '2026-10-10', payload: { person_id: p.node.id, work_id: 'N-001' } }).ok);
  const before = performs(app.doc);
  const r = app.confirmHandover({ draft: draftOf(app, 'U-A1/N-001', 'U-A1/N-012', `U-A1/${p.node.id}`), text: TEXT, date: DATE, transfer: true });
  assert.equal(r.ok, true);
  assert.deepEqual(r.transfer, { moved: [], already: ['U-A1/N-001'], elsewhere: [] });
  assert.deepEqual(performs(app.doc), before);
});

test('CR-18-6 오류: 담당 종료가 실패하면(시작일보다 앞선 날짜) 확정 전체가 취소되어 아무것도 바뀌지 않는다', () => {
  const storage = memoryStorage();
  const app = openApp(storage);
  const keep = JSON.stringify(app.doc);
  // 서하늘의 수행 시작은 2026-10-01 → 2026-09-01에 끝낼 수 없다
  const r = app.confirmHandover({ draft: draftOf(app, ...D_NEW()), text: TEXT, date: '2026-09-01', transfer: true });
  assert.equal(r.ok, false);
  assert.deepEqual([r.error.code, r.error.field], ['E-SCHEMA', 'period']); // 담당 종료 단계에서 실패 — 그 앞에 만든 인수인계서·이력도 남지 않는다
  assert.equal(JSON.stringify(app.doc), keep);
  assert.equal(JSON.stringify(openApp(storage).doc), keep); // 저장소에도 아무것도 쓰지 않았다
});

test('CR-18-6 오류: 받는 사람이 대상 지도 안에 없으면(팀 화면의 하위 지도 사람) 거부하고 아무것도 바꾸지 않는다', () => {
  const app = openApp(memoryStorage(), 'U-T1');
  const keep = JSON.stringify(app.doc);
  const draft = { target: 'U-T1/N-000', from: 'U-A1/N-012', to: 'U-A1/N-011', title: 't' }; // 팀 지도 중심 대상: 저장 위치는 팀 지도인데 두 사람은 하위 지도에 있다
  const plan = transferPlan(app.view, draft, 'U-T1');
  assert.equal(plan.persons_ok, false);
  assert.deepEqual(plan.elsewhere, ['U-A1/N-001']);
  const r = app.confirmHandover({ draft, text: TEXT, date: DATE, transfer: true });
  assert.deepEqual(r.error, { code: 'E-CONFIRM', reason: 'transfer_scope' });
  assert.equal(JSON.stringify(app.doc), keep);
  assert.equal(localIdIn(app.view, 'U-A1/N-012', 'U-A1'), 'N-012');
});

test('CR-18-6: 팀 화면에서 하위 지도의 업무를 대상으로 확정하면 그 업무의 지도에서 담당이 넘어간다', () => {
  const storage = memoryStorage();
  const app = openApp(storage, 'U-T1');
  const r = app.confirmHandover({ draft: { target: 'U-A1/N-001', from: 'U-A1/N-012', to: 'U-A1/N-011', title: 't' }, text: TEXT, date: DATE, transfer: true });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.deepEqual(r.transfer.moved, ['U-A1/N-001']);
  const a1 = openApp(storage, 'U-A1').doc;
  assert.ok(performs(a1).includes('N-011->N-001 {"start":"2026-10-24"}'));
});

test('CR-18-6: 읽기 전용이면 확정 자체가 막히고 화면에는 담당 넘기기 칸이 없다', () => {
  const ro = createApp({ store: null, samples: SAMPLES, currentId: 'U-A1', now: () => NOW });
  assert.equal(ro.confirmHandover({ draft: draftOf(ro, ...D_NEW()), text: TEXT, date: DATE, transfer: true }).error.code, 'W-STORAGE');
});

test('CR-18-6 되감기: 확정 + 담당 넘김이 편집 시점 한 점이고, 그 점으로 되돌리면 수행 연결과 이력이 함께 돌아온다', () => {
  const app = openApp(memoryStorage());
  const k = app.editPoints().length;
  const before = app.editPoints()[k - 1];
  const beforePerforms = performs(app.doc);
  const r = app.confirmHandover({ draft: draftOf(app, ...D_NEW()), text: TEXT, date: DATE, transfer: true });
  assert.equal(r.ok, true);
  const pts = app.editPoints();
  assert.equal(pts.length, k + 1, '한 번의 기록 = 시점 하나');
  const past = app.viewAt(before.at);
  assert.ok(past.ok);
  const pastPerforms = past.view.edges.filter((e) => e.core_type === 'performs' && !e.hidden && e.target === 'U-A1/N-001' && !(e.period && e.period.end)).map((e) => e.source);
  assert.deepEqual(pastPerforms, ['U-A1/N-012']);
  const done = app.rewindTo(before.at);
  assert.ok(done.ok, JSON.stringify(done.error));
  // 되돌린 뒤: 서하늘이 계속 담당, 윤바다의 새 연결은 보이지 않고, 인수인계서와 이력도 보이지 않는다
  const live = app.doc.edges.filter((e) => e.core_type === 'performs' && !e.hidden && e.target === 'N-001' && !(e.period && e.period.end)).map((e) => e.source);
  assert.deepEqual(live, ['N-012']);
  assert.ok(!app.doc.edges.some((e) => e.core_type === 'performs' && !e.hidden && e.source === 'N-011' && e.target === 'N-001' && e.period && e.period.start === DATE));
  assert.ok(performs(app.doc).includes('N-012->N-001 {"start":"2026-10-01"}'), performs(app.doc).join('\n'));
  assert.equal(validateDocument(app.doc).ok, true);
  assert.notDeepEqual(performs(app.doc), []);
  assert.ok(beforePerforms.length > 0);
});

// ── 화면(draftPanel) 쪽: 칸의 유무·기본값 ──
test('CR-18-6 화면 문구: 넘길 업무 목록·건너뜀·범위 밖 문장', () => {
  const names = (list) => list.map((g) => `「${g}」`).join('·');
  assert.match(TRANSFER_LABEL, /담당도 넘기기/);
  assert.match(transferListText({ persons_ok: true, moves: [{ work: '대사 확인' }], already: [], elsewhere: [] }, names, '가상정산팀'), /넘길 업무.*「대사 확인」/);
  assert.match(transferListText({ persons_ok: true, moves: [], already: [], elsewhere: [] }, names, '가상정산팀'), /넘길 업무가 없습니다/);
  assert.match(transferListText({ persons_ok: true, moves: [], already: ['A'], elsewhere: ['B'] }, names, 'X'), /이미 맡고 있어 건너뜀: 「A」.*못 넘김: 「B」/);
  assert.match(transferListText({ persons_ok: false, moves: [], already: [], elsewhere: [] }, names, '가상정산팀'), /「가상정산팀」 안에 있어야/);
});

function openDraft(over = {}) {
  const body = installDom();
  const panel = draftPanel({ view: sampleView('U-A1'), provider: null, asOf: DATE, onFocus() {}, onClose() {}, ...over });
  body.append(panel);
  const q = (id) => panel.querySelector(`[data-testid=${id}]`);
  q('draft-target').value = 'U-A1/N-001';
  q('draft-from').value = 'U-A1/N-012';
  q('draft-to').value = 'U-A1/N-011';
  q('draft-form').fire('submit');
  return { q, panel };
}
const withDom = (fn) => () => {
  forgetLastPeople();
  globalThis.window = { confirm: () => true };
  try { fn(); } finally { uninstallDom(); delete globalThis.window; forgetLastPeople(); }
};

test('CR-18-6 화면: 확정 영역에 기본 꺼짐의 「담당도 넘기기」 칸과 넘길 업무 목록, 켜고 확정하면 onConfirm에 transfer: true', withDom(() => {
  const calls = [];
  const { q } = openDraft({ onConfirm: (input) => { calls.push(input); return { ok: true }; } });
  const box = q('draft-transfer');
  assert.ok(box, '칸이 있다');
  assert.equal(!!box.checked, false, '기본 꺼짐');
  assert.equal(box.disabled, false);
  assert.match(q('draft-transfer-box').textContent, /담당도 넘기기 — 보내는 사람의 수행을 오늘로 끝내고 받는 사람이 오늘부터 맡습니다/);
  assert.match(q('draft-transfer-list').textContent, /넘길 업무.*「대사 확인」/);
  // 끄고 확정
  q('draft-confirm').click();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].transfer, false);
  // 켜고 확정
  box.checked = true;
  q('draft-confirm').click();
  assert.equal(calls[1].transfer, true);
  assert.equal(calls[1].date, DATE);
}));

test('CR-18-6 화면: 넘길 업무가 없으면(보내는 사람이 수행 중이 아님) 칸이 꺼져 있고 이유를 말한다, 읽기 전용이면 칸이 없다', withDom(() => {
  const none = openDraft({ onConfirm: () => ({ ok: true }) });
  none.q('draft-from').value = 'U-A1/N-011'; // 윤바다: 담당이 끝남
  none.q('draft-to').value = 'U-A1/N-012';
  none.q('draft-form').fire('submit');
  assert.equal(none.q('draft-transfer').disabled, true);
  assert.match(none.q('draft-transfer-list').textContent, /넘길 업무가 없습니다/);
  uninstallDom();
  const ro = openDraft({ onConfirm: () => ({ ok: true }), readOnly: true });
  assert.equal(ro.q('draft-transfer'), null);
}));

test('청결: 새 순수 모듈은 브라우저 기능을 쓰지 않는다', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../app/src/view/transfer.js', import.meta.url), 'utf8');
  assert.ok(!/\b(document|window|localStorage)\b/.test(src));
  assert.ok(typeof clone === 'function' && typeof draftPanel === 'function');
});
