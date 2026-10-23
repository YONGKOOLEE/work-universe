// 처음 사용 점검 3회차(2026-10-24) W7: 화면 흐름 도우미 — 권장 항목 「담당」 칸(assignOps), 초안 다시 그릴 때 선택 유지(keepDraftPick),
// 새 지도 창 안내·범례·통합 확인 문구. main.js 자체(DOM)는 단위 테스트가 닿지 않아 tools/browser-check.mjs 「처음 사용 W7」이 맡는다. 가상 데이터만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyBatch } from '../app/src/model/commands.js';
import { buildView } from '../app/src/view/view.js';
import { workFormMissing } from '../app/src/rules/form.js';
import { LEGEND_COLLAPSED_TEXT, LEVEL_LABEL_HINT, OWNER_LABEL_HINT, OWNER_REQUIRED_TEXT, assignOps, keepDraftPick, mergePendingText } from '../app/src/ui/flow-helpers.js';
import { mkDoc, mkEdge, mkNode } from './helpers.js';

const ctx = { now: '2026-10-24T10:00:00+09:00' };
const mkSmall = () => mkDoc('U-W7', [mkNode('N-001', 'work', '가상 점검'), mkNode('N-002', 'person', '김가상')], [mkEdge('N-000', 'N-001', 'contains')]);
const viewOfDoc = (d) => buildView(d, () => null);
const personsOf = (d) => d.nodes.filter((n) => n.core_type === 'person' && !n.hidden);
const wGid = 'U-W7/N-001';

test('assignOps: 없는 이름 → 새 사람을 만들어 이 업무에 수행 연결(담당 시작 이력 포함), 권장 항목에서 「담당」이 빠진다', () => {
  const d = mkSmall();
  assert.ok(workFormMissing(viewOfDoc(d), wGid).includes('담당'));
  const plan = assignOps(personsOf(d), '  박가상 ', 'N-001');
  assert.equal(plan.ok, true);
  assert.equal(plan.existing, false);
  const r = applyBatch(d, plan.ops, ctx);
  assert.equal(r.ok, true);
  assert.equal(r.created.length, 1);
  assert.equal(r.created[0].label, '박가상', '앞뒤 공백은 지운다');
  assert.equal(r.created[0].core_type, 'person');
  assert.equal(r.assignments.length, 1);
  const e = r.assignments[0];
  assert.deepEqual([e.core_type, e.source, e.target], ['performs', r.created[0].id, 'N-001']);
  assert.deepEqual(e.period, { start: '2026-10-24' }, '시작일은 오늘(명령 기본값)');
  assert.ok(r.events.some((x) => x.type === 'assign_start'), '담당 시작 이력');
  assert.equal(workFormMissing(viewOfDoc(r.doc), wGid).includes('담당'), false);
  assert.equal(r.doc.nodes.length, d.nodes.length + 1);
});

test('assignOps: 같은 이름의 사람이 있으면(앞뒤 공백 무시) 새로 만들지 않고 그 사람을 잇는다', () => {
  const d = mkSmall();
  const plan = assignOps(personsOf(d), ' 김 가상', 'N-001');
  assert.equal(plan.ok, true);
  assert.equal(plan.existing, false, '띄어쓰기가 다르면 다른 이름이다(정규화는 연속 공백만 하나로)');
  const same = assignOps(personsOf(d), '김가상 ', 'N-001');
  assert.equal(same.existing, true);
  assert.equal(same.ops.length, 1);
  const r = applyBatch(d, same.ops, ctx);
  assert.equal(r.ok, true);
  assert.equal(r.created.length, 0);
  assert.equal(r.doc.nodes.length, d.nodes.length);
  assert.equal(r.assignments[0].source, 'N-002');
});

test('assignOps: 이미 담당 중인 사람이면 오류 없이 건너뛴다(W-ALREADY-ASSIGNED), 빈 이름·같은 이름 둘은 명령을 만들지 않는다', () => {
  const d = mkSmall();
  const first = applyBatch(d, assignOps(personsOf(d), '김가상', 'N-001').ops, ctx);
  assert.equal(first.ok, true);
  const again = applyBatch(first.doc, assignOps(personsOf(first.doc), '김가상', 'N-001').ops, ctx);
  assert.equal(again.ok, true);
  assert.equal(again.warnings[0].code, 'W-ALREADY-ASSIGNED');
  assert.deepEqual(assignOps(personsOf(d), '   ', 'N-001'), { ok: false, reason: 'empty' });
  assert.deepEqual(assignOps(personsOf(d), undefined, 'N-001'), { ok: false, reason: 'empty' });
  const dup = [{ id: 'N-8', label: '김가상' }, { id: 'N-9', label: '김가상' }];
  assert.deepEqual(assignOps(dup, '김가상', 'N-001'), { ok: false, reason: 'ambiguous' });
});

test('assignOps: 너무 긴 이름은 명령이 거절한다(기존 검증 그대로) — 문서는 바뀌지 않는다', () => {
  const d = mkSmall();
  const snap = JSON.stringify(d);
  const r = applyBatch(d, assignOps(personsOf(d), '가'.repeat(101), 'N-001').ops, ctx);
  assert.equal(r.ok, false);
  assert.equal(JSON.stringify(d), snap);
});

test('keepDraftPick: 고른 대상·보내는·받는 사람을 이름으로 적는다(없어진 노드는 빈 이름, 대상이 비면 이전 대상 유지)', () => {
  const names = { 'U/N-1': '업무 가', 'U/P-1': '보내는이', 'U/P-2': '받는이' };
  const nameOf = (g) => names[g] || '';
  const k = keepDraftPick({ target: 'U/N-0' }, { target: 'U/N-1', from: 'U/P-1', to: 'U/P-2' }, nameOf);
  assert.deepEqual(k, { target: 'U/N-1', preset: { target: 'U/N-1', from: '보내는이', to: '받는이' } });
  const gone = keepDraftPick({ target: 'U/N-0' }, { target: '', from: 'U/P-9', to: '' }, nameOf);
  assert.deepEqual(gone, { target: 'U/N-0', preset: { target: 'U/N-0', from: '', to: '' } });
});

test('문구: 범례(접힌 팀·요약 연결)와 통합 확인 줄이 쉬운 말이고, 대기가 없으면 기존 문장 그대로', () => {
  assert.equal(LEGEND_COLLAPSED_TEXT, '숫자 = 접힌 팀(두 번 누르면 펼침) · 점선 = 팀 사이 요약 연결');
  assert.ok(!LEGEND_COLLAPSED_TEXT.includes('이중 테두리'));
  assert.equal(mergePendingText({ pending: 3, persons: 2, works: 1 }), '같은 사람·업무인지 확인할 것 3건(사람 2, 업무 후보 1) ');
  assert.equal(mergePendingText({ pending: 0, persons: 0, works: 0 }), '통합 확인할 항목이 없습니다. ');
  assert.equal(mergePendingText(null), '통합 확인할 항목이 없습니다. ');
});

test('새 지도 창: 칸 제목 옆 안내·placeholder·누락 오류 문구(칸 id·검증 규칙은 그대로)', () => {
  const html = readFileSync(new URL('../app/index.html', import.meta.url), 'utf8');
  assert.ok(html.includes(OWNER_LABEL_HINT), '작성 주체 옆 안내');
  assert.ok(html.includes(LEVEL_LABEL_HINT), '단위 옆 안내');
  assert.match(html, /id="create-owner"[^>]*placeholder="팀·부서 이름 \(예: 가상영업팀\)"/);
  for (const id of ['create-name', 'create-level', 'create-owner', 'create-description']) assert.ok(html.includes(`id="${id}"`), id);
  assert.equal(OWNER_REQUIRED_TEXT, '작성 주체(팀·부서 이름)를 적으세요. 모르면 「내 업무를 정리해 두고 싶어요」로 시작하면 자동으로 채웁니다.');
});
