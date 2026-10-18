// CR-13 A 재검증 N-3(2026-10-18): 「내 업무 지도 만들기」의 자동 채움 규칙(rules/new-universe.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINE_DEFAULTS, createFieldId, fillMineDefaults } from '../app/src/rules/new-universe.js';
import { createUniverse } from '../app/src/model/commands.js';

const blank = { name: '', level: '', owner: '', description: '' };

test('업무 이름만 있으면 이름·단위·작성 주체를 채운다(작성자 이름 없음 → 「내 팀」)', () => {
  const r = fillMineDefaults({ ...blank, starter: { work: '  월말 정산 점검 ' } }, undefined);
  assert.equal(r.ok, true);
  assert.equal(r.input.name, '월말 정산 점검 업무 지도');
  assert.equal(r.input.level, '업무');
  assert.equal(r.input.owner, '내 팀');
  assert.deepEqual(r.filled, ['name', 'level', 'owner']);
});

test('작성자 이름이 있으면 「{이름}의 팀」, 공백뿐이면 없는 것으로 본다', () => {
  assert.equal(fillMineDefaults({ ...blank, starter: { work: '가' } }, '김가상').input.owner, '김가상의 팀');
  assert.equal(fillMineDefaults({ ...blank, starter: { work: '가' } }, '   ').input.owner, '내 팀');
  assert.equal(fillMineDefaults({ ...blank, starter: { work: '가' } }, 7).input.owner, '내 팀'); // 문자열이 아닌 값은 무시
});

test('사용자가 적은 칸은 덮어쓰지 않고, 비어 있는 칸만 채운다', () => {
  const r = fillMineDefaults({ name: '우리 팀 지도', level: '팀', owner: '', description: '설명', starter: { work: '업무 A', person: '김가상' } }, '이가상');
  assert.equal(r.input.name, '우리 팀 지도');
  assert.equal(r.input.level, '팀');
  assert.equal(r.input.owner, '이가상의 팀');
  assert.equal(r.input.description, '설명');
  assert.deepEqual(r.input.starter, { work: '업무 A', person: '김가상' });
  assert.deepEqual(r.filled, ['owner']);
  // 공백뿐인 칸은 빈 칸
  assert.deepEqual(fillMineDefaults({ ...blank, name: '   ', level: ' ', owner: ' ', starter: { work: 'x' } }, undefined).filled, ['name', 'level', 'owner']);
});

test('업무 이름이 없거나 공백뿐이거나 starter가 없으면 오류(starter_work)', () => {
  for (const raw of [{ ...blank }, { ...blank, starter: {} }, { ...blank, starter: { work: '   ' } }, { ...blank, starter: { work: '', person: '김가상' } }, null, undefined]) {
    const r = fillMineDefaults(raw, '김가상');
    assert.deepEqual(r, { ok: false, field: 'starter_work', code: 'mine-work-required' });
  }
});

test('업무 이름이 아주 길면 자동 이름이 한도(100자)를 넘지 않게 업무 이름 부분을 줄인다', () => {
  const long = '가'.repeat(100);
  const r = fillMineDefaults({ ...blank, starter: { work: long } }, undefined);
  assert.ok(r.input.name.length <= MINE_DEFAULTS.NAME_MAX);
  assert.ok(r.input.name.endsWith(MINE_DEFAULTS.NAME_SUFFIX));
  assert.equal(r.input.starter.work, long); // 업무 이름 자체는 그대로
});

test('채운 값은 R-12(이름·단위·작성 주체 필수) 검사를 통과한다 — 채우지 않은 입력은 통과하지 못한다', () => {
  const ctx = { now: '2026-10-01T00:00:00.000Z', random: () => 0.5 };
  const filled = fillMineDefaults({ ...blank, starter: { work: '월말 정산 점검' } }, undefined);
  assert.equal(createUniverse(filled.input, ctx).ok, true);
  const raw = createUniverse({ ...blank }, ctx);
  assert.equal(raw.ok, false);
  assert.equal(raw.error.field, 'name');
});

test('오류 field → 칸 id: 모든 칸이 매핑되고, 모르는 이름·상속 속성은 null', () => {
  assert.equal(createFieldId('name'), 'create-name');
  assert.equal(createFieldId('level'), 'create-level');
  assert.equal(createFieldId('owner'), 'create-owner');
  assert.equal(createFieldId('description'), 'create-description');
  assert.equal(createFieldId('starter_work'), 'create-start-work');
  assert.equal(createFieldId('starter_person'), 'create-start-person');
  assert.equal(createFieldId('starter_artifact'), 'create-start-artifact');
  for (const bad of ['nope', 'constructor', 'toString', '', undefined, null, 3]) assert.equal(createFieldId(bad), null, String(bad));
});
