// CR-19 「글로 추가」 최종판 재검증(R19 → R20 반영, 2026-10-25): 새 줄글 79개(final19)에서 「지도에 있는 것만 체크」('existing-only') 처음 체크된 채 잘못 0건,
// 기호뿐인 줄(R19-1)·문장 수 상한으로 잘린 글(R19-2)·Claude 읽기의 원문 문장 가드(R19-3)·모양 표의 예문(R19-4)·이름 앞 현재/요즘(R19-5)·화면 문구(R19-6~9).
// 글의 truth: 글이 지금 사실로 말하는 연결("앞>관계>뒤"). 체크된 연결이 truth에 없으면 「체크된 채 잘못」. border: 사람마다 읽기가 갈리는 글(그래도 잘못 0이어야 한다).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLES } from '../app/data/index.js';
import { createApp } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import {
  TEXT_PATTERN_DOC, TEXT_UNREAD_CONTEXT_NOTE, defaultSelection, extractFromText, proposalToOps, splitSentences, splitSentencesEnd,
} from '../app/src/rules/text-extract.js';
import { verifyAiExtract } from '../app/src/llm/ai-extract.js';
import { textAddDialog } from '../app/src/ui/text-add.js';
import { FakeEl, installDom, uninstallDom } from './dom-stub.js';
import { viewOf } from './helpers.js';

const NOW = '2026-10-25T09:00:00+09:00';
const memoryStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const openApp = () => createApp({ store: createStore(memoryStorage()), samples: SAMPLES, currentId: 'U-A1', now: () => NOW });
const view = viewOf('U-A1');
const labelOf = (p, key) => p.nodes.find((n) => n.key === key).label;
const edgeKey = (p, e) => `${labelOf(p, e.from)}>${e.type}>${labelOf(p, e.to)}`;
const checkedEdges = (p, mode) => { const d = defaultSelection(p, mode); return p.edges.filter((e) => d.edges[e.key].include).map((e) => edgeKey(p, e)); };

const S = '서하늘', H = '한가람', Y = '윤바다';
const many = (n) => Array.from({ length: n }, (_, i) => ['서하늘이 보고를 맡는다.', '한가람이 자료 수집을 맡는다.', '자료 수집이 끝나면 보고를 한다.'][i % 3]).join('\n');
const CORPUS = [
  // A. 정상: 읽어야 하는 글
  { id: 'A1', text: '서하늘이 보고를 맡는다.', truth: [`${S}>performs>보고`] },
  { id: 'A2', text: '한가람이 자료 수집을 맡는다.\n자료 수집이 끝나면 보고를 한다.', truth: [`${H}>performs>자료 수집`, '자료 수집>precedes>보고'] },
  { id: 'A3', text: '보고 담당: 윤바다', truth: [`${Y}>performs>보고`] },
  { id: 'A4', text: '자료 수집 담당은 서하늘이다.', truth: [`${S}>performs>자료 수집`] },
  { id: 'A5', text: '보고에서 점검표 양식을 만든다.', truth: ['보고>produces>점검표 양식'] },
  { id: 'A6', text: '윤바다가 대사 확인을 담당한다.', truth: [`${Y}>performs>대사 확인`] },
  { id: 'A7', text: '- 서하늘이 자료 수집을 맡는다.\n- 한가람이 보고를 맡는다.', truth: [`${S}>performs>자료 수집`, `${H}>performs>보고`] },
  { id: 'A8', text: '서하늘(V-1003)이 보고를 맡는다.', truth: [`${S}>performs>보고`] },
  { id: 'A9', text: '자료 수집을 마치면 보고를 한다.', truth: ['자료 수집>precedes>보고'] },
  { id: 'A10', text: '보고 결과를 한가람에게 공유한다.', truth: [`보고>references>${H}`] },
  { id: 'A11', text: '서하늘 대리가 자료 수집을 맡고 있다.', truth: [`${S}>performs>자료 수집`] },
  { id: 'A12', text: '현재 보고 담당: 한가람', truth: [`${H}>performs>보고`] },
  { id: 'A13', text: '한가람 님이 보고를 진행 중이다.', truth: [`${H}>performs>보고`] },
  { id: 'A14', text: '보고에서 2026-06 인수인계서를 만든다.', truth: ['보고>produces>2026-06 인수인계서'] },
  { id: 'A15', text: '자료 수집이 끝나면 보고를 한다. 보고에서 점검표 양식을 만든다.', truth: ['자료 수집>precedes>보고', '보고>produces>점검표 양식'] },
  { id: 'A16', text: '1. 서하늘이 보고를 맡는다.\n2. 보고에서 점검표 양식을 만든다.', truth: [`${S}>performs>보고`, '보고>produces>점검표 양식'] },
  // B. 맥락 함정: 읽지 못한 문장이 같은 글에 있다(연결은 처음 체크되면 안 되고 안내가 떠야 한다)
  { id: 'B1', text: '아래는 지난달 안이다.\n서하늘이 보고를 맡는다.', truth: [] },
  { id: 'B2', text: '서하늘이 보고를 맡는다.\n위 문장은 틀렸다.', truth: [] },
  { id: 'B3', text: '변경 전\n한가람이 보고를 맡는다.\n변경 후\n서하늘이 보고를 맡는다.', truth: [`${S}>performs>보고`] },
  { id: 'B4', text: '회의에서 나온 의견일 뿐 확정 아님.\n윤바다가 보고를 맡는다.', truth: [] },
  { id: 'B5', text: '서하늘이 자료 수집을 맡는다.\n라고 윤바다가 잘못 말했다.', truth: [] },
  { id: 'B6', text: '가정해 보자.\n서하늘이 보고를 맡는다.', truth: [] },
  { id: 'B7', text: '서하늘이 보고를 맡는다.\n농담입니다.', truth: [] },
  { id: 'B8', text: 'Q.\n서하늘이 보고를 맡는다.', truth: [] },
  { id: 'B9', text: '다음 문장은 예시다.\n한가람이 자료 수집을 맡는다.', truth: [] },
  { id: 'B10', text: '후보안 2\n윤바다가 대사 확인을 맡는다.', truth: [] },
  { id: 'B11', text: '서하늘이 보고를 맡는다.\n(이건 제 희망 사항입니다)', truth: [] },
  { id: 'B12', text: '서하늘이 보고를 맡는다.\n...라는 소문이 돌았음', truth: [] },
  { id: 'B13', text: '한가람이 보고를 맡는다.\n하지만 이는 이전 체계 이야기다.', truth: [] },
  { id: 'B14', text: '※ 참고용 예문\n자료 수집이 끝나면 보고를 한다.', truth: [] },
  { id: 'B15', text: '서하늘이 보고를 맡는다.\n물론 거짓말이다.', truth: [] },
  { id: 'B16', text: '윤바다가 대사 확인을 맡는다.\n윤바다는 이미 다른 팀으로 갔다.', truth: [] },
  { id: 'B17', text: '보고 담당: 서하늘\n보고 담당 변경 요청 중', truth: [] },
  { id: 'B18', text: '정답 아님:\n서하늘이 보고를 맡는다.', truth: [] },
  { id: 'B19', text: '시험 문제) 다음 중 맞는 것은\n서하늘이 보고를 맡는다.', truth: [] },
  { id: 'B20', text: 'Before\n한가람이 보고를 맡는다.', truth: [] },
  { id: 'B21', text: '서하늘이 보고를 맡는다.\n— 라고 쓰면 안 됩니다', truth: [] },
  { id: 'B22', text: '반대로 적었습니다.\n보고가 끝나면 자료 수집을 한다.', truth: [] },
  // C. 글자 없는 줄(기호만 있는 줄)·조용히 버려지는 문장
  { id: 'C1', text: '❌\n서하늘이 보고를 맡는다.', truth: [] },
  { id: 'C2', text: '서하늘이 보고를 맡는다.\n?', truth: [] },
  { id: 'C3', text: '서하늘이 보고를 맡는다.\n???', truth: [] },
  { id: 'C4', text: '🚫\n한가람이 자료 수집을 맡는다.', truth: [] },
  { id: 'C5', text: '✗\n윤바다가 보고를 맡는다.', truth: [] },
  { id: 'C6', text: '서하늘이 보고를 맡는다.\n(?)', truth: [] },
  { id: 'C7', text: '⛔⛔⛔\n서하늘이 보고를 맡는다.', truth: [] },
  { id: 'C8', text: '서하늘이 보고를 맡는다.\n↑ ×', truth: [] },
  { id: 'C9', text: '서하늘이 보고를 맡는다.\n!?', truth: [] },
  { id: 'C10', text: '👎\n자료 수집이 끝나면 보고를 한다.', truth: [] },
  { id: 'C11', text: '❌ ❌ ❌\n한가람이 보고를 맡는다.\n❌ ❌ ❌', truth: [] },
  { id: 'C12', text: '서하늘이 보고를 맡는다.\n(???)', truth: [] },
  { id: 'C13', text: '> 서하늘이 보고를 맡는다.', truth: [`${S}>performs>보고`], border: '메일 인용 줄(남의 말)' },
  // D. 한 문장 안 뜻 함정
  { id: 'D1', text: '서하늘이 보고를 맡아.', truth: [`${S}>performs>보고`], border: '반말 평서/명령 갈림' },
  { id: 'D2', text: '서하늘이 보고를 맡아요', truth: [`${S}>performs>보고`], border: '물음표 없는 의문 가능' },
  { id: 'D3', text: '보고 담당: 서하늘 (변경 요청)', truth: [] },
  { id: 'D4', text: '보고 담당 서하늘 아님', truth: [] },
  { id: 'D5', text: '서하늘이 보고를 맡는다 하더라.', truth: [] },
  { id: 'D6', text: '서하늘이 보고를 맡는다고 가정한다.', truth: [] },
  { id: 'D7', text: '보고 담당: 한가람 → 서하늘', truth: [] },
  { id: 'D8', text: '보고 담당: 서하늘 대신 한가람', truth: [] },
  { id: 'D9', text: '보고가 끝나면 자료 수집을 한다.', truth: ['보고>precedes>자료 수집'] },
  { id: 'D10', text: '서하늘은 보고를 맡고 한가람은 자료 수집을 맡는다.', truth: [`${S}>performs>보고`, `${H}>performs>자료 수집`] },
  { id: 'D11', text: '윤바다가 보고를 맡아 왔다.', truth: [`${Y}>performs>보고`], border: '맡아 왔다(지금도인지 갈림)' },
  { id: 'D12', text: '서하늘이 보고를 맡는다 (전임: 윤바다).', truth: [`${S}>performs>보고`] },
  { id: 'D13', text: '서하늘이 보고를 맡는다 ㅋㅋ', truth: [`${S}>performs>보고`], border: '농담 표시' },
  { id: 'D14', text: 'Re: 서하늘이 보고를 맡는다.', truth: [] },
  { id: 'D15', text: '서하늘이 보고를 맡는다니.', truth: [] },
  { id: 'D16', text: '서하늘이 보고를 맡는다…', truth: [], border: '말줄임(망설임)' },
  { id: 'D17', text: '서하늘 대리가 보고를 맡는다고 들었습니다.', truth: [] },
  { id: 'D18', text: '보고 담당: 서하늘?', truth: [] },
  { id: 'D19', text: '그러니까 서하늘이 보고를 맡는다.', truth: [`${S}>performs>보고`], border: '맥락 이음말' },
  { id: 'D20', text: '서하늘이 보고를 또 맡는다.', truth: [`${S}>performs>보고`] },
  { id: 'D21', text: '보고 결과를 한가람에게 공유한다 말한다.', truth: [] },
  { id: 'D22', text: '한가람에게 대사 확인 결과를 공유하고 서하늘이 보고를 맡는다.', truth: [`대사 확인>references>${H}`, `${S}>performs>보고`] },
  { id: 'D23', text: '서하늘이 보고를 맡는다!!', truth: [`${S}>performs>보고`] },
  { id: 'D24', text: '"서하늘이 보고를 맡는다."', truth: [`${S}>performs>보고`], border: '따옴표 인용' },
  { id: 'D25', text: '윤바다(V-1002)가 보고를 맡는다.', truth: [`${Y}>performs>보고`] },
  { id: 'D26', text: '윤바다(V-1003)가 보고를 맡는다.', truth: [] },
  // E. 문장 수 상한(60) 너머의 뒤집기
  { id: 'E1', text: `${many(60)}\n위 내용은 모두 사실이 아니다.`, truth: [] },
  { id: 'E2', text: `${many(61)}\n농담입니다.`, truth: [] },
];

// ── 1. 새 줄글 79개: 「지도에 있는 것만 체크」로 처음 체크된 채 잘못 0 ─────────────────────────────
test("R20 새 줄글 79개: 'existing-only' 처음 체크된 채 잘못 0건(경계 글 포함), 'none' 저장 명령 0, 읽지 못한 문장이 있는 글은 안내가 뜬다", () => {
  assert.equal(CORPUS.length, 79);
  const app = openApp();
  const wrong = [];
  let noneOps = 0;
  let noteMiss = 0;
  for (const c of CORPUS) {
    const p = extractFromText(c.text, view);
    const bad = checkedEdges(p, 'existing-only').filter((k) => !c.truth.includes(k));
    if (bad.length) wrong.push(`${c.id}: ${bad.join('; ')}`);
    noneOps += proposalToOps(p, defaultSelection(p, 'none'), app.doc).length;
    assert.equal(proposalToOps(p, defaultSelection(p), app.doc).length, 0, `${c.id}: 기본(none)은 저장할 것이 없다`);
    if (/^[BCE]/.test(c.id) && !c.border && p.edges.length && !p.unreadContext) noteMiss += 1;
  }
  assert.deepEqual(wrong, []);
  assert.equal(noneOps, 0);
  assert.equal(noteMiss, 0, '맥락 함정·기호 줄·잘린 글: 연결이 읽혔으면 「읽지 못한 문장」 안내가 켜진다');
});

// 일상 사용 2회차 T1(2026-10-25): 「지도에 있는 업무 이름 + 결과를 X에게 공유」는 이제 읽는다 — A10(「보고 결과를 한가람에게 공유한다」, 보고는 지도에 있는 업무)도 읽혀 못 읽는 것이 없다(예전 기대: ['A10']). 사실 연결이고 truth에 있다
test('R20 새 줄글 79개: 정상 글(A1~A16)의 사실 연결은 모두 읽는다(A10은 T1 이후 읽힘)', () => {
  const missed = [];
  for (const c of CORPUS.filter((x) => x.id.startsWith('A'))) {
    const p = extractFromText(c.text, view);
    const got = p.edges.map((e) => edgeKey(p, e));
    if (c.truth.some((k) => !got.includes(k))) missed.push(c.id);
  }
  assert.deepEqual(missed, []);
});

// ── 2. Claude 가짜 응답 6개 ────────────────────────────────────────────────────────────────
const N = (type, label, quote) => ({ type, label, emp_no: '', quote });
const E = (a, b, type, quote) => ({ from_label: a, to_label: b, type, quote });
const AI_CASES = [
  ['서하늘이 보고를 맡는다는 것은 사실이 아니다.', '서하늘이 보고를 맡는다', '서하늘'],
  ['서하늘이 보고를 맡지 않는다.', '서하늘이 보고를 맡', '서하늘'],
  ['한가람이 보고를 맡는다고 들었지만 틀린 말이다.', '한가람이 보고를 맡는다', '한가람'],
  ['❌\n서하늘이 보고를 맡는다.', '서하늘이 보고를 맡는다', '서하늘'],
  ['서하늘이 보고를 맡는다. ?', '서하늘이 보고를 맡는다', '서하늘'],
  ['서하늘이 보고를 맡는다.\n위 문장은 틀렸다.', '서하늘이 보고를 맡는다', '서하늘'],
];
const aiRead = (text, quote, person) => verifyAiExtract(text, { nodes: [N('person', person, quote), N('work', '보고', quote)], edges: [E(person, '보고', 'performs', quote)] }, view, { model: 'fake' });

test("R20 Claude 가짜 응답 6개(부정·전언·기호 줄·되묻는 줄·뒤집는 문장): 'existing-only'에서 처음 체크된 연결 0, 저장 명령 0", () => {
  const app = openApp();
  for (const [text, quote, person] of AI_CASES) {
    const r = aiRead(text, quote, person);
    assert.ok(r.ok, text);
    const p = r.proposal;
    assert.deepEqual(checkedEdges(p, 'existing-only'), [], text);
    assert.equal(proposalToOps(p, defaultSelection(p, 'existing-only'), app.doc).length, 0, text);
    assert.equal(proposalToOps(p, defaultSelection(p), app.doc).length, 0, text);
  }
});

test('R20-3 Claude 읽기: 인용이 든 문장 전체에 규칙의 문장 가드를 적용 — 부정·전언·시제는 연결을 hold(「원문 문장에 부정·조건 등이 있어 확인 필요」)로 두고 모두 체크에서도 뺀다', () => {
  for (const [text, quote, person] of AI_CASES.slice(0, 3)) {
    const p = aiRead(text, quote, person).proposal;
    assert.equal(p.edges.length, 1);
    assert.match(p.edges[0].hold, /^원문 문장에 부정·조건 등이 있어 확인 필요/, text);
    assert.deepEqual(checkedEdges(p, 'all'), [], `${text}: 모두 체크에서도 hold 연결은 빠진다`);
    assert.ok(p.notes.some((n) => n.includes('인용이 든 원문 문장에 부정·조건')), text);
  }
});

test('R20-3 Claude 읽기: 깨끗한 문장은 막지 않는다(과차단 방지) — 문장 전체 인용, 앞의 「현재」, 뒤의 「~고 있다」', () => {
  for (const text of ['서하늘이 보고를 맡는다.', '현재 서하늘이 보고를 맡는다.', '서하늘이 보고를 맡고 있다.']) {
    const p = aiRead(text, text.replace(/\.$/, ''), '서하늘').proposal;
    assert.equal(p.edges[0].hold, undefined, text);
    assert.equal(p.unreadContext, false, text);
    assert.deepEqual(checkedEdges(p, 'existing-only'), ['서하늘>performs>보고'], text);
  }
  // 인용이 문장 일부이고 앞뒤에 허용된 말뿐이면 읽은 것으로 본다
  const p2 = aiRead('현재 서하늘이 보고를 맡는다.', '서하늘이 보고를 맡는다', '서하늘').proposal;
  assert.equal(p2.unreadContext, false);
  const p3 = aiRead('서하늘이 보고를 맡고 있다.', '서하늘이 보고를 맡고', '서하늘').proposal;
  assert.equal(p3.unreadContext, false);
});

test('R20-3 Claude 읽기: 인용이 문장의 일부일 뿐이고 문장 나머지에 다른 낱말이 남으면 읽지 못한 부분이 있는 것으로 친다(unreadContext, 처음 체크 안 함)', () => {
  for (const [text, quote] of [
    ['서하늘이 보고를 맡는다 그러나 한가람이 반대한다.', '서하늘이 보고를 맡는다'],
    ['서하늘이 보고를 맡는 중이지만 한가람이 반대한다.', '서하늘이 보고를 맡는'],
  ]) {
    const r = aiRead(text, quote, '서하늘');
    assert.ok(r.ok);
    const p = r.proposal;
    assert.equal(p.unreadContext, true, text);
    assert.ok(p.notes.includes(TEXT_UNREAD_CONTEXT_NOTE), text);
    assert.deepEqual(checkedEdges(p, 'existing-only'), [], text);
  }
});

test('R20-1·3 Claude 읽기: 기호뿐인 줄은 읽지 못한 문장으로 센다 — 취소·의문 기호면 앞 내용을 뒤집는 글로 보아 모두 체크도 푼다', () => {
  const p = aiRead('서하늘이 보고를 맡는다.\n❌', '서하늘이 보고를 맡는다', '서하늘').proposal;
  assert.deepEqual(p.unread, ['❌']);
  assert.equal(p.ctxVeto, true);
  assert.equal(p.unreadContext, true);
  assert.deepEqual(checkedEdges(p, 'all'), []);
});

// ── 3. R19-1 기호뿐인 조각 ─────────────────────────────────────────────────────────────
test('R20-1 문장 나누기: 글자 없는 기호 조각(❌ ? !? (?) ↑ ×, 같은 줄 「…맡는다. ❌」)은 버리지 않고 symbol로 돌려주며, 구분선·공백·점뿐인 줄만 버린다', () => {
  const sym = (t) => splitSentencesEnd(t).filter((x) => x.symbol).map((x) => x.text);
  assert.deepEqual(sym('❌'), ['❌']);
  assert.deepEqual(sym('서하늘이 보고를 맡는다.\n?'), ['?']);
  assert.deepEqual(sym('서하늘이 보고를 맡는다. ?'), ['?']);
  assert.deepEqual(sym('서하늘이 보고를 맡는다. ❌'), ['❌']);
  assert.deepEqual(sym('!?'), ['!?']);
  assert.deepEqual(sym('(?)'), ['(?)']);
  assert.deepEqual(sym('↑ ×'), ['↑ ×']);
  assert.deepEqual(sym('🚫'), ['🚫']);
  assert.deepEqual(sym('---\n===\n***\n|---|---|\n   \n...'), [], '구분선·공백·점은 버린다');
  assert.deepEqual(splitSentences('서하늘이 보고를 맡는다.\n❌'), ['서하늘이 보고를 맡는다'], 'splitSentences는 글자가 있는 문장만(기존 모양)');
  // 글자가 있는 문장은 예전과 같게 나뉜다
  assert.deepEqual(splitSentencesEnd('가나다. 라마바? 사아자').map((x) => [x.text, x.end]), [['가나다', '.'], ['라마바', '?'], ['사아자', '']]);
});

test('R20-1 규칙 읽기: 기호뿐인 줄·같은 줄 기호는 읽지 못한 문장(unread)으로 세어 unreadContext를 켠다 — 취소·의문 기호는 ctxVeto까지', () => {
  for (const t of ['❌\n서하늘이 보고를 맡는다.', '서하늘이 보고를 맡는다.\n?', '서하늘이 보고를 맡는다. ?', '서하늘이 보고를 맡는다. ❌', '서하늘이 보고를 맡는다.\n(?)', '서하늘이 보고를 맡는다.\n↑ ×', '⛔⛔⛔\n서하늘이 보고를 맡는다.', '서하늘이 보고를 맡는다.\n!?', '👎\n자료 수집이 끝나면 보고를 한다.']) {
    const p = extractFromText(t, view);
    assert.equal(p.edges.length, 1, t);
    assert.ok(p.unread.length >= 1, t);
    assert.equal(p.unreadContext, true, t);
    assert.ok(p.notes.includes(TEXT_UNREAD_CONTEXT_NOTE), t);
    assert.deepEqual(checkedEdges(p, 'existing-only'), [], t);
    assert.equal(p.ctxVeto, true, `${t}: 취소·의문 기호면 모두 체크도 푼다`);
    assert.deepEqual(checkedEdges(p, 'all'), [], t);
  }
  // 구분선은 읽지 못한 문장이 아니다
  const ok = extractFromText('---\n서하늘이 보고를 맡는다.\n===\n***', view);
  assert.equal(ok.unread.length, 0);
  assert.equal(ok.unreadContext, false);
  assert.deepEqual(checkedEdges(ok, 'existing-only'), ['서하늘>performs>보고']);
});

test('R20-2 문장 수 상한(60)으로 잘린 문장이 있으면 unreadContext(연결은 처음 체크 안 함, 안내 유지)', () => {
  const many = (n) => Array.from({ length: n }, (_, i) => ['서하늘이 보고를 맡는다.', '한가람이 자료 수집을 맡는다.', '자료 수집이 끝나면 보고를 한다.'][i % 3]).join('\n');
  const cut = extractFromText(`${many(60)}\n위 내용은 모두 사실이 아니다.`, view);
  assert.ok(cut.notes.some((n) => n.startsWith('문장이 61개라 앞의 60개만 읽었습니다')));
  assert.equal(cut.unreadContext, true);
  assert.ok(cut.notes.includes(TEXT_UNREAD_CONTEXT_NOTE));
  assert.deepEqual(checkedEdges(cut, 'existing-only'), []);
  const whole = extractFromText(many(60), view);
  assert.equal(whole.unreadContext, false, '정확히 60개면 잘리지 않았다');
  assert.ok(checkedEdges(whole, 'existing-only').length > 0);
});

// ── 4. R19-4 모양 표의 예문은 실제로 읽힌다 ────────────────────────────────────────────────
test('R20-4 읽는 모양 표(TEXT_PATTERN_DOC)의 예문은 모두 지금 규칙으로 실제로 읽힌다 — 읽지 못한 문장 없이 그 모양의 연결(또는 사번)이 나온다', () => {
  for (const x of TEXT_PATTERN_DOC) {
    const p = extractFromText(x.example, null);
    assert.deepEqual(p.unread, [], `${x.id}: 「${x.example}」이 읽지 못한 문장으로 남았다`);
    if (x.relation) assert.ok(p.edges.some((e) => e.type === x.relation), `${x.id}: ${x.relation} 연결이 나와야 한다`);
    else assert.ok(p.nodes.some((n) => n.type === 'person' && n.emp_no === 'V-1003'), `${x.id}: 사번이 붙은 사람이 나와야 한다`);
  }
  assert.equal(TEXT_PATTERN_DOC.find((x) => x.id === 'belongs_b').example, '감사팀의 도하람이 보고를 맡는다');
});

// ── 5. R19-5 이름 앞의 현재·요즘 ───────────────────────────────────────────────────────────
test('R20-5 이름 앞의 「현재·요즘·지금은」은 이름에서 뗀다 — 「현재 보고 담당: 한가람」은 업무 「보고」, 「서하늘이 요즘 보고를 맡는다」도', () => {
  for (const [t, edge] of [
    ['현재 보고 담당: 한가람', '한가람>performs>보고'],
    ['요즘 보고 담당: 한가람', '한가람>performs>보고'],
    ['서하늘이 현재 보고를 맡는다.', '서하늘>performs>보고'],
    ['지금은 서하늘이 자료 수집을 맡는다.', '서하늘>performs>자료 수집'],
  ]) {
    const p = extractFromText(t, view);
    assert.deepEqual(p.edges.map((e) => edgeKey(p, e)), [edge], t);
    assert.deepEqual(checkedEdges(p, 'existing-only'), [edge], t);
  }
});

// ── 6. 화면 ─────────────────────────────────────────────────────────────────────────────────
const withDom = (fn) => async () => {
  const body = installDom();
  try { await fn(body); } finally { uninstallDom(); }
};
function openDialog({ app = openApp(), defaultCheck = 'none', readAi = null } = {}) {
  const dialog = new FakeEl('dialog');
  dialog.open = false;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.fire('close'); };
  document.body.append(dialog);
  textAddDialog({ dialog, app, getView: () => app.view, aiReady: () => !!readAi, readAi: readAi || (() => null), onSaved: () => {}, defaultCheck })();
  const q = (id) => dialog.querySelector(`[data-testid=${id}]`);
  const type = (id, value) => { const e = q(id); e.value = value; e.fire('input'); };
  return { dialog, app, q, type };
}

test('R20-6 상태 칸: 지도에 있는 항목이어도 확인할 이유(hold)가 먼저 보이고, 이유 끝의 「확인」과 「확인한 뒤 체크하세요」가 겹치지 않는다', withDom(() => {
  const d = openDialog();
  d.type('text-add-input', '서하늘이 대사확인을 맡는다.');
  d.q('text-add-read').click();
  const status = d.dialog.querySelectorAll('[data-testid^=text-add-node-status-]').map((e) => e.textContent);
  assert.ok(status.includes('넣지 않음 · 지도의 「대사 확인」과 같은 항목인지 확인'), JSON.stringify(status));
  assert.ok(status.every((s) => !/확인 — 확인한 뒤/.test(s)), '겹침 없음');
  // 사번 hold: 이유 하나로 끝나고 「…체크하세요 — 확인한 뒤 체크하세요」 겹침이 없다
  const d2 = openDialog();
  d2.type('text-add-input', '서하늘(V-1999)이 보고를 맡는다.');
  d2.q('text-add-read').click();
  const s2 = d2.dialog.querySelectorAll('[data-testid^=text-add-node-status-]').map((e) => e.textContent);
  assert.ok(s2.some((s) => s.startsWith('넣지 않음 · 지도에 같은 이름의 사람(사번 ') && s.endsWith('이 있습니다 — 다른 사람인지 확인')), JSON.stringify(s2));
  assert.ok(s2.every((s) => (s.match(/체크하세요/g) || []).length <= 1));
}));

test('R20-7 개수 줄: 연결이 닿지 않는 지도의 항목은 세지 않고 「바뀌는 것이 없습니다」로 알린다 — 저장하면 넣을 것이 없다는 안내와 맞는다', withDom(() => {
  const d = openDialog();
  d.type('text-add-input', '서하늘이 대사 확인을 맡는다.');
  d.q('text-add-read').click();
  d.q('text-add-check-existing').click(); // 서하늘·대사 확인은 지도에 있고 연결도 이미 있어 체크할 연결이 없다
  // R21-1: 지도에 있는 항목은 「넣을 항목」에 세지 않고(체크 칸도 없음), 닿는 연결이 없으면 「이어 씀」에도 세지 않는다 — 예전 「연결이 없는 지도의 항목 2개는 바뀌는 것이 없습니다」 줄은 없어졌다
  assert.equal(d.q('text-add-count').textContent, '넣을 항목 0개(새로 만듦)·연결 0개');
  assert.equal(d.q('text-add-check-note').textContent, '지도에 있는 두 항목 사이에 새로 넣을 연결이 없습니다'); // R21-3: 단추를 눌렀는데 체크된 연결이 없는 이유
  d.q('text-add-save').click();
  assert.equal(d.q('text-add-message').textContent, '넣을 것이 없습니다. 항목이나 연결을 체크하세요.');
}));

test('R20-3 화면: Claude 읽기에서 부정이 든 원문 문장의 연결은 상태 칸에 확인 이유가 보이고 체크되어 있지 않다', withDom(async () => {
  const text = '서하늘이 보고를 맡는다는 것은 사실이 아니다.';
  const d = openDialog({ defaultCheck: 'existing-only', readAi: async (t) => aiRead(t, '서하늘이 보고를 맡는다', '서하늘') });
  d.type('text-add-input', text);
  d.q('text-add-ai').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(d.q('text-add-edge-check-0') && !d.q('text-add-edge-check-0').checked);
  assert.match(d.q('text-add-edge-status-0').textContent, /^넣지 않음 · 원문 문장에 부정·조건 등이 있어 확인 필요\(.+\)$/);
  assert.equal(d.q('text-add-edge-status-0').dataset.state, 'hold');
  d.q('text-add-save').click();
  assert.equal(d.q('text-add-message').textContent, '넣을 것이 없습니다. 항목이나 연결을 체크하세요.');
}));
