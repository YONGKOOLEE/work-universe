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

// ── 재검증(같은 날, 수정분의 회귀 확인)에서 나온 사례 ──
const doc1 = (lines) => conv(['# 가상 시험 업무', '- 작성 주체: 가상시험팀', ...lines, ''].join('\n'));

test('재검증 1: 「장비 범위」·「준비 범위」는 범위(업무)이고, 「수수료 제외 기준」·「대상 외부 기관 연계」는 주제다(범위 제외 오탐 없음)', () => {
  for (const title of ['장비 범위', '준비 범위']) {
    const { doc, report } = doc1(['## ' + title, '- 서버 점검', '- 망 점검']);
    assert.deepEqual(works(doc), ['서버 점검', '망 점검'], title);
    assert.ok(!report.notes.some((n) => n.code === 'C-NO-SCOPE'), title);
  }
  for (const title of ['수수료 제외 기준', '대상 외부 기관 연계', '예외 처리']) {
    const { doc, report } = doc1(['## 범위', '- 정산', '## ' + title, '- 10만원 미만은 다루지 않는다']);
    assert.ok(doc.nodes.some((n) => n.core_type === 'topic' && n.label === title), title);
    assert.ok(!report.sections.some((s) => s.kind === 'scope_out'), title);
  }
  for (const title of ['범위 외', '범위 제외', '제외 사항', '제외 대상 업무', '비범위', '적용 대상 외', '제외']) {
    const { doc, report } = doc1(['## 범위', '- 정산', '## ' + title, '- 외화 송금']);
    assert.deepEqual(works(doc), ['정산'], title);
    assert.equal(report.sections.filter((s) => s.kind === 'scope_out').length, 1, title);
  }
});

test('재검증 2: 3칸 이상 역할 표에서도 「하는 일」 칸으로 담당을 잇고, 괄호·끝 구두점은 떼고 비교한다', () => {
  const { doc } = doc1([
    '## 범위', '- 입고 접수', '- 검수', '- 승인',
    '## 이해관계자', '| 역할 | 하는 일 | 연락처 |', '|---|---|---|',
    '| 운영 담당 | 입고 접수 | 내선 1234(가상) |', '| 품질 담당 | 검수. | 내선 1235(가상) |', '| 팀장 | 승인(1차), 결과 승인 | 내선 1200(가상) |',
  ]);
  const label = (id) => doc.nodes.find((n) => n.id === id).label;
  assert.deepEqual(doc.edges.filter((e) => e.core_type === 'performs').map((e) => label(e.source) + '→' + label(e.target)), ['운영 담당→입고 접수', '품질 담당→검수', '팀장→승인']);
  // 소속 칸이 앞에 있는 표
  const b = doc1(['## 범위', '- 입고 접수', '## 이해관계자', '| 소속 | 역할 | 하는 일 |', '|---|---|---|', '| 가상물류팀 | 운영 담당 | 입고 접수 |']).doc;
  assert.equal(b.edges.filter((e) => e.core_type === 'performs').length, 1);
});

test('재검증 3: 버전·금액·전화번호·없는 날짜는 날짜로 읽지 않는다', () => {
  // 금액·개수 단위로 가려내는 조건은 3차 검증 뒤 뺐다(낱말·조사와 구분 불가, 세 부분으로 된 수는 금액 표기가 아님 — findDate 주석)
  for (const t of ['v2026.1.2', 'V2026.1.2', '전화 02-2026-1-23', '12026-09-15', '2026-9-150', '2026.2.31', '2026.13.01', '26.09.15', '2026-09', '1.2.3', '2026.5만원', '20260915', 'A-2026-09-15']) {
    assert.equal(findDate(t), null, t);
  }
  assert.equal(findDate('2025.12 ~ 2026.1.15'), '2026-01-15');
  assert.equal(findDate('작성 2026년 10월 3일(토)'), '2026-10-03');
  assert.equal(findDate('없는 날 2026.2.31, 실제 작성일 2026.3.2'), '2026-03-02');
  // 제목에 버전 번호가 있어도 메모 날짜는 변환한 날 + 알림
  const { doc, report } = conv(['# 가상 시험 업무 v2026.1.2', '- 작성 주체: 가상시험팀', '## 범위', '- 정산', '## 미확정 질문', '- 한도는?', ''].join('\n'));
  assert.ok(report.notes.some((n) => n.code === 'C-DATE-ASSUMED'));
  assert.equal(doc.events.find((e) => e.type === 'memo').occurred_at, '2026-10-03');
  assert.equal(validateDocument(withOwner(doc)).ok, true);
});

test('재검증 5: 이름 칸이 빈 행은 건너뛰고 알리며(구분 값이 업무가 되지 않음), 번호 칸은 설명에 넣지 않는다', () => {
  const { doc, report } = doc1(['## 범위', '| 구분 | 업무 | 설명 |', '|---|---|---|', '| 일일 | 입고 접수 | 받는다 |', '| 일일 |  | 이름 없는 행 |']);
  assert.deepEqual(works(doc), ['입고 접수']);
  assert.ok(report.notes.some((n) => n.code === 'C-ROW-NO-NAME' && n.row === 2));
  const b = doc1(['## 범위', '| 번호 | 업무명 | 담당 |', '|---|---|---|', '| 1 | 입고 접수 | 운영 담당 |']).doc;
  assert.equal(byLabel(b, '입고 접수').description, '운영 담당');
});

// ── 2차 재검증(커밋 bd64521 검증)에서 나온 사례 ──
test('2차 A: 날짜 뒤에 회의록·개정·원본·명세서 같은 낱말이 와도 날짜를 읽고, 금액·개수 단위로 끝나면 읽지 않는다', () => {
  for (const t of ['2026.09.15 회의록', '2026-09-15 개정', '2026.9.15 원본', '2026.09.15 건의 사항', '2026.09.15 명세서', '2026.09.15 개요', '2026.09.15 천안 교육장', '2026.09.15(화)', '2026-09-15T10:00']) {
    assert.equal(findDate(t), '2026-09-15', t);
  }
  // 뒤에 어떤 글자가 와도(조사·단위 포함) 같은 줄·다음 줄과 무관하게 읽는다
  for (const t of ['2026.09.15회의', '2026.09.15\n만원 이하는 제외', '2026.09.15 건', '기준일은 2026.09.15 원 단위']) assert.equal(findDate(t), '2026-09-15', t);
  const { report } = conv(['# 가상 시험 업무', '- 작성 주체: 가상시험팀', '- 작성일: 2026-09-15 원본 기준', '## 범위', '- 정산', ''].join('\n'));
  assert.ok(!report.notes.some((n) => n.code === 'C-DATE-ASSUMED'));
});

test('2차 B: 괄호가 든 업무 이름은 글자 그대로 같은 업무에 먼저 붙는다', () => {
  const perf = (scope, duty) => {
    const { doc } = doc1(['## 범위', ...scope.map((x) => '- ' + x), '## 이해관계자', '| 역할 | 하는 일 |', '|---|---|', '| 운영 담당 | ' + duty + ' |']);
    const label = (id) => doc.nodes.find((n) => n.id === id).label;
    return doc.edges.filter((e) => e.core_type === 'performs').map((e) => label(e.target));
  };
  assert.deepEqual(perf(['승인', '승인(재처리)', '정산'], '승인(재처리)'), ['승인(재처리)']);
  assert.deepEqual(perf(['승인(재처리)'], '승인(재처리)'), ['승인(재처리)']);
  assert.deepEqual(perf(['승인', '정산'], '승인(1차), 정산.'), ['승인', '정산']);
  // 글머리표 "역할: 하는 일"
  const { doc } = doc1(['## 범위', '- 승인(재처리)', '- 정산', '## 이해관계자', '- 운영 담당: 승인(재처리), 정산']);
  assert.equal(doc.edges.filter((e) => e.core_type === 'performs').length, 2);
  // 전각 괄호로 적어도 같은 업무(3차 3)
  assert.deepEqual(perf(['승인', '승인(재처리)'], '승인（재처리）'), ['승인(재처리)']);
  assert.deepEqual(perf(['승인', '승인（재처리）'], '승인(재처리)'), ['승인（재처리）']);
});

test('2차 C: 실장·개발자·협력사·신청자 같은 역할 낱말에는 실명 알림이 뜨지 않는다', () => {
  const { doc } = doc1(['## 범위', '- 정산', '## 이해관계자', '- 실장: 결재', '- 개발자: 화면 수정', '- 협력사: 납품', '- 신청자: 요청', '- 센터장: 보고 받음', '- 총무: 비품']);
  assert.ok(!previewImport(withOwner(doc), { existing: [] }).warnings.some((w) => w.code === 'W-REAL-NAME-LIKE'));
  const named = doc1(['## 범위', '- 정산', '## 이해관계자', '- 홍길동: 결재', '- 김철수: 요청']).doc;
  assert.deepEqual(previewImport(withOwner(named), { existing: [] }).warnings.find((w) => w.code === 'W-REAL-NAME-LIKE').labels, ['홍길동', '김철수']);
});

test('2차 D: 「비 범위」(띄어 쓴 제목)도 범위 제외다', () => {
  const { doc, report } = doc1(['## 범위', '- 정산', '## 비 범위', '- 외화 송금']);
  assert.deepEqual(works(doc), ['정산']);
  assert.equal(report.sections.filter((s) => s.kind === 'scope_out').length, 1);
});
