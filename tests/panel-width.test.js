// 오른쪽 패널 폭 조절: 폭 자르기(순수 함수)와 설정 panelWidth 저장·복원
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PANEL, clampPanelWidth, maxPanelWidth } from '../app/src/view/panel.js';
import { loadSettings, saveSettings } from '../app/src/store/local.js';

test('폭 자르기: 최소·최대 경계', () => {
  assert.equal(clampPanelWidth(299, 1600), 300);
  assert.equal(clampPanelWidth(300, 1600), 300);
  assert.equal(clampPanelWidth(301, 1600), 301);
  assert.equal(clampPanelWidth(500.4, 1600), 500);
  // 1600px 창: min(1200, 1280) = 1200
  assert.equal(maxPanelWidth(1600), 1200);
  assert.equal(clampPanelWidth(1200, 1600), 1200);
  assert.equal(clampPanelWidth(1201, 1600), 1200);
  assert.equal(clampPanelWidth(5000, 1600), 1200);
});

test('폭 자르기: 그래프가 최소 320px 남는다(창이 좁을 때 창 폭 - 320이 더 작다)', () => {
  // 1000px 창: min(750, 680) = 680
  assert.equal(maxPanelWidth(1000), 680);
  assert.equal(clampPanelWidth(900, 1000), 680);
  // 1200px 창: min(900, 880) = 880
  assert.equal(maxPanelWidth(1200), 880);
});

test('폭 자르기: 창이 너무 좁아 최대가 최소보다 작으면 최소', () => {
  assert.equal(maxPanelWidth(500), PANEL.MIN);
  assert.equal(clampPanelWidth(900, 500), 300);
  assert.equal(clampPanelWidth(100, 0), 300);
});

test('폭 자르기: 숫자가 아니면 기본 폭(범위 안으로 자름)', () => {
  assert.equal(clampPanelWidth(NaN, 1600), 380);
  assert.equal(clampPanelWidth('500', 1600), 380);
  assert.equal(clampPanelWidth(undefined, 1600), 380);
  assert.equal(clampPanelWidth(null, 1600), 380);
  assert.equal(clampPanelWidth(Infinity, 1600), 380);
  assert.equal(clampPanelWidth(NaN, 500), 300); // 기본 폭도 최대를 넘으면 자른다
});

function mem(initial) {
  const m = new Map();
  if (initial !== undefined) m.set('wu:v1:settings', initial);
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), m };
}
const DEF = { provider: 'pregen' };

test('설정 panelWidth: 저장하고 다시 읽으면 복원', () => {
  const s = mem();
  assert.equal(saveSettings(s, { provider: 'pregen', panelWidth: 520 }), true);
  assert.equal(JSON.parse(s.m.get('wu:v1:settings')).panelWidth, 520);
  assert.deepEqual(loadSettings(s, DEF), { provider: 'pregen', panelWidth: 520 });
});

test('설정 panelWidth: 값이 없으면 필드도 없다(기본 폭으로 되돌림)', () => {
  const s = mem();
  saveSettings(s, { provider: 'pregen' });
  assert.equal('panelWidth' in JSON.parse(s.m.get('wu:v1:settings')), false);
  assert.deepEqual(loadSettings(s, DEF), { provider: 'pregen' });
});

test('설정 panelWidth: 잘못된 값(음수·소수·문자열·5000·199·불리언)은 저장·복원 모두 버림', () => {
  for (const bad of [-1, 520.5, '520', 5000, 199, 4001, true, null, NaN]) {
    const s = mem();
    saveSettings(s, { provider: 'pregen', panelWidth: bad });
    assert.equal('panelWidth' in JSON.parse(s.m.get('wu:v1:settings')), false, `저장 거르기 ${String(bad)}`);
    const r = mem(JSON.stringify({ provider: 'pregen', panelWidth: bad }));
    assert.deepEqual(loadSettings(r, DEF), { provider: 'pregen' }, `읽기 거르기 ${String(bad)}`);
  }
  // 경계값은 받는다
  assert.equal(loadSettings(mem(JSON.stringify({ provider: 'pregen', panelWidth: 200 })), DEF).panelWidth, 200);
  assert.equal(loadSettings(mem(JSON.stringify({ provider: 'pregen', panelWidth: 4000 })), DEF).panelWidth, 4000);
});

test('설정 panelWidth: 저장소가 없으면 저장만 조용히 실패(false)하고 읽기는 기본값', () => {
  assert.equal(saveSettings(null, { provider: 'pregen', panelWidth: 500 }), false);
  assert.deepEqual(loadSettings(null, DEF), DEF);
});
