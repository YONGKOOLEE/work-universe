// 변환기 경계 사례 108개 고정 비교(2026-10-04 재검증에서 모은 사례). 변환 규칙을 고치면 이 테스트가 바뀐 사례를 알려 준다.
// 의도한 변경이면 `node tools/convert-snapshot.mjs`로 차이를 보고 사례마다 판정한 뒤 `--write`로 갱신한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALL_CASES, dump } from './fixtures/convert-cases/dump.mjs';

const saved = JSON.parse(readFileSync(new URL('./fixtures/convert-cases/snapshot.json', import.meta.url), 'utf8'));

test('변환기 경계 사례: 저장된 스냅숏과 모든 사례가 같다(다르면 node tools/convert-snapshot.mjs로 차이 확인)', () => {
  assert.equal(Object.keys(saved).length, ALL_CASES.length, '사례 수');
  const changed = ALL_CASES.filter(([name, text]) => JSON.stringify(dump(text)) !== JSON.stringify(saved[name])).map(([name]) => name);
  assert.deepEqual(changed, []);
});

test('변환기 경계 사례: 어떤 입력에서도 예외(CRASH)가 나지 않는다', () => {
  for (const [name, text] of ALL_CASES) assert.ok(!dump(text)[0].startsWith('CRASH'), name);
});
