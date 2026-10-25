// CR-21 길 찾기 단위 검증: 기능 찾기 검색(feature-index), 최근 기록 계산·이력 강조 대상(recent-records), 화면 조각(DOM 흉내).
// 실제 브라우저 점검(tools/browser-check.mjs 「CR-21」)을 대신하지 않는다. 가상 데이터만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeEl, installDom, uninstallDom } from './dom-stub.js';
import { buildView } from '../app/src/view/view.js';
import { mkDoc, mkEdge, mkNode } from './helpers.js';
import { FEATURES, FEATURE_RESULT_LIMIT, featureBlock, searchFeatures } from '../app/src/view/feature-index.js';
import { RECENT_RECORDS, historyFocus, recentRecords } from '../app/src/view/recent-records.js';
import { renderUniverseSummary, renderNodeDetail, HISTORY_SHOW, HISTORY_COLLAPSE_OVER } from '../app/src/ui/detail.js';
import { describeNode, describeUniverse } from '../app/src/view/describe.js';
import { recentList } from '../app/src/ui/overview.js';

const q = (root, id) => root.querySelector(`[data-testid=${id}]`);
const withDom = (fn) => async () => {
  const body = installDom();
  try { await fn(body); } finally { uninstallDom(); }
};

// ── 기능 찾기 ──
test('CR-21 A 기능 목록: id는 유일, 필수 칸이 있고 동작 키가 비어 있지 않다', () => {
  const ids = FEATURES.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const f of FEATURES) {
    assert.ok(f.name && f.where && f.go && f.keywords.length, f.id);
    assert.ok(['none', 'work', 'node', 'edit', 'grouped'].includes(f.needs), f.id);
  }
  // 명세 3절 최소 목록
  for (const name of ['이번 주 기록', '최근 기록', '인수인계 초안', '담당 바꾸기', '이력 추가', '협업자 추가', '항목 수정', '연결 추가', '표로 추가', '글로 추가', '표로 고치기', '폴더 연결', '업무 지도 묶기', '통합 확인', '편집 되감기', '숨긴 항목', '시간 보기', '항목 찾기', '설정', '따라 하기', '가상 데이터 초기화']) {
    assert.ok(FEATURES.some((f) => f.name.includes(name)), name);
  }
});

test('CR-21 A 검색: 대표 낱말 20개는 기대한 기능이 1~3위에 든다', () => {
  const cases = [
    ['담당', 'assignee'], ['담당자 바꾸기', 'assignee'], ['담당을 넘기고 싶어', 'assignee'], ['미해결', 'issues'], ['해결', 'issues'],
    ['점검', 'weekly-check'], ['매주 점검', 'weekly-check'], ['글로', 'text-add'], ['표로', 'table-add'], ['인수인계', 'draft'],
    ['협업자', 'collab'], ['연결', 'edge'], ['수정', 'edit'], ['되감기', 'rewind'], ['폴더', 'folder'],
    ['묶기', 'group'], ['설정', 'settings'], ['시간', 'time'], ['숨긴', 'hidden'], ['초기화', 'reset'],
    ['최근', 'recent'], ['밀집', 'density'], ['백업', 'json-export'],
  ];
  assert.ok(cases.length >= 20);
  for (const [word, want] of cases) {
    const ids = searchFeatures(word).map((r) => r.id);
    const rank = ids.indexOf(want);
    assert.ok(rank >= 0 && rank <= 2, `「${word}」→ ${want} 순위 ${rank + 1}(결과: ${ids.join(', ')})`);
  }
});

test('CR-21 A 검색: 결과는 최대 6개, 빈 글·모르는 낱말은 빈 목록, 동점은 목록 순서', () => {
  assert.equal(FEATURE_RESULT_LIMIT, 6);
  assert.ok(searchFeatures('추가').length <= 6);
  assert.deepEqual(searchFeatures(''), []);
  assert.deepEqual(searchFeatures('   '), []);
  assert.deepEqual(searchFeatures('zzqqxx'), []);
  const r = searchFeatures('기록');
  const orders = r.map((x) => FEATURES.findIndex((f) => f.id === x.id));
  for (let i = 1; i < r.length; i += 1) assert.ok(r[i - 1].score > r[i].score || (r[i - 1].score === r[i].score && orders[i - 1] < orders[i]));
});

test('CR-21 A 못 쓰는 기능: 읽기 전용·되감기·묶은 지도에서 이유와 함께 흐리게(blocked), 열어 보는 기능은 그대로', () => {
  const get = (id) => FEATURES.find((f) => f.id === id);
  assert.equal(featureBlock(get('weekly'), {}), null);
  assert.equal(featureBlock(get('weekly'), { readOnly: true }), '읽기 전용');
  assert.equal(featureBlock(get('weekly'), { rewinding: true, readOnly: true }), '편집 되감기 중');
  assert.match(featureBlock(get('text-add'), { grouped: true }), /묶은 지도/);
  assert.match(featureBlock(get('rewind'), { grouped: true }), /묶은 지도/);
  assert.equal(featureBlock(get('text-add'), {}), null);
  assert.equal(featureBlock(get('insight'), { readOnly: true, grouped: true }), null);
  assert.equal(featureBlock(get('insight'), { rewinding: true }), '편집 되감기 중', '되감기 중에는 화면 안 이동도 막힌다');
  assert.equal(featureBlock(get('settings'), { rewinding: true }), null, '창을 여는 것은 그대로');
  assert.match(featureBlock(get('tour'), { tourOk: false }), /따라 하기/);
  assert.match(featureBlock(get('folder'), { folderOk: false }), /폴더/);
  const hit = searchFeatures('글로', { readOnly: true })[0];
  assert.equal(hit.id, 'text-add');
  assert.equal(hit.blocked, '읽기 전용');
});

// ── 최근 기록 ──
const AT = (n) => `2026-10-${String(n).padStart(2, '0')}T09:00:00+09:00`;
const ev = (id, type, occurred_at, recorded_at, payload, note, source = 'user') => ({ id, type, occurred_at, recorded_at, source, payload, note });
const base = () => [
  mkNode('N-W1', 'work', '대사 확인'), mkNode('N-W2', 'work', '정산 점검'), mkNode('N-P1', 'person', '김가상'), mkNode('N-P2', 'person', '이가상'),
];

test('CR-21 B-2 최근 기록: user 기록만, 기록 시각 늦은 순, 5건, 줄 내용(날짜·업무·종류·40자)', () => {
  const events = [
    ev('E-1', 'created', '2026-10-01', AT(1), { target_kind: 'node', target_id: 'N-W1' }, undefined),
    ev('E-2', 'memo', '2026-10-02', AT(2), { target_id: 'N-W1', category: 'issue' }, '샘플 메모', 'sample'),
    ev('E-3', 'memo', '2026-10-03', AT(3), { target_id: 'N-W1', category: 'in_progress' }, '첫 메모'),
    ev('E-4', 'memo', '2026-10-04', AT(4), { target_id: 'N-W2', category: 'issue' }, '두 번째 메모'),
    ev('E-5', 'assign_start', '2026-10-05', AT(5), { person_id: 'N-P1', work_id: 'N-W1' }),
    ev('E-6', 'memo', '2026-10-06', AT(6), { target_id: 'N-W2', category: 'caution' }, `${'가'.repeat(60)}`),
    ev('E-7', 'handover', '2026-10-07', AT(7), { from_person_id: 'N-P1', to_person_id: 'N-P2', work_id: 'N-W1' }),
    ev('E-8', 'memo', '2026-10-01', AT(8), { target_id: 'N-W1', category: 'resolved' }, '날짜는 옛날, 기록은 마지막'),
    ev('E-9', 'system', '2026-10-09', AT(9), {}, undefined, 'system'),
  ];
  const view = buildView(mkDoc('U-T', base(), [], events), () => null);
  const rows = recentRecords(view);
  assert.equal(RECENT_RECORDS.LIMIT, 5);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((r) => r.gid), ['U-T/E-8', 'U-T/E-7', 'U-T/E-6', 'U-T/E-5', 'U-T/E-4'], '기록 시각 늦은 순(날짜가 아님), sample·system·자동 기록 제외');
  const r8 = rows[0];
  assert.equal(r8.date, '2026-10-01');
  assert.equal(r8.target, '대사 확인');
  assert.equal(r8.kind, '해결됨');
  assert.equal(r8.text, '날짜는 옛날, 기록은 마지막');
  assert.equal(rows[1].kind, '인수인계');
  assert.equal(rows[1].target, '대사 확인', '인수인계는 사람이 아니라 업무에 건다');
  assert.equal(rows[2].text, `${'가'.repeat(40)}…`);
  assert.equal(rows[2].target_gid, 'U-T/N-W2');
  assert.equal(rows[3].kind, '담당 시작');
  assert.equal(recentRecords(view, { limit: 2 }).length, 2);
});

test('CR-21 B-2 최근 기록: 기록이 없으면 빈 목록(샘플 기록만), 숨긴 항목에 건 기록은 빼고, 묶은 지도는 묶인 지도의 기록도 넣는다', () => {
  const only = [ev('E-1', 'memo', '2026-10-02', AT(2), { target_id: 'N-W1', category: 'issue' }, '샘플', 'sample')];
  assert.deepEqual(recentRecords(buildView(mkDoc('U-T', base(), [], only), () => null)), []);
  const nodes = base();
  nodes[1] = { ...nodes[1], hidden: true };
  const events = [ev('E-1', 'memo', '2026-10-02', AT(2), { target_id: 'N-W2', category: 'issue' }, '숨긴 업무의 메모'), ev('E-2', 'memo', '2026-10-03', AT(3), { target_id: 'N-W1', category: 'issue' }, '보이는 메모')];
  assert.deepEqual(recentRecords(buildView(mkDoc('U-T', nodes, [], events), () => null)).map((r) => r.gid), ['U-T/E-2']);
  // 묶은 지도
  const child = mkDoc('U-C', [mkNode('N-W1', 'work', '하위 업무')], [], [ev('E-1', 'memo', '2026-10-05', AT(20), { target_id: 'N-W1', category: 'issue' }, '하위 지도의 메모')]);
  const parent = mkDoc('U-P', [], [], [ev('E-1', 'memo', '2026-10-04', AT(10), { topic_ids: [], category: 'issue' }, '대상 없는 메모')], { refs: [{ id: 'R-1', child_universe_id: 'U-C', created_at: AT(1) }] });
  const docs = { 'U-P': parent, 'U-C': child };
  const view = buildView(parent, (id) => docs[id] || null);
  const rows = recentRecords(view);
  assert.deepEqual(rows.map((r) => r.gid), ['U-C/E-1']);
  assert.equal(rows[0].target, '하위 업무');
});

// ── 이력 강조 대상 ──
test('CR-21 B-1 이력 강조 대상: 방금 기록한 줄을 찾고, 접힌 목록 밖이면 펼치게 한다', () => {
  const opt = { show: HISTORY_SHOW, collapseOver: HISTORY_COLLAPSE_OVER };
  const items = (n) => Array.from({ length: n }, (_, i) => ({ gid: `U/E-${i}` }));
  assert.deepEqual(historyFocus(items(5), ['U/E-3'], opt), { gid: 'U/E-3', index: 3, foldedAway: false });
  assert.deepEqual(historyFocus(items(5), [], opt), { gid: null, index: -1, foldedAway: false });
  assert.deepEqual(historyFocus(items(5), ['U/E-99'], opt), { gid: null, index: -1, foldedAway: false });
  assert.equal(historyFocus(items(15), ['U/E-0'], opt).foldedAway, false, '15건까지는 접지 않는다');
  assert.equal(historyFocus(items(30), ['U/E-29'], opt).foldedAway, false, '최근 10건 안');
  assert.equal(historyFocus(items(30), ['U/E-5'], opt).foldedAway, true, '접힌 쪽(옛 날짜로 기록)');
  assert.equal(historyFocus(items(30), ['U/E-29', 'U/E-5'], opt).gid, 'U/E-5', '목록에서 먼저 나오는 줄');
});

// ── 화면 조각 ──
// CR-22 W: CR-21 C의 목적별 묶음 4개(기록하기·인수인계·점검·지도 고치기)는 왼쪽 작업 공간 5개로 바뀌었다 — 개요 단추 줄(goal-bar)·묶음 머리글은 없다.
// 같은 내용을 공간 첫 화면이 그린다(기록·인수인계·매주 점검·지도 관리, 처음 할 일·안내는 지도 보기). 묶음 상자 이름(goal-sec-*)은 그대로.
test('CR-22 W 지도 보기: 지도 요약 → 처음 할 일 → 안내 한 줄 → 접힌 「처음이면 읽어 보세요」, 개요 단추 줄은 없다', withDom((body) => {
  const view = buildView(mkDoc('U-T', base(), [mkEdge('N-P1', 'N-W1', 'performs')], []), () => null);
  const s = describeUniverse(view);
  const panel = document.createElement('div');
  body.append(panel);
  renderUniverseSummary(panel, s, 5, { space: 'map', starter: { steps: [{ label: '업무 넣기', done: false }] }, preview: null });
  const order = panel.children.map((c) => c.getAttribute('data-testid') || c.tagName.toLowerCase());
  const at = (id) => order.indexOf(id);
  assert.ok(at('summary') >= 0 && at('summary') < at('starter-steps'), order.join(','));
  assert.ok(at('starter-steps') < at('ws-desc') && at('ws-desc') < at('overview-help'), order.join(','));
  assert.match(q(panel, 'ws-desc').textContent, /왼쪽 메뉴/);
  assert.equal(q(panel, 'goal-bar'), null);
  assert.equal(q(panel, 'goal-sec-record'), null, '다른 공간의 묶음은 그리지 않는다');
  assert.equal(q(panel, 'overview-help').tagName, 'DETAILS');
  assert.ok(q(q(panel, 'overview-help'), 'hint') && q(q(panel, 'overview-help'), 'term-note'));
}));

test('CR-22 W 기록·인수인계·매주 점검·지도 관리: 공간 제목·설명 아래 그 공간의 조각만(기존 요소가 goal-sec-* 상자 안에)', withDom((body) => {
  const view = buildView(mkDoc('U-T', base(), [mkEdge('N-P1', 'N-W1', 'performs')], []), () => null);
  const s = describeUniverse(view);
  const p = (id) => { const x = document.createElement('p'); x.setAttribute('data-testid', id); return x; };
  const draw = (space, extras) => {
    const panel = document.createElement('div');
    body.append(panel);
    renderUniverseSummary(panel, s, 5, { space, ...extras });
    return panel;
  };
  const rec = draw('record', { record: [p('issue-count'), p('weekly-quick')], handover: [p('btn-draft-universe')] });
  assert.equal(q(rec, 'ws-title').textContent, '기록');
  assert.ok(q(q(rec, 'goal-sec-record'), 'weekly-quick'));
  assert.equal(q(rec, 'btn-draft-universe'), null, '다른 공간의 조각은 그리지 않는다');
  assert.equal(q(rec, 'summary'), null);
  const han = draw('handover', { handover: [p('btn-draft-universe')] });
  assert.equal(q(han, 'ws-title').textContent, '인수인계');
  assert.ok(q(q(han, 'goal-sec-handover'), 'btn-draft-universe'));
  const chk = draw('check', { check: [p('insight-hint')] });
  assert.equal(q(chk, 'ws-title').textContent, '매주 점검');
  assert.ok(q(q(chk, 'goal-sec-check'), 'insight-hint'));
  const ed = draw('edit', { edit: [p('rewind-entry')] });
  assert.equal(q(ed, 'ws-title').textContent, '지도 관리');
  assert.ok(q(q(ed, 'goal-sec-edit'), 'rewind-entry'));
  assert.equal(q(ed, 'goal-bar'), null);
}));

test('CR-22 W 공간: 조각이 하나도 없으면(읽기 전용 등) 상자 없이 제목·설명만, 알 수 없는 공간 이름은 지도 보기', withDom((body) => {
  const view = buildView(mkDoc('U-T', base(), [], []), () => null);
  const panel = document.createElement('div');
  body.append(panel);
  renderUniverseSummary(panel, describeUniverse(view), 5, { space: 'record' });
  assert.equal(q(panel, 'goal-sec-record'), null);
  assert.ok(q(panel, 'ws-title'));
  const map = document.createElement('div');
  body.append(map);
  renderUniverseSummary(map, describeUniverse(view), 5, { space: '엉뚱한값' });
  assert.ok(q(map, 'summary') && q(map, 'hint'));
}));

test('CR-21 B 최근 기록 줄: 없으면 안내 한 줄, 있으면 줄마다 「보기」', withDom((body) => {
  const none = recentList([], () => {});
  assert.equal(none.getAttribute('data-testid'), 'recent-records');
  assert.match(q(none, 'recent-empty').textContent, /아직 남긴 기록이 없습니다/);
  assert.equal(q(none, 'recent-item'), null);
  const got = [];
  const box = recentList([{ gid: 'U/E-1', date: '2026-10-25', target_gid: 'U/N-1', target: '대사 확인', kind: '진행 중', text: '불일치 2건' }], (r) => got.push(r.gid));
  const item = q(box, 'recent-item');
  assert.match(item.textContent, /2026-10-25/);
  assert.match(item.textContent, /대사 확인/);
  assert.match(item.textContent, /진행 중/);
  assert.match(item.textContent, /불일치 2건/);
  q(box, 'recent-go').click();
  assert.deepEqual(got, ['U/E-1']);
}));

test('CR-21 B-1 상세의 이력: 방금 기록한 줄에 data-just-added, 접힌 목록이면 펼쳐서 보인다', withDom((body) => {
  const events = Array.from({ length: 20 }, (_, i) => ev(`E-${i + 1}`, 'memo', `2026-09-${String(i + 1).padStart(2, '0')}`, AT(1), { target_id: 'N-W1', category: 'in_progress' }, `메모 ${i + 1}`));
  const view = buildView(mkDoc('U-T', base(), [], events), () => null);
  const d = describeNode(view, 'U-T/N-W1', {});
  const draw = (justAdded) => {
    const panel = document.createElement('div');
    body.append(panel);
    renderNodeDetail(panel, d, { onFocus() {}, justAdded });
    return panel;
  };
  const folded = draw(null);
  assert.equal(folded.querySelectorAll('[data-testid=history] li').length, HISTORY_SHOW);
  assert.equal(folded.querySelectorAll('li').filter((li) => li.getAttribute('data-just-added') === '1').length, 0);
  const marked = draw(['U-T/E-2']);
  const li = marked.querySelectorAll('[data-testid=history] li');
  assert.equal(li.length, 20, '강조할 줄이 접힌 쪽이면 펼친다');
  const hit = li.filter((x) => x.getAttribute('data-just-added') === '1');
  assert.equal(hit.length, 1);
  assert.match(hit[0].textContent, /메모 2/);
  const recent = draw(['U-T/E-20']);
  assert.equal(recent.querySelectorAll('[data-testid=history] li').length, HISTORY_SHOW, '최근 줄이면 접힌 채');
  assert.equal(recent.querySelectorAll('[data-testid=history] li').filter((x) => x.getAttribute('data-just-added') === '1').length, 1);
}));

test('CR-21 A 검색: 명세 검증 낱말은 1위 — 「점검」→ 매주 점검, 「담당」→ 담당 바꾸기, 「글로」→ 글로 추가, 「미해결」→ 미해결', () => {
  for (const [word, want] of [['점검', 'weekly-check'], ['담당', 'assignee'], ['글로', 'text-add'], ['미해결', 'issues'], ['되감기', 'rewind']]) {
    assert.equal(searchFeatures(word)[0].id, want, word);
  }
});
