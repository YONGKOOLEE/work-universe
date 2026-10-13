// 일곱 번째 검토(T-28) 가-코드 묶음: K-1 숨긴 대상의 해결 표시, K-2 확정본 본문 경계, K-3 담당 겹침 문구,
// K-4 닫히지 않는 해결 거부, K-5 위험한 속성 키, D-10 시험 2개(읽기 전용 해결 거부, 넓힌 찾기 뒤 이력 불변)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import { SAMPLES } from '../app/data/index.js';
import { ANSWERS_V1 } from '../app/data/answers-v1.js';
import { addAssignment, addEvent, addNode, createUniverse } from '../app/src/model/commands.js';
import { parseAttrsCell, newRowsToOps } from '../app/src/model/table.js';
import { TEXT_MAX } from '../app/src/model/schema.js';
import { validateDocument } from '../app/src/model/validate.js';
import { openMemos } from '../app/src/rules/issues.js';
import { confirmedBody } from '../app/src/view/handover-doc.js';
import { searchNodes } from '../app/src/view/explore.js';
import { messageFor } from '../app/src/ui/messages.js';

function memoryStorage(failing = () => false) {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (failing()) throw new Error('quota'); m.set(k, String(v)); },
    removeItem: (k) => m.delete(k),
  };
}
const NOW = '2026-10-13T09:00:00+09:00';
const open = (currentId, storage = memoryStorage()) => createApp({ store: createStore(storage), samples: SAMPLES, currentId, now: () => NOW });
const ctx = { now: NOW };

// ── K-1 ──
test('K-1 대상 업무를 숨긴 뒤에도 그 업무의 미해결 메모를 「해결로 표시」로 닫을 수 있다', () => {
  const app = open('U-A1');
  const ev = openMemos(app.view).find((e) => e.universe_id === 'U-A1' && e.payload.target_id && !e.payload.target_id.includes('/'));
  assert.ok(ev);
  assert.equal(app.hideNode(ev.payload.target_id).ok, true);
  assert.ok(openMemos(app.view).some((x) => x.gid === ev.gid), '숨겨도 목록에는 남는다');
  const r = app.resolveMemo(ev.gid, '2026-10-13');
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.ok(!openMemos(app.view).some((x) => x.gid === ev.gid));
  assert.equal(validateDocument(app.doc).ok, true);
});

test('K-1 일반 메모는 여전히 숨긴 노드를 대상으로 할 수 없다(resolves_id가 있는 해결 메모만 예외)', () => {
  let d = createUniverse({ name: 'K1', level: '팀', owner: '가상팀' }, ctx).doc;
  const w = addNode(d, { core_type: 'work', label: '가상 업무' }, ctx);
  d = w.doc;
  const first = addEvent(d, { type: 'memo', occurred_at: '2026-10-12', payload: { category: 'issue', target_id: w.node.id }, note: '문제' }, ctx);
  const hidden = { ...first.doc, nodes: first.doc.nodes.map((n) => (n.id === w.node.id ? { ...n, hidden: true } : n)) };
  const memo = (payload) => addEvent(hidden, { type: 'memo', occurred_at: '2026-10-13', payload, note: 'x' }, ctx);
  assert.equal(memo({ category: 'issue', target_id: w.node.id }).ok, false);
  assert.equal(memo({ category: 'resolved', target_id: w.node.id }).ok, false, 'resolves_id 없는 해결 메모는 막힌다');
  assert.equal(memo({ category: 'issue', target_id: w.node.id, resolves_id: first.event.id }).ok, false, '범주가 resolved가 아니면 막힌다');
  assert.equal(memo({ category: 'resolved', target_id: w.node.id, resolves_id: first.event.id }).ok, true);
});

// ── K-2 ──
const confirmText = (text, date) => {
  const app = open('U-A1');
  const a = ANSWERS_V1.handover_drafts[0];
  const r = app.confirmHandover({ draft: { target: a.target, from: a.from, to: a.to, title: 't', method: 'rule' }, text, date });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  const node = app.view.getNode(r.artifact);
  return { app, body: confirmedBody(node), node };
};

test('K-2 확정본 본문: 2000자 경계가 줄바꿈이어도 이어 붙이면 원문과 같다', () => {
  const text = `${'가'.repeat(TEXT_MAX - 1)}\n둘째 줄 내용`;
  const { body, node } = confirmText(text, '2026-10-13');
  assert.equal(body, text);
  assert.ok(node.description.length <= TEXT_MAX);
});

test('K-2 확정본 본문 2007자: 경계가 공백 여러 개 한가운데여도 원문과 같다', () => {
  const text = `${'가'.repeat(1990)}${' '.repeat(10)}${'나'.repeat(7)}`;
  assert.equal(text.length, 2007);
  const { body, app } = confirmText(text, '2026-10-14');
  assert.equal(body, text);
  assert.equal(validateDocument(app.doc).ok, true);
});

test('K-2 긴 본문(5000자, 곳곳에 줄바꿈·공백): 원문과 같고 설명은 공백으로 끝나지 않는다', () => {
  let text = '';
  for (let i = 0; text.length < 5000; i += 1) text += `${i}번 줄 내용입니다 \n`;
  text = text.slice(0, 5000);
  const { body, node } = confirmText(text, '2026-10-15');
  assert.equal(body, text);
  assert.ok(node.description.length <= TEXT_MAX && node.description === node.description.trim());
});

// ── K-3 ──
test('K-3 담당 시작이 이미 있는 기간과 겹쳐 거부되면 period_overlap이 붙고, 담당 기간 문구로 보인다', () => {
  let d = createUniverse({ name: 'K3', level: '팀', owner: '가상팀' }, ctx).doc;
  const p = addNode(d, { core_type: 'person', label: '가상 갑', emp_no: 'V-0001' }, ctx);
  const w = addNode(p.doc, { core_type: 'work', label: '가상 업무' }, ctx);
  d = w.doc;
  const asg = (type, date) => addAssignment(d, { type, occurred_at: date, payload: { person_id: p.node.id, work_id: w.node.id } }, ctx);
  d = asg('assign_start', '2026-03-01').doc;
  d = asg('assign_end', '2026-06-30').doc;
  const back = asg('assign_start', '2025-01-01');
  assert.equal(back.ok, false);
  assert.equal(back.error.code, 'E-DUP');
  assert.equal(back.error.period_overlap, true);
  const msg = messageFor(back.error, { kind: 'event' });
  assert.ok(msg.includes('담당 기간') && msg.includes('겹칩니다') && !msg.includes('같은 노드'), msg);
  // 계속 담당 중인 경우의 기존 문구는 그대로
  d = asg('assign_start', '2026-07-01').doc;
  const again = asg('assign_start', '2026-08-01');
  assert.equal(again.error.already_active, true);
  assert.ok(!again.error.period_overlap);
});

// ── K-4 ──
// V-1(일곱 번째 검토 뒤 결정)로 바뀜: 해결 메모의 기록 시각을 원래 메모보다 뒤로 맞추므로, 원래 메모가 미래 시각(다른 PC 시계)이어도 닫힌다.
// (이전 판의 기대 "not_closed로 거부"는 이 요구사항 변경으로 뒤집었다)
test('K-4 → V-1: 원래 메모의 기록 시각이 지금보다 뒤여도 해결 표시가 닫히고, 두 번 눌러도 해결 메모는 하나', () => {
  let d = createUniverse({ name: 'K4', level: '팀', owner: '가상팀' }, ctx).doc;
  const w = addNode(d, { core_type: 'work', label: '가상 대사' }, ctx);
  d = w.doc;
  d = addEvent(d, { type: 'memo', occurred_at: '2026-10-13', payload: { category: 'issue', target_id: w.node.id }, note: '문제' }, { now: '2026-10-13T18:00:00+09:00' }).doc;
  const storage = memoryStorage();
  open(undefined, storage).importUniverse(d);
  const app = open(d.universe.id, storage);
  const target = openMemos(app.view)[0];
  const before = app.doc.events.length;
  const r = app.resolveMemo(target.gid, '2026-10-13');
  assert.equal(r.ok, true);
  assert.equal(app.doc.events.length, before + 1);
  assert.ok(!openMemos(app.view).some((x) => x.gid === target.gid), '닫힘');
  const added = app.doc.events.at(-1);
  assert.ok(Date.parse(added.recorded_at) > Date.parse('2026-10-13T18:00:00+09:00'), '기록 시각이 원래 메모보다 뒤');
  assert.equal(app.resolveMemo(target.gid, '2026-10-13').ok, false, '이미 닫혔으면 거부');
  assert.equal(app.doc.events.length, before + 1);
  assert.equal(open(d.universe.id, storage).doc.events.length, before + 1, '저장소에도 1건만');
});

test('K-4 정상: 닫히는 해결 표시는 지금처럼 저장된다(샘플 미해결 메모)', () => {
  const app = open('U-A1');
  const target = openMemos(app.view)[0];
  const n = openMemos(app.view).length;
  assert.equal(app.resolveMemo(target.gid, '2026-10-13').ok, true);
  assert.equal(openMemos(app.view).length, n - 1);
});

// ── K-5 ──
test('K-5 속성 키 __proto__·constructor·prototype은 E-SCHEMA(format)로 거부한다', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const r = parseAttrsCell(`${key}=x`);
    assert.equal(r.attrs, null, key);
    assert.deepEqual([r.error.code, r.error.field, r.error.format], ['E-SCHEMA', 'attrs', true], key);
    assert.equal(parseAttrsCell(`주기=월; ${key}=x`).error.format, true, `${key} (두 번째 칸)`);
  }
  assert.deepEqual(parseAttrsCell('주기=월; 마감=5일').attrs, { 주기: '월', 마감: '5일' });
  const ops = newRowsToOps([{ line: 1, cells: { type: '업무', label: '가상 업무', attrs: '__proto__=x' } }], { attachRoot: false });
  assert.equal(ops[0].op, 'invalid');
  assert.equal(ops[0].error.format, true);
});

// ── D-10 ──
test('D-10 T-24 읽기 전용(저장소 쓰기 실패)에서는 resolveMemo가 거부되고 이력이 늘지 않는다', () => {
  const app = open('U-A1', memoryStorage(() => true));
  assert.equal(app.readOnly, true);
  const target = openMemos(app.view)[0];
  const before = app.doc.events.length;
  const r = app.resolveMemo(target.gid, '2026-10-13');
  assert.equal(r.ok, false);
  assert.equal(app.doc.events.length, before);
  assert.ok(openMemos(app.view).some((x) => x.gid === target.gid));
});

test('D-10 T-26 넓힌 찾기(설명·속성까지)를 해도 문서·이력 수가 변하지 않는다', () => {
  const app = open('U-A1');
  const snap = JSON.stringify(app.doc);
  const events = app.doc.events.length;
  assert.ok(searchNodes(app.view, '가상정산시스템', { wide: true }).length >= 1);
  assert.ok(searchNodes(app.view, '대사', { wide: true }).length >= 1);
  assert.equal(app.doc.events.length, events);
  assert.equal(JSON.stringify(app.doc), snap);
});
