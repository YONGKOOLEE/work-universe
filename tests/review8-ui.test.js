// 처음 사용자 검토(2026-10-17) 화면 수정: 「처음 할 일」 첫 항목이 첫 업무 이름과 gid를 싣는다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createUniverse } from '../app/src/model/commands.js';
import { applyStarter } from '../app/src/model/starter.js';
import { starterSteps } from '../app/src/rules/starter-steps.js';
import { buildView } from '../app/src/view/view.js';

const ctx = { now: '2026-10-17T10:00:00+09:00' };

test('starterSteps: 첫 항목에 첫 업무 이름이 들어가고 work.gid가 그 업무를 가리킨다', () => {
  const d = applyStarter(createUniverse({ name: '시험', level: '업무', owner: '가상팀' }, ctx).doc, { work: '월말 점검', person: '김가상', artifact: '점검표' }, ctx).doc;
  const v = buildView(d, () => null);
  const memo = starterSteps(d, v).steps.find((s) => s.key === 'memo');
  assert.ok(memo.label.includes('「월말 점검」') && memo.label.includes('「이력 추가」'));
  assert.equal(v.getNode(memo.work.gid).label, '월말 점검');
  assert.equal(memo.work.label, '월말 점검');
});
