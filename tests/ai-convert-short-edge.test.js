// 연결 인용 완화(표의 줄임말 칸)·연결 동사(verb)·메모 모양·프롬프트 안내. 가상 응답만 쓴다(실제 Claude 응답은 확인하지 않음).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EDGE_SHORT_QUOTE, shortEdgeQuoteOk } from '../app/src/llm/evidence-text.js';
import { AI_CONVERT_GUIDE, AI_CONVERT_SCHEMA, AI_EDGE_VERB_MAX, aiResultToDocument, verifyAiConvert } from '../app/src/llm/ai-convert.js';
import { verifyAiExtract } from '../app/src/llm/ai-extract.js';
import { defaultSelection, proposalToOps } from '../app/src/rules/text-extract.js';
import { CONVERT_SYSTEM_PROMPT, EXTRACT_SYSTEM_PROMPT } from '../app/src/llm/prompts.js';

const TEXT = readFileSync(new URL('./fixtures/doc-attach/2_2026회의록.txt', import.meta.url), 'utf8');
const attrs = { 절차: '', 주기: '', 마감: '', 주의사항: '', '사용 시스템': '' };
const mk = (over = {}) => ({
  name: '가상 회의록', purpose: '', owner: '', date: '', works: [], people: [], artifacts: [], topics: [], memos: [], edges: [], ...over,
});
const W = (label) => ({ type: 'work', label });
const P = (label) => ({ type: 'person', label });

const WORKS = [
  { label: '최종 시행 승인 및 사후 모니터링', description: '', attrs, quote: '최종 시행 승인 및 사후 모니터링 사업본부 2027. 1. 25. 이후' },
  { label: '계약별 인상 가능 여부 검토', description: '', attrs, quote: '계약별 인상 가능 여부 검토 법무/영업 2026. 11. 13.' },
  { label: '고객별 매출 시나리오 및 손익 검증', description: '', attrs, quote: '고객별 매출 시나리오 및 손익 검증 재무정산 2026. 11. 20.' },
  { label: '안내문·FAQ·개별 변경합의', description: '', attrs, quote: '안내문·FAQ·개별 변경합의 영업/고객지원 2026. 11.~2027. 1.' },
];
const PEOPLE = [
  { label: '법무·준법팀', role: true, org: '', duty: '', quote: '계약별 인상 가능 여부 검토 법무/영업 2026. 11. 13.' },
  { label: '영업팀', role: true, org: '', duty: '', quote: '안내문·FAQ·개별 변경합의 영업/고객지원 2026. 11.~2027. 1.' },
  { label: '재무정산팀', role: true, org: '', duty: '', quote: '고객별 매출 시나리오 및 손익 검증 재무정산 2026. 11. 20.' },
];
const edge = (from, to, quote, extra = {}) => ({ from, to, relation: 'performs', quote, verb: '', ...extra });
const NOW = '2026-10-28T09:00:00.000Z';

test('표의 줄임말 칸 인용(8글자 미만)도 같은 줄에 연결 끝 이름이 있으면 연결을 남긴다', () => {
  const v = verifyAiConvert(TEXT, mk({
    works: WORKS,
    people: PEOPLE,
    edges: [
      edge(P('법무·준법팀'), W('계약별 인상 가능 여부 검토'), '법무/영업'),
      edge(P('영업팀'), W('계약별 인상 가능 여부 검토'), '법무/영업'),
      edge(P('재무정산팀'), W('고객별 매출 시나리오 및 손익 검증'), '재무정산'),
      edge(P('영업팀'), W('안내문·FAQ·개별 변경합의'), '영업/고객지원'),
    ],
  }));
  assert.equal(v.ok, true);
  assert.equal(v.kept.edges.length, 4);
  assert.equal(v.dropped.length, 0);
});

test('짧은 인용이 연결 끝 이름이 없는 줄에만 있으면 버린다', () => {
  // 「법무/영업」은 첫 업무 줄에 있다 — 앞뒤 3줄 밖의 업무와 연결하면 근거가 못 된다
  const v = verifyAiConvert(TEXT, mk({
    works: WORKS,
    people: PEOPLE,
    edges: [edge(P('법무·준법팀'), W('최종 시행 승인 및 사후 모니터링'), '법무/영업')],
  }));
  assert.equal(v.ok, true);
  assert.equal(v.kept.edges.length, 0);
  assert.match(v.dropped[0].reason, /8글자 미만/);
});

test('글자 1개 인용은 버리고, 원문에 없는 짧은 인용도 버린다', () => {
  const v = verifyAiConvert(TEXT, mk({
    works: WORKS,
    people: PEOPLE,
    edges: [
      edge(P('영업팀'), W('안내문·FAQ·개별 변경합의'), '영'),
      edge(P('재무정산팀'), W('고객별 매출 시나리오 및 손익 검증'), '없는말'),
    ],
  }));
  assert.equal(v.kept.edges.length, 0);
  assert.equal(v.dropped.length, 2);
});

test('완화는 연결에만 — 노드의 짧은 인용은 그대로 버린다', () => {
  const v = verifyAiConvert(TEXT, mk({ works: [{ ...WORKS[0], quote: '법무/영업' }], people: PEOPLE }));
  assert.equal(v.kept.works.length, 0);
  assert.match(v.dropped[0].reason, /8글자 미만/);
  assert.equal(EDGE_SHORT_QUOTE.minChars, 2);
});

test('shortEdgeQuoteOk: 줄 경계를 넘는 인용은 안 됨, 기호뿐인 인용은 안 됨', () => {
  const t = ['가나다 라마.', '바사 아자'].join(String.fromCharCode(10));
  assert.equal(shortEdgeQuoteOk(t, '라마바', ['가나다']), false);
  assert.equal(shortEdgeQuoteOk(t, '라마', ['가나다']), true);
  assert.equal(shortEdgeQuoteOk('가나다 //', '//', ['가나다']), false);
  assert.equal(shortEdgeQuoteOk('가나다 라마', '라마', []), false);
});

test('연결 동사: 6글자 이하이고 인용에 그대로 있을 때만 연결 메모에 남긴다', () => {
  const text = '정산팀은 월간 보고서를 작성한다. 정산팀은 월간 보고서를 매월 말일에 제출한다.';
  const resp = mk({
    works: [{ label: '월간 정산', description: '', attrs, quote: '월간 보고서를 작성한다' }],
    people: [{ label: '정산팀', role: true, org: '', duty: '', quote: '정산팀은 월간 보고서를' }],
    artifacts: [{ label: '월간 보고서', description: '', quote: '월간 보고서를 매월 말일' }],
    edges: [
      { from: { type: 'person', label: '정산팀' }, to: { type: 'artifact', label: '월간 보고서' }, relation: 'references', quote: '정산팀은 월간 보고서를 작성한다', verb: '작성' },
      { from: { type: 'person', label: '정산팀' }, to: { type: 'work', label: '월간 정산' }, relation: 'performs', quote: '월간 보고서를 작성한다', verb: '검토' }, // 인용에 없음 → 동사만 버림
    ],
  });
  const v = verifyAiConvert(text, resp);
  assert.deepEqual(v.kept.edges.map((e) => e.verb), ['작성', '']);
  const r = aiResultToDocument(v.kept, { now: NOW, model: 'm', random: () => 0.5 });
  assert.equal(r.ok, true);
  const notes = r.doc.edges.filter((e) => e.note && e.note.includes('AI 변환')).map((e) => e.note);
  assert.ok(notes.some((n) => n.startsWith('작성 — AI 변환: 원문 「')));
  assert.ok(notes.some((n) => !n.includes('검토')));
  // 너무 긴 동사(7글자 이상)
  const long = verifyAiConvert(text, { ...resp, edges: [{ ...resp.edges[0], verb: '정산팀은월간보고서를' }] });
  assert.equal(long.kept.edges[0].verb, '');
  assert.equal(AI_EDGE_VERB_MAX, 6);
  assert.ok(AI_CONVERT_SCHEMA.properties.edges.items.required.includes('verb'));
});

test('메모는 내용이 먼저, 출처가 뒤(내용 — 출처: AI 변환, 원문 「…」)이고 분류는 category에 남는다', () => {
  const text = '미동의 계약 수와 환불 발생 건을 별도 관리한다.';
  const base = { works: [{ label: '추적 관리', description: '', attrs, quote: '미동의 계약 수와 환불 발생 건' }] };
  const v = verifyAiConvert(text, mk({
    ...base,
    memos: [{ text: '미동의 계약 수와 환불 건을 별도 관리', kind: 'caution', work: '', quote: '미동의 계약 수와 환불 발생 건을 별도 관리한다' }],
  }));
  const r = aiResultToDocument(v.kept, { now: NOW, model: 'm', random: () => 0.5 });
  const memo = r.doc.events.find((e) => e.type === 'memo');
  assert.equal(memo.payload.category, 'caution');
  assert.ok(memo.note.startsWith('미동의 계약 수와 환불 건을 별도 관리 — 출처: AI 변환, 원문 「'));
  assert.ok(!memo.note.startsWith('['));
  // 아주 긴 내용도 출처는 잘리지 않는다
  const longV = verifyAiConvert(text, mk({
    ...base,
    memos: [{ text: '가'.repeat(5000), kind: 'issue', work: '', quote: '미동의 계약 수와 환불 발생 건을 별도 관리한다' }],
  }));
  const lr = aiResultToDocument(longV.kept, { now: NOW, model: 'm', random: () => 0.5 });
  assert.match(lr.doc.events.find((e) => e.type === 'memo').note, / — 출처: AI 변환, 원문 「.+」$/);
});

test('프롬프트 안내: 표 한 줄 인용·동사·산출물·주제·추적 관리 절(안내 문구만, 앱이 항목을 버리지 않음)', () => {
  assert.match(CONVERT_SYSTEM_PROMPT, /그 줄 전체를 글자 그대로/);
  assert.match(CONVERT_SYSTEM_PROMPT, /verb/);
  assert.match(CONVERT_SYSTEM_PROMPT, /추적 관리 사항/);
  assert.match(CONVERT_SYSTEM_PROMPT, /산출물을 따로 만들지 마세요/);
  assert.match(CONVERT_SYSTEM_PROMPT, new RegExp(`많아야 ${AI_CONVERT_GUIDE.topicMax}개`));
  assert.match(EXTRACT_SYSTEM_PROMPT, /verb/);
});

test('글로 추가 Claude 읽기: 동사는 인용에 있을 때만 제안에 실리고 연결 메모(note)가 된다', () => {
  const text = '정산팀은 월간 보고서를 작성한다.';
  const resp = {
    nodes: [
      { type: 'org', label: '정산팀', emp_no: '', quote: '정산팀은 월간 보고서를 작성한다' },
      { type: 'artifact', label: '월간 보고서', emp_no: '', quote: '정산팀은 월간 보고서를 작성한다' },
    ],
    edges: [{ from_label: '정산팀', to_label: '월간 보고서', type: 'references', quote: '정산팀은 월간 보고서를 작성한다', verb: '작성' }],
  };
  const v = verifyAiExtract(text, resp, null, { model: 'm' });
  assert.equal(v.ok, true);
  assert.equal(v.proposal.edges[0].verb, '작성');
  const bad = verifyAiExtract(text, { ...resp, edges: [{ ...resp.edges[0], verb: '검토' }] }, null, { model: 'm' });
  assert.equal(bad.proposal.edges[0].verb, undefined);
  const doc = { schema_version: 1, universe: { id: 'U-1', root_node_id: 'N-000' }, nodes: [{ id: 'N-000', core_type: 'root', label: '지도' }], edges: [], events: [] };
  const ops = proposalToOps(v.proposal, defaultSelection(v.proposal, 'all'), doc);
  const add = ops.find((o) => o.op === 'addEdge');
  assert.ok(add, JSON.stringify(ops));
  assert.equal(add.input.note, '작성');
});

test('줄 창(lineWindow): 가로 행(한 줄)·세로 행(과제/담당/기한 세 줄) 모두 남고, 창 밖이면 버린다', () => {
  const nl = String.fromCharCode(10);
  const row = ['과제 담당 기한', '계약별 인상 가능 여부 검토 법무/영업 2026. 11. 13.'].join(nl);
  assert.equal(shortEdgeQuoteOk(row, '법무/영업', ['계약별 인상 가능 여부 검토']), true);
  const col = ['과제', '담당', '기한', '고객 안내문·FAQ 배포', '영업기획', '2016. 11. 30.'].join(nl);
  assert.equal(shortEdgeQuoteOk(col, '영업기획', ['고객 안내문·FAQ 배포']), true);
  const far = ['고객 안내문·FAQ 배포', '가', '나', '다', '라', '영업기획'].join(nl);
  assert.equal(shortEdgeQuoteOk(far, '영업기획', ['고객 안내문·FAQ 배포']), false);
  assert.equal(EDGE_SHORT_QUOTE.lineWindow, 3);
});

test('PDF 붙여 넣기 원문(칸마다 한 줄, 2016 회의록): 담당 칸 인용은 과제 이름이 가까울 때만 남는다', () => {
  const t = readFileSync(new URL('./fixtures/ai-convert/paste-2016회의록.txt', import.meta.url), 'utf8');
  const w = { label: '고객 안내문·FAQ 배포', description: '', attrs, quote: '고객 안내문·FAQ 배포' };
  const p1 = { label: '영업기획팀', role: true, org: '', duty: '', quote: '영업기획/고객지원' };
  const ok = verifyAiConvert(t, mk({ works: [w], people: [p1], edges: [edge(P('영업기획팀'), W('고객 안내문·FAQ 배포'), '영업기획')] }));
  assert.equal(ok.kept.edges.length, 1);
  const p2 = { label: '개발운영팀', role: true, org: '', duty: '', quote: '개발운영/재무정산' };
  const far = verifyAiConvert(t, mk({ works: [w], people: [p2], edges: [edge(P('개발운영팀'), W('고객 안내문·FAQ 배포'), '개발운영')] }));
  assert.equal(far.kept.edges.length, 0);
});

test('회귀(실제 AI 변환 결과 모양): 2026 회의록에서 버려졌던 연결 8개가 남는다', () => {
  const people = [
    ['사업본부장', '참석 사업본부장, 메시징사업팀'], ['영업팀', '영업팀: 가격 인상에 민감한 중소 고객'], ['법무·준법팀', '법무·준법팀: 계약에 따라 수수료 변경'],
    ['기술운영팀', '기술운영팀: 발송 접수일과 실제 처리일'], ['재무정산팀', '재무정산팀은 계약별'],
  ].map(([label, quote]) => ({ label, role: true, org: '', duty: '', quote }));
  const works = [
    '계약별 인상 가능 여부 검토', '고객별 매출 시나리오 및 손익 검증', '안내문·FAQ·개별 변경합의', '요금 엔진·청구서 회귀 테스트', '최종 시행 승인 및 사후 모니터링',
  ].map((label) => ({ label, description: '', attrs, quote: label }));
  const e = (p, w, quote) => ({ from: P(p), to: W(w), relation: 'performs', quote, verb: '' });
  const v = verifyAiConvert(TEXT, mk({
    works,
    people,
    edges: [
      e('법무·준법팀', '계약별 인상 가능 여부 검토', '법무/영업'),
      e('영업팀', '계약별 인상 가능 여부 검토', '법무/영업'),
      e('재무정산팀', '고객별 매출 시나리오 및 손익 검증', '재무정산'),
      e('영업팀', '안내문·FAQ·개별 변경합의', '영업/고객지원'),
      e('고객지원팀', '안내문·FAQ·개별 변경합의', '영업/고객지원'),
      e('기술운영팀', '요금 엔진·청구서 회귀 테스트', '기술/재무정산'),
      e('재무정산팀', '요금 엔진·청구서 회귀 테스트', '기술/재무정산'),
      e('사업본부장', '최종 시행 승인 및 사후 모니터링', '사업본부'),
    ],
  }));
  // 고객지원팀은 위 사람 목록에 없다(끝 항목 없음 → 정상적으로 버림). 나머지 7개가 남고, 목록에 넣으면 8개다
  assert.equal(v.kept.edges.length, 7);
  const v8 = verifyAiConvert(TEXT, mk({
    works,
    people: [...people, { label: '고객지원팀', role: true, org: '', duty: '', quote: '고객지원팀: 인상 근거를 단순 원가 상승' }],
    edges: v.kept.edges.map((x) => ({ from: P(x.from.label), to: W(x.to.label), relation: 'performs', quote: x.quote, verb: '' }))
      .concat([e('고객지원팀', '안내문·FAQ·개별 변경합의', '영업/고객지원')]),
  }));
  assert.equal(v8.kept.edges.length, 8);
  assert.equal(v8.dropped.length, 0);
});
