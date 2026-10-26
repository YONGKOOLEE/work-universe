// CR-22 S 시작 화면 두 얼굴 단위 검증: 얼굴 판정(startFace), 미리 보기 도식 구성(순수 데이터·선 계산), 화면 조각(DOM 흉내).
// 실제 배치·크기는 tools/browser-check.mjs 「CR-22 S」가 확인한다. 가상 데이터만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeEl, installDom, uninstallDom } from './dom-stub.js';
import {
  PREVIEW_CARDS, PREVIEW_EDGES, PREVIEW_NODES, PREVIEW_SPACES, WAY_SPACES, WHY_LINE,
  previewLines, startFace, startScreen,
} from '../app/src/ui/start.js';

const U = (id, name, extra = {}) => ({ id, name, level: '업무', node_count: 5, ref_count: 0, is_sample: false, ...extra });
const SAMPLES = [U('U-A1', '월말 정산 점검', { is_sample: true }), U('U-D1', '가상 운영부', { is_sample: true })];
const GUIDE = { 'U-A1': { order: 1, recommended: true, tagline: '샘플' }, 'U-D1': { order: 2 } };

const mk = (over = {}) => startScreen({
  universes: SAMPLES, guide: GUIDE, warnings: [], readOnly: false, onOpen: () => {}, onCreate: () => {}, onTour: () => {}, maps: [], resume: null, ...over,
});
const q = (root, id) => root.querySelector(`[data-testid=${id}]`);
const qa = (root, sel) => root.querySelectorAll(sel);

test('startFace: 내 지도도 이어서 볼 지도도 없으면 first', () => {
  assert.equal(startFace({ maps: [], resume: null }), 'first');
  assert.equal(startFace({}), 'first');
  assert.equal(startFace({ universes: SAMPLES }), 'first'); // maps 없이 불린 예전 모양: 샘플뿐
});
test('startFace: 내 지도가 있거나 이어서 볼 지도가 있으면 returning', () => {
  assert.equal(startFace({ maps: [U('U-M1', '내 지도', { kind: 'mine' })], resume: null }), 'returning');
  assert.equal(startFace({ maps: [], resume: { id: 'U-A1', name: '월말 정산 점검' } }), 'returning');
  assert.equal(startFace({ universes: [...SAMPLES, U('U-M1', '내 지도')] }), 'returning');
});

test('미리 보기 도식: 공간 5개 이름이 앱 왼쪽 메뉴와 같고, 점·선·카드 줄이 있다', () => {
  assert.deepEqual(PREVIEW_SPACES, ['지도 보기', '기록', '인수인계', '매주 점검', '지도 관리']);
  assert.ok(PREVIEW_NODES.length >= 4 && PREVIEW_NODES.some((n) => n.kind === 'center'));
  assert.ok(PREVIEW_CARDS.length >= 2);
  assert.equal(new Set(PREVIEW_NODES.map((n) => n.id)).size, PREVIEW_NODES.length);
});
test('previewLines: 모든 선이 있는 점을 잇고 길이·각도가 맞다', () => {
  const ids = new Set(PREVIEW_NODES.map((n) => n.id));
  assert.ok(PREVIEW_EDGES.every(([a, b]) => ids.has(a) && ids.has(b)));
  const lines = previewLines();
  assert.equal(lines.length, PREVIEW_EDGES.length);
  const l = previewLines([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 3, y: 4 }], [['a', 'b']])[0];
  assert.equal(l.length, 5);
  assert.equal(Math.round(l.angle), 53);
  assert.deepEqual(previewLines([{ id: 'a', x: 0, y: 0 }], [['a', 'zz']]), []); // 없는 점을 잇는 선은 버린다
});

test('처음 온 화면: 미리 보기 도식·세 갈래·더 보기 하나, 이어서 보기·왜 세 칸 없음', () => {
  installDom();
  try {
    const r = mk();
    assert.equal(r.getAttribute('data-face'), 'first');
    assert.ok(q(r, 'start-preview') && q(r, 'start-preview-map') && q(r, 'start-preview-cards'));
    assert.equal(qa(q(r, 'start-preview-spaces'), 'span').length, 5);
    assert.equal(qa(r, '[data-testid=why-step]').length, 0);
    assert.equal(q(r, 'start-resume'), null);
    for (const id of ['start-way-handover', 'start-way-mine', 'start-way-team']) assert.ok(q(r, id), id);
    // 세 갈래 설명은 공간 이름과 맞춤
    assert.ok(q(r, 'start-way-handover-space').textContent.includes('「인수인계」'));
    assert.ok(q(r, 'start-way-mine-space').textContent.includes('「기록」') && q(r, 'start-way-mine-space').textContent.includes('「지도 관리」'));
    assert.ok(q(r, 'start-way-team-space').textContent.includes('「매주 점검」'));
    // 작은 단추·샘플·처음 순서는 더 보기 안
    const more = q(r, 'start-more');
    assert.equal(qa(r, '[data-testid=start-more]').length, 1);
    for (const id of ['start-primary', 'start-create', 'start-samples', 'start-steps']) assert.ok(q(more, id), id);
    assert.equal(q(more, 'start-more'), null);
    assert.equal(more.querySelector('summary').textContent, '더 보기'); // 접힘 제목은 「더 보기」(안에 샘플 바로 열기·새 지도·가져오기·용어·처음 순서·샘플 목록 — 메인 검토로 되돌림)
    assert.equal(q(r, 'start-ways').parentNode.tagName, 'HEADER'); // 세 갈래는 접히지 않은 위쪽
  } finally { uninstallDom(); }
});

test('다시 온 화면: 이어서 보기 큰 카드가 맨 위, 내 지도 목록(이어서 볼 지도는 중복 없이), 다른 일 하기', () => {
  installDom();
  try {
    const maps = [U('U-A1', '월말 정산 점검', { is_sample: true, kind: 'edited-sample', modified: '2026-10-20' }), U('U-M1', '내 업무', { kind: 'mine', modified: '2026-10-18' })];
    const opened = [];
    const r = mk({ maps, resume: { id: 'U-A1', name: '월말 정산 점검' }, onOpen: (id) => opened.push(id) });
    assert.equal(r.getAttribute('data-face'), 'returning');
    assert.equal(q(r, 'start-preview'), null);
    assert.equal(q(r, 'why-block').textContent, WHY_LINE);
    const kids = r.children.map((c) => c.getAttribute('data-testid') || c.tagName);
    assert.ok(kids.indexOf('start-resume-card') < kids.indexOf('start-other'), kids.join());
    assert.ok(q(r, 'start-resume-card').textContent.includes('이어서 보기') && q(r, 'start-resume-card').textContent.includes('마지막 수정 2026-10-20'));
    assert.ok(q(r, 'start-other').textContent.includes('다른 일 하기') && q(r, 'start-other').querySelector('[data-testid=start-way-team]'));
    // 이어서 볼 지도는 목록에 다시 나오지 않는다. 같은 지도를 여는 단추는 하나
    assert.equal(q(r, 'start-mine').querySelector('[data-testid=mine-card-U-A1]'), null);
    assert.ok(q(r, 'start-mine').querySelector('[data-testid=card-U-M1]'));
    assert.equal(qa(r, '[data-testid=mine-open-U-A1]').length, 0);
    const btn = q(r, 'start-resume');
    btn.listeners.get('click')[0]?.();
    assert.deepEqual(opened, ['U-A1']);
  } finally { uninstallDom(); }
});

test('다시 온 화면: 이어서 볼 지도 없이 내 지도만 있으면 큰 카드(start-resume) 없이 목록과 다른 일 하기', () => {
  installDom();
  try {
    const r = mk({ maps: [U('U-M1', '내 업무', { kind: 'mine' })], resume: null });
    assert.equal(q(r, 'start-resume'), null);
    assert.equal(q(r, 'start-resume-card'), null);
    assert.ok(q(r, 'start-mine') && q(r, 'start-other'));
  } finally { uninstallDom(); }
});

test('공간 이름 표기는 「」, 어려운 낱말(유니버스·노드)이 없다', () => {
  assert.ok(Object.values(WAY_SPACES).every((s) => /^「.+」/.test(s)));
  installDom();
  try {
    const r = mk();
    const t = r.textContent.replace(/「[^」]*」/g, '');
    assert.ok(!/유니버스|노드|꼭지/.test(t));
    assert.ok(FakeEl);
  } finally { uninstallDom(); }
});
