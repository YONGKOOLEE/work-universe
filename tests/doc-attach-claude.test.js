// 문서로 더하기 「Claude로 읽기」: 문서 읽기(convertDocumentAsync)의 kept를 규칙 결과 대신 계획으로 바꾼다(rules/doc-attach.js keptToAttachPlan)
// + 화면(ui/doc-attach.js convertAi): 꼼꼼히 읽기 체크, 단계별 대기 문구, 검토 요약, 규칙 결과로 되돌리기. 실제 API는 부르지 않는다(가짜 응답). 가상 데이터만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMPLES } from '../app/data/index.js';
import { createApp } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import { applyBatch } from '../app/src/model/commands.js';
import { validateDocument } from '../app/src/model/validate.js';
import { SUBTYPE_ROLE } from '../app/src/model/schema.js';
import { buildAttachOps, defaultDocSelection, keptToAttachPlan, planToOps, readDocumentRule } from '../app/src/rules/doc-attach.js';
import { docAttachDialog } from '../app/src/ui/doc-attach.js';
import { AI_READ, busyText } from '../app/src/ui/ai-read.js';
import { FakeEl, installDom, uninstallDom } from './dom-stub.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'doc-attach');
const TEXT = fs.readFileSync(path.join(DIR, fs.readdirSync(DIR).find((f) => f.startsWith('2') && f.endsWith('.txt'))), 'utf8');
const TODAY = '2026-10-28';
const NOW = '2026-10-28T09:00:00+09:00';
const TARGET = 'N-001'; // 대사 확인(업무)
const clone = (x) => JSON.parse(JSON.stringify(x));
const baseDoc = () => clone(SAMPLES.find((d) => d.universe.id === 'U-A1'));
const rulePlan = (doc = baseDoc()) => readDocumentRule(TEXT, { doc, targetId: TARGET, today: TODAY }).plan;

const work = (label, extra = {}) => ({ label, description: '', attrs: {}, quote: `${label} 관련 원문 구절입니다`, ...extra });
const person = (label, role = true) => ({ label, marks: '', description: '', quote: `${label} 담당 원문 구절입니다`, role, org: '', duty: '' });
const KEPT = () => ({
  name: '', purpose: '', owner: '', date: '', truncated: [],
  works: [
    work('요금표 검증', { description: '요금표를 대조한다', attrs: { 마감: '2026. 11. 30.', 절차: '① 추출 ② 대조', 주기: '월 1회', 주의사항: '말일 전 완료', '사용 시스템': '가상정산시스템' } }),
    work('안내문 발송', { attrs: { 마감: '확인 후 협의' } }),
    work('지난 점검', { attrs: { 마감: '2026. 10. 1.' } }),
    work('대사 확인'), // 대상 업무와 같은 이름 = 대상 업무 자신
    work('대사확인 점검'), // 대상 업무 「대사 확인」와 비슷한 이름
  ],
  people: [person('정산팀'), person('류다온', false), person('감사팀')],
  artifacts: [{ label: '요금 대조표', description: '', quote: '요금 대조표 원문 구절입니다' }],
  topics: [{ label: '보안 요건', description: '개인정보 마스킹', subtype: '', quote: '보안 요건 원문 구절입니다' }],
  memos: [
    { text: '요금 인상 시점이 정해지지 않았다.', kind: 'issue', work: '요금표 검증', quote: '요금 인상 시점 원문 구절입니다' },
    { text: '말일에는 점검하지 않는다.', kind: 'caution', work: '', quote: '말일 점검 원문 구절입니다' },
    { text: '대사 확인 담당이 바뀔 수 있다.', kind: 'issue', work: '대사 확인', quote: '담당 변경 원문 구절입니다' },
  ],
  edges: [
    { from: { type: 'person', label: '정산팀' }, to: { type: 'work', label: '요금표 검증' }, relation: 'performs', quote: '정산팀이 요금표 검증', verb: '' },
    { from: { type: 'person', label: '류다온' }, to: { type: 'work', label: '요금표 검증' }, relation: 'performs', quote: '류다온이 요금표 검증', verb: '' },
    { from: { type: 'person', label: '감사팀' }, to: { type: 'topic', label: '보안 요건' }, relation: 'relates_to', quote: '감사팀이 보안 요건을 본다', verb: '' },
    { from: { type: 'person', label: '정산팀' }, to: { type: 'topic', label: '보안 요건' }, relation: 'relates_to', quote: '정산팀이 보안 요건', verb: '' }, // 담당자와 이어지는 연결 → 더하지 않음
    { from: { type: 'person', label: '감사팀' }, to: { type: 'work', label: '대사 확인' }, relation: 'performs', quote: '감사팀이 대사 확인 점검', verb: '점검' }, // 대상 업무 자신
    { from: { type: 'work', label: '요금표 검증' }, to: { type: 'artifact', label: '요금 대조표' }, relation: 'produces', quote: '요금표 검증 결과는 요금 대조표', verb: '' }, // 할 일 업무와 이어짐 → 더하지 않음
  ],
});
const REVIEW = () => ({
  ok: true, dropped: 0, cached: false, added: { nodes: 1, edges: 0, memos: 0, attrs: 2 },
  issues: [
    { kind: 'item', label: '요금표 검증', reason: '날짜 해석이 모호함', quote: '요금표 검증 원문 구절' },
    { kind: 'item', label: '보안 요건', reason: '주제가 아니라 업무일 수 있음', quote: '보안 요건 원문 구절' },
    { kind: 'edge', label: '감사팀 → 보안 요건', reason: '연결 방향이 의심됨', quote: '감사팀이 보안 요건을 본다' },
  ],
});

// ── 순수: keptToAttachPlan ──

test('keptToAttachPlan: 할 일(담당=performs 연결의 사람·마감 해석·속성)·대상과 비슷한 업무 제외·지난 기한', () => {
  const rp = rulePlan();
  const { plan } = keptToAttachPlan(KEPT(), rp, baseDoc(), { review: null });
  assert.equal(plan.source, 'claude');
  assert.equal(plan.doc.label, rp.doc.label, '문서 항목은 규칙의 것');
  assert.deepEqual(plan.tasks.map((t) => t.label), ['요금표 검증', '안내문 발송', '지난 점검', '대사확인 점검'], '대상과 같은 이름(대사 확인)은 만들지 않고 비슷한 이름은 만들되 체크 안 함');
  const [a, b, c, sim] = plan.tasks;
  assert.deepEqual(a.owners.map((o) => [o.label, o.role]), [['정산팀', true], ['류다온', false]]);
  assert.equal(a.due.value, '2026-11-30');
  assert.equal(a.past, false);
  assert.deepEqual(a.attrs, { 절차: '① 추출 ② 대조', 주기: '월 1회', 주의사항: '말일 전 완료', '사용 시스템': '가상정산시스템' });
  assert.ok(a.description.startsWith('요금표를 대조한다'), a.description);
  assert.deepEqual([b.due.text, b.due.value, b.past], ['확인 후 협의', '', false], '날짜가 아닌 마감은 글만 보이고 속성에 넣지 않음');
  assert.ok(b.description.includes('마감(원문): 확인 후 협의'));
  assert.equal(c.past, true);
  assert.equal(sim.hold, '대상 업무와 비슷한 이름(「대사 확인」)');
  assert.deepEqual(defaultDocSelection(plan).tasks, { t1: true, t2: true, t3: false, t4: false }, '지난 기한·비슷한 이름은 처음 체크 안 함');
  assert.ok(plan.notes.some((n) => n.includes('「대사 확인」') && n.includes('새 업무로 만들지 않았습니다')));
});

test('keptToAttachPlan: 메모(범주·출처·대상 업무)와 오늘 날짜', () => {
  const rp = rulePlan();
  const { plan } = keptToAttachPlan(KEPT(), rp, baseDoc(), {});
  assert.equal(plan.memos.length, 3);
  const [m1, m2, m3] = plan.memos;
  assert.deepEqual([m1.category, m1.task, m1.forLabel, m1.date], ['issue', 't1', '요금표 검증', TODAY]);
  assert.ok(m1.text.startsWith('요금 인상 시점이 정해지지 않았다. — 출처: 「'), m1.text);
  assert.deepEqual([m2.category, m2.task, m2.forLabel], ['caution', '', '대사 확인']);
  assert.equal(m2.date, rp.docDate && rp.docDate <= TODAY ? rp.docDate : TODAY);
  assert.deepEqual([m3.task, m3.forLabel], ['', '대사 확인'], '대상 업무 이름의 업무에 걸린 메모는 대상 업무로');
});

test('keptToAttachPlan: 나머지는 제안으로(담당자는 제외, 대상 업무 이름의 업무는 대상 업무로 이어짐), 업무·담당과 이어지는 연결은 더하지 않고 알림', () => {
  const { plan, proposal } = keptToAttachPlan(KEPT(), rulePlan(), baseDoc(), {});
  assert.deepEqual(proposal.nodes.map((n) => [n.type, n.label]), [['person', '감사팀'], ['artifact', '요금 대조표'], ['topic', '보안 요건'], ['work', '대사 확인']]);
  assert.equal(proposal.nodes.find((n) => n.label === '보안 요건').description, '개인정보 마스킹');
  assert.deepEqual(proposal.edges.map((e) => [e.type, proposal.nodes.find((n) => n.key === e.from).label, proposal.nodes.find((n) => n.key === e.to).label]), [
    ['relates_to', '감사팀', '보안 요건'],
    ['performs', '감사팀', '대사 확인'],
  ]);
  assert.equal(proposal.edges[1].verb, '점검');
  assert.deepEqual(plan.heldEdges.map((x) => x.text), ['정산팀 → 보안 요건', '요금표 검증 → 요금 대조표']);
});

test('keptToAttachPlan: 검토가 의심한 항목·연결은 처음 체크 안 함(hold), 검토 요약', () => {
  const { plan, proposal, review } = keptToAttachPlan(KEPT(), rulePlan(), baseDoc(), { review: REVIEW() });
  assert.equal(plan.tasks[0].hold, '검토: 날짜 해석이 모호함');
  assert.equal(defaultDocSelection(plan).tasks.t1, false);
  assert.equal(defaultDocSelection(plan).tasks.t2, true);
  assert.equal(proposal.nodes.find((n) => n.label === '보안 요건').hold, '검토: 주제가 아니라 업무일 수 있음');
  assert.equal(proposal.edges[0].hold, '검토: 연결 방향이 의심됨');
  assert.deepEqual([review.ok, review.added, review.issues.length], [true, 3, 3]);
  const failed = keptToAttachPlan(KEPT(), rulePlan(), baseDoc(), { review: { ok: false, reason: '시간 초과' } });
  assert.deepEqual(failed.review, { ok: false, reason: '시간 초과' });
  assert.equal(failed.plan.tasks[0].hold, undefined);
});

test('planToOps: Claude 계획을 더하면 속성·설명·담당(역할 표시는 role만)·메모 대상(할 일 업무)이 저장되고 문서 검증을 통과', () => {
  const doc = baseDoc();
  const { plan } = keptToAttachPlan(KEPT(), rulePlan(doc), doc, {});
  const sel = { doc: true, tasks: { t1: true, t2: true, t3: true }, memos: { m1: true, m2: true, m3: true } };
  const { ops, counts } = planToOps(plan, sel, doc, { targetId: TARGET });
  assert.deepEqual([counts.tasks, counts.roles, counts.memos], [3, 2, 3]);
  const r = applyBatch(doc, ops, { now: NOW });
  assert.equal(r.ok, true, JSON.stringify(r.errors || r.error));
  const next = r.doc;
  const w = next.nodes.find((n) => n.label === '요금표 검증');
  assert.equal(w.attrs.마감, '2026-11-30');
  assert.equal(w.attrs.절차, '① 추출 ② 대조');
  assert.equal(w.attrs['사용 시스템'], '가상정산시스템');
  const nb = next.nodes.find((n) => n.label === '안내문 발송');
  assert.equal((nb.attrs || {}).마감, undefined, '날짜가 아닌 마감은 속성에 넣지 않음');
  assert.equal(next.nodes.find((n) => n.label === '정산팀').subtype, SUBTYPE_ROLE);
  assert.notEqual(next.nodes.find((n) => n.label === '류다온').subtype, SUBTYPE_ROLE, '이름 있는 사람은 역할로 만들지 않음');
  const memoTargets = next.events.filter((e) => e.type === 'memo' && e.recorded_at === NOW).map((e) => [e.payload.category, e.payload.target_id]);
  assert.equal(memoTargets.length, 3);
  assert.equal(memoTargets.filter(([, t]) => t === w.id).length, 1, '메모 하나는 할 일 업무에');
  assert.equal(memoTargets.filter(([, t]) => t === TARGET).length, 2);
  assert.equal(validateDocument(next).ok, true);
});

test('buildAttachOps: 제안(체크한 것)은 문서 항목에서 잇고 대상 업무 이름의 업무는 대상에 이어짐(새 업무 없음)', () => {
  const doc = baseDoc();
  const { plan, proposal } = keptToAttachPlan(KEPT(), rulePlan(doc), doc, {});
  const ai = { proposal, selection: { nodes: Object.fromEntries(proposal.nodes.map((n) => [n.key, { include: true }])), edges: Object.fromEntries(proposal.edges.map((e) => [e.key, { include: true }])) } };
  const { ops, counts } = buildAttachOps(plan, { doc: true, tasks: { t1: false, t2: false, t3: false, t4: false }, memos: { m1: false, m2: false, m3: false } }, ai, doc, { targetId: TARGET });
  const nodes = ops.filter((o) => o.op === 'addNode').map((o) => o.input.label);
  assert.deepEqual(nodes.sort(), ['감사팀', '보안 요건', '요금 대조표', plan.doc.label].sort());
  assert.equal(ops.find((o) => o.op === 'addNode' && o.input.label === '보안 요건').input.description, '개인정보 마스킹');
  assert.equal(counts.aiLinks, 3);
  const r = applyBatch(doc, ops, { now: NOW });
  assert.equal(r.ok, true, JSON.stringify(r.errors || r.error));
});

// ── 화면(DOM 흉내) ──

const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const openApp = () => createApp({ store: createStore(memoryStorage()), samples: SAMPLES, currentId: 'U-A1', now: () => NOW });
const withDom = (fn) => async () => {
  const body = installDom();
  try { await fn(body); } finally { uninstallDom(); }
};
const tick = () => new Promise((r) => setTimeout(r, 0));

function openDialog({ app = openApp(), convertAi, aiReady = true } = {}) {
  const dialog = new FakeEl('dialog');
  dialog.open = false;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.fire('close'); };
  document.body.append(dialog);
  const saved = [];
  const open = docAttachDialog({ dialog, app, getView: () => app.view, aiReady: () => aiReady, convertAi, today: () => TODAY, onSaved: (r, ctx) => saved.push({ r, ctx }) });
  open(TARGET);
  const q = (id) => dialog.querySelector(`[data-testid=${id}]`);
  const rows = (prefix) => dialog.querySelectorAll(`[data-testid^=${prefix}-]`).filter((e) => new RegExp(`^${prefix}-\\d+$`).test(e.dataset.testid));
  return { dialog, app, saved, q, rows };
}
const answer = (over = {}) => ({ ok: true, kept: KEPT(), model: 'claude-test', review: REVIEW(), ...over });

test('화면: 「꼼꼼히 읽기」 체크가 기본 켜짐으로 있고, 키가 없으면 체크도 없다', withDom(() => {
  const d = openDialog({ convertAi: async () => answer() });
  assert.ok(d.q('doc-attach-review-check'));
  assert.equal(d.q('doc-attach-review-check').checked, true);
  assert.equal(d.q('doc-attach-review-check-label').textContent.trim(), AI_READ.reviewLabel);
  const none = openDialog({ convertAi: async () => null, aiReady: false });
  assert.equal(none.q('doc-attach-review-check'), null);
}));

test('화면: Claude로 읽기 → 문서 전체·지도 정보·검토 여부를 보내고, 단계별 대기 문구 → Claude 결과(규칙 결과 대신)·검토 요약, 되돌리기', withDom(async () => {
  const calls = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const d = openDialog({
    convertAi: async (text, opt) => {
      calls.push({ text, opt });
      opt.onStage('read');
      await gate;
      opt.onStage('review');
      return answer();
    },
  });
  d.q('doc-attach-input').value = TEXT;
  const p = d.q('doc-attach-ai').fire('click');
  await tick();
  assert.equal(d.q('doc-attach-busy').textContent, 'Claude가 문서를 읽는 중…(1/2) — 최대 약 3분');
  assert.equal(d.q('doc-attach-review-check').disabled, true, '읽는 동안 체크는 잠김');
  release();
  await p;
  await tick();
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].text, TEXT, '문서 전체(덩어리 없이)');
  assert.equal(calls[0].opt.review, true);
  assert.equal(calls[0].opt.context.target, '대사 확인');
  assert.ok(calls[0].opt.context.existing.some((x) => x.type === 'person' && x.label === '한가람'));
  assert.ok(calls[0].opt.context.existing.every((x) => x.type !== 'root'));
  assert.equal(d.q('doc-attach-busy').textContent, '');
  assert.match(d.q('doc-attach-method').textContent, /^Claude가 문서 전체를 읽은 결과입니다\(규칙 결과 대신·claude-test\)/);
  assert.equal(d.q('doc-attach-summary').textContent, '문서 1개 · 할 일 업무 4개 · 메모 3건 · Claude 항목 4개');
  assert.deepEqual(d.rows('doc-attach-task').map((_, i) => d.q(`doc-attach-task-label-${i}`).textContent), ['요금표 검증', '안내문 발송', '지난 점검', '대사확인 점검']);
  assert.match(d.q('doc-attach-task-status-0').textContent, /처음엔 체크 안 함 · 검토: 날짜 해석이 모호함/);
  assert.equal(!!d.q('doc-attach-task-check-0').checked, false);
  assert.equal(!!d.q('doc-attach-task-check-1').checked, true);
  assert.equal(d.q('doc-attach-task-owners-0').textContent, '정산팀(새 역할), 류다온(새 역할)');
  assert.match(d.q('doc-attach-review').textContent, /검토\(두 번째 읽기\) — 더한 것 3개 · 확인 필요 3건/);
  assert.ok(d.q('doc-attach-review-issue-0').textContent.includes('날짜 해석이 모호함'));
  assert.ok(d.q('doc-attach-held-edges'), '더하지 않은 연결 알림');
  assert.ok(d.q('doc-attach-ai-nodes'));
  // 되돌리기: 규칙 결과 ↔ Claude 결과
  d.q('doc-attach-show-rule').click();
  assert.equal(d.q('doc-attach-method').textContent.startsWith('규칙으로 읽었습니다'), true);
  assert.equal(d.q('doc-attach-review'), null);
  assert.equal(d.rows('doc-attach-task').length, 5, '규칙 결과의 할 일 5개');
  d.q('doc-attach-show-claude').click();
  assert.match(d.q('doc-attach-method').textContent, /^Claude가 문서 전체를 읽은 결과입니다/);
  assert.equal(d.rows('doc-attach-task').length, 4);
  // 저장: 체크한 것만(검토가 의심한 할 일은 빠짐)
  d.q('doc-attach-save').click();
  assert.equal(d.saved.length, 1);
  const doc = d.app.doc;
  assert.ok(doc.nodes.some((n) => n.label === '안내문 발송'));
  assert.ok(!doc.nodes.some((n) => n.label === '요금표 검증'));
  assert.equal(validateDocument(doc).ok, true);
}));

test('화면: 꼼꼼히 읽기를 끄면 review:false로 부르고 「(1/2)」 없이 「최대 90초」, 검토 요약은 없음', withDom(async () => {
  const calls = [];
  let release;
  const gate = new Promise((r) => { release = r; });
  const d = openDialog({ convertAi: async (text, opt) => { calls.push(opt); await gate; return answer({ review: null }); } });
  d.q('doc-attach-input').value = TEXT;
  d.q('doc-attach-review-check').checked = false;
  d.q('doc-attach-review-check').fire('change');
  const p = d.q('doc-attach-ai').fire('click');
  await tick();
  assert.equal(d.q('doc-attach-busy').textContent, 'Claude가 문서를 읽는 중… — 최대 90초');
  release();
  await p;
  await tick();
  await tick();
  assert.equal(calls[0].review, false);
  assert.equal(d.q('doc-attach-review'), null);
  assert.match(d.q('doc-attach-method').textContent, /^Claude가 문서 전체를 읽은 결과입니다/);
  assert.equal(busyText('review', true), '빠진 것이 없는지 다시 보는 중…(2/2) — 최대 약 3분');
}));

test('화면: 검토가 실패하면 「검토는 하지 못했습니다(이유) — 첫 읽기 결과입니다」 한 줄, 읽기 자체가 실패하면 규칙 결과와 안내', withDom(async () => {
  const d = openDialog({ convertAi: async () => answer({ review: { ok: false, reason: '시간 초과' } }) });
  d.q('doc-attach-input').value = TEXT;
  await d.q('doc-attach-ai').fire('click');
  await tick();
  assert.equal(d.q('doc-attach-review').textContent, '검토는 하지 못했습니다(시간 초과) — 첫 읽기 결과입니다');
  const f = openDialog({ convertAi: async () => ({ ok: false, fallback: { reason: '연결 실패·시간 초과' } }) });
  f.q('doc-attach-input').value = TEXT;
  await f.q('doc-attach-ai').fire('click');
  await tick();
  assert.equal(f.q('doc-attach-fallback').textContent, 'Claude 읽기 실패: 연결 실패·시간 초과 — 규칙으로 읽은 결과를 보여 줍니다');
  assert.equal(f.rows('doc-attach-task').length, 5);
  assert.equal(f.q('doc-attach-show-claude'), null);
  assert.equal(f.q('doc-attach-save').disabled, false);
}));

test('비슷한 이름: 길이가 많이 다르면 비슷하다고 보지 않는다(「대사 확인」 ↔ 「대사 결과 이중 확인 절차 마련」), 실제 키 시험 사례는 그대로 비슷함', async () => {
  const { similarName } = await import('../app/src/rules/doc-attach.js');
  assert.equal(similarName('대사 결과 이중 확인 절차 마련', '대사 확인'), false);
  assert.equal(similarName('월간 보고서 작성', '보고'), false);
  assert.equal(similarName('문자메시지 발송 서비스 월정산', '문자발송 월정산'), true);
  assert.equal(similarName('대사 확인', '대사확인'), true);
  assert.equal(similarName('대사 확인 업무', '대사 확인'), true);
});
