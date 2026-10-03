// N-4(사용자 확인 중 발견, 2026-10-03): 연결 오류에 고른 두 노드의 유형과 쓸 수 있는 관계를 알린다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedRelations } from '../app/src/model/schema.js';
import { messageFor } from '../app/src/ui/messages.js';

test('두 노드 유형 사이에 쓸 수 있는 관계(방향 포함)', () => {
  assert.deepEqual(allowedRelations('root', 'person'), [{ relation: 'contains', forward: true, backward: false }]);
  const pw = allowedRelations('person', 'work');
  assert.deepEqual(pw.map((x) => `${x.relation}:${x.forward}:${x.backward}`), ['performs:true:false', 'references:true:true']);
  assert.deepEqual(allowedRelations('root', 'root'), []);
});

test('E-PAIR: 꼭지 「시스템개발」 → 사람 「이용구」에 소속을 걸면 유형과 쓸 수 있는 관계(포함)를 알린다', () => {
  const source = { label: '시스템개발', core_type: 'root' };
  const target = { label: '이용구', core_type: 'person' };
  const text = messageFor({ code: 'E-PAIR' }, { kind: 'edge', relation: 'belongs_to', source, target, suggestions: allowedRelations('root', 'person') });
  assert.match(text, /「소속」은\(는\) 사람 → 조직, 조직 → 조직만 가능합니다\./);
  assert.match(text, /「시스템개발」은\(는\) 꼭지, 「이용구」은\(는\) 사람입니다\./);
  assert.match(text, /이 두 노드에는 「포함」\(시스템개발 → 이용구\)을\(를\) 쓸 수 있습니다\./);
  // 반대 방향으로만 되는 관계는 방향을 바꿔 안내한다
  const back = messageFor({ code: 'E-PAIR' }, { kind: 'edge', relation: 'performs', source: { label: '보고', core_type: 'work' }, target: { label: '서하늘', core_type: 'person' }, suggestions: allowedRelations('work', 'person') });
  assert.match(back, /「수행」\(서하늘 → 보고\)/);
  // 쓸 수 있는 관계가 없으면 그렇다고 알린다, 노드 정보가 없으면 예전 문구
  assert.match(messageFor({ code: 'E-PAIR' }, { kind: 'edge', relation: 'contains', source: { label: 'A', core_type: 'root' }, target: { label: 'B', core_type: 'root' }, suggestions: [] }), /직접 연결할 수 있는 관계가 없습니다/);
  assert.equal(messageFor({ code: 'E-PAIR' }, { kind: 'edge', relation: 'belongs_to' }), '이 조합으로는 연결할 수 없습니다. 「소속」은(는) 사람 → 조직, 조직 → 조직만 가능합니다.');
});
