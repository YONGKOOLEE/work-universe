// 인수인계서 내려받기·인쇄용 HTML(R-19, CR-12 A, D-21)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmedBody, confirmedNameParts, escapeHtml, handoverDocHtml, handoverFileName } from '../app/src/view/handover-doc.js';

const draft = {
  title: '<script>alert(1)</script> → 받는이 인수인계 초안',
  method: 'pregen',
  items: [
    { title: '업무 개요', insufficient: false, method: 'pregen', sentences: [{ text: 'A & B "큰" <b>굵게</b>', evidence_ids: ['U-1/N-001', 'U-1/E-002'] }] },
    { title: '주의할 점', insufficient: true, sentences: [] },
    { title: '유사 경험자', insufficient: true, empty_reason: '비교했지만 해당자가 없음', sentences: [] },
    { title: '문의', insufficient: false, method: 'rule', sentences: [{ text: '문의는 가', evidence_ids: [] }] },
  ],
};
const labelOf = (g) => ({ 'U-1/N-001': '대사 확인 <업무>', 'U-1/E-002': '2026-09-01 인수인계 이력' }[g]);

test('초안: 완전한 HTML, 사용자 글 이스케이프, 스크립트·외부 파일 없음', () => {
  const h = handoverDocHtml({ kind: 'draft', draft, labelOf });
  assert.ok(h.startsWith('<!doctype html>'));
  assert.ok(h.includes('<meta charset="utf-8">') && h.includes('@page { size: A4 portrait'));
  assert.ok(!h.includes('<script') && !h.includes('<b>') && !/(src|href)=/.test(h));
  assert.ok(h.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(h.includes('A &amp; B &quot;큰&quot; &lt;b&gt;굵게&lt;/b&gt;'));
  assert.ok(h.includes('대사 확인 &lt;업무&gt;'));
});

test('초안: 이력 부족·해당 없음·항목별 생성 방식·근거 이름·끝 문장', () => {
  const h = handoverDocHtml({ kind: 'draft', draft, labelOf });
  assert.ok(h.includes('이력 부족'));
  assert.ok(h.includes('해당 없음 — 비교했지만 해당자가 없음'));
  assert.ok(h.includes('생성 방식: 사전 생성'));
  assert.ok(h.includes('<span class="chip">사전 생성</span>') && h.includes('<span class="chip">규칙 기반</span>'));
  assert.ok(h.includes('근거: 대사 확인 &lt;업무&gt; · 2026-09-01 인수인계 이력'));
  assert.equal(h.split('이력 부족').length, 2); // 해당 없음 항목에는 "이력 부족"을 붙이지 않는다
  assert.ok(h.includes('축적된 이력으로 만든 초안입니다. 담당자가 확인하고 확정하세요.'));
  assert.ok(!h.includes('<span class="chip">사전 생성</span></h2>\n<p class="muted">이력')); // 부족 항목에 방식 표시 없음
});

test('초안: 이름을 모르는 근거는 ID 글자 그대로, 지어내지 않는다', () => {
  const h = handoverDocHtml({ kind: 'draft', draft: { title: 't', method: 'rule', items: [{ title: 'x', sentences: [{ text: 's', evidence_ids: ['U-9/N-9'] }] }] }, labelOf });
  assert.ok(h.includes('근거: U-9/N-9'));
});

test('확정본: 설명 + 본문(이어서 N)을 번호 순서대로 이어 붙이고 속성을 보인다', () => {
  const node = { label: '2026-10-03 대사 확인 인수인계서', description: 'AAA', attrs: { '본문(이어서 10)': 'JJJ', '본문(이어서 2)': 'CCC', '본문(이어서 1)': 'BBB', 확정자: '사용자(이 브라우저)', '확정 시각': '2026-10-03T15:00:00+09:00', '보내는 사람': '서하늘', '받는 사람': '<윤바다>', '초안 생성 방식': '규칙 기반' } };
  assert.equal(confirmedBody(node), 'AAABBBCCCJJJ');
  const h = handoverDocHtml({ kind: 'confirmed', node });
  assert.ok(h.includes('AAABBBCCCJJJ'));
  assert.ok(h.includes('받는 사람: &lt;윤바다&gt;') && h.includes('확정 시각: 2026-10-03T15:00:00+09:00') && h.includes('초안 생성 방식: 규칙 기반'));
  assert.ok(h.includes('확인하고 확정한 인수인계서입니다'));
  assert.deepEqual(confirmedNameParts(node), { date: '2026-10-03', target: '대사 확인' });
  assert.deepEqual(confirmedNameParts({ label: '2026-10-03 대사 확인 인수인계서 (2)', attrs: {} }), { date: '2026-10-03', target: '대사 확인' });
});

test('확정본 이름 재료: 날짜를 알 수 없으면 날짜 없이 대상만', () => {
  const p = confirmedNameParts({ label: '2026-06 인수 인수인계서', attrs: {} });
  assert.deepEqual(p, { date: '', target: '2026-06 인수' });
  assert.equal(handoverFileName({ ...p, confirmed: true }), '2026-06_인수-인수인계서(확정).html');
});

test('파일 이름: 날짜-대상-인수인계서(초안|확정).html, 못 쓰는 글자는 _', () => {
  assert.equal(handoverFileName({ date: '2026-10-13', target: '대사 확인', confirmed: false }), '2026-10-13-대사_확인-인수인계서(초안).html');
  assert.equal(handoverFileName({ date: '2026-10-13', target: 'a/b:c*d?"e<f>g|h\\i', confirmed: true }), '2026-10-13-a_b_c_d_e_f_g_h_i-인수인계서(확정).html');
  assert.ok(handoverFileName({ date: 'd', target: 'x'.repeat(200), confirmed: true }).length < 100);
});

test('escapeHtml: 다섯 글자', () => {
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  assert.equal(escapeHtml(null), '');
});
