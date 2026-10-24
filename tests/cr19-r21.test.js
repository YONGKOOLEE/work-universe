// CR-19 「글로 추가」 R21(2026-10-25, 처음 사용 점검 5회차 반영): 지도에 이미 있는 항목은 체크 칸 없이 늘 연결의 끝으로 쓰인다,
// 연결을 체크하면 새 끝 항목도 함께 체크, 「지도에 있는 항목끼리 연결 체크」가 맥락 규칙으로 뺀 연결 수를 알림, 읽지 못한 문장 목록이 표 위로 올라가고 문장마다 이유.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLES } from '../app/data/index.js';
import { createApp } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import {
  TEXT_DEFAULT_CHECK, contextHeldBack, defaultSelection, docCandidates, extractFromText, proposalToOps, resolveSelection,
} from '../app/src/rules/text-extract.js';
import { textAddDialog } from '../app/src/ui/text-add.js';
import { FakeEl, installDom, uninstallDom } from './dom-stub.js';
import { viewOf } from './helpers.js';

const NOW = '2026-10-25T09:00:00+09:00';
const memoryStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const openApp = () => createApp({ store: createStore(memoryStorage()), samples: SAMPLES, currentId: 'U-A1', now: () => NOW });
const view = viewOf('U-A1');

// ── 1. 규칙 모듈 ─────────────────────────────────────────────────────────────

test('R21-1 resolveSelection: 지도에 있는 항목(hold 아님)은 선택과 관계없이 include·fixed, hold 항목은 사람이 체크해야 include', () => {
  const app = openApp();
  const p = extractFromText('도하람이 대사 확인을 맡는다. 서하늘이 대사확인을 맡는다.', view);
  const sel = defaultSelection(p, 'none');
  const r = resolveSelection(p, sel, docCandidates(app.doc), app.doc.edges);
  const by = (label) => Object.values(r.nodes).find((x) => x.label === label);
  assert.equal(by('대사 확인').fixed, true);
  assert.equal(by('대사 확인').include, true, '지도에 있는 항목은 체크 없이 연결의 끝');
  assert.equal(by('도하람').include, false, '새 항목은 사람이 체크해야 한다');
  assert.equal(by('도하람').fixed, false);
  // 「대사확인」(띄어쓰기 차이)은 지도의 「대사 확인」에 잇되 확인할 것(hold)이라 fixed가 아니다
  const holdNode = p.nodes.find((n) => n.hold);
  assert.ok(holdNode, '띄어쓰기 차이 이름은 hold');
  assert.equal(r.nodes[holdNode.key].fixed, false);
  assert.equal(r.nodes[holdNode.key].include, false);
  const r2 = resolveSelection(p, { nodes: { [holdNode.key]: { include: true } }, edges: {} }, docCandidates(app.doc), app.doc.edges);
  assert.equal(r2.nodes[holdNode.key].include, true);
});

test("R21-1 안전: 'none' 기본에서 저장 명령 0 — 지도에 있는 항목이 늘 include여도 연결을 사람이 체크하기 전에는 아무것도 저장하지 않는다", () => {
  assert.equal(TEXT_DEFAULT_CHECK, 'none');
  const app = openApp();
  for (const text of ['도하람이 대사 확인을 맡는다.', '서하늘이 자료 수집을 맡는다. 한가람이 점검을 맡는다', '서하늘이 대사 확인을 맡는다. 대사 확인이 끝나면 보고를 한다.']) {
    const p = extractFromText(text, view);
    assert.deepEqual(proposalToOps(p, defaultSelection(p), app.doc), [], text);
  }
});

test('R21-2 proposalToOps: 지도에 있는 항목은 새로 만들지 않고 연결의 끝으로 쓰이며, 새 끝 항목은 연결과 함께 넣어야 저장된다', () => {
  const app = openApp();
  const p = extractFromText('도하람이 대사 확인을 맡는다.', view);
  const edge = p.edges[0];
  const person = p.nodes.find((n) => n.label === '도하람');
  // 연결만 체크하고 새 끝 항목을 체크하지 않으면 저장되지 않는다(화면은 연결을 체크할 때 끝 항목을 함께 체크한다)
  assert.deepEqual(proposalToOps(p, { nodes: {}, edges: { [edge.key]: { include: true } } }, app.doc), []);
  const ops = proposalToOps(p, { nodes: { [person.key]: { include: true } }, edges: { [edge.key]: { include: true } } }, app.doc);
  assert.deepEqual(ops.map((o) => o.op), ['addNode', 'assign']);
  assert.equal(ops.filter((o) => o.op === 'addNode').length, 1, '지도에 있는 「대사 확인」은 새로 만들지 않는다');
});

test('R21-3 contextHeldBack: 읽지 못한 문장(unreadContext)·뒤집는 문장(ctxVeto) 때문에 「지도에 있는 항목끼리 연결 체크」가 뺀 연결 수', () => {
  const clean = extractFromText('서하늘이 자료 수집을 맡는다.', view);
  assert.equal(contextHeldBack(clean), 0, '읽지 못한 문장이 없으면 뺀 것이 없다');
  const unread = extractFromText('변경 전:\n서하늘이 자료 수집을 맡는다. 한가람이 점검을 맡는다', view);
  assert.equal(unread.unreadContext, true);
  assert.equal(contextHeldBack(unread), 1, '두 끝이 지도에 있는 연결 1개를 맥락 규칙으로 뺐다(점검은 새 항목이라 이 단추의 대상이 아니다)');
  assert.deepEqual(Object.values(defaultSelection(unread, 'existing-only').edges).map((x) => x.include), [false, false]);
  // 같은 연결이 이미 있으면 맥락 규칙이 아니어도 체크하지 않으니 세지 않는다
  const exists = extractFromText('변경 전:\n서하늘이 대사 확인을 맡는다.', view);
  assert.equal(contextHeldBack(exists), 0);
});

test('R21-4 unreadWhy: 읽지 못한 문장마다 쉬운 말 이유가 같은 순서로 붙고, 사람이 만든 산출물 문장은 쓰는 법을 알려 준다', () => {
  const p = extractFromText('한가람이 정산 요약표를 만든다. 서하늘이 보고를 맡지 않는다. 6월에 서하늘이 보고를 맡는다. 오늘 날씨가 좋다. 서하늘이 보고를 맡았다.', view);
  assert.equal(p.unreadWhy.length, p.unread.length);
  const why = Object.fromEntries(p.unread.map((s, i) => [s, p.unreadWhy[i]]));
  assert.equal(why['한가람이 정산 요약표를 만든다'], '사람이 만든 산출물은 이을 수 없습니다 — 「업무 이름에서 정산 요약표를 만든다」처럼 업무를 넣어 쓰세요');
  assert.match(why['서하늘이 보고를 맡지 않는다'], /^부정/);
  assert.match(why['6월에 서하늘이 보고를 맡는다'], /^날짜·기간/);
  assert.match(why['오늘 날씨가 좋다'], /^읽는 모양에 맞지 않음/);
  assert.match(why['서하늘이 보고를 맡았다'], /^지난 일/);
  // 이름만 읽은 문장은 「일부만 읽음」 이유
  const part = extractFromText('도하람(V-2001)은 신입이다.', view);
  assert.deepEqual(part.unreadWhy, ['이름은 읽었지만 연결 모양을 다 읽지 못함']);
  // 업무를 넣어 쓴 문장은 읽힌다
  const ok = extractFromText('정산에서 정산 요약표를 만든다.', view);
  assert.deepEqual(ok.unread, []);
  assert.ok(ok.edges.some((e) => e.type === 'produces'));
});

// ── 2. 화면 ─────────────────────────────────────────────────────────────────

const withDom = (fn) => async () => {
  const body = installDom();
  try { await fn(body); } finally { uninstallDom(); }
};
function openDialog({ app = openApp(), defaultCheck } = {}) {
  const dialog = new FakeEl('dialog');
  dialog.open = false;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.fire('close'); };
  document.body.append(dialog);
  const saved = [];
  textAddDialog({ dialog, app, getView: () => app.view, aiReady: () => false, readAi: () => null, onSaved: (r) => saved.push(r), ...(defaultCheck ? { defaultCheck } : {}) })();
  const q = (id) => dialog.querySelector(`[data-testid=${id}]`);
  const all = (prefix) => dialog.querySelectorAll(`[data-testid^=${prefix}]`);
  const type = (id, value) => { const e = q(id); e.value = value; e.fire('input'); };
  const check = (id, on) => { const e = q(id); e.checked = on; e.fire('change'); };
  return { dialog, app, saved, q, all, type, check };
}

test('R21-1·2 화면(실무자 흐름): 새 사람 연결을 체크하면 새 사람도 함께 체크되고, 지도에 있는 항목은 체크하지 않아도 되어 저장된다', withDom(() => {
  const app = openApp();
  const before = { nodes: app.doc.nodes.length, edges: app.doc.edges.length };
  const d = openDialog({ app });
  d.type('text-add-input', '도하람이 대사 확인을 맡는다.');
  d.q('text-add-read').click();
  const statuses = d.all('text-add-node-status-').map((e) => e.textContent);
  assert.ok(statuses.includes('지도에 있는 항목 — 새로 만들지 않고 이어 씁니다'), JSON.stringify(statuses));
  assert.equal(d.all('text-add-node-check-').length, 1, '체크 칸은 새 사람 하나뿐');
  assert.equal(d.q('text-add-edge-status-0').textContent, '「도하람」을 체크하면 넣을 수 있습니다');
  assert.equal(d.q('text-add-edge-check-0').disabled, false);
  d.check('text-add-edge-check-0', true);
  assert.equal(d.q('text-add-node-check-0').checked, true, '연결을 체크하면 새 끝 항목도 함께 체크');
  assert.equal(d.q('text-add-edge-status-0').textContent, '새 연결');
  assert.equal(d.q('text-add-count').textContent, '넣을 항목 1개(새로 만듦)·연결 1개 · 지도 항목 1개 이어 씀');
  d.q('text-add-save').click();
  assert.equal(app.doc.nodes.length, before.nodes + 1);
  assert.equal(app.doc.edges.length, before.edges + 1);
  assert.equal(d.saved.length, 1);
}));

test('R21-2 화면: 새 끝 항목의 체크를 풀면 그 항목에 걸린 연결도 풀리고, 항목을 다시 체크해도 연결은 사람이 다시 체크한다', withDom(() => {
  const d = openDialog();
  d.type('text-add-input', '도하람이 대사 확인을 맡는다.');
  d.q('text-add-read').click();
  d.check('text-add-node-check-0', true);
  d.check('text-add-edge-check-0', true);
  assert.equal(d.q('text-add-edge-check-0').checked, true);
  d.check('text-add-node-check-0', false);
  assert.equal(!!d.q('text-add-edge-check-0').checked, false);
  assert.equal(d.q('text-add-edge-status-0').textContent, '「도하람」을 체크하면 넣을 수 있습니다');
  d.check('text-add-node-check-0', true);
  assert.equal(!!d.q('text-add-edge-check-0').checked, false, '항목을 다시 체크해도 연결은 저절로 돌아오지 않는다');
  d.q('text-add-save').click();
  assert.equal(d.q('text-add-done').textContent, '항목 1개·연결 0개를 넣었습니다', '연결은 체크하지 않았으니 새 항목만 들어간다');
}));

test('R21-2 화면: 확인할 것(hold)이 있는 지도 항목은 체크 칸이 남고, 그 항목이 끝인 연결은 항목을 체크하기 전에는 잠겨 있으며 상태 칸이 이름을 말한다', withDom(() => {
  const d = openDialog();
  d.type('text-add-input', '한가람이 대사확인을 맡는다.');
  d.q('text-add-read').click();
  assert.equal(d.all('text-add-node-fixed-').length, 1, '한가람(지도에 있음)만 체크 칸이 없다');
  assert.equal(d.all('text-add-node-check-').length, 1, '「대사 확인」(hold)은 체크 칸이 남는다');
  assert.equal(d.q('text-add-node-status-1').textContent, '넣지 않음 · 지도의 「대사 확인」과 같은 항목인지 확인');
  assert.equal(d.q('text-add-edge-status-0').textContent, '「대사 확인」을 체크하면 넣을 수 있습니다');
  assert.equal(d.q('text-add-edge-check-0').disabled, true, '확인할 것이 있는 끝 항목은 연결을 체크해도 저절로 체크하지 않는다 — 항목을 먼저 체크');
  d.check('text-add-node-check-1', true); // 노드 행 번호 1 = 「대사 확인」
  assert.equal(d.q('text-add-node-status-1').textContent.startsWith('있는 항목 「대사 확인」에 연결'), true);
  assert.equal(d.q('text-add-edge-check-0').disabled, false);
  d.check('text-add-edge-check-0', true);
  assert.equal(d.q('text-add-count').textContent, '넣을 항목 0개(새로 만듦)·연결 1개 · 지도 항목 2개 이어 씀');
}));

test("R21-3 화면: 「지도에 있는 항목끼리 연결 체크」가 읽지 못한 문장 때문에 연결을 뺐으면 단추 아래에 그 수와 이유를 보이고, 다른 단추를 누르면 사라진다", withDom(() => {
  const d = openDialog();
  assert.equal(d.q('text-add-check-existing'), null, '읽기 전에는 단추가 없다');
  d.type('text-add-input', '변경 전:\n서하늘이 자료 수집을 맡는다. 한가람이 점검을 맡는다');
  d.q('text-add-read').click();
  assert.equal(d.q('text-add-check-existing').textContent, '지도에 있는 항목끼리 연결 체크');
  assert.equal(d.q('text-add-check-note'), null, '누르기 전에는 안내가 없다');
  d.q('text-add-check-existing').click();
  assert.equal(d.q('text-add-check-note').textContent, '읽지 못한 문장이 있어 연결 1개는 체크하지 않았습니다 — 위의 읽지 못한 문장을 확인한 뒤 직접 체크하세요');
  assert.equal(d.q('text-add-count').textContent, '넣을 항목 0개(새로 만듦)·연결 0개');
  d.q('text-add-check-all').click();
  assert.equal(d.q('text-add-check-note'), null);
  // 읽지 못한 문장이 없는 글: 두 끝이 지도에 있는 새 연결이 체크되고 안내는 없다
  d.type('text-add-input', '서하늘이 자료 수집을 맡는다.');
  d.q('text-add-read').click();
  d.q('text-add-check-existing').click();
  assert.equal(d.q('text-add-check-note'), null);
  assert.equal(d.q('text-add-count').textContent, '넣을 항목 0개(새로 만듦)·연결 1개 · 지도 항목 2개 이어 씀');
}));

test('R21-4 화면: 읽지 못한 문장 목록은 맥락 안내 바로 아래·표 위에 있고 문장마다 이유가 붙으며, 「사람이 만든 산출물」 문장은 쓰는 법을 알려 준다', withDom(() => {
  const d = openDialog();
  d.type('text-add-input', '서하늘이 자료 수집을 맡는다. 한가람이 정산 요약표를 만든다.');
  d.q('text-add-read').click();
  const order = d.q('text-add-preview').children.map((c) => (c.dataset && c.dataset.testid) || c.tagName);
  const iNote = order.indexOf('text-add-context-note');
  const iUnread = order.indexOf('text-add-unread');
  const iNodes = order.findIndex((x) => x === 'DIV' || x === 'div'); // 항목 표를 감싼 div
  assert.ok(iNote >= 0 && iUnread === iNote + 1, `맥락 안내 바로 아래: ${JSON.stringify(order)}`);
  assert.ok(iUnread < iNodes, '표보다 위');
  assert.equal(d.q('text-add-unread-0').textContent, '한가람이 정산 요약표를 만든다 — 사람이 만든 산출물은 이을 수 없습니다 — 「업무 이름에서 정산 요약표를 만든다」처럼 업무를 넣어 쓰세요');
  assert.equal(d.q('text-add-unread-why-0').textContent.startsWith(' — 사람이 만든 산출물은 이을 수 없습니다'), true);
}));

test('R21-5 안내: 키가 없을 때 「설정」에서 넣는다고 말한다', withDom(() => {
  const d = openDialog();
  assert.equal(d.q('text-add-ai-note').textContent, '「설정」에서 키를 넣으면 Claude가 읽습니다');
}));
