// 미해결 목록 묶기(R7-3, U-6): 업무(대상)별로 묶고, 5건 넘는 묶음은 접는다. 순수 함수 groupIssues.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupIssues, openMemos, ISSUE_GROUP_OPEN_MAX } from '../app/src/rules/issues.js';
import { viewOf } from './helpers.js';

// 가짜 뷰: memoTarget이 쓰는 canonical만 있으면 된다(대상 id를 그대로 돌려줌)
const fake = { canonical: (g) => g };
const ev = (n, date, target) => ({ gid: `U/E-${n}`, universe_id: 'U', occurred_at: date, payload: target ? { target_id: target } : {}, node_gids: [], note: `m${n}` });

test('대상별로 묶고 건수 많은 묶음이 먼저, 같으면 최근 날짜가 있는 묶음이 먼저', () => {
  const memos = [ev(1, '2026-01-01', 'N-1'), ev(2, '2026-03-01', 'N-2'), ev(3, '2026-02-01', 'N-1'), ev(4, '2026-05-01', 'N-3'), ev(5, '2026-04-01', 'N-2'), ev(6, '2026-01-10', null)];
  const gs = groupIssues(fake, memos);
  assert.deepEqual(gs.map((g) => [g.key, g.items.length]), [['U/N-2', 2], ['U/N-1', 2], ['U/N-3', 1], ['topics', 1]]); // N-2(최근 04-01)가 N-1(02-01)보다 먼저, 1건끼리는 05-01 > 01-10
  assert.equal(gs[3].target, null);
});

test('묶음 안은 입력의 역순(최근 기록이 위), 합치면 원래 메모와 같고 누락·중복이 없다', () => {
  const memos = [ev(1, '2026-01-01', 'N-1'), ev(2, '2026-02-01', 'N-1'), ev(3, '2026-03-01', 'N-1')];
  const [g] = groupIssues(fake, memos);
  assert.deepEqual(g.items.map((e) => e.note), ['m3', 'm2', 'm1']);
});

test('기준(ISSUE_GROUP_OPEN_MAX)을 넘는 묶음만 접힌다(경계: 기준 건수는 펼침, 하나 더 많으면 접힘)', () => {
  const five = Array.from({ length: ISSUE_GROUP_OPEN_MAX }, (_, i) => ev(i, '2026-01-01', 'N-1'));
  assert.equal(groupIssues(fake, five)[0].collapsed, false);
  assert.equal(groupIssues(fake, [...five, ev(9, '2026-01-02', 'N-1')])[0].collapsed, true);
});

test('빈 입력과 결정적 결과', () => {
  assert.deepEqual(groupIssues(fake, []), []);
  const memos = [ev(1, '2026-01-01', 'N-2'), ev(2, '2026-01-01', 'N-1')];
  assert.deepEqual(groupIssues(fake, memos), groupIssues(fake, [...memos]));
  assert.equal(groupIssues(fake, memos)[0].key, 'U/N-1'); // 건수·날짜가 같으면 참조 순
});

test('부서 화면 샘플: 17건이 업무별 묶음으로 나뉘고, 기준을 넘는 묶음은 접혀 처음 보이는 항목이 줄어든다', () => {
  const v = viewOf('U-D1');
  const memos = openMemos(v);
  const gs = groupIssues(v, memos);
  assert.equal(gs.reduce((a, g) => a + g.items.length, 0), memos.length);
  assert.ok(gs.length < memos.length);
  const shown = gs.reduce((a, g) => a + (g.collapsed ? 0 : g.items.length), 0);
  assert.ok(shown <= memos.length);
});
