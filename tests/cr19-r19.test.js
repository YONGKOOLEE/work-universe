// CR-19 「글로 추가」 R19(2026-10-24): 기본 처음 체크 'none', 추천 표시·「지도에 있는 것만 체크」, 문장 안 우회 수정 ②~⑤, 맥락 안내 ①.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLES } from '../app/data/index.js';
import { createApp } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import {
  TEXT_DEFAULT_CHECK, TEXT_UNREAD_CONTEXT_NOTE, defaultSelection, extractFromText,
} from '../app/src/rules/text-extract.js';
import { verifyAiExtract } from '../app/src/llm/ai-extract.js';
import { textAddDialog } from '../app/src/ui/text-add.js';
import { FakeEl, installDom, uninstallDom } from './dom-stub.js';
import { viewOf } from './helpers.js';

const view = viewOf('U-A1');
const nothing = (text) => {
  const p = extractFromText(text, view);
  return p.nodes.length === 0 && p.edges.length === 0 && p.unread.length > 0;
};

test("R19 기본 모드는 'none' — 아무것도 처음 체크하지 않고, 'existing-only'·'all'은 모드를 명시하면 그대로", () => {
  assert.equal(TEXT_DEFAULT_CHECK, 'none');
  const p = extractFromText('서하늘이 자료 수집을 맡는다. 한가람이 점검을 맡는다', view);
  const sel = (m) => defaultSelection(p, m);
  const on = (s) => [...Object.values(s.nodes), ...Object.values(s.edges)].filter((x) => x.include).length;
  assert.equal(on(defaultSelection(p)), 0);
  assert.equal(on(sel('none')), 0);
  assert.ok(on(sel('existing-only')) >= 3);
  assert.ok(on(sel('all')) > on(sel('existing-only')));
});

test('R19 ② 문장 안에 ?·？·‽가 있으면(「?!」「?.」 꼴 포함) 질문이라 읽지 않는다', () => {
  for (const s of ['한가람이 보고를 맡는다?!', '한가람이 보고를 맡는다 ?!', '한가람이 보고를 맡는다?.', '자료 수집이 끝나면 보고를 한다?!', '보고에서 점검표 양식을 만든다?!', '한가람이 보고를 맡는다‽']) assert.ok(nothing(s), s);
});

test('R19 ③ 소속 모양은 소속 낱말만 쓴 것으로 센다: 뒤에 이어지는 말이 있으면 문장을 읽지 않는다', () => {
  for (const s of ['감사팀 소속 한가람이 보고를 맡는다 라고 윤바다가 착각한다', '감사팀의 한가람이 보고를 맡는다 윤바다 휴가 때만', '감사팀의 한가람이 보고를 맡는다 하는 소문은 헛소문']) assert.ok(nothing(s), s);
  assert.equal(extractFromText('감사팀의 한가람이 보고를 맡는다', view).edges.length, 2, '소속 뒤 수행이 모두 쓰이면 읽는다');
});

test('R19 ④ 참조 모양은 대상·동사와 그 사이의 일반 목적어·부사만 쓴 것으로 센다: 요청·바람이 끼면 문장을 읽지 않는다', () => {
  for (const s of ['윤바다에게 한가람이 보고를 맡아 달라고 문의한다', '서하늘에게 윤바다가 자료 수집을 맡아 주길 요청하고 보고한다', '한가람에게 서하늘이 보고를 맡아 주면 좋겠다고 전달한다']) assert.ok(nothing(s), s);
  assert.equal(extractFromText('서하늘이 보고를 맡고 한가람에게 따로 결과를 공유한다', view).edges.length, 2, '부사·일반 목적어는 허용');
  // 두 글자 ~면(주면·가면)도 조건이다. 명사 「화면」은 예외
  for (const s of ['한가람이 주면 보고를 맡는다', '윤바다가 가면 한가람이 보고를 맡는다']) assert.ok(nothing(s), s);
  assert.equal(extractFromText('화면 개선 담당: 한가람', view).edges.length, 1);
  assert.equal(extractFromText('자료 수집을 마치면 대사 확인을 한다', view).edges.length, 1);
});

test('R19 ⑤ 그때·이때·이후·우선은 이름 떼기에는 쓰되 허용 목록 판정에서는 뺀다', () => {
  for (const s of ['우선 한가람이 보고를 맡는다', '이후 한가람이 보고를 맡는다', '이때 한가람이 보고를 맡는다', '그때 한가람이 보고를 맡는다']) assert.ok(nothing(s), s);
  assert.equal(extractFromText('그리고 한가람이 보고를 맡는다', view).edges.length, 1, '그리고는 허용');
  assert.equal(extractFromText('자료 수집이 끝나면 우선 보고를 한다', view).edges.length, 1, '이름 떼기에는 쓴다(이름에 섞이지 않는다)');
});

test('R19 시제 가드(갔·났·뗐·뒀·졌), 짧은 머리의 쌍점, 지도 이름 낱말 경계(ctxVeto)', () => {
  const NOTE = '글에 앞 내용을 뒤집는 문장이 있어 처음 체크를 모두 풀었습니다';
  for (const t of ['다른 팀으로 갔다', '이미 끝났다', '지금은 손을 뗐다', '맡겨 뒀다', '일정이 늦어졌다']) {
    const p = extractFromText(`윤바다가 자료 수집을 맡는다. ${t}.`, view);
    assert.equal(p.ctxVeto, true, t);
    assert.ok(p.notes.includes(NOTE), t);
    assert.deepEqual(p.edges.filter((e) => defaultSelection(p, 'all').edges[e.key].include), [], `${t}: 모두 체크도 이 글의 연결은 체크하지 않는다`);
  }
  // 쌍점은 길이에서 뺀다: 「보기:」(쌍점 빼면 2글자)는 짧은 머리라 바로 뒤 문장을 읽지 않는다
  assert.ok(nothing('보기:\n한가람이 보고를 맡는다'));
  // 「보고된」은 지도의 「보고」라는 낱말이 아니다 — 지도 이름이 든 문장이 아니므로 뒤집는 문장으로 본다
  const b = extractFromText('한가람이 보고를 맡는다. 위 내용은 잘못 보고된 것이다.', view);
  assert.equal(b.ctxVeto, true);
});

test('R19 ① 읽지 못한 문장이 있고 읽은 연결이 있으면 notes에 안내 + existing-only에서도 연결을 처음 체크하지 않는다(항목은 체크)', () => {
  const p = extractFromText('변경 전:\n한가람이 보고를 맡는다', view);
  assert.equal(p.unreadContext, true);
  assert.ok(p.notes.includes(TEXT_UNREAD_CONTEXT_NOTE));
  const sel = defaultSelection(p, 'existing-only');
  assert.deepEqual(Object.values(sel.edges).map((e) => e.include), [false]);
  assert.deepEqual(Object.values(sel.nodes).map((n) => n.include), [true, true]);
  assert.deepEqual(Object.values(defaultSelection(p, 'all').edges).map((e) => e.include), [true], '모두 체크는 사용자의 선택');
  // 읽지 못한 문장이 없으면 안내도 없다
  const ok = extractFromText('한가람이 보고를 맡는다', view);
  assert.ok(!ok.unreadContext && !ok.notes.includes(TEXT_UNREAD_CONTEXT_NOTE));
  // Claude 읽기도 같다
  const ai = verifyAiExtract('서하늘이 대사 확인을 맡는다. 보고가 끝나면 자료 수집을 한다.', { nodes: [{ type: 'person', label: '서하늘', emp_no: '', quote: '서하늘이 대사 확인을 맡는다' }, { type: 'work', label: '대사 확인', emp_no: '', quote: '서하늘이 대사 확인을 맡는다' }], edges: [{ from_label: '서하늘', to_label: '대사 확인', type: 'performs', quote: '서하늘이 대사 확인을 맡는다' }] }, view);
  assert.equal(ai.proposal.unreadContext, true);
  assert.ok(ai.proposal.notes.includes(TEXT_UNREAD_CONTEXT_NOTE));
  assert.deepEqual(Object.values(defaultSelection(ai.proposal, 'existing-only').edges).map((e) => e.include), [false]);
});

const withDom = (fn) => async () => {
  const body = installDom();
  try { await fn(body); } finally { uninstallDom(); }
};

test('R19 화면: 기본(none)은 아무것도 체크 안 됨 + 지도에 있는 항목에는 「지도에 있음」 표시, 「지도에 있는 것만 체크」·「모두 체크」·「모두 해제」, 읽지 못한 문장 안내 줄', withDom(() => {
  const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
  const app = createApp({ store: createStore(mem()), samples: SAMPLES, currentId: 'U-A1', now: () => '2026-10-24T15:00:00+09:00' });
  const dialog = new FakeEl('dialog');
  dialog.open = false;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.fire('close'); };
  document.body.append(dialog);
  textAddDialog({ dialog, app, getView: () => app.view, aiReady: () => false, readAi: () => null, onSaved: () => {} })();
  const q = (id) => dialog.querySelector(`[data-testid=${id}]`);
  assert.ok(q('text-add-intro').textContent.includes('처음에는 아무것도 체크되어 있지 않습니다'));
  q('text-add-input').value = '변경 전:\n서하늘이 자료 수집을 맡는다. 한가람이 점검을 맡는다';
  q('text-add-read').click();
  const checks = () => dialog.querySelectorAll('[data-testid^=text-add-node-check-]').map((e) => !!e.checked);
  // R21-1: 지도에 있는 항목은 체크 칸이 없다(늘 연결의 끝으로 쓰임). 남은 체크 칸(새 항목)은 모두 해제
  assert.ok(checks().length >= 1 && checks().every((c) => !c));
  assert.equal(q('text-add-count').textContent, '넣을 항목 0개(새로 만듦)·연결 0개');
  const statuses = dialog.querySelectorAll('[data-testid^=text-add-node-status-]').map((e) => e.textContent);
  assert.ok(statuses.includes('지도에 있는 항목 — 새로 만들지 않고 이어 씁니다'), JSON.stringify(statuses)); // R21-1: 예전 「지도에 있음 — 「서하늘」에 연결(체크하면 넣습니다)」(이미 있는 사람을 넣는다는 오해)
  assert.ok(statuses.includes('새로 만듦 — 이름이 맞으면 체크'));
  assert.equal(q('text-add-context-note').textContent, TEXT_UNREAD_CONTEXT_NOTE, '화면 맨 위 안내 줄');
  assert.ok(!dialog.querySelectorAll('[data-testid=text-add-note]').some((e) => e.textContent === TEXT_UNREAD_CONTEXT_NOTE), '같은 안내를 두 번 그리지 않는다');
  const edgeStatus = dialog.querySelectorAll('[data-testid^=text-add-edge-status-]').map((e) => e.textContent);
  assert.ok(edgeStatus.includes('지도에 있는 두 항목 사이 — 체크하면 넣습니다') || edgeStatus.includes('이미 있음'), JSON.stringify(edgeStatus)); // R21-1: 두 끝이 지도에 있으면 끝 항목을 체크할 필요가 없다
  // 지도에 있는 항목끼리 연결 체크: 읽지 못한 문장이 있는 글이라 연결은 체크하지 않음 — R21-3: 그 이유를 단추 아래에 보인다. 새 항목은 이 단추가 체크하지 않는다
  q('text-add-check-existing').click();
  assert.ok(checks().every((c) => !c), '새 항목은 체크하지 않는다');
  assert.equal(q('text-add-check-note').textContent, '읽지 못한 문장이 있어 연결 1개는 체크하지 않았습니다 — 위의 읽지 못한 문장을 확인한 뒤 직접 체크하세요', 'R21-3: 맥락 안전 규칙으로 뺀 연결 수와 이유');
  assert.equal(q('text-add-count').textContent.includes('연결 0개'), true);
  q('text-add-uncheck-all').click();
  assert.ok(checks().every((c) => !c));
  assert.equal(q('text-add-check-note'), null, '다른 단추를 누르면 안내가 사라진다');
  q('text-add-check-all').click();
  assert.equal(q('text-add-count').textContent.includes('연결 0개'), false, '모두 체크는 사용자의 선택이라 연결도 체크(읽지 못한 문장 안내만)');
}));
