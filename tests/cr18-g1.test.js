// CR-18 묶음 G1(2026-10-24 승인): D-9 초안 협업 줄의 연락처·소속, D-11 해결 메모 한 줄·초안의 「최근 해결」, D-13 다시 뽑은 초안의 「새로」 표시.
// 가상 데이터만 쓴다. 화면(DOM 흉내) 점검은 브라우저 점검(tools/browser-check.mjs 「일상 사용 G1」)을 대신하지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLES } from '../app/data/index.js';
import { createApp } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import { buildView } from '../app/src/view/view.js';
import { TEXT_MAX } from '../app/src/model/schema.js';
import {
  AFFILIATION_ATTR_KEYS, CONTACT_ATTR_KEYS, RECENT_RESOLVED_DAYS, RECENT_RESOLVED_MAX, buildHandoverDraft,
} from '../app/src/rules/handover.js';
import { openMemos, resolveMemoInput } from '../app/src/rules/issues.js';
import { isNewSentence, newSentenceFlags } from '../app/src/rules/draft-new.js';
import { DRAFT_SEEN_MAX, readDraftSeen, writeDraftSeen } from '../app/src/store/draft-seen.js';
import { issuePanel } from '../app/src/ui/issues.js';
import { draftPanel, forgetLastPeople } from '../app/src/ui/draft.js';
import { installDom, uninstallDom } from './dom-stub.js';
import { clone, mkDoc, mkEdge, mkNode } from './helpers.js';

const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), raw: m };
};

// ── 작은 가상 지도: 업무 하나(N-001), 보내는 사람(V-0001)·받는 사람(V-0002), 협업자 후보(N-020)
function smallDoc({ collab = {}, collabType = 'person', events = [] } = {}) {
  return mkDoc('U-G1', [
    mkNode('N-001', 'work', '가상 정산'),
    mkNode('N-010', 'person', '가상보냄', { emp_no: 'V-0001' }),
    mkNode('N-011', 'person', '가상받음', { emp_no: 'V-0002' }),
    mkNode('N-020', collabType, '가상협업', collab),
  ], [
    mkEdge('N-000', 'N-001', 'contains'),
    mkEdge('N-010', 'N-001', 'performs', { period: { start: '2026-01-01' } }),
    mkEdge('N-001', 'N-020', 'references'),
  ], events);
}
const draftOf = (doc, asOf = '2026-10-24') => buildHandoverDraft(buildView(doc), { target: 'U-G1/N-001', from: 'U-G1/N-010', to: 'U-G1/N-011', asOf }).draft;
const item = (d, key) => d.items.find((i) => i.key === key);
const collabLines = (d) => item(d, '관계자_연락처').sentences.filter((s) => s.text.startsWith('협업:'));

// ── D-9 ──
test('D-9: 협업자 줄에 소속(속성)과 연락처가 붙고, 근거는 협업자 노드 하나다', () => {
  const [s] = collabLines(draftOf(smallDoc({ collab: { attrs: { 소속: '가상재무팀', 연락처: '내선 1234' } } })));
  assert.equal(s.text, '협업: 가상협업 — 참조 가상 정산. 소속: 가상재무팀. 연락: 내선 1234');
  assert.deepEqual(s.evidence_ids, ['U-G1/N-020']);
});

test('D-9: 연락처는 「연락」「내선」「전화」「메일」「이메일」 속성도 읽고, 여러 개면 키 목록 순서로 모아 같은 값은 한 번만', () => {
  for (const key of CONTACT_ATTR_KEYS) {
    const [s] = collabLines(draftOf(smallDoc({ collab: { attrs: { [key]: '값-1' } } })));
    assert.match(s.text, /\. 연락: 값-1$/, key);
  }
  const [many] = collabLines(draftOf(smallDoc({ collab: { attrs: { 이메일: 'a@v.example', 전화: '02-0000-0000', 메일: 'a@v.example' } } })));
  assert.match(many.text, /\. 연락: 02-0000-0000, a@v\.example$/); // 전화(순서 앞) → 메일 → 이메일(같은 값이라 생략)
});

test('D-9: 소속은 속성 「소속」「부서」「팀」(앞 이름 우선), 속성이 없으면 사람의 노드 설명', () => {
  for (const key of AFFILIATION_ATTR_KEYS) {
    const [s] = collabLines(draftOf(smallDoc({ collab: { attrs: { [key]: '가상팀A' } } })));
    assert.match(s.text, /참조 가상 정산\. 소속: 가상팀A$/, key);
  }
  assert.match(collabLines(draftOf(smallDoc({ collab: { attrs: { 팀: '뒤', 소속: '앞' } } })))[0].text, /소속: 앞/);
  assert.match(collabLines(draftOf(smallDoc({ collab: { description: '가상 감사실 파견' } })))[0].text, /소속: 가상 감사실 파견$/);
  assert.match(collabLines(draftOf(smallDoc({ collab: { description: '설명', attrs: { 소속: '속성 우선' } } })))[0].text, /소속: 속성 우선/);
});

test('D-9: 값이 없거나 공백이면 이전 문장 그대로(지어내지 않음). 조직 노드의 설명은 소속으로 쓰지 않는다', () => {
  const [none] = collabLines(draftOf(smallDoc()));
  assert.equal(none.text, '협업: 가상협업 — 참조 가상 정산');
  const [blank] = collabLines(draftOf(smallDoc({ collab: { attrs: { 소속: '  ', 연락처: '' }, description: '   ' } })));
  assert.equal(blank.text, '협업: 가상협업 — 참조 가상 정산');
  const [org] = collabLines(draftOf(smallDoc({ collabType: 'org', collab: { description: '조직 설명', attrs: { 연락처: '내선 9' } } })));
  assert.equal(org.text, '협업: 가상협업 — 참조 가상 정산. 연락: 내선 9');
});

// ── D-11 (a) 해결 메모 ──
const ORIGINAL = { occurred_at: '2026-09-01', note: '원래 메모 내용', id: 'E-050', gid: 'U/E-050', payload: { target_id: 'N-001' } };

test('D-11: resolveMemoInput - 메모를 적으면 그 글이 내용, 비우면(공백·없음·글 아님) 기본 내용 그대로, 저장 형식은 같다', () => {
  const base = resolveMemoInput(ORIGINAL, '2026-10-24');
  assert.equal(base.note, '해결: 원래 메모 내용');
  for (const empty of [undefined, '', '   ', null, 7]) assert.deepEqual(resolveMemoInput(ORIGINAL, '2026-10-24', empty), base);
  const w = resolveMemoInput(ORIGINAL, '2026-10-24', '  원천 시스템 회신으로 종결  ');
  assert.equal(w.note, '원천 시스템 회신으로 종결');
  assert.deepEqual(w.payload, base.payload); // category resolved, resolves_id, target_id 그대로
  assert.equal(w.payload.category, 'resolved');
  assert.equal(w.payload.resolves_id, 'E-050');
  assert.equal(w.occurred_at, base.occurred_at);
  assert.equal(resolveMemoInput(ORIGINAL, '2026-10-24', '가'.repeat(TEXT_MAX + 5)).note.length, TEXT_MAX);
});

const NOW = '2026-10-24T15:00:00+09:00';
const open = (id = 'U-A1') => createApp({ store: createStore(memoryStorage()), samples: SAMPLES, currentId: id, now: () => NOW });

test('D-11: app.resolveMemo - 해결 메모를 적으면 그 글이 저장되고 그 메모가 닫힌다, 안 적으면 기본 내용, 이미 닫힌 메모는 거부', () => {
  const a = open();
  const before = a.doc.events.length;
  assert.equal(a.resolveMemo('U-A1/E-014', '2026-10-24', '  재조회 회신 확인  ').ok, true);
  assert.equal(a.doc.events.length, before + 1);
  const added = a.doc.events.at(-1);
  assert.equal(added.note, '재조회 회신 확인');
  assert.equal(added.payload.category, 'resolved');
  assert.equal(added.payload.resolves_id, 'E-014');
  assert.ok(!openMemos(a.view).some((e) => e.id === 'E-014'));
  const b = open();
  assert.equal(b.resolveMemo('U-A1/E-015', '2026-10-24').ok, true);
  assert.match(b.doc.events.at(-1).note, /^해결: /);
  // 오류: 이미 닫힌 메모는 메모를 적어도 거부, 아무것도 더하지 않는다
  const n = a.doc.events.length;
  const again = a.resolveMemo('U-A1/E-014', '2026-10-24', '또');
  assert.equal(again.ok, false);
  assert.equal(again.error.already_resolved, true);
  assert.equal(a.doc.events.length, n);
});

function withDom(fn) {
  return () => {
    forgetLastPeople();
    globalThis.window = { confirm: () => true };
    try { fn(); } finally { uninstallDom(); delete globalThis.window; forgetLastPeople(); }
  };
}

test('D-11 화면: 항목마다 「해결 메모(선택)」 칸이 있고, 단추를 누르면 적은 글(앞뒤 공백 없이)이 onResolve로 간다. 읽기 전용이면 칸도 단추도 없다', withDom(() => {
  const a = open();
  const body = installDom();
  const calls = [];
  const mk = (readOnly) => issuePanel({ view: a.view, targetGid: 'U-A1/N-001', universeId: 'U-A1', readOnly, onResolve: (gid, note) => { calls.push([gid, note]); return { ok: true }; }, onFocus() {}, onClose() {} });
  const panel = mk(false);
  body.append(panel);
  const rows = panel.querySelectorAll('[data-testid=resolve-row]');
  const items = panel.querySelectorAll('[data-testid=issue-item]');
  assert.ok(items.length > 0 && rows.length === items.length);
  const inputs = panel.querySelectorAll('[data-testid=resolve-note]');
  assert.equal(inputs[0].getAttribute('aria-label'), '해결 메모(선택)');
  assert.equal(inputs[0].getAttribute('placeholder'), '해결 메모(선택)');
  assert.equal(inputs[0].getAttribute('maxlength'), String(TEXT_MAX));
  inputs[0].value = '  처리 끝  ';
  panel.querySelectorAll('[data-testid=btn-resolve]')[0].click();
  assert.equal(calls[0][1], '처리 끝');
  assert.ok(String(calls[0][0]).startsWith('U-A1/E-'));
  // 비운 채 누르면 빈 글
  inputs[1].value = '';
  panel.querySelectorAll('[data-testid=btn-resolve]')[1].click();
  assert.equal(calls[1][1], '');
  const ro = mk(true);
  assert.equal(ro.querySelectorAll('[data-testid=resolve-note]').length, 0);
  assert.equal(ro.querySelectorAll('[data-testid=btn-resolve]').length, 0);
}));

// ── D-11 (b) 최근 해결 ──
const memoEv = (id, occurred_at, payload, note, recorded_at = '2026-09-01T09:00:00+09:00') => ({ id, type: 'memo', occurred_at, recorded_at, source: 'manual', payload, ...(note ? { note } : {}) });
const recentLines = (d) => item(d, '진행_중').sentences.filter((s) => s.text.startsWith('최근 해결:'));

test('D-11: 진행 중인 일에 기준일 30일 안에 해결된 메모가 「최근 해결: …(날짜)」로 붙고 근거는 그 해결됨 메모다. 30일째는 포함, 31일째·미래는 제외', () => {
  assert.equal(RECENT_RESOLVED_DAYS, 30);
  const events = [
    memoEv('E-001', '2026-09-20', { category: 'issue', target_id: 'N-001' }, '가상 이슈 하나'),
    memoEv('E-002', '2026-10-10', { category: 'resolved', target_id: 'N-001', resolves_id: 'E-001' }, '해결: 가상 이슈 하나'),
    memoEv('E-003', '2026-09-24', { category: 'resolved', target_id: 'N-001' }, '경계 30일째 해결'), // 기준일 10-24에서 정확히 30일 전
    memoEv('E-004', '2026-09-23', { category: 'resolved', target_id: 'N-001' }, '31일째 해결'),
    memoEv('E-005', '2026-10-30', { category: 'resolved', target_id: 'N-001' }, '미래 날짜 해결'),
  ];
  const lines = recentLines(draftOf(smallDoc({ events })));
  assert.deepEqual(lines.map((s) => s.text), ['최근 해결: 가상 이슈 하나(2026-10-10)', '최근 해결: 경계 30일째 해결(2026-09-24)']); // 날짜가 가까운 것이 먼저
  assert.deepEqual(lines[0].evidence_ids, ['U-G1/E-002']);
  assert.deepEqual(lines[1].evidence_ids, ['U-G1/E-003']);
});

test('D-11: 최근 해결은 메모 글이 「해결」뿐이면 원래 메모 글을, 그것도 없으면 「해결로 표시」를 쓰고, 줄 수는 RECENT_RESOLVED_MAX까지, 기준일이 없으면 만들지 않는다', () => {
  const events = [
    memoEv('E-001', '2026-10-01', { category: 'issue', target_id: 'N-001' }, '원래 이슈 글'),
    memoEv('E-002', '2026-10-02', { category: 'resolved', target_id: 'N-001', resolves_id: 'E-001' }, '해결'),
    memoEv('E-003', '2026-10-03', { category: 'resolved', target_id: 'N-001' }),
    memoEv('E-004', '2026-10-04', { category: 'resolved', target_id: 'N-001' }, '넷째'),
    memoEv('E-005', '2026-10-05', { category: 'resolved', target_id: 'N-001' }, '다섯째'),
  ];
  const d = draftOf(smallDoc({ events }));
  assert.equal(RECENT_RESOLVED_MAX, 3);
  assert.deepEqual(recentLines(d).map((s) => s.text), ['최근 해결: 다섯째(2026-10-05)', '최근 해결: 넷째(2026-10-04)', '최근 해결: 해결로 표시(2026-10-03)']);
  const only2 = recentLines(draftOf(smallDoc({ events: events.slice(0, 3) })));
  assert.equal(only2[1].text, '최근 해결: 원래 이슈 글(2026-10-02)');
  const noDate = draftOf(smallDoc({ events }), null);
  assert.equal(recentLines(noDate).length, 0); // 기준일 없음
  assert.equal(item(noDate, '진행_중').insufficient, true);
  assert.equal(item(d, '진행_중').insufficient, false);
});

test('D-11: 해결된 메모가 없으면 진행 중 항목은 그대로(이력 부족)', () => {
  assert.equal(item(draftOf(smallDoc()), '진행_중').insufficient, true);
});

// ── D-13 순수 판정 ──
const T0 = '2026-10-24T10:00:00+09:00';
test('D-13: isNewSentence - 지난번 시각보다 뒤에 기록된 이력 근거가 있는 문장만 참, 같은 시각·이전·노드 근거·처음 만들 때(null)·읽을 수 없는 시각은 거짓', () => {
  const view = { events: [
    { gid: 'U/E-1', recorded_at: '2026-10-24T10:00:01+09:00' },
    { gid: 'U/E-2', recorded_at: T0 },
    { gid: 'U/E-3', recorded_at: '2026-10-24T09:59:59+09:00' },
    { gid: 'U/E-4', recorded_at: 'not-a-date' },
    { gid: 'U/E-5', recorded_at: '2026-10-24T01:30:00Z' }, // 10:30 +09:00 → 뒤
  ] };
  const s = (...ids) => ({ text: 't', evidence_ids: ids });
  assert.equal(isNewSentence(view, s('U/E-1'), T0), true);
  assert.equal(isNewSentence(view, s('U/E-2'), T0), false);
  assert.equal(isNewSentence(view, s('U/E-3'), T0), false);
  assert.equal(isNewSentence(view, s('U/E-4'), T0), false);
  assert.equal(isNewSentence(view, s('U/E-5'), T0), true);
  assert.equal(isNewSentence(view, s('U/N-1'), T0), false); // 노드 근거(이력 아님)
  assert.equal(isNewSentence(view, s('U/N-1', 'U/E-3', 'U/E-1'), T0), true); // 하나라도 새 이력이면 참
  for (const none of [null, undefined, '', 'garbage']) assert.equal(isNewSentence(view, s('U/E-1'), none), false);
  assert.equal(isNewSentence(view, { text: 'x' }, T0), false);
  assert.equal(isNewSentence(view, null, T0), false);
});

test('D-13: newSentenceFlags - 항목 키별 문장 순서대로의 불리언 배열', () => {
  const doc = smallDoc({ events: [memoEv('E-001', '2026-10-20', { category: 'caution', target_id: 'N-001' }, '새 주의', '2026-10-24T12:00:00+09:00')] });
  const view = buildView(doc);
  const d = draftOf(doc);
  const flags = newSentenceFlags(view, d, T0);
  assert.equal(Object.keys(flags).length, d.items.length);
  assert.deepEqual(flags.주의사항, [true]);
  assert.equal(Object.values(flags).flat().filter(Boolean).length, 1);
  assert.deepEqual(newSentenceFlags(view, d, null).주의사항, [false]);
  for (const i of d.items) assert.equal(flags[i.key].length, i.sentences.length);
});

// ── D-13 저장 ──
test('D-13 저장: 대상별로 읽고 쓰며 이 브라우저 설정 키 하나에만 남는다(문서와 무관)', () => {
  const st = memoryStorage();
  assert.equal(readDraftSeen(st, 'U/N-1'), null);
  assert.equal(writeDraftSeen(st, 'U/N-1', T0), true);
  assert.equal(writeDraftSeen(st, 'U/N-2', '2026-10-25T00:00:00+09:00'), true);
  assert.equal(readDraftSeen(st, 'U/N-1'), T0);
  assert.equal(readDraftSeen(st, 'U/N-2'), '2026-10-25T00:00:00+09:00');
  assert.deepEqual([...st.raw.keys()], ['wu:v1:draft-seen']);
});

test('D-13 저장 오류: 저장소 없음·깨진 값·잘못된 입력·쓰기 실패는 조용히 「없음」이고 던지지 않는다', () => {
  assert.equal(readDraftSeen(null, 'U/N-1'), null);
  assert.equal(writeDraftSeen(null, 'U/N-1', T0), false);
  const bad = memoryStorage();
  bad.setItem('wu:v1:draft-seen', '{깨짐');
  assert.equal(readDraftSeen(bad, 'U/N-1'), null);
  assert.equal(writeDraftSeen(bad, 'U/N-1', T0), true); // 깨진 값은 덮어쓴다
  bad.setItem('wu:v1:draft-seen', JSON.stringify({ v: 1, at: { 'U/N-1': 'x', 'U/N-2': T0, 'U/N-3': 5 } }));
  assert.equal(readDraftSeen(bad, 'U/N-1'), null);
  assert.equal(readDraftSeen(bad, 'U/N-3'), null);
  assert.equal(readDraftSeen(bad, 'U/N-2'), T0);
  assert.equal(writeDraftSeen(bad, '', T0), false);
  assert.equal(writeDraftSeen(bad, 'U/N-1', 'garbage'), false);
  const full = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  assert.equal(writeDraftSeen(full, 'U/N-1', T0), false);
});

test('D-13 저장: 대상이 DRAFT_SEEN_MAX를 넘으면 시각이 오래된 것부터 버린다', () => {
  const st = memoryStorage();
  for (let i = 0; i < DRAFT_SEEN_MAX + 3; i += 1) writeDraftSeen(st, `U/N-${i}`, new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString());
  assert.equal(Object.keys(JSON.parse(st.getItem('wu:v1:draft-seen')).at).length, DRAFT_SEEN_MAX);
  assert.equal(readDraftSeen(st, 'U/N-0'), null);
  assert.ok(readDraftSeen(st, `U/N-${DRAFT_SEEN_MAX + 2}`));
});

// ── D-13 화면 ──
function openDraft(view, seenStorage) {
  const body = installDom();
  const panel = draftPanel({ view, provider: null, asOf: '2026-10-24', seenStorage, onFocus() {}, onClose() {} });
  body.append(panel);
  const q = (id) => panel.querySelector(`[data-testid=${id}]`);
  q('draft-target').value = 'U-A1/N-001';
  q('draft-from').value = 'U-A1/N-012';
  q('draft-to').value = 'U-A1/N-011';
  q('draft-form').fire('submit');
  return { q, panel, marks: () => panel.querySelectorAll('[data-testid=draft-new-mark]') };
}

test('D-13 화면: 처음 만들 때는 표시 없음, 그 뒤 새로 기록된 근거가 붙은 문장에만 「새로」, 시각은 이 브라우저 설정에만 남는다', withDom(() => {
  const st = memoryStorage();
  const doc = clone(SAMPLES.find((d) => d.universe.id === 'U-A1'));
  // 1) 처음: 표시 없음, 시각이 남음
  const first = openDraft(buildView(doc), st);
  assert.equal(first.marks().length, 0);
  assert.ok(readDraftSeen(st, 'U-A1/N-001'), '이번 시각을 남김');
  uninstallDom();
  // 2) 그 뒤에 기록된 주의사항 메모 하나 -> 그 문장만 표시
  const seed = '2026-10-24T10:00:00+09:00';
  st.setItem('wu:v1:draft-seen', JSON.stringify({ v: 1, at: { 'U-A1/N-001': seed } }));
  doc.events.push(memoEv('E-900', '2026-10-24', { category: 'caution', target_id: 'N-001' }, '가상 새 주의사항', '2026-10-24T12:00:00+09:00'));
  const again = openDraft(buildView(doc), st);
  const marks = again.marks();
  assert.equal(marks.length, 1);
  assert.equal(marks[0].textContent, '새로');
  assert.match(marks[0].parentNode.textContent, /가상 새 주의사항/);
  assert.notEqual(readDraftSeen(st, 'U-A1/N-001'), seed, '시각이 이번 것으로 바뀜');
  // 3) 문서에는 아무 것도 더해지지 않음
  assert.ok(!JSON.stringify(doc).includes('draft-seen'));
  uninstallDom();
  // 오류: 저장소가 없으면 표시만 없고 초안은 그대로 만들어진다
  const none = openDraft(buildView(doc), null);
  assert.equal(none.marks().length, 0);
  assert.ok(none.q('draft-result').querySelectorAll('[data-testid^=draft-item-]').length > 0);
}));
