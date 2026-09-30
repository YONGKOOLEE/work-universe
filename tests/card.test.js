import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_CARD } from '../app/data/sample-card.js';
import { validateDocument } from '../app/src/model/validate.js';
import { buildView } from '../app/src/view/view.js';
import { scanVirtualData } from '../tools/virtual-data-check.mjs';

// CR-3 AC ①: 스키마 검증 통과
test('변환 사례는 검증을 통과한다', () => {
  assert.deepEqual(validateDocument(SAMPLE_CARD).errors, []);
});

// CR-3 AC ②: 모든 노드에 원문 근거, 메모에는 원문 번호
test('모든 노드에 원문 근거(attrs.원문)가 있고 메모는 원문 번호로 시작한다', () => {
  for (const n of SAMPLE_CARD.nodes) assert.ok(n.attrs && n.attrs.원문, n.id);
  for (const e of SAMPLE_CARD.events) assert.match(e.note, /^\[§/, e.id);
});

// CR-3 AC ④: [가정]·[미확인] 보존
test('원문의 [가정]·[미확인] 표시가 상태 속성으로 남는다', () => {
  const state = (label) => SAMPLE_CARD.nodes.find((n) => n.label === label).attrs.상태;
  assert.equal(state('전문 규격'), '미확인');
  assert.equal(state('통신 방식'), '미확인');
  assert.equal(state('부분취소'), '미확인');
  assert.equal(state('타임아웃'), '가정');
  assert.equal(state('중복 요청'), '가정');
  assert.equal(state('비기능 요건'), '가정');
});

test('업무 흐름 5단계가 선후행으로 이어진다(§2)', () => {
  const v = buildView(SAMPLE_CARD);
  const next = new Map(v.edges.filter((e) => e.core_type === 'precedes').map((e) => [e.source, e.target]));
  const chain = ['U-K1/N-201'];
  while (next.has(chain.at(-1))) chain.push(next.get(chain.at(-1)));
  assert.deepEqual(chain.map((g) => v.getNode(g).label), ['승인요청 수신', '요청 검증', '카드사 전문 변환·송신', '응답 수신·회신', '정합성 조치']);
});

test('모든 노드가 꼭지와 이어져 있다(떨어진 노드 없음)', () => {
  const v = buildView(SAMPLE_CARD);
  const seen = new Set(['U-K1/N-000']);
  const queue = ['U-K1/N-000'];
  while (queue.length) {
    const g = queue.shift();
    for (const { other } of v.neighbors(g)) if (!seen.has(other.gid)) { seen.add(other.gid); queue.push(other.gid); }
  }
  assert.deepEqual(v.nodes.filter((n) => !seen.has(n.gid)).map((n) => n.label), []);
});

test('R-06 형식 점검 통과(사번 V-####, 이메일·URL 등 없음)', () => {
  assert.deepEqual(scanVirtualData(SAMPLE_CARD), []);
});
