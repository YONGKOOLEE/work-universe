// W11(재검증 R12, 2026-10-24): 변환 잔여 결함.
//   R12-1 원래 있던 이해관계자·역할 절은 W8 전(d39bf7d)과 똑같이 「역할: 하는 일」로 읽는다(담당 줄 뒤집기는 W8에서 제목 낱말로 새로 잡힌 「담당」 절만)
//   R12-2 키가 그냥 「작성」이면 작성 주체로 읽지 않는다(스위치 authorPickOrg가 켜졌을 때만), 날짜뿐인 값은 어떤 키든 작성 주체가 아니다
//   R12-3 「관련·참고 문서」 절 아래 문장은 산출물이 아니다(새로 잡힌 절만)
//   R12-4 담당 값 판정: 이다·유다·최다·김보다·이수함·선우하늘이는 이름 후보, 값 단위로 거른다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONVERT_RULES, assignmentParts, assignmentsOf, convertDocument, isDocSentence, looksLikeAssignee } from '../app/src/rules/doc-convert.js';
import { noteText } from '../app/src/ui/import.js';

const ctx = { now: '2026-10-24T10:00:00+09:00', random: () => 0.5 };
const ALL_ON = Object.fromEntries(Object.keys(CONVERT_RULES.cr17j).map((k) => [k, true]));
const ALL_OFF = Object.fromEntries(Object.keys(CONVERT_RULES.cr17j).map((k) => [k, false]));
// on: true = 스위치 전부 켬, false = 전부 끔(승인된 12.9 v1), 없음 = 기본값(CR-17 J 승인안: 6개 켬)
const conv = (text, on) => {
  const r = convertDocument(text, on === undefined ? ctx : { ...ctx, cr17j: on ? ALL_ON : ALL_OFF });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  return r;
};
const HEAD = '# 가상 업무\n- 작성 주체: 가상팀\n## 업무 범위\n- 가상 접수\n';
const labelsOf = (doc, type) => doc.nodes.filter((n) => n.core_type === type).map((n) => n.label);
const descOf = (doc, label) => doc.nodes.find((n) => n.label === label).description;
const edgesOf = (doc, type) => doc.edges.filter((e) => e.core_type === type).map((e) => `${doc.nodes.find((n) => n.id === e.source).label}>${doc.nodes.find((n) => n.id === e.target).label}`);
const codes = (r) => r.report.notes.map((n) => n.code);

test('R12-1: 원래 이해관계자 절의 「담당: 가상 접수」 등은 W8 전과 같다 — 역할 「담당」이 가상 접수를 하는 일(D3-21 나), 키·값을 뒤집지 않음(켠 뒤도 같음)', () => {
  const text = `${HEAD}## 이해관계자\n- 담당: 가상 접수\n- 검토: 가상 검토\n- 정: 가상 접수 처리\n- 부: 부재 시 대행\n`;
  for (const on of [false, true]) {
    const { doc, report } = conv(text, on);
    assert.deepEqual(labelsOf(doc, 'person'), ['담당', '검토', '정', '부'], `on=${on}`);
    assert.equal(descOf(doc, '담당'), '가상 접수', `on=${on}`);
    assert.equal(descOf(doc, '부'), '부재 시 대행', `on=${on}`);
    assert.ok(doc.nodes.filter((n) => n.core_type === 'person').every((n) => n.subtype === '역할'), `on=${on}`);
    assert.deepEqual(edgesOf(doc, 'performs'), ['담당>가상 접수'], `on=${on}: 하는 일 칸에 업무 이름이 그대로 있는 줄만 performs(D3-21 나)`);
    assert.ok(!codes({ report }).includes('C-ASSIGN-SKIPPED'), `on=${on}`);
  }
});

test('R12-1: 원래 역할 절의 두 칸 표 「담당 | 가상 접수」도 W8 전 그대로(역할 + 하는 일)', () => {
  const { doc } = conv(`${HEAD}## 역할\n| 담당 | 가상 접수 |\n| 검토 | 가상 검토 |\n`);
  assert.deepEqual(labelsOf(doc, 'person'), ['담당', '검토']);
  assert.deepEqual(edgesOf(doc, 'performs'), ['담당>가상 접수']);
});

test('R12-1: 이해관계자 절 아래의 「담당」 하위 절과 「담당자 및 검토자」(원래 사람 절)도 W8 전대로 읽는다', () => {
  const a = conv(`${HEAD}## 이해관계자\n### 담당\n- 담당: 가상 접수\n`).doc;
  assert.deepEqual(labelsOf(a, 'person'), ['담당']);
  const b = conv(`${HEAD}## 담당자 및 검토자\n- 주 담당: 한가상\n`).doc;
  assert.deepEqual(labelsOf(b, 'person'), ['주 담당'], '「담당자」가 들어 있어 W8 전부터 사람 절이다');
  assert.equal(descOf(b, '주 담당'), '한가상');
});

test('R12-1: W8에서 제목 낱말로 새로 잡힌 「담당」 절만 키·값을 뒤집어 값을 사람으로 읽는다', () => {
  const text = `${HEAD}## 담당\n- 담당: 류다온\n- 검토: 가상재무팀장\n`;
  for (const on of [false, undefined]) {
    const { doc } = conv(text, on);
    assert.deepEqual(labelsOf(doc, 'person'), ['류다온', '가상재무팀장'], `on=${on}`);
    assert.equal(descOf(doc, '류다온'), '담당', `on=${on}`);
  }
  assert.deepEqual(edgesOf(conv(text, false).doc, 'performs'), [], '스위치 꺼짐은 연결 없음(D-P3)');
  assert.deepEqual(edgesOf(conv(text).doc, 'performs'), ['류다온>가상 접수'], '기본값(CR-17 J ①): 업무 하나짜리 문서의 「담당」 사람은 업무를 맡음');
});

test('R12-2: 키가 그냥 「작성」이면 작성 주체로 읽지 않는다(W8 전과 같게 입력받음). 날짜만 작성일 후보(F4)', () => {
  const only = conv('# 가상 업무\n- 작성: 2026-09-05\n## 업무 범위\n- 가상 접수\n## 확인할 질문\n1. 가상 질문?\n');
  assert.equal(only.doc.universe.owner, '');
  assert.ok(codes(only).includes('C-NO-OWNER'));
  assert.equal(only.doc.events.find((e) => e.type === 'memo').occurred_at, '2026-09-05');
  const para = conv('가상 날짜 업무\n작성 : 2026-09-05 가상팀\n\n1. 업무 범위\n- 가상 접수\n');
  assert.equal(para.doc.universe.owner, '');
  assert.ok(codes(para).includes('C-NO-OWNER'));
  const doc04 = conv('# 가상 구매 요청 승인\n> 작성: 가상구매팀 / 2026.09.05 / 검토 전\n## 업무 범위\n- 가상 접수\n');
  assert.equal(doc04.doc.universe.owner, '');
  assert.ok(codes(doc04).includes('C-NO-OWNER'));
  assert.ok(!codes(doc04).includes('C-DATE-ASSUMED'), '날짜는 작성일 후보로 읽는다');
  assert.ok(doc04.doc.universe.description.includes('머리말: 작성: 가상구매팀 / 2026.09.05 / 검토 전'), '줄은 머리말 글로 남는다');
});

test('R12-2: 「작성 부서:」「작성자:」「작성 주체:」는 값 그대로 작성 주체, 날짜뿐인 값은 어떤 키든 아님', () => {
  for (const key of ['작성 부서', '작성자', '작성 주체']) {
    assert.equal(conv(`# 가상 업무\n- ${key}: 가상구매팀\n## 업무 범위\n- 가상 접수\n`).doc.universe.owner, '가상구매팀', key);
    for (const on of [false, true]) {
      const r = conv(`# 가상 업무\n- ${key}: 2026년 9월 5일\n## 업무 범위\n- 가상 접수\n`, on);
      assert.equal(r.doc.universe.owner, '', `${key} on=${on}`);
      assert.ok(codes(r).includes('C-NO-OWNER'), `${key} on=${on}`);
    }
  }
});

test('R12-2: 「작성:」 키를 작성 주체로 읽는 것은 스위치 authorPickOrg가 켜졌을 때만', () => {
  const text = '# 가상 업무\n- 작성: 가상구매팀 / 2026.09.05 / 검토 전\n## 업무 범위\n- 가상 접수\n';
  assert.equal(conv(text).doc.universe.owner, '');
  const r = convertDocument(text, { ...ctx, cr17j: { authorPickOrg: true } });
  assert.equal(r.doc.universe.owner, '가상구매팀');
  assert.equal(convertDocument(text, { ...ctx, cr17j: { authorDate: true } }).doc.universe.owner, '', 'authorDate만 켜면 「작성」 키는 작성 주체가 아니다');
});

test('R12-3: 「관련·참고 문서」 절 아래 문장은 산출물이 아니라 그 절 주제 설명으로, 문서 이름은 산출물로', () => {
  for (const title of ['관련 문서', '관련·참고 문서', '참고/관련 자료']) {
    const { doc, report } = conv(`${HEAD}## ${title}\n- 가상 계산표\n- 이 문서는 매년 고친다.\n- 자세한 내용은 별도 지침을 따른다.\n`);
    assert.deepEqual(labelsOf(doc, 'artifact'), ['가상 계산표'], title);
    const topic = doc.nodes.find((n) => n.core_type === 'topic');
    assert.equal(topic.label, title);
    assert.equal(topic.description, '- 이 문서는 매년 고친다.\n- 자세한 내용은 별도 지침을 따른다.');
    assert.ok(codes({ report }).includes('C-ARTIFACT-PROSE'), title);
    assert.equal(report.notes.filter((n) => n.code === 'C-TOPIC-GUESS').length, 1);
    assert.match(noteText(report.notes.find((n) => n.code === 'C-ARTIFACT-PROSE')), /산출물로 만들지 않고/);
  }
  // 이름뿐이면 주제를 만들지 않는다
  const plain = conv(`${HEAD}## 관련 문서\n- 가상 계산표\n- 가상 지침서 모음\n`);
  assert.deepEqual(labelsOf(plain.doc, 'artifact'), ['가상 계산표', '가상 지침서 모음']);
  assert.equal(plain.doc.nodes.filter((n) => n.core_type === 'topic').length, 0);
  assert.ok(!codes(plain).includes('C-ARTIFACT-PROSE'));
  // 「문서 관리 규정」「관련 법령」은 관련 문서 절이 아니다(주제 그대로)
  assert.equal(conv(`${HEAD}## 관련 법령\n- 가상 법\n`).doc.nodes.filter((n) => n.core_type === 'artifact').length, 0);
});

test('R12-3: 원래 「산출물」 절은 W8 전 그대로(문장도 산출물 노드가 됨 — 회귀 아님)', () => {
  const { doc } = conv(`${HEAD}## 산출물\n- 가상 계산표\n- 이 문서는 매년 고친다.\n`);
  assert.deepEqual(labelsOf(doc, 'artifact'), ['가상 계산표', '이 문서는 매년 고친다.']);
  assert.equal(isDocSentence('가상 지침서 모음'), false);
  assert.equal(isDocSentence('이 문서는 매년 고친다.'), true);
  assert.equal(isDocSentence('자세한 내용은 별도 지침을 따른다'), true);
});

test('R12-4: 담당 값 판정 — 공백 없는 한글 2~4자는 「…다」·「…함」으로 끝나도 이름 후보, 5자 한글 이름도 후보', () => {
  for (const ok of ['이다', '유다', '최다', '김보다', '이수함', '선우하늘이', '류다온', '가상재무팀장', '운영 담당']) assert.equal(looksLikeAssignee(ok), true, ok);
  for (const no of ['접수한다', '처리함', '진행함', '확인됨', '수행한다', '접수는 총괄 부서가 수행한다', '이다.', '외부', '총괄', '가상재무팀 류다온 과장 대리 사원']) assert.equal(looksLikeAssignee(no), false, no);
});

test('R12-4: 담당 줄은 값 단위로 거른다 — 문장 값 하나가 있어도 줄 안 다른 이름은 살린다', () => {
  assert.deepEqual(assignmentParts('정: 류다온, 접수는 총괄이 수행한다, 한가상'), {
    ok: [{ key: '정', name: '류다온' }, { key: '정', name: '한가상' }],
    rejected: [{ key: '정', name: '접수는 총괄이 수행한다' }],
  });
  assert.deepEqual(assignmentsOf('정: 류다온, 접수는 총괄이 수행한다'), [{ key: '정', name: '류다온' }]);
  assert.equal(assignmentsOf('주 담당: 접수는 총괄 부서가 수행한다'), null, '이름이 하나도 없으면 null');
  assert.equal(assignmentParts('교부: 류다온'), null, '키 앞이 낱말 중간이면 키가 아니다');
  const text = `${HEAD}## 담당\n- 정: 류다온, 접수는 총괄이 수행한다, 한가상\n- 검토: 처리함, 진행함\n- 부: 김보다 / 협조: 선우하늘이, 이수함\n`;
  const { doc, report } = conv(text);
  assert.deepEqual(labelsOf(doc, 'person'), ['류다온', '한가상', '김보다', '선우하늘이', '이수함']);
  assert.equal(doc.nodes.find((n) => n.core_type === 'topic').description, '- 정: 접수는 총괄이 수행한다\n- 검토: 처리함, 진행함');
  assert.ok(codes({ report }).includes('C-PEOPLE-PROSE'));
  const sec = report.sections.find((s) => s.kind === 'people');
  assert.equal(sec.made, 5, '만든 사람 수가 절 보고에 맞다');
});

test('R12-7: previewRenameWork 스위치가 CONVERT_RULES.cr17j에 있고 기본은 켬(CR-17 J ⑨: 미리 보기에서 지도 이름을 고치면 업무 하나짜리 문서의 업무 이름도 따라 바뀜)', () => {
  assert.equal(CONVERT_RULES.cr17j.previewRenameWork, true);
});

// 3차 재검증 R13-3·R13-4·R13-2(2026-10-24): 복성이 아닌 5자 명사구는 이름이 아니다, 상자 이름(…함)은 문장이 아니다, 작성 주체 안내는 "읽지 못함"
test('R13-3: 복성으로 시작하지 않는 한글 5자는 담당 이름 후보가 아니다(「가상접수표」), 복성 5자는 후보(「선우하늘이」「남궁민수아」)', () => {
  assert.equal(looksLikeAssignee('가상접수표'), false);
  assert.equal(looksLikeAssignee('월말정산업무'), false);
  assert.equal(looksLikeAssignee('선우하늘이'), true);
  assert.equal(looksLikeAssignee('남궁민수아'), true);
});

test('R13-4: 「보관함」「결재함」「가상 보관함」은 문서·장소 이름이라 문장이 아니고, 「처리함」·마침표 문장은 문장', () => {
  for (const t of ['보관함', '결재함', '접수함', '가상 보관함']) assert.equal(isDocSentence(t), false, t);
  for (const t of ['처리함', '이 문서는 매년 고친다.']) assert.equal(isDocSentence(t), true, t);
});

test('R13-2: C-NO-OWNER 안내는 "원문에 없다"가 아니라 "읽지 못했다"(그냥 「작성:」·날짜뿐인 값은 읽지 않음)', () => {
  const t = noteText({ code: 'C-NO-OWNER' });
  assert.ok(t.startsWith('원문에서 작성 주체를 읽지 못했습니다'), t);
  assert.ok(t.includes('그냥 「작성:」 줄이나 날짜뿐인 값'), t);
});
