// W8(처음 사용 점검 3회차, 2026-10-24 "업무정의서로 시작하는 재무팀 대리"): 업무정의서 한 장을 붙였을 때 담당 절·관련 문서 절·작성 줄·제목 접두어·개요의 주기/마감을
// 읽어 사람·산출물·작성 주체·업무 속성이 채워지는지. 원문(가상)은 tests/fixtures/w8/tax-prepay.md. 읽혀야 하는 것과 읽히면 안 되는 것(지어내기)을 함께 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assignmentsOf, authorOf, convertDocument, deadlineIn, docWorkLabel, looksLikePlace, looksLikePersonName, periodIn, stripDocPrefix } from '../app/src/rules/doc-convert.js';
import { validateDocument } from '../app/src/model/validate.js';
import { previewImport } from '../app/src/model/import.js';
import { buildView } from '../app/src/view/view.js';
import { formReport } from '../app/src/rules/form.js';

const ctx = { now: '2026-10-24T10:00:00+09:00', random: () => 0.5 };
const conv = (text) => {
  const r = convertDocument(text, ctx);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  return r;
};
const TAX = readFileSync(new URL('./fixtures/w8/tax-prepay.md', import.meta.url), 'utf8');
const byLabel = (doc, label) => doc.nodes.find((n) => n.label === label);
const edgesOf = (doc, type) => doc.edges.filter((e) => e.core_type === type).map((e) => `${doc.nodes.find((n) => n.id === e.source).label}>${doc.nodes.find((n) => n.id === e.target).label}`);

test('W8 고정 사례: 법인세 중간예납 정의서 → 꼭지 1·업무 1·사람 2·산출물 1, 담당 1건, 작성 주체 가상재무팀', () => {
  const { doc, report } = conv(TAX);
  assert.equal(doc.nodes.filter((n) => n.core_type === 'root').length, 1);
  assert.equal(doc.nodes.filter((n) => n.core_type === 'work').length, 1);
  assert.deepEqual(doc.nodes.filter((n) => n.core_type === 'person').map((n) => n.label), ['류다온', '가상재무팀장']);
  assert.deepEqual(doc.nodes.filter((n) => n.core_type === 'artifact').map((n) => n.label), ['중간예납 계산표']);
  assert.equal(doc.nodes.filter((n) => n.core_type === 'topic').length, 0, '담당·관련 문서가 주제(규칙 밖)로 가지 않음');
  assert.ok(!report.notes.some((n) => n.code === 'C-TOPIC-GUESS'));
  assert.equal(doc.universe.owner, '가상재무팀');
  assert.ok(!report.notes.some((n) => n.code === 'C-NO-OWNER'));
  assert.equal(doc.nodes.length, 5);
  assert.ok(report.notes.some((n) => n.code === 'C-TOO-FEW'), '노드 수 알림은 그대로(문구만 덜 겁주게)');
  assert.equal(validateDocument(doc).ok, true);
});

test('W8 담당: 류다온은 사람(하위 유형 없음)이고 업무를 맡음(performs 1건), 가상재무팀장은 역할이고 검토자라 업무에 잇지 않음', () => {
  const { doc, report } = conv(TAX);
  const ryu = byLabel(doc, '류다온');
  const head = byLabel(doc, '가상재무팀장');
  assert.equal(ryu.subtype, undefined);
  assert.equal(head.subtype, '역할');
  assert.equal(ryu.emp_no, undefined, '사번은 만들지 않는다');
  assert.deepEqual(edgesOf(doc, 'performs'), ['류다온>법인세 중간예납 준비']);
  assert.ok(!doc.edges.some((e) => e.source === head.id && e.target !== doc.universe.root_node_id && e.core_type !== 'contains'));
  assert.ok(doc.edges.some((e) => e.source === doc.universe.root_node_id && e.target === head.id && e.core_type === 'contains'), '꼭지가 담는다(떨어져 보이지 않게)');
  assert.deepEqual(report.notes.find((n) => n.code === 'C-PERFORMS-GUESS'), { code: 'C-PERFORMS-GUESS', count: 1 });
  assert.match(doc.edges.find((e) => e.core_type === 'performs').note, /주 담당/);
  assert.ok(doc.universe.subtypes.some((s) => s.core_type === 'person' && s.name === '역할'));
});

test('W8 관련 문서: 「이름(경로)」는 산출물 이름 + 위치 속성, 대표 업무 → references(만든 문서인지 원문에 없어 「참조」 — 메인 결정 2026-10-24, CR-17 J)', () => {
  const { doc } = conv(TAX);
  const art = byLabel(doc, '중간예납 계산표');
  assert.equal(art.attrs.위치, '공유 드라이브 > 재무 > 세무');
  assert.ok(!art.description, '경로가 설명에 들어가지 않음');
  assert.deepEqual(edgesOf(doc, 'references'), ['법인세 중간예납 준비>중간예납 계산표']);
});

test('W8 제목 접두어: 업무 이름에서 「업무정의서:」를 떼고 꼭지 이름은 제목 그대로', () => {
  const { doc } = conv(TAX);
  assert.equal(doc.universe.name, '업무정의서: 법인세 중간예납 준비');
  assert.equal(doc.nodes.find((n) => n.core_type === 'root').label, '업무정의서: 법인세 중간예납 준비');
  assert.equal(doc.nodes.find((n) => n.core_type === 'work').label, '법인세 중간예납 준비');
  for (const [t, want] of [['업무정의서: 법인세', '법인세'], ['업무 정의서 - 법인세', '법인세'], ['[업무정의서] 법인세', '법인세'], ['【업무 정의서】법인세', '법인세'], ['업무정의서 : 법인세', '법인세']]) {
    assert.equal(stripDocPrefix(t), want, t);
  }
  // 떼면 안 되는 것: 구분 기호·괄호 없는 낱말, 접두어뿐인 제목, 중간에 낱말이 있는 제목
  for (const t of ['업무정의서 작성 가이드', '업무정의서', '업무정의서:', '법인세 업무정의서: 개정', '업무정의서 양식 안내']) assert.equal(stripDocPrefix(t), t, t);
  assert.equal(docWorkLabel('업무정의서: ' + '가'.repeat(60)), '가'.repeat(39) + '…');
});

test('W8 작성 줄: 「작성:」「작성자:」「작성 부서:」에서 조직 낱말만 작성 주체로, 날짜는 작성일로', () => {
  assert.deepEqual(authorOf('가상재무팀 류다온 / 2026-09-01'), { owner: '가상재무팀', date: '2026-09-01' });
  assert.deepEqual(authorOf('가상 재무팀 류다온 대리 / 2026.09.01'), { owner: '가상 재무팀', date: '2026-09-01' });
  assert.deepEqual(authorOf('류다온 / 가상정산팀'), { owner: '가상정산팀', date: null });
  assert.deepEqual(authorOf('류다온 대리'), { owner: '류다온 대리', date: null }, '조직 낱말이 없으면 그대로(D-P6)');
  assert.deepEqual(authorOf('2026-09-01'), { owner: null, date: '2026-09-01' });
  assert.deepEqual(authorOf('총무 담당'), { owner: '총무 담당', date: null }, '총무는 조직 낱말이 아니다');
  for (const key of ['작성', '작성자', '작성 부서']) {
    const { doc } = conv(`# 가상 업무\n- ${key}: 가상재무팀 류다온 / 2026-09-01\n## 업무 범위\n- 가상 접수\n`);
    assert.equal(doc.universe.owner, '가상재무팀', key);
    assert.ok(!doc.universe.description.includes('머리말'), key);
  }
  const keep = conv('# 가상 업무\n- 작성자: 류다온\n## 업무 범위\n- 가상 접수\n');
  assert.equal(keep.doc.universe.owner, '류다온');
  const none = conv('# 가상 업무\n- 작성: 2026-09-01\n## 업무 범위\n- 가상 접수\n');
  assert.equal(none.doc.universe.owner, '');
  assert.ok(none.report.notes.some((n) => n.code === 'C-NO-OWNER'));
});

test('W8 개요: 첫 문장은 업무 설명, 「매년 8월」은 주기, 「8월 31일까지」는 마감(원문 구절 그대로)', () => {
  const { doc } = conv(TAX);
  const w = doc.nodes.find((n) => n.core_type === 'work');
  assert.equal(w.description, '매년 8월 법인세 중간예납 세액을 계산하고 신고서를 준비한다.');
  assert.equal(w.attrs.주기, '매년 8월');
  assert.equal(w.attrs.마감, '8월 31일까지');
  assert.ok(w.attrs.원문.split(', ').includes('§1'));
  // 구절 고르기
  assert.equal(periodIn('매월 말 정산한다'), '매월 말');
  assert.equal(periodIn('분기마다 점검한다'), '분기마다');
  assert.equal(periodIn('매주 월요일에 보고'), '매주 월요일');
  assert.equal(periodIn('월 2회 대사'), '월 2회');
  assert.equal(periodIn('정산을 한다'), null);
  assert.equal(periodIn('고객이 때때로 문의한다'), null);
  assert.equal(deadlineIn(['3영업일 이내 회신']), '3영업일 이내');
  assert.equal(deadlineIn(['익월 5일까지 제출']), '익월 5일까지');
  assert.equal(deadlineIn(['8월 31일까지 신고·납부']), '8월 31일까지');
  assert.equal(deadlineIn(['3영업일 이내 회신', '8월 31일까지 신고']), null, '서로 다른 마감 구절이 둘이면 넣지 않음');
  assert.equal(deadlineIn(['마감일이 주말이면 다음 영업일']), null);
  assert.equal(deadlineIn(['신고서 작성']), null);
});

test('W8 지어내지 않기: 업무가 여러 개면 설명·주기·마감·담당·관련 문서를 첫 업무에 붙이지 않는다', () => {
  const text = ['# 가상 업무정의서', '- 작성: 가상재무팀 / 2026-09-01', '## 개요', '매월 말 가상 정산과 가상 접수를 처리한다.', '## 범위', '- 가상 정산', '- 가상 접수',
    '## 절차', '1. 5영업일 이내 가상 접수', '## 관련 문서', '- 가상 계산표(공유 드라이브 > 재무)', '## 담당', '- 주 담당: 류다온 / 검토: 가상재무팀장', ''].join('\n');
  const { doc, report } = conv(text);
  const first = byLabel(doc, '가상 정산');
  assert.equal(first.description, undefined);
  assert.equal(first.attrs.주기, undefined);
  assert.equal(first.attrs.마감, undefined);
  assert.deepEqual(edgesOf(doc, 'performs'), []);
  assert.deepEqual(edgesOf(doc, 'produces'), []);
  assert.deepEqual(report.notes.find((n) => n.code === 'C-ASSIGN-SKIPPED'), { code: 'C-ASSIGN-SKIPPED', count: 1 });
  assert.equal(byLabel(doc, '가상 계산표').attrs.위치, '공유 드라이브 > 재무', '위치 속성은 업무 수와 상관없이 읽는다');
  assert.ok(doc.edges.some((e) => e.core_type === 'contains' && e.source === doc.universe.root_node_id && e.target === byLabel(doc, '가상 계산표').id));
  assert.equal(validateDocument(doc).ok, true);
});

test('W8 절 분류 낱말: 「담당」류는 사람 절, 「관련 문서」류는 산출물 절. 「담당 업무」「문서 관리 규정」은 그대로 주제', () => {
  const kindOf = (title) => conv(`# 가상 업무\n- 작성 주체: 가상팀\n## 업무 범위\n- 가상 접수\n## ${title}\n- 주 담당: 류다온\n`).report.sections.find((s) => s.title === title).kind;
  for (const t of ['담당', '5. 담당', '담당자', '주 담당', '담당 및 검토', '담당/검토', '담당자 및 검토자']) assert.equal(kindOf(t), 'people', t);
  for (const t of ['관련 문서', '관련 자료', '참고 문서', '참고 자료', '첨부 서류', '관련 문서 목록']) assert.equal(kindOf(t), 'artifacts', t);
  for (const t of ['담당 업무', '문서 관리 규정', '관련 법령']) assert.equal(kindOf(t), 'topic', t);
});

test('W8 담당 줄 읽기: 주 담당·담당·정은 업무를 맡는 쪽, 검토·부·협조는 사람만 / 두 칸 표 / 이름 모양 판정', () => {
  assert.deepEqual(assignmentsOf('주 담당: 류다온 / 검토: 가상재무팀장'), [{ key: '주 담당', name: '류다온' }, { key: '검토', name: '가상재무팀장' }]);
  assert.deepEqual(assignmentsOf('정: 류다온, 부: 한가상'), [{ key: '정', name: '류다온' }, { key: '부', name: '한가상' }]);
  assert.deepEqual(assignmentsOf('담당: 류다온'), [{ key: '담당', name: '류다온' }]);
  assert.equal(assignmentsOf('역할: 가상 정산을 한다'), null);
  assert.equal(assignmentsOf('교부: 류다온'), null, '키 앞이 낱말 중간이면 키가 아니다');
  assert.equal(assignmentsOf('가상 운영 담당'), null);
  assert.equal(looksLikePersonName('류다온'), true);
  assert.equal(looksLikePersonName('가상재무팀장'), false);
  assert.equal(looksLikePersonName('운영 담당'), false);
  assert.equal(looksLikePersonName('총무'), false);
  const tbl = conv('# 가상 업무\n- 작성 주체: 가상팀\n## 업무 범위\n- 가상 접수\n## 담당\n| 구분 | 이름 |\n|---|---|\n| 주 담당 | 류다온 |\n| 협조 | 가상정산담당 |\n');
  assert.deepEqual(edgesOf(tbl.doc, 'performs'), ['류다온>가상 접수']);
  assert.equal(byLabel(tbl.doc, '가상정산담당').subtype, '역할');
  const wk = conv('# 가상 업무\n- 작성 주체: 가상팀\n## 업무 범위\n- 가상 접수\n## 담당\n- 정: 류다온\n- 부: 한가상\n- 협조: 가상정산담당\n');
  assert.deepEqual(edgesOf(wk.doc, 'performs'), ['류다온>가상 접수']);
  assert.ok(byLabel(wk.doc, '한가상') && byLabel(wk.doc, '가상정산담당'));
  // 기존 이해관계자 절(「역할: 하는 일」)은 그대로
  const old = conv('# 가상 업무\n- 작성 주체: 가상팀\n## 업무 범위\n- 가상 접수\n## 이해관계자\n- 운영 담당: 가상 접수를 맡는다\n');
  assert.equal(byLabel(old.doc, '운영 담당').subtype, '역할');
});

test('W8 경로 모양: >, \\, a/b/c, 드라이브·폴더는 위치. 형식·수량 같은 괄호는 설명 그대로', () => {
  for (const p of ['공유 드라이브 > 재무 > 세무', 'D:\\재무\\세무', '재무/세무/2026', 'https://example.invalid/a', '재무 폴더', '/srv/가상/문서']) assert.equal(looksLikePlace(p), true, p);
  for (const p of ['PDF/엑셀', '엑셀', '1부', '월 1회 갱신', '신고서 초안']) assert.equal(looksLikePlace(p), false, p);
  const { doc } = conv('# 가상 업무\n- 작성 주체: 가상팀\n## 업무 범위\n- 가상 접수\n## 산출물\n- 가상 보고서(PDF/엑셀)\n- 가상 점검표(공유 폴더 > 점검)\n');
  assert.equal(byLabel(doc, '가상 보고서').description, 'PDF/엑셀');
  assert.equal(byLabel(doc, '가상 보고서').attrs.위치, undefined);
  assert.equal(byLabel(doc, '가상 점검표').attrs.위치, '공유 폴더 > 점검');
  assert.equal(byLabel(doc, '가상 점검표').description, undefined);
  assert.deepEqual(edgesOf(doc, 'produces'), [], '산출물 절은 현행대로 꼭지가 담는다');
});

test('W8 표준 양식: 변환 결과는 권장 항목이 비어 있지 않다(설명·절차·주기·마감·주의사항·관련 문서·담당 모두 원문에 있음)', () => {
  const { doc } = conv(TAX);
  const full = { ...doc, universe: { ...doc.universe, owner: '가상재무팀' } };
  const fr = formReport(buildView(full, () => null));
  assert.equal(fr.total, 1);
  assert.equal(fr.incomplete, 0, JSON.stringify(fr.works));
  const pre = previewImport(full);
  assert.deepEqual(pre.errors, []);
});
