// 처음 사용 점검 8회차 ② 묶음(FU8-1·2·3·6·7·8·10·11·12·18·19·21·22·24·25·26·27) 단위 검증.
// 화면(DOM·스크린샷)은 tools/browser-check.mjs 「FU8 ②」 블록이 본다. 가상 데이터만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, uninstallDom } from './dom-stub.js';
import { allSamples, viewOf, mkDoc, mkNode, mkEdge } from './helpers.js';
import { mergePlan } from '../app/src/merge/merge.js';
import { mergePanel } from '../app/src/ui/merge.js';
import { decideIdentity } from '../app/src/model/commands.js';
import { validateDocument } from '../app/src/model/validate.js';
import { rewind } from '../app/src/model/rewind.js';
import { BRANCH_DOC, BRANCH_ONLY, BRANCH_WHAT, BRIEF_HANDOVER_HINT, HANDOVER_CHECK_WHAT, successNotice } from '../app/src/view/record-form.js';
import { groupLinks } from '../app/src/view/card.js';
import { inspectionSummaryText, SUMMARY_TOP } from '../app/src/rules/daily-use.js';
import { evidenceChips } from '../app/src/ui/evidence.js';
import { renderWorkspaceNav } from '../app/src/ui/workspace.js';
import { LEGEND_LINES_TEXT } from '../app/src/ui/flow-helpers.js';
import { repeatInefficiency } from '../app/src/rules/insight.js';
import { buildView } from '../app/src/view/view.js';
import { SAMPLE_A1 } from '../app/data/sample-a1.js';
import { addEvent } from '../app/src/model/commands.js';

const all = allSamples();
const q = (root, id) => root.querySelector(`[data-testid=${id}]`);
const qa = (root, id) => root.querySelectorAll(`[data-testid=${id}]`);
const withDom = (fn) => () => {
  installDom();
  try { fn(globalThis.document.body); } finally { uninstallDom(); }
};
const NOW = { now: '2026-10-26T10:00:00+09:00' };
const panel = (extra = {}) => {
  const view = viewOf('U-D1');
  const plan = mergePlan(view, all['U-D1'].identity_links);
  const decided = [];
  const root = mergePanel({ view, plan, links: [], provider: null, readOnly: false, asOf: '2026-10-26', onDecide: (item, st) => decided.push([item.title, st]), onApplyAuto() {}, onFocus() {}, onClose() {}, ...extra });
  return { root, decided, plan };
};

// ── FU8-25: 같은 …은 한 번 묻고, 다른 …은 바로 ──
test('FU8-25 「같은 업무」를 누르면 바로 정해지지 않고 한 번 묻는다. 아니요 → 처음 모습, 이어요 → 판정', withDom((body) => {
  const { root, decided } = panel();
  body.append(root);
  const works = q(root, 'merge-works');
  const row = works.querySelector('[data-testid=merge-same]').parentNode;
  works.querySelector('[data-testid=merge-same]').fire('click');
  assert.deepEqual(decided, [], '누른 것만으로는 판정하지 않는다');
  assert.ok(row.querySelector('[data-testid=merge-confirm-q]').textContent.includes('같은 업무로 이으면 그래프에서 한 항목으로 보입니다. 이을까요?'), row.textContent);
  row.querySelector('[data-testid=merge-same-no]').fire('click');
  assert.deepEqual(decided, []);
  assert.ok(row.querySelector('[data-testid=merge-same]') && row.querySelector('[data-testid=merge-diff]'), '아니요 → 묻는 말과 두 단추로 돌아감');
  row.querySelector('[data-testid=merge-same]').fire('click');
  row.querySelector('[data-testid=merge-same-yes]').fire('click');
  assert.equal(decided.length, 1);
  assert.equal(decided[0][1], 'confirmed');
}));

test('FU8-25 「다른 업무」는 묻지 않고 바로 정한다(「다시 묻기」로 되돌릴 수 있으므로)', withDom((body) => {
  const { root, decided } = panel();
  body.append(root);
  q(root, 'merge-works').querySelector('[data-testid=merge-diff]').fire('click');
  assert.deepEqual(decided.map((d) => d[1]), ['rejected']);
}));

test('FU8-25 사람 쪽 확인 문장은 「같은 사람으로 이으면…」', withDom((body) => {
  const view = viewOf('U-D1');
  const plan = { ...mergePlan(view, []), persons: [{ type: 'conflict', kind: 'person', a: 'U-A1/N-011', b: 'U-B/N-202', title: '사번 충돌: V-1', reason: '확인', evidence_ids: [] }] };
  const root = mergePanel({ view, plan, links: [], provider: null, readOnly: false, onDecide() {}, onApplyAuto() {}, onFocus() {}, onClose() {} });
  body.append(root);
  const same = root.querySelector('[data-testid=merge-persons] [data-testid=merge-same]');
  same.fire('click');
  assert.ok(root.querySelector('[data-testid=merge-persons] [data-testid=merge-confirm-q]').textContent.startsWith('같은 사람으로 이으면 그래프에서 한 항목으로 보입니다.'));
}));

test('FU8-25 읽기 전용이면 판정 단추도 「다시 묻기」도 없다', withDom((body) => {
  const links = [{ id: 'I-9', a: 'U-A1/N-001', b: 'U-B/N-101', kind: 'work', method: 'human', status: 'confirmed', decided_by: '가상', decided_at: '2026-10-25T09:00:00+09:00' }];
  const { root } = panel({ readOnly: true, links, onReask() {} });
  body.append(root);
  assert.equal(qa(root, 'merge-same').length, 0);
  assert.equal(qa(root, 'merge-reask').length, 0);
}));

// ── FU8-25 (b): 「지금까지 고른 답」의 「다시 묻기」 ──
test('FU8-25 사람이 고른 답 줄마다 「다시 묻기」(사번 자동 연결 줄에는 없음). 누르면 그 줄을 넘겨 준다', withDom((body) => {
  const asked = [];
  const links = [
    { id: 'I-1', a: 'U-A1/N-001', b: 'U-B/N-101', kind: 'work', method: 'human', status: 'confirmed', decided_by: '가상', decided_at: '2026-10-25T09:00:00+09:00' },
    { id: 'I-2', a: 'U-K1/N-104', b: 'U-B/N-101', kind: 'work', method: 'human', status: 'rejected', decided_by: '가상', decided_at: '2026-10-25T09:00:00+09:00' },
    { id: 'I-3', a: 'U-A1/N-011', b: 'U-B/N-202', kind: 'person', method: 'emp_no_auto', status: 'confirmed' },
  ];
  const { root } = panel({ links, onReask: (l) => asked.push(l.id) });
  body.append(root);
  assert.equal(root.querySelector('[data-testid=merge-decided]').querySelectorAll('li').length, 3);
  const btns = qa(root, 'merge-reask');
  assert.equal(btns.length, 2, '사람 판정 둘만(사번 자동 제외)');
  btns[1].fire('click');
  assert.deepEqual(asked, ['I-2']);
}));

test('FU8-25 되돌림은 새 명령 없이 decideIdentity(pending): 검증을 통과하고 이력(updated before/after)이 남고, 되감기가 읽는다', () => {
  const base = JSON.parse(JSON.stringify(all['U-D1']));
  base.identity_links = [];
  const asked = decideIdentity(base, { a: 'U-A1/N-001', b: 'U-B/N-101', kind: 'work', method: 'human', status: 'confirmed', decided_by: '가상', reason: '가상 이유', score: 5 }, { now: '2026-10-25T09:00:00+09:00' });
  assert.ok(asked.ok);
  const back = decideIdentity(asked.doc, { a: 'U-A1/N-001', b: 'U-B/N-101', kind: 'work', method: 'human', status: 'pending', reason: '가상 이유', score: 5 }, { now: '2026-10-26T09:00:00+09:00' });
  assert.ok(back.ok, JSON.stringify(back));
  assert.equal(back.doc.identity_links[0].status, 'pending');
  assert.equal(back.doc.identity_links[0].decided_by, undefined, '판정자·시각은 지운다(검증이 pending에는 요구하지 않음)');
  assert.deepEqual(validateDocument(back.doc).errors, []);
  const ev = back.doc.events.at(-1);
  assert.equal(ev.type, 'updated');
  assert.deepEqual([ev.payload.target_kind, ev.payload.before.status, ev.payload.after.status], ['identity_link', 'confirmed', 'pending']);
  // 되감기: 다시 묻기 전 시점으로 가면 confirmed가 돌아온다
  const r = rewind(back.doc, asked.event.recorded_at);
  assert.ok(r.ok);
  assert.equal(r.doc.identity_links[0].status, 'confirmed');
  // 다시 묻기 뒤 후보 목록에 같은 쌍이 다시 오른다
  const view = buildView(back.doc, (x) => (x === back.doc.universe.id ? back.doc : all[x] || null));
  const plan = mergePlan(view, back.doc.identity_links);
  assert.ok(plan.works.some((w) => [w.a, w.b].sort().join() === ['U-A1/N-001', 'U-B/N-101'].sort().join()), 'pending 쌍은 다시 후보에 오른다');
});

// ── FU8-24: 후보 줄에 두 쪽의 지도·맡은 업무·담당 ──
test('FU8-24 업무 후보 줄마다 두 업무의 지도 이름과 지금 담당이 한 줄씩 나온다', withDom((body) => {
  const { root, plan } = panel();
  body.append(root);
  const lists = qa(root, 'merge-sides');
  assert.ok(lists.length >= plan.works.length - 0, '후보마다 한 상자');
  const sides = root.querySelector('[data-testid=merge-works]').querySelector('[data-testid=merge-sides]').querySelectorAll('[data-testid=merge-side]');
  assert.equal(sides.length, 2);
  for (const s of sides) assert.ok(s.textContent.includes('지도 「'), s.textContent);
}));

test('FU8-24 사람 후보 줄에는 지도 이름과 지금 맡은 업무(최대 3)', withDom((body) => {
  const view = viewOf('U-D1');
  const plan = { ...mergePlan(view, []), persons: [{ type: 'conflict', kind: 'person', a: 'U-A1/N-012', b: 'U-B/N-202', title: '사번 충돌', reason: '확인', evidence_ids: [] }] };
  const root = mergePanel({ view, plan, links: [], provider: null, readOnly: false, asOf: '2026-10-26', onDecide() {}, onApplyAuto() {}, onFocus() {}, onClose() {} });
  body.append(root);
  const sides = root.querySelector('[data-testid=merge-persons]').querySelectorAll('[data-testid=merge-side]');
  assert.equal(sides.length, 2);
  assert.ok(sides[0].textContent.includes('지금 맡은 업무: '), sides[0].textContent);
  assert.ok(sides[1].textContent.includes('지도 「'), sides[1].textContent);
}));

// ── FU8-12: 담당 넘기기 알림 ──
test('FU8-12 담당 넘긴 알림에 「수행」이 없고 오늘 끝나는 사람은 「오늘까지」', () => {
  const t = successNotice('assignee', { work: '대사 확인', from: '서하늘', to: '윤바다', when: '2026-10-26', today: '2026-10-26', created: false, handover: false, workGid: 'U/N-1' }).text;
  assert.ok(!t.includes('수행'));
  assert.ok(t.includes('서하늘의 담당은 오늘까지이고 윤바다의 담당은 오늘부터 시작됩니다'), t);
  const past = successNotice('assignee', { work: 'a', from: '가', to: '나', when: '2026-10-20', today: '2026-10-26', created: false, handover: false, workGid: 'U/N-1' }).text;
  assert.ok(past.includes('가의 담당은 2026-10-20까지이고 나의 담당은 2026-10-20부터'), past);
});

test('FU8-12 사람 카드 「연결된 항목」 묶음 머리 글은 「수행」 대신 「담당」(관계 이름·저장 값은 그대로)', () => {
  const links = [
    { relation: '수행', relation_type: 'performs', direction: 'out', other: { label: 'A', type_label: '업무' } },
    { relation: '수행', relation_type: 'performs', direction: 'out', other: { label: 'B', type_label: '업무' } },
    { relation: '소속', relation_type: 'belongs_to', direction: 'out', other: { label: 'T', type_label: '조직' } },
  ];
  const g = groupLinks('person', links);
  assert.equal(g[0].preview, '담당 2 · 소속 1');
  assert.equal(links[0].relation, '수행');
});

// ── FU8-11·10: 담당 넘기기 폼 글 ──
test('FU8-11 담당 넘기기 선택지·체크가 무엇을 남기는지 글이 있다', () => {
  assert.ok(BRANCH_WHAT[BRANCH_ONLY].includes('인수인계서 문서는 만들지 않습니다'));
  assert.ok(BRANCH_WHAT[BRANCH_DOC].includes('인수인계서 문서'));
  assert.ok(HANDOVER_CHECK_WHAT.includes('인수인계」 이력'));
  assert.ok(BRIEF_HANDOVER_HINT.includes('휴가·부재·출장'));
});

// ── FU8-26: 점검 요약 ──
test('FU8-26 점검 요약: all이면 「외 n건」 없이 전부, 아니면 상위만', () => {
  const n = SUMMARY_TOP + 4;
  const d = { mapName: '지도', asOf: '2026-10-26', solo: n, dense: n, gaps: n,
    soloItems: Array.from({ length: n }, (_, i) => ({ work: `업무${i}`, person: `사람${i}`, level: 'high' })),
    denseItems: Array.from({ length: n }, (_, i) => ({ person: `사람${i}`, count: 4 })),
    gapItems: Array.from({ length: n }, (_, i) => ({ work: `공백${i}` })) };
  const short = inspectionSummaryText(d, null);
  assert.ok(short.includes('외 4건'));
  const full = inspectionSummaryText(d, null, { all: true });
  assert.ok(!full.includes('외 4건') && !/외 \d+건/.test(full));
  for (let i = 0; i < n; i += 1) assert.ok(full.includes(`「업무${i}」`) && full.includes(`사람${i} (4개 담당)`) && full.includes(`「공백${i}」`));
});

// ── FU8-27: 반복 비효율 근거 글 ──
test('FU8-27 이전 인수인계 참조로 이어받은 줄은 「인수인계서 없음 — 이전 인수인계서를 이어받음」 모순이 아니라 근거를 푼 글', () => {
  const doc = JSON.parse(JSON.stringify(SAMPLE_A1));
  doc.events.find((e) => e.id === 'E-007').payload.previous_handover_id = 'E-002';
  // 이어받았으면 패턴이 없으므로 세 번째 인수인계를 더해 패턴이 나오게 한다(두 번째는 이어받음, 세 번째는 이어받지 않음)
  const d3 = addEvent(doc, { type: 'handover', occurred_at: '2026-12-01', payload: { work_id: 'N-001', from_person_id: 'N-012', to_person_id: 'N-010' } }, NOW).doc;
  const p = repeatInefficiency(buildView(d3)).patterns.find((x) => x.kind === 'handover_chain');
  assert.ok(p, '세 번째가 이어받지 않아 패턴이 있다');
  const second = p.steps[1];
  assert.equal(second.referenced, true);
  assert.ok(second.text.includes('(인수인계서 없음)'));
  assert.ok(!second.text.includes('이전 인수인계서를 이어받음'), second.text);
  assert.ok(second.text.includes('앞 인수인계 기록을 이어받음') && second.text.includes('이전 인수인계 참조'), second.text);
  assert.ok(p.steps[2].text.endsWith('이전 인수인계서를 이어받지 않음'));
});

// ── FU8-21: 사람 칩은 하나 ──
test('FU8-21 onCard가 있으면 사람 이름 칩 하나가 카드를 연다(「카드」 링크 따로 없음). 업무 칩은 그대로', withDom((body) => {
  const view = buildView(mkDoc('U-T', [mkNode('N-P1', 'person', '김가상'), mkNode('N-W1', 'work', '대사 확인')], []), () => null);
  const opened = [];
  const list = evidenceChips(view, ['U-T/N-P1', 'U-T/N-W1'], () => {}, { tag: 'div', showText: true, onCard: (g) => opened.push(g) });
  body.append(list);
  const cards = qa(list, 'evidence-card');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].textContent, '김가상');
  assert.equal(list.querySelectorAll('button').length, 2, '사람 1 + 업무 1 = 단추 둘뿐');
  cards[0].fire('click');
  assert.deepEqual(opened, ['U-T/N-P1']);
}));

// ── FU8-2: 메뉴 숫자 옆 낱말 ──
test('FU8-2 메뉴 숫자 배지에 낱말(data-word)이 붙고 숫자 글은 그대로', withDom((body) => {
  const nav = globalThis.document.createElement('nav');
  body.append(nav);
  renderWorkspaceNav(nav, { current: 'map', badges: { record: 3, check: 2 }, onPick() {} });
  assert.equal(q(nav, 'ws-badge-record').textContent, '3');
  assert.equal(q(nav, 'ws-badge-record').getAttribute('data-word'), '미해결');
  assert.equal(q(nav, 'ws-badge-check').getAttribute('data-word'), '혼자만 아는 일');
}));

test('FU8-12 업무 카드 「담당」 묶음 머리 글: 넘긴 날 끝나는 사람은 「지금」에 세지 않고 「오늘까지」로 따로(줄 세우기는 그대로)', () => {
  const mk = (label, key, status, end = '') => ({ relation: '수행', relation_type: 'performs', direction: 'in', status_key: key, status, period_end: end, other: { label, type_label: '사람' } });
  const g = groupLinks('work', [mk('가상대리', 'current', '현재'), mk('서하늘', 'handover', '오늘까지(넘김)', '2026-10-26'), mk('윤바다', 'ended', '종료', '2026-09-30'), mk('한가람', 'ended', '종료', '2026-05-31')]);
  assert.equal(g[0].key, 'assign');
  assert.equal(g[0].preview, '지금 1 · 오늘까지 1 · 지난 2');
  assert.deepEqual(g[0].items.map((l) => l.other.label), ['가상대리', '서하늘', '윤바다', '한가람'], '지금·넘김 → 지난 순서 그대로');
  const past = groupLinks('work', [mk('가', 'handover', '그날까지(넘김)', '2026-10-20'), mk('나', 'current', '현재')]);
  assert.equal(past[0].preview, '지금 1 · 그날까지 1');
});

// ── FU8-3·18: 선 이름 뜻 ──
test('FU8-3·18 범례 선 이름 글에 선후행·산출·참조·관련·수행의 뜻', () => {
  for (const w of ['선후행 = 앞뒤 순서', '산출 = 만든 문서', '참조 = 참고', '관련 = 연관', '수행 = 담당']) assert.ok(LEGEND_LINES_TEXT.includes(w), w);
});
