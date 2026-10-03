// 다섯 번째 검토(2026-10-03, docs/review-2026-10-03.md) — 문서 초벌 변환 규칙 보강 V-1·V-3·V-6·V-9·V-10·V-11, 결정 D3-33
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertDocument, findDate } from '../app/src/rules/doc-convert.js';
import { previewImport } from '../app/src/model/import.js';
import { validateDocument } from '../app/src/model/validate.js';

const ctx = { now: '2026-10-03T10:00:00+09:00', random: () => 0.5 };
const conv = (text) => convertDocument(text, ctx);
const byLabel = (doc, label) => doc.nodes.find((n) => n.label === label);
const works = (doc) => doc.nodes.filter((n) => n.core_type === 'work').map((n) => n.label);
const withOwner = (doc, owner = '가상 시스템분석팀') => ({ ...doc, universe: { ...doc.universe, owner } });

test('V-1: 구분 열이 있는 표에서는 「업무」 칸을 이름으로 쓰고, 같은 구분 행이 합쳐져 업무가 사라지지 않는다', () => {
  const text = [
    '# 가상 입고 관리', '- 작성 주체: 가상물류팀', '## 범위',
    '| 구분 | 업무 | 설명 |', '|---|---|---|',
    '| 일일 | 입고 접수 | 거래처 입고 요청을 받는다 |',
    '| 일일 | 검수 | 수량과 상태를 확인한다 |',
    '| 월간 | 재고 보고 | 월말 재고를 집계한다 |', '',
  ].join('\n');
  const { doc, report } = conv(text);
  assert.equal(validateDocument(withOwner(doc)).ok, true);
  assert.deepEqual(works(doc), ['입고 접수', '검수', '재고 보고']);
  assert.equal(byLabel(doc, '검수').description, '구분: 일일 — 수량과 상태를 확인한다');
  assert.ok(report.notes.some((n) => n.code === 'C-TABLE-NAME-COL' && n.col === 2));
  // 머리글이 「업무 | 설명」이면 첫 칸 그대로, 알림 없음
  const plain = conv(['# 가상 입고 관리', '- 작성 주체: 가상물류팀', '## 범위', '| 업무 | 설명 |', '|---|---|', '| 입고 접수 | 요청을 받는다 |', '| 검수 | 확인한다 |', ''].join('\n'));
  assert.deepEqual(works(plain.doc), ['입고 접수', '검수']);
  assert.ok(!plain.report.notes.some((n) => n.code === 'C-TABLE-NAME-COL'));
});

test('V-3 가: 「범위 외」·「제외 사항」 절은 범위 제외로 읽어 업무 노드를 만들지 않는다', () => {
  const text = [
    '# 가상 송금 처리', '- 작성 주체: 가상외환팀',
    '## 1. 범위', '- 송금 접수', '- 송금 실행',
    '## 2. 범위 외', '- 외화 송금', '- 수표 발행',
    '## 3. 제외 사항', '- 해외 지점 송금', '',
  ].join('\n');
  const { doc, report } = conv(text);
  assert.deepEqual(works(doc), ['송금 접수', '송금 실행']);
  assert.equal(report.sections.filter((s) => s.kind === 'scope_out').length, 2);
  assert.ok((doc.universe.description || '').includes('범위 제외: 외화 송금, 수표 발행, 해외 지점 송금'), doc.universe.description);
  assert.ok(!doc.nodes.some((n) => n.label === '외화 송금' || n.label === '해외 지점 송금'));
});

test('V-6: 작성일 표기 변형(2026.09.15 · 2026년 9월 15일 · 2026. 9. 15. · 2026/9/5)을 읽어 메모 날짜로 쓴다', () => {
  for (const [raw, want] of [['2026.09.15', '2026-09-15'], ['2026년 9월 15일', '2026-09-15'], ['2026. 9. 15.', '2026-09-15'], ['2026/9/5', '2026-09-05'], ['2026-09-15', '2026-09-15']]) {
    const text = ['# 가상 비품 관리', '- 작성 주체: 가상총무팀', '- 작성일: ' + raw, '## 범위', '- 비품 신청', '## 미확정 질문', '- 노트북 대여 한도는?', ''].join('\n');
    const { doc, report } = conv(text);
    assert.ok(!report.notes.some((n) => n.code === 'C-DATE-ASSUMED'), raw);
    const memos = doc.events.filter((e) => e.type === 'memo');
    assert.equal(memos.length, 1, raw);
    assert.equal(memos[0].occurred_at, want, raw);
  }
  assert.equal(findDate('기준: 2026-13-01'), null, '없는 달');
  assert.equal(findDate('작성일 미정'), null);
});

test('V-9: 「담당: 이름」은 목적이 아니라 사람으로 읽고, 가져오기 미리 보기가 실명·사번처럼 보이는 값을 알린다(막지 않음)', () => {
  const text = [
    '# 가상 전표 처리', '- 작성 주체: 가상회계팀', '- 담당: 홍길동', '## 범위', '- 전표 접수',
    '## 이해관계자', '| 역할 | 사번 | 하는 일 |', '|---|---|---|', '| 홍길동 | 20231234 | 전표 접수 |', '',
  ].join('\n');
  const { doc } = conv(text);
  const root = doc.nodes.find((n) => n.core_type === 'root');
  assert.ok(!(root.description || '').includes('홍길동'), '담당은 목적(설명)에 섞이지 않는다');
  const p = byLabel(doc, '홍길동');
  assert.equal(p && p.core_type, 'person');
  const preview = previewImport(withOwner(doc), { existing: [] });
  assert.equal(preview.ok, true, '알림일 뿐 막지 않는다');
  const name = preview.warnings.find((w) => w.code === 'W-REAL-NAME-LIKE');
  assert.ok(name && name.labels.includes('홍길동'));
  assert.ok(preview.warnings.some((w) => w.code === 'W-EMPNO-LIKE' && w.ids.includes(p.id)));
  // 역할 이름(…담당)만 있는 문서는 알림이 없다
  const roles = conv(['# 가상 전표 처리', '- 작성 주체: 가상회계팀', '## 범위', '- 전표 접수', '## 이해관계자', '- 회계 담당', ''].join('\n')).doc;
  assert.ok(!previewImport(withOwner(roles), { existing: [] }).warnings.some((w) => ['W-REAL-NAME-LIKE', 'W-EMPNO-LIKE'].includes(w.code)));
});

test('V-10: 「외부 감사 담당」의 외부·「내부 통제 담당」의 내부는 소속이 아니고, 「A사 결제 담당」의 A사는 소속이다', () => {
  const text = ['# 가상 감사 대응', '- 작성 주체: 가상감사팀', '## 범위', '- 자료 제출', '## 이해관계자', '- 외부 감사 담당', '- 내부 통제 담당', '- A사 결제 담당', ''].join('\n');
  const { doc } = conv(text);
  assert.equal(byLabel(doc, '외부 감사 담당').attrs.소속, undefined);
  assert.equal(byLabel(doc, '내부 통제 담당').attrs.소속, undefined);
  assert.equal(byLabel(doc, 'A사 결제 담당').attrs.소속, 'A사');
});

test('V-11: 「단계 | 내용」 표의 번호 칸은 절차에 겹쳐 넣지 않는다', () => {
  const text = ['# 가상 입고 관리', '- 작성 주체: 가상물류팀', '## 범위', '- 입고 접수', '## 업무 흐름', '| 단계 | 내용 |', '|---|---|', '| 1 | 입고 요청을 받는다 |', '| 2 | 검수한다 |', ''].join('\n');
  const { doc } = conv(text);
  const w = doc.nodes.find((n) => n.attrs && n.attrs.절차);
  assert.ok(w, '절차 속성이 어딘가에 붙는다');
  assert.equal(w.attrs.절차, '① 입고 요청을 받는다 ② 검수한다');
});

test('D3-33: 하는 일 항목이 업무 이름과 같을 때만 담당으로 잇는다("결과 승인"은 「승인」 담당이 아님)', () => {
  const text = [
    '# 가상 결재 처리', '- 작성 주체: 가상결제팀', '## 범위', '- 승인', '- 승인취소',
    '## 이해관계자', '| 역할 | 하는 일 |', '|---|---|', '| 팀장 | 결과 승인, 배치 승인취소 결재 |', '| 운영 담당 | 승인, 승인취소 |', '',
  ].join('\n');
  const { doc, report } = conv(text);
  const perf = doc.edges.filter((e) => e.core_type === 'performs');
  const op = byLabel(doc, '운영 담당').id;
  assert.deepEqual(perf.map((e) => `${e.source}>${e.target}`), [`${op}>${byLabel(doc, '승인').id}`, `${op}>${byLabel(doc, '승인취소').id}`]);
  assert.ok(report.notes.some((n) => n.code === 'C-PERFORMS-GUESS' && n.count === 2));
});
