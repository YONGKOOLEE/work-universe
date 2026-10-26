// 사용자 의견 3개(10-26 저녁) 단위 검증: 일상말 → 기능 순위, 자주 하는 일, 지도 안 항목 이름 찾기, 마감 남은 날수, 카드 첫 화면(접힘)과 「지금 볼 것」 줄의 이동.
// 실제 브라우저 점검(tools/browser-check.mjs 「사용자 의견 10-26 저녁」)을 대신하지 않는다. 가상 데이터만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, uninstallDom } from './dom-stub.js';
import { mkDoc, mkEdge, mkNode } from './helpers.js';
import { buildView } from '../app/src/view/view.js';
import { describeNode } from '../app/src/view/describe.js';
import { cardData, deadlineLeft } from '../app/src/view/card.js';
import { COMMON_FEATURES, FEATURES, commonFeatures, searchFeatures, searchMapItems } from '../app/src/view/feature-index.js';
import { renderNodeDetail } from '../app/src/ui/detail.js';

const q = (root, id) => root.querySelector(`[data-testid=${id}]`);
const withDom = (fn) => async () => {
  const body = installDom();
  try { await fn(body); } finally { uninstallDom(); }
};
const ASOF = '2026-10-02';
const AT = (n) => `2026-10-${String(n).padStart(2, '0')}T09:00:00+09:00`;
const ev = (id, type, occurred_at, recorded_at, payload, note, source = 'user') => ({ id, type, occurred_at, recorded_at, source, payload, note });

// ── 3(b) 일상말 20개 → 기대 기능이 1~3위 안 ──
const DAILY = [
  ['퇴사', 'assignee'], ['휴가 가요', 'draft'], ['대신 할 사람', 'similar'], ['누가 할 수 있지', 'similar'], ['메모 적어두기', 'weekly'],
  ['어디 썼지', 'recent'], ['엑셀 붙여넣기', 'table-add'], ['파일 올리기', 'doc-import'], ['문제 생겼어', 'issues'], ['끝났어요', 'issues'],
  ['일이 몰린 사람', 'density'], ['혼자만 아는 일', 'insight'], ['팀 합치기', 'group'], ['같은 사람 중복', 'merge'], ['백업', 'json-export'],
  ['실수로 지웠어', 'rewind'], ['다른 사람에게 보내기', 'html-export'], ['새로 추가', 'add'], ['숨기고 싶어', 'hidden'], ['담당 바뀌었어', 'assignee'],
];
test('찾기: 일상말 20개가 기대 기능을 1~3위에 올린다', () => {
  for (const [text, want] of DAILY) {
    const ids = searchFeatures(text, {}, { limit: 3 }).map((r) => r.id);
    assert.ok(ids.includes(want), `「${text}」→ 기대 ${want}, 실제 ${ids.join(',')}`);
  }
});

test('찾기: 예전 용어 검색은 그대로(담당·미해결·점검 첫 결과)', () => {
  assert.equal(searchFeatures('담당')[0].id, 'assignee');
  assert.equal(searchFeatures('미해결')[0].id, 'issues');
  assert.equal(searchFeatures('점검')[0].id, 'weekly-check');
});

test('자주 하는 일: 6개, 기능 목록에 있는 것만, 못 쓰는 것은 이유가 붙는다', () => {
  assert.equal(COMMON_FEATURES.length, 6);
  const ok = commonFeatures({});
  assert.deepEqual(ok.map((r) => r.name), ['메모 남기기', '인수인계서 만들기', '담당 넘기기', '쓴 것 찾기', '이번 주 점검', '업무·사람 더 넣기']);
  assert.ok(ok.every((r) => r.blocked === null));
  assert.ok(COMMON_FEATURES.every((c) => FEATURES.some((f) => f.id === c.id)));
  const ro = commonFeatures({ readOnly: true });
  assert.equal(ro.find((r) => r.id === 'weekly').blocked, '읽기 전용');
  assert.equal(ro.find((r) => r.id === 'draft').blocked, null);
});

test('지도에서: 항목 이름 일부가 맞는 항목을 최대 5개(숨긴 항목 제외, 한 글자는 찾지 않음)', () => {
  const nodes = [mkNode('N-W1', 'work', '대사 확인'), mkNode('N-W2', 'work', '월말 대사 정리'), mkNode('N-P1', 'person', '김가상'), mkNode('N-H', 'work', '대사 숨김', { hidden: true })];
  for (let i = 0; i < 5; i += 1) nodes.push(mkNode(`N-X${i}`, 'artifact', `대사표 ${i}`));
  const view = buildView(mkDoc('U-F', nodes, []), () => null);
  const r = searchMapItems(view, '대사');
  assert.equal(r.rows.length, 5);
  assert.equal(r.total, 7);
  assert.ok(r.rows.every((x) => x.label.includes('대사') && x.type_label));
  assert.ok(!r.rows.some((x) => x.label === '대사 숨김'));
  assert.deepEqual(searchMapItems(view, '대'), { query: '대', total: 0, rows: [] });
  assert.deepEqual(searchMapItems(view, '없는이름').rows, []);
});

test('마감 남은 날수: 날짜 값일 때만, 글(월 마감 후 …)이면 비어 있다', () => {
  assert.equal(deadlineLeft('2026-10-31', '2026-10-28'), '3일 남음');
  assert.equal(deadlineLeft('10-31', '2026-10-28'), '3일 남음');
  assert.equal(deadlineLeft('10-28', '2026-10-28'), '오늘 마감');
  assert.equal(deadlineLeft('10-26', '2026-10-28'), '2일 지남');
  assert.equal(deadlineLeft('월 마감 후 5영업일 이내', '2026-10-28'), '');
  assert.equal(deadlineLeft('', '2026-10-28'), '');
});

// ── 카드 첫 화면 ──
function cardOpts(view, gid, d, over = {}) {
  const c = cardData(view, gid, { asOf: ASOF, history: d.history });
  const open = new Map();
  const state = { isOpen: (k, dflt) => (open.has(k) ? open.get(k) : dflt), setOpen: (k, v, dflt) => { if (v === dflt) open.delete(k); else open.set(k, v); }, isAll: () => false, setAll() {} };
  return { data: c, state, actions: { primary: [], more: [] }, forms: [], notes: { alerts: [] }, layer: null, afterActions: [], canResolve: true, onResolve() {}, onOpenIssues() {}, onHistoryAll() {}, ...over };
}

test('카드 첫 화면: 기록만 펼쳐 있고 나머지는 접힌 묶음, 「지금 볼 것」은 안내 한 줄 + 동사 줄(누르면 그 자리로)', withDom((body) => {
  const nodes = [mkNode('N-W1', 'work', '대사 확인', { attrs: { 마감: '2026-10-05' } }), mkNode('N-P1', 'person', '김가상'), mkNode('N-A1', 'artifact', '보고서')];
  const edges = [mkEdge('N-P1', 'N-W1', 'performs', { period: { start: '2026-06-01' } }), mkEdge('N-W1', 'N-A1', 'produces')];
  const events = Array.from({ length: 6 }, (_, i) => ev(`E-${i + 1}`, 'memo', `2026-09-${String(i + 1).padStart(2, '0')}`, AT(i + 1), { target_id: 'N-W1', category: i === 0 ? 'issue' : 'caution' }, `메모 ${i + 1}`));
  const view = buildView(mkDoc('U-N', nodes, edges, events), () => null);
  const d = describeNode(view, 'U-N/N-W1', { asOf: ASOF });
  const panel = document.createElement('div');
  body.append(panel);
  const seen = [];
  renderNodeDetail(panel, d, { onFocus() {}, linkTools: () => null, justAdded: null, card: cardOpts(view, 'U-N/N-W1', d, { onOpenIssues: (o) => seen.push(`issues:${o && o.open}:${o && o.item}`), onShowRecord: (g) => seen.push(`rec:${g}`) }) });
  const groups = ['content', 'assign', 'outputs', 'history'].map((k) => [k, q(panel, `card-group-${k}`).getAttribute('open') !== null]);
  assert.deepEqual(groups, [['content', false], ['assign', false], ['outputs', false], ['history', true]]);
  assert.equal(q(panel, 'history').querySelectorAll('li').length, 3, '기록은 최근 3줄');
  assert.match(q(panel, 'now-hint').textContent, /누르면 그 자리로 갑니다/);
  assert.equal(q(panel, 'now-issues-head'), null, '미해결이 아래에 다 보이면 머리 줄은 없다(같은 말 두 번 — 메인 10-26 저녁)');
  assert.match(q(panel, 'now-deadline').textContent, /마감 2026-10-05 · 3일 남음/);
  // 미해결 줄(FU8-29): 어느 카드에서나 「미해결 목록」으로(그 줄의 업무 묶음을 펼치고 그 줄을 강조) — 기록 3줄 안이든 밖이든 같은 곳
  q(panel, 'now-issue').querySelector('button').click();
  assert.deepEqual(seen, ['issues:U-N/N-W1:U-N/E-1']);
  // 처음 3줄 안의 최근 기록은 그 자리에서 펼침·이동
  q(panel, 'now-recent').querySelector('button').click();
  assert.equal(seen.length, 1, '화면 안 줄이면 다시 그리지 않는다');
}));
