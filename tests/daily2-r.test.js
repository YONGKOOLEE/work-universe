// 일상 사용 점검 2회차 R 묶음(2026-10-25, CR-18·CR-19 범위 안의 보완): 가상 데이터만 쓴다.
//   T1 글로 추가 공유 문장(지도 업무 이름 + 결과·내용·현황, 앞 조직 낱말, 업무를 못 정할 때의 이유)  T6 글로 추가 표의 사번 칸(지도의 사번)
//   T2 다시 뽑은 초안의 「새로」(노드·연결 근거는 마지막 수정 기록으로)  T3 최근 이슈의 해결됨 날짜  M8 같은 날 같은 두 사람의 이전 인수인계 이유
//   M5·M7 담당을 넘긴 날: 끝나는 사람은 기준일의 현재 담당이 아니다(밀집·공백·사람 상세·대신할 사람·초안 보내는 사람)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLES } from '../app/data/index.js';
import { createApp } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import { buildView } from '../app/src/view/view.js';
import { addEdge, addNode, updateNode } from '../app/src/model/commands.js';
import {
  defaultSelection, extractFromText, proposalToOps, unreadWhichWorkWhy,
} from '../app/src/rules/text-extract.js';
import { PREVIOUS_SAME_DAY_REASON, buildHandoverDraft } from '../app/src/rules/handover.js';
import { isNewSentence, newSentenceFlags } from '../app/src/rules/draft-new.js';
import { densityGaps, personLoad, similarExperts, workLoad } from '../app/src/rules/insight.js';
import { activeAt } from '../app/src/rules/flow.js';
import { knowledgeConcentration } from '../app/src/rules/insight-risk.js';
import { backupRows } from '../app/src/view/quick-input.js';
import { currentHoldersText, describeNode, edgeStatus, handingOverToday } from '../app/src/view/describe.js';
import { newMarkTitle } from '../app/src/ui/draft.js';
import { textAddDialog } from '../app/src/ui/text-add.js';
import { FakeEl, installDom, uninstallDom } from './dom-stub.js';
import { clone, mkDoc, mkEdge, mkNode, viewOf } from './helpers.js';

const NOW = '2026-10-25T09:00:00+09:00';
const memoryStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const openApp = () => createApp({ store: createStore(memoryStorage()), samples: SAMPLES, currentId: 'U-A1', now: () => NOW });
const view = viewOf('U-A1');
const labelOf = (p, key) => p.nodes.find((n) => n.key === key).label;
const edgeKey = (p, e) => `${labelOf(p, e.from)}>${e.type}>${labelOf(p, e.to)}`;
const edgesOf = (text, v = view) => { const p = extractFromText(text, v); return { p, edges: p.edges.map((e) => edgeKey(p, e)) }; };
const withDom = (fn) => async () => {
  const body = installDom();
  try { await fn(body); } finally { uninstallDom(); }
};

// ── T1: 공유 문장 ────────────────────────────────────────────────────────────

test('T1(a): 「X에게 <지도 업무 이름> 결과를 공유한다」는 그 업무 → X 참조로 읽는다(앞 조직 낱말·어순·결과/내용/현황·공유/전달)', () => {
  const same = ['대사 확인>references>백서진'];
  for (const text of [
    '백서진에게 대사 확인 결과를 공유한다.',
    '감사팀 백서진에게 대사 확인 결과를 공유한다.',
    '대사 확인 결과를 백서진에게 공유한다.',
    '백서진에게 대사 확인 현황을 전달한다.',
    '백서진에게 대사 확인 내용을 공유합니다.',
    '백서진에게 대사 확인 업무 결과를 공유한다.', // 끝말 「업무」는 뗀다
  ]) {
    const { p, edges } = edgesOf(text);
    assert.deepEqual(edges, same, text);
    assert.deepEqual(p.unread, [], text);
    const work = p.nodes.find((n) => n.type === 'work');
    assert.ok(work.match, '업무는 지도에 있는 항목에 이어진다');
    assert.ok(!p.nodes.some((n) => n.type === 'org'), `${text}: 앞 조직은 항목으로 만들지 않는다(허용 낱말로만 쓴다)`);
  }
});

test('T1(a) 안전: 업무 이름이 지도에 없거나, 이름 뒤 낱말이 더 있거나, 부정·날짜·가정이 있으면 읽지 않는다. 지도가 없으면(null) 읽지 않는다', () => {
  for (const text of [
    '백서진에게 월말 마감 보고 결과를 공유한다.', // 지도에 없는 업무
    '백서진에게 대사 확인 결과 초안을 공유한다.', // 이름 뒤에 낱말이 더 있다
    '백서진에게 대사 확인 결과를 공유하지 않는다.',
    '백서진에게 지난달 대사 확인 결과를 공유한다.',
    '백서진에게 대사 확인 결과를 공유하면 된다.',
    '백서진에게 대사 확인 결과를 공유할 예정이다.',
    '백서진에게 대사 확인 결과를 공유한다고 들었다.',
    '대사 확인 백서진에게 결과를 공유한다.', // 업무 이름이 대상을 가로질러 있다
    '백서진에게 대사 확인 결과를 공유하고 싶다.',
  ]) assert.deepEqual(edgesOf(text).edges, [], text);
  assert.deepEqual(extractFromText('백서진에게 대사 확인 결과를 공유한다.', null).edges, [], '지도가 없으면 업무 이름이 지도에 있는지 모른다');
});

test('T1(a) 안전: 처음 체크는 아무것도 없고(none), 「지도에 있는 것만 체크」도 새 사람이 낀 연결은 체크하지 않으며, 지도에 있는 사람이면 체크한다', () => {
  const p = extractFromText('감사팀 백서진에게 대사 확인 결과를 공유한다.', view);
  const doc = clone(SAMPLES.find((d) => d.universe.id === 'U-A1'));
  assert.equal(proposalToOps(p, defaultSelection(p), doc).length, 0, '기본(none)은 저장할 것이 없다');
  const ex = defaultSelection(p, 'existing-only');
  assert.ok(p.edges.every((e) => !ex.edges[e.key].include), '백서진은 지도에 없다 — 체크하지 않는다');
  const known = extractFromText('서하늘에게 대사 확인 결과를 공유한다.', view);
  assert.deepEqual(known.edges.map((e) => edgeKey(known, e)), ['대사 확인>references>서하늘']);
  const exK = defaultSelection(known, 'existing-only');
  assert.ok(known.edges.every((e) => exK.edges[e.key].include || e.exists), '두 끝이 모두 지도에 있고 글이 그렇게 말한다');
});

test('T1(b) 판단: 앞 조직 낱말(감사팀)은 소속(belongs_to)으로 읽지 않고 허용 낱말로만 쓴다 — 조직 항목·소속 연결이 생기지 않는다', () => {
  const p = extractFromText('서하늘이 대사 확인을 맡는다. 감사팀 백서진에게 대사 확인 결과를 공유한다.', view);
  assert.ok(!p.edges.some((e) => e.type === 'belongs_to'));
  assert.ok(!p.nodes.some((n) => n.type === 'org'));
});

test('T1(c): 앞 문장 업무가 둘이라 「결과」의 업무를 정할 수 없으면 읽지 않고 이유를 알려 준다(업무 이름을 넣으라고)', () => {
  const text = '서하늘이 대사 확인을 맡는다. 대사 확인이 끝나면 보고를 한다. 감사팀 백서진에게 결과를 공유한다.';
  const p = extractFromText(text, view);
  assert.equal(p.unread.length, 1);
  assert.equal(p.unread[0], '감사팀 백서진에게 결과를 공유한다.'.replace(/\.$/, ''));
  assert.equal(p.unreadWhy[0], '어느 업무의 결과인지 정할 수 없습니다 — 「대사 확인 결과를 백서진에게 공유한다」처럼 업무 이름을 넣으세요');
  assert.equal(p.unreadWhy[0], unreadWhichWorkWhy('대사 확인', '백서진'));
  assert.ok(!p.edges.some((e) => e.type === 'references'));
  // 앞 문장이 없을 때도(결과만 있고 업무가 없음) 같은 이유
  const alone = extractFromText('백서진에게 결과를 공유한다.', view);
  assert.match(alone.unreadWhy[0], /^어느 업무의 결과인지 정할 수 없습니다 — 「업무 이름 결과를 백서진에게 공유한다」/);
  // 앞 문장 업무가 하나면 예전처럼 이어받는다
  const one = extractFromText('서하늘이 대사 확인을 맡는다. 감사팀 백서진에게 결과를 공유한다.', view);
  assert.ok(one.edges.some((e) => edgeKey(one, e) === '대사 확인>references>백서진'));
});

test('T1: 사실 연결이 아닌 글에서는 업무 이름 읽기가 켜지지 않는다 — 결과 말고 다른 낱말(회의록·자료)은 이 모양이 아니다', () => {
  assert.deepEqual(edgesOf('백서진에게 대사 확인 회의록을 공유한다.').edges, []);
  assert.deepEqual(edgesOf('백서진에게 대사 확인 자료를 공유한다.').edges, []);
});

// ── T6: 사번 칸 ──────────────────────────────────────────────────────────────

function openDialog() {
  const app = openApp();
  const dialog = new FakeEl('dialog');
  dialog.open = false;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.fire('close'); };
  document.body.append(dialog);
  textAddDialog({ dialog, app, getView: () => app.view, aiReady: () => false, readAi: () => null, onSaved: () => {} })();
  const q = (id) => dialog.querySelector(`[data-testid=${id}]`);
  const type = (id, value) => { const e = q(id); e.value = value; e.fire('input'); };
  return { app, dialog, q, type };
}

test('T6 화면: 지도에 있는 사람은 사번 칸에 지도의 사번이 읽기 전용으로 보이고(빈 V-0000 아님), 새 사람의 칸은 입력 칸 그대로', withDom(() => {
  const d = openDialog();
  d.type('text-add-input', '서하늘이 대사 확인을 맡는다.\n백서진에게 대사 확인 결과를 공유한다.');
  d.q('text-add-read').click();
  const rows = [0, 1, 2].map((i) => ({ label: d.q(`text-add-node-label-${i}`).value, emp: d.q(`text-add-node-empno-${i}`) }));
  const known = rows.find((r) => r.label === '서하늘');
  assert.ok(known.emp, '서하늘 행');
  assert.equal(known.emp.value, 'V-1003');
  assert.equal(known.emp.getAttribute('readonly'), '', '읽기 전용');
  assert.notEqual(known.emp.getAttribute('placeholder'), 'V-0000');
  const fresh = rows.find((r) => r.label === '백서진');
  assert.equal(fresh.emp.value, '');
  assert.equal(fresh.emp.getAttribute('readonly'), null, '새 사람은 사번을 쓸 수 있다');
  assert.equal(fresh.emp.getAttribute('placeholder'), 'V-0000');
  assert.equal(rows.find((r) => r.label === '대사 확인').emp, null, '업무 행에는 사번 칸이 없다');
}));

test('T6: 사번이 없는 지도 사람은 칸이 비어 있고 「사번 없음」 안내가 자리표시로, 여전히 읽기 전용', withDom(() => {
  const d = openDialog();
  // 지도에 사번이 없는 사람을 하나 만든다
  const added = d.app.addNode({ core_type: 'person', label: '가상무번호', attrs: {} });
  assert.ok(added.ok, JSON.stringify(added));
  d.type('text-add-input', '가상무번호가 대사 확인을 맡는다.');
  d.q('text-add-read').click();
  const emp = [0, 1].map((i) => d.q(`text-add-node-empno-${i}`)).find((e) => e);
  assert.equal(emp.value, '');
  assert.equal(emp.getAttribute('readonly'), '');
  assert.equal(emp.getAttribute('placeholder'), '사번 없음');
}));

// ── T2: 다시 뽑은 초안의 「새로」 ─────────────────────────────────────────────

const SINCE = '2026-10-24T10:00:00+09:00';
const A1 = SAMPLES.find((d) => d.universe.id === 'U-A1');
const draftOf = (doc) => buildHandoverDraft(buildView(doc), { target: 'U-A1/N-000', from: 'U-A1/N-011', to: 'U-A1/N-012', asOf: '2026-10-25' }).draft;
const flagsOf = (doc) => newSentenceFlags(buildView(doc), draftOf(doc), SINCE);
let seq = 0;
const ctx = (now) => ({ now, random: () => ((seq += 7919) % 1000) / 1000 }); // 같은 값만 돌려주면 새 ID가 겹쳐 끝나지 않는다
const trueTexts = (doc, key) => { const d = draftOf(doc); return d.items.find((i) => i.key === key).sentences.filter((_, i) => flagsOf(doc)[key][i]).map((s) => s.text); };

test('T2: 지난번 초안 뒤에 속성(마감)을 고치면 그 노드가 근거인 문장에 「새로」, 손대지 않은 노드의 문장에는 없다', () => {
  const base = flagsOf(clone(A1));
  assert.ok(Object.values(base).flat().every((x) => x === false), '고치기 전: 샘플의 수정 기록은 모두 지난번 초안보다 앞이다');
  const doc = clone(A1);
  const old = doc.nodes.find((n) => n.id === 'N-001');
  const r = updateNode(doc, 'N-001', { attrs: { ...old.attrs, 마감: '월 마감 후 2영업일 이내' } }, ctx('2026-10-25T08:00:00+09:00'));
  assert.ok(r.ok);
  const flags = flagsOf(r.doc);
  const d = draftOf(r.doc);
  const dl = d.items.find((i) => i.key === '일정_마감').sentences;
  const hit = dl.findIndex((s) => s.text.startsWith('대사 확인') && s.text.includes('2영업일'));
  assert.ok(hit >= 0 && flags.일정_마감[hit], '마감 변경 줄에 새로');
  const other = dl.findIndex((s, i) => !s.evidence_ids.includes('U-A1/N-001') && i !== hit);
  if (other >= 0) assert.equal(flags.일정_마감[other], false, '다른 업무의 마감 줄은 그대로');
  const art = d.items.find((i) => i.key === '산출물_문서').sentences.map((s, i) => [s, i]).filter(([s]) => !s.evidence_ids.includes('U-A1/N-001'));
  for (const [, i] of art) assert.equal(flags.산출물_문서[i], false);
});

test('T2: 새 협업자(새 사람 노드 + 참조 연결)를 넣으면 관계자·연락처의 협업 줄에 「새로」', () => {
  const doc = clone(A1);
  const n = addNode(doc, { core_type: 'person', label: '가상협업', attrs: { 소속: '가상감사팀' } }, ctx('2026-10-25T08:10:00+09:00'));
  assert.ok(n.ok);
  const e = addEdge(n.doc, { source: 'N-001', target: n.node.id, core_type: 'references' }, ctx('2026-10-25T08:10:05+09:00'));
  assert.ok(e.ok, JSON.stringify(e));
  const lines = trueTexts(e.doc, '관계자_연락처');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^협업: 가상협업/);
});

test('T2: 연결(edge)이 근거인 문장도 연결의 created 기록으로 판정한다(순수 판정: 연결 gid)', () => {
  const v = {
    events: [
      { gid: 'U/E-1', type: 'created', recorded_at: '2026-10-25T00:00:00+09:00', universe_id: 'U', payload: { target_kind: 'edge', target_id: 'L-1' } },
      { gid: 'U/E-2', type: 'created', recorded_at: '2026-10-23T00:00:00+09:00', universe_id: 'U', payload: { target_kind: 'edge', target_id: 'L-2' } },
      { gid: 'U/E-3', type: 'hidden', recorded_at: '2026-10-25T00:00:00+09:00', universe_id: 'U', payload: { target_kind: 'node', target_id: 'N-3' } },
    ],
  };
  const s = (...ids) => ({ text: 't', evidence_ids: ids });
  assert.equal(isNewSentence(v, s('U/L-1'), SINCE), true);
  assert.equal(isNewSentence(v, s('U/L-2'), SINCE), false);
  assert.equal(isNewSentence(v, s('U/N-3'), SINCE), false, '숨김은 수정 기록으로 세지 않는다');
  assert.equal(isNewSentence(v, s('U/L-1'), null), false, '처음 만들 때는 표시 없음');
});

test('T2: 「새로」 칩 설명은 지난번 초안의 날짜·시각을 보이고, 읽을 수 없는 시각이면 기본 설명', () => {
  assert.equal(newMarkTitle('2026-10-24T10:00:00+09:00'), '지난번 초안(2026-10-24 10:00) 뒤에 생긴 기록이 근거');
  assert.match(newMarkTitle(null), /지난번에 이 대상으로 초안을 만든 뒤/);
  assert.match(newMarkTitle('garbage'), /지난번에 이 대상으로 초안을 만든 뒤/);
});

// ── T3: 최근 이슈의 해결됨 ──────────────────────────────────────────────────

const memo = (id, at, category, note, extra = {}) => ({ id, type: 'memo', occurred_at: at, recorded_at: `${at}T09:00:00+09:00`, source: 'user', payload: { category, target_id: 'N-001', topic_ids: [], ...extra }, note });
const issueDraft = (events) => buildHandoverDraft(buildView(mkDoc('U-R3', [mkNode('N-001', 'work', '가상 정산'), mkNode('N-010', 'person', '가상보냄'), mkNode('N-011', 'person', '가상받음')],
  [mkEdge('N-000', 'N-001', 'contains')], events)), { target: 'U-R3/N-001', from: 'U-R3/N-010', to: 'U-R3/N-011', asOf: '2026-10-25' }).draft.items.find((i) => i.key === '최근_이슈');

test('T3: 해결된 이슈에는 「(해결됨 날짜)」가 붙고 닫은 해결됨 메모가 근거에 더해지며, 해결 안 된 이슈는 그대로다', () => {
  const it = issueDraft([
    memo('E-001', '2026-10-01', 'issue', '가상 자료가 늦게 올라옴'),
    memo('E-002', '2026-10-05', 'issue', '가상 양식 오류'),
    memo('E-003', '2026-10-08', 'resolved', '해결: 양식 고침', { resolves_id: 'E-002' }),
  ]);
  const texts = it.sentences.map((s) => s.text);
  assert.deepEqual(texts, ['2026-10-05 가상 양식 오류 (해결됨 2026-10-08)', '2026-10-01 가상 자료가 늦게 올라옴']);
  assert.deepEqual(it.sentences[0].evidence_ids, ['U-R3/E-002', 'U-R3/E-003']);
  assert.deepEqual(it.sentences[1].evidence_ids, ['U-R3/E-001']);
});

test('T3: resolves_id 없이 같은 대상의 뒤에 온 해결됨 메모로 닫힌 이슈도 해결됨으로 표시, 가장 먼저 닫은 메모의 날짜', () => {
  const it = issueDraft([
    memo('E-001', '2026-10-01', 'issue', '가상 이슈'),
    memo('E-002', '2026-10-03', 'resolved', '해결'),
    memo('E-003', '2026-10-09', 'resolved', '해결 한 번 더'),
  ]);
  assert.equal(it.sentences[0].text, '2026-10-01 가상 이슈 (해결됨 2026-10-03)');
});

test('T3: 해결됨 메모가 이슈보다 앞서 있거나 다른 메모를 닫는 것이면 표시하지 않는다', () => {
  const it = issueDraft([
    memo('E-001', '2026-10-01', 'resolved', '앞선 해결'),
    memo('E-002', '2026-10-02', 'issue', '가상 이슈'),
    memo('E-003', '2026-10-03', 'issue', '다른 이슈'),
    memo('E-004', '2026-10-04', 'resolved', '해결: 다른 이슈', { resolves_id: 'E-003' }),
  ]);
  const texts = it.sentences.map((s) => s.text);
  assert.deepEqual(texts, ['2026-10-03 다른 이슈 (해결됨 2026-10-04)', '2026-10-02 가상 이슈']);
});

// ── M8: 같은 날 같은 두 사람의 이전 인수인계 ────────────────────────────────

const handoverEv = (id, at) => ({ id, type: 'handover', occurred_at: at, recorded_at: `${at}T09:00:00+09:00`, source: 'user', payload: { work_id: 'N-001', from_person_id: 'N-010', to_person_id: 'N-011' } });
const prevItem = (events, asOf = '2026-10-25') => buildHandoverDraft(buildView(mkDoc('U-R4', [mkNode('N-001', 'work', '가상 정산'), mkNode('N-010', 'person', '가상보냄'), mkNode('N-011', 'person', '가상받음')],
  [mkEdge('N-000', 'N-001', 'contains')], events)), { target: 'U-R4/N-001', from: 'U-R4/N-010', to: 'U-R4/N-011', asOf }).draft.items.find((i) => i.key === '이전_인수인계');

test('M8: 오늘 같은 두 사람 사이에 기록한 인수인계 때문에 비면 「해당 없음」 이유가 붙는다(「이력 부족」이 아님)', () => {
  const it = prevItem([handoverEv('E-001', '2026-10-25')]);
  assert.equal(it.sentences.length, 0);
  assert.equal(it.insufficient, true);
  assert.equal(it.empty_reason, PREVIOUS_SAME_DAY_REASON);
  assert.equal(PREVIOUS_SAME_DAY_REASON, '오늘 같은 두 사람 사이에 기록한 인수인계는 이 인수인계 자체라 빼었습니다');
});

test('M8: 인수인계 기록이 아예 없으면 예전처럼 이력 부족(이유 없음), 다른 날 기록이 남아 있으면 그 문장이 나오고 이유는 없다', () => {
  const none = prevItem([]);
  assert.equal(none.insufficient, true);
  assert.equal(none.empty_reason, undefined);
  const other = prevItem([handoverEv('E-001', '2026-10-25'), handoverEv('E-002', '2026-10-01')]);
  assert.equal(other.sentences.length, 1);
  assert.equal(other.empty_reason, undefined);
  const noAsOf = prevItem([handoverEv('E-001', '2026-10-25')], null);
  assert.equal(noAsOf.sentences.length, 1, '기준일이 없으면 빼지 않는다(예전 규칙 그대로)');
});

// ── M5·M7: 넘긴 날 ──────────────────────────────────────────────────────────

const D = '2026-10-25';
const W1 = 'U-R5/N-001';
const perf = (p, w, period) => mkEdge(p, w, 'performs', { period });
const handDoc = (...edges) => mkDoc('U-R5', [mkNode('N-001', 'work', '가상 정산'), mkNode('N-002', 'work', '가상 보고'), mkNode('N-010', 'person', '가상갑'), mkNode('N-011', 'person', '가상을'), mkNode('N-012', 'person', '가상병')],
  [mkEdge('N-000', 'N-001', 'contains'), mkEdge('N-000', 'N-002', 'contains'), ...edges]);
const handView = (...edges) => buildView(handDoc(...edges));

test('M5·M7 공용 함수: 같은 업무에서 한 사람이 기준일에 끝나고 다른 사람이 기준일에 시작하면 끝나는 쪽만 current가 아니라 ended다', () => {
  const v = handView(perf('N-010', 'N-001', { start: '2026-01-01', end: D }), perf('N-011', 'N-001', { start: D }));
  const [a, b] = v.edges.filter((e) => e.core_type === 'performs');
  assert.equal(edgeStatus(v, a, D), 'ended');
  assert.equal(edgeStatus(v, b, D), 'current');
  assert.equal(edgeStatus(v, a, '2026-10-24'), 'current', '다른 날은 평소 규칙');
  assert.deepEqual([...handingOverToday(v, W1, D)], ['U-R5/N-010'], '표시용 집합은 같은 판정에서 나온다');
});

test('M5·M7: 업무의 현재 담당·초안 보내는 사람 미리 고름(현재 담당이 한 명)·「현재 담당」 글', () => {
  const v = handView(perf('N-010', 'N-001', { start: '2026-01-01', end: D }), perf('N-011', 'N-001', { start: D }));
  const w = workLoad(v, W1, { asOf: D });
  assert.deepEqual(w.current.map((p) => p.label), ['가상을']);
  assert.equal(w.kind, 'covered');
  // 초안 화면은 w.current가 한 명이면 보내는 사람으로 미리 고른다 — 한 명이 되었다
  assert.equal(w.current.length, 1);
  assert.equal(currentHoldersText(v, W1, D, w.current), '가상을 (가상갑은 오늘까지)');
  assert.equal(currentHoldersText(v, W1, D, w.current, { past: true }), '가상을 (가상갑은 그날까지)');
});

test('M5·M7: 사람 상세 「지금 맡은 업무 n개」(personLoad)에서 넘기는 사람은 빠지고 받는 사람은 센다', () => {
  const v = handView(perf('N-010', 'N-001', { start: '2026-01-01', end: D }), perf('N-011', 'N-001', { start: D }), perf('N-010', 'N-002', { start: '2026-01-01' }));
  assert.deepEqual(personLoad(v, 'U-R5/N-010', { asOf: D }).works.map((x) => x.label), ['가상 보고']);
  assert.equal(personLoad(v, 'U-R5/N-011', { asOf: D }).count, 1);
  // 넘기는 날이 아닌 날은 예전 그대로
  assert.equal(personLoad(v, 'U-R5/N-010', { asOf: '2026-10-24' }).count, 2);
});

test('M5·M7: 밀집 판정(N=2)과 공백 판정이 같은 규칙을 쓴다 — 넘기는 사람은 밀집에 안 들고, 받는 사람이 있어 공백이 아니다', () => {
  const v = handView(perf('N-010', 'N-001', { start: '2026-01-01', end: D }), perf('N-010', 'N-002', { start: '2026-01-01' }), perf('N-011', 'N-001', { start: D }), perf('N-011', 'N-002', { start: '2026-02-01' }));
  const r = densityGaps(v, { asOf: D, n: 2 });
  assert.deepEqual(r.dense.map((p) => p.label), ['가상을'], '가상갑은 정산을 넘겨 1개, 가상을은 2개');
  assert.deepEqual(r.gaps, []);
  const before = densityGaps(v, { asOf: '2026-10-24', n: 2 });
  assert.deepEqual(before.dense.map((p) => p.label), ['가상갑'], '넘기기 전날은 가상갑이 두 업무를 모두 맡은 밀집(가상을은 정산을 오늘부터)');
});

test('M5·M7: 받는 사람 없이 끝만 기준일이면(넘김 아님) 그날까지 현재이고, 같은 사람이 이어 쓰면 넘김이 아니다', () => {
  const only = handView(perf('N-010', 'N-001', { start: '2026-01-01', end: D }));
  assert.deepEqual(workLoad(only, W1, { asOf: D }).current.map((p) => p.label), ['가상갑']);
  const same = handView(perf('N-010', 'N-001', { start: '2026-01-01', end: D }), perf('N-010', 'N-001', { start: D }));
  assert.deepEqual(workLoad(same, W1, { asOf: D }).current.map((p) => p.label), ['가상갑']);
  const gap = handView(perf('N-010', 'N-001', { start: '2026-01-01', end: D }), perf('N-011', 'N-001', { start: '2026-10-26' }));
  assert.deepEqual(workLoad(gap, W1, { asOf: D }).current.map((p) => p.label), ['가상갑'], '받는 사람이 다음 날 시작이면 그날까지는 가상갑');
});

test('M5·M7: 기준일이 오늘이 아닌 날(과거 시간 보기)도 같은 규칙, 그날 끝나는 사람은 그날의 현재 담당이 아니다', () => {
  const v = handView(perf('N-010', 'N-001', { start: '2026-01-01', end: '2026-06-30' }), perf('N-011', 'N-001', { start: '2026-06-30', end: '2026-09-30' }), perf('N-012', 'N-001', { start: '2026-09-30' }));
  assert.deepEqual(workLoad(v, W1, { asOf: '2026-06-30' }).current.map((p) => p.label), ['가상을']);
  assert.deepEqual(workLoad(v, W1, { asOf: '2026-09-30' }).current.map((p) => p.label), ['가상병']);
  assert.deepEqual(workLoad(v, W1, { asOf: '2026-08-01' }).current.map((p) => p.label), ['가상을']);
  const detail = describeNode(v, 'U-R5/N-010', { asOf: '2026-06-30', past: true }).links.find((l) => l.relation_type === 'performs');
  assert.equal(detail.status, '그날까지(넘김)');
});

test('M5·M7: 「이 사람 일, 누가 대신할 수 있나」 — 넘기는 사람의 맡은 업무에서 그 업무는 빠지고, 받는 사람의 후보에는 넘긴 사람이 「직접 해 봄」으로 나온다', () => {
  const v = handView(perf('N-010', 'N-001', { start: '2026-01-01', end: D }), perf('N-011', 'N-001', { start: D }));
  assert.deepEqual(backupRows(v, 'U-R5/N-010', { asOf: D }), [], '넘기는 사람은 지금 맡은 업무가 없다');
  const rows = backupRows(v, 'U-R5/N-011', { asOf: D });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].candidates.map((c) => [c.label, c.state]), [['가상갑', 'direct']]);
  const r = similarExperts(v, { works: [W1], asOf: D });
  assert.deepEqual(r.excluded.map((p) => p.label), ['가상을'], '제외(지금 담당)는 받는 사람뿐');
});

test('M5·M7: 흐름 변화의 기준일 활동과 혼자만 아는 일 계산도 같은 규칙(넘기는 사람은 활동 사람이 아니다, 받는 사람은 지금 담당)', () => {
  const v = handView(perf('N-010', 'N-001', { start: '2026-01-01', end: D }), perf('N-011', 'N-001', { start: D }));
  const act = activeAt(v, D);
  assert.ok(act.people.has('U-R5/N-011') && !act.people.has('U-R5/N-010'));
  const k = knowledgeConcentration(v, { asOf: D });
  assert.ok(k.items.every((x) => x.work.gid !== W1), '두 사람이 해 본 업무는 혼자만 아는 일이 아니다');
});
