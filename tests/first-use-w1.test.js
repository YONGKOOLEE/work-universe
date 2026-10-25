// 처음 사용 점검(2026-10-24, docs/first-use-2026-10-24.md) W1 몫: 초안·따라 하기 쪽 FU-2·3·7·8·14·17·20과 조사 FU-18·19의 근거.
// DOM 흉내(tests/dom-stub.js)로 초안 화면을 돌린다. 실제 브라우저 점검(tools/browser-check.mjs 「처음 사용 W1」)을 대신하지 않는다. 가상 데이터만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PREGEN } from '../app/data/pregen.js';
import { buildView } from '../app/src/view/view.js';
import { buildHandoverDraft, HANDOVER_ITEMS } from '../app/src/rules/handover.js';
import { scenarioOf, teamScenario } from '../app/src/rules/tour-steps.js';
import { createProvider } from '../app/src/llm/providers.js';
import { allowedRelations, pairAllowed } from '../app/src/model/schema.js';
import { messageFor } from '../app/src/ui/messages.js';
import { ADD_PERSON_HELP, draftPanel, forgetLastPeople } from '../app/src/ui/draft.js';
import { FILL_HINTS, choosePeople, fillHintOf, findPresetTarget, needsPersonHelp, recall, remember } from '../app/src/ui/draft-hints.js';
import { PREGEN_ASOF } from '../tools/pregen-scenarios.mjs';
import { mkDoc, mkEdge, mkNode, viewOf } from './helpers.js';
import { installDom, uninstallDom } from './dom-stub.js';

const ASOF = PREGEN_ASOF; // 사전 생성 문장이 만들어진 기준일(U-A1 조합이 맞아야 한다)
const pregen = createProvider('pregen', { pregen: PREGEN });

// ── 가상 문서 ──
// 루트(N-000)와 업무 W 하나, 사람 P1·P2(선택으로 P3·조직 O). 업무는 설명·속성 없음 → 대부분 항목이 이력 부족
function smallDoc({ id = 'U-W1A', persons = 2, withOrg = false, workAttrs = {}, workDescription = '' } = {}) {
  const nodes = [mkNode('N-001', 'work', '점검', { description: workDescription, attrs: workAttrs })];
  const edges = [mkEdge('N-000', 'N-001', 'contains')];
  for (let i = 1; i <= persons; i += 1) nodes.push(mkNode(`N-10${i}`, 'person', `가상인${i}`));
  if (withOrg) {
    nodes.push(mkNode('N-200', 'org', '가상팀'));
    edges.push(mkEdge('N-200', 'N-001', 'references'));
  }
  return mkDoc(id, nodes, edges);
}
const gid = (doc, n) => `${doc.universe.id}/${n}`;
const viewOfDoc = (doc) => buildView(doc, () => null);

function openDraft(view, over = {}) {
  const body = installDom();
  const events = [];
  globalThis.document.dispatchEvent = (e) => { events.push(e); return true; };
  const panel = draftPanel({ view, provider: pregen, asOf: ASOF, onFocus() {}, onClose() {}, ...over });
  body.append(panel);
  const q = (id) => panel.querySelector(`[data-testid=${id}]`);
  const submit = () => q('draft-form').fire('submit');
  return { q, qa: (sel) => panel.querySelectorAll(sel), submit, events, panel };
}
const withDom = (fn) => async () => {
  forgetLastPeople();
  try { await fn(); } finally { uninstallDom(); forgetLastPeople(); }
};

// ── FU-8: 「채우려면」 ──
test('FU-8: 「채우려면」 표는 초안 11개 항목의 key를 빠짐없이, 군더더기 없이 덮는다', () => {
  assert.deepEqual(Object.keys(FILL_HINTS).sort(), HANDOVER_ITEMS.map((i) => i.key).sort());
  for (const { key } of HANDOVER_ITEMS) {
    assert.match(fillHintOf(key), /^채우려면: .+/);
    assert.ok(FILL_HINTS[key].length > 10, key);
  }
  assert.equal(fillHintOf('없는_항목'), null);
  assert.equal(fillHintOf('toString'), null); // 프로토타입 이름을 항목으로 읽지 않는다
});

test('FU-8: 문구가 규칙이 실제로 세는 것과 맞다 — 관계자는 「수행」만, 산출물은 「산출」, 진행 중·이슈·주의사항은 메모 분류', () => {
  assert.match(FILL_HINTS.관계자_연락처, /「수행」\(사람 → 업무\)/);
  assert.match(FILL_HINTS.관계자_연락처, /「참조」/); // CR-17 F: 협업자도 센다(예전: 「참조」는 세지 않습니다)
  assert.doesNotMatch(FILL_HINTS.관계자_연락처, /세지 않습니다/);
  assert.match(FILL_HINTS.산출물_문서, /「산출」\(만든 문서\) 또는 「참조」\(참고한 문서\)\(업무 → 산출물\)/); // CR-17 J ⑩: 참조도 읽는다
  assert.match(FILL_HINTS.산출물_문서, /「위치」/);
  assert.match(FILL_HINTS.진행_중, /분류 「진행 중」/);
  assert.match(FILL_HINTS.최근_이슈, /분류 「이슈」/);
  assert.match(FILL_HINTS.주의사항, /「주의사항」/);
  assert.match(FILL_HINTS.일정_마감, /「주기」.*「마감」/);
  assert.match(FILL_HINTS.유사_경험자, /「관련」.*「산출」/);
  // 쓰인 연결 이름이 실제 연결 허용 조합과 맞는다: 사람 → 업무 수행, 업무 → 산출물 산출, 업무 → 주제 관련
  assert.equal(pairAllowed('performs', 'person', 'work'), true);
  assert.equal(pairAllowed('produces', 'work', 'artifact'), true);
  assert.equal(pairAllowed('references', 'work', 'artifact'), true);
  assert.equal(pairAllowed('relates_to', 'work', 'topic'), true);
});

test('FU-8: 이력 부족 항목마다 draft-fill-hint가 붙고, 내용이 있는 항목에는 붙지 않는다', withDom(() => {
  const doc = smallDoc();
  const { q, qa, submit } = openDraft(viewOfDoc(doc), { preset: undefined });
  q('draft-target').value = gid(doc, 'N-000');
  q('draft-from').value = gid(doc, 'N-101');
  q('draft-to').value = gid(doc, 'N-102');
  submit();
  const insufficient = qa('[data-testid=insufficient]');
  const hints = qa('[data-testid=draft-fill-hint]');
  assert.ok(insufficient.length >= 6);
  assert.equal(hints.length, insufficient.length);
  const section = q('draft-item-관계자_연락처');
  assert.ok(section.querySelector('[data-testid=insufficient]'));
  assert.equal(section.querySelector('[data-testid=draft-fill-hint]').textContent, fillHintOf('관계자_연락처'));
  // 세부 업무·절차에는 업무 이름이 나오므로 이력 부족이 아니다 → 안내 없음
  assert.equal(q('draft-item-세부_업무_절차').querySelector('[data-testid=draft-fill-hint]'), null);
}));

// ── FU-18·19 조사의 근거 → CR-17 F·G로 규칙을 바꿈(2026-10-24, 승인 전 초안 브랜치) ──
test('FU-18(CR-17 F로 바뀜): 조직·사람을 업무에 「참조」로 이으면 「관계자·연락처」에 협업자로 나온다 — 이으지 않으면 여전히 이력 부족', () => {
  const doc = smallDoc({ persons: 3, withOrg: true });
  const view = viewOfDoc(doc);
  const input = { target: gid(doc, 'N-000'), from: gid(doc, 'N-101'), to: gid(doc, 'N-102'), asOf: ASOF };
  const key = (r) => r.draft.items.find((i) => i.key === '관계자_연락처');
  // 조직(N-200)이 업무를 「참조」로 이은 문서: 이제 협업자로 센다(예전에는 이력 부족이었다)
  const org = key(buildHandoverDraft(view, input));
  assert.equal(org.insufficient, false);
  assert.match(org.sentences[0].text, /^협업: 가상팀 — 참조 점검/);
  // 아무도 잇지 않으면 이력 부족
  const none = mkDoc(doc.universe.id, doc.nodes.filter((n) => n.id !== 'N-000' && n.id !== 'N-200'), doc.edges.filter((e) => e.source !== 'N-200'));
  assert.equal(key(buildHandoverDraft(viewOfDoc(none), input)).insufficient, true);
  // 보내는·받는 사람이 아닌 사람을 「수행」으로 이어도 센다
  const viaPerforms = mkDoc(doc.universe.id, none.nodes.filter((n) => n.id !== 'N-000'), [...none.edges, mkEdge('N-103', 'N-001', 'performs')]);
  const hit = key(buildHandoverDraft(viewOfDoc(viaPerforms), input));
  assert.equal(hit.insufficient, false);
  assert.match(hit.sentences[0].text, /가상인3/);
});

test('FU-19(CR-17 G로 바뀜): 대상이 업무이고 「절차」나 「사용 시스템」이 있으면 「세부 업무·절차」 대상 줄에는 설명 없이 절차·시스템만 나온다', () => {
  const doc = smallDoc({ workDescription: '매월 말 자료를 모아 대조한다', workAttrs: { 절차: '수집 후 대조' } });
  const view = viewOfDoc(doc);
  const base = { from: gid(doc, 'N-101'), to: gid(doc, 'N-102'), asOf: ASOF };
  const item = (r, k) => r.draft.items.find((i) => i.key === k).sentences.map((s) => s.text).join('|');
  const withAttr = buildHandoverDraft(view, { ...base, target: gid(doc, 'N-001') });
  assert.match(item(withAttr, '업무_개요'), /매월 말 자료를 모아 대조한다/);
  assert.equal(item(withAttr, '세부_업무_절차'), '점검 / 절차: 수집 후 대조'); // 예전: '점검 — 매월 말 자료를 모아 대조한다 / 절차: 수집 후 대조'
  // 절차·사용 시스템이 없으면 대상 업무 자신은 세부에서 빠진다(개요에만)
  const plain = smallDoc({ workDescription: '매월 말 자료를 모아 대조한다' });
  const r2 = buildHandoverDraft(viewOfDoc(plain), { ...base, target: gid(plain, 'N-001') });
  assert.equal(r2.draft.items.find((i) => i.key === '세부_업무_절차').insufficient, true);
});

// ── FU-2: 따라 하기 예시 대상 ──
test('FU-2: 따라 하기 preset에 대상이 있고(이름), 초안 화면이 그 대상을 고른다 — 업무를 골라 열어도 지도 전체가 된다', withDom(() => {
  const { preset } = scenarioOf('handover').steps[2];
  assert.equal(preset.target, '월말 정산 점검');
  const view = viewOf('U-A1');
  // 「대사 확인」(N-001) 상세에서 열린 것처럼 target을 업무로 주어도 preset 대상이 이긴다
  const { q, qa, submit } = openDraft(view, { target: 'U-A1/N-001', preset });
  assert.equal(q('draft-target').value, 'U-A1/N-000');
  assert.equal(q('draft-from').value, 'U-A1/N-011');
  assert.equal(q('draft-to').value, 'U-A1/N-012');
  submit();
  assert.equal(q('draft-method').textContent.includes('사전 생성'), true);
  const chips = qa('[data-testid=item-method]').map((c) => c.textContent);
  assert.ok(chips.length >= 6 && chips.every((t) => t === '사전 생성'), chips.join());
  assert.equal(q('draft-rule-reason'), null);
}));

test('FU-2: findPresetTarget — 이름 또는 gid로 찾고, 없으면 null', () => {
  const targets = [{ gid: 'U-A1/N-000', label: '월말 정산 점검' }, { gid: 'U-A1/N-001', label: '대사 확인' }];
  assert.equal(findPresetTarget(targets, '월말 정산 점검').gid, 'U-A1/N-000');
  assert.equal(findPresetTarget(targets, 'U-A1/N-001').gid, 'U-A1/N-001');
  assert.equal(findPresetTarget(targets, '없는 이름'), null);
  assert.equal(findPresetTarget(targets, undefined), null);
  assert.equal(findPresetTarget(targets, ''), null);
});

// ── FU-3 ──
test('FU-3: 사전 생성인데 미리 써 둔 조합이 없으면 실패처럼 읽히지 않는 문구(규칙 기반 설명)가 나온다', withDom(() => {
  const view = viewOf('U-A1');
  const { q, submit } = openDraft(view, {});
  q('draft-target').value = 'U-A1/N-000';
  q('draft-from').value = 'U-A1/N-012'; // 방향을 바꾼 조합 — 미리 써 둔 문장 없음
  q('draft-to').value = 'U-A1/N-011';
  submit();
  const note = q('draft-rule-reason');
  assert.ok(note);
  assert.equal(note.textContent, '이 조합(대상·보내는·받는 사람)에는 미리 써 둔 문장이 없어, 기록을 그대로 모아 만든 초안입니다(규칙 기반). 문장마다 근거가 붙어 있습니다.');
  assert.doesNotMatch(note.textContent, /실패|못했|오류|없어 규칙 기반으로 만들었/);
}));

// ── FU-7 ──
// 2회차 FU-36(처음 사용 점검 2026-10-24): 「＋ 사람 추가」는 긴 노드 추가 창으로 바로 가지 않고 초안 창 안의 작은 칸을 먼저 연다 → 알림은 「넣기」에서 label과 함께 간다 (옛 기대: 누르면 바로 {type:'person'} 알림)
test('FU-7·FU-36: 사람이 하나뿐인 지도 — 창을 열 때부터 안내와 「＋ 사람 추가」가 보이고, 누르면 작은 칸이 열리며 「넣기」에서 wu:add-node(사람, 이름) 알림을 보낸다', withDom(() => {
  const doc = smallDoc({ persons: 1 });
  const { q, events } = openDraft(viewOfDoc(doc));
  const help = q('draft-person-help');
  assert.equal(help.hidden, false);
  assert.ok(help.textContent.includes(ADD_PERSON_HELP));
  assert.equal(ADD_PERSON_HELP, '후임이 목록에 없으면 사람으로 먼저 넣으세요. 연결하지 않아도 받는 사람으로 고를 수 있습니다(「수행」으로 이으면 현재 담당으로 보입니다).');
  const btn = q('draft-add-person');
  assert.equal(btn.textContent, '＋ 사람 추가');
  assert.equal(btn.getAttribute('type'), 'button');
  assert.equal(q('draft-new-person').hidden, true);
  btn.click();
  assert.equal(events.length, 0); // 누르기만으로는 알림을 보내지 않는다
  assert.equal(q('draft-new-person').hidden, false);
  q('draft-new-person-add').click(); // 이름이 비면 안내만
  assert.equal(events.length, 0);
  assert.equal(q('draft-new-person-msg').textContent, '이름을 적으세요.');
  q('draft-new-person-name').value = ' 새후임 ';
  q('draft-new-person-add').click();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'wu:add-node');
  assert.deepEqual(events[0].detail, { type: 'person', label: '새후임', attrs: undefined });
}));

test('FU-7: 사람이 없는 지도에서도 안내가 보이고, 읽기 전용이면 단추 없이 안내만', withDom(() => {
  const doc = smallDoc({ persons: 0 });
  const a = openDraft(viewOfDoc(doc));
  assert.equal(a.q('draft-person-help').hidden, false);
  assert.ok(a.q('draft-add-person'));
  uninstallDom();
  const b = openDraft(viewOfDoc(doc), { readOnly: true });
  assert.equal(b.q('draft-person-help').hidden, false);
  assert.equal(b.q('draft-add-person'), null);
}));

test('FU-7: 사람이 충분하면 안내가 숨어 있다가, 받는 사람 누락·같은 사람 오류 때 나타난다', withDom(() => {
  const doc = smallDoc({ persons: 3 });
  const { q, submit } = openDraft(viewOfDoc(doc));
  assert.equal(q('draft-person-help').hidden, true);
  q('draft-target').value = gid(doc, 'N-000');
  q('draft-from').value = gid(doc, 'N-101');
  q('draft-to').value = '';
  submit();
  assert.ok(q('draft-message').textContent.includes('받는 사람')); // 기존 오류 문구 그대로
  assert.equal(q('draft-person-help').hidden, false);
  // 정상으로 만들면 다시 숨는다
  q('draft-to').value = gid(doc, 'N-102');
  submit();
  assert.equal(q('draft-person-help').hidden, true);
  // 같은 사람
  q('draft-to').value = gid(doc, 'N-101');
  submit();
  assert.ok(q('draft-message').textContent.includes('같습니다'));
  assert.equal(q('draft-person-help').hidden, false);
}));

test('FU-7: needsPersonHelp — 사람 둘 미만이거나 보내는 사람을 빼면 후보가 없을 때', () => {
  const p = (g) => ({ gid: g });
  assert.equal(needsPersonHelp([], ''), true);
  assert.equal(needsPersonHelp([p('a')], ''), true);
  assert.equal(needsPersonHelp([p('a'), p('b')], ''), false);
  assert.equal(needsPersonHelp([p('a'), p('b')], 'a'), false);
  assert.equal(needsPersonHelp([p('a'), p('a')], 'a'), true);
});

// ── FU-17 ──
test('FU-17: 같은 지도에서 초안을 다시 열면 마지막 보내는·받는 사람이 골라져 있고, 예시(preset)가 있으면 예시가 이긴다', withDom(() => {
  const doc = smallDoc({ persons: 3 });
  const view = viewOfDoc(doc);
  const first = openDraft(view);
  assert.equal(first.q('draft-from').value, '');
  assert.equal(first.q('draft-to').value, '');
  first.q('draft-target').value = gid(doc, 'N-000');
  first.q('draft-from').value = gid(doc, 'N-102');
  first.q('draft-to').value = gid(doc, 'N-103');
  first.submit();
  uninstallDom();
  const second = openDraft(view);
  assert.equal(second.q('draft-from').value, gid(doc, 'N-102'));
  assert.equal(second.q('draft-to').value, gid(doc, 'N-103'));
  uninstallDom();
  const third = openDraft(view, { preset: { from: '가상인1', to: '가상인2' } });
  assert.equal(third.q('draft-from').value, gid(doc, 'N-101'));
  assert.equal(third.q('draft-to').value, gid(doc, 'N-102'));
}));

test('FU-17: 오류로 만들지 못한 선택은 기억하지 않고, 다른 지도에는 번지지 않는다', withDom(() => {
  const docA = smallDoc({ id: 'U-W1A', persons: 3 });
  const docB = smallDoc({ id: 'U-W1B', persons: 3 });
  const a = openDraft(viewOfDoc(docA));
  a.q('draft-target').value = gid(docA, 'N-000');
  a.q('draft-from').value = gid(docA, 'N-101');
  a.q('draft-to').value = gid(docA, 'N-101'); // 같은 사람 → 오류
  a.submit();
  uninstallDom();
  assert.equal(openDraft(viewOfDoc(docA)).q('draft-from').value, '');
  uninstallDom();
  const ok = openDraft(viewOfDoc(docA));
  ok.q('draft-target').value = gid(docA, 'N-000');
  ok.q('draft-from').value = gid(docA, 'N-101');
  ok.q('draft-to').value = gid(docA, 'N-102');
  ok.submit();
  uninstallDom();
  const other = openDraft(viewOfDoc(docB));
  assert.equal(other.q('draft-from').value, '');
  assert.equal(other.q('draft-to').value, '');
}));

test('FU-17: choosePeople·remember — 예시 > 기억 > 비움, 목록에 없는 기억은 무시, 같은 사람이면 받는 사람 비움', () => {
  const people = [{ gid: 'U/N-1', label: '가' }, { gid: 'U/N-2', label: '나' }, { gid: 'U/N-3', label: '다' }];
  assert.deepEqual(choosePeople({ people, preset: null, remembered: null }), { from: null, to: null });
  assert.deepEqual(choosePeople({ people, preset: null, remembered: { from: 'U/N-1', to: 'U/N-2' } }), { from: 'U/N-1', to: 'U/N-2' });
  assert.deepEqual(choosePeople({ people, preset: { from: '다', to: '나' }, remembered: { from: 'U/N-1', to: 'U/N-2' } }), { from: 'U/N-3', to: 'U/N-2' });
  assert.deepEqual(choosePeople({ people, preset: { from: '없는 사람', to: '나' }, remembered: { from: 'U/N-1', to: 'U/N-3' } }), { from: 'U/N-1', to: 'U/N-2' });
  assert.deepEqual(choosePeople({ people, preset: null, remembered: { from: 'U/N-9', to: 'U/N-2' } }), { from: null, to: 'U/N-2' });
  assert.deepEqual(choosePeople({ people, preset: null, remembered: { from: 'U/N-1', to: 'U/N-1' } }), { from: 'U/N-1', to: null });
  const m = new Map();
  remember(m, 'U-1', 'U/N-1', 'U/N-2');
  remember(m, '', 'x', 'y');
  remember(m, 'U-2', 'U/N-1', '');
  assert.deepEqual([...m.keys()], ['U-1']);
  assert.deepEqual(recall(m, 'U-1'), { from: 'U/N-1', to: 'U/N-2', fromName: '', toName: '' });
  remember(m, 'U-3', 'U/N-1', 'U/N-2', { from: '가', to: '나' });
  assert.deepEqual(recall(m, 'U-3'), { from: 'U/N-1', to: 'U/N-2', fromName: '가', toName: '나' });
  assert.equal(recall(m, 'U-9'), null);
});

// ── FU-20 ──
test('FU-20: 「관련」 연결이 주제 아닌 노드에 걸려 거절되면 무엇을 고르면 되는지 덧붙는다', () => {
  const source = { label: '월말 정산 점검', core_type: 'work' };
  const target = { label: '서하늘', core_type: 'person' };
  const text = messageFor({ code: 'E-PAIR' }, { kind: 'edge', relation: 'relates_to', source, target, suggestions: allowedRelations('work', 'person') });
  assert.match(text, /「관련」은 지도 중심 외 모든 항목 → 주제만 가능합니다\./); // 기존 문구는 그대로 // CR-18-2
  assert.match(text, /사람을 업무에 이으려면 「수행」\(사람 → 업무\)/);
  assert.match(text, /「산출」\(업무 → 산출물\)/);
  assert.match(text, /「참조」/);
  assert.match(text, /「관련」은 대상이 주제 항목일 때만 씁니다\.$/); // CR-18-2
  // 노드 정보가 없을 때도 같은 안내
  assert.match(messageFor({ code: 'E-PAIR' }, { kind: 'edge', relation: 'relates_to' }), /사람을 업무에 이으려면 「수행」/);
  // 다른 관계의 거절 문구는 바뀌지 않는다
  assert.doesNotMatch(messageFor({ code: 'E-PAIR' }, { kind: 'edge', relation: 'belongs_to', source, target, suggestions: [] }), /무엇을 고르면 되나/);
  // 안내한 조합은 실제로 허용된다
  assert.equal(pairAllowed('performs', 'person', 'work'), true);
  assert.equal(pairAllowed('produces', 'work', 'artifact'), true);
  assert.equal(pairAllowed('references', 'person', 'work'), true);
  assert.equal(pairAllowed('relates_to', 'person', 'work'), false);
});

// ── FU-14 ──
// 2회차 FU-33이 팀 순서를 위험 요약 먼저(risk-first)로 바꿨으나 승인된 D-29는 "마지막은 내용이 있는 반복 비효율 탭"이라 R11-11에서 기본을 D-29 판으로 되돌렸다.
// 두 판 모두 단계 수 5. 기본은 위험 요약 먼저(CR-17 K 승인), D-29 판은 상수 TEAM_ORDER만 'd29'로. tests/w10-screen.test.js가 두 판의 완료 조건을 고정한다
test('FU-14·FU-33·R11-11·CR-17 K: 팀 따라 하기 순서 — 기본은 위험 요약 먼저, D-29 판(펼치기 → 찾기 → 주변만 → 전체 보기 → 인사이트)은 상수만 바꾸면', () => {
  const steps = teamScenario('d29').steps;
  assert.deepEqual(steps.map((s) => s.id), ['expand', 'find', 'neighborhood', 'full', 'insight']);
  assert.equal(steps.length, 5);
  assert.match(steps[4].task, /「반복 비효율」 탭을 누르세요/);
  // CR-22 W: 기본은 'weekly'(위험 요약 → 이번 점검 저장 → 점검 요약 → 펼치기 → 찾기). 위험 요약 먼저 판(risk-first)은 예전 판으로 남는다
  const riskFirst = scenarioOf('team').steps;
  assert.deepEqual(riskFirst.map((s) => s.id), teamScenario('weekly').steps.map((s) => s.id), '기본 = weekly');
  assert.deepEqual(riskFirst.map((s) => s.id), ['risk', 'save', 'summary', 'expand', 'find']);
  assert.deepEqual(teamScenario('risk-first').steps.map((s) => s.id), ['risk', 'expand', 'find', 'neighborhood', 'full']);
  assert.match(riskFirst[0].task, /「혼자만 아는 일 …」 줄의 「자세히」/);
  assert.match(riskFirst[0].task, /한 사람만 해 봤고 인수인계 기록이 없는 일/);
});
