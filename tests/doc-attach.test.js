// CR-23 문서로 더하기: 업무 하나에 문서(회의록·매뉴얼·메모)를 붙여 지도를 키운다.
// rules/doc-attach.js(규칙 읽기·명령) · model/commands.js(applyBatch의 addMemo·addSubtype) · llm/ai-doc-attach.js(Claude 읽기, 가짜 공급자) · ui/doc-attach.js(DOM 흉내)
// 가상 문서 4개: tests/fixtures/doc-attach/ (PDF에서 복사한 글이라 표가 칸 구분 없이 공백뿐이다 — 실제 입력 모양)
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
import { editPoints } from '../app/src/model/rewind.js';
import { SUBTYPE_ROLE } from '../app/src/model/schema.js';
import {
  DOC_ATTACH_MEMO_CATEGORIES, attachNotice, buildAttachOps, dedupeAiProposal, similarName, defaultDocSelection, itemsOf, ownersOf, parseDue, planToOps, readDocumentRule, splitDocument, taskHeader,
} from '../app/src/rules/doc-attach.js';
import { AI_DOC_MAX_CHUNKS, chunkDocument, labelKeys, readDocumentAi } from '../app/src/llm/ai-doc-attach.js';
import { TEXT_LIMITS, defaultSelection } from '../app/src/rules/text-extract.js';
import { createProvider } from '../app/src/llm/providers.js';
import { createFakeClient } from '../app/src/llm/fake-client.js';
import { DOC_ATTACH_EXAMPLE } from '../app/data/doc-attach-example.js';
import { docAttachDialog } from '../app/src/ui/doc-attach.js';
import { FEATURES, featureBlock, searchFeatures } from '../app/src/view/feature-index.js';
import { actionPlan } from '../app/src/view/card.js';
import { FakeEl, installDom, uninstallDom } from './dom-stub.js';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'doc-attach');
const FIX = Object.fromEntries(fs.readdirSync(DIR).filter((f) => f.endsWith('.txt')).map((f) => [f.slice(0, 1), fs.readFileSync(path.join(DIR, f), 'utf8')]));
const FAKE_KEY = ['sk', 'ant', 'x'.repeat(8), 'FAKEKEY', 'y'.repeat(12)].join('-');
const TODAY = '2026-10-28';
const NOW = '2026-10-28T09:00:00+09:00';
const clone = (x) => JSON.parse(JSON.stringify(x));
const baseDoc = () => clone(SAMPLES.find((d) => d.universe.id === 'U-A1'));
const TARGET = 'N-001'; // 대사 확인(업무)
const MIXED = FIX['4'].replace('대형 이용기관', '정산팀은 청구 및 채권관리를 담당한다 미납 통지, 재청구 및 연체 관리 대형 이용기관'); // Claude 응답의 인용이 든 문서
const LONG = `${FIX['3']}
${FIX['2']}`; // 글로 추가 상한(4000자)보다 긴 문서: 매뉴얼 + 2026 회의록
const read = (n, doc = baseDoc(), today = TODAY) => readDocumentRule(FIX[n], { doc, targetId: TARGET, today });
const allOn = (plan) => ({ doc: true, tasks: Object.fromEntries(plan.tasks.filter((t) => !t.blocked).map((t) => [t.key, true])), memos: Object.fromEntries(plan.memos.map((m) => [m.key, true])) });
const apply = (doc, ops, now = NOW) => applyBatch(doc, ops, { now });
const names = (doc, type) => doc.nodes.filter((n) => n.core_type === type && !n.hidden).map((n) => n.label);

// ── 규칙 읽기: 가상 문서 4개 ──

test('CR-23 문서 2(2026 회의록): 문서 1·할 일 업무 5(공백뿐인 표)·담당 역할 6·메모(추적 절 → caution 2건만, 「부서별 의견 및 쟁점」은 메모 아님)', () => {
  const r = read('2');
  assert.equal(r.ok, true);
  const p = r.plan;
  assert.equal(p.doc.label, '2026년 문자메시지 발송 수수료 조정 검토 회의록');
  assert.ok(p.doc.description.startsWith('문서 날짜: 2026-10-27'), p.doc.description);
  assert.ok(p.doc.description.includes('결정: ① 기준요금을 건당 30원(부가세 별도)으로 인상하는 방향에 조건부 동의한다.'));
  assert.ok(p.doc.description.includes('④ 요금 인상 이후 3개월간'));
  assert.deepEqual(p.tasks.map((t) => [t.label, t.owners.map((o) => o.label), t.due.value]), [
    ['계약별 인상 가능 여부 검토', ['법무', '영업'], '2026-11-13'],
    ['고객별 매출 시나리오 및 손익 검증', ['재무정산'], '2026-11-20'],
    ['안내문·FAQ·개별 변경합의', ['영업', '고객지원'], '2026. 11.~2027. 1.'],
    ['요금 엔진·청구서 회귀 테스트', ['기술', '재무정산'], '2027-01-15'],
    ['최종 시행 승인 및 사후 모니터링', ['사업본부'], '2027. 1. 25. 이후'],
  ]);
  assert.deepEqual([...new Set(p.tasks.flatMap((t) => t.owners.map((o) => o.label)))], ['법무', '영업', '재무정산', '고객지원', '기술', '사업본부']);
  assert.ok(p.tasks.every((t) => !t.past), '모든 기한이 오늘(2026-10-28)·문서 날짜 뒤');
  assert.equal(p.memos.length, 2, p.memos.map((m) => m.section).join(' / '));
  assert.ok(p.memos.every((m) => m.category === 'caution'));
  const trace = p.memos.filter((m) => m.section === '추적 관리 사항');
  assert.equal(trace.length, 2);
  assert.ok(trace[0].text.startsWith('미동의 계약 수, 프로모션 잔여 고객') && trace[0].text.endsWith(' — 출처: 「2026년 문자메시지 발송 수수료 조정 검토 회의록」'), trace[0].text);
  assert.equal(trace[0].date, '2026-10-27', '메모 날짜 = 문서 날짜');
  assert.deepEqual(p.unread, []);
});

test('CR-23 문서 1(2016 회의록): 할 일 4(「2017. 3월 말」 포함, 기한 지남이라 처음 체크 해제)·7절 미결 → issue 메모', () => {
  const p = read('1').plan;
  assert.equal(p.doc.label, '2016년 문자메시지 발송 수수료 조정 회의록');
  assert.deepEqual(p.tasks.map((t) => [t.label, t.owners.map((o) => o.label), t.due.value]), [
    ['고객 안내문·FAQ 배포', ['영업기획', '고객지원'], '2016-11-30'],
    ['계약변경 대상 분류 및 동의 수령', ['영업기획'], '2016-12-20'],
    ['요금버전·정산 테스트', ['개발운영', '재무정산'], '2016-12-23'],
    ['인상 후 이탈률·민원 모니터링', ['서비스사업'], '2017. 3월 말'],
  ]);
  assert.ok(p.tasks.every((t) => t.past));
  const def = defaultDocSelection(p);
  assert.ok(Object.values(def.tasks).every((v) => v === false), '기한 지남 → 기본 체크 해제');
  assert.deepEqual(p.memos.map((m) => m.category), ['issue', 'issue']);
  assert.ok(p.memos.every((m) => m.section === '미결 사항' && m.date === TODAY)); // RV-B-4: issue 메모 날짜는 오늘(문서 날짜는 글 앞머리에)
  assert.ok(p.memos[0].text.includes('대형 고객의 할인 유지 기간') && p.memos[1].text.includes('발송 성공 판정 기준'));
  assert.ok(p.doc.description.includes('문서 날짜: 2016-11-17'));
  // 기한 지남 판정은 문서 날짜와 오늘 중 늦은 날 기준: 문서·오늘이 2016-12-01이면 12-20·12-23·2017-3월 말은 지나지 않았다
  const early = read('1', baseDoc(), '2016-12-01').plan;
  assert.deepEqual(early.tasks.map((t) => t.past), [true, false, false, false]);
});

test('CR-23 문서 3(월정산 매뉴얼): 문서 1, 할 일 표 없음(「시점 주요 작업 통제 사항」은 머리줄이 아님), 메모 0, 엉뚱한 업무 0', () => {
  const p = read('3').plan;
  assert.equal(p.doc.label, '문자메시지 발송 서비스 월정산 업무매뉴얼');
  assert.equal(p.doc.description, '', '날짜·결정·이력이 없으면 설명을 지어내지 않는다');
  assert.deepEqual(p.tasks, []);
  assert.deepEqual(p.memos, []);
  assert.deepEqual(p.unread, []);
  assert.equal(taskHeader('시점 주요 작업 통제 사항'), null);
  assert.equal(taskHeader('경과 조치 비고'), null);
  const { ops } = planToOps(p, defaultDocSelection(p), baseDoc());
  assert.deepEqual(ops.map((o) => o.op), ['addNode', 'addEdge'], '문서 항목과 참조 연결뿐');
});

test('CR-23 문서 4(프로모션 이력 메모): 제목 줄 「제목:」·대괄호 머리 정리, 설명에 작성 부서·이력 줄, 5절 「유의사항」 → caution', () => {
  const p = read('4').plan;
  assert.equal(p.doc.label, '대형 이용기관 「가상커머스」 문자발송 수수료 6개월 면제 프로모션');
  assert.ok(p.doc.description.startsWith('문서 날짜: 2026-10-27 · 작성 부서: A사 메시징사업팀'));
  assert.ok(p.doc.description.includes('이력: 2024. 2. 8.: 가상커머스 최초 제안요청 접수.'));
  assert.ok(p.doc.description.includes('2024. 11. 5.: 10월 사용분 최초 유료 청구서 발행'));
  assert.deepEqual(p.tasks, []);
  assert.deepEqual(p.memos.map((m) => [m.category, m.section]), Array(3).fill(['caution', '사후 평가 및 향후 유의사항']));
  assert.ok(p.memos[2].text.startsWith('재프로모션은 별도 승인 필수. — 출처: 「'), p.memos[2].text);
});

test('CR-23 엉뚱한 항목 0: 4개 문서 모두 문장 조각·날짜·담당이 이름이 된 업무·역할이 없다, 메모 범주는 issue·caution뿐', () => {
  for (const n of ['1', '2', '3', '4']) {
    const p = read(n).plan;
    for (const t of p.tasks) {
      assert.ok(t.label.length >= 2 && t.label.length <= 100, t.label);
      assert.ok(!/다\.?$/.test(t.label) && !/\d{4}\s*[.\-/년]/.test(t.label), `문장 조각·날짜가 이름이 됨: ${t.label}`);
      for (const o of t.owners) assert.match(o.label, /^[가-힣A-Za-z0-9·()]{2,20}$/, o.label);
      assert.ok(!t.owners.some((o) => t.label.includes(o.label) && t.label.endsWith(o.label)), '담당이 과제 이름 끝에 남지 않는다');
    }
    assert.ok(p.memos.every((m) => DOC_ATTACH_MEMO_CATEGORIES.includes(m.category)));
    assert.ok(!p.memos.some((m) => m.category === 'resolved' || m.category === 'in_progress'));
  }
});

// ── 규칙 읽기: 작은 단위 ──

test('CR-23 기한 읽기: 날짜 하나만 ISO로, 범위·월 말·이후는 원문 그대로, 없는 날짜는 읽지 않음', () => {
  assert.deepEqual(parseDue('2026. 11. 13.'), { text: '2026. 11. 13.', iso: '2026-11-13', end: '2026-11-13' });
  assert.deepEqual(parseDue('2026-11-13'), { text: '2026-11-13', iso: '2026-11-13', end: '2026-11-13' });
  assert.deepEqual(parseDue('2017. 3월 말'), { text: '2017. 3월 말', iso: null, end: '2017-03-31' });
  assert.deepEqual(parseDue('2026. 11.~2027. 1.'), { text: '2026. 11.~2027. 1.', iso: null, end: '2027-01-31' });
  assert.deepEqual(parseDue('2027. 1. 25. 이후'), { text: '2027. 1. 25. 이후', iso: null, end: '2027-01-25' });
  assert.equal(parseDue('2026. 2. 31.'), null);
  assert.equal(parseDue('다음 주'), null);
});

test('CR-23 표 머리줄·담당 읽기: 세 낱말이 모두 있는 짧은 줄만 머리줄, 문장은 걸리지 않는다', () => {
  assert.deepEqual(taskHeader('과제 담당 기한').order, ['task', 'owner', 'due']);
  assert.deepEqual(taskHeader('| 할 일 | 담당자 | 마감일 |').order, ['task', 'owner', 'due']);
  assert.deepEqual(taskHeader('조치\t책임\t일정').order, ['task', 'owner', 'due']);
  assert.deepEqual(taskHeader('실행 과제 주관 시점').order, ['task', 'owner', 'due']);
  assert.equal(taskHeader('업무 담당자는 일정을 확인한다.'), null);
  assert.equal(taskHeader('과제 담당'), null);
  assert.deepEqual(ownersOf('법무/영업'), ['법무', '영업']);
  assert.deepEqual(ownersOf('미정'), []);
  assert.equal(ownersOf('검토한다'), null);
  assert.equal(ownersOf('서비스 사업'), null, '공백이 든 담당은 확신이 없어 읽지 않는다');
});

test('CR-23 파이프 표·탭 표·마크다운 제목: 칸이 나뉜 표도 읽고, 확신이 없는 줄은 만들지 않고 「읽지 못한 줄」로 남긴다', () => {
  const md = [
    '# 가상 점검 회의록', '', '일시: 2026-10-20', '',
    '## 후속 조치', '| 과제 | 담당 | 기한 |', '|---|---|---|', '| 자료 정리 | 가상팀 | 2026-12-01 |', '| 보고서 초안 | 미정 | |', '| 칸이 모자란 줄 | 가상팀 |',
    '## 미결 사항', '- 예산 승인 시점은 정해지지 않았다.',
  ].join('\n');
  const p = readDocumentRule(md, { doc: baseDoc(), targetId: TARGET, today: TODAY }).plan;
  assert.equal(p.doc.label, '가상 점검 회의록');
  assert.deepEqual(p.tasks.map((t) => [t.label, t.owners.map((o) => o.label), t.due && t.due.value]), [['자료 정리', ['가상팀'], '2026-12-01'], ['보고서 초안', [], null]]);
  assert.deepEqual(p.unread.map((u) => u.text), ['| 칸이 모자란 줄 | 가상팀 |']);
  assert.deepEqual(p.memos.map((m) => [m.category, m.date]), [['issue', TODAY]]);
  const tab = ['탭 회의록', '1. 조치', '과제\t담당\t기한', '점검 수행\t가상팀\t2026-12-15'].join('\n');
  assert.deepEqual(readDocumentRule(tab, { doc: baseDoc(), targetId: TARGET, today: TODAY }).plan.tasks.map((t) => t.label), ['점검 수행']);
  // 공백뿐인 표인데 담당·기한 순서가 다르면 읽지 않는다(엉뚱한 업무를 만들지 않음)
  const odd = ['순서 다른 문서', '1. 조치', '과제 기한 담당', '점검 수행 2026-12-15 가상팀'].join('\n');
  const op = readDocumentRule(odd, { doc: baseDoc(), targetId: TARGET, today: TODAY }).plan;
  assert.deepEqual(op.tasks, []);
  assert.equal(op.unread.length, 1);
});

test('CR-23 입력 점검: 빈 글·너무 긴 글·대상 업무가 아님은 읽지 않는다', () => {
  assert.equal(readDocumentRule('  ', { doc: baseDoc(), targetId: TARGET }).reason, 'empty');
  assert.equal(readDocumentRule('가'.repeat(200001), { doc: baseDoc(), targetId: TARGET }).reason, 'too_long');
  assert.equal(readDocumentRule('문서', { doc: baseDoc(), targetId: 'N-없음' }).reason, 'target');
  const doc = baseDoc();
  assert.equal(readDocumentRule('문서', { doc, targetId: doc.nodes.find((n) => n.core_type === 'person').id }).reason, 'target', '업무가 아닌 항목에는 붙이지 않는다');
});

test('CR-23 문서 나누기: 번호 절 제목은 앞 번호 다음 번호일 때만(목록의 「1. …」은 제목이 아님), ①②③ 항목 나누기, 날짜 점은 문장 끝이 아님', () => {
  const d = splitDocument('제목 줄\n1. 개요\n내용 하나.\n2. 결정사항\n1. 가격 동결\n2. 일정 연기');
  assert.deepEqual(d.sections.map((s) => s.title), ['', '개요', '결정사항']);
  assert.deepEqual(d.sections[2].lines, ['1. 가격 동결', '2. 일정 연기']);
  assert.deepEqual(itemsOf(['① 가를 한다. 미동의 고객은 제외한다. ② 나를 한다.']), ['① 가를 한다. 미동의 고객은 제외한다.', '② 나를 한다.']);
  assert.deepEqual(itemsOf(['목표 시행일은 2027. 2. 1.로 하되 확인한다. 다음 문장이다.']), ['목표 시행일은 2027. 2. 1.로 하되 확인한다.', '다음 문장이다.']);
});

// ── 지도에 적용 ──

test('CR-23 지도에 적용: 문서 2를 모두 체크해 applyBatch → 오류 없음·검증 통과·한 번의 기록 시점·역할 하위 유형 등록·연결 종류별 개수', () => {
  const doc = baseDoc();
  const p = read('2', doc).plan;
  const { ops, counts } = planToOps(p, allOn(p), doc);
  assert.deepEqual(counts, { doc: 1, tasks: 5, roles: 6, memos: p.memos.length });
  const before = editPoints(doc).length;
  const r = apply(doc, ops);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(validateDocument(r.doc).errors, []);
  assert.equal(validateDocument(r.doc).ok, true);
  assert.equal(editPoints(r.doc).length, before + 1, '되감기 한 점');
  assert.equal(r.memos.length, p.memos.length);
  assert.ok(r.doc.universe.subtypes.some((s) => s.core_type === 'person' && s.name === SUBTYPE_ROLE));
  assert.deepEqual(names(r.doc, 'artifact').filter((x) => x.includes('회의록')), ['2026년 문자메시지 발송 수수료 조정 검토 회의록']);
  const added = r.doc.nodes.filter((n) => n.created_at === NOW);
  assert.equal(added.filter((n) => n.core_type === 'work').length, 5);
  assert.equal(added.filter((n) => n.core_type === 'person').length, 6);
  assert.ok(added.filter((n) => n.core_type === 'person').every((n) => n.subtype === SUBTYPE_ROLE));
  const work = added.find((n) => n.label === '계약별 인상 가능 여부 검토');
  assert.equal(work.attrs.마감, '2026-11-13');
  assert.equal(r.doc.edges.filter((e) => e.created_at === NOW && e.core_type === 'references' && e.source === TARGET).length, 1);
  assert.equal(r.doc.edges.filter((e) => e.created_at === NOW && e.core_type === 'contains' && e.source === TARGET).length, 5);
  assert.equal(r.doc.edges.filter((e) => e.created_at === NOW && e.core_type === 'performs').length, 8, '법무·영업 / 재무정산 / 영업·고객지원 / 기술·재무정산 / 사업본부');
  assert.ok(!r.doc.nodes.some((n) => n.created_at === NOW && n.core_type === 'root'));
  const memos = r.doc.events.filter((e) => e.type === 'memo' && e.recorded_at === NOW);
  assert.equal(memos.length, p.memos.length);
  assert.ok(memos.every((e) => e.payload.target_id === TARGET && ['issue', 'caution'].includes(e.payload.category) && e.note.includes('출처: 「2026년')));
  assert.equal(attachNotice(r.created, r.memos.length, { issues: 0, assigns: r.assignments.length }), `문서 1·업무 5·메모 ${p.memos.length} 더함(담당 역할 6개 포함) — 되돌리려면 지도 관리 → 편집 되감기 (메모·담당 기록은 되감아도 남습니다)`); // RV-B-5: 사실대로
});

test('CR-23 같은 문서를 두 번 더해도: 항목·연결·역할이 늘지 않고(skipDup·같은 이름은 하나), 같은 메모는 처음부터 체크하지 않는다', () => {
  const doc = baseDoc();
  const p1 = read('2', doc).plan;
  const first = apply(doc, planToOps(p1, allOn(p1), doc).ops);
  assert.equal(first.ok, true);
  const p2 = readDocumentRule(FIX['2'], { doc: first.doc, targetId: TARGET, today: TODAY }).plan;
  assert.equal(p2.doc.exists, true);
  assert.ok(p2.tasks.every((t) => t.exists && t.match));
  assert.ok(p2.memos.every((m) => m.exists));
  const def = defaultDocSelection(p2);
  assert.equal(def.doc, false);
  assert.ok(Object.values(def.tasks).every((v) => !v) && Object.values(def.memos).every((v) => !v), '이미 있는 것은 체크하지 않는다');
  // 억지로 문서·할 일을 다시 체크해도(메모는 제외) 새 항목·새 연결이 생기지 않는다
  const forced = { doc: true, tasks: Object.fromEntries(p2.tasks.map((t) => [t.key, true])), memos: {} };
  const { ops, counts } = planToOps(p2, forced, first.doc);
  assert.deepEqual(counts, { doc: 0, tasks: 0, roles: 0, memos: 0 });
  const second = apply(first.doc, ops, '2026-10-28T10:00:00+09:00');
  assert.equal(second.ok, true, JSON.stringify(second.errors));
  assert.equal(second.created.length, 0);
  assert.equal(second.edges.length, 0);
  assert.equal(second.assignments.length, 0);
  assert.equal(second.doc.edges.length, first.doc.edges.length);
  assert.equal(second.doc.nodes.length, first.doc.nodes.length);
  assert.equal(names(second.doc, 'person').filter((x) => x === '재무정산').length, 1, '같은 이름 역할은 하나');
  assert.deepEqual(validateDocument(second.doc).errors, []);
});

test('CR-23 지도에 이미 있는 항목에 잇기: 같은 이름 업무·사람(역할)이 있으면 새로 만들지 않고 그 항목에, 대상 업무와 같은 이름·상위 업무는 막는다', () => {
  const doc = baseDoc();
  doc.nodes.push({ id: 'N-901', core_type: 'work', label: '계약별 인상 가능 여부 검토', hidden: false, created_at: NOW, updated_at: NOW });
  doc.nodes.push({ id: 'N-902', core_type: 'person', label: '법무', subtype: SUBTYPE_ROLE, hidden: false, created_at: NOW, updated_at: NOW });
  doc.nodes.push({ id: 'N-903', core_type: 'work', label: '요금 엔진·청구서 회귀 테스트', hidden: false, created_at: NOW, updated_at: NOW });
  doc.edges.push({ id: 'L-901', source: 'N-903', target: TARGET, core_type: 'contains', hidden: false, created_at: NOW }); // N-903이 대상 업무의 상위
  const p = read('2', doc).plan;
  const t0 = p.tasks[0];
  assert.deepEqual(t0.match, { id: 'N-901', label: '계약별 인상 가능 여부 검토' });
  assert.deepEqual(t0.owners.map((o) => !!o.match), [true, false]);
  const blocked = p.tasks.find((t) => t.label === '요금 엔진·청구서 회귀 테스트');
  assert.ok(blocked.blocked.includes('상위 업무'));
  assert.equal(defaultDocSelection(p).tasks[blocked.key], false);
  const { ops, counts } = planToOps(p, allOn(p), doc);
  assert.equal(counts.tasks, 3, '새로 만드는 업무: 5 − 있는 것 1 − 막힌 것 1');
  assert.equal(counts.roles, 4, '새 역할: 영업·재무정산·고객지원·사업본부 (「법무」는 지도에 있고, 막힌 업무에만 쓰인 「기술」은 만들지 않는다)');
  const r = apply(doc, ops);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.doc.nodes.filter((n) => n.label === '계약별 인상 가능 여부 검토').length, 1);
  assert.equal(r.doc.nodes.filter((n) => n.label === '법무').length, 1);
  assert.ok(r.doc.edges.some((e) => e.core_type === 'contains' && e.source === TARGET && e.target === 'N-901'));
  assert.ok(r.doc.edges.some((e) => e.core_type === 'performs' && e.source === 'N-902' && e.target === 'N-901'));
  assert.deepEqual(validateDocument(r.doc).errors, []);
  const self = baseDoc();
  const p3 = readDocumentRule('가상 문서\n1. 조치\n과제 담당 기한\n대사 확인 가상팀 2026-12-01', { doc: self, targetId: TARGET, today: TODAY }).plan;
  assert.equal(p3.tasks[0].blocked, '대상 업무와 같은 이름입니다');
});

test('CR-23 메모 명령(addMemo): 대상은 id 또는 같은 묶음 앞 행(@행), 대상이 없으면 전부 되돌아간다, 해결됨·진행 중은 계획이 만들지 않는다', () => {
  const doc = baseDoc();
  const ok = apply(doc, [
    { op: 'addNode', row: 1, input: { core_type: 'work', label: '묶음 안 새 업무' } },
    { op: 'addMemo', row: 2, input: { target_id: '@1', occurred_at: '2026-10-20', category: 'caution', note: '묶음 안 메모' } },
    { op: 'addMemo', row: 3, input: { target_id: TARGET, occurred_at: '2026-10-21', note: '범주 생략' } },
  ]);
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  const memos = ok.doc.events.filter((e) => e.type === 'memo' && e.recorded_at === NOW);
  assert.deepEqual(memos.map((e) => [e.payload.category, e.note]), [['caution', '묶음 안 메모'], ['issue', '범주 생략']]);
  assert.equal(memos[0].payload.target_id, ok.created[0].id);
  const bad = apply(doc, [
    { op: 'addNode', row: 1, input: { core_type: 'work', label: '버려질 업무' } },
    { op: 'addMemo', row: 2, input: { target_id: 'N-없음', occurred_at: '2026-10-20', category: 'issue', note: '대상 없음' } },
  ]);
  assert.equal(bad.ok, false);
  assert.equal(bad.doc, doc, '전부 아니면 전무: 문서는 그대로');
  assert.deepEqual(bad.errors.map((e) => e.row), [2]);
  const sub = apply(doc, [{ op: 'addSubtype', aux: true, input: { core_type: 'person', name: SUBTYPE_ROLE } }, { op: 'addSubtype', aux: true, input: { core_type: 'person', name: SUBTYPE_ROLE } }, { op: 'addNode', row: 1, input: { core_type: 'person', label: '역할 하나', subtype: SUBTYPE_ROLE } }]);
  assert.equal(sub.ok, true, '이미 등록된 하위 유형은 건너뛴다');
  assert.equal(sub.doc.universe.subtypes.filter((s) => s.name === SUBTYPE_ROLE).length, 1);
  for (const n of ['1', '2', '3', '4']) assert.ok(read(n).plan.memos.every((m) => m.category !== 'resolved' && m.category !== 'in_progress'));
});

test('CR-23 체크: 체크 해제한 할 일은 업무·연결·담당이 만들어지지 않고, 그 할 일에만 쓰인 역할도 만들지 않는다', () => {
  const doc = baseDoc();
  const p = read('2', doc).plan;
  const sel = { doc: false, tasks: { t1: false, t2: false, t3: false, t4: false, t5: true }, memos: Object.fromEntries(p.memos.map((m) => [m.key, false])) };
  const { ops, counts } = planToOps(p, sel, doc);
  assert.deepEqual(counts, { doc: 0, tasks: 1, roles: 1, memos: 0 });
  assert.deepEqual(ops.map((o) => o.op), ['addSubtype', 'addNode', 'addEdge', 'addNode', 'assign']);
  const r = apply(doc, ops);
  assert.equal(r.ok, true);
  assert.deepEqual(r.created.map((n) => n.label), ['최종 시행 승인 및 사후 모니터링', '사업본부']);
  const none = { doc: false, tasks: Object.fromEntries(p.tasks.map((t) => [t.key, false])), memos: Object.fromEntries(p.memos.map((m) => [m.key, false])) };
  assert.deepEqual(planToOps(p, none, doc).ops, [], '아무것도 체크하지 않으면 명령이 없다');
});

// ── Claude 읽기(가짜 공급자) ──

const aiProvider = (extraOut = null) => {
  const client = createFakeClient({ mode: 'ok' });
  if (extraOut) client.extractOut = extraOut;
  return { client, provider: createProvider('claude_api', { apiKey: FAKE_KEY, client }) };
};
const MANUAL_OUT = {
  nodes: [
    { type: 'org', label: '정산팀', emp_no: '', quote: '정산팀은 청구 및 채권관리를' },
    { type: 'work', label: '채권관리', emp_no: '', quote: '정산팀은 청구 및 채권관리를' },
    { type: 'work', label: '미납 통지', emp_no: '', quote: '미납 통지, 재청구 및 연체 관리' },
    { type: 'work', label: '고객 문의 분류체계', emp_no: '', quote: '고객 문의 분류체계를 구축하고 월별 이의제기 및 해지율을 경영진에 보고한다' },
    { type: 'work', label: '이의제기', emp_no: '', quote: '고객 문의 분류체계를 구축하고 월별 이의제기 및 해지율을 경영진에 보고한다' },
    { type: 'work', label: '지어낸 업무', emp_no: '', quote: '이 글 어디에도 없는 구절입니다' },
  ],
  edges: [
    { from_label: '정산팀', to_label: '채권관리', type: 'references', quote: '정산팀은 청구 및 채권관리를' },
    { from_label: '고객 문의 분류체계', to_label: '이의제기', type: 'precedes', quote: '고객 문의 분류체계를 구축하고 월별 이의제기 및 해지율을 경영진에 보고한다' },
  ],
};

test('CR-23 덩어리 나누기: 상한 이하 글은 한 덩어리, 넘으면 절 경계에서 상한 이하 덩어리로(글이 사라지거나 늘지 않는다)', () => {
  assert.deepEqual(chunkDocument(FIX['2']), [FIX['2']]);
  assert.deepEqual(chunkDocument('  '), []);
  assert.ok(LONG.length > TEXT_LIMITS.maxChars, '시험 문서는 글로 추가 상한(4000자)보다 길다');
  const chunks = chunkDocument(LONG);
  assert.ok(chunks.length >= 2 && chunks.every((c) => c.length <= TEXT_LIMITS.maxChars));
  const squash = (s) => s.replace(/\s+/g, '');
  const lines = LONG.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('※'));
  assert.equal(squash(chunks.join('')), squash(lines.join('')), '이은 글이 원문(※ 줄 제외)의 모든 줄을 순서대로 담는다');
  assert.ok(chunks.slice(1).every((c) => !/^\d{1,2}\. \S+$/.test(c.split('\n').pop())), '절 제목만 덩어리 끝에 남지 않는다');
  const tiny = chunkDocument(['제목', '절 하나', ...Array(30).fill('가'.repeat(100))].join('\n'), 500);
  assert.ok(tiny.every((c) => c.length <= 500) && tiny.length > 1);
  const huge = chunkDocument('가'.repeat(1050), 500);
  assert.deepEqual(huge.map((c) => c.length), [500, 500, 50], '한 줄이 상한보다 길면 자른다');
});

test('CR-23 Claude 읽기: 긴 문서를 덩어리로 나눠 차례로 보내고 합친다(같은 이름 하나, 인용이 원문에 없는 행은 버림)', async () => {
  const { client, provider } = aiProvider(MANUAL_OUT);
  const doc = baseDoc();
  const view = createApp({ store: createStore(memoryStorage()), samples: SAMPLES, currentId: 'U-A1', now: () => NOW }).view;
  const r = await readDocumentAi(LONG, { provider, view });
  assert.equal(r.ok, true);
  assert.ok(r.chunks >= 2 && client.calls.length === r.chunks, '덩어리마다 한 번씩 호출');
  assert.equal(r.proposal.method, 'claude_api');
  assert.deepEqual(labelKeys(r.proposal).sort(), ['org|정산팀', 'work|고객 문의 분류체계', 'work|미납 통지', 'work|이의제기', 'work|채권관리'].sort());
  assert.ok(!r.proposal.nodes.some((n) => n.label === '지어낸 업무'), '인용이 원문에 없는 행은 버린다');
  assert.equal(r.proposal.edges.length, 2);
  assert.ok(r.dropped.length >= 1);
  assert.equal(new Set(labelKeys(r.proposal)).size, r.proposal.nodes.length, '같은 이름은 하나로 합친다');
  assert.ok(doc);
});

test('CR-23 Claude 읽기 실패·키 없음: 이유 한 줄과 함께 ok:false(화면이 규칙 결과를 보임), 키가 없으면 null, 일부 덩어리만 실패하면 나머지만', async () => {
  const to = await readDocumentAi(FIX['2'], { provider: aiProvider().provider, view: null, extract: async () => ({ ok: false, fallback: { code: 'W-LLM-FALLBACK', reason: '연결 실패·시간 초과' } }) });
  assert.deepEqual(to, { ok: false, fallback: { reason: '연결 실패·시간 초과' } });
  assert.equal(await readDocumentAi(FIX['2'], { provider: null }), null);
  assert.deepEqual(await readDocumentAi('  ', { provider: null }), { ok: false, fallback: { reason: '읽을 글이 비어 있습니다' } });
  const timeoutClient = createFakeClient({ mode: 'timeout' });
  const t = await readDocumentAi(FIX['2'], { provider: createProvider('claude_api', { apiKey: FAKE_KEY, client: timeoutClient }) });
  assert.equal(t.ok, false);
  assert.equal(t.fallback.reason, '연결 실패·시간 초과');
  let n = 0;
  const half = await readDocumentAi(LONG, {
    provider: aiProvider().provider,
    view: null,
    extract: async (chunk) => { n += 1; return n === 1 ? { ok: false, fallback: { reason: '키가 맞지 않음' } } : { ok: true, proposal: { nodes: [{ key: 'n1', type: 'work', label: '미납 통지', quote: '미납 통지', match: null }], edges: [], notes: [] }, dropped: [], model: 'm' }; },
  });
  assert.equal(half.ok, true);
  assert.equal(half.failed.length, 1);
  assert.ok(half.proposal.notes.some((x) => x.includes('읽지 못했습니다')));
  assert.ok(AI_DOC_MAX_CHUNKS >= 2);
  const capped = await readDocumentAi('가'.repeat(30), { provider: aiProvider().provider, maxChars: 10, maxChunks: 2, extract: async () => ({ ok: true, proposal: { nodes: [], edges: [], notes: [] }, dropped: [] }) });
  assert.ok(capped.proposal.notes.some((x) => x.includes('앞의 2덩어리')));
});

test('CR-23 Claude 제안을 같은 묶음에: 규칙 계획과 같은 이름은 한 번만, 새 업무는 대상 업무 아래에 잇고, 한 번에 저장돼도 검증을 통과하며 되감기 한 점', async () => {
  const doc = baseDoc();
  const { provider } = aiProvider(MANUAL_OUT);
  const ai = await readDocumentAi(LONG, { provider, view: null });
  const plan = read('3', doc).plan;
  plan.tasks.push({ key: 'tx', label: '채권관리', owners: [], due: null, past: false, match: null, blocked: '', exists: false, quote: '', section: '' }); // 규칙이 이미 만든 업무와 이름이 같은 Claude 항목
  const deduped = dedupeAiProposal(ai.proposal, plan);
  assert.ok(!deduped.nodes.some((n) => n.label === '채권관리') && deduped.droppedSame === 1);
  assert.ok(deduped.edges.every((e) => deduped.nodes.some((n) => n.key === e.from) && deduped.nodes.some((n) => n.key === e.to)), '빠진 항목에 걸린 연결도 뺀다');
  plan.tasks.pop();
  const sel = defaultSelection(ai.proposal, 'all');
  assert.ok(ai.proposal.edges.every((e) => sel.edges[e.key].include === false), '인용 문장에 나열 표시(…하고)가 있거나 읽지 못한 문장이 있어 연결은 모두 체크에서도 빠진다');
  for (const e of deduped.edges) sel.edges[e.key] = { include: true }; // 사람이 확인하고 직접 체크
  const { ops, counts } = buildAttachOps(plan, defaultDocSelection(plan), { proposal: deduped, selection: sel }, doc);
  assert.equal(counts.aiNodes, 4, '채권관리는 규칙 계획에서 이미 만들어 뺐다(5 − 1)');
  assert.equal(counts.aiEdges, 1, '「정산팀 → 채권관리」 연결은 채권관리가 빠져 함께 빠졌고, 남은 연결은 사람이 체크했다');
  const rows = ops.filter((o) => o.row !== undefined).map((o) => o.row);
  assert.equal(new Set(rows).size, rows.length, '행 번호가 겹치지 않는다');
  const before = editPoints(doc).length;
  const r = apply(doc, ops);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(editPoints(r.doc).length, before + 1);
  assert.deepEqual(validateDocument(r.doc).errors, []);
  const miss = r.doc.nodes.find((n) => n.label === '미납 통지');
  assert.ok(r.doc.edges.some((e) => e.core_type === 'contains' && e.source === TARGET && e.target === miss.id), 'Claude가 읽은 새 업무는 대상 업무 아래');
  assert.ok(!r.doc.nodes.some((n) => n.core_type === 'root' && n.created_at === NOW));
  const none = buildAttachOps(plan, defaultDocSelection(plan), { proposal: ai.proposal, selection: defaultSelection(ai.proposal, 'none') }, doc);
  assert.equal(none.counts.aiNodes, 0, '처음에는 Claude 항목을 체크하지 않는다');
});

// ── 화면(DOM 흉내) ──

const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const openApp = (now = () => NOW) => createApp({ store: createStore(memoryStorage()), samples: SAMPLES, currentId: 'U-A1', now });
const withDom = (fn) => async () => {
  const body = installDom();
  try { await fn(body); } finally { uninstallDom(); }
};

function openDialog({ app = openApp(), aiReady = false, readAi = null, target = '', example = null } = {}) {
  const dialog = new FakeEl('dialog');
  dialog.open = false;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.fire('close'); };
  document.body.append(dialog);
  const saved = [];
  const open = docAttachDialog({ dialog, app, getView: () => app.view, aiReady: () => aiReady, readAi: readAi || (() => null), today: () => TODAY, example, onSaved: (r, ctx) => saved.push({ r, ctx }) });
  open(target);
  const q = (id) => dialog.querySelector(`[data-testid=${id}]`);
  const all = (prefix) => dialog.querySelectorAll(`[data-testid^=${prefix}]`);
  const rows = (prefix) => all(`${prefix}-`).filter((e) => new RegExp(`^${prefix}-\\d+$`).test(e.dataset.testid));
  return { dialog, app, saved, q, all, rows, open };
}

test('CR-23 화면: 대상 업무를 미리 고르면 그 업무로 열리고, 문서를 넣고 읽어 보기 → 미리 보기(문서 1·할 일 5·메모)·기한 지난 것은 해제', withDom(() => {
  const d = openDialog({ target: 'N-003' });
  assert.equal(d.q('doc-attach-target').value, 'N-003');
  assert.equal(d.q('doc-attach-ai'), null);
  assert.equal(d.q('doc-attach-ai-note').textContent, '「설정」에서 키를 넣으면 Claude가 읽습니다');
  assert.equal(d.q('doc-attach-save').disabled, true);
  d.q('doc-attach-input').value = FIX['1'];
  d.q('doc-attach-read').click();
  assert.equal(d.q('doc-attach-summary').textContent, '문서 1개 · 할 일 업무 4개 · 메모 2건 · 읽지 못한 줄 0개');
  assert.equal(d.rows('doc-attach-task').length, 4);
  assert.deepEqual([0, 1, 2, 3].map((i) => d.q(`doc-attach-task-status-${i}`).textContent), Array(4).fill('새로 만듦 · 기한 지남'));
  assert.deepEqual([0, 1, 2, 3].map((i) => !!d.q(`doc-attach-task-check-${i}`).checked), Array(4).fill(false));
  assert.equal(d.q('doc-attach-doc-check').checked, true);
  assert.equal(d.q('doc-attach-memo-cat-0').textContent, '이슈');
  assert.equal(d.q('doc-attach-count').textContent, '더할 것: 문서 1개 · 할 일 업무 0개 · 역할 0개 · 메모 2건');
  assert.equal(d.q('doc-attach-method').textContent, '규칙으로 읽었습니다. 원문에 있는 것만 읽고, 확신이 없는 줄은 만들지 않았습니다.');
  // 기한 지난 할 일도 사람이 체크하면 들어간다
  d.q('doc-attach-task-check-0').checked = true;
  d.q('doc-attach-task-check-0').fire('change');
  assert.equal(d.q('doc-attach-count').textContent, '더할 것: 문서 1개 · 할 일 업무 1개 · 역할 2개 · 메모 2건');
}));

test('CR-23 화면: 저장 → 한 번의 기록·알림 문구·대상 업무로 onSaved, 글이나 대상이 바뀌면 다시 읽기 전에는 저장 불가', withDom(() => {
  const app = openApp();
  const before = { nodes: app.doc.nodes.length, events: app.doc.events.length };
  const d = openDialog({ app, target: TARGET });
  d.q('doc-attach-input').value = FIX['2'];
  d.q('doc-attach-read').click();
  assert.equal(d.q('doc-attach-save').disabled, false);
  d.q('doc-attach-input').value = `${FIX['2']} 고침`;
  d.q('doc-attach-input').fire('input');
  assert.equal(d.q('doc-attach-save').disabled, true, '글이 바뀌면 저장 불가');
  assert.equal(d.q('doc-attach-stale').hidden, false);
  d.q('doc-attach-input').value = FIX['2'];
  d.q('doc-attach-input').fire('input');
  assert.equal(d.q('doc-attach-save').disabled, false, '원래 글로 되돌리면 풀린다');
  d.q('doc-attach-target').value = 'N-003';
  d.q('doc-attach-target').fire('change');
  assert.equal(d.q('doc-attach-save').disabled, true, '대상 업무가 바뀌면 저장 불가');
  d.q('doc-attach-target').value = TARGET;
  d.q('doc-attach-target').fire('change');
  d.q('doc-attach-save').click();
  assert.equal(d.saved.length, 1);
  assert.equal(d.saved[0].ctx.targetId, TARGET);
  assert.match(d.saved[0].ctx.notice, /^문서 1·업무 5·메모 \d+ 더함\(담당 역할 6개 포함\) — 되돌리려면 지도 관리 → 편집 되감기/);
  assert.equal(d.q('doc-attach-done').textContent, d.saved[0].ctx.notice);
  assert.equal(app.doc.nodes.length, before.nodes + 1 + 5 + 6);
  assert.equal(new Set(app.doc.events.slice(before.events).map((e) => e.recorded_at)).size, 1, '되감기 한 점');
  assert.equal(d.q('doc-attach-save').disabled, true, '저장 뒤에는 미리 보기가 비어 다시 저장할 수 없다');
  assert.deepEqual(validateDocument(app.doc).errors, []);
}));

test('CR-23 화면: PDF·한글·워드 파일은 읽지 않고 안내, .txt는 글 칸에 들어간다, 대상 업무를 안 고르면 읽지 않는다', withDom(async () => {
  const d = openDialog(); // 업무가 셋이라 미리 고른 것이 없다
  assert.equal(d.q('doc-attach-target').value, '');
  d.q('doc-attach-input').value = FIX['4'];
  d.q('doc-attach-read').click();
  assert.equal(d.q('doc-attach-message').textContent, '대상 업무를 고르세요. 이 지도에 업무가 없으면 먼저 업무를 하나 만드세요.');
  assert.equal(d.rows('doc-attach-task').length, 0);
  for (const name of ['a.pdf', 'b.hwp', 'c.hwpx', 'd.docx']) {
    const file = d.q('doc-attach-file');
    let read = false;
    file.files = [{ name, size: 100, text: async () => { read = true; return 'x'; } }];
    d.q('doc-attach-input').value = '';
    await file.fire('change');
    assert.equal(read, false, `${name}은 읽지 않는다`);
    assert.equal(d.q('doc-attach-input').value, '');
    assert.equal(d.q('doc-attach-message').textContent, 'PDF·한글·워드 파일은 글을 복사해 붙여 넣어 주세요');
  }
  const file = d.q('doc-attach-file');
  file.files = [{ name: '메모.txt', size: 100, text: async () => FIX['4'] }];
  await file.fire('change');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(d.q('doc-attach-input').value, FIX['4']);
  assert.equal(d.q('doc-attach-file-name').textContent, '고른 파일: 메모.txt');
  d.q('doc-attach-target').value = TARGET;
  d.q('doc-attach-target').fire('change');
  d.q('doc-attach-read').click();
  assert.equal(d.q('doc-attach-summary').textContent, '문서 1개 · 할 일 업무 0개 · 메모 3건 · 읽지 못한 줄 0개');
  assert.ok(d.q('doc-attach-no-table'));
}));

test('CR-23 화면: 읽기 전용에서는 열리지 않고, Claude로 읽기는 성공하면 규칙 결과 + Claude 항목(처음엔 해제), 실패하면 규칙 결과 + 이유 한 줄', withDom(async () => {
  const ro = openApp();
  ro.setRewinding(true); // 읽기 전용(되감기 중)
  const closed = openDialog({ app: ro });
  assert.equal(closed.dialog.open, false);

  const proposalOf = async () => {
    const { provider } = aiProvider(MANUAL_OUT);
    return readDocumentAi(MIXED, { provider, view: null });
  };
  const okAi = openDialog({ aiReady: true, readAi: proposalOf, target: TARGET });
  assert.ok(okAi.q('doc-attach-ai'));
  assert.equal(okAi.q('doc-attach-ai-note'), null);
  okAi.q('doc-attach-input').value = MIXED;
  await okAi.q('doc-attach-ai').fire('click');
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(okAi.q('doc-attach-ai-nodes'), 'Claude가 더 찾은 항목 표');
  assert.deepEqual(okAi.rows('doc-attach-ai-node').map((e, i) => !!okAi.q(`doc-attach-ai-node-check-${i}`).checked), [false, false, false]);
  assert.match(okAi.q('doc-attach-method').textContent, /^규칙으로 읽은 결과에 Claude가 더 찾은 것을 보탰습니다/);
  assert.equal(okAi.q('doc-attach-summary').textContent, '문서 1개 · 할 일 업무 0개 · 메모 3건 · 읽지 못한 줄 0개');
  okAi.q('doc-attach-check-all').click();
  okAi.q('doc-attach-ai-node-check-0').checked = true;
  okAi.q('doc-attach-ai-node-check-0').fire('change');
  assert.match(okAi.q('doc-attach-count').textContent, /Claude 항목 1개/);

  const failAi = openDialog({ aiReady: true, readAi: async () => ({ ok: false, fallback: { reason: '연결 실패·시간 초과' } }), target: TARGET });
  failAi.q('doc-attach-input').value = FIX['2'];
  await failAi.q('doc-attach-ai').fire('click');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(failAi.q('doc-attach-fallback').textContent, 'Claude 읽기 실패: 연결 실패·시간 초과 — 규칙으로 읽은 결과를 보여 줍니다');
  assert.equal(failAi.rows('doc-attach-task').length, 5);
  assert.equal(failAi.q('doc-attach-method').textContent.startsWith('규칙으로 읽었습니다'), true);
  assert.equal(failAi.q('doc-attach-save').disabled, false);
}));

test('CR-23 화면: 같은 문서를 한 번 더 읽으면 이미 있는 것은 「이미 있음」으로 체크되지 않고 저장해도 늘지 않는다', withDom(() => {
  const app = openApp();
  const d = openDialog({ app, target: TARGET });
  d.q('doc-attach-input').value = FIX['2'];
  d.q('doc-attach-read').click();
  d.q('doc-attach-save').click();
  assert.equal(d.saved.length, 1);
  const nodes = app.doc.nodes.length;
  const edges = app.doc.edges.length;
  const d2 = openDialog({ app, target: TARGET });
  d2.q('doc-attach-input').value = FIX['2'];
  d2.q('doc-attach-read').click();
  assert.ok(d2.q('doc-attach-doc-status').textContent.startsWith('이미 있음'));
  assert.ok([0, 1, 2, 3, 4].every((i) => d2.q(`doc-attach-task-status-${i}`).textContent.startsWith('이미 있음')));
  assert.equal(d2.q('doc-attach-count').textContent, '더할 것: 문서 0개 · 할 일 업무 0개 · 역할 0개 · 메모 0건');
  d2.q('doc-attach-save').click();
  assert.equal(d2.q('doc-attach-message').textContent, '더할 것이 없습니다. 항목을 체크하세요.');
  assert.equal(app.doc.nodes.length, nodes);
  assert.equal(app.doc.edges.length, edges);
}));

// ── 입구: 찾기·카드 메뉴 ──

test('CR-23 찾기: 문서·회의록·매뉴얼·메모·올리기·업로드·붙이기·반영·문서 더하기 낱말이 「문서로 더하기」에 닿고, 묶은 지도·읽기 전용에서는 쓸 수 없음 이유가 붙는다', () => {
  const f = FEATURES.find((x) => x.id === 'doc-attach');
  assert.equal(f.name, '문서로 더하기');
  assert.equal(f.go, 'dlg:doc-attach');
  for (const w of ['문서', '회의록', '매뉴얼', '메모', '올리기', '업로드', '붙이기', '반영', '문서 더하기']) assert.ok(f.keywords.includes(w), w);
  for (const q of ['회의록', '매뉴얼', '문서 더하기', '문서로 더하기', '붙이기', '반영', '지도에 반영']) {
    assert.ok(searchFeatures(q).some((r) => r.id === 'doc-attach'), `${q} → 문서로 더하기가 결과에 있어야 한다`);
  }
  assert.equal(searchFeatures('회의록')[0].id, 'doc-attach');
  assert.equal(featureBlock(f, { grouped: true }), '묶은 지도에서는 팀·업무 지도를 열어서 쓰세요');
  assert.equal(featureBlock(f, { readOnly: true }), '읽기 전용');
  assert.equal(featureBlock(f, { rewinding: true }), '편집 되감기 중');
  assert.equal(featureBlock(f, {}), null);
});

test('CR-23 카드 메뉴: 업무 카드의 「⋯」에만 docAttach(고칠 수 있을 때), 사람·산출물·읽기 전용·다른 지도에는 없다', () => {
  const base = { own: true, readOnly: false, hidden: false, handoverDoc: false, canDelete: false };
  assert.ok(actionPlan({ ...base, coreType: 'work' }).more.includes('docAttach'));
  for (const t of ['person', 'artifact', 'topic', 'org']) assert.ok(!actionPlan({ ...base, coreType: t }).more.includes('docAttach'), t);
  assert.ok(!actionPlan({ ...base, coreType: 'work', readOnly: true }).more.includes('docAttach'));
  assert.ok(!actionPlan({ ...base, coreType: 'work', own: false }).more.includes('docAttach'));
});

// ── H2: Claude 새 항목을 문서 항목에 잇기(②) ──

const LINK_OUT = {
  nodes: [
    { type: 'org', label: '정산팀', emp_no: '', quote: '정산팀은 청구 및 채권관리를' },
    { type: 'topic', label: '미납 관리', emp_no: '', quote: '미납 관리는 별도 점검한다' },
    { type: 'topic', label: '대사 불일치', emp_no: '', quote: '대사 불일치와 미납 관리' }, // 지도에 이미 있는 주제
    { type: 'work', label: '미납 통지', emp_no: '', quote: '미납 통지, 재청구 및 연체 관리' },
  ],
  edges: [],
};
const linkPlan = async (doc) => {
  const { provider } = aiProvider(LINK_OUT);
  const ai = await readDocumentAi(`${LONG}
대사 불일치와 미납 관리는 별도 점검한다.`, { provider, view: null });
  return { ai, plan: read('3', doc).plan };
};
const edgesFrom = (ops, src) => ops.filter((o) => o.op === 'addEdge' && o.input.source === src).map((o) => `${o.input.core_type}>${o.input.target}`);

test('H2-② 새 Claude 항목(업무 제외)은 새 문서 항목에서 잇는다: 주제 relates_to·조직 references, 업무는 대상 업무 contains, 지도에 있던 항목은 잇지 않는다', async () => {
  const doc = baseDoc();
  const { ai, plan } = await linkPlan(doc);
  const { ops, counts } = buildAttachOps(plan, defaultDocSelection(plan), { proposal: ai.proposal, selection: defaultSelection(ai.proposal, 'all') }, doc);
  const docOp = ops.find((o) => o.key === 'doc');
  const from = `@${docOp.row}`;
  const rowOf = (label) => `@${ops.find((o) => o.op === 'addNode' && o.input.label === label).row}`;
  assert.ok(edgesFrom(ops, from).includes(`references>${rowOf('정산팀')}`));
  assert.ok(edgesFrom(ops, from).includes(`relates_to>${rowOf('미납 관리')}`));
  assert.ok(!ops.some((o) => o.op === 'addNode' && o.input.label === '대사 불일치'), '지도에 있는 주제는 새로 만들지 않는다');
  assert.equal(edgesFrom(ops, from).filter((x) => x.startsWith('relates_to') || x.includes(rowOf('정산팀'))).length, 2);
  assert.ok(ops.some((o) => o.op === 'addEdge' && o.input.source === TARGET && o.input.core_type === 'contains' && o.input.target === rowOf('미납 통지')));
  assert.equal(counts.aiLinks, 2);
  const r = apply(doc, ops);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(validateDocument(r.doc).errors, []);
});

test('H2-② 문서 항목을 체크 해제하고 지도에도 없으면 대상 업무에서 잇고, 지도의 문서가 있으면 그 문서에서 잇고, 체크 해제한 Claude 항목은 잇지 않는다', async () => {
  const doc = baseDoc();
  const { ai, plan } = await linkPlan(doc);
  const sel = defaultSelection(ai.proposal, 'all');
  const off = { ...defaultDocSelection(plan), doc: false };
  const a = buildAttachOps(plan, off, { proposal: ai.proposal, selection: sel }, doc);
  assert.ok(edgesFrom(a.ops, TARGET).some((x) => x.startsWith('relates_to>')), '문서가 없으면 대상 업무에서 relates_to');
  assert.ok(edgesFrom(a.ops, TARGET).some((x) => x.startsWith('references>@')), '대상 업무에서 references(조직)');
  const planM = { ...plan, doc: { ...plan.doc, match: { id: 'N-030', label: '기존 문서' } } };
  const b = buildAttachOps(planM, { ...defaultDocSelection(planM), doc: true }, { proposal: ai.proposal, selection: sel }, doc);
  assert.ok(edgesFrom(b.ops, 'N-030').some((x) => x.startsWith('relates_to>@')), '지도의 문서 id에서 잇는다');
  const org = ai.proposal.nodes.find((n) => n.label === '정산팀');
  sel.nodes[org.key] = { include: false };
  const c = buildAttachOps(plan, defaultDocSelection(plan), { proposal: ai.proposal, selection: sel }, doc);
  assert.equal(c.counts.aiLinks, 1);
  assert.ok(!c.ops.some((o) => o.input && o.input.label === '정산팀'));
});

// ── H2: 쪽 머리글을 제목으로 잡지 않는다(③) ──

test('H2-③ 쪽 머리글(「A사 … | …」)·되풀이되는 머리글·쪽 번호 줄은 제목이 되지 않고 본문에도 섞이지 않는다', () => {
  const head = 'A사 메시징 서비스 | 가상 업무기록1';
  const lines = FIX['3'].split('\n');
  const text = [head, '- 1 -', ...lines.slice(0, 20), head, '- 2 -', ...lines.slice(20), '3 / 12', '페이지 3'].join('\n');
  const p = readDocumentRule(text, { doc: baseDoc(), targetId: TARGET, today: TODAY }).plan;
  assert.equal(p.doc.label, '문자메시지 발송 서비스 월정산 업무매뉴얼');
  assert.ok(!p.unread.some((u) => u.text.includes('가상 업무기록1')), '되풀이된 머리글은 읽지 못한 줄로도 남지 않는다');
  const once = readDocumentRule([head, ...lines].join('\n'), { doc: baseDoc(), targetId: TARGET, today: TODAY }).plan;
  assert.equal(once.doc.label, '문자메시지 발송 서비스 월정산 업무매뉴얼', '한 번뿐이어도 「 | 」로 나뉜 짧은 줄은 제목 후보가 아니다');
  const sd = splitDocument(['- 3 -', '회의록', '1. 개요', '내용입니다'].join('\n'));
  assert.equal(sd.title, '회의록');
});

test('H2-③ 문서 제목과 같은 이름의 Claude 산출물은 따로 만들지 않는다(droppedSame)', async () => {
  const out = { nodes: [{ type: 'artifact', label: '문자메시지 발송 서비스 월정산 업무매뉴얼', emp_no: '', quote: '정산팀은 청구 및 채권관리를' }], edges: [] };
  const { provider } = aiProvider(out);
  const ai = await readDocumentAi(LONG, { provider, view: null });
  const plan = read('3').plan;
  const d = dedupeAiProposal(ai.proposal, plan);
  assert.equal(d.nodes.length, 0);
  assert.equal(d.droppedSame, 1);
});

test('H2-② 화면: 체크한 새 조직·주제는 「문서 「…」에 참조로/관련으로 잇습니다」, 저장하면 문서에서 잇는 연결이 생겨 떠돌지 않고, 숫자에 따로 센다', withDom(async () => {
  const app = openApp();
  const text = `${LONG}\n대사 불일치와 미납 관리는 별도 점검한다.`;
  const d = openDialog({ app, aiReady: true, target: TARGET, readAi: async () => readDocumentAi(text, { provider: aiProvider(LINK_OUT).provider, view: null }) });
  d.q('doc-attach-input').value = text;
  await d.q('doc-attach-ai').fire('click');
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  const labels2 = d.rows('doc-attach-ai-node').map((_, i) => d.q(`doc-attach-ai-node-${i}`).textContent);
  for (let i = 0; i < labels2.length; i += 1) { const c = d.q(`doc-attach-ai-node-check-${i}`); if (c) { c.checked = true; c.fire('change'); } }
  const st = d.rows('doc-attach-ai-node').map((_, i) => d.q(`doc-attach-ai-node-${i}`).textContent);
  assert.ok(st.some((t) => t.includes('정산팀') && t.includes('새로 만듦 · 문서 「문자메시지 발송 서비스 월정산 업무…」에 참조로 잇습니다')), JSON.stringify(st));
  assert.ok(st.some((t) => t.includes('미납 관리') && t.includes('에 관련으로 잇습니다')), JSON.stringify(st));
  assert.ok(st.some((t) => t.includes('미납 통지') && t.includes('대상 업무 아래에 잇습니다')));
  assert.match(d.q('doc-attach-count').textContent, /문서에 잇는 연결 2개/);
  d.q('doc-attach-save').click();
  const org = app.doc.nodes.find((n) => n.label === '정산팀' && n.core_type === 'org');
  const docNode = app.doc.nodes.find((n) => n.core_type === 'artifact' && n.label.startsWith('문자메시지 발송 서비스'));
  assert.ok(org && docNode && app.doc.edges.some((e) => e.source === docNode.id && e.target === org.id && e.core_type === 'references'));
}));

test('H2-⑦ 화면: 「예시 문서 넣기」는 글 칸을 예시로 채우고(기한은 오늘 +7·+14일), 대상이 없으면 「대사 확인」을 고르며, 읽으면 할 일 2·이슈 1·주의 1', withDom(() => {
  assert.equal(openDialog().q('doc-attach-example'), null, '예시를 주지 않으면 단추가 없다');
  const d = openDialog({ example: DOC_ATTACH_EXAMPLE });
  assert.equal(d.q('doc-attach-example').textContent, '예시 문서 넣기: 대사 확인 개선 회의록(샘플 「월말 정산 점검」용)');
  assert.equal(d.q('doc-attach-target').value, '');
  d.q('doc-attach-input').value = '덮어쓸 글';
  d.q('doc-attach-example').click();
  const t = d.q('doc-attach-input').value;
  assert.ok(t.startsWith('대사 확인 개선 회의록') && !t.includes('{D') && !t.includes('2026. 11. 6.'));
  assert.ok(t.includes('윤바다 2026. 11. 11.') && t.includes('서하늘 2026. 11. 4.'), '오늘(2026-10-28) +7일·+14일');
  assert.equal(d.q('doc-attach-target').value, TARGET);
  d.q('doc-attach-read').click();
  assert.equal(d.rows('doc-attach-task').length, 2);
  assert.equal(d.rows('doc-attach-task').filter((_, i) => d.q(`doc-attach-task-check-${i}`).checked).length, 2, '기한이 지나지 않아 둘 다 체크');
  assert.equal(d.rows('doc-attach-memo').length, 2);
  const picked = openDialog({ example: DOC_ATTACH_EXAMPLE, target: 'N-003' });
  picked.q('doc-attach-example').click();
  assert.equal(picked.q('doc-attach-target').value, 'N-003', '이미 고른 대상은 바꾸지 않는다');
  assert.equal(DOC_ATTACH_EXAMPLE.text('2026-12-25').includes('2027. 1. 1.'), true, '해를 넘겨도 YYYY. M. D. 꼴');
}));

test('Claude 새 업무가 대상 업무와 비슷한 이름이면 hold(처음엔 체크 안 함), 다른 이름은 그대로', () => {
  assert.equal(similarName('문자발송 월정산', '문자메시지 발송 서비스 월정산'), true, '실제 키 시험 사례');
  assert.equal(similarName('문자발송 월정산', '문자발송 월정산 점검'), true, '포함');
  assert.equal(similarName('불일치 원인 코드표 정리', '대사 확인'), false);
  assert.equal(similarName('', '대사 확인'), false);
  const plan = { doc: { label: '문서' }, tasks: [], targetLabel: '문자발송 월정산' };
  const proposal = {
    nodes: [
      { key: 'a', type: 'work', label: '문자메시지 발송 서비스 월정산', quote: 'q' },
      { key: 'b', type: 'work', label: '불일치 원인 코드표 정리', quote: 'q' },
      { key: 'c', type: 'topic', label: '문자발송 월정산', quote: 'q' },
    ],
    edges: [],
  };
  const d = dedupeAiProposal(proposal, plan);
  assert.equal(d.nodes[0].hold, '대상 업무와 비슷한 이름(「문자발송 월정산」)');
  assert.equal(d.nodes[1].hold, undefined);
  assert.equal(d.nodes[2].hold, undefined, '업무가 아닌 유형은 대상');
  assert.equal(defaultSelection(d, 'all').nodes.a.include, false, '모두 체크에서도 빠진다');
});
