// CR-23 독립 검토(RV-B-1~14) 반영 시험. 각 항목은 고치기 전에 실패하는 시험으로 먼저 만들었다.
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
import { openMemos } from '../app/src/rules/issues.js';
import { recentRecords } from '../app/src/view/recent-records.js';
import { attachNotice, defaultDocSelection, parseDue, planToOps, readDocumentRule } from '../app/src/rules/doc-attach.js';
import { docAttachDialog } from '../app/src/ui/doc-attach.js';
import { FakeEl, installDom, uninstallDom } from './dom-stub.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'doc-attach');
const FIX = Object.fromEntries(fs.readdirSync(DIR).map((f) => [f.slice(0, 1), fs.readFileSync(path.join(DIR, f), 'utf8')]));
const TODAY = '2026-10-28';
const NOW = '2026-10-28T09:00:00+09:00';
const clone = (x) => JSON.parse(JSON.stringify(x));
const baseDoc = () => clone(SAMPLES.find((d) => d.universe.id === 'U-A1'));
const rd = (text, doc = baseDoc()) => readDocumentRule(text, { doc, targetId: 'N-001', today: TODAY });
const table = (...rows) => `회의록\n1. 실행 계획\n과제 담당 기한\n${rows.join('\n')}\n`;
const memoryStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const openApp = (now = () => NOW) => createApp({ store: createStore(memoryStorage()), samples: SAMPLES, currentId: 'U-A1', now });
const labels = (p) => p.tasks.map((t) => [t.label, t.owners.map((o) => o.label)]);

// ── RV-B-1 공백 표가 지어냄 ──

test('RV-B-1 ① 담당이 두 낱말 「서비스 사업」 중 「사업」만 잘려도 지어내지 않는다 → 읽지 못한 줄', () => {
  const p = rd(table('시스템 점검 서비스 사업 2026. 11. 30.')).plan;
  assert.deepEqual(p.tasks, []);
  assert.equal(p.unread.length, 1);
});

test('RV-B-1 ② 담당이 두 팀 「영업팀 고객지원팀」이면 과제 끝에 「영업팀」이 붙지 않는다(과제 이름 끝이 조직 꼴 → 읽지 못한 줄)', () => {
  const p = rd(table('고객 안내문 배포 영업팀 고객지원팀 2026. 11. 30.')).plan;
  assert.deepEqual(p.tasks, []);
  assert.equal(p.unread.length, 1);
});

test('RV-B-1 ③ 표 아래 산문의 날짜 줄(「…공지 예정 2026. 12. 15.」)은 할 일이 아니다, 첫 성공 행 뒤의 읽지 못한 줄에서 표가 끝난다', () => {
  const p = rd(table('시스템 점검 운영팀 2026. 11. 30.', '다음 회의는 별도 공지 예정 2026. 12. 15.', '자료 정리 운영팀 2026. 12. 20.')).plan;
  assert.deepEqual(labels(p), [['시스템 점검', ['운영팀']]]);
  assert.equal(p.unread.length, 1, '끝난 뒤의 줄은 더 읽지 않는다');
  assert.ok(p.unread[0].text.includes('다음 회의는'));
  const alone = rd(table('다음 회의는 별도 공지 예정 2026. 12. 15.')).plan;
  assert.deepEqual(alone.tasks, []);
});

test('RV-B-1 ④ 담당이 접속사·흔한 낱말(그리고·및·예정·등)이면 읽지 않는다', () => {
  for (const w of ['그리고', '및', '예정', '등', '또는']) {
    const p = rd(table(`나는 오늘 점심을 먹었다 ${w} 2026. 11. 30.`)).plan;
    assert.deepEqual(p.tasks, [], w);
  }
  assert.deepEqual(rd(table('회의 결과를 정리 그리고 2026. 11. 30.')).plan.tasks, []);
});

test('RV-B-1 과제 이름이 문장(…다/…예정/…함)이면 읽지 않는다', () => {
  for (const t of ['오늘 점심을 먹었다', '다음 회의 예정', '자료를 정리함']) assert.deepEqual(rd(table(`${t} 운영팀 2026. 11. 30.`)).plan.tasks, [], t);
});

test('RV-B-1 담당이 조직 꼴이거나 같은 표의 다른 행·지도에 이미 있으면 읽는다(fixture의 법무·영업·재무정산·기술·사업본부·서비스사업)', () => {
  assert.deepEqual(labels(rd(table('점검 운영팀 2026. 11. 30.')).plan), [['점검', ['운영팀']]]);
  // 한 번만 나온 두 글자 낱말 담당은 읽지 않는다. 다른 행에서도 담당으로 쓰이면 읽는다
  assert.deepEqual(rd(table('점검 법무 2026. 11. 30.')).plan.tasks, []);
  assert.deepEqual(labels(rd(table('점검 법무 2026. 11. 30.', '검토 법무 2026. 12. 1.')).plan), [['점검', ['법무']], ['검토', ['법무']]]);
  assert.deepEqual(labels(rd(table('점검 법무/영업 2026. 11. 30.', '검토 영업 2026. 12. 1.')).plan), [['점검', ['법무', '영업']], ['검토', ['영업']]]);
  const doc = baseDoc();
  doc.nodes.push({ id: 'N-950', core_type: 'person', label: '법무', hidden: false, created_at: NOW, updated_at: NOW });
  assert.deepEqual(labels(rd(table('점검 법무 2026. 11. 30.'), doc).plan), [['점검', ['법무']]], '지도에 있는 사람 이름');
});

test('RV-B-1 경계 행(과제 이름이 7낱말 이상)은 만들되 처음 체크를 풀고 「확인 필요」 표시', () => {
  const p = rd(table('고객 안내문 과 개별 변경합의서 를 모두 배포 운영팀 2026. 11. 30.')).plan;
  assert.equal(p.tasks.length, 1);
  assert.ok(p.tasks[0].uncertain, '확인 필요');
  assert.equal(defaultDocSelection(p).tasks.t1, false);
});

test('RV-B-1 fixture 4개의 할 일 결과는 전과 같다', () => {
  const l = (n) => labels(rd(FIX[n]).plan);
  assert.deepEqual(l('1'), [['고객 안내문·FAQ 배포', ['영업기획', '고객지원']], ['계약변경 대상 분류 및 동의 수령', ['영업기획']], ['요금버전·정산 테스트', ['개발운영', '재무정산']], ['인상 후 이탈률·민원 모니터링', ['서비스사업']]]);
  assert.deepEqual(l('2'), [['계약별 인상 가능 여부 검토', ['법무', '영업']], ['고객별 매출 시나리오 및 손익 검증', ['재무정산']], ['안내문·FAQ·개별 변경합의', ['영업', '고객지원']], ['요금 엔진·청구서 회귀 테스트', ['기술', '재무정산']], ['최종 시행 승인 및 사후 모니터링', ['사업본부']]]);
  assert.deepEqual([l('3'), l('4')], [[], []]);
  assert.ok(rd(FIX['2']).plan.tasks.every((t) => !t.uncertain) && rd(FIX['1']).plan.tasks.every((t) => !t.uncertain));
  assert.ok(rd(FIX['2']).plan.unread.length === 0 && rd(FIX['1']).plan.unread.length === 0);
});

// ── RV-B-12 기한·담당 ──

test('RV-B-12 거꾸로 된 기한 범위·숫자뿐인 담당은 읽지 않는다', () => {
  assert.equal(parseDue('2027. 1.~2026. 11.'), null);
  assert.deepEqual(rd(table('점검 운영팀 2027. 1.~2026. 11.')).plan.tasks, []);
  assert.deepEqual(rd(table('점검 1234 2026. 11. 30.')).plan.tasks, []);
  assert.deepEqual(rd('회의록\n1. 실행\n| 과제 | 담당 | 기한 |\n|---|---|---|\n| 점검 | 1234 | 2026-11-30 |\n').plan.tasks, []);
});

// ── RV-B-3 동명이인 ──

test('RV-B-3 같은 이름 사람이 둘이면 그 담당은 잇지 않고 알린다(새로 만들지도 않고), 저장 전체가 실패하지 않는다', () => {
  const doc = baseDoc();
  for (const [id, emp] of [['N-Y1', 'V-0101'], ['N-Y2', 'V-0102']]) doc.nodes.push({ id, core_type: 'person', label: '운영팀', emp_no: emp, hidden: false, created_at: '2026-01-01T00:00:00+09:00', updated_at: '2026-01-01T00:00:00+09:00' });
  const p = rd(table('점검 운영팀 2026. 11. 30.', '안내 영업팀 2026. 11. 30.'), doc).plan;
  assert.equal(p.tasks[0].owners[0].ambiguous, true);
  assert.ok(p.notes.some((n) => n.includes('운영팀') && n.includes('둘 이상')));
  const { ops } = planToOps(p, defaultDocSelection(p), doc);
  const r = applyBatch(doc, ops, { now: NOW });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.ok(!r.doc.nodes.some((n) => n.label === '운영팀' && n.created_at === NOW), '동명이인 담당은 새로 만들지 않는다');
  assert.equal(r.doc.edges.filter((e) => e.core_type === 'performs' && e.created_at === NOW).length, 1, '영업팀 담당만 잇는다');
  assert.deepEqual(validateDocument(r.doc).errors, []);
});

// ── RV-B-4 이슈 메모 날짜 ──

test('RV-B-4 옛 문서의 미결(issue) 메모는 오늘 날짜·「[문서명 · 문서 날짜] 」 머리로 들어가 이후 해결됨 메모에 바로 닫히지 않는다(열린 메모 +2), caution은 문서 날짜 그대로', () => {
  const app = openApp();
  const before = openMemos(app.view).length;
  const r = readDocumentRule(FIX['1'], { doc: app.doc, targetId: 'N-001', today: TODAY });
  assert.ok(r.plan.memos.every((m) => m.category === 'issue' && m.date === TODAY));
  assert.ok(r.plan.memos[0].text.startsWith('[2016년 문자메시지 발송 수수료 조정 회의록 · 문서 날짜 2016-11-17] 대형 고객의'));
  const a = app.applyBatch(planToOps(r.plan, defaultDocSelection(r.plan), app.doc).ops);
  assert.equal(a.ok, true);
  assert.equal(openMemos(app.view).length, before + 2, '샘플의 뒤쪽 해결됨 메모가 새 미결 2건을 닫지 않는다');
  const c = readDocumentRule(FIX['4'], { doc: app.doc, targetId: 'N-001', today: TODAY }).plan;
  assert.ok(c.memos.every((m) => m.category === 'caution' && m.date === '2026-10-27' && m.text.startsWith('[대형 이용기관')));
  const nodate = rd('회의록\n1. 미결 사항\n하나 둘.').plan;
  assert.ok(nodate.memos[0].text.startsWith('[회의록] 하나'), '문서 날짜가 없으면 「[문서명] 」');
});

// ── RV-B-5 알림 ──

test('RV-B-5 알림은 사실대로: 메모·담당 기록은 되감아도 남고, 이슈 메모만 「해결로 표시」로 닫을 수 있다(이슈가 없으면 괄호 없음)', () => {
  const created = [{ core_type: 'artifact' }, { core_type: 'work' }];
  const t1 = attachNotice(created, 2, { issues: 2, assigns: 3 });
  assert.ok(t1.includes('되감아도 남습니다') && t1.includes('메모·담당 기록') && t1.includes('이슈 메모는 「해결로 표시」로 닫을 수 있습니다'), t1);
  const t2 = attachNotice(created, 2, { issues: 0, assigns: 0 });
  assert.ok(t2.includes('메모 기록은 되감아도 남습니다') && !t2.includes('해결로 표시'), t2);
  const t3 = attachNotice(created, 0, { issues: 0, assigns: 2 });
  assert.ok(t3.includes('담당 기록은 되감아도 남습니다'), t3);
  assert.ok(!attachNotice(created, 0, { issues: 0, assigns: 0 }).includes('되감아도 남습니다'));
});

// ── RV-B-7 절 판정 ──

test('RV-B-7 「미결정」은 결정 절이 아니고, 「결정 및 유의사항」은 메모로만, 「질문과 답변」은 issue가 아니다', () => {
  const a = rd('회의록\n1. 미결정 사항\n비용 분담 비율은 정하지 못했다.\n').plan;
  assert.ok(!a.sections.decisions.length && !a.doc.description.includes('결정:'));
  assert.deepEqual(a.memos.map((m) => m.category), ['issue']);
  const b = rd('회의록\n1. 결정 및 유의사항\n요금은 인상한다. 고객 고지에 유의한다.\n').plan;
  assert.ok(!b.doc.description.includes('결정:'), '메모가 된 절은 결정 설명에 또 넣지 않는다');
  assert.ok(b.memos.length >= 1 && b.memos.every((m) => m.category === 'caution'));
  const c = rd('설명회\n1. 질문과 답변\nQ: 요금은 언제 바뀌나요? A: 2027년 2월입니다.\n').plan;
  assert.deepEqual(c.memos, []);
  const d = rd('설명회\n1. 질문 사항\n요금은 언제 바뀌나요.\n').plan;
  assert.deepEqual(d.memos.map((m) => m.category), ['issue']);
  assert.ok(rd('회의록\n1. 결정사항\n요금은 인상한다.\n').plan.doc.description.includes('결정: 요금은 인상한다.'));
});

// ── RV-B-8 출처 ──

test('RV-B-8 문서로 더하기 이벤트의 출처는 system(최근 기록·내가 쓴 메모에 안 섞임), app.applyBatch의 기본 출처는 그대로 user', () => {
  const app = openApp();
  const r = readDocumentRule(FIX['2'], { doc: app.doc, targetId: 'N-001', today: TODAY });
  const ops = planToOps(r.plan, defaultDocSelection(r.plan), app.doc).ops;
  const a = app.applyBatch(ops, { source: 'system' });
  assert.equal(a.ok, true);
  assert.ok(app.doc.events.slice(-30).every((e) => e.source === 'system'), JSON.stringify(app.doc.events.slice(-30).map((e) => e.source)));
  assert.ok(!recentRecords(app.view).some((x) => String(x.text).includes('[2026년')), '최근 기록에 사용자 기록처럼 보이지 않는다');
  const u = openApp();
  const b = u.applyBatch([{ op: 'addNode', row: 1, input: { core_type: 'work', label: '기본 출처 업무' } }]);
  assert.equal(b.ok, true);
  assert.equal(u.doc.events[u.doc.events.length - 1].source, 'user');
});

// ── RV-B-9 대괄호 제목 ──

test('RV-B-9 「[회의록]」뿐인 첫 줄은 대괄호를 떼고, 메모 머리에 이중 대괄호가 없다', () => {
  const p = rd('[회의록]\n1. 미결\n하나 둘.').plan;
  assert.equal(p.doc.label, '회의록');
  assert.ok(p.memos[0].text.startsWith('[회의록] 하나'));
  assert.ok(!p.memos[0].text.includes('[['));
  const q = rd('[업무 메모]\n제목: 가상 안내\n1. 미결\n하나 둘.').plan;
  assert.equal(q.doc.label, '가상 안내');
});

// ── RV-B-10·11 읽지 못한 줄·notes ──

test('RV-B-10 같은 알림은 한 번만(notes 중복 없음)', () => {
  const p = rd(table('점검 운영팀 2026. 11. 30.', '점검 운영팀 2026. 12. 1.', '점검 운영팀 2026. 12. 2.')).plan;
  assert.equal(p.notes.length, new Set(p.notes).size);
  assert.equal(p.notes.filter((n) => n.includes('「점검」')).length, 1);
});

// ── 화면 ──

const withDom = (fn) => async () => { installDom(); try { await fn(); } finally { uninstallDom(); } };
function openDialog({ app = openApp(), aiReady = false, readAi = () => null, target = 'N-001' } = {}) {
  const dialog = new FakeEl('dialog');
  dialog.open = false;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.fire('close'); };
  document.body.append(dialog);
  const saved = [];
  const open = docAttachDialog({ dialog, app, getView: () => app.view, aiReady: () => aiReady, readAi, today: () => TODAY, onSaved: (r, ctx) => saved.push(ctx) });
  open(target);
  const q = (id) => dialog.querySelector(`[data-testid=${id}]`);
  const all = (prefix) => dialog.querySelectorAll(`[data-testid^=${prefix}]`);
  return { dialog, app, saved, q, all };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('RV-B-2 Claude가 읽는 동안 대상·글을 바꾸면 응답을 받아도 저장이 잠기고 「다시 읽어 주세요」, 읽는 동안 대상·글·파일 칸은 잠긴다', withDom(async () => {
  let resolveAi;
  const d = openDialog({ aiReady: true, readAi: () => new Promise((r) => { resolveAi = r; }) });
  d.q('doc-attach-input').value = FIX['2'];
  const p = d.q('doc-attach-ai').fire('click');
  assert.equal(!!d.q('doc-attach-target').disabled, true);
  assert.equal(!!d.q('doc-attach-input').disabled, true);
  assert.equal(!!d.q('doc-attach-file').disabled, true);
  // 잠겨 있어도(스크립트로) 값이 바뀐 경우를 막는다
  d.q('doc-attach-target').value = 'N-003';
  d.q('doc-attach-target').fire('change');
  d.q('doc-attach-input').value = FIX['4'];
  d.q('doc-attach-input').fire('input');
  resolveAi({ ok: false, fallback: { reason: '연결 실패·시간 초과' } });
  await p;
  await tick();
  assert.equal(d.q('doc-attach-save').disabled, true);
  assert.equal(d.q('doc-attach-stale').hidden, false);
  assert.ok(d.q('doc-attach-stale').textContent.includes('다시 읽어 주세요'));
  d.q('doc-attach-save').click();
  assert.equal(d.saved.length, 0, '이전 업무로 저장되지 않는다');
  assert.equal(!!d.q('doc-attach-target').disabled, false, '읽기가 끝나면 풀린다');
}));

test('RV-B-6 Claude 덩어리 안내(8덩어리 상한·일부 실패)가 화면에 보이고, 항목이 하나도 없어도 안내는 남는다', withDom(async () => {
  const proposal = { method: 'claude_api', nodes: [], edges: [], unread: [], notes: ['문서가 길어 앞의 8덩어리(전체 12덩어리)만 보냈습니다', '3덩어리 중 1덩어리는 읽지 못했습니다(키가 맞지 않음) — 나머지 결과만 보입니다'] };
  const d = openDialog({ aiReady: true, readAi: async () => ({ ok: true, proposal, dropped: [], chunks: 8, failed: [], model: 'm' }) });
  d.q('doc-attach-input').value = FIX['2'];
  await d.q('doc-attach-ai').fire('click');
  await tick();
  await tick();
  const notes = d.all('doc-attach-ai-note-').map((e) => e.textContent);
  assert.equal(notes.length, 2);
  assert.ok(notes[0].includes('8덩어리') && notes[1].includes('읽지 못했습니다'));
}));

test('RV-B-10·11 읽지 못한 줄은 50줄까지 「외 n줄」, 머리줄은 찾았는데 행을 하나도 못 읽으면 다른 문구', withDom(async () => {
  const d = openDialog();
  d.q('doc-attach-input').value = table(...Array.from({ length: 60 }, (_, i) => `깨진 줄 ${i}번 가나다`));
  d.q('doc-attach-read').click();
  assert.equal(d.all('doc-attach-unread-').filter((e) => /^doc-attach-unread-\d+$/.test(e.dataset.testid)).length, 50);
  assert.equal(d.q('doc-attach-unread-more').textContent, '외 10줄');
  assert.equal(d.q('doc-attach-no-table'), null);
  assert.ok(d.q('doc-attach-table-unread').textContent.includes('머리줄은 찾았지만 행을 하나도 읽지 못했습니다'));
  d.q('doc-attach-input').value = '회의록\n1. 개요\n그냥 글.';
  d.q('doc-attach-read').click();
  assert.ok(d.q('doc-attach-no-table').textContent.includes('머리줄이 있는 표를 찾지 못해'));
  assert.equal(d.q('doc-attach-table-unread'), null);
}));

test('RV-B-13 키가 없어 읽기 함수가 null이면 「키가 없습니다 — 「설정」에서 키를 넣으세요」', withDom(async () => {
  const d = openDialog({ aiReady: true, readAi: async () => null });
  d.q('doc-attach-input').value = FIX['2'];
  await d.q('doc-attach-ai').fire('click');
  await tick();
  assert.equal(d.q('doc-attach-fallback').textContent, 'Claude 읽기 실패: 키가 없습니다 — 「설정」에서 키를 넣으세요 — 규칙으로 읽은 결과를 보여 줍니다');
}));

test('RV-B-14 .txt를 읽은 글에 깨진 글자(U+FFFD)가 여러 개면 글 칸에 넣지 않고 안내', withDom(async () => {
  const d = openDialog();
  const file = d.q('doc-attach-file');
  file.files = [{ name: '옛글.txt', size: 100, text: async () => `회의록 ${'�'.repeat(5)} 내용` }];
  await file.fire('change');
  await tick();
  assert.equal(d.q('doc-attach-input').value, '');
  assert.equal(d.q('doc-attach-message').textContent, '글자가 깨졌습니다 — 파일을 UTF-8로 저장하거나 글을 복사해 붙여 넣어 주세요');
  file.files = [{ name: '정상.txt', size: 100, text: async () => '회의록 � 하나뿐' }];
  await file.fire('change');
  await tick();
  assert.ok(d.q('doc-attach-input').value.includes('하나뿐'), '한 글자는 그냥 넣는다');
}));

test('RV-B-8 화면 저장도 출처 system으로 이벤트를 남긴다', withDom(async () => {
  const app = openApp();
  const d = openDialog({ app });
  d.q('doc-attach-input').value = FIX['2'];
  d.q('doc-attach-read').click();
  const n = app.doc.events.length;
  d.q('doc-attach-save').click();
  assert.equal(d.saved.length, 1);
  assert.ok(app.doc.events.slice(n).every((e) => e.source === 'system'));
}));
