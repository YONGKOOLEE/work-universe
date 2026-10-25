// 열 번째 검토 묶음 C(RV10S-1·2·6·14, RV10-9): 여러 탭 저장 합치기·다른 탭 변경 감지·키 칸 DOM·설정 길이 상한·점검 저장 단추 조건.
// 순수 계산 + DOM 흉내(tests/dom-stub.js). 실제 브라우저 점검을 대신하지 않는다. 가상 데이터와 가짜 키만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, uninstallDom } from './dom-stub.js';
import {
  OTHER_TAB_NOTE, SETTINGS_MAX_CHARS, baselineSaveAllowed, loadSettings, otherTabChangedUniverse, saveSettings,
} from '../app/src/store/local.js';
import { makeBaseline } from '../app/src/rules/daily-use.js';
import { settingsPanel } from '../app/src/ui/settings.js';
import { KEY_NOTE, SECURITY_ITEMS } from '../app/src/ui/ai-notes.js';

const SETTINGS = 'wu:v1:settings';
const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
};
const FAKE_KEY = 'sk-ant-test-0000';
const defaults = { provider: 'pregen' };
const stored = (st) => JSON.parse(st.getItem(SETTINGS));
const row = (day, extra = {}) => makeBaseline({ solo: 1, dense: 0, gaps: 0 }, { at: `${day}T09:00:00+09:00`, asOf: day, ...extra });

test('RV10S-1: 탭 A가 키를 지운 뒤 탭 B가 다른 설정을 저장해도 키가 되살아나지 않는다', () => {
  const st = memStorage({ [SETTINGS]: JSON.stringify({ provider: 'claude_api', apiKey: FAKE_KEY }) });
  const a = loadSettings(st, defaults);
  const b = loadSettings(st, defaults);
  delete a.apiKey;
  assert.equal(saveSettings(st, a), true);
  assert.equal(stored(st).apiKey, undefined);
  b.authorName = '가상갑';
  assert.equal(saveSettings(st, b), true);
  assert.equal(stored(st).apiKey, undefined, '키는 지운 채로');
  assert.equal(stored(st).authorName, '가상갑', 'B가 바꾼 것은 저장');
});

test('RV10S-1: 키를 지운 뒤 다른 탭이 두 번 저장해도(두 번째 저장에서도) 키가 되살아나지 않는다', () => {
  const st = memStorage({ [SETTINGS]: JSON.stringify({ provider: 'claude_api', apiKey: FAKE_KEY }) });
  const a = loadSettings(st, defaults);
  const b = loadSettings(st, defaults);
  delete a.apiKey;
  saveSettings(st, a);
  b.authorName = '가상갑';
  saveSettings(st, b);
  b.moreTools = true;
  saveSettings(st, b);
  assert.equal(stored(st).apiKey, undefined, '두 번째 저장에서도 키는 지운 채로');
  assert.equal(stored(st).moreTools, true);
  assert.equal(stored(st).authorName, '가상갑');
});

test('RV10S-1: 두 탭이 서로 다른 설정을 바꾸면 둘 다 남는다(마지막 저장이 앞의 변경을 지우지 않음)', () => {
  const st = memStorage({ [SETTINGS]: JSON.stringify({ provider: 'pregen' }) });
  const a = loadSettings(st, defaults);
  const b = loadSettings(st, defaults);
  a.authorName = '가상갑';
  saveSettings(st, a);
  b.moreTools = true;
  b.riskBaseline = { 'M-2': row('2026-10-20') };
  saveSettings(st, b);
  a.riskBaseline = { 'M-1': row('2026-10-21') };
  saveSettings(st, a);
  const s = stored(st);
  assert.equal(s.authorName, '가상갑');
  assert.equal(s.moreTools, true);
  assert.deepEqual(Object.keys(s.riskBaseline).sort(), ['M-1', 'M-2'], '지도별 점검 기준도 합친다');
});

test('RV10S-1: 같은 필드를 두 탭이 바꾸면 나중에 저장한 탭이 이긴다, 저장 뒤 다시 저장해도 안정', () => {
  const st = memStorage({ [SETTINGS]: JSON.stringify({ provider: 'pregen', authorName: '원래' }) });
  const a = loadSettings(st, defaults);
  const b = loadSettings(st, defaults);
  a.authorName = '가상갑';
  saveSettings(st, a);
  b.authorName = '가상을';
  saveSettings(st, b);
  assert.equal(stored(st).authorName, '가상을');
  saveSettings(st, b);
  assert.equal(stored(st).authorName, '가상을');
  delete b.authorName; // 이 탭이 지우면 지운 것으로
  saveSettings(st, b);
  assert.equal(stored(st).authorName, undefined);
});

test('RV10S-1: loadSettings를 거치지 않은 객체는 예전처럼 그대로 저장(저장소에 있던 값은 덮어씀)', () => {
  const st = memStorage({ [SETTINGS]: JSON.stringify({ provider: 'pregen', apiKey: FAKE_KEY }) });
  saveSettings(st, { provider: 'pregen', moreTools: true });
  assert.deepEqual(stored(st), { provider: 'pregen', moreTools: true });
});

test('RV10S-1: 다른 탭이 이 지도 문서를 바꿨는지 알아낸다', () => {
  const st = memStorage();
  const other = memStorage();
  const ev = (o) => ({ storageArea: st, key: 'wu:v1:u:M-1', ...o });
  assert.equal(otherTabChangedUniverse(ev({}), st, 'M-1'), true);
  assert.equal(otherTabChangedUniverse(ev({ key: 'wu:v1:u:M-2' }), st, 'M-1'), false, '다른 지도');
  assert.equal(otherTabChangedUniverse(ev({ key: 'wu:v1:settings' }), st, 'M-1'), false, '설정은 지도 문서가 아님');
  assert.equal(otherTabChangedUniverse(ev({ storageArea: other }), st, 'M-1'), false, '다른 저장소');
  assert.equal(otherTabChangedUniverse(ev({ key: null }), st, 'M-1'), true, '저장소 전체 비움');
  assert.equal(otherTabChangedUniverse(null, st, 'M-1'), false);
  assert.equal(otherTabChangedUniverse(ev({}), null, 'M-1'), false);
  assert.ok(OTHER_TAB_NOTE.includes('다른 탭에서 이 지도가 바뀌었습니다') && OTHER_TAB_NOTE.includes('덮어씁니다') && OTHER_TAB_NOTE.includes('새로 고침'));
});

test('RV10S-14: 점검 기준이 너무 커지면 오래된 것부터 버리고 길이 상한 안에서 저장', () => {
  const names = { solo: Array.from({ length: 30 }, (_, i) => `가상이름${'가'.repeat(80)}${i}`), dense: [], gaps: [] };
  const owners = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`가상업무${'나'.repeat(80)}${i}`, '가'.repeat(250)]));
  const riskBaseline = {};
  for (let i = 0; i < 30; i += 1) {
    const day = `2026-09-${String(i + 1).padStart(2, '0')}`;
    riskBaseline[`M-${i}`] = [row(day, { names, owners }), row(`2026-10-${String((i % 28) + 1).padStart(2, '0')}`, { names, owners })];
  }
  assert.ok(JSON.stringify({ riskBaseline }).length > SETTINGS_MAX_CHARS, '시험 전제: 상한보다 크다');
  const st = memStorage();
  assert.equal(saveSettings(st, { provider: 'pregen', authorName: '가상갑', riskBaseline }), true);
  const raw = st.getItem(SETTINGS);
  assert.ok(raw.length <= SETTINGS_MAX_CHARS, `길이 ${raw.length}`);
  const s = JSON.parse(raw);
  assert.equal(s.authorName, '가상갑', '다른 설정은 그대로');
  const kept = Object.keys(s.riskBaseline);
  assert.ok(kept.length > 0 && kept.length < 30);
  assert.ok(kept.includes('M-27') && !kept.includes('M-0'), '가장 최근 점검한 지도는 남고 가장 오래된 지도는 버림');
});

test('RV10S-14: 작은 설정은 상한에 걸리지 않는다', () => {
  const st = memStorage();
  const riskBaseline = { 'M-1': row('2026-10-20') };
  saveSettings(st, { provider: 'pregen', riskBaseline });
  assert.deepEqual(Object.keys(stored(st).riskBaseline), ['M-1']);
});

test('RV10S-6: 키 칸은 값을 속성이 아닌 .value로 넣고 autocomplete는 new-password', async () => {
  const body = installDom();
  const { FakeEl } = await import('./dom-stub.js');
  const hadAfter = Object.hasOwn(FakeEl.prototype, 'after');
  if (!hadAfter) FakeEl.prototype.after = function after(n) { const p = this.parentNode; if (p) { n.parentNode = p; p.childNodes.splice(p.childNodes.indexOf(this) + 1, 0, n); } };
  try {
    const panel = settingsPanel({ current: 'claude_api', apiKey: FAKE_KEY, persisted: true, onAuthorName() {}, onChange() {}, onClose() {} });
    body.append(panel);
    const input = panel.querySelector('[data-testid=settings-apikey]');
    assert.equal(input.value, FAKE_KEY, '칸에는 키가 들어 있다');
    assert.equal(input.getAttribute('value'), null, 'DOM 속성에는 키를 남기지 않는다');
    assert.equal(input.getAttribute('autocomplete'), 'new-password');
    assert.equal(input.getAttribute('type'), 'password');
  } finally { if (!hadAfter) delete FakeEl.prototype.after; uninstallDom(); }
});

test('RV10S-2: 키 안내와 「키와 데이터」 도움말에 다른 로컬 HTML이 읽을 수 있다는 안내와 키 지우기·짧은 기간 키 권장', () => {
  const security = SECURITY_ITEMS.find((i) => i.term === '키는 어디에 저장되나요').desc;
  for (const text of [KEY_NOTE, security]) {
    for (const must of ['다른 로컬 HTML', 'file://', '키 지우기', '짧은 기간']) assert.ok(text.includes(must), `${must} / ${text.slice(0, 20)}`);
  }
});

test('RV10-9: 읽기 전용·내용 포함 HTML 보기·되감기 중·저장소 없음에서는 점검 저장 단추를 끈다', () => {
  const st = memStorage();
  assert.equal(baselineSaveAllowed({ storage: st, readOnly: false, rewinding: false }), true);
  assert.equal(baselineSaveAllowed({ storage: st, readOnly: true, rewinding: false }), false, '읽기 전용');
  assert.equal(baselineSaveAllowed({ storage: null, readOnly: false, rewinding: false }), false, '내용 포함 HTML 보기·저장소 없음');
  assert.equal(baselineSaveAllowed({ storage: st, readOnly: false, rewinding: true }), false, '되감기 중');
});
