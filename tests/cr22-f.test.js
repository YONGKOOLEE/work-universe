// CR-22 F(알림·동작) 단위 검증: 메모 분류 필수·「해결됨」 미리 알림 건수, 담당 넘기기 갈래별 결과, 성공 알림 대상,
// 하나씩 추가 이름 칸 → 표로 추가의 한 행 처리 결과, 묶은 직후 띠 건수, 메모 양식 부품(DOM 흉내).
// 실제 브라우저 점검(tools/browser-check.mjs 「CR-22 F」)을 대신하지 않는다. 가상 데이터만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, uninstallDom } from './dom-stub.js';
import { mkDoc, mkEdge, mkNode, viewOf } from './helpers.js';
import { buildView } from '../app/src/view/view.js';
import { createApp } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import { SAMPLES } from '../app/data/index.js';
import {
  BRANCH_DOC, BRANCH_ONLY, CATEGORY_REQUIRED_TEXT, MEMO_CHIP_ORDER, addNodeOps, canInlineEmpNo, categoryGate, extraNames, extraSummary, groupedStrip,
  memoRecordInput, resolveCloseCount, resolveWarningText, successNotice, transferBranchPlan,
} from '../app/src/view/record-form.js';
import { memoParts } from '../app/src/ui/memo-form.js';
import { createNotices } from '../app/src/ui/notice.js';
import { eventForm } from '../app/src/ui/editor.js';

const withDom = (fn) => () => {
  const body = installDom();
  try { fn(body); } finally { uninstallDom(); }
};
const NOW = '2026-10-26T10:00:00+09:00';
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const openApp = (id = 'U-A1') => createApp({ store: createStore(memoryStorage()), samples: SAMPLES, currentId: id, now: () => NOW });

// ── 메모 분류 필수 ──
test('CR-22 F 분류 칩 4개의 순서, 처음엔 고르지 않아 막힘, 모르는 값도 막힘', () => {
  assert.deepEqual(MEMO_CHIP_ORDER, ['in_progress', 'issue', 'caution', 'resolved']);
  assert.deepEqual(categoryGate(''), { ok: false, text: CATEGORY_REQUIRED_TEXT });
  assert.equal(categoryGate(undefined).ok, false);
  assert.equal(categoryGate('toString').ok, false);
  for (const k of MEMO_CHIP_ORDER) assert.deepEqual(categoryGate(k), { ok: true, text: '' });
});

test('CR-22 F 메모 입력: 업무·분류·내용이 모두 있어야 하고, 저장 형식은 지금 이력 추가의 메모 그대로', () => {
  const ok = memoRecordInput({ workId: 'N-001', category: 'in_progress', note: '  대사 정리  ', date: '2026-10-26' });
  assert.deepEqual(ok, { ok: true, alsoResolved: false, input: { type: 'memo', occurred_at: '2026-10-26', payload: { target_id: 'N-001', category: 'in_progress', topic_ids: [] }, note: '대사 정리' } });
  assert.deepEqual(memoRecordInput({ workId: '', category: 'issue', note: 'x', date: 'd' }), { ok: false, field: 'work_id' });
  assert.deepEqual(memoRecordInput({ workId: 'N-001', category: '', note: 'x', date: 'd' }), { ok: false, field: 'category' });
  assert.deepEqual(memoRecordInput({ workId: 'N-001', category: 'issue', note: '   ', date: 'd' }), { ok: false, field: 'note' });
  // 이미 끝난 일은 이슈일 때만 뜻이 있다
  assert.equal(memoRecordInput({ workId: 'N-001', category: 'issue', note: 'x', date: 'd', pastDone: true }).alsoResolved, true);
  assert.equal(memoRecordInput({ workId: 'N-001', category: 'caution', note: 'x', date: 'd', pastDone: true }).alsoResolved, false);
  assert.deepEqual(memoRecordInput({ workId: 'N-001', category: 'issue', note: 'x', date: 'd', topicIds: ['N-009'] }).input.payload.topic_ids, ['N-009']);
});

// ── 「해결됨」 미리 알림 ──
test('CR-22 F 해결됨 미리 알림: 그 업무의 닫히지 않은 이슈·진행 중 건수(해결로 표시로 닫힌 것·주의사항·다른 업무는 세지 않음), 기록하면 정말 그만큼 닫힌다', () => {
  const doc = mkDoc('U-F', [mkNode('N-001', 'work', '업무 하나'), mkNode('N-002', 'work', '업무 둘')], []);
  const app = createApp({ store: createStore(memoryStorage()), samples: [doc], currentId: 'U-F', now: () => NOW });
  const add = (workId, category, note) => app.addEvent({ type: 'memo', occurred_at: '2026-10-20', payload: { target_id: workId, category }, note });
  assert.equal(add('N-001', 'issue', '이슈 하나').ok, true);
  assert.equal(add('N-001', 'in_progress', '진행 중').ok, true);
  assert.equal(add('N-001', 'caution', '주의사항은 미해결이 아님').ok, true);
  assert.equal(add('N-002', 'issue', '다른 업무').ok, true);
  const gid = 'U-F/N-001';
  assert.equal(resolveCloseCount(app.view, gid), 2);
  assert.equal(resolveCloseCount(app.view, 'U-F/N-002'), 1);
  assert.equal(resolveCloseCount(app.view, ''), 0);
  assert.equal(resolveWarningText(2), '이 업무 미해결 2건이 모두 닫힙니다');
  assert.equal(resolveWarningText(0), '이 업무에 닫을 미해결은 없습니다');
  // 「해결로 표시」는 한 건만 닫는다
  const first = app.view.events.find((e) => e.note === '이슈 하나');
  assert.equal(app.resolveMemo(first.gid, '2026-10-26').ok, true);
  assert.equal(resolveCloseCount(app.view, gid), 1);
  // 분류 「해결됨」으로 기록하면 남은 것이 모두 닫혀, 미리 알린 건수와 같다
  const before = resolveCloseCount(app.view, gid);
  assert.equal(add('N-001', 'resolved', '모두 해결').ok, true);
  assert.equal(resolveCloseCount(app.view, gid), 0);
  assert.equal(before, 1);
});

// ── 담당 넘기기 갈래 ──
const persons = [
  { id: 'N-011', gid: 'U-A1/N-011', label: '윤바다' },
  { id: 'N-012', gid: 'U-A1/N-012', label: '서하늘' },
];
const from = { gid: 'U-A1/N-012', label: '서하늘' };
test('CR-22 F 담당 넘기기 — 담당만: 지금 담당 바꾸기 그대로(초안에 채울 값 없음, 인수인계 기록 선택은 유지)', () => {
  assert.deepEqual(transferBranchPlan({ branch: BRANCH_ONLY, workGid: 'U-A1/N-001', from, toId: 'N-011', persons }), { ok: true, kind: 'only', handoverOption: true });
});
test('CR-22 F 담당 넘기기 — 인수인계서까지: 보내는 사람=지금 담당, 받는 사람=새 담당, 대상=이 업무, 「담당도 넘기기」 켬·자동 만들기', () => {
  const p = transferBranchPlan({ branch: BRANCH_DOC, workGid: 'U-A1/N-001', from, toId: 'N-011', persons });
  assert.deepEqual(p, { ok: true, kind: 'doc', createPerson: null, preset: { target: 'U-A1/N-001', from: '서하늘', from_gid: 'U-A1/N-012', to: '윤바다', to_gid: 'U-A1/N-011' }, transfer: true, autoMake: true });
  // 이름으로 넣었는데 같은 이름의 사람이 있으면 그 사람, 없으면 사람을 먼저 만든다
  assert.equal(transferBranchPlan({ branch: BRANCH_DOC, workGid: 'w', from, toName: ' 윤바다 ', persons }).preset.to_gid, 'U-A1/N-011');
  const fresh = transferBranchPlan({ branch: BRANCH_DOC, workGid: 'w', from, toName: '새사람', persons });
  assert.equal(fresh.createPerson, '새사람');
  assert.equal(fresh.preset.to, '새사람');
  assert.equal(fresh.preset.to_gid, '');
});
test('CR-22 F 담당 넘기기 — 오류: 둘 다 고름·둘 다 비움·같은 사람·이름이 여럿', () => {
  assert.equal(transferBranchPlan({ branch: BRANCH_DOC, workGid: 'w', from, toId: 'N-011', toName: '또', persons }).reason, 'both');
  assert.equal(transferBranchPlan({ branch: BRANCH_ONLY, workGid: 'w', from, persons }).reason, 'to-empty');
  assert.equal(transferBranchPlan({ branch: BRANCH_DOC, workGid: 'w', from, toId: 'N-012', persons }).reason, 'same');
  const dup = [...persons, { id: 'N-013', gid: 'U-A1/N-013', label: '윤바다' }];
  assert.equal(transferBranchPlan({ branch: BRANCH_DOC, workGid: 'w', from, toName: '윤바다', persons: dup }).reason, 'ambiguous');
});

// ── 성공 알림 대상 ──
test('CR-22 F 성공 알림: 문구와 「거기로 가기」 대상(이력 줄 / 항목 / 공간), 기존 testid 유지', () => {
  const rec = successNotice('record', { label: '대사 확인', date: '2026-10-20', today: '2026-10-26', category: 'issue', note: '불일치', workGid: 'U/N-001', evGids: ['U/E-9'] });
  assert.equal(rec.testid, 'weekly-done');
  assert.equal(rec.text, '「대사 확인」에 (2026-10-20) 기록했습니다 — [이슈] 불일치');
  assert.deepEqual(rec.goto, { type: 'history', nodeGid: 'U/N-001', gids: ['U/E-9'] });
  assert.equal(successNotice('record', { label: 'a', date: '2026-10-26', today: '2026-10-26', category: 'caution', note: 'n', workGid: 'U/N-001', evGids: [] }).goto, null, '이력 줄을 모르면 가기 단추 없음');
  assert.equal(successNotice('resolve', { label: '대사 확인', nodeGid: 'U/N-001', evGids: ['U/E-1'] }).testid, 'resolve-done');
  const as = successNotice('assignee', { work: '대사 확인', from: '서하늘', to: '윤바다', when: '2026-10-26', created: false, handover: true, workGid: 'U/N-001' });
  assert.equal(as.testid, 'assignee-done');
  assert.ok(as.text.includes('서하늘 → 윤바다로 바꿨습니다') && as.text.includes('인수인계 기록도 남겼습니다'));
  assert.deepEqual(as.goto, { type: 'node', nodeGid: 'U/N-001' });
  assert.equal(successNotice('confirm', { text: 't', nodeGid: 'U/A-1' }).testid, 'confirm-done');
  assert.equal(successNotice('record-past', { workGid: 'U/N-1', evGids: ['U/E-1', 'U/E-2'] }).testid, 'past-resolved-done');
  const add = successNotice('add-one', { count: 3, label: '월말', extra: '(담당자 김가상)', nodeGid: 'U/N-9', core: 'work' });
  assert.equal(add.text, '3개 추가 · 「월말」 (담당자 김가상)');
  assert.equal(add.goLabel, '업무 보기');
  assert.equal(successNotice('table-add', { count: 2, summary: '', nodeGid: 'U/N-9', core: 'person' }).goLabel, '');
  const g = successNotice('group', { text: '묶었습니다 — 확인 2건', pending: 2 });
  assert.deepEqual(g.goto, { type: 'space', space: 'edit', merge: true });
  assert.equal(g.goLabel, '통합 확인');
  assert.equal(successNotice('group', { text: 'x', pending: 0 }).goto, null);
  assert.equal(successNotice('import', { name: '지도', nodes: 4 }).text, '가져왔습니다 — 「지도」(항목 4개)');
  assert.equal(successNotice('plain', { testid: 'rewind-done', text: 'r' }).testid, 'rewind-done');
});

// ── 하나씩 추가 양식의 이름 칸 ──
test('CR-22 F 이름 칸: 업무일 때만, 모두 비면 없음, 앞뒤 공백 정리', () => {
  assert.equal(extraNames('person', { assignee: 'a' }), null);
  assert.equal(extraNames('work', { assignee: ' ', outputs: '', next: '' }), null);
  assert.deepEqual(extraNames('work', { assignee: ' 김가상 ', outputs: '점검표' }), { assignee: '김가상', outputs: '점검표', next: '' });
  assert.equal(extraSummary({ assignee: '김가상', outputs: '점검표', next: '' }), '(담당자 김가상 · 산출물 점검표)');
  assert.equal(extraSummary(null), '');
});

test('CR-22 F 이름 칸 → 표로 추가의 한 행 처리: 업무+담당자+산출물+다음 업무가 한 묶음, 연결 칸의 연결은 그 뒤에', () => {
  const doc = mkDoc('U-F', [mkNode('N-002', 'person', '이미 있는 사람')], []);
  const app = createApp({ store: createStore(memoryStorage()), samples: [doc], currentId: 'U-F', now: () => NOW });
  const input = { core_type: 'work', label: '월말 정산', description: '설명 유지' };
  const ops = addNodeOps({ input, attachRoot: true, names: extraNames('work', { assignee: '이미 있는 사람', outputs: '정산표', next: '보고' }), doc: app.doc });
  assert.equal(ops[0].op, 'addNode');
  assert.equal(ops[0].input.description, '설명 유지', '양식이 모은 값은 그대로');
  assert.equal(ops[0].attachRoot, true);
  assert.ok(ops.some((o) => o.op === 'assign') && ops.filter((o) => o.op === 'addNode').length === 3);
  const b = app.applyBatch(ops);
  assert.equal(b.ok, true, JSON.stringify(b.errors || b.error));
  const v = app.view;
  const work = v.nodes.find((n) => n.label === '월말 정산');
  assert.ok(work);
  assert.ok(v.edges.some((e) => e.core_type === 'performs' && e.target === work.gid && e.source === 'U-F/N-002'), '이미 있는 사람에게 담당이 이어졌다(새 사람 아님)');
  assert.equal(v.nodes.filter((n) => n.label === '이미 있는 사람').length, 1);
  assert.ok(v.edges.some((e) => e.core_type === 'produces' && e.source === work.gid), '산출물 연결');
  assert.ok(v.edges.some((e) => e.core_type === 'precedes' && e.source === work.gid), '다음 업무 연결');
});

test('CR-22 F 이름 칸이 없으면 지금과 같은 명령(노드 1행 + 함께 이을 연결 2행)', () => {
  const ops = addNodeOps({ input: { core_type: 'work', label: 'x' }, attachRoot: false, link: { core_type: 'precedes', other_id: 'N-5', out: true }, doc: { nodes: [] } });
  assert.deepEqual(ops, [
    { op: 'addNode', row: 1, input: { core_type: 'work', label: 'x' }, attachRoot: false },
    { op: 'addEdge', row: 2, input: { core_type: 'precedes', source: '@1', target: 'N-5' } },
  ]);
  const inn = addNodeOps({ input: { core_type: 'work', label: 'x' }, attachRoot: false, link: { core_type: 'precedes', other_id: 'N-5', out: false }, doc: { nodes: [] } });
  assert.deepEqual(inn[1].input, { core_type: 'precedes', source: 'N-5', target: '@1' });
});

test('CR-22 F 이름 칸의 이름이 여러 개와 겹치면 그 행 오류로 아무것도 저장하지 않는다', () => {
  const doc = mkDoc('U-F', [mkNode('N-002', 'person', '동명'), mkNode('N-003', 'person', '동명')], []);
  const app = createApp({ store: createStore(memoryStorage()), samples: [doc], currentId: 'U-F', now: () => NOW });
  const before = JSON.stringify(app.doc);
  const ops = addNodeOps({ input: { core_type: 'work', label: '업무' }, attachRoot: false, names: extraNames('work', { assignee: '동명' }), doc: app.doc });
  const b = app.applyBatch(ops);
  assert.equal(b.ok, false);
  assert.equal(JSON.stringify(app.doc), before);
});

// ── 묶은 직후 띠 ──
test('CR-22 F 묶은 직후 띠: 확인 건수와 통합 확인으로 가는 단추 여부', () => {
  const s = groupedStrip({ counts: { pending: 3, persons: 1, works: 2 } }, { name: '가상 팀' });
  assert.equal(s.pending, 3);
  assert.equal(s.text, '「가상 팀」으로 묶었습니다 — 같은 사람·업무 확인 3건 → 통합 확인');
  assert.equal(groupedStrip({ counts: { pending: 0 } }).text, '묶었습니다 — 확인할 같은 사람·업무는 없습니다');
  assert.equal(groupedStrip(null).pending, 0);
  assert.ok(groupedStrip({ counts: { pending: 1 } }, { auto: 2 }).text.includes('사번이 같은 사람 2명은 자동으로 이었습니다'));
});

test('CR-22 F 사번 바로 넣기: 사번 없음 줄이고 그 지도 문서가 있고 쓸 수 있을 때만', () => {
  const item = { type: 'no_empno', a: 'U-X/N-001', b: null };
  assert.equal(canInlineEmpNo(item, { readOnly: false, ownerDoc: { readOnly: false } }), true);
  assert.equal(canInlineEmpNo({ ...item, b: 'U-Y/N-001' }, { readOnly: false, ownerDoc: {} }), true, '비교 상대가 있어도 사번을 넣을 수 있다');
  assert.equal(canInlineEmpNo(item, { readOnly: true, ownerDoc: {} }), false);
  assert.equal(canInlineEmpNo(item, { readOnly: false, ownerDoc: null }), false, '이 브라우저 저장소에 없음');
  assert.equal(canInlineEmpNo(item, { readOnly: false, ownerDoc: {}, ownerReadOnly: true }), false /* R11 RV11C-11: 문서에는 readOnly 필드가 없어 validateDocument 결과를 넘긴다 */);
  assert.equal(canInlineEmpNo({ type: 'conflict' }, { readOnly: false, ownerDoc: {} }), false);
});

test('CR-22 F 사번 넣기는 하위 지도 문서의 updateNode(emp_no)로 저장되고 통합 확인이 달라진다', () => {
  const X = mkDoc('U-X', [mkNode('N-001', 'person', '가상인물')], []);
  const Y = mkDoc('U-Y', [mkNode('N-001', 'person', '가상인물', { emp_no: 'V-1001' })], []);
  const Z = mkDoc('U-Z', [], [], [], { refs: [{ child_universe_id: 'U-X', added_at: '2026-10-01T09:00:00+09:00' }, { child_universe_id: 'U-Y', added_at: '2026-10-01T09:00:00+09:00' }] });
  const app = createApp({ store: createStore(memoryStorage()), samples: [X, Y, Z], currentId: 'U-Z', now: () => NOW });
  const plan = app.mergePlan();
  const item = plan.persons.find((p) => p.type === 'no_empno');
  assert.ok(item, '사번 없음 줄이 있다');
  const node = app.view.rawNode(item.a);
  const r = app.updateNode(node.universe_id, node.id, { emp_no: 'V-1001' });
  assert.equal(r.ok, true);
  assert.equal(app.docOf('U-X').nodes.find((n) => n.id === 'N-001').emp_no, 'V-1001');
});

// ── DOM 흉내: 메모 양식 부품·알림 자리 ──
test('CR-22 F 메모 양식 부품: 처음엔 분류 없음(막힘 한 줄), 칩을 누르면 select 값·누름 표시, 해결됨은 미리 알림, 이슈는 이미 끝난 일 칸', withDom((body) => {
  let ok = null;
  const parts = memoParts({ prefix: 'weekly', closeCount: () => 3, onChange: (v) => { ok = v; } });
  body.append(parts.chipRow, parts.gate, parts.select, parts.warn, parts.pastBox);
  assert.equal(parts.category(), '');
  assert.equal(ok, false);
  assert.equal(parts.gate.hidden, false);
  assert.equal(parts.gate.textContent, '분류를 고르세요');
  const chip = (k) => parts.chipRow.querySelector(`[data-testid=memo-chip-${k}]`);
  assert.equal(parts.chipRow.children.length, 4);
  assert.deepEqual(parts.chipRow.children.map((c) => c.textContent), ['진행 중', '이슈', '주의사항', '해결됨']);
  chip('issue').fire('click');
  assert.equal(parts.category(), 'issue');
  assert.equal(ok, true);
  assert.equal(parts.gate.hidden, true);
  assert.equal(chip('issue').getAttribute('aria-checked'), 'true');
  assert.equal(parts.pastBox.hidden, false);
  assert.equal(parts.warn.hidden, true);
  chip('resolved').fire('click');
  assert.equal(parts.warn.hidden, false);
  assert.equal(parts.warn.textContent, '이 업무 미해결 3건이 모두 닫힙니다');
  assert.equal(parts.pastBox.hidden, true);
  chip('resolved').fire('click'); // 같은 칩을 다시 누르면 고르지 않은 상태로
  assert.equal(parts.category(), '');
  assert.equal(ok, false);
  // select 값을 코드로 바꿔도 칩이 따라온다
  parts.select.value = 'caution';
  parts.select.fire('change');
  assert.equal(chip('caution').getAttribute('aria-checked'), 'true');
}));

test('CR-22 F 카드의 「기록 남기기」(memoChips): 분류를 안 고르면 「기록」 단추가 막히고, 고르면 풀리며, 내보내는 값은 고른 분류', withDom(() => {
  let sent = null;
  const form = eventForm({ node: { id: 'N-001', core_type: 'work', label: '가상 업무' }, nodes: [], handovers: [], memoChips: true, closeCount: () => 2, onSubmit: (v) => { sent = v; return { ok: true }; }, onCancel() {} });
  const btn = form.querySelectorAll('button').find((b) => b.getAttribute('type') === 'submit');
  const note = form.querySelector('[data-testid=event-note]');
  const cat = form.querySelector('[data-testid=event-category]');
  assert.equal(cat.value, '');
  assert.equal(btn.disabled, true);
  note.value = '내용';
  form.fire('submit');
  assert.equal(sent, null, '막힌 채 보내도 저장되지 않는다');
  form.querySelector('[data-testid=memo-chip-caution]').fire('click');
  assert.equal(btn.disabled, false);
  form.fire('submit');
  assert.equal(sent.payload.category, 'caution');
  assert.equal(form.querySelector('[data-testid=memo-gate]').hidden, true);
}));

test('CR-22 F 알림 자리: 하나만 보이고(새 알림이 앞 것을 바꿈), 가기·닫기 단추 testid, 가기를 누르면 알림이 닫히고 대상이 전달된다', withDom((body) => {
  const slot = document.createElement('div');
  body.append(slot);
  const went = [];
  const n = createNotices(slot, { onGo: (g) => went.push(g) });
  n.show({ testid: 'weekly-done', text: '기록했습니다', goto: { type: 'history', nodeGid: 'U/N-1', gids: ['U/E-1'] } });
  assert.equal(slot.children.length, 1);
  assert.equal(slot.querySelector('[data-testid=weekly-done]').textContent.includes('기록했습니다'), true);
  n.show({ testid: 'assignee-done', text: '바꿨습니다', goto: { type: 'node', nodeGid: 'U/N-1' } });
  assert.equal(slot.children.length, 1);
  assert.equal(slot.querySelector('[data-testid=weekly-done]'), null);
  slot.querySelector('[data-testid=goto-notice]').fire('click');
  assert.deepEqual(went, [{ type: 'node', nodeGid: 'U/N-1' }]);
  assert.equal(slot.children.length, 0);
  n.show({ testid: 'x', text: '대상 없음', goto: null });
  assert.equal(slot.querySelector('[data-testid=goto-notice]'), null);
  slot.querySelector('[data-testid=notice-close]').fire('click');
  assert.equal(slot.children.length, 0);
  n.show({ testid: 'resolve-done', text: 'r', goto: { type: 'history', nodeGid: 'U/N-1', gids: ['U/E-1'] } });
  assert.ok(slot.querySelector('[data-testid=goto-history]'));
  n.clear();
}));
