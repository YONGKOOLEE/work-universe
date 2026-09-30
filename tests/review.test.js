// 2026-10-01 전체 검토에서 찾은 결함의 재발 방지 테스트
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLES } from '../app/data/index.js';
import { SAMPLE_A1 } from '../app/data/sample-a1.js';
import { addEdge, addEvent, hideNode } from '../app/src/model/commands.js';
import { validateDocument } from '../app/src/model/validate.js';
import { createStore } from '../app/src/store/local.js';
import { createApp } from '../app/src/app/app.js';
import { messageFor } from '../app/src/ui/messages.js';

const ctx = { now: '2026-10-01T12:00:00+09:00' };

test('이벤트의 사람·업무·산출물·조직·주제 칸에는 그 유형의 노드만 들어간다', () => {
  const bad = addEvent(SAMPLE_A1, {
    type: 'handover', occurred_at: '2026-10-02', payload: { work_id: 'N-011', from_person_id: 'N-010', to_person_id: 'N-012' },
  }, ctx);
  assert.deepEqual(bad, { ok: false, error: { code: 'E-SCHEMA', field: 'work_id', expected: 'work' } });
  assert.equal(messageFor(bad.error), '업무 칸에는 업무 노드만 고를 수 있습니다.');
  const memo = addEvent(SAMPLE_A1, { type: 'memo', occurred_at: '2026-10-02', payload: { target_id: 'N-001', topic_ids: ['N-001'] } }, ctx);
  assert.equal(memo.error.field, 'topic_ids');
  // 메모 대상(target_id)은 어떤 노드든 된다
  assert.equal(addEvent(SAMPLE_A1, { type: 'memo', occurred_at: '2026-10-02', payload: { target_id: 'N-011' } }, ctx).ok, true);
});

test('문서 검증도 이벤트 참조 유형을 확인하고, 내장 샘플은 모두 맞다', () => {
  const d = JSON.parse(JSON.stringify(SAMPLE_A1));
  d.events.find((e) => e.id === 'E-002').payload.artifact_id = 'N-030'; // 주제를 인수인계서로
  assert.deepEqual(validateDocument(d).errors.map((e) => e.path), ['events[4].payload.artifact_id']);
  for (const s of SAMPLES) assert.deepEqual(validateDocument(s).errors, [], s.universe.id);
});

test('숨긴 노드에는 새 연결을 만들 수 없다', () => {
  const doc = hideNode(SAMPLE_A1, 'N-021', ctx).doc;
  const r = addEdge(doc, { source: 'N-002', target: 'N-021', core_type: 'references' }, ctx);
  assert.deepEqual(r.error, { code: 'E-SCHEMA', field: 'target', hidden: true });
  assert.equal(messageFor(r.error, { kind: 'edge' }), '숨긴 노드에는 연결할 수 없습니다.');
});

test('저장소 값이 깨져 있어도 멈추지 않고, 샘플은 다시 넣는다', () => {
  const m = new Map([
    ['wu:v1:index', '[깨진 목록'],
    ['wu:v1:u:U-A1', '{"깨진 문서'],
  ]);
  const storage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  const store = createStore(storage);
  assert.equal(store.loadUniverse('U-A1'), null);
  assert.deepEqual(store.listUniverses(), []);
  const app = createApp({ store, samples: SAMPLES, now: () => ctx.now });
  assert.equal(app.doc.nodes.length, SAMPLE_A1.nodes.length);
  assert.deepEqual(app.universes().map((u) => u.id).sort(), ['U-A1', 'U-K1', 'U-T1']);
});
