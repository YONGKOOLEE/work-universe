import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText } from '../tools/secret-scan.mjs';

test('비밀값 점검: 키 형식을 찾고 값은 가려서 돌려준다(R-15 ③)', () => {
  const fake = 'sk-ant-' + 'a'.repeat(40); // 가짜 값
  const hits = scanText(`const key = "${fake}";`);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].rule, 'Anthropic API 키');
  assert.ok(!hits[0].value.includes('a'.repeat(10)));
  assert.equal(scanText(`headers: { 'x-api-key': '${'b'.repeat(30)}' }`).length, 1);
});

test('비밀값 점검: 일반 문장·짧은 문자열·설계 문서의 헤더 이름은 걸리지 않는다', () => {
  assert.deepEqual(scanText('anthropic-dangerous-direct-browser-access: true, sk-로 시작하는 키는 넣지 않는다'), []);
  assert.deepEqual(scanText('const task = "sk-ant-"; // 접두어만'), []);
});
