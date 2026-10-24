// CR-19 「글로 추가」 R18(2026-10-24): 금지 목록 → 허용 목록, 일부만 읽은 문장·뒤집는 문장·한두 글자 머리·공백/괄호 차이 이름, 처음 체크 모드 'none'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLES } from '../app/data/index.js';
import { createApp } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import {
  TEXT_CHECK_MODES, TEXT_DEFAULT_CHECK, defaultSelection, extractFromText, proposalToOps, resolveSelection,
} from '../app/src/rules/text-extract.js';
import { textAddDialog } from '../app/src/ui/text-add.js';
import { FakeEl, installDom, uninstallDom } from './dom-stub.js';
import { viewOf } from './helpers.js';

const view = viewOf('U-A1');
const labelOf = (p, key) => p.nodes.find((n) => n.key === key).label;
const edgeList = (p) => p.edges.map((e) => `${e.type} ${labelOf(p, e.from)}>${labelOf(p, e.to)}`);
const unreadOnly = (text, v = view) => {
  const p = extractFromText(text, v);
  return p.nodes.length === 0 && p.edges.length === 0 && p.unread.length > 0;
};
const checkedEdges = (p, sel = defaultSelection(p, 'existing-only')) => p.edges.filter((e) => sel.edges[e.key].include && sel.nodes[e.from].include && sel.nodes[e.to].include).map((e) => `${e.type} ${labelOf(p, e.from)}>${labelOf(p, e.to)}`);

test('R18 A 허용 목록: 읽은 모양에 쓰이지 않은 낱말이 앞·사이·뒤 어디에 남아도 문장 전체를 읽지 않는다. 이음말·지금은/요즘/현재·개조식 머리·이다류 꼬리는 허용', () => {
  // 앞(첫 사용 낱말 앞)
  for (const s of ['새로 온 서하늘이 보고를 맡는다', '곧 서하늘이 보고를 맡는다', '다음에는 서하늘이 보고를 맡는다', '제안: 서하늘이 보고를 맡는다', 'TBD: 한가람이 보고를 맡는다', '목표: 서하늘이 자료 수집을 맡는다', '※ 서하늘이 보고를 맡는다',
    '퍽이나 서하늘이 보고를 맡는다', '설마 윤바다가 자료 수집을 맡는다', '윤바다 부재 시 서하늘이 보고를 맡는다', '윤바다 대행 서하늘이 보고를 맡는다', 'If 서하늘이 보고를 맡는다', 'Maybe 서하늘이 보고를 맡는다']) {
    assert.ok(unreadOnly(s), s);
  }
  // 뒤(사용 범위 뒤)
  for (const s of ['서하늘이 보고를 맡는다 ㅎㅎ', '서하늘이 보고를 맡고 그만둔다', '서하늘이 자료 수집을 맡고 손을 뗀다', '서하늘이 보고를 맡는다 maybe', '서하늘이 보고를 맡는다고 윤바다가 말한다']) assert.ok(unreadOnly(s), s);
  // 사이(두 사용 범위 사이)
  assert.ok(unreadOnly('서하늘이 보고를 맡는다 그런데 한가람이 자료 수집을 맡는다'));
  // 허용
  for (const s of ['지금은 서하늘이 자료 수집을 맡습니다', '요즘 윤바다가 보고를 맡아요', '현재 한가람이 보고를 맡는다', '그리고 서하늘이 자료 수집을 맡는다', '- 서하늘이 자료 수집을 맡는다', '1) 서하늘이 자료 수집을 맡는다', '서하늘이 자료 수집을 맡고 있다', '한가람이 보고를 맡아 왔다', '보고 담당은 윤바다입니다']) {
    assert.equal(extractFromText(s, view).edges.length, 1, s);
  }
  // 「[ ]」「[x]」「❌」「✔」 표시
  for (const s of ['- [ ] 한가람이 보고를 맡는다', '[x] 서하늘이 보고를 맡는다', '❌ 서하늘이 보고를 맡는다', '✔ 서하늘이 자료 수집을 맡는다']) assert.ok(unreadOnly(s), s);
  // 콜론 머리말은 「담당:」처럼 모양의 일부가 아니면 남은 낱말이다
  assert.equal(extractFromText('보고 담당: 서하늘', view).edges.length, 1);
  for (const s of ['옛 순서: 보고 다음에 자료 수집', '변경 전: 윤바다가 보고를 맡는다', '희망: 서하늘이 보고를 맡는다', 'To-Be: 서하늘이 보고를 맡는다']) assert.ok(unreadOnly(s), s);
});

test('R18 B 「~고/~며」 뒤에 이어지는 절도 같은 규칙: 쓰이지 않은 낱말이 남으면 일부만 읽음이 아니라 문장 전체를 읽지 않는다', () => {
  for (const s of ['서하늘이 보고를 맡고 윤바다에게 공유할지 고민한다', '윤바다가 보고를 맡으며 한가람은 그걸 반대한다', '서하늘이 보고를 맡고 한가람이 그 일을 막는다', '서하늘이 보고를 맡고 필요 시 한가람에게 문의한다']) {
    const p = extractFromText(s, view);
    assert.deepEqual([p.nodes, p.edges, p.partial, p.unread], [[], [], [], [s]], s);
  }
  assert.equal(extractFromText('한가람이 대사 확인을 맡고 윤바다가 보고를 맡는다', view).edges.length, 2);
  assert.equal(extractFromText('서하늘이 자료 수집을 맡고 한가람에게 결과를 공유한다', view).edges.length, 2);
});

test('R18 C 일부만 읽은 문장(partial)의 항목·연결은 처음 체크하지 않는다', () => {
  const p = extractFromText('서하늘이 자료 수집을 맡는다', view);
  assert.deepEqual(checkedEdges(p), ['performs 서하늘>자료 수집']);
  const quote = p.edges[0].quote;
  const partial = { ...p, partial: [quote] };
  const sel = defaultSelection(partial, 'existing-only');
  assert.deepEqual([sel.nodes.n1.include, sel.nodes.n2.include, sel.edges.e1.include], [false, false, false]);
  assert.deepEqual(checkedEdges(partial, defaultSelection(partial, 'all')), [], 'R19: 모두 체크도 일부만 읽은 문장은 체크하지 않는다');
});

test('R18 D 글 안에 지도 이름이 없는 문장이 부정·시제·전언이거나 농담·취소·철회·정정·거짓·사실이 아니로 시작하면 그 글의 연결은 하나도 처음 체크하지 않고 notes에 알린다', () => {
  const NOTE = '글에 앞 내용을 뒤집는 문장이 있어 처음 체크를 모두 풀었습니다';
  for (const t of ['서하늘이 자료 수집을 맡는다. 농담이다.', '서하늘이 자료 수집을 맡는다. 취소.', '서하늘이 자료 수집을 맡는다. 철회한다.', '서하늘이 자료 수집을 맡는다. 정정: 아니다.', '서하늘이 자료 수집을 맡는다. 거짓이다.', '서하늘이 자료 수집을 맡는다. 사실이 아니다.', '서하늘이 자료 수집을 맡는다. 한가람에게 결과를 공유한다. 둘 다 취소됐다.']) {
    const p = extractFromText(t, view);
    assert.equal(p.edges.length >= 1, true, t);
    assert.deepEqual(checkedEdges(p), [], t);
    assert.ok(p.notes.includes(NOTE), t);
    assert.equal(p.ctxVeto, true);
  }
  // 대조: 뒤집는 문장이 없으면 처음 체크
  const ok = extractFromText('서하늘이 자료 수집을 맡는다. 한가람에게 결과를 공유한다.', view);
  assert.deepEqual(checkedEdges(ok), ['performs 서하늘>자료 수집', 'references 자료 수집>한가람']);
  assert.ok(!ok.notes.includes(NOTE));
  // 지도 이름이 든 문장의 부정은 ctxVeto를 켜지 않는다(그 문장만 읽지 않음). 다만 읽지 못한 문장이 있는 글이라 R19 ①로 처음 체크는 하지 않는다
  const named = extractFromText('서하늘이 자료 수집을 맡는다. 윤바다는 보고를 맡지 않는다.', view);
  assert.equal(named.ctxVeto, false);
  assert.deepEqual(checkedEdges(named), []);
  assert.equal(named.unreadContext, true);
});

test('R18 E 한두 글자 머리 문장(Q.·A.·※) 바로 뒤 문장은 읽지 않음, vs·or·또는·아니면은 나열·선택, 「아닌」은 부정', () => {
  const q = extractFromText('Q. 서하늘이 보고를 맡는다. A. 윤바다가 자료 수집을 맡는다.', view);
  assert.deepEqual([q.nodes, q.edges], [[], []]);
  assert.equal(extractFromText('Q. 서하늘이 보고를 맡는다. 윤바다가 자료 수집을 맡는다.', view).edges.length, 1, '머리 바로 뒤 문장만 읽지 않는다');
  for (const s of ['서하늘이 보고를 맡는다 vs 윤바다가 보고를 맡는다', '서하늘이 보고를 맡는다 or 윤바다가 보고를 맡는다', '서하늘이 보고를 맡는다 아니면 윤바다가 맡는다', '서하늘 또는 윤바다가 보고를 맡는다', '윤바다가 아닌 서하늘이 보고를 맡는다']) assert.ok(unreadOnly(s), s);
});

test('R18 F 지도에 공백·괄호 차이만 다른 이름이 있으면 새로 만들지 않고 그 항목에 잇되 hold로 「지도의 「…」과 같은 항목인지 확인」 — 처음 체크하지 않는다', () => {
  const a = extractFromText('서하늘이 대사확인을 맡는다', view);
  assert.deepEqual(a.nodes.map((n) => [n.label, n.match, n.hold || '']), [['서하늘', 'U-A1/N-012', ''], ['대사 확인', 'U-A1/N-001', '지도의 「대사 확인」과 같은 항목인지 확인']]);
  assert.deepEqual(checkedEdges(a), []);
  const b = extractFromText('서하늘이 보고(report)를 맡는다', view);
  assert.equal(b.nodes[1].match, 'U-A1/N-003');
  assert.equal(b.nodes[1].hold, '지도의 「보고」과 같은 항목인지 확인');
  assert.ok(b.notes.some((n) => n.includes('같은 항목인지 확인')));
  assert.deepEqual(checkedEdges(b), []);
  assert.deepEqual(checkedEdges(b, defaultSelection(b, 'all')), [], '모두 체크해도 hold 항목은 체크하지 않는다');
  assert.equal(proposalToOps(b, defaultSelection(b, 'all'), JSON.parse(JSON.stringify(SAMPLES.find((d) => d.universe.id === 'U-A1')))).filter((o) => o.op === 'addNode').length, 0, '새 항목을 만들지 않는다');
});

// ── 처음 체크 모드 'none' ──

test("R18 'none' 모드: TEXT_CHECK_MODES에 있고 기본은 none(R19). defaultSelection(p,'none')은 항목·연결 모두 체크하지 않고 저장 명령도 비어 있다", () => {
  assert.deepEqual([...TEXT_CHECK_MODES], ['existing-only', 'all', 'none']);
  assert.equal(TEXT_DEFAULT_CHECK, 'none', 'R19: 기본은 none');
  const p = extractFromText('서하늘이 자료 수집을 맡는다. 한가람이 점검을 맡는다', view);
  const dflt = defaultSelection(p);
  assert.ok(Object.values(dflt.nodes).every((x) => x.include === false) && Object.values(dflt.edges).every((x) => x.include === false), '기본(none): 처음 체크 0개');
  const none = defaultSelection(p, 'none');
  assert.ok(Object.values(none.nodes).every((x) => x.include === false) && Object.values(none.edges).every((x) => x.include === false));
  assert.deepEqual(proposalToOps(p, none, JSON.parse(JSON.stringify(SAMPLES.find((d) => d.universe.id === 'U-A1')))), []);
  const r = resolveSelection(p, none, []);
  assert.ok(Object.values(r.edges).every((e) => e.include === false));
  assert.ok(checkedEdges(p, defaultSelection(p, 'existing-only')).length === 1 && checkedEdges(p, defaultSelection(p, 'all')).length >= 1, 'existing-only·모두 체크는 그대로');
});

const withDom = (fn) => async () => {
  const body = installDom();
  try { await fn(body); } finally { uninstallDom(); }
};

test("R18 'none' 모드 화면: intro 글이 바뀌고, 처음에는 아무것도 체크되어 있지 않으며, 「모두 체크」·하나씩 체크 뒤 저장된다", withDom(() => {
  const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
  const app = createApp({ store: createStore(mem()), samples: SAMPLES, currentId: 'U-A1', now: () => '2026-10-24T15:00:00+09:00' });
  const dialog = new FakeEl('dialog');
  dialog.open = false;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.fire('close'); };
  document.body.append(dialog);
  const open = textAddDialog({ dialog, app, getView: () => app.view, aiReady: () => false, readAi: () => null, onSaved: () => {}, defaultCheck: 'none' });
  open();
  const q = (id) => dialog.querySelector(`[data-testid=${id}]`);
  // R21-1: 단추 이름이 「지도에 있는 항목끼리 연결 체크」로 바뀌고 안내가 「지도에 이미 있는 항목은 체크하지 않아도 연결에 쓰입니다」를 더한다(처음에는 아무것도 체크되어 있지 않다는 뜻은 그대로)
  assert.equal(q('text-add-intro').textContent.includes('처음에는 아무것도 체크되어 있지 않습니다 — 맞는 항목·연결을 체크하거나 「지도에 있는 항목끼리 연결 체크」「모두 체크」'), true);
  assert.ok(q('text-add-intro').textContent.includes('지도에 이미 있는 항목은 체크하지 않아도 연결에 쓰입니다')); // R20-8: introNone이 단추 이름도 말한다
  q('text-add-input').value = '서하늘이 자료 수집을 맡는다. 한가람이 점검을 맡는다';
  q('text-add-read').click();
  const nodes = dialog.querySelectorAll('[data-testid^=text-add-node-check-]');
  // R21-1: 지도에 이미 있는 항목(match, hold 아님)은 체크 칸이 없다 — 새 항목 칸만 있고 모두 체크 안 됨. 저장 명령이 0이라는 점은 아래 「넣을 항목이 없습니다」와 위 defaultSelection 시험이 지킨다
  assert.ok(nodes.length >= 1 && nodes.every((e) => !e.checked), '처음에는 아무것도 체크하지 않는다(새 항목)');
  assert.ok(dialog.querySelectorAll('[data-testid^=text-add-node-fixed-]').length >= 1, '지도에 있는 항목은 체크 칸 대신 「—」');
  assert.ok(dialog.querySelectorAll('[data-testid^=text-add-edge-check-]').every((e) => !e.checked));
  assert.equal(q('text-add-count').textContent, '넣을 항목 0개(새로 만듦)·연결 0개'); // R21-1: 개수 줄 새 모양
  q('text-add-save').click();
  assert.equal(q('text-add-message').textContent, '넣을 항목이 없습니다. 항목을 체크하세요.');
  const before = app.doc.edges.length;
  q('text-add-check-all').click();
  q('text-add-save').click();
  assert.ok(app.doc.edges.length > before, '모두 체크 뒤 저장하면 들어간다');
  assert.ok(app.doc.nodes.some((n) => n.label === '점검'));
  // R20-8: 쓰지 않던 intro(기존 글)를 없애, 시험용 모드를 줘도 안내 글은 하나(introNone)다
  const open2 = textAddDialog({ dialog, app, getView: () => app.view, aiReady: () => false, readAi: () => null, onSaved: () => {}, defaultCheck: 'existing-only' });
  open2();
  assert.ok(q('text-add-intro').textContent.includes('「지도에 있는 항목끼리 연결 체크」')); // R21-1 단추 이름
  // 모드를 주지 않으면 기본(none)
  const open3 = textAddDialog({ dialog, app, getView: () => app.view, aiReady: () => false, readAi: () => null, onSaved: () => {} });
  open3();
  assert.ok(q('text-add-intro').textContent.includes('처음에는 아무것도 체크되어 있지 않습니다'));
}));
