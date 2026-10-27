// 조력자 문서(2026-10-28)에서 나온 변환 결함: PDF에서 복사한 매뉴얼의 줄글·공백 표가 업무·사람이 되던 것, 날짜 줄 안의 「작성부서」를 못 읽던 것.
// 문서 붙여넣기 탭에서 PDF·한글·워드 파일을 고르면 읽지 않고 안내하는 판정도 함께 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertDocument } from '../app/src/rules/doc-convert.js';
import { BINARY_DOC, noteText } from '../app/src/ui/import.js';

const ctx = { now: '2026-10-28T09:00:00+09:00', random: () => 0.5 };
const labels = (r, type) => r.doc.nodes.filter((n) => n.core_type === type).map((n) => n.label);

const MANUAL = `가상 발송 서비스 월정산 업무매뉴얼
1. 목적 및 적용 범위
본 매뉴얼은 가상 발송 서비스의 이용실적 집계부터 이용기관 청구, 확인, 자동이체 수납, 미납·연체금 관리, 정정·환불까지의 표준 절차를 규정한다. 선불 고객은 별도 기준을 따른다.
2. 기본 정책 및 역할
항목 가상 운영 기준
정산기간 매월 1일 00:00~말일 23:59, 한국시간
청구대상 발송 성공으로 확정된 유료 메시지. 실패·취소·중복과금은 제외
납부기한 익월 20일, 휴일이면 다음 영업일
수납방식 사전 출금동의가 등록된 계좌에서 CMS 자동이체
가상사업팀은 단가 승인을, 가상정산팀은 청구를 담당한다.
3. 월간 정산 일정
익월 1~2영업일 발송 원장 집계`;

test('조력자 문서: 「목적 및 적용 범위」 줄글은 쉼표마다 끊어 업무로 만들지 않고 주제 설명으로', () => {
  const r = convertDocument(MANUAL, ctx);
  assert.equal(r.ok, true);
  const works = labels(r, 'work');
  assert.equal(works.length, 1, works.join(' / ')); // 범위가 없으니 문서 이름으로 업무 하나
  assert.ok(!works.some((w) => /확인|자동이체 수납|규정한다/.test(w)), works.join(' / '));
  const topic = r.doc.nodes.find((n) => n.core_type === 'topic' && n.label === '목적 및 적용 범위');
  assert.ok(topic && topic.description.includes('표준 절차를 규정한다'));
  const note = r.report.notes.find((n) => n.code === 'C-SCOPE-PROSE');
  assert.ok(note && note.count === 1);
  assert.match(noteText(note), /업무로 나누지 않고/);
});

test('조력자 문서: 「기본 정책 및 역할」의 공백 표 줄(날짜·시각·금액, 긴 줄, 머리글)은 사람이 되지 않는다', () => {
  const r = convertDocument(MANUAL, ctx);
  const people = labels(r, 'person');
  assert.deepEqual(people, [], people.join(' / '));
  const topic = r.doc.nodes.find((n) => n.core_type === 'topic' && n.label === '기본 정책 및 역할');
  assert.ok(topic && topic.description.includes('정산기간 매월 1일') && topic.description.includes('항목 가상 운영 기준'));
});

test('역할 절의 이름 줄은 그대로 사람(괄호 속 사번·짧은 역할 이름은 막지 않는다)', () => {
  const r = convertDocument(`가상 업무
1. 개요
- 범위: 가상 대사
2. 역할
- 가상 정산 담당
- 서하늘(V-1003)
- 가상 카드사: 승인 자료 제공`, ctx);
  const people = labels(r, 'person');
  assert.ok(people.includes('가상 정산 담당') && people.some((p) => p.startsWith('서하늘')) && people.includes('가상 카드사'), people.join(' / '));
});

test('조력자 문서: 「작성일: … | 작성부서: …팀 | 이력번호: …」 줄에서 작성 주체와 작성일을 함께 읽는다', () => {
  const r = convertDocument(`[업무 히스토리 메모 / 가상 사례]
제목: 가상 프로모션
작성일: 2026. 10. 27. | 작성부서: 가상 메시징사업팀 | 이력번호: MSG-PROMO-0000-017

1. 배경
가상 글이다.`, ctx);
  assert.equal(r.doc.universe.owner, '가상 메시징사업팀');
  assert.ok(!r.report.notes.some((n) => n.code === 'C-NO-OWNER'));
  assert.ok(!r.report.notes.some((n) => n.code === 'C-DATE-ASSUMED'));
});

test('작성부서 칸이 없는 날짜 줄은 작성 주체를 만들지 않는다(입력받기 그대로)', () => {
  const r = convertDocument(`가상 회의록
작성일: 2026. 10. 27. | 문서번호: 7
1. 배경
가상 글이다.`, ctx);
  assert.ok(!r.doc.universe.owner);
  assert.ok(r.report.notes.some((n) => n.code === 'C-NO-OWNER'));
});

test('문서 붙여넣기 탭: PDF·한글·워드 파일은 글자로 읽지 않는다', () => {
  for (const f of ['회의록.pdf', '매뉴얼.HWP', 'a.hwpx', 'b.docx', 'c.doc']) assert.ok(BINARY_DOC.test(f), f);
  for (const f of ['문서.md', '문서.txt', 'a.markdown', 'pdf설명.txt']) assert.ok(!BINARY_DOC.test(f), f);
});
