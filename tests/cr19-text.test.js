// CR-19(2026-10-24 사용자 요청 승인) 글로 추가: 줄글 → 항목·연결 제안(규칙 읽기·Claude 읽기) → 사용자가 고른 것만 한 번의 묶음 저장(D-37).
// rules/text-extract.js · llm/ai-extract.js · llm/connector.js(extractTextAsync) · ui/text-add.js(DOM 흉내)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLES } from '../app/data/index.js';
import { createApp } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import { applyBatch } from '../app/src/model/commands.js';
import { validateDocument } from '../app/src/model/validate.js';
import { allowedRelations } from '../app/src/model/schema.js';
import { buildView } from '../app/src/view/view.js';
import {
  TEXT_LIMITS, TEXT_PATTERNS, TEXT_PATTERN_DOC, defaultSelection, extractFromText, finalizeProposal, looksArtifact, looksOrg, proposalToOps, resolveSelection, splitSentences,
} from '../app/src/rules/text-extract.js';
import {
  AI_EXTRACT_MAX_EXISTING, AI_EXTRACT_SCHEMA, buildExtractPrompt, checkExtractInput, existingItems, verifyAiExtract,
} from '../app/src/llm/ai-extract.js';
import { extractTextAsync, QUOTE_FAIL } from '../app/src/llm/connector.js';
import { createProvider } from '../app/src/llm/providers.js';
import { createFakeClient } from '../app/src/llm/fake-client.js';
import { parseExtractUser } from '../app/src/llm/prompts.js';
import { textAddDialog } from '../app/src/ui/text-add.js';
import { FakeEl, installDom, uninstallDom } from './dom-stub.js';
import { mkDoc, mkNode, viewOf } from './helpers.js';

const FAKE_KEY = ['sk', 'ant', 'x'.repeat(8), 'FAKEKEY', 'y'.repeat(12)].join('-');
const NOW = '2026-10-24T15:00:00+09:00';
const EXAMPLE = '서하늘(V-1003)이 대사 확인을 맡는다. 대사 확인이 끝나면 보고를 한다. 보고에서 월말 정산 보고서를 만든다. 감사팀 도하람에게 결과를 공유한다.';

const memoryStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
};
const openApp = (id = 'U-A1') => createApp({ store: createStore(memoryStorage()), samples: SAMPLES, currentId: id, now: () => NOW });
const clone = (x) => JSON.parse(JSON.stringify(x));
const byLabel = (p, label) => p.nodes.find((n) => n.label === label);
const edgeOf = (p, type) => p.edges.filter((e) => e.type === type);
const pair = (p, e) => [p.nodes.find((n) => n.key === e.from).label, p.nodes.find((n) => n.key === e.to).label];
const emptyDoc = () => mkDoc('U-NEW', [], []);
// R17: 「모두 체크」(defaultSelection(p, 'all')) 위에 사용자가 고친 값을 얹은 선택 — 예전 기본 선택과 같다
const withAll = (p, patch = {}) => {
  const d = defaultSelection(p, 'all');
  for (const k of ['nodes', 'edges']) for (const [key, v] of Object.entries(patch[k] || {})) d[k][key] = { ...d[k][key], ...v };
  return d;
};

// ── 규칙 읽기: 읽는 모양 ──

test('CR-19 예시 글 4문장 → 사람 2·업무 2·산출물 1, 수행·선후행·산출·참조 4개(조직·메모는 만들지 않음)', () => {
  const p = extractFromText(EXAMPLE, null);
  assert.equal(p.method, 'rule');
  assert.deepEqual(p.nodes.map((n) => [n.type, n.label]), [['person', '서하늘'], ['work', '대사 확인'], ['work', '보고'], ['artifact', '월말 정산 보고서'], ['person', '도하람']]);
  assert.deepEqual(p.edges.map((e) => [e.type, ...pair(p, e)]), [
    ['performs', '서하늘', '대사 확인'], ['precedes', '대사 확인', '보고'], ['produces', '보고', '월말 정산 보고서'], ['references', '보고', '도하람'],
  ]);
  assert.equal(byLabel(p, '서하늘').emp_no, 'V-1003');
  assert.equal(byLabel(p, '서하늘').unsure, undefined, '사번이 있으면 사람이 확실하다');
  assert.equal(byLabel(p, '도하람').unsure, true, '사번·직함 없이 「~에게」 자리에만 나오면 확인 필요');
  assert.deepEqual(p.unread, []);
  assert.deepEqual(p.notes, []);
  assert.deepEqual(p.nodes.map((n) => n.key), ['n1', 'n2', 'n3', 'n4', 'n5']);
});

test('CR-19 모든 quote는 글에 있는 그대로의 부분 문자열이다(문장 단위)', () => {
  const p = extractFromText(EXAMPLE, null);
  for (const x of [...p.nodes, ...p.edges]) assert.ok(EXAMPLE.includes(x.quote), x.quote);
  const multi = '- 윤바다는 자료 수집을 담당한다.\n  1. 자료 수집이 끝나면 대사 확인을 한다!\n';
  const q = extractFromText(multi, null);
  for (const x of [...q.nodes, ...q.edges]) assert.ok(multi.includes(x.quote), x.quote);
  assert.equal(q.edges.length, 2);
});

test('CR-19 문장 나누기: 마침표·물음표·느낌표·줄바꿈·「;」, 마침표 뒤가 공백이 아니면(파일 이름) 나누지 않는다', () => {
  assert.deepEqual(splitSentences('가 나. 다 라? 마 바! 사\n아 자; 차 카'), ['가 나', '다 라', '마 바', '사', '아 자', '차 카']);
  assert.deepEqual(splitSentences('점검표.xlsx를 만든다. 끝'), ['점검표.xlsx를 만든다', '끝']);
  assert.deepEqual(splitSentences('...\n.!?\n'), []);
});

test('CR-19 TEXT_PATTERNS: 모양 표와 설명 표가 같은 모양 이름을 가진다', () => {
  assert.deepEqual(TEXT_PATTERNS.map((p) => p.id), TEXT_PATTERN_DOC.map((p) => p.id));
});

test('CR-19 수행 ①: X이/가/은/는 Y을/를 맡는다·맡고·담당·처리·진행', () => {
  for (const [s, who, what] of [
    ['윤바다는 자료 수집을 담당한다', '윤바다', '자료 수집'],
    ['한가람이 대사 확인을 맡고 있다', '한가람', '대사 확인'],
    ['서하늘이 점검표 정리를 처리한다', '서하늘', '점검표 정리'],
    // R16-4: 「오늘부터」처럼 날짜·기간 낱말이 있는 문장은 읽지 않으므로(L-60) 낱말을 뺀 문장으로 바꿨다. 「오늘부터 …」가 읽히지 않는 것은 tests/cr19-corpus.test.js
    ['윤바다가 월 마감을 진행한다', '윤바다', '월 마감'],
    ['한가람(V-1001)은 보고를 맡아 왔다', '한가람', '보고'],
  ]) {
    const p = extractFromText(s, null);
    const e = edgeOf(p, 'performs');
    assert.equal(e.length, 1, s);
    assert.deepEqual(pair(p, e[0]), [who, what], s);
    assert.equal(byLabel(p, who).type, 'person');
    assert.equal(byLabel(p, what).type, 'work');
  }
});

test('CR-19 수행 ②: Y 담당(은/는/:) X', () => {
  for (const [s, who, what, unsure] of [
    ['대사 확인 담당은 서하늘이다', '서하늘', '대사 확인', true],
    ['자료 수집 담당: 한가람(V-1001)', '한가람', '자료 수집', undefined],
    ['보고 담당자는 윤바다 님입니다', '윤바다', '보고', undefined],
    ['보고 담당 : 서하늘입니다', '서하늘', '보고', true],
  ]) {
    const p = extractFromText(s, null);
    const e = edgeOf(p, 'performs');
    assert.equal(e.length, 1, s);
    assert.deepEqual(pair(p, e[0]), [who, what], s);
    assert.equal(byLabel(p, who).unsure, unsure, s);
  }
});

test('CR-19 산출: Y(에서/으로/로) Z(을/를) 만든다·작성·산출·낸다 — Z는 산출물', () => {
  for (const [s, y, z] of [
    ['자료 수집에서 점검표 양식을 작성한다', '자료 수집', '점검표 양식'],
    ['대사 확인으로 불일치 목록을 만들어 낸다', '대사 확인', '불일치 목록'],
    ['보고로 월별 결과를 산출한다', '보고', '월별 결과'],
    ['윤바다가 보고에서 안내문을 낸다', '보고', '안내문'],
  ]) {
    const p = extractFromText(s, null);
    const e = edgeOf(p, 'produces');
    assert.equal(e.length, 1, s);
    assert.deepEqual(pair(p, e[0]), [y, z], s);
    assert.equal(byLabel(p, z).type, 'artifact');
    assert.equal(byLabel(p, y).type, 'work');
  }
});

test('CR-19 선후행: 끝나면·끝난 뒤·다음에·뒤에·후에, 마치면·마친 뒤·하고 나서', () => {
  for (const s of [
    '자료 수집이 끝나면 대사 확인을 한다',
    '자료 수집이 끝난 뒤에 대사 확인을 한다',
    '자료 수집 다음에 대사 확인을 한다',
    '자료 수집 후에 대사 확인을 한다',
    '자료 수집을 마치면 대사 확인을 한다',
    '자료 수집을 마친 후에 대사 확인을 한다',
    '자료 수집을 하고 나서 대사 확인을 한다',
    '자료 수집을 하고 난 뒤 바로 대사 확인을 한다',
  ]) {
    const p = extractFromText(s, null);
    const e = edgeOf(p, 'precedes');
    assert.equal(e.length, 1, s);
    assert.deepEqual(pair(p, e[0]), ['자료 수집', '대사 확인'], s);
    assert.deepEqual(p.nodes.map((n) => n.type), ['work', 'work'], s);
  }
});

test('CR-19 소속: X는 T 소속, T 소속 X, T의 X — T가 팀·실·부·과·센터·본부로 끝날 때만 조직', () => {
  for (const [s, x] of [
    ['도하람은 감사팀 소속이다', '도하람'],
    ['감사팀 소속 도하람 님이 확인한다', '도하람'],
    ['감사팀의 도하람이 확인한다', '도하람'],
    ['도하람(V-2001)은 감사팀 소속입니다', '도하람'],
  ]) {
    const p = extractFromText(s, null);
    const e = edgeOf(p, 'belongs_to');
    assert.equal(e.length, 1, s);
    assert.deepEqual(pair(p, e[0]), [x, '감사팀'], s);
    assert.equal(byLabel(p, '감사팀').type, 'org');
    assert.equal(byLabel(p, x).type, 'person');
  }
  // 조직 끝말이 아니면 소속으로 읽지 않는다(지어내지 않음)
  const none = extractFromText('도하람은 감사 소속이다. 감사의 도하람이 확인한다', null);
  assert.deepEqual(none.edges, []);
  assert.equal(none.unread.length, 2);
  // 조직이 조직에 속한다
  const org = extractFromText('감사팀은 경영지원본부 소속이다', null);
  assert.deepEqual(org.nodes.map((n) => n.type), ['org', 'org']);
  assert.deepEqual(pair(org, org.edges[0]), ['감사팀', '경영지원본부']);
});

test('CR-19 참조: X에게 공유·문의·협업·보고·전달 — 같은 문장의 업무, 없으면 앞 문장의 업무, 둘 다 없으면 읽지 않는다', () => {
  const same = extractFromText('서하늘이 대사 확인을 맡고 도하람에게 결과를 공유한다', null);
  assert.deepEqual(edgeOf(same, 'references').map((e) => pair(same, e)), [['대사 확인', '도하람']]);
  // R16-1: 「전달했다」처럼 과거 꼬리는 읽지 않으므로 현재형 「전달한다」로 바꿨다(「전달했다」가 읽히지 않는 것은 tests/cr19-corpus.test.js)
  for (const verb of ['공유한다', '문의합니다', '협업한다', '보고한다', '전달한다']) {
    const p = extractFromText(`윤바다가 대사 확인을 담당한다. 감사팀에게 ${verb}`, null);
    assert.deepEqual(edgeOf(p, 'references').map((e) => pair(p, e)), [['대사 확인', '감사팀']], verb);
    assert.equal(byLabel(p, '감사팀').type, 'org', '팀으로 끝나면 조직');
  }
  const noWork = extractFromText('도하람에게 결과를 공유한다', null);
  assert.deepEqual(noWork.nodes, []);
  assert.deepEqual(noWork.unread, ['도하람에게 결과를 공유한다']);
});

test('CR-19 사번: 이름(V-1234) → 사번, 일반 사번 꼴(영숫자-숫자)도 받는다. 사번만 있는 문장도 사람으로 남긴다', () => {
  const p = extractFromText('서하늘(V-1003)은 신입이다. 도하람 (AB12-345)도 같이 본다', null);
  assert.deepEqual(p.nodes.map((n) => [n.label, n.emp_no, n.type]), [['서하늘', 'V-1003', 'person'], ['도하람', 'AB12-345', 'person']]);
  // R16-5: 이름만 읽고 모양은 읽지 못한 문장은 사라지지 않게 「읽지 못한 문장」에도 두고 partial로 표시한다(이전에는 unread가 비어 있었다)
  assert.deepEqual(p.unread, ['서하늘(V-1003)은 신입이다', '도하람 (AB12-345)도 같이 본다']);
  assert.deepEqual(p.partial, p.unread);
});

test('CR-19 이름 끝말이 보고서·자료·문서·양식·파일·대장·표·서·계획서·결과면 산출물, 팀·실·부·과·센터·본부면 조직(짧은 낱말은 제외)', () => {
  for (const n of ['월말 정산 보고서', '점검 자료', '인수 문서', '점검표 양식', '결과 파일', '근무 대장', '일정표', '정산서', '추진 계획서', '대사 결과']) assert.ok(looksArtifact(n), n);
  for (const n of ['대사 확인', '보고', '서하늘']) assert.ok(!looksArtifact(n), n);
  for (const n of ['감사팀', '총무실', '영업부', '개발과', '고객센터', '경영지원본부']) assert.ok(looksOrg(n), n);
  for (const n of ['일부', '성과', '팀', '대사 확인']) assert.ok(!looksOrg(n), n);
});

test('CR-19 조사 떼기 경계: 이름이 조사 글자로 끝나도(「보고」「지도」) 떼고 남은 이름이 한 글자면 떼지 않는다', () => {
  const a = extractFromText('서하늘이 보고를 맡는다', null);
  assert.deepEqual(a.nodes.map((n) => n.label), ['서하늘', '보고']);
  const b = extractFromText('윤바다가 업무 지도를 담당한다', null);
  assert.deepEqual(b.nodes.map((n) => n.label), ['윤바다', '업무 지도']);
  const c = extractFromText('윤바다가 일일 점검도를 담당한다. 보고서를 만든다', null);
  assert.equal(c.nodes[1].label, '일일 점검도');
  // 「김이」: 이를 떼면 한 글자라 떼지 않는다 → 주어 자리의 조사로 읽을 수 없어 읽지 못한 문장
  const d = extractFromText('김이 보고를 맡는다', null);
  assert.deepEqual(d.nodes, []);
  assert.deepEqual(d.unread, ['김이 보고를 맡는다']);
  // 이름은 2~20자(조사를 뗀 뒤)
  const e = extractFromText('가가가가가가가가가가가가가가가가가가가가가이 보고를 맡는다', null);
  assert.deepEqual(e.nodes, []);
});

test('CR-19 지어내지 않는다: 모양에 안 맞는 문장은 읽지 못한 문장으로, 항목·연결을 만들지 않는다', () => {
  const p = extractFromText('오늘 날씨가 좋다. 서하늘이 대사 확인을 맡는다. 회의는 길었다? 보고서를 만든다', null);
  assert.deepEqual(p.unread, ['오늘 날씨가 좋다', '회의는 길었다', '보고서를 만든다']);
  assert.deepEqual(p.nodes.map((n) => n.label), ['서하늘', '대사 확인']);
  assert.equal(p.edges.length, 1);
  // 유형이 안 맞는 이름(산출물 끝말을 업무로, 조직 끝말을 사람으로)은 그 모양으로 읽지 않는다
  const q = extractFromText('서하늘이 월말 정산 보고서를 맡는다. 감사팀이 대사 확인을 맡는다', null);
  assert.deepEqual(q.nodes, []);
  assert.equal(q.unread.length, 2);
});

test('CR-19 상한: 글 길이·문장 수·항목 수 — 넘으면 notes로 알린다', () => {
  const long = extractFromText(`${'가'.repeat(TEXT_LIMITS.maxChars)}나`, null);
  assert.deepEqual(long.nodes, []);
  assert.match(long.notes[0], /글이 너무 깁니다/);
  assert.match(extractFromText('   ', null).notes[0], /비어/);
  // R16-8: 이름이 「사람0」처럼 숫자가 섞이면 사람 이름으로 받지 않으므로(조사 없이 사람으로 받는 것은 한글 세 글자) 받침 없는 한글 세 글자 이름을 만든다
  const syl = '가나다라마바사자차카타파';
  const nm = (i) => `${syl[i % 12]}${syl[Math.floor(i / 12) % 12]}${syl[(i * 7) % 12]}`;
  const many = Array.from({ length: TEXT_LIMITS.maxSentences + 5 }, (_, i) => `${nm(i)}가 일${i} 점검을 맡는다`).join('. ');
  const m = extractFromText(many, null);
  assert.match(m.notes.join('|'), new RegExp(`앞의 ${TEXT_LIMITS.maxSentences}개만 읽었습니다`));
  assert.equal(m.nodes.length, TEXT_LIMITS.maxSentences * 2 > TEXT_LIMITS.maxNodes ? TEXT_LIMITS.maxNodes : TEXT_LIMITS.maxSentences * 2);
  const capped = extractFromText('윤바다가 자료 수집을 맡는다. 한가람이 대사 확인을 맡는다', null, { limits: { maxNodes: 3 } });
  assert.equal(capped.nodes.length, 3);
  assert.match(capped.notes.join('|'), /항목이 너무 많아 앞의 3개만 담았습니다/);
  const longSentence = extractFromText(`윤바다가 ${'가'.repeat(TEXT_LIMITS.sentenceMax)} 점검을 맡는다`, null);
  assert.deepEqual(longSentence.nodes, []);
  assert.equal(longSentence.unread.length, 1);
});

// ── 지금 지도와 맞대기 ──

test('CR-19 지금 지도에 같은 이름·사번의 항목이 하나면 새로 만들지 않고 그 항목에 잇는다(match), 같은 연결은 exists', () => {
  const view = viewOf('U-A1');
  const p = extractFromText(EXAMPLE, view);
  assert.deepEqual(p.nodes.map((n) => n.match), ['U-A1/N-012', 'U-A1/N-001', 'U-A1/N-003', null, null]);
  assert.equal(p.nodes[0].match_label, '서하늘');
  const state = Object.fromEntries(p.edges.map((e) => [e.type, !!e.exists]));
  assert.deepEqual(state, { performs: true, precedes: true, produces: false, references: false });
  // R16-6: 사번만 같고 이름이 다르면 같은 사람으로 잇지 않는다 — 새 항목(match 없음)으로 두고 처음 체크를 풀며 이유를 알린다(이전에는 사번만으로 그 사람에 이었다)
  const q = extractFromText('서하느리(V-1003)가 점검을 맡는다', view);
  assert.equal(q.nodes[0].match, null);
  assert.equal(q.nodes[0].hold, '사번은 「서하늘」과 같고 이름이 다릅니다');
  assert.match(q.notes.join('|'), /사번은 「서하늘」과 같고 이름이 다릅니다/);
  assert.equal(defaultSelection(q).nodes.n1.include, false);
  assert.equal(defaultSelection(q).edges.e1.include, false, 'hold 항목에 걸린 연결도 처음에는 체크하지 않는다');
  // 같은 이름이라도 사번이 다르면 다른 사람
  const r = extractFromText('서하늘(V-9999)이 점검을 맡는다', view);
  assert.equal(r.nodes[0].match, null);
});

test('CR-19 같은 이름이 둘 이상이면 match 없이 notes로 안내하고, 처음 선택에서는 체크하지 않는다', () => {
  const doc = mkDoc('U-DUP', [mkNode('N-001', 'person', '도하람'), mkNode('N-002', 'person', '도하람'), mkNode('N-003', 'work', '점검')], []);
  const p = extractFromText('도하람이 점검을 맡는다', buildView(doc));
  assert.equal(byLabel(p, '도하람').match, null);
  assert.equal(byLabel(p, '도하람').ambiguous, true);
  assert.equal(byLabel(p, '점검').match, 'U-DUP/N-003');
  assert.match(p.notes[0], /도하람.*같은 이름의 항목이 둘 이상/);
  const sel = defaultSelection(p, 'all');
  assert.equal(sel.nodes.n1.include, false);
  // 그 항목을 쓰는 연결은 끝 항목이 빠져 넣을 수 없다
  const r = resolveSelection(p, sel, [{ id: 'N-001', core_type: 'person', label: '도하람', emp_no: '' }, { id: 'N-002', core_type: 'person', label: '도하람', emp_no: '' }, { id: 'N-003', core_type: 'work', label: '점검', emp_no: '' }]);
  assert.equal(r.edges.e1.reason, 'end_missing');
  assert.equal(r.edges.e1.include, false);
});

test('CR-19 유형이 확실하지 않은 이름은 지도의 다른 유형 항목과 이름이 같으면 그 유형을 따라간다(조직 감사팀)', () => {
  const doc = mkDoc('U-ORG', [mkNode('N-001', 'org', '감사팀'), mkNode('N-002', 'work', '대사 확인')], []);
  const p = extractFromText('윤바다가 대사 확인을 담당한다. 감사팀에게 공유한다', buildView(doc));
  assert.equal(byLabel(p, '감사팀').type, 'org');
  assert.equal(byLabel(p, '감사팀').match, 'U-ORG/N-001');
  // 사람으로 보이는 이름이 지도의 조직과 같은 이름이면 사람 확인 필요가 아니라 그 항목(조직)
  const q = extractFromText('윤바다가 대사 확인을 담당한다. 감사팀 도하람에게 공유한다', buildView(doc));
  assert.equal(byLabel(q, '도하람').type, 'person');
});

test('CR-19 PAIR_RULES: 방향이 반대로만 맞으면 뒤집고, 안 맞으면 연결을 빼고 notes에 이유를 둔다', () => {
  const base = { method: 'rule', unread: [], notes: [] };
  const nodes = [
    { key: 'n1', type: 'artifact', label: '점검 문서', quote: 'q', match: null },
    { key: 'n2', type: 'work', label: '점검', quote: 'q', match: null },
    { key: 'n3', type: 'person', label: '윤바다', quote: 'q', match: null },
  ];
  const p = finalizeProposal({ ...base, nodes, edges: [
    { key: 'e1', from: 'n1', to: 'n2', type: 'produces', quote: 'q' }, // 산출물 → 업무는 거꾸로: 업무 → 산출물로 뒤집는다
    { key: 'e2', from: 'n1', to: 'n3', type: 'performs', quote: 'q' }, // 어느 방향도 안 됨
  ] }, null);
  assert.deepEqual(p.edges.map((e) => [e.key, e.from, e.to]), [['e1', 'n2', 'n1']]);
  assert.match(p.notes.join('|'), /점검 문서 — 윤바다.*수행.*유형.*맞지 않아 뺐습니다/);
});

// ── 선택 → 명령 → 저장 ──
// R17: 처음 체크는 「지도에 이미 있는 항목과 두 끝이 모두 지도에 있는 연결」뿐(TEXT_DEFAULT_CHECK 'existing-only')으로 바뀌었다.
// 아래 저장 시험들은 예전 흐름(사람이 「모두 체크」를 누른 뒤 저장 = defaultSelection(p, 'all'))을 그대로 확인하고, 기본 선택은 바로 다음 시험이 따로 확인한다.

test('R17 기본 선택: 새로 만드는 항목과 새 항목이 한쪽 끝인 연결은 처음에 체크하지 않는다(지도에 이미 있는 것만) — 그대로 저장하면 아무것도 새로 만들지 않는다', () => {
  const doc = clone(SAMPLES.find((d) => d.universe.id === 'U-A1'));
  const p = extractFromText(EXAMPLE, buildView(doc));
  const sel = defaultSelection(p);
  assert.deepEqual(p.nodes.map((n) => [n.label, sel.nodes[n.key].include]), [['서하늘', true], ['대사 확인', true], ['보고', true], ['월말 정산 보고서', false], ['도하람', false]]);
  // 수행·선후행은 이미 있어 체크 안 함, 산출·참조는 새 항목이 끝이라 체크 안 함
  assert.deepEqual(p.edges.map((e) => [e.type, sel.edges[e.key].include]), [['performs', false], ['precedes', false], ['produces', false], ['references', false]]);
  assert.deepEqual(proposalToOps(p, sel, doc), []);
  // 모두 체크 = 예전 기본(이미 있는 연결은 제외)
  const all = defaultSelection(p, 'all');
  assert.deepEqual(p.nodes.map((n) => all.nodes[n.key].include), [true, true, true, true, true]);
  assert.deepEqual(p.edges.map((e) => all.edges[e.key].include), [false, false, true, true]);
  // 새 항목 하나만 체크하면 그 항목과 (끝이 모두 들어가는) 연결을 쓸 수 있다
  const one = proposalToOps(p, { nodes: { n4: { include: true } }, edges: { e3: { include: true } } }, doc);
  assert.deepEqual(one.map((o) => [o.op, o.key]), [['addNode', 'n4'], ['addEdge', 'e3']]);
  // AI 읽기 제안도 같은 규칙: match 없는 항목은 체크 해제
  const ai = verifyAiExtract(EXAMPLE, { nodes: [{ type: 'person', label: '서하늘', emp_no: 'V-1003', quote: '서하늘(V-1003)이 대사 확인을 맡는다' }, { type: 'person', label: '도하람', emp_no: '', quote: '감사팀 도하람에게 결과를 공유한다' }], edges: [] }, buildView(doc));
  const aiSel = defaultSelection(ai.proposal);
  assert.deepEqual(ai.proposal.nodes.map((n) => aiSel.nodes[n.key].include), [true, false]);
});

test('CR-19 proposalToOps: 예시 글을 월말 정산 점검(U-A1)에 넣으면 새 항목 2개·연결 2개만 늘고, 기록 시각이 하나이며 문서가 검증을 통과한다', () => {
  const doc = clone(SAMPLES.find((d) => d.universe.id === 'U-A1'));
  const p = extractFromText(EXAMPLE, buildView(doc));
  const ops = proposalToOps(p, defaultSelection(p, 'all'), doc);
  assert.deepEqual(ops.map((o) => [o.op, o.key]), [['addNode', 'n4'], ['addNode', 'n5'], ['addEdge', 'e3'], ['addEdge', 'e4']]);
  assert.deepEqual(ops[2].input, { source: 'N-003', target: '@1', core_type: 'produces' });
  assert.deepEqual(ops[3].input, { source: 'N-003', target: '@2', core_type: 'references' });
  assert.equal(ops[0].attachRoot, false, '산출물은 지도 중심에 잇지 않는다(표로 추가와 같음: 업무만)');
  const r = applyBatch(doc, ops, { now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.created.length, 2);
  assert.equal(r.edges.length, 2);
  assert.equal(r.doc.nodes.length, doc.nodes.length + 2);
  assert.equal(r.doc.edges.length, doc.edges.length + 2);
  assert.equal(r.events.length, 4);
  assert.equal(new Set(r.events.map((e) => e.recorded_at)).size, 1, '한 번의 기록(되감기 한 점)');
  assert.deepEqual(validateDocument(r.doc).errors.filter((e) => e.path !== 'universe.owner'), []);
});

test('CR-19 이미 있는 연결을 체크해도 오류 없이 건너뛴다(수행은 담당 중이면 건너뜀, 나머지는 skipDup)', () => {
  const doc = clone(SAMPLES.find((d) => d.universe.id === 'U-A1'));
  const p = extractFromText(EXAMPLE, buildView(doc));
  const sel = defaultSelection(p, 'all');
  sel.edges.e1.include = true;
  sel.edges.e2.include = true;
  const ops = proposalToOps(p, sel, doc);
  assert.equal(ops.find((o) => o.key === 'e1').op, 'assign');
  const r = applyBatch(doc, ops, { now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.created.length, 2);
  assert.equal(r.edges.length, 2, '선후행은 건너뛰고 새 연결 2개만');
  assert.deepEqual(r.rows.filter((x) => x.kind === 'skipped').map((x) => x.reason).sort(), ['already_assigned', 'duplicate_edge']);
});

test('CR-19 빈 지도에 넣으면 항목 5개 + 새 업무는 지도 중심에 포함 연결 + 수행은 담당 시작 이력, 문서가 검증을 통과한다', () => {
  const doc = emptyDoc();
  const p = extractFromText(EXAMPLE, buildView(doc));
  const ops = proposalToOps(p, defaultSelection(p, 'all'), doc);
  assert.equal(ops.filter((o) => o.op === 'addNode').length, 5);
  assert.equal(ops.find((o) => o.key === 'e1').op, 'assign');
  assert.deepEqual(ops.filter((o) => o.attachRoot).map((o) => o.input.label), ['대사 확인', '보고']);
  const r = applyBatch(doc, ops, { now: NOW });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.created.length, 5);
  assert.equal(r.assignments.length, 1);
  assert.equal(r.edges.length, 3, '선후행·산출·참조(포함 연결은 항목 행에 딸려 만들어진다)');
  assert.equal(r.doc.edges.filter((e) => e.core_type === 'contains').length, 2, '새 업무 2개는 지도 중심에 포함');
  assert.equal(r.doc.events.filter((e) => e.type === 'assign_start').length, 1);
  assert.deepEqual(validateDocument(r.doc).errors.filter((e) => e.path !== 'universe.owner'), []);
  // 지도 중심에 잇지 않으면 포함 연결이 없다
  const none = proposalToOps(p, defaultSelection(p, 'all'), doc, { attachRoot: false });
  assert.equal(none.filter((o) => o.attachRoot).length, 0);
});

test('CR-19 일부만 체크하면 그만큼만: 항목을 빼면 그 항목을 쓰는 연결도 들어가지 않는다', () => {
  const doc = emptyDoc();
  const p = extractFromText(EXAMPLE, buildView(doc));
  const sel = defaultSelection(p, 'all');
  sel.nodes.n5.include = false; // 도하람
  sel.edges.e2.include = false; // 선후행
  const ops = proposalToOps(p, sel, doc);
  const r = applyBatch(doc, ops, { now: NOW });
  assert.equal(r.ok, true);
  assert.deepEqual(r.created.map((n) => n.label), ['서하늘', '대사 확인', '보고', '월말 정산 보고서']);
  assert.deepEqual([...r.assignments, ...r.edges].map((e) => e.core_type).sort(), ['performs', 'produces']);
  assert.equal(r.doc.edges.filter((e) => e.core_type === 'contains').length, 2, '새 업무 2개는 지도 중심에 포함');
  assert.deepEqual(proposalToOps(p, { nodes: Object.fromEntries(p.nodes.map((n) => [n.key, { include: false }])), edges: {} }, doc), []);
});

test('CR-19 유형·이름을 고치면 다시 계산한다: 유형을 바꾸면 안 맞는 연결은 빠지고, 이름을 지도의 항목과 같게 고치면 새로 만들지 않고 그 항목에 잇는다', () => {
  const doc = clone(SAMPLES.find((d) => d.universe.id === 'U-A1'));
  const p = extractFromText(EXAMPLE, buildView(doc));
  // 월말 정산 보고서를 사람으로 → 산출 연결(업무 → 산출물)은 유형 조합이 안 맞는다
  const asPerson = resolveSelection(p, withAll(p, { nodes: { n4: { type: 'person' } } }), doc.nodes.map((n) => ({ id: n.id, core_type: n.core_type, label: n.label, emp_no: n.emp_no || '' })), doc.edges);
  assert.equal(asPerson.edges.e3.reason, 'pair');
  assert.equal(asPerson.edges.e3.include, false);
  assert.ok(allowedRelations('work', 'person').some((x) => x.relation === 'references'), '참조는 업무와 사람 사이에 쓸 수 있다');
  // 관계를 참조로 고르면 들어간다
  const asRef = proposalToOps(p, withAll(p, { nodes: { n4: { type: 'person' } }, edges: { e3: { type: 'references', include: true } } }), doc);
  assert.ok(asRef.some((o) => o.key === 'e3' && o.input.core_type === 'references'));
  // 이름을 지도의 「점검표 양식」으로 고치면 새로 만들지 않고 그 항목(N-021)에 잇는다
  const renamed = proposalToOps(p, withAll(p, { nodes: { n4: { label: '점검표 양식' } } }), doc);
  assert.equal(renamed.filter((o) => o.op === 'addNode').length, 1, '도하람만 새로 만든다');
  assert.deepEqual(renamed.find((o) => o.key === 'e3').input, { source: 'N-003', target: 'N-021', core_type: 'produces' });
  const r = applyBatch(doc, renamed, { now: NOW });
  assert.equal(r.ok, true);
  assert.equal(r.created.length, 1);
});

test('CR-19 이름이 빈 항목은 저장이 막힌다: 그 행 오류만 보고하고 아무것도 저장하지 않는다', () => {
  const doc = emptyDoc();
  const p = extractFromText(EXAMPLE, buildView(doc));
  const ops = proposalToOps(p, withAll(p, { nodes: { n3: { label: '   ' } } }), doc);
  assert.equal(ops.find((o) => o.key === 'n3').op, 'invalid');
  const r = applyBatch(doc, ops, { now: NOW });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors.map((e) => [e.row, e.error.code, e.error.field]), [[ops.find((o) => o.key === 'n3').row, 'E-REQUIRED', 'label']]);
  assert.equal(r.doc, doc, '문서는 그대로');
});

test('CR-19 같은 이름을 둘 다 새로 만들려 하면 두 번째 행이 E-DUP(전부 아니면 전무)', () => {
  const doc = emptyDoc();
  const p = extractFromText('윤바다가 자료 수집을 맡는다. 한가람이 대사 확인을 맡는다', buildView(doc));
  const ops = proposalToOps(p, withAll(p, { nodes: { n4: { label: '자료 수집' } } }), doc);
  const r = applyBatch(doc, ops, { now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].error.code, 'E-DUP');
});

test('CR-19 저장 형식은 바뀌지 않는다: 새 이벤트 종류·필드가 없다', () => {
  const doc = emptyDoc();
  const p = extractFromText(EXAMPLE, buildView(doc));
  const r = applyBatch(doc, proposalToOps(p, defaultSelection(p, 'all'), doc), { now: NOW });
  assert.ok(r.doc.events.every((e) => ['created', 'assign_start'].includes(e.type)));
  const allowed = new Set(['id', 'core_type', 'label', 'emp_no', 'hidden', 'created_at', 'updated_at']);
  assert.ok(r.doc.nodes.slice(1).every((n) => Object.keys(n).every((k) => allowed.has(k))), JSON.stringify(r.doc.nodes[1]));
});

// ── Claude 읽기 ──

const aiProvider = (mode = 'extract', extra = {}) => {
  const client = createFakeClient({ mode });
  return { client, provider: createProvider('claude_api', { apiKey: FAKE_KEY, client, ...extra }) };
};

test('CR-19 AI 검증: 글에 없는 인용·이름, 잘못된 유형·관계·끝 항목은 행 단위로 버리고 개수를 notes에 남긴다', () => {
  const text = EXAMPLE;
  const parsed = {
    nodes: [
      { type: 'person', label: '서하늘', emp_no: 'V-1003', quote: '서하늘(V-1003)이 대사 확인을 맡는다' },
      { type: 'work', label: '대사 확인', emp_no: '', quote: '서하늘(V-1003)이 대사 확인을 맡는다' },
      { type: 'work', label: '지어낸 업무', emp_no: '', quote: '서하늘(V-1003)이 대사 확인을 맡는다' }, // 이름이 글에 없음
      { type: 'work', label: '보고', emp_no: '', quote: '글 어디에도 없는 인용입니다' }, // 인용이 글에 없음
      { type: 'artifact', label: '월말 정산 보고서', emp_no: '', quote: '보고에서 월말 정산 보고서를 만든다' },
      { type: 'planet', label: '월말', emp_no: '', quote: '월말 정산 보고서' }, // 유형이 스키마에 없음
      { type: 'person', label: '도하람', emp_no: 'V-7777', quote: '감사팀 도하람에게 결과를 공유한다' }, // 사번이 글에 없음 → 사번만 버리고 항목은 둔다
    ],
    edges: [
      { from_label: '서하늘', to_label: '대사 확인', type: 'performs', quote: '서하늘(V-1003)이 대사 확인을 맡는다' },
      { from_label: '월말 정산 보고서', to_label: '대사 확인', type: 'produces', quote: '대사 확인이 끝나면 보고를 한다. 보고에서 월말 정산 보고서를 만든다' }, // 거꾸로 → 뒤집어 둔다(두 문장에 걸친 인용에 두 이름이 모두 있음)
      { from_label: '월말 정산 보고서', to_label: '대사 확인', type: 'produces', quote: '보고에서 월말 정산 보고서를 만든다' }, // R16-10: 인용 안에 「대사 확인」이 없음 → 버림(이전에는 같은 연결이 통과했다)
      { from_label: '서하늘', to_label: '월말 정산 보고서', type: 'performs', quote: '서하늘(V-1003)이 대사 확인을 맡는다' }, // 유형 조합이 틀림
      { from_label: '서하늘', to_label: '대사 확인', type: 'friends', quote: '서하늘(V-1003)이 대사 확인을 맡는다' }, // 관계가 스키마에 없음
      { from_label: '서하늘', to_label: '보고', type: 'references', quote: '서하늘(V-1003)이 대사 확인을 맡는다' }, // 끝 항목이 버려짐
      { from_label: '서하늘', to_label: '도하람', type: 'references', quote: '글에 없는 인용' }, // 인용이 글에 없음
    ],
  };
  const r = verifyAiExtract(text, parsed, viewOf('U-A1'), { model: 'm' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.proposal.nodes.map((n) => n.label), ['서하늘', '대사 확인', '월말 정산 보고서', '도하람']);
  assert.equal(byLabel(r.proposal, '도하람').emp_no, undefined);
  assert.equal(r.proposal.method, 'claude_api');
  assert.deepEqual(r.proposal.edges.map((e) => [e.type, ...pair(r.proposal, e)]), [['performs', '서하늘', '대사 확인'], ['produces', '대사 확인', '월말 정산 보고서']]);
  assert.deepEqual(r.proposal.nodes.map((n) => n.match), ['U-A1/N-012', 'U-A1/N-001', null, null], '지금 지도와의 맞대기는 규칙 읽기와 같은 함수');
  assert.equal(r.proposal.edges[0].exists, true);
  assert.equal(r.dropped.length, 8);
  assert.match(r.proposal.notes[0], /8개 행은 원문 인용이 확인되지 않거나 규칙에 맞지 않아 뺐습니다/);
  assert.ok(r.dropped.some((d) => d.reason === '이름이 글에 없음'));
  assert.ok(r.dropped.some((d) => d.reason === '원문에서 인용을 찾지 못함'));
  assert.ok(r.dropped.some((d) => d.reason === '항목 유형이 맞지 않음'));
  assert.ok(r.dropped.some((d) => d.reason === '연결 종류가 맞지 않음'));
  assert.ok(r.dropped.some((d) => d.reason === '근거 구절에 두 항목의 이름이 모두 있어야 함'));
  // 읽지 못한 문장: 남은 인용과 겹치지 않는 문장(위 연결의 인용이 두 문장에 걸쳐 있어 이 글에는 남는 문장이 없고, 항목 하나만 남긴 응답으로 확인한다)
  assert.deepEqual(r.proposal.unread, []);
  const one = verifyAiExtract(text, { nodes: [{ type: 'person', label: '서하늘', emp_no: 'V-1003', quote: '서하늘(V-1003)이 대사 확인을 맡는다' }], edges: [] }, null);
  assert.ok(one.proposal.unread.includes('대사 확인이 끝나면 보고를 한다'));
});

test('CR-19 AI 검증: 항목이 하나도 안 남으면 empty, 형식이 깨지면 format', () => {
  assert.deepEqual(verifyAiExtract('서하늘이 일한다', { nodes: [{ type: 'person', label: '없는이름', emp_no: '', quote: '글에 없는 말입니다' }], edges: [] }).reason, 'empty');
  assert.equal(verifyAiExtract('글', null).reason, 'format');
  assert.equal(verifyAiExtract('글', { nodes: 3 }).reason, 'format');
});

test('CR-19 AI 요청: 스키마 칸은 모두 필수, 보내는 것은 글과 지금 지도의 항목 이름·유형뿐(설명·속성·사번 없음), 최대 개수 상수', () => {
  assert.deepEqual(AI_EXTRACT_SCHEMA.required, ['nodes', 'edges']);
  assert.deepEqual(AI_EXTRACT_SCHEMA.properties.nodes.items.required, ['type', 'label', 'emp_no', 'quote']);
  assert.equal(AI_EXTRACT_SCHEMA.additionalProperties, false);
  const view = viewOf('U-A1');
  const items = existingItems(view);
  assert.equal(items.length, view.raw_nodes.filter((n) => n.core_type !== 'root').length);
  assert.ok(items.every((x) => Object.keys(x).join() === 'type,label'));
  assert.equal(existingItems(view, 3).length, 3);
  assert.ok(AI_EXTRACT_MAX_EXISTING >= 100);
  const prompt = buildExtractPrompt(EXAMPLE, items);
  assert.ok(prompt.user.includes('서하늘') && prompt.user.includes('대사 확인'));
  assert.ok(!prompt.user.includes('V-1002') && !prompt.user.includes('정산 결과를 원천 자료와 대조해'), '사번·설명은 보내지 않는다');
  const back = parseExtractUser(prompt.user);
  assert.equal(back.text, EXAMPLE);
  assert.equal(back.existing.length, items.length);
  assert.deepEqual(back.existing[0], items[0]);
  assert.throws(() => buildExtractPrompt('  '), (e) => e.code === 'empty');
  assert.throws(() => buildExtractPrompt('가'.repeat(TEXT_LIMITS.maxChars + 1)), (e) => e.code === 'too_long');
  assert.equal(checkExtractInput(EXAMPLE).ok, true);
  // 글 안의 닫는 표지로 빠져나가지 못한다
  assert.equal(parseExtractUser(buildExtractPrompt('가나다 </글> 라마바', []).user).text, '가나다  라마바');
});

test('CR-19 Claude 읽기(가짜 응답): 걸러질 행은 버리고 통과한 행만 제안으로, 같은 글을 다시 읽으면 호출하지 않는다', async () => {
  const { client, provider } = aiProvider('extract');
  const view = viewOf('U-A1');
  const r = await extractTextAsync(EXAMPLE, { provider, view });
  assert.equal(r.ok, true);
  assert.equal(r.method, 'llm');
  assert.equal(r.proposal.method, 'claude_api');
  assert.equal(r.dropped.length, 4, '지어낸 업무·인용이 틀린 항목·유형 조합이 틀린 연결·끝 항목이 없는 연결');
  assert.deepEqual(r.proposal.nodes.map((n) => n.label), ['서하늘', '대사 확인', '보고', '월말 정산 보고서', '도하람']);
  assert.equal(client.calls.length, 1);
  assert.deepEqual(parseExtractUser(client.calls[0].messages[0].content).existing.length, existingItems(view).length);
  const again = await extractTextAsync(EXAMPLE, { provider, view });
  assert.equal(again.cached, true);
  assert.equal(client.calls.length, 1);
  // 저장은 하지 않는다: 제안일 뿐이다
  assert.equal(view.raw_nodes.length, viewOf('U-A1').raw_nodes.length);
});

test('CR-19 Claude 읽기 실패: 인용이 전부 틀리면 QUOTE_FAIL, 시간 초과·키 거부는 이유 문구, 키가 없으면 null(규칙 읽기만)', async () => {
  const bad = await extractTextAsync(EXAMPLE, { provider: aiProvider('extract-badquote').provider, view: viewOf('U-A1') });
  assert.equal(bad.ok, false);
  assert.equal(bad.fallback.code, QUOTE_FAIL);
  assert.match(bad.fallback.reason, /원문 인용이 확인된 항목이 하나도 없습니다\(뺀 행 \d+개\)/);
  const to = await extractTextAsync(EXAMPLE, { provider: aiProvider('timeout').provider, view: viewOf('U-A1') });
  assert.deepEqual(to, { ok: false, fallback: { code: 'W-LLM-FALLBACK', reason: '연결 실패·시간 초과' } });
  const auth = await extractTextAsync(EXAMPLE, { provider: aiProvider('auth').provider });
  assert.equal(auth.fallback.reason, '키가 맞지 않음');
  const garbage = await extractTextAsync(EXAMPLE, { provider: aiProvider('garbage').provider });
  assert.equal(garbage.ok, false);
  assert.equal(await extractTextAsync(EXAMPLE, { provider: createProvider('claude_api', { apiKey: '', client: createFakeClient() }) }), null);
  assert.equal(await extractTextAsync(EXAMPLE, { provider: createProvider('fail') }), null);
  assert.equal(await extractTextAsync(EXAMPLE, { provider: null }), null);
  const empty = await extractTextAsync('   ', { provider: aiProvider().provider });
  assert.equal(empty.ok, false);
  assert.match(empty.fallback.reason, /비어/);
});

test('CR-19 키 없는 공급자(claude_api 키 없음·실패 흉내)의 extract는 이유를 던진다(단추는 키가 있을 때만 있다)', () => {
  assert.throws(() => createProvider('claude_api', { apiKey: '' }).extract('글', []), /키가 없어/);
  assert.throws(() => createProvider('fail').extract('글', []), /호출 실패/);
});

// ── 화면(DOM 흉내) ──

const withDom = (fn) => async () => {
  const body = installDom();
  try { await fn(body); } finally { uninstallDom(); }
};

function openDialog({ aiReady = false, mode = 'extract', app = openApp() } = {}) {
  const dialog = new FakeEl('dialog');
  dialog.open = false;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.fire('close'); };
  document.body.append(dialog);
  const saved = [];
  const { provider } = aiProvider(mode);
  const open = textAddDialog({
    dialog,
    app,
    getView: () => app.view,
    aiReady: () => aiReady,
    readAi: (text) => extractTextAsync(text, { provider, view: app.view }),
    onSaved: (r) => saved.push(r),
  });
  open();
  const q = (id) => dialog.querySelector(`[data-testid=${id}]`);
  const all = (prefix) => dialog.querySelectorAll(`[data-testid^=${prefix}]`);
  const type = (id, value) => { const e = q(id); e.value = value; e.fire('input'); e.fire('change'); };
  const check = (id, on) => { const e = q(id); e.checked = on; e.fire('change'); };
  const pick = (id, value) => { const e = q(id); e.value = value; e.fire('change'); };
  return { dialog, app, saved, q, all, type, check, pick, open };
}

const rows = (d, prefix) => d.all(`${prefix}-`).filter((e) => new RegExp(`^${prefix}-\\d+$`).test(e.dataset.testid));

test('CR-19 화면: 키가 없으면 「Claude로 읽기」 단추 대신 안내 한 줄, 규칙으로 읽기 → 미리 보기(항목 5·연결 4, 있는 항목에 연결·이미 있음)', withDom(() => {
  const d = openDialog();
  assert.equal(d.q('text-add-ai'), null);
  assert.equal(d.q('text-add-ai-note').textContent, '키를 넣으면 Claude가 읽습니다');
  assert.ok(d.q('text-add-input').getAttribute('placeholder').includes('서하늘'));
  assert.equal(d.q('text-add-save').disabled, true);
  d.q('text-add-input').value = EXAMPLE;
  d.q('text-add-read').click();
  assert.equal(rows(d, 'text-add-node').length, 5);
  assert.equal(rows(d, 'text-add-edge').length, 4);
  // R17: 처음에는 지도에 이미 있는 항목만 체크 — 새로 만드는 항목은 「이름이 맞으면 체크」, 새 항목이 끝인 연결은 넣을 수 없음으로 보인다
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => !!d.q(`text-add-node-check-${i}`).checked), [true, true, true, false, false]);
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => d.q(`text-add-node-status-${i}`).textContent), [
    '있는 항목 「서하늘」에 연결', '있는 항목 「대사 확인」에 연결', '있는 항목 「보고」에 연결', '새로 만듦 — 이름이 맞으면 체크', '새 사람 — 이름이 맞으면 체크',
  ]);
  assert.deepEqual([0, 1, 2, 3].map((j) => d.q(`text-add-edge-status-${j}`).textContent), ['이미 있음', '이미 있음', '끝 항목을 넣지 않아 넣을 수 없습니다', '끝 항목을 넣지 않아 넣을 수 없습니다']);
  assert.equal(d.q('text-add-count').textContent, '넣을 항목 3개(새로 만듦 0, 있는 항목에 연결 3)·연결 0개');
  // 「모두 해제」→「모두 체크」: 모두 체크는 예전 기본 선택(이미 있는 연결은 제외)으로 돌아간다
  d.q('text-add-uncheck-all').click();
  assert.equal(d.q('text-add-count').textContent, '넣을 항목 0개(새로 만듦 0, 있는 항목에 연결 0)·연결 0개');
  d.q('text-add-check-all').click();
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => d.q(`text-add-node-status-${i}`).textContent), [
    '있는 항목 「서하늘」에 연결', '있는 항목 「대사 확인」에 연결', '있는 항목 「보고」에 연결', '새로 만듦', '새로 만듦 · 확인 필요(사람인지 확실하지 않음)',
  ]);
  assert.deepEqual([0, 1, 2, 3].map((j) => d.q(`text-add-edge-status-${j}`).textContent), ['이미 있음', '이미 있음', '새 연결', '새 연결']);
  assert.ok(!d.q('text-add-edge-check-0').checked, '이미 있는 연결은 체크하지 않는다');
  assert.equal(d.q('text-add-edge-check-2').checked, true);
  assert.equal(d.q('text-add-count').textContent, '넣을 항목 5개(새로 만듦 2, 있는 항목에 연결 3)·연결 2개');
  assert.equal(d.q('text-add-method').textContent, '규칙으로 읽었습니다.');
  assert.ok(d.q('text-add-node-quote-0').textContent.includes('서하늘(V-1003)이 대사 확인을 맡는다'));
  assert.equal(d.q('text-add-unread'), null, '읽지 못한 문장이 없으면 목록을 그리지 않는다');
  assert.ok(d.q('text-add-shapes'));
}));

test('CR-19 화면: 읽기 → 항목 하나 체크 풀기 → 저장 → 그만큼만 늘고 한 번의 기록이며 결과 줄이 보인다', withDom(() => {
  const app = openApp();
  const before = { nodes: app.doc.nodes.length, edges: app.doc.edges.length, events: app.doc.events.length };
  const d = openDialog({ app });
  d.q('text-add-input').value = EXAMPLE;
  d.q('text-add-read').click();
  d.q('text-add-check-all').click(); // R17: 처음에는 지도에 있는 항목만 체크 — 예전 흐름은 「모두 체크」 뒤에 한다
  d.check('text-add-node-check-4', false); // 도하람
  assert.equal(d.q('text-add-node-status-4').textContent, '새 사람 — 이름이 맞으면 체크', 'R17: 체크를 푼 새 사람은 「넣지 않음」 대신 이름을 확인하라는 글');
  assert.equal(d.q('text-add-edge-status-3').textContent, '끝 항목을 넣지 않아 넣을 수 없습니다');
  assert.equal(d.q('text-add-edge-check-3').disabled, true);
  d.q('text-add-save').click();
  assert.equal(d.q('text-add-done').textContent, '항목 1개·연결 1개를 넣었습니다');
  assert.equal(app.doc.nodes.length, before.nodes + 1);
  assert.equal(app.doc.edges.length, before.edges + 1);
  assert.equal(app.doc.events.length, before.events + 2);
  const added = app.doc.events.slice(before.events);
  assert.equal(new Set(added.map((e) => e.recorded_at)).size, 1);
  assert.ok(app.doc.nodes.some((n) => n.label === '월말 정산 보고서' && n.core_type === 'artifact'));
  assert.ok(!app.doc.nodes.some((n) => n.label === '도하람'));
  assert.equal(d.saved.length, 1);
  assert.equal(d.saved[0].summary, '항목 1개·연결 1개를 넣었습니다');
  assert.equal(d.q('text-add-save').disabled, true, '저장 뒤에는 미리 보기가 비어 다시 저장할 수 없다');
  assert.equal(rows(d, 'text-add-node').length, 0);
}));

test('CR-19 화면: 이름을 비우고 저장하면 막히고(아무것도 저장 안 함) 그 행에 오류가 보이며, 고치면 저장된다', withDom(() => {
  const app = openApp();
  const snap = JSON.stringify(app.doc);
  const d = openDialog({ app });
  d.q('text-add-input').value = EXAMPLE;
  d.q('text-add-read').click();
  d.q('text-add-check-all').click(); // R17
  d.type('text-add-node-label-3', '');
  assert.equal(d.q('text-add-node-status-3').textContent, '이름을 넣으세요');
  d.q('text-add-save').click();
  assert.equal(JSON.stringify(app.doc), snap);
  assert.match(d.q('text-add-message').textContent, /아무것도 저장하지 않았습니다/);
  assert.match(d.q('text-add-node-msg-3').textContent, /3번 항목|4번 항목/);
  assert.equal(d.saved.length, 0);
  d.type('text-add-node-label-3', '월말 정산 보고서');
  d.q('text-add-save').click();
  assert.equal(d.q('text-add-done').textContent, '항목 2개·연결 2개를 넣었습니다');
  assert.equal(app.doc.nodes.length, JSON.parse(snap).nodes.length + 2);
}));

test('CR-19 화면: 유형을 바꾸면 그 행의 연결 관계 목록을 다시 계산하고 안 맞으면 체크를 풀고 이유를 보인다', withDom(() => {
  const d = openDialog();
  d.q('text-add-input').value = EXAMPLE;
  d.q('text-add-read').click();
  d.q('text-add-check-all').click(); // R17
  const optionsOf = (id) => d.q(id).options.map((o) => o.value);
  assert.deepEqual(optionsOf('text-add-edge-type-2'), ['contains', 'produces', 'relates_to', 'references'].filter((r) => allowedRelations('work', 'artifact').some((x) => x.relation === r)));
  assert.equal(d.q('text-add-edge-type-2').value, 'produces');
  d.pick('text-add-node-type-3', 'person'); // 월말 정산 보고서를 사람으로
  assert.ok(!d.q('text-add-edge-check-2').checked);
  assert.equal(d.q('text-add-edge-check-2').disabled, true);
  assert.match(d.q('text-add-edge-status-2').textContent, /유형에는 이 관계를 쓸 수 없습니다/);
  assert.ok(optionsOf('text-add-edge-type-2').includes('references') && !optionsOf('text-add-edge-type-2').includes('produces'));
  assert.equal(d.q('text-add-edge-type-2').options[0].value, '', '맞는 관계가 없으면 「관계를 고르세요」가 먼저 선택된다');
  d.pick('text-add-edge-type-2', 'references');
  assert.equal(d.q('text-add-edge-status-2').textContent, '넣지 않음', '관계를 다시 고르면 막힘이 풀리고 체크는 사용자가 한다');
  d.check('text-add-edge-check-2', true);
  assert.equal(d.q('text-add-edge-status-2').textContent, '새 연결');
}));

test('CR-19 화면: 읽지 못한 문장 목록과 못 읽은 글 안내', withDom(() => {
  const d = openDialog();
  d.q('text-add-input').value = '오늘 날씨가 좋다. 서하늘이 점검을 맡는다.';
  d.q('text-add-read').click();
  assert.equal(d.q('text-add-unread-0').textContent, '오늘 날씨가 좋다');
  assert.equal(rows(d, 'text-add-node').length, 2);
  d.q('text-add-input').value = '오늘 날씨가 좋다.';
  d.q('text-add-read').click();
  assert.ok(d.q('text-add-empty'));
  assert.equal(d.q('text-add-save').disabled, false, '읽은 결과는 있으므로 저장은 누를 수 있고, 넣을 항목이 없다고 알린다');
  d.q('text-add-save').click();
  assert.equal(d.q('text-add-message').textContent, '넣을 항목이 없습니다. 항목을 체크하세요.');
  d.q('text-add-input').value = '   ';
  d.q('text-add-read').click();
  assert.equal(d.q('text-add-message').textContent, '글을 붙여 넣으세요.');
}));

test('CR-19 화면(R16): 이름만 읽은 문장은 「(일부만 읽음)」, 사번 충돌 항목은 체크 해제 + 이유, 읽은 뒤 글이 바뀌면 저장이 막히고 「다시 읽으세요」', withDom(() => {
  const app = openApp();
  const d = openDialog({ app });
  // R16-5 부분 표시, R16-6 사번 충돌(가람솔(V-1003): 지도의 V-1003은 서하늘)
  d.q('text-add-input').value = '도하람(V-2001)은 신입이다. 가람솔(V-1003)이 월말 점검을 맡는다.';
  d.q('text-add-read').click();
  assert.equal(d.q('text-add-unread-0').textContent, '도하람(V-2001)은 신입이다 (일부만 읽음)');
  const gi = [0, 1, 2].find((i) => d.q(`text-add-node-label-${i}`).value === '가람솔');
  assert.ok(!d.q(`text-add-node-check-${gi}`).checked, '사번 충돌 항목은 처음에 체크하지 않는다');
  assert.equal(d.q(`text-add-node-status-${gi}`).textContent, '넣지 않음 · 사번은 「서하늘」과 같고 이름이 다릅니다 — 확인한 뒤 체크하세요');
  assert.equal(d.q('text-add-stale').hidden, true);
  // R16-16 글 상자가 바뀌면 저장을 막는다(원래 글로 되돌리면 풀린다)
  const original = d.q('text-add-input').value;
  d.type('text-add-input', `${original} 한 문장 더.`);
  assert.equal(d.q('text-add-save').disabled, true);
  assert.equal(d.q('text-add-stale').hidden, false);
  assert.equal(d.q('text-add-stale').textContent, '글이 바뀌었습니다 — 다시 읽으세요');
  d.q('text-add-save').click();
  assert.equal(d.saved.length, 0, '바뀐 글의 이전 읽기 결과는 저장되지 않는다');
  d.type('text-add-input', original);
  assert.equal(d.q('text-add-save').disabled, false);
  assert.equal(d.q('text-add-stale').hidden, true);
  d.type('text-add-input', `${original} 한 문장 더.`);
  d.q('text-add-read').click(); // 다시 읽으면 풀린다
  assert.equal(d.q('text-add-save').disabled, false);
  assert.equal(d.q('text-add-stale').hidden, true);
}));

test('R17 화면: 「모두 체크」·「모두 해제」 단추 — 모두 체크해도 확인할 것(hold) 항목은 체크하지 않고, 읽기 전에는 단추가 없다', withDom(() => {
  const d = openDialog();
  assert.equal(d.q('text-add-check-all'), null);
  d.q('text-add-input').value = '가람솔(V-1003)이 월말 점검을 맡는다. 하늬별이 연말 점검을 맡는다';
  d.q('text-add-read').click();
  const idx = (label) => [0, 1, 2, 3].find((i) => d.q(`text-add-node-label-${i}`) && d.q(`text-add-node-label-${i}`).value === label);
  const checked = () => [0, 1, 2, 3].map((i) => !!d.q(`text-add-node-check-${i}`).checked);
  assert.deepEqual(checked(), [false, false, false, false], '지도에 없는 이름은 모두 처음에 체크하지 않는다(사번이 글에 있는 사람도)');
  d.q('text-add-check-all').click();
  assert.ok(!d.q(`text-add-node-check-${idx('가람솔')}`).checked, '사번 충돌 항목은 모두 체크해도 체크하지 않는다');
  assert.equal(d.q(`text-add-node-check-${idx('하늬별')}`).checked, true);
  assert.equal(d.q(`text-add-node-status-${idx('하늬별')}`).textContent, '새로 만듦 · 확인 필요(사람인지 확실하지 않음)');
  d.q('text-add-uncheck-all').click();
  assert.deepEqual(checked(), [false, false, false, false]);
  assert.equal(d.q(`text-add-node-status-${idx('월말 점검')}`).textContent, '새로 만듦 — 이름이 맞으면 체크');
}));

test('CR-19 화면: 읽기 전용이면 열리지 않고, 저장도 하지 않는다', withDom(() => {
  const app = openApp();
  const d = openDialog({ app });
  d.q('text-add-input').value = EXAMPLE;
  d.q('text-add-read').click();
  app.setRewinding(true);
  assert.equal(app.readOnly, true);
  d.q('text-add-save').click();
  assert.equal(d.saved.length, 0);
  d.dialog.open = false;
  d.open();
  assert.equal(d.dialog.open, false, '읽기 전용에서는 대화상자를 열지 않는다');
}));

test('CR-19 화면: 「Claude로 읽기」 — 키가 있으면 단추가 있고, 읽은 뒤 방식 문구와 뺀 행 안내, 실패하면 규칙 결과 + 「AI 읽기 실패: … — 규칙으로 읽은 결과를 보여 줍니다」', withDom(async () => {
  const ok = openDialog({ aiReady: true, mode: 'extract' });
  assert.ok(ok.q('text-add-ai'));
  assert.equal(ok.q('text-add-ai-note'), null);
  ok.q('text-add-input').value = EXAMPLE;
  ok.q('text-add-ai').click();
  assert.equal(ok.q('text-add-busy').textContent, 'Claude가 읽는 중… (최대 60초)');
  assert.equal(ok.q('text-add-ai').disabled, true);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(ok.q('text-add-busy').textContent, '');
  assert.match(ok.q('text-add-method').textContent, /^Claude가 읽었습니다\(claude-opus-5-5\)/);
  assert.equal(rows(ok, 'text-add-node').length, 5);
  assert.match(ok.q('text-add-note').textContent, /4개 행은 원문 인용이 확인되지 않거나 규칙에 맞지 않아 뺐습니다/);
  assert.equal(ok.q('text-add-fallback'), null);

  const fail = openDialog({ aiReady: true, mode: 'timeout' });
  fail.q('text-add-input').value = EXAMPLE;
  fail.q('text-add-ai').click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(fail.q('text-add-fallback').textContent, 'AI 읽기 실패: 연결 실패·시간 초과 — 규칙으로 읽은 결과를 보여 줍니다');
  assert.equal(fail.q('text-add-method').textContent, '규칙으로 읽었습니다.');
  assert.equal(rows(fail, 'text-add-node').length, 5, '실패해도 규칙 읽기 결과가 보인다');

  const bad = openDialog({ aiReady: true, mode: 'extract-badquote' });
  bad.q('text-add-input').value = EXAMPLE;
  bad.q('text-add-ai').click();
  await new Promise((r) => setTimeout(r, 20));
  assert.match(bad.q('text-add-fallback').textContent, /^AI 읽기 실패: 원문 인용이 확인된 항목이 하나도 없습니다.* — 규칙으로 읽은 결과를 보여 줍니다$/);

  // 기다리는 동안 창을 닫으면 응답을 버린다
  const closed = openDialog({ aiReady: true, mode: 'extract' });
  closed.q('text-add-input').value = EXAMPLE;
  closed.q('text-add-ai').click();
  closed.q('text-add-close').click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(closed.q('text-add-fallback'), null);
}));

test('CR-19 화면: 저장된 Claude 읽기 결과도 같은 묶음 저장을 쓴다(Claude가 읽은 제안 → 저장)', withDom(async () => {
  const app = openApp();
  const d = openDialog({ app, aiReady: true, mode: 'extract-clean' });
  d.q('text-add-input').value = EXAMPLE;
  d.q('text-add-ai').click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(rows(d, 'text-add-node').length, 5);
  assert.equal(d.q('text-add-note'), null, 'ok 응답은 뺀 행이 없다');
  d.q('text-add-save').click();
  assert.equal(d.q('text-add-message').textContent, '넣을 항목이 없습니다. 항목을 체크하세요.', 'R17: Claude 읽기도 처음에는 지도에 이미 있는 항목만 체크 — 새로 만드는 항목이 없으면 저장할 것이 없다');
  d.q('text-add-check-all').click();
  d.q('text-add-save').click();
  assert.equal(d.q('text-add-done').textContent, '항목 2개·연결 2개를 넣었습니다');
  assert.ok(app.doc.nodes.some((n) => n.label === '도하람'));
}));
