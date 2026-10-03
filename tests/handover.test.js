import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_A1 } from '../app/data/sample-a1.js';
import { SAMPLE_CARD } from '../app/data/sample-card.js';
import { SAMPLE_TEAM } from '../app/data/sample-team.js';
import { SAMPLES } from '../app/data/index.js';
import { ANSWERS_V1 } from '../app/data/answers-v1.js';
import { createUniverse, addNode, addEdge, addEvent, hideNode } from '../app/src/model/commands.js';
import { validateDocument } from '../app/src/model/validate.js';
import { buildView } from '../app/src/view/view.js';
import { eventText } from '../app/src/view/describe.js';
import { buildHandoverDraft, itemEvidence, HANDOVER_ITEMS } from '../app/src/rules/handover.js';
import { refineDraft } from '../app/src/llm/connector.js';

const ctx = { now: '2026-10-01T10:00:00+09:00' };
const answer = ANSWERS_V1.handover_drafts[0];
const v = buildView(SAMPLE_A1);
const draft = () => buildHandoverDraft(v, { target: answer.target, from: answer.from, to: answer.to }).draft;
const item = (d, key) => d.items.find((i) => i.key === key);
const texts = (d, key) => item(d, key).sentences.map((s) => s.text);
const exists = (view) => (gid) => view.lookup(gid).found || view.events.some((e) => e.gid === gid);

test('10개 고정 항목이 순서대로 나오고, 초안 상태·규칙 기반이다(R-03 ③, R-04 ②, CR-6)', () => {
  const d = draft();
  assert.deepEqual(d.items.map((i) => i.title), HANDOVER_ITEMS.map((i) => i.title));
  assert.equal(d.items.length, 10);
  assert.equal(d.status, 'draft');
  assert.equal(d.method, 'rule');
  assert.equal(d.title, '윤바다 → 서하늘 인수인계 초안: 월말 정산 점검');
});

test('샘플 데이터는 검증을 통과한다(메모 범주 포함)', () => {
  for (const s of SAMPLES) assert.deepEqual(validateDocument(s).errors, [], s.universe.id);
});

test('항목마다 근거 ID가 정답 표와 일치한다(사례 1, 윤바다 → 서하늘)', () => {
  const d = draft();
  assert.deepEqual(d.items.map((i) => i.key), Object.keys(answer.items));
  for (const [key, expected] of Object.entries(answer.items)) {
    assert.deepEqual(itemEvidence(item(d, key)), [...expected.evidence].sort(), key);
  }
});

test('모든 문장에 근거가 있고, 근거 ID는 모두 데이터에 있다(근거 ID 유효율 100%)', () => {
  const d = draft();
  const ok = exists(v);
  for (const i of d.items) for (const s of i.sentences) {
    assert.ok(s.evidence_ids.length > 0, `${i.key}: ${s.text}`);
    for (const g of s.evidence_ids) assert.ok(ok(g), g);
  }
});

test('세부 업무·절차: 진행 순서 문장이 맨 앞에 오고 업무마다 절차·사용 시스템이 붙는다', () => {
  const t = texts(draft(), '세부_업무_절차');
  assert.equal(t[0], '진행 순서: 자료 수집 → 대사 확인 → 보고');
  assert.deepEqual(t.slice(1).map((x) => x.split(' — ')[0]), ['자료 수집', '대사 확인', '보고']); // 진행 순서대로
  assert.match(t[2], /절차: ① 점검표의 정산 합계와 원천 합계를 대조/);
  assert.match(t[2], /사용 시스템: 가상정산시스템, 가상원천조회, 점검표 양식$/);
  assert.doesNotMatch(t[3], /사용 시스템/); // 보고에는 사용 시스템이 없다 — 지어내지 않는다
});

test('일정·마감: 업무마다 주기와 마감', () => {
  assert.deepEqual(texts(draft(), '일정_마감'), [
    '자료 수집 — 주기: 매월, 마감: 월 마감 후 1영업일 이내',
    '대사 확인 — 주기: 매월, 마감: 월 마감 후 3영업일 이내',
    '보고 — 주기: 매월, 마감: 월 마감 후 5영업일 이내',
  ]);
});

test('주의사항: 업무 속성과 "주의사항" 범주 메모가 모인다(이슈·진행 중 메모는 섞이지 않는다)', () => {
  const t = texts(draft(), '주의사항');
  assert.equal(t.length, 4);
  assert.ok(t.includes('대사 확인: 환불 건이 다음 달에 반영되는 경우가 있어 월 경계 건은 따로 표시한다'));
  assert.ok(t.some((x) => x.startsWith('2026-08-20 원천 시스템은 매월 첫 영업일 새벽')));
  assert.ok(!t.some((x) => x.includes('3건 재발')));
});

test('진행 중인 일: 이후 "해결됨" 메모가 있는 건은 빠진다(6월 건)', () => {
  const t = texts(draft(), '진행_중');
  assert.equal(t.length, 2);
  assert.ok(t[0].startsWith('2026-09-28 9월 불일치 3건 중 2건은 원인 확인 완료'));
  assert.ok(!t.some((x) => x.includes('6월 불일치')));
});

test('최근 이슈는 "이슈" 범주만이고 최신이 먼저다', () => {
  assert.deepEqual(texts(draft(), '최근_이슈'), ['2026-09-15 대사 불일치 3건 재발', '2026-07-10 7월 점검표 양식의 항목 순서가 바뀌어 자료 붙여넣기가 어긋남 → 양식을 수정함']);
});

test('관계자·연락처: 문의(보내는 사람)가 맨 앞, 이전 담당자 연락처가 이어진다. 받는 사람은 뺀다', () => {
  assert.deepEqual(texts(draft(), '관계자_연락처'), [
    '문의: 보내는 사람 윤바다(V-1002) — 연락: 내선 1002(가상)',
    '한가람(V-1001) — 대사 확인 2025-03-01 ~ 2026-05-31. 연락: 내선 1001(가상)',
  ]);
});

test('산출물·문서 위치와 이전 인수인계(인수인계서 유무)가 드러난다', () => {
  assert.deepEqual(texts(draft(), '산출물_문서'), [
    '점검표 양식, 위치: 공용 문서함 > 정산 > 점검표(가상 경로) — 자료 수집에서 만듦',
    '2026-06 인수인계서, 위치: 공용 문서함 > 정산 > 인수인계(가상 경로) — 대사 확인에서 만듦',
  ]);
  assert.deepEqual(texts(draft(), '이전_인수인계'), ['2026-06-01 한가람 → 윤바다 — 대사 확인 (근거: 2026-06 인수인계서)']);
});

test('유사 경험자는 사례 1만으로는 이력 부족이다(정답 표: U-D1 기준은 insight 테스트)', () => {
  assert.equal(item(draft(), '유사_경험자').insufficient, true);
});

test('메모 범주: 이력에는 범주가 앞에 붙고(이슈 제외), 잘못된 범주는 거부된다', () => {
  const view = buildView(SAMPLE_A1);
  const byId = (id) => view.events.find((e) => e.id === id);
  assert.equal(eventText(view, byId('E-006')), '대사 불일치 3건 재발');
  assert.match(eventText(view, byId('E-014')), /^\[진행 중\] 9월 불일치/);
  assert.match(eventText(view, byId('E-013')), /^\[주의사항\] /);
  assert.match(eventText(view, byId('E-011')), /^\[해결됨\] /);
  const bad = addEvent(SAMPLE_A1, { type: 'memo', occurred_at: '2026-10-02', payload: { target_id: 'N-001', category: '기타' } }, ctx);
  assert.deepEqual(bad.error, { code: 'E-SCHEMA', field: 'category' });
  assert.equal(addEvent(SAMPLE_A1, { type: 'memo', occurred_at: '2026-10-02', payload: { target_id: 'N-001', category: 'caution' }, note: '새 주의' }, ctx).ok, true);
});

test('사용자가 새로 입력한 주의사항 메모와 속성도 초안에 반영된다(R-02 → R-03)', () => {
  let doc = addEvent(SAMPLE_A1, { type: 'memo', occurred_at: '2026-10-02', payload: { target_id: 'N-001', category: 'caution' }, note: '마감일이 공휴일이면 전 영업일로 당긴다' }, ctx).doc;
  const d = buildHandoverDraft(buildView(doc), { target: answer.target, from: answer.from, to: answer.to }).draft;
  assert.ok(texts(d, '주의사항').includes('2026-10-02 마감일이 공휴일이면 전 영업일로 당긴다'));
});

test('속성도 이력도 없는 새 업무는 모든 항목이 "이력 부족"이고 내용을 지어내지 않는다(R-03 ②)', () => {
  let doc = createUniverse({ name: '신규 교육 과정', level: '업무', owner: '가상교육팀' }, ctx).doc;
  doc = addNode(doc, { core_type: 'person', label: '가상갑', emp_no: 'V-3001' }, ctx).doc;
  doc = addNode(doc, { core_type: 'person', label: '가상을', emp_no: 'V-3002' }, ctx).doc;
  const [a, b] = doc.nodes.slice(1).map((n) => `${doc.universe.id}/${n.id}`);
  const d = buildHandoverDraft(buildView(doc), { target: `${doc.universe.id}/${doc.universe.root_node_id}`, from: a, to: b }).draft;
  assert.equal(d.items.filter((i) => i.insufficient).length, 10);
  for (const i of d.items) assert.deepEqual(i.sentences, []);
});

test('속성이 일부만 있으면 있는 항목만 채우고 나머지는 이력 부족이다', () => {
  let doc = createUniverse({ name: '신규 교육 과정', level: '업무', owner: '가상교육팀' }, ctx).doc;
  doc = addNode(doc, { core_type: 'work', label: '교육 안내', attrs: { 마감: '매월 5일' } }, ctx).doc;
  doc = addNode(doc, { core_type: 'person', label: '가상갑', emp_no: 'V-3001', attrs: { 연락처: '내선 3001(가상)' } }, ctx).doc;
  doc = addNode(doc, { core_type: 'person', label: '가상을', emp_no: 'V-3002' }, ctx).doc;
  const [root, work, a, b] = doc.nodes.map((n) => `${doc.universe.id}/${n.id}`);
  doc = addEdge(doc, { source: doc.nodes[0].id, target: doc.nodes[1].id, core_type: 'contains' }, ctx).doc;
  const d = buildHandoverDraft(buildView(doc), { target: root, from: a, to: b }).draft;
  assert.deepEqual(texts(d, '일정_마감'), ['교육 안내 — 마감: 매월 5일']);
  assert.deepEqual(texts(d, '관계자_연락처'), ['문의: 보내는 사람 가상갑(V-3001) — 연락: 내선 3001(가상)']);
  assert.ok(item(d, '주의사항').insufficient && item(d, '진행_중').insufficient && item(d, '산출물_문서').insufficient);
  void work;
});

test('대상이 업무면 그 업무와 하위 업무만 범위다(카드승인 "승인" 업무)', () => {
  const vk = buildView(SAMPLE_CARD);
  const d = buildHandoverDraft(vk, { target: 'U-K1/N-101', from: 'U-K1/N-502', to: 'U-K1/N-503' }).draft;
  const works = texts(d, '세부_업무_절차').map((x) => x.split(' — ')[0]);
  assert.equal(works[0].startsWith('진행 순서: 승인요청 수신 → 요청 검증 → 카드사 전문 변환·송신 → 응답 수신·회신'), true);
  assert.deepEqual(works.slice(1), ['승인요청 수신', '요청 검증', '카드사 전문 변환·송신', '응답 수신·회신']);
  assert.ok(texts(d, '관계자_연락처').some((s) => s.startsWith('A사 결제 담당')));
});

test('숨긴 산출물이 근거면 "숨김 처리된 노드"로 표시하고 근거는 유지한다(4절 숨김 후 참조)', () => {
  const doc = hideNode(SAMPLE_A1, 'N-020', ctx).doc;
  const d = buildHandoverDraft(buildView(doc), { target: answer.target, from: answer.from, to: answer.to }).draft;
  const prev = item(d, '이전_인수인계').sentences[0];
  assert.match(prev.text, /2026-06 인수인계서\(숨김 처리된 노드\)/);
  assert.ok(prev.evidence_ids.includes('U-A1/N-020'));
  assert.ok(itemEvidence(item(d, '산출물_문서')).includes('U-A1/N-020'));
});

test('팀 유니버스 꼭지로 만들면 참조한 업무 유니버스의 업무까지 범위에 든다', () => {
  const all = Object.fromEntries(SAMPLES.map((d) => [d.universe.id, d])); // T-13: 부서(U-D1)는 교육팀(U-C)까지 포함
  const vt = buildView(SAMPLE_TEAM, (id) => all[id]);
  const d = buildHandoverDraft(vt, { target: 'U-T1/N-000', from: 'U-A1/N-011', to: 'U-A1/N-012' }).draft;
  const works = item(d, '세부_업무_절차').sentences.flatMap((s) => s.evidence_ids);
  assert.ok(works.includes('U-A1/N-001') && works.includes('U-K1/N-101'));
});

test('최근 이슈·주의사항: 주제를 함께 쓰는 다른 업무 유니버스의 메모는 섞이지 않는다(부서 화면)', () => {
  const docs = Object.fromEntries(SAMPLES.map((s) => [s.universe.id, s]));
  const vd = buildView(docs['U-D1'], (id) => docs[id]);
  const d = buildHandoverDraft(vd, { target: 'U-A1/N-000', from: 'U-A1/N-011', to: 'U-A1/N-012' }).draft;
  for (const key of ['최근_이슈', '주의사항', '진행_중']) {
    for (const g of itemEvidence(item(d, key))) assert.ok(g.startsWith('U-A1/'), `${key}: ${g}`);
  }
  assert.deepEqual(itemEvidence(item(d, '최근_이슈')), ['U-A1/E-006', 'U-A1/E-012']);
});

test('입력 오류: 빠진 값은 E-REQUIRED, 사람이 아닌 노드·같은 사람은 E-SCHEMA', () => {
  assert.deepEqual(buildHandoverDraft(v, { target: answer.target, from: answer.from }).error, { code: 'E-REQUIRED', field: 'to' });
  assert.equal(buildHandoverDraft(v, { target: answer.target, from: 'U-A1/N-001', to: answer.to }).error.field, 'from');
  assert.equal(buildHandoverDraft(v, { target: 'U-A1/N-030', from: answer.from, to: answer.to }).error.field, 'target');
  assert.equal(buildHandoverDraft(v, { target: answer.target, from: answer.from, to: answer.from }).error.same_person, true);
});

// ── 연결부(R-04 ①③, D-07) ──

test('공급자 없음(키 없음): 규칙 기반 그대로, 생성 방식은 규칙 기반(R-04 ①②)', () => {
  const r = refineDraft(draft(), { exists: exists(v) });
  assert.equal(r.method, 'rule');
  assert.equal(r.fallback, null);
});

test('LLM 호출 실패를 흉내 내면 규칙 기반으로 전환하고 원인을 남긴다(R-04 ③)', () => {
  const failing = { name: 'fake', method: 'llm', refine: () => { throw new Error('시간 초과'); } };
  const r = refineDraft(draft(), { provider: failing, exists: exists(v) });
  assert.equal(r.method, 'rule');
  assert.deepEqual(r.fallback, { code: 'W-LLM-FALLBACK', reason: '공급자 오류: 시간 초과' });
  // T-12: 항목마다 생성 방식(method)이 붙는다. 내용은 규칙 기반 그대로
  assert.deepEqual(r.items.map(({ method, ...rest }) => rest), draft().items);
  assert.ok(r.items.every((i) => i.method === 'rule'));
  const broken = { name: 'fake', method: 'llm', refine: () => ({ nope: true }) };
  assert.equal(refineDraft(draft(), { provider: broken, exists: exists(v) }).fallback.reason, '응답 형식 오류');
});

test('공급자 문장의 근거가 없거나 가짜면 그 항목만 규칙 기반으로 대체하고, 이력 부족 항목에는 지어내지 않는다', () => {
  const d = draft();
  const fake = {
    name: 'fake',
    method: 'llm',
    refine: () => ({
      items: [
        { key: '업무_개요', sentences: [{ text: '매월 말 정산을 대조·보고하는 업무입니다.', evidence_ids: ['U-A1/N-000'] }] },
        { key: '관계자_연락처', sentences: [{ text: '홍길동에게 물어보세요.', evidence_ids: ['U-A1/N-999'] }] }, // 없는 근거
        { key: '유사_경험자', sentences: [{ text: '윤바다가 비슷한 일을 했습니다.', evidence_ids: ['U-A1/N-011'] }] }, // 이력 부족 항목
      ],
    }),
  };
  const r = refineDraft(d, { provider: fake, exists: exists(v) });
  assert.equal(r.method, 'llm');
  assert.equal(item(r, '업무_개요').sentences[0].text, '매월 말 정산을 대조·보고하는 업무입니다.');
  assert.equal(item(r, '업무_개요').method, 'llm');
  assert.deepEqual(item(r, '관계자_연락처').sentences, item(d, '관계자_연락처').sentences);
  assert.equal(item(r, '관계자_연락처').replaced, true);
  assert.equal(item(r, '유사_경험자').insufficient, true);
  assert.deepEqual(item(r, '유사_경험자').sentences, []);
  assert.match(r.fallback.reason, /1개는 규칙 기반 문장으로 대체/);
});

// N-5(사용자 확인 중 발견, 2026-10-03): 유사 경험자를 비교했지만 해당자가 없으면 "이력 부족"과 구별한다
test('유사 경험자 해당 없음(similarNone)은 문장 없이 이유만 남기고, 다른 항목에는 붙지 않는다', () => {
  const v = buildView(SAMPLE_A1);
  const input = { target: 'U-A1/N-000', from: 'U-A1/N-011', to: 'U-A1/N-012', similar: [], similarNone: '비슷한 업무를 수행한 사람이 없습니다' };
  const d = buildHandoverDraft(v, input).draft;
  const sim = d.items.find((i) => i.key === '유사_경험자');
  assert.deepEqual([sim.insufficient, sim.empty_reason, sim.sentences.length], [true, '비슷한 업무를 수행한 사람이 없습니다', 0]);
  assert.ok(d.items.filter((i) => i.key !== '유사_경험자').every((i) => i.empty_reason === undefined));
  // 비교를 안 했으면(similarNone 없음) 예전처럼 이력 부족만
  assert.equal(buildHandoverDraft(v, { ...input, similarNone: undefined }).draft.items.find((i) => i.key === '유사_경험자').empty_reason, undefined);
});
