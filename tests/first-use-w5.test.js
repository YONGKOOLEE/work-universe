// 처음 사용 점검 2회차(2026-10-24) W5: 상세·인사이트·편집기·폴더 문구 — FU-31·32(인사이트 위험 탭), FU-34(처음 할 일 아래 팀 안내), FU-35(관계 고르기 칸), FU-37(이력 분류 안내).
// DOM 흉내(tests/dom-stub.js)로 돌린다. 실제 브라우저 점검(tools/browser-check.mjs 「처음 사용 W5」)을 대신하지 않는다. 가상 데이터만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewOf } from './helpers.js';
import { installDom, uninstallDom } from './dom-stub.js';
import { allowedRelations, EDGE_TYPES, MEMO_CATEGORIES } from '../app/src/model/schema.js';
import { densityGaps } from '../app/src/rules/insight.js';
import { knowledgeConcentration } from '../app/src/rules/insight-risk.js';
import { buildHandoverDraft } from '../app/src/rules/handover.js';
import { renderUniverseSummary } from '../app/src/ui/detail.js';
import { describeUniverse } from '../app/src/view/describe.js';
import { insightPanel } from '../app/src/ui/insight.js';
import { PAIR_BLOCKED_GROUP, eventForm, markRelationOptions, relationOptionText } from '../app/src/ui/editor.js';

const ASOF = '2026-10-02';
const withDom = (fn) => () => {
  const body = installDom();
  try { fn(body); } finally { uninstallDom(); }
};

// ── FU-35: 관계 고르기 칸 (CR-18-4에서 「못 쓰는 관계는 아래 묶음」으로 바뀜: disabled + 보기 글 꼬리표 방식 → optgroup 방식) ──
// 실제 select처럼 보기 목록을 다시 만드는 함수이므로 DOM 흉내의 select에서 돌린다
const relationSelect = (value = 'relates_to') => {
  const sel = document.createElement('select');
  for (const v of Object.keys(EDGE_TYPES)) { const o = document.createElement('option'); o.setAttribute('value', v); o.textContent = EDGE_TYPES[v]; if (v === value) o.setAttribute('selected', ''); sel.append(o); }
  sel.value = value;
  return sel;
};

test('FU-35 markRelationOptions: 사람↔업무는 쓸 수 있는 관계(수행·참조)가 위, 나머지는 disabled로 「이 조합에는 못 씀」 묶음 안에, schema 허용 표와 같다', withDom(() => {
  const sel = relationSelect();
  markRelationOptions(sel, 'person', 'work');
  const ok = new Set(allowedRelations('person', 'work').map((x) => x.relation));
  assert.ok(ok.has('performs') && ok.has('references'));
  const opts = sel.options;
  assert.equal(opts.length, Object.keys(EDGE_TYPES).length);
  for (const o of opts) {
    assert.equal(o.disabled, !ok.has(o.value), o.value);
    assert.equal(o.textContent, relationOptionText(o.value), '보기 글은 관계 이름 그대로(참조만 CR-18 D-8의 설명 꼬리표가 붙는다. 묶음 이름이 못 씀을 알린다)');
  }
  assert.equal(sel.options.find((o) => o.value === 'relates_to').disabled, true, '관련은 사람↔업무에 못 씀(주제 쪽만)');
  assert.equal(PAIR_BLOCKED_GROUP, '이 조합에는 못 씀');
}));

test('FU-35 markRelationOptions: 방향은 따로 고르므로 반대 방향만 되는 관계도 쓸 수 있다(업무→사람의 수행은 사람→업무로 가능)', withDom(() => {
  const sel = relationSelect();
  markRelationOptions(sel, 'work', 'person');
  assert.equal(sel.options.find((o) => o.value === 'performs').disabled, false);
}));

test('FU-35 markRelationOptions: 연결 대상이 아직 없으면(유형 모름) 전부 켜고 묶음 없이 원래 순서로 되돌린다', withDom(() => {
  const sel = relationSelect();
  markRelationOptions(sel, 'person', 'work');
  markRelationOptions(sel, null, null);
  assert.deepEqual(sel.options.map((o) => o.value), Object.keys(EDGE_TYPES));
  assert.equal(sel.querySelectorAll('optgroup').length, 0);
  for (const o of sel.options) {
    assert.equal(o.disabled, false);
    assert.equal(o.textContent, relationOptionText(o.value));
  }
}));

// ── FU-37: 이력 분류 안내 ──
test('FU-37 이력 추가: 분류 아래에 초안 칸 안내 한 줄, 분류 보기 이름과 맞고 규칙(handover)의 실제 매핑과 같다', withDom(() => {
  const form = eventForm({ node: { id: 'N-001', core_type: 'work', label: '가상 업무' }, nodes: [], handovers: [], onSubmit() {}, onCancel() {} });
  const hint = form.querySelector('[data-testid=category-hint]');
  assert.ok(hint);
  assert.equal(hint.textContent, '분류에 따라 인수인계 초안의 칸이 정해집니다: 이슈 → 「최근 이슈」, 진행 중 → 「진행 중인 일」, 주의사항 → 「주의사항·노하우」');
  // 안내에 쓴 분류 이름이 실제 select 보기 이름과 같다
  assert.equal(MEMO_CATEGORIES.issue, '이슈');
  assert.equal(MEMO_CATEGORIES.in_progress, '진행 중');
  assert.equal(MEMO_CATEGORIES.caution, '주의사항');
  // 분류 select 바로 다음 줄이다(분류 → 안내)
  const kids = form.querySelector('[data-testid=event-category]').parentNode.parentNode.children;
  const at = kids.findIndex((k) => k.querySelector && k.querySelector('[data-testid=event-category]'));
  assert.equal(kids[at + 1], hint);
}));

test('FU-37 규칙 확인: 분류 이슈 → 최근 이슈, 진행 중 → 진행 중인 일, 주의사항 → 주의사항·노하우 (rules/handover.js 항목 이름)', () => {
  const v = viewOf('U-A1');
  const w = v.nodes.find((x) => x.core_type === 'work' && !x.hidden);
  const p = v.nodes.find((x) => x.core_type === 'person' && !x.hidden);
  const r = buildHandoverDraft(v, { target: w.gid, from: p.gid, to: v.nodes.filter((x) => x.core_type === 'person' && !x.hidden)[1].gid, asOf: ASOF });
  assert.ok(r.ok);
  const titles = r.draft.items.map((i) => i.title);
  for (const t of ['최근 이슈', '진행 중인 일', '주의사항·노하우']) assert.ok(titles.includes(t), t);
});

// ── FU-34: 처음 할 일 아래 팀 안내 ──
test('FU-34 처음 할 일 아래: 팀 안내 한 줄과 「폴더 연결」 링크(누르면 열기 함수), 함수가 없으면 그리지 않음', withDom((body) => {
  const s = describeUniverse(viewOf('U-A1'));
  const starter = { steps: [{ label: '첫 업무 추가', done: false }] };
  const panel = document.createElement('div');
  body.append(panel);
  let opened = 0;
  renderUniverseSummary(panel, s, 10, { starter, preview: null, onOpenFolder: () => { opened += 1; } });
  const hint = panel.querySelector('[data-testid=starter-team-hint]');
  assert.ok(hint);
  assert.equal(hint.textContent, '팀과 함께 쓰려면 → 「가져오기·내보내기」의 「폴더 연결」');
  panel.querySelector('[data-testid=btn-starter-folder]').fire('click');
  assert.equal(opened, 1);
  // 처음 할 일 상자 바로 다음에 온다
  const kids = panel.children;
  const at = kids.findIndex((k) => k.dataset.testid === 'starter-steps');
  assert.equal(kids[at + 1], hint);
  // 열기 함수가 없으면(읽기 전용·폴더 못 쓰는 브라우저) 없다
  const panel2 = document.createElement('div');
  renderUniverseSummary(panel2, s, 10, { starter, preview: null });
  assert.equal(panel2.querySelector('[data-testid=starter-team-hint]'), null);
  // 처음 할 일이 없으면(다 했음) 안내도 없다
  const panel3 = document.createElement('div');
  renderUniverseSummary(panel3, s, 10, { onOpenFolder: () => {} });
  assert.equal(panel3.querySelector('[data-testid=starter-team-hint]'), null);
}));

// ── FU-31·32: 인사이트 「인수인계 위험」 ──
const riskPanel = (id) => insightPanel({ view: viewOf(id), provider: null, kind: 'risk', asOf: ASOF, today: ASOF, onFocus() {}, onClose() {} });

test('FU-31 준비도: 업무별 빠진 항목은 <details>로 접고 요약은 「업무 n/6 — 빠진 것 k개」, 다 갖춘 업무는 접지 않음', withDom((body) => {
  const panel = riskPanel('U-A1');
  body.append(panel);
  const folds = panel.querySelectorAll('[data-testid=risk-readiness-fold]');
  assert.ok(folds.length > 0);
  for (const f of folds) {
    assert.equal(f.tagName, 'DETAILS');
    assert.equal(f.getAttribute('open'), null, '기본 접힘');
    const summary = f.querySelector('summary');
    assert.match(summary.textContent, /^「.+」 \d\/6 — 빠진 것 \d+개/);
    const missing = f.children.find((c) => c.tagName === 'UL');
    assert.ok(missing && missing.children.length > 0);
    assert.ok(summary.textContent.includes(`빠진 것 ${missing.children.length}개`));
  }
  // 요약에 업무 이름과 점수가 있어 목록 글에도 그대로 읽힌다
  const list = panel.querySelector('[data-testid=risk-readiness-list]').textContent;
  assert.ok(list.includes('자료 수집') && list.includes('2/6'));
}));

test('FU-32 지식 집중 목록: 지금 담당(현재 수행 연결)이 없는 업무에만 「지금 담당 없음 — 끝난 업무인지 확인」, 판정은 밀집·공백의 공백과 같다', withDom((body) => {
  const v = viewOf('U-D1');
  const gapIds = new Set(densityGaps(v, { asOf: ASOF }).gaps.map((g) => g.gid));
  const conc = knowledgeConcentration(v, { asOf: ASOF });
  const expected = conc.items.filter((x) => gapIds.has(x.work.gid));
  assert.ok(expected.length > 0, '샘플에 지금 담당이 없는데 혼자 해 본 업무가 있다');
  assert.ok(expected.length < conc.items.length, '지금 담당이 있는 업무는 표시가 없다');
  const panel = riskPanel('U-D1');
  body.append(panel);
  const lis = panel.querySelector('[data-testid=risk-concentration-list]').children;
  assert.equal(lis.length, conc.items.length);
  let marked = 0;
  lis.forEach((li, i) => {
    const mark = li.querySelector('[data-testid=risk-no-current]');
    const gap = densityGaps(v, { asOf: ASOF }).gaps.find((g) => g.gid === conc.items[i].work.gid);
    assert.equal(!!mark, !!gap, conc.items[i].work.label);
    if (mark) {
      marked += 1;
      assert.equal(mark.textContent, gap.kind === 'scheduled' ? `지금 담당 없음 — 시작 예정(${gap.next_person.label}, ${gap.next_start}부터)` : '지금 담당 없음 — 끝난 업무인지 확인');
    }
  });
  assert.equal(marked, expected.length);
  // 숫자 요약 줄(counts)은 그대로다 — 표시만 더한 것이지 세는 규칙은 바꾸지 않았다
  assert.match(panel.querySelector('[data-testid=risk-concentration-counts]').textContent, /혼자 해 본 업무 \d+개/);
}));
