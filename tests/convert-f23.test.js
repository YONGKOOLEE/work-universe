// F23-4(사용자 "하기", 2026-10-23): 실제 공개 문서 2건(md 변환본)에서 드러난 변환 규칙 결함. 원문은 저장소에 넣지 않고,
// 모양만 같은 가상 문서(tests/fixtures/f23/)와 짧은 사례로 시험한다. 각 규칙은 읽혀야 하는 것과 읽히면 안 되는 것을 함께 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanText, convertDocument, parseDocument, stripParens } from '../app/src/rules/doc-convert.js';
import { validateDocument } from '../app/src/model/validate.js';

const ctx = { now: '2026-10-23T10:00:00+09:00', random: () => 0.5 };
const conv = (text) => {
  const r = convertDocument(text, ctx);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  return r;
};
const fixture = (name) => readFileSync(new URL(`./fixtures/f23/${name}`, import.meta.url), 'utf8');
const labels = (doc, type) => doc.nodes.filter((n) => n.core_type === type).map((n) => n.label);
const section = (r, title) => r.report.sections.find((s) => s.title === title);
const withOwner = (doc) => ({ ...doc, universe: { ...doc.universe, owner: '가상 운영팀' } });

test('괄호 떼기: 겹괄호를 짝 맞춰 떼고, 전각도 같게, 짝 없는 괄호는 그대로', () => {
  assert.equal(stripParens('제42조(위탁받은 개인(신용)정보처리)'), '제42조');
  assert.equal(stripParens('승인（재처리（야간））'), '승인');
  assert.equal(stripParens('예외 (추가 협의) 목록'), '예외  목록');
  assert.equal(stripParens('정산 (미완'), '정산 (미완');
});

test('링크·HTML 태그: 목차 링크와 주소 링크는 글자만, [가정]·[미확인] 뒤 괄호 글과 <별표 1>은 그대로', () => {
  assert.equal(cleanText('[CHAPTER 01. 개요](#chapter-01-개요)'), 'CHAPTER 01. 개요');
  assert.equal(cleanText('[안내](https://example.invalid/a)'), '안내');
  assert.equal(cleanText('출금의뢰<br>(전산작업)'), '출금의뢰 (전산작업)');
  assert.equal(cleanText('[미확인: 담당](확인 필요)'), '[미확인: 담당](확인 필요)');
  assert.equal(cleanText('<별표 1> 통장 기재'), '<별표 1> 통장 기재');
});

test('목차 절은 노드로 만들지 않는다. 「목차 정리 업무」처럼 낱말만 든 제목은 목차가 아니다', () => {
  const r = conv('# 가상 업무\n\n## 목차\n\n- [1. 개요](#1-개요)\n- [2. 범위](#2-범위)\n\n## 목차 정리 업무\n\n- 가상 목차 갱신\n');
  assert.ok(!labels(r.doc, 'topic').includes('목차'));
  assert.equal(section(r, '목차').kind, 'toc');
  assert.ok(labels(r.doc, 'topic').includes('목차 정리 업무'));
});

test('장 제목 아래 하위 절 제목만 늘어놓은 목록은 건너뛰고, 문장이 있거나 하위 절과 겹치지 않으면 주제로 둔다', () => {
  const outline = conv('# 가상 안내\n\n## 1장. 한눈에\n\n1. 가상 대상 기관\n2. 가상 대상\n\n### 1.1 가상 대상 기관\n\n가상 내용입니다.\n');
  assert.equal(section(outline, '1장. 한눈에').kind, 'outline');
  assert.ok(!labels(outline.doc, 'topic').includes('1장. 한눈에'));
  assert.ok(labels(outline.doc, 'topic').includes('가상 대상 기관'));
  // 문장이 섞이면 목록이 아니다
  const prose = conv('# 가상 안내\n\n## 1장. 한눈에\n\n이 장은 가상 서비스를 설명합니다.\n1. 가상 대상 기관\n\n### 1.1 가상 대상 기관\n\n가상 내용입니다.\n');
  assert.ok(labels(prose.doc, 'topic').includes('1장. 한눈에'));
  // 하위 절 제목과 겹치는 줄이 없으면 목록이 아니다
  const other = conv('# 가상 안내\n\n## 1장. 한눈에\n\n- 가상 조회\n- 가상 등록\n\n### 1.1 가상 대상 기관\n\n가상 내용입니다.\n');
  assert.ok(labels(other.doc, 'topic').includes('1장. 한눈에'));
  // 하위 절이 없으면 목록이 아니다
  const leaf = conv('# 가상 안내\n\n## 가상 유의\n\n- 가상 대상 기관\n');
  assert.ok(labels(leaf.doc, 'topic').includes('가상 유의'));
});

test('「참여 주체 | 역할」 표: 주체 칸이 역할 노드 이름, 역할 칸은 설명', () => {
  const r = conv('# 가상 안내\n\n## 참여 주체\n\n| 주체 | 역할 |\n|---|---|\n| **가상 이용기관** | 자금 수납 |\n| 가상결제원 | 중계 운영 |\n');
  assert.deepEqual(labels(r.doc, 'person'), ['가상 이용기관', '가상결제원']);
  assert.equal(r.doc.nodes.find((n) => n.label === '가상결제원').description, '중계 운영');
  // 「역할 | 담당 업무」 표는 전처럼 역할 칸이 이름
  const old = conv('# 가상 안내\n\n## 이해관계자\n\n| 역할 | 담당 업무 |\n|---|---|\n| 가상 정산 담당 | 대사 |\n');
  assert.deepEqual(labels(old.doc, 'person'), ['가상 정산 담당']);
});

test('조문 제목은 괄호 안까지 이름이고(겹괄호 포함), 조문이 아닌 제목의 괄호는 전처럼 뗀다', () => {
  const r = conv('# 가상 세칙\n\n## 제1조(목적)\n\n가상 목적이다.\n\n## 제42조(위탁받은 개인(신용)정보처리)\n\n가상 처리이다.\n\n## 제3조의2 (자료 보관)\n\n가상 보관이다.\n\n## 4.1 가상 예외 (추가 협의)\n\n- 가상 예외 항목\n');
  const t = labels(r.doc, 'topic');
  assert.ok(t.includes('제1조(목적)'));
  assert.ok(t.includes('제42조(위탁받은 개인(신용)정보처리)'));
  assert.ok(t.includes('제3조의2 (자료 보관)'));
  assert.ok(t.includes('가상 예외'));
  assert.ok(!t.some((x) => /정보처리\)$/.test(x) && !x.startsWith('제42조(')));
  // 조문 이름은 괄호를 설명 머리에 되풀이하지 않는다
  assert.ok(!String(r.doc.nodes.find((n) => n.label === '제1조(목적)').description).startsWith('(목적)'));
});

test('역할 절의 문장은 사람 노드가 아니라 그 절의 주제 설명으로, 짧은 역할 이름과 「키: 값」은 전처럼 역할', () => {
  const r = conv('# 가상 업무\n\n## 담당자\n\n- 가상 참가기관은 담당 부서와 책임자를 선임하여야 한다.\n- 가상 정산 담당\n- 가상 보안 담당 [미확인: 이름]\n- 가상 운영 담당: 일일 점검\n');
  assert.deepEqual(labels(r.doc, 'person'), ['가상 정산 담당', '가상 보안 담당', '가상 운영 담당']);
  const topic = r.doc.nodes.find((n) => n.core_type === 'topic' && n.label === '담당자');
  assert.ok(topic && topic.description.includes('선임하여야 한다'));
  assert.ok(r.report.notes.some((n) => n.code === 'C-PEOPLE-PROSE' && n.count === 1));
  // 아주 긴 줄도 이름이 아니다(마침표가 없어도)
  const long = conv(`# 가상 업무\n\n## 역할\n\n- ${'가상 업무 담당 부서 및 책임자 지정과 변경 사항 통지 절차 운영 '.repeat(2)}\n`);
  assert.equal(labels(long.doc, 'person').length, 0);
});

test('구분선(---, ***)은 내용이 아니고, 표의 |---| 구분 줄은 그대로 표 머리글을 만든다', () => {
  const p = parseDocument('# 가상\n\n## 가상 산출물\n\n- 가상 보고서\n\n---\n\n***\n\n| 산출물 | 형식 |\n|---|---|\n| 가상 결과표 | 엑셀 |\n');
  const blocks = p.sections[0].blocks;
  assert.ok(!blocks.some((b) => b.text === '---' || b.text === '***'));
  assert.deepEqual(blocks.find((b) => b.kind === 'table').header, ['산출물', '형식']);
  const r = conv('# 가상\n\n## 가상 산출물\n\n- 가상 보고서\n\n---\n');
  assert.ok(!r.report.notes.some((n) => n.code === 'C-NO-NAME'));
});

test('모양만 같은 가상 업무 설명자료: 목차·장 목록이 주제가 되지 않고, 참여 주체가 역할로, 유효한 문서', () => {
  const r = conv(fixture('explainer.md'));
  const t = labels(r.doc, 'topic');
  assert.ok(!t.some((x) => /목차|CHAPTER 01|CHAPTER 02/.test(x)), t.join(', '));
  assert.deepEqual(labels(r.doc, 'person'), ['가상 이용기관', '가상 고객', '가상결제원', '가상 참가은행 (주거래)']);
  assert.ok(t.includes('출금이체') && t.includes('입금이체'));
  const steps = r.doc.nodes.find((n) => n.core_type === 'work').attrs.절차;
  assert.ok(steps.includes('(전산작업 및 전송)') && !steps.includes('<br>'));
  assert.equal(validateDocument(withOwner(r.doc)).ok, true);
});

test('모양만 같은 가상 규정: 조문 이름이 살아 있고, 담당 조문의 문장은 사람이 되지 않는다', () => {
  const r = conv(fixture('rules.md'));
  const t = labels(r.doc, 'topic');
  for (const x of ['제1조(목적)', '제2조 (용어의 정의)', '제42조(위탁받은 개인(신용)정보처리)', '제3조의2 (자료 보관)', '제9조(담당자의 선임)']) assert.ok(t.includes(x), x);
  assert.deepEqual(labels(r.doc, 'person'), ['가상 총괄 담당', '가상 운용 담당']);
  assert.equal(validateDocument(withOwner(r.doc)).ok, true);
});

// 나란히 재검증(2026-10-23)에서 나온 회귀 R1~R10: 옛 판과 같게(또는 더 낫게) 남아야 한다
const H = '# 가상 시험 업무\n\n- 작성 주체: 가상시험팀\n- 작성일: 2026-09-01\n\n';
const S = '## 범위\n\n- 가상 접수\n- 가상 처리\n\n';

test('R1 목차 아래로 이어지는 본문 절은 목차가 아니다(# 목차 아래 ##, 일반 글 【목차】 아래 번호 제목)', () => {
  const md = conv(`${H}# 목차\n\n- [1. 범위](#1-범위)\n\n## 1. 범위\n\n- 가상 접수\n\n## 2. 보안\n\n- 가상 암호화 적용\n`);
  assert.deepEqual(labels(md.doc, 'work'), ['가상 접수']);
  assert.ok(labels(md.doc, 'topic').includes('보안'));
  const plain = conv('가상 시험 업무\n작성 주체: 가상시험팀\n【목차】\n1. 범위\n  - 가상 접수\n2. 보안\n  - 가상 암호화 적용\n');
  assert.deepEqual(labels(plain.doc, 'work'), ['가상 접수']);
});

test('R2 「주체」 계열은 제목 전체일 때만 역할 절: 개요·범위·정보주체·주체적·주체별·참여자 교육은 전과 같다', () => {
  const ov = conv(`${H}## 1. 개요 및 추진 주체\n\n| 항목 | 내용 |\n|---|---|\n| 업무명 | 가상 대사 |\n| 범위 | 가상 접수, 가상 처리 |\n`);
  assert.equal(ov.doc.nodes[0].label, '가상 대사');
  assert.deepEqual(labels(ov.doc, 'work'), ['가상 접수', '가상 처리']);
  const sc = conv(`${H}## 2. 업무 범위 및 참여 기관\n\n- 가상 접수\n- 가상 처리\n`);
  assert.deepEqual(labels(sc.doc, 'work'), ['가상 접수', '가상 처리']);
  for (const title of ['5. 정보주체의 권리', '주체적 대응 방안', '처리 주체별 책임', '4. 참여자 교육', '작성 주체']) {
    const r = conv(`${H}${S}## ${title}\n\n- 가상 열람 요구\n- 가상 정지 요구\n`);
    assert.equal(labels(r.doc, 'person').length, 0, title);
  }
  for (const title of ['참여 주체', '참여 기관', '참여자', '업무 주체']) {
    const r = conv(`${H}## ${title}\n\n- 가상사\n`);
    assert.deepEqual(labels(r.doc, 'person'), ['가상사'], title);
  }
});

test('R3 하위 절 제목과 부분만 겹치거나 일부만 같은 주제 절은 건너뛰지 않는다(장 제목이 아니면)', () => {
  const partial = conv(`${S}## 4. 보안\n\n- 접근 통제\n- 가상 암호화 적용\n\n### 4.1 접근 통제 상세\n\n- 가상 계정 잠금은 5회 실패 시 적용한다.\n`);
  assert.ok(partial.doc.nodes.find((n) => n.label === '보안').description.includes('가상 암호화 적용'));
  const half = conv(`${S}## 5. 보안\n\n- 가상 암호화\n- 가상 접근 통제\n\n### 5.1 가상 암호화\n\n가상 키는 매년 바꾼다.\n`);
  assert.ok(half.doc.nodes.find((n) => n.label === '보안').description.includes('가상 접근 통제'));
  // 모든 줄이 하위 절 제목과 같으면 장 제목이 아니어도 건너뛴다
  const all = conv(`${S}## 6. 가상 안내\n\n- 가상 조회\n\n### 6.1 가상 조회\n\n가상 조회 방법이다.\n`);
  assert.ok(!labels(all.doc, 'topic').includes('가상 안내'));
});

test('R4 사람 표: 「기관 | 담당자」 「기관명 | 역할」은 전처럼 담당자·역할 칸이 이름, 「구분 | 주체 | 역할」은 주체 칸', () => {
  const a = conv(`${S}## 이해관계자\n\n| 기관 | 담당자 | 하는 일 |\n|---|---|---|\n| 가상사 | 가상 운영 담당 | 가상 접수 |\n`);
  assert.deepEqual(labels(a.doc, 'person'), ['가상 운영 담당']);
  assert.ok(a.doc.edges.some((e) => e.core_type === 'performs'));
  const b = conv(`${S}## 이해관계자\n\n| 기관명 | 역할 |\n|---|---|\n| 가상사 | 가상 운영 담당 |\n`);
  assert.deepEqual(labels(b.doc, 'person'), ['가상 운영 담당']);
  const c = conv(`${S}## 참여 주체\n\n| 구분 | 주체 | 역할 |\n|---|---|---|\n| 1 | 가상사 | 중계 |\n`);
  assert.deepEqual(labels(c.doc, 'person'), ['가상사']);
});

test('R5 탭 표의 「---⇥---」 줄은 구분선이 아니라 표 구분 줄이다', () => {
  const r = conv(`${H}## 범위\n\n업무명\t담당\n---\t---\n가상 접수\t운영 담당\n가상 처리\t정산 담당\n`);
  assert.deepEqual(labels(r.doc, 'work'), ['가상 접수', '가상 처리']);
});

test('R6 역할 절: 「이름 — 설명」은 역할, 짧은 줄의 끝 마침표만으로는 문장이 아니다', () => {
  const r = conv(`${S}## 역할\n\n- 가상 정산 담당 — 매월 대사를 한다.\n- 가상 접수 담당 - 가상 접수\n- 가상 운영 담당.\n- 가상 보조 담당 등.\n`);
  assert.deepEqual(labels(r.doc, 'person'), ['가상 정산 담당', '가상 접수 담당', '가상 운영 담당.', '가상 보조 담당 등.']);
  assert.ok(r.doc.edges.some((e) => e.core_type === 'performs'));
});

test('R7 태그가 아닌 꺾쇠 글(a<b 이고 c>d, <p 95>, <u+0041>, <가상값>)은 지우지 않는다', () => {
  for (const t of ['a<b 이고 c>d', '<p 95> 미만', '<u+0041> 문자', '<가상값> 이하']) assert.equal(cleanText(t), t);
  assert.equal(cleanText('x<b>y</b>z'), 'x y z');
  assert.equal(cleanText('<td colspan="2">가상</td>'), '가상');
});

test('R8 링크 모양의 [가정]·[미확인] 표시는 그대로, 주소에 괄호가 든 링크는 글자만', () => {
  assert.equal(cleanText('[미확인](#note-1) 적용'), '[미확인](#note-1) 적용');
  assert.equal(cleanText('[가정: 연 1회](./a.md)'), '[가정: 연 1회](./a.md)');
  assert.equal(cleanText('[가상 안내](http://example.invalid/a_(b)) 참고'), '가상 안내 참고');
  const r = conv(`${S}## 가상 보안\n\n| 항목 | 내용 |\n|---|---|\n| 가상 암호 | [미확인](#note-1) 적용 |\n`);
  assert.equal(r.doc.nodes.find((n) => n.label === '가상 보안').attrs.상태, '미확인');
});

test('R9 짝이 모자란 겹괄호 제목은 옛 규칙처럼 여는 괄호부터 뗀다', () => {
  assert.equal(stripParens('가상 보안 (추가(협의)').trim(), '가상 보안');
  const r = conv(`${S}## 가상 보안 (추가(협의)\n\n- 가상 메모\n\n## (가상 (참고)\n\n- 가상 메모3\n`);
  assert.ok(labels(r.doc, 'topic').includes('가상 보안'));
  assert.ok(labels(r.doc, 'topic').includes('가상 참고'));
});

test('R10 역할 절 아래 괄호뿐인 제목(「(참고)」)의 문장은 괄호 안 글자 이름의 주제로 남는다', () => {
  const r = conv(`${S}## 역할\n\n- 가상 운영 담당\n\n### (참고)\n\n가상 담당자는 매일 점검한다.\n`);
  const t = r.doc.nodes.find((n) => n.core_type === 'topic' && n.label === '참고');
  assert.ok(t && t.description.includes('매일 점검한다'));
  assert.ok(r.report.notes.some((n) => n.code === 'C-TOPIC-GUESS'));
});
