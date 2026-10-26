// 처음 사용 점검 7회차(FU7) + 열두 번째 검토 ① 정확성(RV12C) 단위 검증. 화면(DOM)은 tools/browser-check.mjs 「FU7 고침」 블록이 본다. 가상 데이터만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, uninstallDom } from './dom-stub.js';
import { buildView } from '../app/src/view/view.js';
import { mkDoc, mkNode } from './helpers.js';
import { RECORD_SEARCH, SOURCE_CHIP, SOURCE_CHIP_OTHER, mapHistoryRows, recentRecords, searchRecords } from '../app/src/view/recent-records.js';
import { filterHistory, historyRows } from '../app/src/view/card.js';
import { successNotice } from '../app/src/view/record-form.js';
import { createStore } from '../app/src/store/local.js';
import { DONE_AUTO_MAX, doneMarkAuto, makeDoneMark } from '../app/src/view/done-mark.js';
import { panelParts } from '../app/src/view/workspace.js';
import { memoParts } from '../app/src/ui/memo-form.js';
import { evidenceChips } from '../app/src/ui/evidence.js';

const withDom = (fn) => () => {
  const body = installDom();
  try { fn(body); } finally { uninstallDom(); }
};
const AT = (n) => `2026-10-${String(n).padStart(2, '0')}T09:00:00+09:00`;
const ev = (id, type, occurred_at, recorded_at, payload, note, source = 'user') => ({ id, type, occurred_at, recorded_at, source, payload, note });
const nodes = () => [mkNode('N-W1', 'work', '대사 확인'), mkNode('N-W2', 'work', '정산 점검'), mkNode('N-P1', 'person', '김가상')];
const docWith = (events) => buildView(mkDoc('U-T', nodes(), [], events), () => null);

// ── FU7-1: 기록 찾기·지도 전체 기록 표는 출처와 상관없이, 최근 기록은 user만 ──
test('FU7-1 샘플 출처 기록도 기록 찾기·전체 기록 표에 나오고 출처 칩이 붙는다. 최근 기록은 user만', () => {
  const view = docWith([
    ev('E-1', 'memo', '2026-10-01', AT(1), { target_id: 'N-W1', category: 'issue' }, '대사 불일치 샘플', 'sample'),
    ev('E-2', 'memo', '2026-10-02', AT(2), { target_id: 'N-W1', category: 'issue' }, '대사 불일치 내가 씀'),
    ev('E-3', 'memo', '2026-10-03', AT(3), { target_id: 'N-W2', category: 'issue' }, '다른 출처 불일치', 'import'),
  ]);
  const r = searchRecords(view, '불일치');
  assert.equal(r.total, 3);
  assert.deepEqual(r.rows.map((x) => x.source_chip), [SOURCE_CHIP_OTHER, null, SOURCE_CHIP.sample]);
  assert.equal(SOURCE_CHIP.sample, '예시');
  assert.equal(mapHistoryRows(view).length, 3);
  assert.deepEqual(recentRecords(view).map((x) => x.gid), ['U-T/E-2'], '최근 기록(CR-21 B-2)은 user만');
});

// ── RV12C-4·5: 기록 찾기와 표 거르기는 같은 규칙 ──
test('RV12C-4 같은 낱말이면 기록 찾기 건수와 지도 전체 기록 표 거르기 건수가 같다(공백·대소문자·업무 이름 포함)', () => {
  const view = docWith([
    ev('E-1', 'memo', '2026-10-01', AT(1), { target_id: 'N-W1', category: 'issue' }, '대사불일치 3건'),
    ev('E-2', 'memo', '2026-10-02', AT(2), { target_id: 'N-W1', category: 'issue' }, '대사 불일치 2건'),
    ev('E-3', 'memo', '2026-10-03', AT(3), { target_id: 'N-W2', category: 'caution' }, '무관'),
    ev('E-4', 'assign_start', '2026-10-04', AT(4), { person_id: 'N-P1', work_id: 'N-W2' }),
  ]);
  const rows = historyRows(mapHistoryRows(view));
  for (const q of ['대사불일치', '대사 불일치', '  대사  불일치 ', '정산 점검', 'ＤＸ', '김가상 담당']) {
    assert.equal(filterHistory(rows, { q }, '2026-10-26').length, searchRecords(view, q, { limit: 100 }).total, `낱말 「${q}」`);
  }
  assert.equal(searchRecords(view, '대사불일치').total, 2);
});

test('RV12C-5 필드 경계를 넘는 글은 맞지 않는다(메모 내용 끝 + 내용 글 앞이 이어져 맞던 결함)', () => {
  const view = docWith([ev('E-1', 'assign_start', '2026-10-04', AT(4), { person_id: 'N-P1', work_id: 'N-W2' }, '대사')]);
  assert.equal(searchRecords(view, '김가상 담당').total, 1, '내용 글 안의 낱말은 맞는다');
  assert.equal(searchRecords(view, '대사김가상').total, 0, '메모 내용 「대사」와 내용 글 「김가상…」을 이어 붙여 맞지 않는다');
});

test('RV12C-6 기록 결과는 기능 결과 수와 상관없이 보인다(상수 한 곳)', () => {
  assert.equal(RECORD_SEARCH.FEATURE_FEW, Infinity);
});

// ── FU7-4: 통합 확인 판정 알림의 조사 ──
test('FU7-4 판정 알림: 「대사 확인」과 「거래 조회」를 다른 업무로 — 앞 이름에도 받침에 맞는 조사', () => {
  const t = (a, b, same, kind) => successNotice('identity', { a, b, same, kind }).text;
  assert.equal(t('「대사 확인」', '「거래 조회」', false, 'work'), '「대사 확인」과 「거래 조회」를 다른 업무로 정했습니다.');
  assert.equal(t('「거래 조회」', '「대사 확인」', true, 'work'), '「거래 조회」와 「대사 확인」을 같은 업무로 정했습니다.');
  assert.equal(t('「김가상」', '「이가상」', true, 'person'), '「김가상」과 「이가상」을 같은 사람으로 정했습니다.');
});

// ── FU7-10: 지도 목록 순서 ──
test('FU7-10 지도를 저장해도 목록 순서가 바뀌지 않는다(새 지도만 끝에)', () => {
  const m = new Map();
  const storage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  const store = createStore(storage);
  const doc = (id, name) => ({ universe: { id, name, level: 'team' }, nodes: [], edges: [], events: [], refs: [], identity_links: [], topics: [] });
  store.saveUniverse(doc('U-A', '가'));
  store.saveUniverse(doc('U-B', '나'));
  store.saveUniverse(doc('U-C', '다'));
  store.saveUniverse(doc('U-A', '가 고침'));
  assert.deepEqual(store.listUniverses(), [{ id: 'U-A', name: '가 고침' }, { id: 'U-B', name: '나' }, { id: 'U-C', name: '다' }]);
});

// ── RV12S-2: ~done auto 상한 ──
test('RV12S-2 표지의 auto는 만들 때와 읽을 때 같은 상한', () => {
  assert.equal(doneMarkAuto(makeDoneMark('group', 'U-1', 1, 7)), 7);
  assert.equal(doneMarkAuto(JSON.stringify({ kind: 'group', map: 'U-1', at: 1, auto: 1e12 })), DONE_AUTO_MAX);
  assert.equal(doneMarkAuto(JSON.stringify({ auto: -5 })), 0);
  assert.equal(doneMarkAuto(JSON.stringify({ auto: 'x' })), 0);
  assert.equal(doneMarkAuto(JSON.stringify({ auto: 2.9 })), 2);
  assert.equal(doneMarkAuto(makeDoneMark('group', 'U-1', 1, 1e12)), DONE_AUTO_MAX);
});

// ── FU7-2·12: 묶은 지도 매주 점검 구성 ──
test('FU7-2·12 묶은 지도 「매주 점검」: 위험 요약 → 혼자만 아는 일 목록 → 통합 확인 바로가기 → 인사이트', () => {
  const c = { grouped: true, readOnly: false, rewinding: false, starter: false, split: false, empty: false, folder: false, conflicts: false, stale: false };
  assert.deepEqual(panelParts('check', c), ['risk', 'solo', 'merge-link', 'insight']);
});

// ── FU7-6·RV12C-3: 분류 칩 ──
test('FU7-6 Space·Enter는 고르기만 한다(이미 고른 칩이 풀리지 않는다). 마우스로 한 번 더 누르면 푸는 동작은 그대로', withDom((body) => {
  const parts = memoParts({ prefix: 'weekly' });
  body.append(parts.chipRow, parts.select);
  const chip = (k) => parts.chipRow.querySelector(`[data-testid=memo-chip-${k}]`);
  chip('issue').fire('keydown', { key: ' ' });
  assert.equal(parts.category(), 'issue');
  chip('issue').fire('keydown', { key: ' ' });
  chip('issue').fire('keydown', { key: 'Enter' });
  assert.equal(parts.category(), 'issue', '이미 고른 칩에서 Space·Enter는 풀지 않는다');
  chip('issue').fire('click');
  assert.equal(parts.category(), '', '마우스 클릭은 풀린다(원래 동작)');
}));

test('RV12C-3 칩·방향키로 분류를 바꿔도 select의 change가 나간다(쓰던 분류 보관이 이 이벤트를 듣는다)', withDom((body) => {
  const parts = memoParts({ prefix: 'weekly' });
  body.append(parts.chipRow, parts.select);
  let changes = 0;
  parts.select.addEventListener('change', () => { changes += 1; });
  const chip = (k) => parts.chipRow.querySelector(`[data-testid=memo-chip-${k}]`);
  chip('caution').fire('click');
  assert.equal(changes, 1, '칩 클릭');
  chip('caution').fire('keydown', { key: 'ArrowRight' });
  assert.equal(changes, 2, '방향키');
  assert.equal(parts.category(), 'resolved');
  chip('resolved').fire('keydown', { key: ' ' });
  assert.equal(changes, 2, '이미 고른 칩의 Space는 바뀐 것이 없어 알리지 않는다');
  parts.setCategory('issue'); // 보관한 분류를 되돌릴 때는 change를 내보내지 않는다(보관을 다시 쓰는 되먹임 없음)
  assert.equal(changes, 2);
}));

// ── FU7-2: 사람 칩 옆 「카드」 ──
test('FU7-2 사람 근거 칩 옆에 「카드」 단추(onCard가 있을 때만). 업무 칩에는 없다', withDom((body) => {
  const view = docWith([]);
  const opened = [];
  const list = evidenceChips(view, ['U-T/N-P1', 'U-T/N-W1'], () => {}, { tag: 'div', showText: true, onCard: (g) => opened.push(g) });
  body.append(list);
  const cards = list.querySelectorAll('[data-testid=evidence-card]');
  assert.equal(cards.length, 1);
  cards[0].fire('click');
  assert.deepEqual(opened, ['U-T/N-P1']);
  const none = evidenceChips(view, ['U-T/N-P1'], () => {}, { tag: 'div' });
  body.append(none);
  assert.equal(none.querySelectorAll('[data-testid=evidence-card]').length, 0);
}));
