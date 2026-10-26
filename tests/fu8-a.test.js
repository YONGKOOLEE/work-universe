// 처음 사용 점검 8회차 ① 묶음(카드·「지금 볼 것」·미해결·찾기, FU8-4·5·9·14·15·16·17·23·28·29·30 + 일상말) 단위 검증.
// 브라우저에서 실제로 눌러 보는 점검은 tools/browser-check.mjs 「FU8 ①」이 한다. 가상 데이터만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, uninstallDom } from './dom-stub.js';
import { mkDoc, mkEdge, mkNode } from './helpers.js';
import { buildView } from '../app/src/view/view.js';
import { describeNode } from '../app/src/view/describe.js';
import { cardData } from '../app/src/view/card.js';
import { searchFeatures } from '../app/src/view/feature-index.js';
import { RECORD_SEARCH, isMineQuery, searchRecords } from '../app/src/view/recent-records.js';
import { renderNodeDetail } from '../app/src/ui/detail.js';
import { issuePanel } from '../app/src/ui/issues.js';
import { featureFind } from '../app/src/ui/feature-find.js';

const q = (root, id) => root.querySelector(`[data-testid=${id}]`);
const textBtn = (row) => row.querySelectorAll('button').find((b) => String(b.getAttribute('class')).includes('now-text'));
const qa = (root, id) => [...root.querySelectorAll(`[data-testid=${id}]`)];
const withDom = (fn) => async () => {
  const body = installDom();
  try { await fn(body); } finally { uninstallDom(); }
};
const ASOF = '2026-10-02';
const AT = (n) => `2026-10-${String(n).padStart(2, '0')}T09:00:00+09:00`;
const ev = (id, type, occurred_at, recorded_at, payload, note, source = 'user') => ({ id, type, occurred_at, recorded_at, source, payload, note });

// ── 안 통한 일상말(찾기 순위) ──
const FIRST = [
  ['업무 넘기기', 'assignee'], ['동료에게 넘기기', 'assignee'], ['제일 걱정되는 사람', 'insight'], ['위험한 업무', 'insight'],
  ['같은 사람', 'merge'], ['두 번 들어간 사람', 'merge'], ['겹친 사람', 'merge'], ['중복 사람', 'merge'], ['이름이 두 개', 'merge'],
  ['내 메모', 'recent'], ['내가 쓴 메모', 'recent'], ['할 일', 'weekly'], ['해결', 'issues'],
];
test('FU8 일상말: 안 통하던 말의 첫 결과', () => {
  for (const [text, want] of FIRST) assert.equal(searchFeatures(text)[0].id, want, `「${text}」`);
});
test('FU8 일상말: 부재·출장은 담당 넘기기·인수인계 쪽(1~3위), 「내 일」·「내 메모」·「동료에게 넘기기」에 내용 포함 HTML·폴더 연결이 오르지 않는다', () => {
  for (const t of ['부재', '출장']) assert.ok(searchFeatures(t, {}, { limit: 3 }).some((r) => ['assignee', 'draft'].includes(r.id)), t);
  for (const t of ['내 일', '내 메모', '내가 쓴 메모', '동료에게 넘기기']) {
    const ids = searchFeatures(t).map((r) => r.id);
    assert.ok(!ids.includes('html-export') || ids.indexOf('html-export') > 2, `「${t}」 ${ids}`);
    assert.ok(!ids.slice(0, 2).includes('folder'), t);
  }
  // 흔한 낱말만으로는 약하게: 「사람」·「업무」 단독은 점수 6 이하(이름에 들어 있는 기능만 한 칸 위 — RV13-4: 「사람·업무·문서 추가」가 1위)
  assert.ok(searchFeatures('사람').every((r) => r.score <= 6));
  assert.equal(searchFeatures('사람')[0].id, 'add');
  assert.equal(searchFeatures('업무')[0].id, 'add');
  assert.equal(searchFeatures('담당')[0].id, 'assignee'); // 예전 용어는 그대로
});
test('FU8-23 통합 확인: 고르면 공간까지가 아니라 통합 확인 목록 화면을 바로 연다(go = merge)', () => {
  const r = searchFeatures('같은 사람')[0];
  assert.equal(r.id, 'merge');
  assert.equal(r.go, 'merge');
});

// ── 기록 찾기 ──
function recordsView() {
  const nodes = [mkNode('N-W1', 'work', '대사 확인')];
  const events = [
    ev('E-1', 'memo', '2026-09-01', AT(1), { target_id: 'N-W1', category: 'issue' }, '대사 불일치 발생'),
    ev('E-2', 'memo', '2026-09-05', AT(2), { target_id: 'N-W1', category: 'resolved', resolves_id: 'E-1' }, '정리 끝'),
    ev('E-3', 'memo', '2026-09-08', AT(3), { target_id: 'N-W1', category: 'caution' }, '마감 전 확인', 'sample'),
    ev('E-4', 'memo', '2026-09-09', AT(4), { target_id: 'N-W1', category: 'caution' }, '두 번째 직접 메모'),
  ];
  return buildView(mkDoc('U-R', nodes, [], events), () => null);
}
test('FU8 「해결」로 찾으면 [해결됨] 기록도 걸린다(분류가 찾기 범위에 든다)', () => {
  const r = searchRecords(recordsView(), '해결');
  assert.ok(r.rows.some((x) => x.gid === 'U-R/E-2'), '해결됨 메모');
  assert.ok(r.rows.every((x) => x.kind), 'kind 있음');
});
test('FU8-9 「내가 쓴 메모」·「내 메모」는 직접 쓴 최근 기록 몇 줄(샘플 제외)을 보여 준다', () => {
  assert.ok(isMineQuery('내가 쓴 메모') && isMineQuery('내 메모') && isMineQuery('내 기록') && isMineQuery('내가 쓴'));
  assert.ok(!isMineQuery('내 일') && !isMineQuery('메모') && !isMineQuery('내용'));
  const r = searchRecords(recordsView(), '내가 쓴 메모');
  assert.equal(r.mine, true);
  assert.ok(r.rows.length >= 1 && r.rows.length <= RECORD_SEARCH.MINE_LIMIT);
  assert.ok(r.rows.every((x) => x.gid !== 'U-R/E-3'), '샘플 기록은 내가 쓴 것이 아니다');
  assert.equal(r.total, r.rows.length);
});

// ── 못 찾음 안내 조사 ──
test('FU8-30 못 찾음 안내: 받침에 맞는 조사(출장은 / 휴가는)', withDom((body) => {
  const box = document.createElement('div');
  body.append(box);
  if (typeof document.addEventListener !== 'function') document.addEventListener = () => {}; // 바깥을 누르면 닫는 처리(스텁에 없음)
  const f = featureFind({ container: box, search: () => [], onGo() {}, onPick() {}, common: () => [] });
  f.input.value = '출장';
  f.input.fire('input');
  assert.match(q(box, 'feature-find-none').textContent, /「출장」은 못 찾았어요/);
  f.input.value = '휴가';
  f.input.fire('input');
  assert.match(q(box, 'feature-find-none').textContent, /「휴가」는 못 찾았어요/);
}));

// ── 카드 「지금 볼 것」 ──
function cardOpts(view, gid, d, over = {}) {
  const c = cardData(view, gid, { asOf: ASOF, history: d.history });
  const open = new Map();
  const state = { isOpen: (k, dflt) => (open.has(k) ? open.get(k) : dflt), setOpen: (k, v, dflt) => { if (v === dflt) open.delete(k); else open.set(k, v); }, isAll: () => false, setAll() {} };
  return { data: c, state, actions: { primary: [], more: [] }, forms: [], notes: { alerts: [] }, layer: null, afterActions: [], canResolve: true, onResolve() {}, onOpenIssues() {}, onHistoryAll() {}, ...over };
}
function mixedView() {
  // W1 과 W2 가 같은 주제 T1 에 걸려 있다 → W1 카드의 미해결에 W2·주제만 단 메모가 섞인다
  const nodes = [mkNode('N-W1', 'work', '대사 확인'), mkNode('N-W2', 'work', '월말 정산'), mkNode('N-T1', 'topic', '대사 오류')];
  const edges = [mkEdge('N-W1', 'N-T1', 'relates_to')];
  const events = [
    ev('E-1', 'memo', '2026-09-01', AT(1), { target_id: 'N-W2', topic_ids: ['N-T1'], category: 'issue' }, '다른 업무의 문제'),
    ev('E-2', 'memo', '2026-09-02', AT(2), { topic_ids: ['N-T1'], category: 'issue' }, '주제만 단 문제'),
    ev('E-3', 'memo', '2026-09-03', AT(3), { target_id: 'N-W1', category: 'issue' }, '이 업무의 문제'),
    ...Array.from({ length: 5 }, (_, i) => ev(`E-${i + 4}`, 'memo', `2026-09-${10 + i}`, AT(4 + i), { target_id: 'N-W1', category: 'caution' }, `주의 ${i}`)),
  ];
  return buildView(mkDoc('U-M', nodes, edges, events), () => null);
}
test('FU8-29 지금 볼 것: 다른 업무·주제 메모 줄에는 출처 이름, 이 업무 줄에는 없다. 글을 누르면 어느 카드에서나 미해결 목록(그 업무 묶음·그 줄)', withDom((body) => {
  const view = mixedView();
  const d = describeNode(view, 'U-M/N-W1', { asOf: ASOF });
  const calls = [];
  const panel = document.createElement('div');
  body.append(panel);
  renderNodeDetail(panel, d, { onFocus() {}, linkTools: () => null, justAdded: null, card: cardOpts(view, 'U-M/N-W1', d, { onOpenIssues: (o) => calls.push(o || 'plain') }) });
  const rows = qa(panel, 'now-issue');
  assert.equal(rows.length, 2, '최신 2건');
  // 최신순: 이 업무(E-3), 주제만(E-2)
  assert.equal(q(rows[0], 'now-issue-where'), null);
  assert.equal(q(rows[1], 'now-issue-where').textContent, '같은 주제');
  textBtn(rows[1]).click();
  assert.deepEqual(calls[0], { open: 'topics', item: 'U-M/E-2' });
  textBtn(rows[0]).click();
  assert.deepEqual(calls[1], { open: 'U-M/N-W1', item: 'U-M/E-3' });
  // 머리 줄(FU8-14): 줄이 다 안 보일 때만 있고, 누르면 미해결 목록(인자 없음 — main.js가 이 업무 묶음을 펼친다)
  const head = q(panel, 'now-issues-head');
  assert.ok(head, '미해결 3건 > 보이는 2건');
  head.querySelector('button').click();
  assert.equal(calls[2], 'plain');
}));

test('FU8-17 지금 볼 것의 「해결」: 바로 처리하지 않고 「이 일이 끝났나요?」를 먼저 보인다(해결로 표시·취소)', withDom((body) => {
  const view = mixedView();
  const d = describeNode(view, 'U-M/N-W1', { asOf: ASOF });
  const resolved = [];
  const panel = document.createElement('div');
  body.append(panel);
  renderNodeDetail(panel, d, { onFocus() {}, linkTools: () => null, justAdded: null, card: cardOpts(view, 'U-M/N-W1', d, { onResolve: (g) => resolved.push(g) }) });
  const row = qa(panel, 'now-issue')[0];
  const ask = q(row, 'now-resolve-ask');
  assert.equal(ask.hidden, true, '처음엔 묻는 줄이 숨어 있다');
  q(row, 'now-resolve').click();
  assert.deepEqual(resolved, [], '「해결」만으로는 처리하지 않는다');
  assert.equal(ask.hidden, false);
  assert.match(q(row, 'now-resolve-q').textContent, /이 일이 끝났나요\?/);
  q(row, 'now-resolve-cancel').click();
  assert.equal(ask.hidden, true);
  assert.deepEqual(resolved, []);
  q(row, 'now-resolve').click();
  q(row, 'now-resolve-yes').click();
  assert.deepEqual(resolved, ['U-M/E-3']);
}));

test('FU8-5 지금 볼 것의 「반복 비효율」: 알림 칸 대신 onRepeat(인사이트 탭)으로 간다', withDom((body) => {
  const view = mixedView();
  const d = describeNode(view, 'U-M/N-W1', { asOf: ASOF });
  const calls = [];
  const panel = document.createElement('div');
  body.append(panel);
  const note = document.createElement('p');
  renderNodeDetail(panel, d, { onFocus() {}, linkTools: () => null, justAdded: null, card: cardOpts(view, 'U-M/N-W1', d, { notes: { alerts: [{ testid: 'repeat-note', label: '반복 비효율', el: note, chip: true }] }, onRepeat: () => calls.push('repeat') }) });
  const line = q(panel, 'now-alert');
  assert.match(line.textContent, /반복 비효율 — 인사이트에서 보기/);
  line.querySelector('button').click();
  assert.deepEqual(calls, ['repeat']);
}));

test('FU8-4 방금 기록한 줄(옛 날짜) 표지는 실제로 방금 기록했을 때만, 눌러 간 줄(justPicked)은 강조만', withDom((body) => {
  const nodes = [mkNode('N-W1', 'work', '대사 확인')];
  const events = Array.from({ length: 6 }, (_, i) => ev(`E-${i + 1}`, 'memo', `2026-09-${String(i + 1).padStart(2, '0')}`, AT(i + 1), { target_id: 'N-W1', category: 'caution' }, `메모 ${i + 1}`));
  const view = buildView(mkDoc('U-H', nodes, [], events), () => null);
  const d = describeNode(view, 'U-H/N-W1', { asOf: ASOF });
  for (const picked of [false, true]) {
    const panel = document.createElement('div');
    body.append(panel);
    renderNodeDetail(panel, d, { onFocus() {}, linkTools: () => null, justAdded: ['U-H/E-1'], card: cardOpts(view, 'U-H/N-W1', d, { justPicked: picked }) });
    assert.ok(q(panel, 'history-extra'), '옛 줄은 따로 보이고 강조된다');
    assert.ok(panel.querySelectorAll('li').some((li) => li.getAttribute('data-just-added') === '1'));
    assert.equal(!!q(panel, 'history-gap'), !picked, picked ? '고른 줄: 표지 글 없음' : '방금 기록: 표지 글 있음');
  }
}));

// ── 미해결 목록 ──
test('FU8-15·16 미해결 목록: openKey의 업무 묶음을 펼친다, 줄은 칸으로 나뉜다(ul.issue-list), 「해결로 표시」는 줄마다', withDom((body) => {
  const view = mixedView();
  const mk = (openKey) => issuePanel({ view, targetGid: 'U-M/N-W1', openKey, universeId: 'U-M', readOnly: false, onResolve() { return { ok: true }; }, onFocus() {}, onClose() {} });
  const nodes = [mkNode('N-W1', 'work', '대사 확인')];
  // 접힘 기준(2건 초과) 묶음을 만든다
  const events = Array.from({ length: 4 }, (_, i) => ev(`E-${i + 1}`, 'memo', `2026-09-0${i + 1}`, AT(i + 1), { target_id: 'N-W1', category: 'issue' }, `문제 ${i}`));
  const v2 = buildView(mkDoc('U-G', nodes, [], events), () => null);
  const closed = issuePanel({ view: v2, targetGid: 'U-G/N-W1', universeId: 'U-G', readOnly: false, onResolve() { return { ok: true }; }, onFocus() {}, onClose() {} });
  assert.equal(q(closed, 'issue-group').getAttribute('open'), null, '기본: 4건 묶음은 접힘');
  const opened = issuePanel({ view: v2, targetGid: 'U-G/N-W1', openKey: 'U-G/N-W1', universeId: 'U-G', readOnly: false, onResolve() { return { ok: true }; }, onFocus() {}, onClose() {} });
  assert.notEqual(opened.querySelector('[data-testid=issue-group]').getAttribute('open'), null, '카드에서 왔으면 그 업무 묶음을 펼친 채');
  body.append(opened);
  assert.equal(qa(opened, 'issue-item').length, 4);
  assert.equal(qa(opened, 'btn-resolve').length, 4, '줄마다 「해결로 표시」');
  assert.ok(opened.querySelectorAll('ul').some((u) => String(u.getAttribute('class')).includes('issue-list')));
  assert.ok(mk('topics'));
}));
