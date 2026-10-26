// 처음 사용 8회차에서 남긴 것(FU8-20 인사이트 첫 화면 한 줄 결론·접힌 「어떻게 셌나요?」, 메뉴 배지 낱말) 단위 검증.
// DOM 흉내(tests/dom-stub.js)로 돌린다. 지도 고르기 키보드·담당 넘기기 폼 순서는 실제 브라우저 점검(tools/browser-check.mjs 「8회차 남은 것」)이 한다. 가상 데이터만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeEl, installDom, uninstallDom } from './dom-stub.js';
import { buildView } from '../app/src/view/view.js';
import { mkDoc, mkEdge as e, mkNode as n } from './helpers.js';
import { insightPanel } from '../app/src/ui/insight.js';

const withDom = (fn) => async () => {
  const body = installDom();
  const hadRemove = Object.hasOwn(FakeEl.prototype, 'remove');
  if (!hadRemove) FakeEl.prototype.remove = function remove() { if (this.parentNode) this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1); this.parentNode = null; };
  try { await fn(body); } finally { if (!hadRemove) delete FakeEl.prototype.remove; uninstallDom(); }
};
const ASOF = '2026-10-25';
const view = buildView(mkDoc('U-R', [n('W1', 'work', '정산'), n('W2', 'work', '대사'), n('P1', 'person', '가상갑'), n('P2', 'person', '가상을')], [e('P1', 'W1', 'performs', {}), e('P2', 'W2', 'performs', {})], []));
const panelOf = (kind) => insightPanel({ view, provider: null, kind, asOf: ASOF, today: ASOF, mapName: '가상', baseline: null, onFocus() {}, onClose() {} });

for (const kind of ['risk', 'similar', 'repeat', 'density', 'flow']) {
  test(`FU8-20 인사이트 「${kind}」 탭: 맨 위 한 줄 결론이 있고 긴 설명은 접힌 「어떻게 셌나요?」 안에 있다`, withDom((body) => {
    const panel = panelOf(kind);
    body.append(panel);
    const body2 = panel.querySelector('[data-testid=insight-body]');
    const head = body2.querySelector('[data-testid=insight-headline]');
    assert.ok(head && head.textContent.trim().length > 0, '한 줄 결론');
    const how = body2.querySelector('[data-testid=insight-how]');
    assert.ok(how, '접힌 설명');
    assert.equal(how.tagName.toLowerCase(), 'details');
    assert.ok(!how.open, '처음엔 접힘');
    assert.equal(how.querySelector('summary').textContent, '어떻게 셌나요?');
    // 결론은 설명 상자보다 앞, 접힌 상자 밖
    assert.equal(how.querySelector('[data-testid=insight-headline]'), null);
  }));
}

test('FU8-20 인수인계 위험 탭 결론: 「혼자만 아는 업무 n개 — 가장 급한 곳: 「…」」, 기준 설명은 접힌 상자 안', withDom((body) => {
  const panel = panelOf('risk');
  body.append(panel);
  const head = panel.querySelector('[data-testid=insight-headline]').textContent;
  assert.match(head, /^혼자만 아는 업무 \d+개( — 가장 급한 곳: 「.+」)?$/);
  const how = panel.querySelector('[data-testid=insight-how]');
  assert.ok(how.textContent.includes('낮은 순입니다'));
  for (const id of ['risk-concentration', 'risk-readiness', 'risk-ripple']) assert.ok(!panel.querySelector(`[data-testid=${id}]`).textContent.includes('낮은 순입니다'));
}));
