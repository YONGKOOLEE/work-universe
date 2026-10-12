// T-19 새 노드 자리 계산(B-P4, T19-13): 이름 크기를 반영해 서로·기존 노드와 겹치지 않는다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLACE, labelBox, placeNewNodes } from '../app/src/view/place.js';

const rectOf = (pos, label, size) => {
  const b = labelBox(label, size);
  return { x1: pos.x - b.w / 2, x2: pos.x + b.w / 2, y1: pos.y - size / 2, y2: pos.y - size / 2 + b.h };
};
const hit = (a, b) => a.x1 < b.x2 && a.x2 > b.x1 && a.y1 < b.y2 && a.y2 > b.y1;

test('이름이 길수록 상자가 커진다(최대 폭에서 줄바꿈)', () => {
  const short = labelBox('정산', 24);
  const long = labelBox('카드사 정산 대사 및 월말 마감 보고서 작성 업무 전체', 24);
  assert.ok(long.w >= short.w);
  assert.ok(long.w <= PLACE.maxText);
  assert.ok(long.h > short.h);
});

test('긴 이름 노드 12개를 같은 꼭지 이웃으로 연달아 넣어도 서로·기존 노드와 겹치지 않는다', () => {
  const root = { x: 0, y: 0 };
  const existing = [rectOf(root, '꼭지 이름', 54)];
  const items = Array.from({ length: 12 }, (_, i) => ({
    id: `n${i}`, label: `카드사 가맹점 정산 대사 및 월말 마감 보고서 작성 ${i}`, size: 24, anchor: root,
  }));
  const placed = placeNewNodes(existing, items);
  assert.equal(placed.size, 12);
  const rects = items.map((it) => rectOf(placed.get(it.id), it.label, it.size));
  for (let i = 0; i < rects.length; i += 1) {
    assert.equal(hit(rects[i], existing[0]), false, `기존 노드와 겹침 ${i}`);
    for (let j = i + 1; j < rects.length; j += 1) assert.equal(hit(rects[i], rects[j]), false, `${i}와 ${j} 겹침`);
  }
});

test('이웃이 없는 새 노드는 기존 그래프 오른쪽 바깥에 차례로 놓인다', () => {
  const existing = [{ x1: 0, y1: 0, x2: 200, y2: 100 }];
  const placed = placeNewNodes(existing, [
    { id: 'a', label: '가', size: 24, anchor: null },
    { id: 'b', label: '나', size: 24, anchor: null },
  ]);
  assert.ok(placed.get('a').x > 200 + 60);
  assert.ok(placed.get('b').y > placed.get('a').y);
});

test('기존 노드가 하나도 없어도 동작한다(빈 유니버스)', () => {
  const placed = placeNewNodes([], [{ id: 'a', label: '가', size: 24, anchor: null }]);
  assert.ok(Number.isFinite(placed.get('a').x) && Number.isFinite(placed.get('a').y));
});

test('같은 입력이면 같은 자리(결정적)', () => {
  const items = [{ id: 'a', label: '가나다', size: 24, anchor: { x: 10, y: 10 } }, { id: 'b', label: '라마바', size: 24, anchor: { x: 10, y: 10 } }];
  assert.deepEqual([...placeNewNodes([], items)], [...placeNewNodes([], items)]);
});
