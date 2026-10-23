// W8(처음 사용 점검 3회차, 2026-10-24 "업무정의서로 시작하는 재무팀 대리") + W9(재검증 R11, 승인된 12.9 범위로 되돌림):
// 업무정의서 한 장을 붙였을 때 담당 절·관련 문서 절·작성 줄·제목 접두어·개요의 주기/마감을 읽어 사람·산출물·작성 주체·업무 속성이 채워지는지.
// 원문(가상)은 tests/fixtures/w8/tax-prepay.md. 읽혀야 하는 것과 읽히면 안 되는 것(지어내기)을 함께 본다.
//
// 두 판으로 나뉜다. CONVERT_RULES.cr17j(CR-17 J 스위치 9개)가
//   - 꺼짐(기본값) = 승인된 02-design 12.9.1 v1·12.9.2 D-P3·D-P6 그대로. 담당 절은 「역할」 사람만(연결 없음), 관련 문서는 산출물(꼭지가 담음, 괄호는 설명),
//     작성 줄은 값 그대로, 개요의 문장에서 설명·주기·마감을 고르지 않는다.
//   - 켬(CR-17 J ①을 승인받으면 켤 값) = W8 때 동작.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONVERT_RULES, assignmentsOf, authorOf, convertDocument, deadlineIn, docWorkLabel, looksLikeAssignee, looksLikePlace, looksLikePersonName, periodIn, stripDocPrefix } from '../app/src/rules/doc-convert.js';
import { validateDocument } from '../app/src/model/validate.js';
import { previewImport } from '../app/src/model/import.js';
import { buildView } from '../app/src/view/view.js';
import { formReport } from '../app/src/rules/form.js';
import { noteText } from '../app/src/ui/import.js';

const ctx = { now: '2026-10-24T10:00:00+09:00', random: () => 0.5 };
const SWITCHES = ['assignPerforms', 'namedPersonPlain', 'relatedDocLink', 'pathToLocation', 'authorPickOrg', 'authorDate', 'summaryToWork', 'periodDeadline', 'previewRenameWork'];
const ALL_ON = Object.fromEntries(SWITCHES.map((k) => [k, true]));
const conv = (text, cr17j) => {
  const r = convertDocument(text, cr17j ? { ...ctx, cr17j } : ctx);
  assert.equal(r.ok, true, JSON.stringify(r.error));
  return r;
};
const convOn = (text) => conv(text, ALL_ON);
const TAX = readFileSync(new URL('./fixtures/w8/tax-prepay.md', import.meta.url), 'utf8');
const CARD = readFileSync(new URL('./fixtures/w9/card-recon.txt', import.meta.url), 'utf8');
const byLabel = (doc, label) => doc.nodes.find((n) => n.label === label);
const edgesOf = (doc, type) => doc.edges.filter((e) => e.core_type === type).map((e) => `${doc.nodes.find((n) => n.id === e.source).label}>${doc.nodes.find((n) => n.id === e.target).label}`);
const labelsOf = (doc, type) => doc.nodes.filter((n) => n.core_type === type).map((n) => n.label);
const codes = (r) => r.report.notes.map((n) => n.code);
const HEAD = '# 가상 업무\n- 작성 주체: 가상팀\n## 업무 범위\n- 가상 접수\n';

// ── 스위치 ───────────────────────────────────────────────────────────

test('W9 스위치: CR-17 J 스위치 9개가 CONVERT_RULES.cr17j 한 곳에 있고 기본값은 전부 꺼짐(= 승인된 12.9 동작)', () => {
  assert.deepEqual(Object.keys(CONVERT_RULES.cr17j).sort(), [...SWITCHES].sort());
  for (const [k, v] of Object.entries(CONVERT_RULES.cr17j)) assert.equal(v, false, k);
  // 한 번의 호출만 덮어쓸 수 있고, 덮어쓴 값이 설정 객체를 바꾸지 않는다
  assert.equal(labelsOf(convOn(TAX).doc, 'person').length, 2);
  assert.ok(Object.values(CONVERT_RULES.cr17j).every((v) => v === false));
  // 설정 객체를 직접 바꾸면 ctx 없이도 따라간다(켠 뒤 반드시 되돌린다)
  const before = { ...CONVERT_RULES.cr17j };
  try {
    CONVERT_RULES.cr17j.assignPerforms = true;
    assert.deepEqual(edgesOf(conv(TAX).doc, 'performs'), ['류다온>법인세 중간예납 준비']);
  } finally {
    Object.assign(CONVERT_RULES.cr17j, before);
  }
  assert.deepEqual(edgesOf(conv(TAX).doc, 'performs'), []);
});

test('W9 스위치 하나씩: 각 스위치는 자기 동작만 바꾼다(법인세 중간예납 사례)', () => {
  const only = (k) => conv(TAX, { [k]: true }).doc;
  const work = (d) => d.nodes.find((n) => n.core_type === 'work');
  // assignPerforms: 담당 연결만
  assert.deepEqual(edgesOf(only('assignPerforms'), 'performs'), ['류다온>법인세 중간예납 준비']);
  assert.equal(byLabel(only('assignPerforms'), '류다온').subtype, '역할');
  // namedPersonPlain: 이름 모양 사람의 하위 유형만
  assert.equal(byLabel(only('namedPersonPlain'), '류다온').subtype, undefined);
  assert.equal(byLabel(only('namedPersonPlain'), '가상재무팀장').subtype, '역할');
  assert.deepEqual(edgesOf(only('namedPersonPlain'), 'performs'), []);
  // relatedDocLink: 연결만(위치 속성은 그대로 설명)
  assert.deepEqual(edgesOf(only('relatedDocLink'), 'references'), ['법인세 중간예납 준비>중간예납 계산표']);
  assert.equal(byLabel(only('relatedDocLink'), '중간예납 계산표').attrs.위치, undefined);
  // pathToLocation: 속성 「위치」만
  assert.equal(byLabel(only('pathToLocation'), '중간예납 계산표').attrs.위치, '공유 드라이브 > 재무 > 세무');
  assert.deepEqual(edgesOf(only('pathToLocation'), 'references'), []);
  // 작성 줄
  assert.equal(conv(TAX, { authorPickOrg: true }).doc.universe.owner, '가상재무팀');
  const byline = '# 가상 업무\n- 작성자: 가상재무팀 류다온 / 2026-09-01\n## 업무 범위\n- 가상 접수\n';
  assert.equal(conv(byline, { authorPickOrg: true }).doc.universe.owner, '가상재무팀');
  assert.ok(codes(conv(byline, { authorPickOrg: true })).includes('C-DATE-ASSUMED'), '날짜는 따로 읽지 않으면 작성일 없음 알림');
  assert.equal(conv(byline, { authorDate: true }).doc.universe.owner, '가상재무팀 류다온 / 2026-09-01', '날짜만 읽으면 작성 주체는 값 그대로');
  assert.ok(!codes(conv(byline, { authorDate: true })).includes('C-DATE-ASSUMED'));
  // 개요
  assert.equal(work(only('summaryToWork')).description, '매년 8월 법인세 중간예납 세액을 계산하고 신고서를 준비한다.');
  assert.equal(work(only('summaryToWork')).attrs.주기, undefined);
  assert.equal(work(only('periodDeadline')).description, undefined);
  assert.equal(work(only('periodDeadline')).attrs.주기, '매년 8월');
  assert.equal(work(only('periodDeadline')).attrs.마감, '8월 31일까지');
});

// ── 기본값(꺼짐) = 승인된 12.9 범위 ──────────────────────────────────

test('W9 기본값 고정 사례: 법인세 중간예납 정의서 → 꼭지 1·업무 1·사람 2(역할)·산출물 1, 담당 연결 없음, 작성 주체는 원문 값 그대로', () => {
  const { doc, report } = conv(TAX);
  assert.equal(doc.nodes.filter((n) => n.core_type === 'root').length, 1);
  assert.equal(doc.nodes.filter((n) => n.core_type === 'work').length, 1);
  assert.deepEqual(labelsOf(doc, 'person'), ['류다온', '가상재무팀장'], '라벨은 원문 이름 그대로');
  assert.ok(doc.nodes.filter((n) => n.core_type === 'person').every((n) => n.subtype === '역할'), '12.9.1 v1: 이해관계자는 하위 유형 「역할」');
  assert.ok(doc.universe.subtypes.some((s) => s.core_type === 'person' && s.name === '역할'));
  assert.deepEqual(labelsOf(doc, 'artifact'), ['중간예납 계산표']);
  assert.equal(doc.nodes.filter((n) => n.core_type === 'topic').length, 0, '담당·관련 문서가 주제(규칙 밖)로 가지 않음');
  assert.ok(!codes({ report }).includes('C-TOPIC-GUESS'));
  // R12-2: 키가 그냥 「작성」이면 작성 주체로 읽지 않는다(W8 전과 같게 입력받는다. 날짜는 예전처럼(F4) 작성일 후보)
  assert.equal(doc.universe.owner, '', 'R12-2: 「작성: 가상재무팀 류다온 / 2026-09-01」을 통째로 작성 주체로 쓰지 않는다');
  assert.ok(codes({ report }).includes('C-NO-OWNER'));
  assert.ok(!codes({ report }).includes('C-DATE-ASSUMED'), '키가 그냥 「작성」이면 같은 줄의 날짜는 예전처럼(F4) 작성일 후보');
  assert.equal(doc.nodes.length, 5);
  assert.ok(codes({ report }).includes('C-TOO-FEW'));
  doc.universe.owner = '가상재무팀'; // 미리 보기에서 입력한 뒤
  assert.equal(validateDocument(doc).ok, true);
});

test('W9 기본값 담당: 사람은 역할(라벨 원문), 업무와 이어지지 않고 꼭지가 담는다(D-P3: 담당 연결은 만들지 않음)', () => {
  const { doc, report } = conv(TAX);
  const ryu = byLabel(doc, '류다온');
  const head = byLabel(doc, '가상재무팀장');
  assert.equal(ryu.subtype, '역할');
  assert.equal(ryu.emp_no, undefined, '사번은 만들지 않는다');
  assert.equal(ryu.description, '주 담당', '원문 키는 설명으로 남는다');
  assert.deepEqual(edgesOf(doc, 'performs'), []);
  for (const p of [ryu, head]) assert.ok(doc.edges.some((e) => e.source === doc.universe.root_node_id && e.target === p.id && e.core_type === 'contains'), `${p.label}: 꼭지가 담는다(떨어져 보이지 않게)`);
  assert.ok(!codes({ report }).includes('C-PERFORMS-GUESS'));
  assert.ok(!codes({ report }).includes('C-ASSIGN-SKIPPED'), '스위치가 꺼진 기본값에서는 나오지 않는다');
});

test('W9 기본값 관련 문서: 산출물 노드, 괄호는 설명, 꼭지가 담는다(12.9.1 v1)', () => {
  const { doc } = conv(TAX);
  const art = byLabel(doc, '중간예납 계산표');
  assert.equal(art.description, '공유 드라이브 > 재무 > 세무');
  assert.equal(art.attrs.위치, undefined);
  assert.deepEqual(edgesOf(doc, 'references'), []);
  assert.deepEqual(edgesOf(doc, 'produces'), []);
  assert.ok(doc.edges.some((e) => e.core_type === 'contains' && e.source === doc.universe.root_node_id && e.target === art.id));
});

test('W9 기본값 개요: 대표 업무에 문장에서 고른 설명·주기·마감을 넣지 않는다(12.9는 개요의 주기·마감 「항목」만)', () => {
  const { doc } = conv(TAX);
  const w = doc.nodes.find((n) => n.core_type === 'work');
  assert.equal(w.description, undefined);
  assert.equal(w.attrs.주기, undefined);
  assert.equal(w.attrs.마감, undefined);
  assert.ok(!w.attrs.원문.split(', ').includes('§1'));
  // 개요 표의 명시 값(「주기: …」)은 스위치와 상관없이 읽는다
  const explicit = conv('# 가상 업무\n- 작성 주체: 가상팀\n## 개요\n| 항목 | 내용 |\n|---|---|\n| 업무명 | 가상 대사 |\n| 주기 | 매월 |\n| 마감 | 5일 |\n');
  assert.equal(explicit.doc.nodes.find((n) => n.core_type === 'work').attrs.주기, '매월');
  assert.equal(explicit.doc.nodes.find((n) => n.core_type === 'work').attrs.마감, '5일');
  // 오탐 R11-3: 꺼진 기본값에서는 문장 속 낱말이 속성이 되지 않는다
  const prose = conv('# 가상 세무 안내\n- 작성 주체: 가상팀\n## 개요\n매년 개정되는 세법을 확인한다. 문의는 3일 이내 회신한다.\n').doc.nodes.find((n) => n.core_type === 'work');
  assert.equal(prose.attrs.주기, undefined);
  assert.equal(prose.attrs.마감, undefined);
});

test('W9 기본값 표준 양식: 설명·주기·마감·관련 문서·담당은 비어 있음으로 나온다(원문 문장에서 채우지 않음). 절차·주의사항은 채워짐', () => {
  const { doc } = conv(TAX);
  const full = { ...doc, universe: { ...doc.universe, owner: '가상재무팀' } };
  const fr = formReport(buildView(full, () => null));
  assert.equal(fr.total, 1);
  assert.equal(fr.incomplete, 1);
  assert.deepEqual(fr.works[0].missing, ['설명', '주기', '마감', '관련 문서', '담당']);
  assert.deepEqual(previewImport(full).errors, []);
});

// ── 켬(CR-17 J ① 승인 뒤의 값) = W8 동작 ─────────────────────────────

test('W8 고정 사례(스위치 켬): 법인세 중간예납 정의서 → 꼭지 1·업무 1·사람 2·산출물 1, 담당 1건, 작성 주체 가상재무팀', () => {
  const { doc, report } = convOn(TAX);
  assert.equal(doc.nodes.filter((n) => n.core_type === 'root').length, 1);
  assert.equal(doc.nodes.filter((n) => n.core_type === 'work').length, 1);
  assert.deepEqual(labelsOf(doc, 'person'), ['류다온', '가상재무팀장']);
  assert.deepEqual(labelsOf(doc, 'artifact'), ['중간예납 계산표']);
  assert.equal(labelsOf(doc, 'topic').length, 0, '담당·관련 문서가 주제(규칙 밖)로 가지 않음');
  assert.ok(!codes({ report }).includes('C-TOPIC-GUESS'));
  assert.equal(doc.universe.owner, '가상재무팀');
  assert.ok(!codes({ report }).includes('C-NO-OWNER'));
  assert.ok(!codes({ report }).includes('C-DATE-ASSUMED'), '작성 줄 속 날짜를 작성일로 읽음');
  assert.equal(doc.nodes.length, 5);
  assert.ok(codes({ report }).includes('C-TOO-FEW'), '노드 수 알림은 그대로(문구만 덜 겁주게)');
  assert.equal(validateDocument(doc).ok, true);
});

test('W8 담당(스위치 켬): 류다온은 사람(하위 유형 없음)이고 업무를 맡음(performs 1건), 가상재무팀장은 역할이고 검토자라 업무에 잇지 않음', () => {
  const { doc, report } = convOn(TAX);
  const ryu = byLabel(doc, '류다온');
  const head = byLabel(doc, '가상재무팀장');
  assert.equal(ryu.subtype, undefined);
  assert.equal(head.subtype, '역할');
  assert.equal(ryu.emp_no, undefined, '사번은 만들지 않는다');
  assert.deepEqual(edgesOf(doc, 'performs'), ['류다온>법인세 중간예납 준비']);
  assert.ok(!doc.edges.some((e) => e.source === head.id && e.target !== doc.universe.root_node_id && e.core_type !== 'contains'));
  assert.ok(doc.edges.some((e) => e.source === doc.universe.root_node_id && e.target === head.id && e.core_type === 'contains'), '꼭지가 담는다(떨어져 보이지 않게)');
  assert.deepEqual(report.notes.find((n) => n.code === 'C-PERFORMS-GUESS'), { code: 'C-PERFORMS-GUESS', count: 1, assigned: 1 });
  assert.match(doc.edges.find((e) => e.core_type === 'performs').note, /주 담당/);
  assert.ok(doc.universe.subtypes.some((s) => s.core_type === 'person' && s.name === '역할'));
});

test('W8 관련 문서(스위치 켬): 「이름(경로)」는 산출물 이름 + 위치 속성, 대표 업무 → references(만든 문서인지 원문에 없어 「참조」, CR-17 J)', () => {
  const { doc } = convOn(TAX);
  const art = byLabel(doc, '중간예납 계산표');
  assert.equal(art.attrs.위치, '공유 드라이브 > 재무 > 세무');
  assert.ok(!art.description, '경로가 설명에 들어가지 않음');
  assert.deepEqual(edgesOf(doc, 'references'), ['법인세 중간예납 준비>중간예납 계산표']);
  assert.match(doc.edges.find((e) => e.core_type === 'references').note, /만든 문서인지 참고한 문서인지는 원문에 없음/);
});

test('W8 개요(스위치 켬): 첫 문장은 업무 설명, 「매년 8월」은 주기, 「8월 31일까지」는 마감(원문 구절 그대로)', () => {
  const { doc } = convOn(TAX);
  const w = doc.nodes.find((n) => n.core_type === 'work');
  assert.equal(w.description, '매년 8월 법인세 중간예납 세액을 계산하고 신고서를 준비한다.');
  assert.equal(w.attrs.주기, '매년 8월');
  assert.equal(w.attrs.마감, '8월 31일까지');
  assert.ok(w.attrs.원문.split(', ').includes('§1'));
});

test('W8 표준 양식(스위치 켬): 변환 결과는 권장 항목이 비어 있지 않다(설명·절차·주기·마감·주의사항·관련 문서·담당 모두 원문에 있음)', () => {
  const { doc } = convOn(TAX);
  const full = { ...doc, universe: { ...doc.universe, owner: '가상재무팀' } };
  const fr = formReport(buildView(full, () => null));
  assert.equal(fr.total, 1);
  assert.equal(fr.incomplete, 0, JSON.stringify(fr.works));
  assert.deepEqual(previewImport(full).errors, []);
});

test('W8 지어내지 않기(스위치 켬·꺼짐 모두): 업무가 여러 개면 설명·주기·마감·담당·관련 문서를 첫 업무에 붙이지 않는다', () => {
  const text = ['# 가상 업무정의서', '- 작성 부서: 가상재무팀 / 2026-09-01', '## 개요', '매월 말 가상 정산과 가상 접수를 처리한다.', '## 범위', '- 가상 정산', '- 가상 접수',
    '## 절차', '1. 5영업일 이내 가상 접수', '## 관련 문서', '- 가상 계산표(공유 드라이브 > 재무)', '## 담당', '- 주 담당: 류다온 / 검토: 가상재무팀장', ''].join('\n');
  for (const on of [false, true]) {
    const { doc, report } = on ? convOn(text) : conv(text);
    const first = byLabel(doc, '가상 정산');
    assert.equal(first.description, undefined, `on=${on}`);
    assert.equal(first.attrs.주기, undefined, `on=${on}`);
    assert.equal(first.attrs.마감, undefined, `on=${on}`);
    assert.deepEqual(edgesOf(doc, 'performs'), [], `on=${on}`);
    assert.deepEqual(edgesOf(doc, 'produces'), [], `on=${on}`);
    assert.deepEqual(edgesOf(doc, 'references'), [], `on=${on}`);
    // 알림 C-ASSIGN-SKIPPED는 스위치가 켜졌을 때만
    assert.deepEqual(report.notes.find((n) => n.code === 'C-ASSIGN-SKIPPED'), on ? { code: 'C-ASSIGN-SKIPPED', count: 1 } : undefined, `on=${on}`);
    assert.equal(byLabel(doc, '가상 계산표').attrs.위치, on ? '공유 드라이브 > 재무' : undefined, `on=${on}`);
    assert.ok(doc.edges.some((e) => e.core_type === 'contains' && e.source === doc.universe.root_node_id && e.target === byLabel(doc, '가상 계산표').id), `on=${on}`);
    assert.equal(validateDocument(doc).ok, true, `on=${on}`);
  }
});

// ── 스위치와 무관하게 켜 둔 것(승인 범위 안의 낱말·모양 보강) ──────────

test('W8 제목 접두어: 업무 이름에서 「업무정의서:」를 떼고 꼭지 이름은 제목 그대로', () => {
  for (const r of [conv(TAX), convOn(TAX)]) {
    assert.equal(r.doc.universe.name, '업무정의서: 법인세 중간예납 준비');
    assert.equal(r.doc.nodes.find((n) => n.core_type === 'root').label, '업무정의서: 법인세 중간예납 준비');
    assert.equal(r.doc.nodes.find((n) => n.core_type === 'work').label, '법인세 중간예납 준비');
  }
  for (const [t, want] of [['업무정의서: 법인세', '법인세'], ['업무 정의서 - 법인세', '법인세'], ['[업무정의서] 법인세', '법인세'], ['【업무 정의서】법인세', '법인세'], ['업무정의서 : 법인세', '법인세']]) {
    assert.equal(stripDocPrefix(t), want, t);
  }
  // 떼면 안 되는 것: 구분 기호·괄호 없는 낱말, 접두어뿐인 제목, 중간에 낱말이 있는 제목
  for (const t of ['업무정의서 작성 가이드', '업무정의서', '업무정의서:', '법인세 업무정의서: 개정', '업무정의서 양식 안내']) assert.equal(stripDocPrefix(t), t, t);
  assert.equal(docWorkLabel('업무정의서: ' + '가'.repeat(60)), '가'.repeat(39) + '…');
});

test('W9 작성 줄(기본값): 「작성자:」「작성 부서:」는 값 그대로(D-P6), 「작성:」은 작성 주체로 읽지 않는다(R12-2)', () => {
  for (const key of ['작성자', '작성 부서']) {
    const { doc, report } = conv(`# 가상 업무\n- ${key}: 가상재무팀 류다온 / 2026-09-01\n## 업무 범위\n- 가상 접수\n`);
    assert.equal(doc.universe.owner, '가상재무팀 류다온 / 2026-09-01', key);
    assert.ok(!doc.universe.description.includes('머리말'), key);
    assert.ok(!codes({ report }).includes('C-NO-OWNER'), key);
    assert.ok(codes({ report }).includes('C-DATE-ASSUMED'), `${key}: 작성자·작성 부서 줄의 날짜는 읽지 않음(예전과 같음)`);
  }
  // 키가 그냥 「작성」: 작성 주체는 입력받고(C-NO-OWNER), 줄은 머리말 글로 남으며, 같은 줄 날짜만 작성일 후보(F4)
  const bare = conv('# 가상 업무\n- 작성: 가상재무팀 류다온 / 2026-09-01\n## 업무 범위\n- 가상 접수\n');
  assert.equal(bare.doc.universe.owner, '');
  assert.ok(codes(bare).includes('C-NO-OWNER'));
  assert.ok(bare.doc.universe.description.includes('머리말: 작성: 가상재무팀 류다온 / 2026-09-01'));
  assert.ok(!codes(bare).includes('C-DATE-ASSUMED'));
  // 키가 그냥 「작성」이면 같은 줄 날짜는 예전처럼(F4) 작성일 후보
  const f4 = conv('# 가상 업무\n- 작성: 가상구매팀 / 2026.09.05\n## 업무 범위\n- 가상 접수\n## 확인할 질문\n1. 가상 질문?\n');
  assert.ok(!codes(f4).includes('C-DATE-ASSUMED'));
  assert.equal(f4.doc.events.find((e) => e.type === 'memo').occurred_at, '2026-09-05');
  assert.equal(conv('# 가상 업무\n- 작성자: 류다온\n## 업무 범위\n- 가상 접수\n').doc.universe.owner, '류다온');
  // 날짜뿐인 값은 어떤 키든 작성 주체가 아니다
  for (const key of ['작성', '작성자', '작성 부서']) {
    const d = conv(`# 가상 업무\n- ${key}: 2026-09-01\n## 업무 범위\n- 가상 접수\n`);
    assert.equal(d.doc.universe.owner, '', key);
    assert.ok(codes(d).includes('C-NO-OWNER'), key);
  }
});

test('W8 작성 줄(스위치 켬): 「작성:」「작성자:」「작성 부서:」에서 조직 낱말만 작성 주체로, 날짜는 작성일로', () => {
  assert.deepEqual(authorOf('가상재무팀 류다온 / 2026-09-01'), { owner: '가상재무팀', date: '2026-09-01' });
  assert.deepEqual(authorOf('가상 재무팀 류다온 대리 / 2026.09.01'), { owner: '가상 재무팀', date: '2026-09-01' });
  assert.deepEqual(authorOf('류다온 / 가상정산팀'), { owner: '가상정산팀', date: null });
  assert.deepEqual(authorOf('류다온 대리'), { owner: '류다온 대리', date: null }, '조직 낱말이 없으면 그대로(D-P6)');
  assert.deepEqual(authorOf('2026-09-01'), { owner: null, date: '2026-09-01' });
  assert.deepEqual(authorOf('총무 담당'), { owner: '총무 담당', date: null }, '총무는 조직 낱말이 아니다');
  for (const key of ['작성', '작성자', '작성 부서']) {
    const { doc, report } = convOn(`# 가상 업무\n- ${key}: 가상재무팀 류다온 / 2026-09-01\n## 업무 범위\n- 가상 접수\n`);
    assert.equal(doc.universe.owner, '가상재무팀', key);
    assert.ok(!doc.universe.description.includes('머리말'), key);
    assert.ok(!codes({ report }).includes('C-DATE-ASSUMED'), key);
  }
  const keep = convOn('# 가상 업무\n- 작성자: 류다온\n## 업무 범위\n- 가상 접수\n');
  assert.equal(keep.doc.universe.owner, '류다온');
  const none = convOn('# 가상 업무\n- 작성: 2026-09-01\n## 업무 범위\n- 가상 접수\n');
  assert.equal(none.doc.universe.owner, '');
  assert.ok(none.report.notes.some((n) => n.code === 'C-NO-OWNER'));
});

test('W9 탭으로 나뉜 머리줄: 「문서번호: …⇥작성일: …⇥작성 부서: …」는 칸마다 읽는다(작성 부서는 값 그대로, 작성일은 날짜)', () => {
  const { doc, report } = conv(['가상 업무 정의서', '문서번호: 제2026-가상-07호\t작성일: 2026. 9. 22.\t작성 부서: 가상 정산팀', '', '1. 업무 범위', '□ 가상 접수', '2. 확인할 질문', '1) 가상 질문?', ''].join('\n'));
  assert.equal(doc.universe.owner, '가상 정산팀');
  assert.ok(!codes({ report }).includes('C-DATE-ASSUMED'));
  assert.equal(doc.events.find((e) => e.type === 'memo').occurred_at, '2026-09-22');
  assert.deepEqual(labelsOf(doc, 'work'), ['가상 접수']);
  // 가상 카드 매입 대사 예시 문서(사용자가 실제로 붙이는 모양)
  const card = conv(CARD);
  assert.equal(card.doc.universe.owner, '가상 정산팀', '탭 머리줄의 작성 부서가 본문 「작성자: 정산 담당」보다 먼저');
  assert.ok(!codes(card).includes('C-DATE-ASSUMED'));
});

test('W9 범위 제외: 범위 절 안의 「※ … 다루지 않음/제외/별도」 줄은 업무 노드가 아니라 유니버스 설명의 범위 제외(12.9 「범위 제외는 노드로 만들지 않음」)', () => {
  const { doc, report } = conv(HEAD + '- 가상 처리\n※ 가상 정산은 이 문서에서 다루지 않음(별도 업무정의서)\n※ 가상 지급은 범위 제외\n');
  assert.deepEqual(labelsOf(doc, 'work'), ['가상 접수', '가상 처리']);
  assert.match(doc.universe.description, /범위 제외: 가상 정산은 이 문서에서 다루지 않음\(별도 업무정의서\), 가상 지급은 범위 제외/);
  assert.equal(report.sections.find((s) => s.kind === 'scope').made, 2);
  // 가상 카드 매입 대사 예시 문서
  const card = conv(CARD);
  assert.deepEqual(labelsOf(card.doc, 'work'), ['매입 자료 수신', '승인-매입 대사', '불일치 건 처리', '대사 결과 보고']);
  assert.match(card.doc.universe.description, /범위 제외: 수수료 계산과 가맹점 지급은 이 문서에서 다루지 않음\(별도 업무정의서\)/);
  // 반대편: ※가 아닌 줄, 범위 제외 낱말이 없는 ※ 줄은 지금처럼 업무
  const keep = conv(HEAD + '※ 가상 수시 점검\n- 가상 정산은 이 문서에서 다루지 않음\n').doc;
  assert.deepEqual(labelsOf(keep, 'work'), ['가상 접수', '가상 수시 점검', '가상 정산은 이 문서에서 다루지 않음']);
});

test('W8 절 분류 낱말: 「담당」류는 사람 절, 「관련 문서」류는 산출물 절. 「담당 업무」「문서 관리 규정」은 그대로 주제', () => {
  const kindOf = (title) => conv(`# 가상 업무\n- 작성 주체: 가상팀\n## 업무 범위\n- 가상 접수\n## ${title}\n- 주 담당: 류다온\n`).report.sections.find((s) => s.title === title).kind;
  for (const t of ['담당', '5. 담당', '담당자', '주 담당', '담당 및 검토', '담당/검토', '담당자 및 검토자']) assert.equal(kindOf(t), 'people', t);
  for (const t of ['관련 문서', '관련 자료', '참고 문서', '참고 자료', '첨부 서류', '관련 문서 목록']) assert.equal(kindOf(t), 'artifacts', t);
  for (const t of ['담당 업무', '문서 관리 규정', '관련 법령']) assert.equal(kindOf(t), 'topic', t);
});

test('W8 담당 줄 읽기: 키는 사람 노드(역할)로, 스위치 켜면 주 담당·담당·정만 업무를 맡음 / 두 칸 표 / 이름 모양 판정', () => {
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
  const tblText = '# 가상 업무\n- 작성 주체: 가상팀\n## 업무 범위\n- 가상 접수\n## 담당\n| 구분 | 이름 |\n|---|---|\n| 주 담당 | 류다온 |\n| 협조 | 가상정산담당 |\n';
  const off = conv(tblText);
  assert.deepEqual(edgesOf(off.doc, 'performs'), []);
  assert.deepEqual(labelsOf(off.doc, 'person'), ['류다온', '가상정산담당']);
  assert.ok(off.doc.nodes.filter((n) => n.core_type === 'person').every((n) => n.subtype === '역할'));
  const on = convOn(tblText);
  assert.deepEqual(edgesOf(on.doc, 'performs'), ['류다온>가상 접수']);
  assert.equal(byLabel(on.doc, '가상정산담당').subtype, '역할');
  const wkText = '# 가상 업무\n- 작성 주체: 가상팀\n## 업무 범위\n- 가상 접수\n## 담당\n- 정: 류다온\n- 부: 한가상\n- 협조: 가상정산담당\n';
  assert.deepEqual(edgesOf(conv(wkText).doc, 'performs'), []);
  const wk = convOn(wkText);
  assert.deepEqual(edgesOf(wk.doc, 'performs'), ['류다온>가상 접수']);
  assert.ok(byLabel(wk.doc, '한가상') && byLabel(wk.doc, '가상정산담당'));
  // 기존 이해관계자 절(「역할: 하는 일」)은 그대로
  const old = conv('# 가상 업무\n- 작성 주체: 가상팀\n## 업무 범위\n- 가상 접수\n## 이해관계자\n- 운영 담당: 가상 접수\n');
  assert.equal(byLabel(old.doc, '운영 담당').subtype, '역할');
  assert.deepEqual(edgesOf(old.doc, 'performs'), ['운영 담당>가상 접수'], '하는 일에 업무 이름이 적힌 경우는 12.9대로 스위치와 상관없이 연결');
});

test('W9 R11-2: 담당 절 줄의 값이 문장이거나 사람·역할 낱말이 아닌 한 낱말이면 사람을 만들지 않고 절의 주제 설명으로(스위치 켬·꺼짐 모두)', () => {
  for (const [value, why] of [
    ['접수 및 처리는 총괄 부서가 수행한다', '…한다로 끝남'],
    ['가상 접수를 맡아 매월 말까지 정산 자료를 모두 확인함', '…함으로 끝나고 공백 많음'],
    ['가상 접수 업무와 정산 업무 그리고 보고 업무 전체를 처리', '공백 3개 초과'],
    ['가상 정산 자료를 확인하고 부서장에게 보고하는 업무를 총괄하여 담당하는 사람', '40자 초과'],
    ['외부', '한 낱말(외부)'],
    ['총괄', '한 낱말(총괄)'],
    ['해당 없음.', '문장 부호로 끝남'],
  ]) {
    for (const [i, r] of [conv(`${HEAD}## 담당\n- 주 담당: ${value}\n- 검토: 가상재무팀장\n`), convOn(`${HEAD}## 담당\n- 주 담당: ${value}\n- 검토: 가상재무팀장\n`)].entries()) {
      assert.deepEqual(labelsOf(r.doc, 'person'), ['가상재무팀장'], `${why} (on=${i})`);
      assert.ok(codes(r).includes('C-PEOPLE-PROSE'), `${why} (on=${i})`);
      assert.deepEqual(edgesOf(r.doc, 'performs'), [], `${why} (on=${i}): 문장은 담당 연결이 되지 않음`);
      assert.ok(labelsOf(r.doc, 'topic').includes('담당'), `${why} (on=${i}): 주제 노드로`);
      assert.equal(validateDocument(r.doc).ok, true, why);
    }
  }
  // 판정 함수
  for (const ok of ['류다온', '가상재무팀장', '운영 담당', '정산 보조', '가상카드사 A 담당', '류다온(대리)', '가상재무팀']) assert.equal(looksLikeAssignee(ok), true, ok);
  for (const no of ['외부', '총괄', '접수는 총괄 부서가 수행한다', '진행함', '가나다 라마바 사아자 차카타 파하', '', '[미확인]']) assert.equal(looksLikeAssignee(no), false, no);
  // 반대편: 이름·역할이면 지금처럼 사람
  const good = conv(`${HEAD}## 담당\n- 주 담당: 류다온\n- 검토: 가상재무팀장\n`);
  assert.deepEqual(labelsOf(good.doc, 'person'), ['류다온', '가상재무팀장']);
  assert.ok(!codes(good).includes('C-PEOPLE-PROSE'));
});

test('W8 경로 모양: >, \\, a/b/c, 드라이브·폴더는 위치(스위치 켬). 형식·수량 같은 괄호는 설명 그대로. 꺼짐이면 모두 설명', () => {
  for (const p of ['공유 드라이브 > 재무 > 세무', 'D:\\재무\\세무', '재무/세무/2026', 'https://example.invalid/a', '재무 폴더', '/srv/가상/문서']) assert.equal(looksLikePlace(p), true, p);
  for (const p of ['PDF/엑셀', '엑셀', '1부', '월 1회 갱신', '신고서 초안']) assert.equal(looksLikePlace(p), false, p);
  const text = '# 가상 업무\n- 작성 주체: 가상팀\n## 업무 범위\n- 가상 접수\n## 산출물\n- 가상 보고서(PDF/엑셀)\n- 가상 점검표(공유 폴더 > 점검)\n';
  const { doc } = convOn(text);
  assert.equal(byLabel(doc, '가상 보고서').description, 'PDF/엑셀');
  assert.equal(byLabel(doc, '가상 보고서').attrs.위치, undefined);
  assert.equal(byLabel(doc, '가상 점검표').attrs.위치, '공유 폴더 > 점검');
  assert.equal(byLabel(doc, '가상 점검표').description, undefined);
  assert.deepEqual(edgesOf(doc, 'produces'), [], '산출물 절은 현행대로 꼭지가 담는다');
  const off = conv(text).doc;
  assert.equal(byLabel(off, '가상 점검표').description, '공유 폴더 > 점검');
  assert.equal(byLabel(off, '가상 점검표').attrs.위치, undefined);
});

test('W8 개요 구절 고르기(스위치 켬에서 쓰는 함수): 주기·마감 구절은 원문 그대로, 확실하지 않으면 null', () => {
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

// ── 미리 보기 알림 문구 ──────────────────────────────────────────────

test('W9 알림 문구(R11-8·9): 기본값에서는 담당 절 알림이 나오지 않고, 켰을 때만 「주 담당·담당·정으로 적힌 사람」 문구', () => {
  for (const code of ['C-PERFORMS-GUESS', 'C-ASSIGN-SKIPPED']) assert.ok(!codes(conv(TAX)).includes(code), code);
  // 기본값에서도 12.9대로 「하는 일」 항목이 업무 이름과 같으면 담당 추정(문구는 하는 일 기준)
  const duty = conv(CARD);
  const guess = duty.report.notes.find((n) => n.code === 'C-PERFORMS-GUESS');
  assert.deepEqual(guess, { code: 'C-PERFORMS-GUESS', count: 4 });
  assert.match(noteText(guess), /원문의 역할 「하는 일」 항목이 업무 이름과 같은 경우만/);
  assert.doesNotMatch(noteText(guess), /주 담당/);
  // 켠 경우: 담당 절 건수를 따로 밝힌다
  const on = convOn(TAX).report.notes.find((n) => n.code === 'C-PERFORMS-GUESS');
  assert.match(noteText(on), /1건은 담당 절에 「주 담당·담당·정」으로 적힌 사람/);
  const both = noteText({ code: 'C-PERFORMS-GUESS', count: 3, assigned: 1 });
  assert.match(both, /2건은 원문의 역할 「하는 일」 항목이 업무 이름과 같은 경우이고, 1건은 담당 절에/);
  const skipped = convOn('# 가상 업무정의서\n- 작성 주체: 가상팀\n## 범위\n- 가상 정산\n- 가상 접수\n## 담당\n- 주 담당: 류다온\n').report.notes.find((n) => n.code === 'C-ASSIGN-SKIPPED');
  assert.match(noteText(skipped), /담당 절에 「주 담당·담당·정」으로 적힌 사람 1명은 업무가 여러 개라/);
});
