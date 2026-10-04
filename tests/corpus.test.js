// 가상 업무정의서 10건 시험(2026-10-04, tests/fixtures/corpus/doc-01~10.md, 머리 HTML 주석이 정답)에서 나온 변환기의 작은 결함 F4·F5·F8·F9·F10·F11.
// 결함마다 고쳐져야 할 것(긍정)과 바뀌면 안 되는 것(부정)을 함께 둔다(tech-record 35.2 교훈).
// 정책 문제(F1 대표 업무, F2 절 분류 낱말, F3 절차 표 담당 칸, F6 깊은 하위 절, F7 섞인 절, F4 작성 주체, F10 낱말 겹침 연결)는 여기서 다루지 않는다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { convertDocument, findDate } from '../app/src/rules/doc-convert.js';
import { validateDocument } from '../app/src/model/validate.js';

const ctx = { now: '2026-10-04T09:00:00+09:00', random: () => 0.5 };
const conv = (text) => convertDocument(text, ctx);
const corpus = (nn) => {
  const raw = readFileSync(new URL(`./fixtures/corpus/doc-${nn}.md`, import.meta.url), 'utf8').replace(/\r\n?/g, '\n');
  const cm = /^<!--([\s\S]*?)-->\s*\n/.exec(raw);
  return { text: raw.slice(cm[0].length), exp: JSON.parse(cm[1].slice(cm[1].indexOf('{'))) };
};
const of = (doc, t) => doc.nodes.filter((n) => n.core_type === t).map((n) => n.label);
const byLabel = (doc, label) => doc.nodes.find((n) => n.label === label);
const performs = (doc) => {
  const lab = new Map(doc.nodes.map((n) => [n.id, n.label]));
  return doc.edges.filter((e) => e.core_type === 'performs').map((e) => `${lab.get(e.source)}>${lab.get(e.target)}`);
};
const codes = (report) => report.notes.map((n) => n.code);
const memoDates = (doc) => doc.events.filter((e) => e.type === 'memo').map((e) => e.occurred_at);
const mini = (lines) => conv(['# 가상 시험 업무', '- 작성 주체: 가상시험팀', '- 작성일: 2026-09-01', ...lines, ''].join('\n'));

// ── F8: 범위 절의 표 행을 개요 「키: 값」으로 읽지 않는다 ──
test('F8 긍정: 범위 표의 구분 칸 값이 「마감」「주기」여도 업무가 사라지지 않고, 대표 업무 속성을 덮어쓰지 않는다(doc-01)', () => {
  const { text, exp } = corpus('01');
  const { doc } = conv(text);
  assert.deepEqual(of(doc, 'work'), exp.works);
  assert.deepEqual(performs(doc), exp.performs);
  const main = byLabel(doc, '전표 마감');
  assert.equal(main.attrs.마감, '5영업일 18:00', '개요의 마감이 범위 표 「마감 | 결산 분개」로 덮어써지지 않는다');
  assert.equal(main.attrs.주기, '월 1회 (매월 1~5영업일)');
  assert.equal(byLabel(doc, '결산 분개').description, '구분: 마감 — 감가상각·충당금 분개');
  // 범위 표 첫 칸이 「주기」(probe P1-c)
  const c = conv(['# 가상 시험', '- 작성 주체: 가상팀', '- 작성일: 2026-09-01', '## 업무 범위', '| 구분 | 업무 |', '|---|---|', '| 주기 | 가상 점검 |', '| 수시 | 가상 조치 |', ''].join('\n'));
  assert.deepEqual(of(c.doc, 'work'), ['가상 점검', '가상 조치']);
  assert.equal(byLabel(c.doc, '가상 점검').attrs.주기, undefined);
  assert.ok(!codes(c.report).includes('C-NO-SCOPE'));
  // 같은 업무 속성이 두 번 나오면 먼저 나온 값(머리말)을 둔다(전에는 뒤의 값이 덮어씀)
  const twice = mini(['- 주기: 월 1회', '## 업무 범위', '- 주기: 수시', '- 가상 접수']).doc;
  assert.equal(byLabel(twice, '가상 접수').attrs.주기, '월 1회');
});

test('F8 부정: 범위 절의 글머리표 「키: 값」, 개요 표·머리말의 「키: 값」은 지금처럼 읽고, 먼저 나온 업무 속성이 이긴다', () => {
  // 글머리표 「목적: …」은 개요 키로 읽는다(probe P1-d, 업무가 되지 않음)
  const { doc } = conv(['# 가상 시험', '- 작성 주체: 가상팀', '## 업무 범위', '- 목적: 범위를 설명한다', '- 가상 접수', '- 가상 처리', ''].join('\n'));
  assert.deepEqual(of(doc, 'work'), ['가상 접수', '가상 처리']);
  assert.equal(doc.nodes[0].description, '범위를 설명한다');
  // 개요 표의 업무명은 그대로 읽는다(doc-01)
  assert.equal(conv(corpus('01').text).doc.universe.name, '가상 월간 결산');
  // 개요 표에서 키가 아닌 칸만 남으면 지금처럼 「쓰지 못한 칸」 알림
  const unused = conv(['# 가상 시험', '- 작성 주체: 가상팀', '## 1. 개요', '| 항목 | 내용 |', '|---|---|', '| 문서 번호 | 가상-1 |', '## 2. 범위', '- 가상 접수', ''].join('\n'));
  assert.ok(codes(unused.report).includes('C-UNUSED'));
});

// ── F5: 이름 칸 고르기를 절 종류별로, 산출물 표도 ──
test('F5 긍정: 「번호 | 산출물 | 형식」 산출물 표는 산출물 칸이 이름이고 번호는 설명에 넣지 않는다(doc-08)', () => {
  const { text, exp } = corpus('08');
  const { doc } = conv(text);
  assert.deepEqual(of(doc, 'artifact'), exp.artifacts);
  assert.equal(byLabel(doc, '갱신 계약서').description, 'PDF (전자서명)');
  const t = mini(['## 범위', '- 가상 접수', '## 산출물', '| 번호 | 산출물 |', '|---|---|', '| 1 | 가상 보고서 |']).doc;
  assert.deepEqual(of(t, 'artifact'), ['가상 보고서']);
});

test('F5 긍정: 범위 표의 「담당」 열을 업무 이름으로 고르지 않고, 탭 표 첫 칸 「작업ID」·「ID」·「코드」를 머리글로 본다(probe P2)', () => {
  const { text, exp } = corpus('03');
  const { doc, report } = conv(text.replace('## 1. 배치 작업 목록', '## 1. 업무 목록')); // 절 이름 분류(F2)는 정책이라 원문만 바꿔 본다
  assert.deepEqual(of(doc, 'work'), exp.works);
  assert.deepEqual(performs(doc), exp.performs);
  assert.ok(report.notes.some((n) => n.code === 'C-TABLE-NAME-COL' && n.col === 2));
  assert.equal(byLabel(doc, '수수료 계산').description, '작업ID: B-020 — 02:30 — B-010 — 배치 운영 담당');
  for (const head of ['ID', '코드']) {
    const d = mini(['## 업무 목록', `${head}\t업무명\t담당`, 'A-1\t가상 접수\t운영 담당', 'A-2\t가상 처리\t운영 담당']).doc;
    assert.deepEqual(of(d, 'work'), ['가상 접수', '가상 처리'], head);
  }
  // 파이프 표 「작업ID | 작업명 | 담당」
  const p = mini(['## 업무 범위', '| 작업ID | 작업명 | 담당 |', '|---|---|---|', '| B-1 | 가상 집계 | 운영 담당 |']).doc;
  assert.deepEqual(of(p, 'work'), ['가상 집계']);
  // 역할 절 「업무 | 담당자」 표는 담당자 칸이 역할 이름이다(전에는 업무 칸이 사람이 됨)
  const r = mini(['## 범위', '- 가상 접수', '## 역할', '| 업무 | 담당자 |', '|---|---|', '| 가상 접수 | 운영 담당 |']).doc;
  assert.deepEqual(of(r, 'person'), ['운영 담당']);
});

test('F5 부정: 첫 칸이 이름인 산출물 표·역할 표·범위 표는 지금처럼 읽는다', () => {
  const { doc } = conv(corpus('03').text);
  assert.deepEqual(of(doc, 'artifact'), ['정산 파일', '배치 결과 보고']);
  assert.equal(byLabel(doc, '정산 파일').description, '고정길이 텍스트 — 90일');
  assert.deepEqual(of(doc, 'person'), corpus('03').exp.people);
  // 범위 표 「업무 | 담당」은 업무 칸(첫 칸), 알림 없음
  const s = mini(['## 업무 범위', '| 업무 | 담당 |', '|---|---|', '| 가상 접수 | 운영 담당 |']);
  assert.deepEqual(of(s.doc, 'work'), ['가상 접수']);
  assert.equal(byLabel(s.doc, '가상 접수').description, '운영 담당');
  assert.ok(!codes(s.report).includes('C-TABLE-NAME-COL'));
  // 머리글 없는 산출물 표(구분줄 없음)는 첫 칸
  const n = mini(['## 범위', '- 가상 접수', '## 산출물', '| 가상 보고서 | 엑셀 |']).doc;
  assert.deepEqual(of(n, 'artifact'), ['가상 보고서']);
  assert.equal(byLabel(n, '가상 보고서').description, '엑셀');
});

// ── F4: 작성일 키워드 바로 뒤의 날짜를 먼저, 문서 번호의 날짜 꼴은 빼고 ──
test('F4 긍정: 「문서번호 제2026-3-12호 / 작성일 2026.09.18」에서 작성일을 읽는다(doc-08)', () => {
  const { text, exp } = corpus('08');
  const { doc, report } = conv(text);
  assert.ok(!codes(report).includes('C-DATE-ASSUMED'));
  assert.deepEqual([...new Set(memoDates(doc))], [exp.date]);
  // 키워드 변형
  for (const line of ['작성 2026년 10월 3일 / 문서번호 제2026-1-5호', '작성 일자 2026. 10. 3. 번호 2026-1-5', '기준일 2026/10/3 (문서 번호 2026.1.5)', '문서번호: 2026-1-5 / 일자: 2026-10-03']) {
    const d = conv(['가상 시험 업무정의서', line, '', '1. 업무 범위', '□ 가상 접수', '2. 확인할 질문', '① 가상 질문인가?'].join('\n'));
    assert.deepEqual(memoDates(d.doc), ['2026-10-03'], line);
  }
});

test('F4 긍정: 날짜 꼴이 문서 번호뿐이면 날짜로 쓰지 않고 알린다(조용히 틀리지 않음)', () => {
  for (const line of ['문서번호 제2026-3-12호', '문서 번호: 2026-3-12', '제 2026.3.12 호']) {
    const { doc, report } = conv(['가상 시험 업무정의서', line, '', '1. 업무 범위', '□ 가상 접수', '2. 확인할 질문', '① 가상 질문인가?'].join('\n'));
    assert.ok(codes(report).includes('C-DATE-ASSUMED'), line);
    assert.deepEqual(memoDates(doc), ['2026-10-04'], line);
  }
});

test('F4 부정: 키워드 없는 제목·머리말 날짜, 「작성: 부서 / 날짜」, 개요 키 작성일은 지금처럼 읽고 findDate는 그대로다', () => {
  const t = conv(['# 가상 회의 운영 2026.09.15', '- 작성 주체: 가상팀', '## 범위', '- 가상 접수', '## 확인할 질문', '1. 가상 질문인가?', ''].join('\n'));
  assert.deepEqual(memoDates(t.doc), ['2026-09-15']);
  const d4 = corpus('04');
  assert.ok(!codes(conv(d4.text).report).includes('C-DATE-ASSUMED'), '「작성: 가상구매팀 / 2026.09.05」(doc-04)');
  for (const nn of ['01', '02', '05', '07', '10']) {
    const { text, exp } = corpus(nn);
    const r = conv(text);
    assert.ok(!codes(r.report).includes('C-DATE-ASSUMED'), nn);
    for (const dt of memoDates(r.doc)) assert.equal(dt, exp.date, nn);
  }
  // findDate 자체는 바꾸지 않았다(문서 번호 걸러 내기는 변환기 쪽에서만)
  assert.equal(findDate('제2026-3-12호'), '2026-03-12');
  assert.equal(findDate('v2026.1.2'), null);
});

// ── F11: 이름 없는 노드를 만들지 않고 알린다 ──
test('F11 긍정: 표시만·번호만·괄호만·숫자만 있는 이름은 노드로 만들지 않고 C-NO-NAME으로 알린다', () => {
  const cases = [
    ['번호만 있는 절 제목', '# 가상 문서\n\n## 3.\n- 내용 한 줄\n\n## 업무 범위\n- 가상 접수\n', 'topic', '3.'],
    ['범위 항목이 표시만', '# 가상 문서\n\n## 업무 범위\n- [미확인]\n- 가상 접수\n', 'work', '[미확인]'],
    ['역할 표 이름 칸이 표시만', '# 가상 문서\n\n## 역할\n| 역할 | 하는 일 |\n|---|---|\n| [가정] | 가상 접수 |\n', 'person', '[가정]'],
    ['산출물 괄호만', '# 가상 문서\n\n## 산출물\n- (양식)\n- → 가상 보고서\n', 'artifact', '(양식)'],
    ['산출물 숫자만', '# 가상 문서\n\n## 산출물\n| 산출물 | 형식 |\n|---|---|\n| 1 | 엑셀 |\n| 가상 보고서 | 한글 |\n', 'artifact', '1'],
  ];
  for (const [name, text, type, bad] of cases) {
    const { doc, report } = conv(text);
    assert.ok(!doc.nodes.some((n) => n.core_type !== 'root' && !/[\p{L}]/u.test(n.label.replace(/\[[^\]]*\]|\([^)]*\)/g, ''))), `${name}: ${of(doc, type)}`);
    assert.ok(report.notes.some((n) => n.code === 'C-NO-NAME' && n.text === bad), `${name}: ${JSON.stringify(report.notes)}`);
    assert.equal(validateDocument({ ...doc, universe: { ...doc.universe, owner: '가상팀' } }).ok, true, name);
  }
  assert.deepEqual(of(conv(cases[1][1]).doc, 'work'), ['가상 접수']);
  assert.deepEqual(of(conv(cases[3][1]).doc, 'artifact'), ['가상 보고서']);
});

test('F11 부정: 숫자·괄호·표시가 섞여도 글자가 있는 이름은 그대로 만든다', () => {
  const { doc, report } = mini(['## 업무 범위', '- 2026 가상 계획 수립', '- (주)가상 위탁 관리', '- 가상 정산 [미확인]', '- B-010', '## 산출물', '- 가상 보고서 (양식)', '- 1차 점검표', '## 4. 가상 요건', '- 내용']);
  assert.deepEqual(of(doc, 'work'), ['2026 가상 계획 수립', '(주)가상 위탁 관리', '가상 정산', 'B-010']);
  assert.deepEqual(of(doc, 'artifact'), ['가상 보고서', '1차 점검표']);
  assert.deepEqual(of(doc, 'topic'), ['가상 요건']);
  assert.ok(!codes(report).includes('C-NO-NAME'));
});

// ── F9: 번호 단계 바로 뒤의 들여쓴 하위 글머리표는 그 단계 글에 붙인다 ──
test('F9 긍정: 들여쓴 하위 글머리표가 독립 단계가 되어 번호가 밀리지 않는다(doc-06)', () => {
  const { text, exp } = corpus('06');
  const { doc, report } = conv(text);
  assert.equal(report.steps, exp.steps);
  const steps = doc.nodes.find((n) => n.attrs && n.attrs.절차).attrs.절차;
  assert.match(steps, /② IT 담당이 계정과 메일을 만든다\. — 계정 이름 규칙: 이름 영문 \+ 숫자 2자리 ③ 총무 담당이/);
  assert.match(steps, /⑤ 수습 평가 일정을 부서장에게 알린다\.$/);
});

test('F9 부정: 들여쓰지 않은 글머리표, 빈 줄 뒤의 글머리표, 글머리표만 있는 절차, 다른 절의 하위 글머리표는 지금처럼 따로 센다', () => {
  const steps = (lines) => mini(['## 범위', '- 가상 접수', '## 처리 절차', ...lines]);
  assert.equal(steps(['1. 가상 갑', '- 가상 을', '2. 가상 병']).report.steps, 3);
  assert.equal(steps(['1. 가상 갑', '', '   - 가상 을', '2. 가상 병']).report.steps, 3);
  assert.equal(steps(['- 가상 갑', '  - 가상 을', '- 가상 병']).report.steps, 3);
  // 범위 절의 하위 글머리표는 붙이지 않는다(업무 이름에 섞이지 않게)
  const s = mini(['## 업무 범위', '1. 가상 갑', '   - 가상 을']).doc;
  assert.deepEqual(of(s, 'work'), ['가상 갑', '가상 을']);
});

// ── F10: 「단계 | 내용 | 담당」 표의 번호 칸을 뺀 뒤에도 머리글을 남긴다 ──
test('F10 긍정: 「단계 | 내용 | 담당」 절차 표는 「내용 — 담당: 값」으로 적는다(doc-01)', () => {
  const steps = byLabel(conv(corpus('01').text).doc, '전표 마감').attrs.절차;
  assert.match(steps, /^① 각 부서에 전표 마감 안내를 보낸다 — 담당: 결산 담당 ② /);
  assert.match(steps, /④ 분개를 검토·승인한다 — 담당: 가상재무팀 팀장 /);
  // 담당 칸이 비면 내용만
  const e = mini(['## 범위', '- 가상 접수', '## 처리 절차', '| 단계 | 내용 | 담당 |', '|---|---|---|', '| 1 | 가상 갑을 한다 |  |']).doc;
  assert.equal(byLabel(e, '가상 접수').attrs.절차, '① 가상 갑을 한다');
});

test('F10 부정: 「단계 | 내용」 2칸 표와 단계 칸이 이름인 표(doc-07)는 지금처럼 적는다', () => {
  const two = mini(['## 범위', '- 가상 접수', '## 처리 절차', '| 단계 | 내용 |', '|---|---|', '| 1 | 가상 갑을 한다 |', '| 2 | 가상 을을 한다 |']).doc;
  assert.equal(byLabel(two, '가상 접수').attrs.절차, '① 가상 갑을 한다 ② 가상 을을 한다');
  const d7 = conv(corpus('07').text).doc.nodes.find((n) => n.attrs && n.attrs.절차).attrs.절차;
  assert.match(d7, /^① 감지 — 담당: 관제 담당 \/ 내용: 알람 확인 후 5분 안에 장애 여부 판단 ② /);
});

// ── 10건 점수 바닥(이보다 내려가면 회귀) ──
test('corpus 10건: 업무·사람·산출물·담당 연결·날짜 점수가 고친 뒤 값 아래로 내려가지 않는다', () => {
  const norm = (s) => String(s || '').replace(/\[(가정|미확인)[^\]]*\]/g, '').replace(/\s+/g, '');
  const hit = (want, got) => want.filter((x) => got.map(norm).includes(norm(x))).length;
  const extra = (want, got) => got.filter((x) => !want.map(norm).includes(norm(x))).length;
  // [업무 맞음, 업무 잘못, 사람 맞음, 산출물 맞음, 산출물 잘못, 담당 맞음, 날짜 맞음]
  const floor = {
    '01': [5, 0, 4, 3, 0, 5, 1], '02': [5, 0, 4, 2, 0, 4, 1], '03': [0, 1, 4, 2, 0, 0, 1], '04': [0, 1, 3, 3, 0, 0, 1], '05': [4, 0, 3, 3, 0, 3, 1],
    '06': [1, 0, 0, 0, 0, 0, 1], '07': [1, 0, 0, 2, 0, 0, 1], '08': [4, 0, 3, 3, 0, 0, 1], '09': [1, 0, 0, 0, 0, 0, 1], '10': [4, 0, 3, 3, 0, 4, 1],
  };
  for (const [nn, f] of Object.entries(floor)) {
    const { text, exp } = corpus(nn);
    const { doc, report } = conv(text);
    const dates = memoDates(doc);
    const dateOk = exp.date ? !codes(report).includes('C-DATE-ASSUMED') && dates.every((d) => d === exp.date) : codes(report).includes('C-DATE-ASSUMED');
    const got = [hit(exp.works, of(doc, 'work')), extra(exp.works, of(doc, 'work')), hit(exp.people, of(doc, 'person')), hit(exp.artifacts, of(doc, 'artifact')), extra(exp.artifacts, of(doc, 'artifact')), hit(exp.performs, performs(doc)), dateOk ? 1 : 0];
    [0, 2, 3, 5, 6].forEach((i) => assert.ok(got[i] >= f[i], `doc-${nn} 칸 ${i}: ${got[i]} < ${f[i]}`));
    [1, 4].forEach((i) => assert.ok(got[i] <= f[i], `doc-${nn} 칸 ${i}(잘못 생김): ${got[i]} > ${f[i]}`));
  }
});

// ── 재검증(2026-10-04): 3f24cc5 수정의 반대편 회귀 R1~R5. 지난 수정(F4·F5·F8·F9·F11)이 고친 것은 부정 표본으로 함께 둔다 ──
test('R1 긍정: 범위 절의 표가 모든 행 첫 칸이 개요 키면 「키: 값」 표로 읽는다(대상 업무·범위 제외·범위·주기)', () => {
  const pipe = mini(['## 2. 업무 범위', '| 항목 | 내용 |', '|---|---|', '| 대상 업무 | 가상 승인, 가상 취소 |', '| 범위 제외 | 가상 정산 |']).doc;
  assert.deepEqual(of(pipe, 'work'), ['가상 승인', '가상 취소']);
  assert.match(pipe.universe.description, /범위 제외: 가상 정산/);
  const noHead = mini(['## 2. 업무 범위', '| 범위 | 가상 승인, 가상 취소 |', '| 주기 | 매일 |']).doc;
  assert.deepEqual(of(noHead, 'work'), ['가상 승인', '가상 취소']);
  assert.equal(byLabel(noHead, '가상 승인').attrs.주기, '매일');
  const tab = conv(['가상 일반 업무정의서', '', '1. 개요', ' □ 작성일: 2026-09-01', '', '2. 업무 범위', '항목\t내용', '대상 업무\t가상 승인, 가상 취소', '범위 제외\t가상 정산', ''].join('\n')).doc;
  assert.deepEqual(of(tab, 'work'), ['가상 승인', '가상 취소']);
  assert.match(tab.universe.description, /범위 제외: 가상 정산/);
});

test('R1 부정: 개요 키가 아닌 행이 하나라도 있는 범위 표는 업무 표다(F8 doc-01 「마감」 행, P1-c 「수시」 행)', () => {
  const { text, exp } = corpus('01');
  assert.deepEqual(of(conv(text).doc, 'work'), exp.works);
  const c = mini(['## 업무 범위', '| 구분 | 업무 |', '|---|---|', '| 주기 | 가상 점검 |', '| 수시 | 가상 조치 |']).doc;
  assert.deepEqual(of(c, 'work'), ['가상 점검', '가상 조치']);
  const mixed = mini(['## 업무 범위', '| 항목 | 내용 |', '|---|---|', '| 주기 | 매일 |', '| 가상 접수 | 접수한다 |']).doc;
  assert.deepEqual(of(mixed, 'work'), ['주기', '가상 접수']);
  assert.equal(byLabel(mixed, '주기').attrs.주기, undefined, '업무 표의 행은 속성으로 읽지 않는다');
});

test('R2 긍정: 산출물 표는 이름 칸 머리글이 없으면 첫 칸, 첫 칸 값이 숫자일 때만 다음 칸을 이름으로 쓴다', () => {
  const kind = mini(['## 범위', '- 가상 접수', '## 산출물', '| 구분 | 형식 |', '|---|---|', '| 가상 보고서 | 엑셀 |', '| 가상 점검표 | PDF |']).doc;
  assert.deepEqual(of(kind, 'artifact'), ['가상 보고서', '가상 점검표']);
  assert.equal(byLabel(kind, '가상 보고서').description, '엑셀');
  const num = mini(['## 범위', '- 가상 접수', '## 산출물', '1\t가상 보고서\t엑셀', '2\t가상 점검표\tPDF']);
  assert.deepEqual(of(num.doc, 'artifact'), ['가상 보고서', '가상 점검표']);
  assert.equal(byLabel(num.doc, '가상 보고서').description, '엑셀');
  assert.ok(!codes(num.report).includes('C-NO-NAME'));
});

test('R2 부정: 이름 칸 머리글(산출물·이름)이 있으면 그 칸, 숫자뿐인 이름 칸은 지금처럼 C-NO-NAME', () => {
  assert.deepEqual(of(conv(corpus('08').text).doc, 'artifact'), corpus('08').exp.artifacts);
  assert.deepEqual(of(mini(['## 범위', '- 가상 접수', '## 산출물', '| 구분 | 산출물 | 형식 |', '|---|---|---|', '| 월간 | 가상 보고서 | 엑셀 |']).doc, 'artifact'), ['가상 보고서']);
  assert.deepEqual(of(mini(['## 범위', '- 가상 접수', '## 산출물', '| 유형 | 이름 |', '|---|---|', '| 보고 | 가상 보고서 |']).doc, 'artifact'), ['가상 보고서']);
  const r = conv('# 가상 문서\n\n## 산출물\n| 산출물 | 형식 |\n|---|---|\n| 1 | 엑셀 |\n| 가상 보고서 | 한글 |\n');
  assert.deepEqual(of(r.doc, 'artifact'), ['가상 보고서']);
  assert.ok(r.report.notes.some((n) => n.code === 'C-NO-NAME' && n.text === '1'));
  // 첫 칸이 「1차 점검표」처럼 숫자로 시작하는 이름이면 그대로 첫 칸
  assert.deepEqual(of(mini(['## 범위', '- 가상 접수', '## 산출물', '| 1차 점검표 | 엑셀 |']).doc, 'artifact'), ['1차 점검표']);
});

test('R3 긍정: 괄호뿐인 절 제목은 괄호 안 글자를 주제 이름으로 쓴다', () => {
  const { doc, report } = mini(['## 범위', '- 가상 접수', '## 7. (참고)', '- 가상 참고 내용']);
  assert.deepEqual(of(doc, 'topic'), ['참고']);
  assert.match(byLabel(doc, '참고').description, /가상 참고 내용/);
  assert.ok(!codes(report).includes('C-NO-NAME'));
  assert.deepEqual(of(mini(['## 범위', '- 가상 접수', '## （참고）', '- 가상 참고 내용']).doc, 'topic'), ['참고']);
});

test('R3 부정: 괄호 안도 비거나 번호·표시뿐이면 지금처럼 C-NO-NAME, 괄호가 붙은 보통 제목은 괄호를 뗀 이름', () => {
  for (const head of ['## 7. ()', '## 3.', '## [미확인]']) {
    const { doc, report } = mini(['## 범위', '- 가상 접수', head, '- 가상 참고 내용']);
    assert.deepEqual(of(doc, 'topic'), [], head);
    assert.ok(codes(report).includes('C-NO-NAME'), head);
  }
  assert.deepEqual(of(mini(['## 범위', '- 가상 접수', '## 4. 운영 기준 (협의 중)', '- 가상 기준']).doc, 'topic'), ['운영 기준']);
});

test('R4 긍정: 절차 절에서 번호 항목과 같은 깊이의 글머리표는 따로 센다', () => {
  const r = conv(['가상 일반 업무정의서', '', '1. 개요', ' □ 작성일: 2026-09-01', ' □ 범위: 가상 접수', '', '2. 업무 절차', '  1) 가상 하나', '  ○ 가상 별도 단계', '  ○ 가상 또 다른 단계', ''].join('\n'));
  assert.equal(r.report.steps, 3);
  assert.equal(byLabel(r.doc, '가상 접수').attrs.절차, '① 가상 하나 ② 가상 별도 단계 ③ 가상 또 다른 단계');
});

test('R4 부정: 번호 항목보다 더 들여쓴 글머리표는 하위로 붙는다(doc-06, 일반 글, 이어진 줄과 두 번째 하위)', () => {
  const { text, exp } = corpus('06');
  assert.equal(conv(text).report.steps, exp.steps);
  const p = conv(['가상 일반 업무정의서', '', '1. 개요', ' □ 작성일: 2026-09-01', ' □ 범위: 가상 접수', '', '2. 업무 절차', '  1) 가상 하나', '    ○ 가상 하위', '  2) 가상 둘', ''].join('\n'));
  assert.equal(byLabel(p.doc, '가상 접수').attrs.절차, '① 가상 하나 — 가상 하위 ② 가상 둘');
  const m = mini(['## 범위', '- 가상 접수', '## 업무 절차', '1. 가상 하나', '   - 가상 하위 A', '     이어지는 줄', '   - 가상 하위 B', '2. 가상 둘']).doc;
  assert.equal(byLabel(m, '가상 접수').attrs.절차, '① 가상 하나 — 가상 하위 A 이어지는 줄 — 가상 하위 B ② 가상 둘');
});

test('R5 긍정: 머리말 작성일은 키워드 순위(작성일 → 작성 → 기준일·일자)로 고르고, 「작성」은 날짜 앞뒤 어느 쪽이어도 된다', () => {
  const pick = (line) => memoDates(conv(['# 가상 날짜 업무', line, '## 범위', '- 가상 접수', '## 확인할 질문', '1. 가상 질문?', ''].join('\n')).doc);
  assert.deepEqual(pick('2026.09.18 작성. 데이터 기준일 2026.06.30'), ['2026-09-18']);
  assert.deepEqual(pick('기준일 2026.06.30 데이터, 작성일 2026.09.18'), ['2026-09-18']);
  assert.deepEqual(pick('일자 2026.06.30 / 작성 2026.09.18'), ['2026-09-18']);
  assert.deepEqual(pick('작성 2026.09.18 / 작성일자 2026.09.20'), ['2026-09-20']);
  assert.deepEqual(pick('시행일 2026.12.01 / 작성 2026.09.02'), ['2026-09-02']);
});

test('R5 부정: 같은 순위면 먼저 나온 날짜, 「작성자 2026년 입사」는 작성 날짜가 아니고, 문서 번호는 빠진다', () => {
  const pick = (line) => memoDates(conv(['# 가상 날짜 업무', line, '## 범위', '- 가상 접수', '## 확인할 질문', '1. 가상 질문?', ''].join('\n')).doc);
  assert.deepEqual(pick('기준일 2026.06.30, 일자 2026.07.01'), ['2026-06-30']);
  assert.deepEqual(pick('작성자 2026년 입사 신입, 2026.09.10 배포'), ['2026-09-10']);
  assert.deepEqual(pick('문서번호 제2026-3-12호 / 작성일 2026.09.18'), ['2026-09-18']);
  assert.deepEqual(pick('승인번호 2026-09-01-001 기준, 작성 2026.09.20'), ['2026-09-20']);
  assert.deepEqual(pick('가상 회의 2026.09.15 정리'), ['2026-09-15']);
});

test('수렴 검증 R1: 머리글 첫 칸이 「업무」인 범위 표는 업무 이름이 개요 키(설명·마감·담당)뿐이어도 업무 표다', () => {
  const text = ['# 가상 시험 업무', '- 작성 주체: 가상시험팀', '## 범위', '| 업무 | 내용 |', '|---|---|', '| 설명 | 가상 설명 작성 |', '| 마감 | 가상 마감 처리 |', '| 담당 | 가상 담당 배정 |', ''].join('\n');
  const { doc, report } = conv(text);
  assert.deepEqual(doc.nodes.filter((n) => n.core_type === 'work').map((n) => n.label), ['설명', '마감', '담당']);
  assert.ok(!report.notes.some((n) => n.code === 'C-NO-SCOPE'));
  // 머리글이 「항목 | 내용」이고 모든 행이 개요 키면 지금처럼 개요(「키: 값」) 표
  const kv = conv(['# 가상 시험 업무', '- 작성 주체: 가상시험팀', '## 범위', '| 항목 | 내용 |', '|---|---|', '| 대상 업무 | 가상 승인, 가상 취소 |', '| 범위 제외 | 가상 정산 |', ''].join('\n')).doc;
  assert.deepEqual(kv.nodes.filter((n) => n.core_type === 'work').map((n) => n.label), ['가상 승인', '가상 취소']);
});
