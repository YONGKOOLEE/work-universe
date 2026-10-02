// T-17 문서 → 유니버스 규칙 기반 초벌 변환(CR-5 ②), 세분화 "월말 정산 수준"(사용자 결정 2026-10-03)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONVERT_RULES, convertDocument, parseDocument } from '../app/src/rules/doc-convert.js';
import { convertDocumentWith } from '../app/src/llm/connector.js';
import { createProvider } from '../app/src/llm/providers.js';
import { validateDocument } from '../app/src/model/validate.js';
import { DOC_EXAMPLE } from '../app/data/doc-example.js';
import { DOC_EDU } from './fixtures/doc-edu.js';

const ctx = { now: '2026-10-03T10:00:00+09:00', random: () => 0.5 };
const conv = (text) => convertDocument(text, ctx);
const card = () => conv(DOC_EXAMPLE.text);
const byLabel = (doc, label) => doc.nodes.find((n) => n.label === label);
const withOwner = (doc, owner = '가상 시스템분석팀') => ({ ...doc, universe: { ...doc.universe, owner } });

test('예시 문서는 inputs의 원문과 같다(옮겨 적은 것이 어긋나지 않게)', () => {
  const src = readFileSync(new URL('../inputs/시스템분석팀_신규HOST_도입분석초안.md', import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
  assert.equal(DOC_EXAMPLE.text, src);
});

test('제목·번호·표·글머리표·인용을 절로 나눈다', () => {
  const p = parseDocument(DOC_EXAMPLE.text);
  assert.equal(p.title, '카드승인 전문 송수신 업무정의서 (초안)');
  assert.deepEqual(p.sections.map((s) => s.num), ['1', '2', '3', '4', '4.1', '4.2', '4.3', '5', '5.1', '5.2', '6']);
  assert.equal(p.sections.find((s) => s.num === '4.1').parent.num, '4');
  const overview = p.sections[0].blocks[0];
  assert.equal(overview.kind, 'table');
  assert.deepEqual(overview.header, ['항목', '내용']);
  assert.equal(overview.rows.length, 6);
  assert.equal(p.preamble[0].kind, 'quote');
  assert.ok(!p.preamble[0].text.includes('**'), '굵게 표시는 걷어 낸다');
});

test('CR-3 AC ①: 예시 문서 변환 결과는 작성 주체만 채우면 스키마 검증을 통과한다', () => {
  const r = card();
  assert.equal(r.ok, true);
  const v = validateDocument(r.doc);
  assert.deepEqual(v.errors.map((e) => e.path), ['universe.owner']);
  assert.ok(r.report.notes.some((n) => n.code === 'C-NO-OWNER'));
  assert.equal(validateDocument(withOwner(r.doc)).ok, true);
});

test('세분화(월말 정산 수준): 노드 10~20개, 업무 흐름은 절차 속성, 요건 절은 주제 하나, 기관은 조직 노드 없이 소속', () => {
  const { doc, report } = card();
  const { min, max } = CONVERT_RULES.nodeTarget;
  assert.deepEqual([min, max], [10, 20]);
  assert.ok(doc.nodes.length >= min && doc.nodes.length <= max, `노드 ${doc.nodes.length}개`);
  assert.equal(report.node_count, doc.nodes.length);
  const count = (t) => doc.nodes.filter((n) => n.core_type === t).length;
  assert.deepEqual({ root: count('root'), work: count('work'), topic: count('topic'), person: count('person'), artifact: count('artifact'), org: count('org') },
    { root: 1, work: 5, topic: 4, person: 5, artifact: 3, org: 0 });
  // 범위 → 업무, 흐름 5단계 → 대표 업무(첫 범위 항목)의 절차
  assert.deepEqual(doc.nodes.filter((n) => n.core_type === 'work').map((n) => n.label), ['승인', '승인취소', '망취소', '거래 조회', '장애 시 재처리']);
  const main = byLabel(doc, '승인');
  assert.match(main.attrs.절차, /^① A사 결제 시스템이 .* ⑤ 응답이 지연되거나/);
  assert.equal(report.steps, 5);
  assert.equal(main.attrs.원문, '§1 범위, §2');
  // 주제 = 절 하나씩, 항목은 설명 줄로
  assert.deepEqual(doc.nodes.filter((n) => n.core_type === 'topic').map((n) => `${n.label}/${n.subtype}/${n.attrs.원문}`),
    ['전문 처리 요건/요건/§3', '예외 처리/예외/§4.1', '보안/보안/§4.2', '비기능 요건/비기능/§4.3']);
  assert.equal(byLabel(doc, '전문 처리 요건').description.split('\n').length, 8); // 표 6행 + 글머리표 2
  // "당사 운영·보안·정산 담당"을 셋으로, 기관은 소속 속성
  assert.deepEqual(doc.nodes.filter((n) => n.core_type === 'person').map((n) => `${n.label}/${n.attrs.소속}`),
    ['A사 결제 담당/A사', '카드사/VAN 연동 담당/카드사/VAN', '당사 운영 담당/당사', '당사 보안 담당/당사', '당사 정산 담당/당사']);
  // 산출물 순서와 괄호 설명
  const t = byLabel(doc, '테스트 케이스');
  assert.equal(t.attrs.순서, 3);
  assert.equal(t.description, '정상·타임아웃·중복·망취소');
});

test('CR-3 AC ②: 모든 노드에 원문 근거(절 번호)가 있다', () => {
  for (const n of card().doc.nodes) assert.ok(n.attrs && /§|머리말|제목|전체/.test(n.attrs.원문), `${n.id} ${n.label}: ${n.attrs && n.attrs.원문}`);
  for (const n of conv(DOC_EDU).doc.nodes) assert.ok(n.attrs && n.attrs.원문, `${n.id} ${n.label}`);
});

test('CR-3 AC ④: [가정]·[미확인] 표시는 글자 그대로 남고 노드 상태에도 적힌다', () => {
  const { doc } = card();
  assert.equal(byLabel(doc, '전문 처리 요건').attrs.상태, '미확인');
  assert.match(byLabel(doc, '전문 처리 요건').description, /\[미확인\]/);
  assert.equal(byLabel(doc, '비기능 요건').attrs.상태, '가정');
  assert.match(byLabel(doc, '비기능 요건').description, /^\(수치는 모두 \[가정\], 협의로 확정\)/);
  assert.match(doc.nodes[0].attrs.배경, /^\[가정\]/);
  assert.match(doc.universe.description, /\[가정: 후속 과제\]/);
  // 원문의 표시 수와 결과의 표시 수: 원문 표시가 하나도 사라지지 않는다
  const marks = (s) => (s.match(/\[(가정|미확인)[^\]]*\]/g) || []).length;
  const kept = [doc.universe.description, ...doc.nodes.flatMap((n) => [n.description || '', ...Object.values(n.attrs).map(String)]), ...doc.events.map((e) => e.note || '')].join(' ');
  const body = DOC_EXAMPLE.text.split('\n').filter((l) => !/^#/.test(l)).join('\n'); // 제목 줄의 표시는 주제 설명 머리에 들어감
  assert.ok(marks(kept) >= marks(body), `원문 ${marks(body)} / 결과 ${marks(kept)}`);
  const edu = conv(DOC_EDU).doc;
  assert.equal(byLabel(edu, '만족도 조사').attrs.상태, '가정');
  assert.equal(byLabel(edu, '사내 강사').attrs.상태, '미확인');
});

test('미확정 질문·리스크는 메모 이력(원문 번호 앞에, 질문=이슈·리스크=주의사항)', () => {
  const { doc } = card();
  const memos = doc.events.filter((e) => e.type === 'memo');
  assert.equal(memos.length, 8);
  assert.deepEqual(memos.map((m) => m.payload.category), ['issue', 'issue', 'issue', 'issue', 'issue', 'caution', 'caution', 'caution']);
  assert.match(memos[0].note, /^\[원문 §5\.1-1 질문\] 전문 규격/);
  assert.match(memos[5].note, /^\[원문 §5\.2-1 리스크\] 승인 불명확 거래 누락 — 영향: .* \/ 대응: 재처리 큐/);
  // 업무 이름이 나오면 그 업무에, 아니면 꼭지에
  assert.equal(memos[5].payload.target_id, byLabel(doc, '망취소').id);
  assert.equal(memos[1].payload.target_id, 'N-000');
  // 작성일이 없으면 변환일, 알림
  assert.ok(memos.every((m) => m.occurred_at === '2026-10-03' && m.source === 'system'));
  assert.ok(card().report.notes.some((n) => n.code === 'C-DATE-ASSUMED'));
});

test('지어내지 않기: 사번·담당(수행) 연결을 만들지 않고, 추정 연결에는 근거 메모가 붙는다. 떨어진 노드가 없다', () => {
  const { doc } = card();
  assert.ok(doc.nodes.every((n) => !n.emp_no));
  assert.ok(!doc.edges.some((e) => e.core_type === 'performs'));
  for (const e of doc.edges.filter((x) => x.core_type === 'relates_to')) assert.match(e.note, /^규칙 기반 추정/);
  assert.ok(doc.edges.some((e) => e.source === byLabel(doc, '당사 보안 담당').id && e.target === byLabel(doc, '보안').id));
  const linked = new Set(doc.edges.flatMap((e) => [e.source, e.target]));
  for (const n of doc.nodes.filter((x) => x.core_type !== 'root')) assert.ok(linked.has(n.id), `떨어진 노드 ${n.label}`);
});

test('모양이 다른 두 번째 문서: 범위 절·표 이해관계자·작성 주체·작성일·규칙 밖 절', () => {
  const r = conv(DOC_EDU);
  const { doc, report } = r;
  assert.equal(validateDocument(doc).ok, true);
  assert.equal(doc.universe.name, '가상 신입 교육 운영');
  assert.equal(doc.universe.owner, '가상교육팀');
  assert.deepEqual(doc.nodes.filter((n) => n.core_type === 'work').map((n) => n.label), ['강의실 예약', '강사 섭외', '만족도 조사']);
  const main = byLabel(doc, '강의실 예약');
  assert.equal(main.attrs.주기, '분기');
  assert.match(main.attrs.절차, /^① 분기 입사 예정 인원을/);
  assert.equal(byLabel(doc, '교육 운영 담당').description, '일정·강의실·출석 관리');
  assert.deepEqual(doc.nodes.filter((n) => n.core_type === 'topic').map((n) => n.label), ['운영 규칙', '비품 메모']);
  assert.ok(report.notes.some((n) => n.code === 'C-TOPIC-GUESS' && n.count === 1));
  assert.ok(report.sections.find((s) => s.title === '비품 메모').unknown);
  assert.ok(!report.notes.some((n) => n.code === 'C-DATE-ASSUMED' || n.code === 'C-NO-OWNER'));
  const memo = doc.events.find((e) => e.type === 'memo');
  assert.equal(memo.occurred_at, '2026-09-15');
  assert.equal(memo.payload.target_id, byLabel(doc, '만족도 조사').id);
  assert.deepEqual(doc.nodes.filter((n) => n.core_type === 'artifact').map((n) => `${n.label}/${n.attrs.순서}`), ['교육 일정표/1', '출석부/2', '만족도 결과 보고서/3']);
  assert.deepEqual(report.sections.map((s) => s.kind), ['scope', 'steps', 'people', 'topic', 'topic', 'memos', 'artifacts']);
});

test('오류·경계: 빈 글은 거부, 너무 긴 글은 거부, 구조 없는 글은 업무 하나와 알림, 같은 이름은 하나로', () => {
  assert.deepEqual(conv('   ').error, { code: 'E-REQUIRED', field: 'document' });
  assert.equal(conv(undefined).ok, false);
  assert.equal(conv('가'.repeat(CONVERT_RULES.maxInput + 1)).error.too_long, CONVERT_RULES.maxInput);
  const plain = conv('주간 회의록 정리\n회의 뒤 내용을 정리해 공유한다.');
  assert.equal(plain.ok, true);
  assert.equal(plain.doc.universe.name, '주간 회의록 정리');
  assert.deepEqual(plain.doc.nodes.map((n) => n.core_type), ['root', 'work']);
  assert.ok(['C-NO-SCOPE', 'C-NO-STRUCTURE', 'C-TOO-FEW'].every((c) => plain.report.notes.some((n) => n.code === c)));
  assert.equal(validateDocument(withOwner(plain.doc)).ok, true);
  const dup = conv('# 가\n## 범위\n- 접수\n- 접수\n## 1. 요건\n- 접수 기준\n## 2. 요건\n- 처리 기준');
  assert.equal(dup.doc.nodes.filter((n) => n.label === '접수').length, 1);
  const req = dup.doc.nodes.filter((n) => n.label === '요건');
  assert.equal(req.length, 1);
  assert.equal(req[0].attrs.원문, '§1, §2');
  assert.equal(validateDocument(withOwner(dup.doc)).ok, true);
});

test('노드가 많은 문서는 세분화 목표를 넘었다고 알린다(되돌리지 않고 사람이 판단)', () => {
  const big = `# 큰 문서\n## 범위\n${Array.from({ length: 25 }, (_, i) => `- 업무${i + 1}`).join('\n')}`;
  const r = conv(big);
  assert.ok(r.report.notes.some((n) => n.code === 'C-TOO-MANY' && n.count === 26));
  assert.equal(validateDocument(withOwner(r.doc)).ok, true);
});

test('긴 글은 2000자에서 자르고 알린다', () => {
  const r = conv(`# 긴 문서\n## 1. 요건\n- ${'가'.repeat(2500)}`);
  assert.ok(r.doc.nodes.find((n) => n.label === '요건').description.length <= 2000);
  assert.ok(r.report.notes.some((n) => n.code === 'C-TRUNCATED'));
});

// ── 연결부(R-15 자리, CR-3 B) ──
const ruleConvert = (t) => convertDocument(t, ctx);

test('연결부: 규칙 기반만·사전 생성은 규칙 기반 결과(사전 생성은 새 문서 결과가 없다고 알림)', () => {
  const none = convertDocumentWith(DOC_EXAMPLE.text, { provider: createProvider('none'), ruleConvert });
  assert.equal(none.method, 'rule');
  assert.equal(none.fallback, null);
  assert.equal(none.doc.nodes.length, 18);
  const pregen = convertDocumentWith(DOC_EXAMPLE.text, { provider: createProvider('pregen', { pregen: { items: [] } }), ruleConvert });
  assert.equal(pregen.method, 'rule');
  assert.equal(pregen.fallback, null, '사전 생성은 실패가 아니다');
  assert.match(pregen.note, /내장 샘플용/);
});

test('연결부: Claude API(P2)·실패 흉내는 규칙 기반으로 바뀌고 원인을 남긴다(R-04 ③)', () => {
  for (const name of ['claude_api', 'internal', 'fail']) {
    const r = convertDocumentWith(DOC_EXAMPLE.text, { provider: createProvider(name), ruleConvert });
    assert.equal(r.method, 'rule', name);
    assert.equal(r.fallback.code, 'W-LLM-FALLBACK');
    assert.match(r.fallback.reason, /^공급자 오류/);
    assert.equal(r.doc.nodes.length, 18);
  }
});

test('연결부: 공급자 결과는 검증·원문 근거를 통과해야 쓴다', () => {
  const good = withOwner(card().doc);
  const fake = (doc) => ({ name: 'test', method: 'llm', convert: () => ({ doc }) });
  const ok = convertDocumentWith('x', { provider: fake(good), ruleConvert });
  assert.equal(ok.method, 'llm');
  assert.equal(ok.doc, good);
  const noSource = JSON.parse(JSON.stringify(good));
  delete noSource.nodes[2].attrs.원문;
  assert.match(convertDocumentWith('x', { provider: fake(noSource), ruleConvert }).fallback.reason, /원문 근거/);
  const broken = JSON.parse(JSON.stringify(good));
  broken.edges[0].target = 'N-999';
  assert.match(convertDocumentWith('x', { provider: fake(broken), ruleConvert }).fallback.reason, /형식 검증/);
  assert.equal(convertDocumentWith('x', { provider: fake(null), ruleConvert }).method, 'rule');
});
