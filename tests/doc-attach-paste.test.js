// 문서로 더하기: PDF에서 복사해 붙인 글(쪽 머리글·줄바꿈이 끊긴 문장·칸이 한 줄씩 떨어진 표)을 읽는 시험.
// 자료: tests/fixtures/doc-attach/pdf-paste/(실제 붙여 넣기 원문, 가상 문서). 실제 입력 모양이 바뀌면 이 시험을 새 원문에 맞춰 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAMPLES } from '../app/data/index.js';
import { ownersOf, readDocumentRule, splitDocument } from '../app/src/rules/doc-attach.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'doc-attach');
const rd = (...p) => fs.readFileSync(path.join(DIR, ...p), 'utf8');
const PASTE16 = rd('pdf-paste', 'paste-2016회의록.txt');
const PASTE_MANUAL = rd('pdf-paste', 'paste-월정산매뉴얼.txt');
const TODAY = '2026-10-28';
const read = (text) => readDocumentRule(text, { doc: JSON.parse(JSON.stringify(SAMPLES.find((d) => d.universe.id === 'U-A1'))), targetId: 'N-001', today: TODAY }).plan;

/** 줄을 width자 근처의 공백에서 강제로 줄바꿈한다(PDF 복사처럼 문장이 중간에서 끊긴다) */
const wrap = (text, width = 60) => text.split('\n').flatMap((line) => {
  if (line.length <= width) return [line];
  const out = [];
  let cur = '';
  for (const w of line.split(' ')) {
    if (cur && (cur + ' ' + w).length > width) { out.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) out.push(cur);
  return out;
}).join('\n');

test('H2-⑥ 붙여 넣은 2016 회의록: 쪽 머리글·쪽 번호 제거, 세로 표 1행만 읽고 나머지는 읽지 못한 줄, 이슈 메모는 문장 2건(표 칸 조각 없음)', () => {
  const p = read(PASTE16);
  assert.equal(p.title, '2016년 문자메시지 발송 수수료 조정 회의록');
  assert.deepEqual(p.tasks.map((t) => [t.label, t.owners.map((o) => o.label), t.due.value]), [['고객 안내문·FAQ 배포', ['영업기획', '고객지원'], '2016-11-30']]);
  assert.deepEqual(p.unread.map((u) => u.text).slice(0, 3), ['계약변경 대상 분류 및 동의 수령', '요금버전·정산 테스트', '인상 후 이탈률·민원 모니터링']);
  const issues = p.memos.filter((m) => m.category === 'issue');
  assert.equal(issues.length, 2, issues.map((m) => m.text).join('\n'));
  assert.ok(issues[0].text.startsWith('대형 고객의 할인 유지 기간 및 월별 최저이용금액은 개별 계약 심의에서 확정한다.'));
  assert.ok(issues[1].text.startsWith('발송 성공 판정 기준과 통신망 장애 환불 기준은 기술 검증 후 별도 공지한다'));
  for (const w of ['영업기획', '개발운영/재무정산', '서비스사업', '2016. 12. 20.', '2017. 3월 말']) assert.ok(p.unread.some((u) => u.text === w), `읽지 못한 줄: ${w}`);
  assert.ok(!JSON.stringify(p).includes('가상 업무기록'), '쪽 머리글은 어디에도 남지 않는다');
});

test('H2-⑥ 붙여 넣은 월정산 매뉴얼: 제목·할 일 0·메모 0(붙어 버린 가로 표가 이상한 항목을 만들지 않는다)', () => {
  const p = read(PASTE_MANUAL);
  assert.equal(p.title, '문자메시지 발송 서비스 월정산 업무매뉴얼');
  assert.deepEqual([p.tasks.length, p.memos.length], [0, 0]);
  assert.ok(!JSON.stringify(p).includes('가상 업무기록'));
});

test('H2-⑥ 끊긴 줄 이어 붙이기: 매뉴얼 앞부분의 세 줄이 한 문단으로, 표 칸처럼 짧은 줄·절 제목·번호·날짜 줄 앞에서는 잇지 않는다', () => {
  const t = '월정산 매뉴얼\n1. 목적\n본 매뉴얼은 A사 문자메시지 발송 서비스의 이용실적 집계부터 이용기관 청구, 확인, 자동이체 수납, 미납·연체금 관리,\n정정·환불, 마감 및 감사증적 보존까지의 표준 절차를 규정한다. 대상은 후불 월정산 이용기관이며 선불 충전형 고객은\n별도 기준을 따른다\n2. 정책\n짧은 칸\n다른 칸\n미결 사항\n';
  const s = splitDocument(t).sections;
  assert.equal(s[1].lines.length, 1);
  assert.ok(s[1].lines[0].includes('관리, 정정·환불') && s[1].lines[0].endsWith('별도 기준을 따른다'));
  assert.deepEqual(s[2].lines, ['짧은 칸', '다른 칸', '미결 사항']);
  const items = splitDocument('제목\n1. 절\n이 줄은 서른 글자를 넘기도록 일부러 길게 써 둔 끝나지 않는 줄입니다 계속\n① 번호 줄\n2016. 12. 20.\n').sections[1].lines;
  assert.equal(items.length, 3, JSON.stringify(items));
});

test('H2-⑥ 약 60자 폭으로 강제 줄바꿈한 문서는 줄바꿈 전과 같은 제목·절·메모 수가 나온다(2016 회의록 픽스처, 붙여 넣은 원문, 매뉴얼)', () => {
  for (const [name, text] of [['2016 픽스처', rd('1_2016회의록.txt')], ['붙여 넣은 2016', PASTE16], ['매뉴얼 픽스처', rd('3_월정산매뉴얼.txt')], ['메모 픽스처', rd('4_가상커머스메모.txt')]]) {
    const a = read(text);
    const b = read(wrap(text));
    assert.equal(b.title, a.title, name);
    assert.deepEqual(b.sections.memos, a.sections.memos, name);
    assert.deepEqual(b.sections.skipped, a.sections.skipped, name);
    assert.equal(b.memos.length, a.memos.length, `${name} 메모 수 ${a.memos.length} → ${b.memos.length}`);
  }
});

test('H2-⑥ 쪽 번호만 있는 줄 다음의 쪽 머리글(「1」⏎「A사 … | 가상 업무기록」)은 숫자가 붙은 꼴이어도 제목이 되지 않는다', () => {
  const head = 'A사 메시징 서비스 | 가상 업무기록';
  const body = rd('3_월정산매뉴얼.txt').split('\n');
  const text = ['1', head, ...body.slice(0, 10), '2', head, ...body.slice(10)].join('\n');
  assert.equal(read(text).title, '문자메시지 발송 서비스 월정산 업무매뉴얼');
  assert.equal(read([`${head}1`, ...body].join('\n')).title, '문자메시지 발송 서비스 월정산 업무매뉴얼');
});

test('H2 담당 이름이 「다」로 끝나도(윤바다) 읽는다: 동사 끝맺음만 거절, 지도에 있는 이름은 늘 받는다 — 데모 회의록 고정', () => {
  const p = read(rd('demo-대사확인.txt'));
  assert.deepEqual(p.tasks.map((t) => [t.label, t.owners.map((o) => [o.label, !!o.match])]), [
    ['불일치 원인 코드표 정리', [['서하늘', true]]],
    ['대사 결과 이중 확인 절차 마련', [['윤바다', true]]],
  ]);
  assert.equal(p.memos.filter((m) => m.category === 'issue').length, 1);
  assert.equal(p.memos.filter((m) => m.category === 'caution').length, 1);
  assert.equal(ownersOf('검토한다'), null);
  assert.deepEqual(ownersOf('윤바다', new Set(['윤바다'])), ['윤바다']);
  assert.equal(ownersOf('진행했다', new Set(['윤바다'])), null);
});
