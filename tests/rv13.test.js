// 열세 번째 검토(docs/review-2026-10-27.md) 메인이 고친 것의 단위 시험
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deadlineLeft } from '../app/src/view/card.js';

test('RV13-3 마감 남은 날: 연도 없는 M-D는 가장 가까운 해, 없는 날짜는 빈 글', () => {
  assert.equal(deadlineLeft('1-5', '2026-12-28'), '8일 남음');
  assert.equal(deadlineLeft('12-31', '2027-01-02'), '2일 지남');
  assert.equal(deadlineLeft('2-30', '2026-02-01'), '');
  assert.equal(deadlineLeft('13-1', '2026-02-01'), '');
  assert.equal(deadlineLeft('0-0', '2026-02-01'), '');
  assert.equal(deadlineLeft('2026-10-30', '2026-10-27'), '3일 남음');
  assert.equal(deadlineLeft('10-27', '2026-10-27'), '오늘 마감');
  assert.equal(deadlineLeft('2026-02-30', '2026-02-01'), '');
  assert.equal(deadlineLeft('월 마감 후 3영업일 이내', '2026-10-27'), '');
});
