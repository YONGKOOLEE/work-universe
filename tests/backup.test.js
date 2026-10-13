// T-25 (R-21 ②, D-23) 백업 권유 판단과 설정 필드(lastExportAt, backupDismissedAt)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BACKUP_CHANGES, BACKUP_DAYS, backupAdvice, userChangeTimes } from '../app/src/rules/backup.js';
import { loadSettings, saveSettings } from '../app/src/store/local.js';

const NOW = '2026-10-20T12:00:00+09:00';
const daysBefore = (d, extraMs = 0) => new Date(Date.parse(NOW) - d * 86400000 - extraMs).toISOString();
// 기준 시각 뒤에 기록된 변경 n건
const changes = (n, at = daysBefore(0, 3600000)) => Array.from({ length: n }, () => at);

test('기준값은 7일·30건', () => {
  assert.equal(BACKUP_DAYS, 7);
  assert.equal(BACKUP_CHANGES, 30);
});

test('날짜 경계: 내보낸 지 6일(7일 직전)이면 변경이 있어도 권유하지 않고, 7일이면 권유', () => {
  const six = backupAdvice({ lastExportAt: daysBefore(6, -3600000), changeTimes: changes(1), now: NOW }); // 6일 23시간
  assert.equal(six.suggest, false);
  const seven = backupAdvice({ lastExportAt: daysBefore(7), changeTimes: changes(1), now: NOW }); // 정확히 7일
  assert.equal(seven.suggest, true);
  assert.equal(seven.reason, 'days');
  assert.equal(seven.days, 7);
  assert.equal(backupAdvice({ lastExportAt: daysBefore(7, 1), changeTimes: changes(1), now: NOW }).suggest, true);
  assert.equal(backupAdvice({ lastExportAt: daysBefore(7, -1), changeTimes: changes(1), now: NOW }).suggest, false);
});

test('건수 경계: 내보낸 직후라도 29건·30건은 권유하지 않고 31건부터 권유', () => {
  const at = daysBefore(1);
  const adv = (n) => backupAdvice({ lastExportAt: at, changeTimes: changes(n), now: NOW });
  assert.equal(adv(29).suggest, false);
  assert.equal(adv(30).suggest, false);
  assert.equal(adv(31).suggest, true);
  assert.equal(adv(31).reason, 'count');
  assert.equal(adv(31).changes, 31);
});

test('변경이 0건이면 며칠이 지나도 권유하지 않는다(C12-2)', () => {
  assert.equal(backupAdvice({ lastExportAt: daysBefore(100), changeTimes: [], now: NOW }).suggest, false);
  // 내보내기 뒤가 아니라 앞의 변경은 세지 않는다
  assert.equal(backupAdvice({ lastExportAt: daysBefore(10), changeTimes: changes(40, daysBefore(20)), now: NOW }).suggest, false);
  assert.equal(backupAdvice({ lastExportAt: daysBefore(10), changeTimes: changes(40, daysBefore(20)), now: NOW }).changes, 0);
});

test('내보낸 적이 없으면 변경 수(30건 초과)로만 판단한다(C12-3)', () => {
  const adv = (n) => backupAdvice({ changeTimes: changes(n, daysBefore(400)), now: NOW });
  assert.equal(adv(1).suggest, false); // 오래됐어도 날짜로는 권하지 않음
  assert.equal(adv(30).suggest, false);
  assert.equal(adv(31).suggest, true);
  assert.equal(adv(31).days, null);
  assert.equal(backupAdvice({ lastExportAt: null, changeTimes: [], now: NOW }).suggest, false);
});

test('읽을 수 없는 내보내기 시각은 내보낸 적 없음으로 본다', () => {
  assert.equal(backupAdvice({ lastExportAt: '어제', changeTimes: changes(5), now: NOW }).suggest, false);
  assert.equal(backupAdvice({ lastExportAt: '어제', changeTimes: changes(31), now: NOW }).suggest, true);
});

test('닫기: 닫은 시각부터 다시 센다 — 건수는 닫은 뒤 변경만, 날짜는 닫은 날부터 7일', () => {
  const exportAt = daysBefore(20);
  const dismissedAt = daysBefore(1);
  // 닫기 전에 쌓인 변경 40건은 세지 않는다
  const afterDismiss = backupAdvice({ lastExportAt: exportAt, dismissedAt, changeTimes: [...changes(40, daysBefore(5)), ...changes(2)], now: NOW });
  assert.equal(afterDismiss.suggest, false);
  assert.equal(afterDismiss.changes, 2);
  // 닫은 뒤 31건이면 다시 권유
  assert.equal(backupAdvice({ lastExportAt: exportAt, dismissedAt, changeTimes: changes(31), now: NOW }).suggest, true);
  // 닫은 지 7일이 지나고 그 뒤 변경이 1건 이상이면 다시 권유
  assert.equal(backupAdvice({ lastExportAt: exportAt, dismissedAt: daysBefore(7), changeTimes: changes(1), now: NOW }).suggest, true);
  assert.equal(backupAdvice({ lastExportAt: exportAt, dismissedAt: daysBefore(7), changeTimes: [], now: NOW }).suggest, false);
  // 내보낸 적이 없을 때 닫으면 날짜 기준은 쓰지 않고 닫은 뒤 건수만
  assert.equal(backupAdvice({ dismissedAt: daysBefore(30), changeTimes: changes(5), now: NOW }).suggest, false);
  // 내보내면(내보내기 시각이 닫은 시각보다 늦음) 그때부터 센다
  assert.equal(backupAdvice({ lastExportAt: daysBefore(0), dismissedAt: daysBefore(3), changeTimes: changes(40, daysBefore(1)), now: NOW }).changes, 0);
});

test('변경 수는 source user 이벤트만 센다(샘플·자동 연결은 제외)', () => {
  const doc = { events: [
    { source: 'user', recorded_at: 'a' }, { source: 'sample', recorded_at: 'b' }, { source: 'user', recorded_at: 'c' }, { source: 'system', recorded_at: 'd' },
  ] };
  assert.deepEqual(userChangeTimes(doc), ['a', 'c']);
  assert.deepEqual(userChangeTimes({}), []);
});

// ── 설정 필드 ──
const mem = (init = null) => {
  let raw = init;
  return { getItem: () => raw, setItem: (_k, v) => { raw = v; }, removeItem: () => { raw = null; }, get raw() { return raw; } };
};
const DEF = { provider: 'pregen' };

test('설정: lastExportAt·backupDismissedAt를 저장하고 읽는다(새 저장 키 없이 같은 설정 키 안)', () => {
  const s = mem();
  assert.equal(saveSettings(s, { provider: 'pregen', lastExportAt: '2026-10-13T10:00:00+09:00', backupDismissedAt: '2026-10-14T10:00:00+09:00' }), true);
  assert.deepEqual(loadSettings(s, DEF), { provider: 'pregen', lastExportAt: '2026-10-13T10:00:00+09:00', backupDismissedAt: '2026-10-14T10:00:00+09:00' });
});

test('설정: 시각이 없으면 저장 형태는 예전과 같다({provider}만)', () => {
  const s = mem();
  saveSettings(s, { provider: 'pregen' });
  assert.equal(s.raw, JSON.stringify({ provider: 'pregen' }));
  assert.deepEqual(loadSettings(s, DEF), { provider: 'pregen' });
});

test('설정: 깨진 값은 기본값, 날짜가 아닌 시각은 없는 것으로', () => {
  assert.deepEqual(loadSettings(mem('{깨짐'), DEF), DEF);
  assert.deepEqual(loadSettings(mem('null'), DEF), DEF);
  assert.deepEqual(loadSettings(mem(JSON.stringify({ provider: 'pregen', lastExportAt: '어제', backupDismissedAt: 5 })), DEF), { provider: 'pregen' });
  assert.deepEqual(loadSettings(null, DEF), DEF);
  assert.equal(saveSettings(null, { provider: 'pregen' }), false);
});

test('설정: 저장 실패하면 false(화면은 계속 동작)', () => {
  const s = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  assert.equal(saveSettings(s, { provider: 'pregen', lastExportAt: '2026-10-13T10:00:00+09:00' }), false);
});
