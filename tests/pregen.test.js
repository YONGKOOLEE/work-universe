// T-12 LLM 연결부(공급자 4종 + 실패 흉내)와 사전 생성 결과(CR-1, R-15, R-04, 12.3)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PREGEN } from '../app/data/pregen.js';
import { SAMPLE_A1 } from '../app/data/sample-a1.js';
import { addEvent } from '../app/src/model/commands.js';
import { createUniverse, addNode } from '../app/src/model/commands.js';
import { buildView } from '../app/src/view/view.js';
import { buildHandoverDraft } from '../app/src/rules/handover.js';
import { createProvider, itemEvidence, peopleKey, pregenKey, PROVIDERS, DEFAULT_PROVIDER } from '../app/src/llm/providers.js';
import { explainInsight, refineDraft } from '../app/src/llm/connector.js';
import { CANDIDATE_VIEWS, EXPLAIN_SCENARIOS, HANDOVER_SCENARIOS, candidateRequestsOf, explainRequestOf, handoverDraftOf, viewOf } from '../tools/pregen-scenarios.mjs';

const pregen = createProvider('pregen', { pregen: PREGEN });
const existsIn = (v) => (gid) => v.lookup(gid).found || v.events.some((e) => e.gid === gid);
const ctx = { now: '2026-10-02T10:00:00+09:00' };

test('공급자 목록: 사전 생성(기본)·없음·Claude API·사내 LLM + 점검용 실패 흉내(R-15 CR-1)', () => {
  assert.deepEqual(PROVIDERS.map((p) => p.name), ['pregen', 'none', 'claude_api', 'internal', 'fail']);
  assert.equal(DEFAULT_PROVIDER, 'pregen');
  assert.equal(createProvider('none'), null);
});

test('사전 생성 결과는 낡지 않았다: 시연 초안의 모든 항목(이력 부족 제외)에 결과가 있고 조회 키가 맞는다', () => {
  for (const s of HANDOVER_SCENARIOS) {
    const { view, draft } = handoverDraftOf(s);
    const r = refineDraft(draft, { provider: pregen, exists: existsIn(view) });
    const expected = draft.items.filter((i) => !i.insufficient).length;
    assert.equal(r.counts.provider, expected, `${s.id}: ${r.items.filter((i) => !i.insufficient && i.method !== 'pregen').map((i) => i.key)}`);
    assert.equal(r.method, 'pregen');
    assert.equal(r.fallback, null, s.id);
    for (const i of r.items) if (i.insufficient) assert.deepEqual(i.sentences, []); // 이력 부족에는 지어내지 않음
  }
});

test('사전 생성 결과는 낡지 않았다: 시연 인사이트 설명이 모두 조회된다', () => {
  for (const s of EXPLAIN_SCENARIOS) {
    const { view, req } = explainRequestOf(s);
    assert.ok(req, s.id);
    const r = explainInsight(req, { provider: pregen, exists: existsIn(view) });
    assert.equal(r.method, 'pregen', `${s.id} ${req.target}`);
    assert.equal(r.fallback, null);
  }
});

test('사전 생성 파일: 모든 문장에 근거가 있고, 근거는 그 항목의 근거 안에 있고, 쓰이지 않는 낡은 줄이 없다(R-15 ②)', () => {
  const used = new Set();
  for (const s of HANDOVER_SCENARIOS) {
    const { draft } = handoverDraftOf(s);
    for (const i of draft.items) used.add(pregenKey('handover', draft.target, i.key, itemEvidence(i), peopleKey(draft.from, draft.to)));
  }
  for (const s of EXPLAIN_SCENARIOS) {
    const { req } = explainRequestOf(s);
    used.add(pregenKey('insight_explain', req.target, '', req.evidence_ids));
  }
  for (const id of CANDIDATE_VIEWS) for (const req of candidateRequestsOf(id).reqs) used.add(pregenKey(req.task, req.target, '', req.evidence_ids));
  const views = ['U-D1', 'U-O'].map(viewOf);
  for (const it of PREGEN.items) {
    assert.ok(used.has(pregenKey(it.task, it.target, it.item, it.evidence_ids, peopleKey(it.from, it.to))), `쓰이지 않는(낡은) 사전 생성 줄: ${it.task} ${it.target} ${it.item || ''}`);
    const allowed = new Set(it.evidence_ids);
    assert.ok(it.sentences.length > 0);
    for (const st of it.sentences) {
      assert.ok(st.text.trim() && st.evidence_ids.length > 0, st.text);
      for (const gid of st.evidence_ids) {
        assert.ok(allowed.has(gid), `${it.target} ${it.item}: 항목 근거 밖 ${gid}`);
        assert.ok(views.some((v) => existsIn(v)(gid)), `없는 근거 ${gid}`);
      }
    }
  }
});

test('새로 입력한 데이터(K-9, CR-1): 근거가 바뀐 항목만 규칙 기반으로 돌아가고 나머지는 사전 생성', () => {
  const doc = addEvent(SAMPLE_A1, { type: 'memo', occurred_at: '2026-10-02', payload: { target_id: 'N-001', category: 'issue' }, note: '10월 대사 자료 늦게 올라옴' }, ctx).doc;
  const v = buildView(doc);
  const draft = buildHandoverDraft(v, { target: 'U-A1/N-000', from: 'U-A1/N-011', to: 'U-A1/N-012' }).draft;
  const r = refineDraft(draft, { provider: pregen, exists: existsIn(v) });
  const by = Object.fromEntries(r.items.map((i) => [i.key, i.method]));
  assert.equal(by['최근_이슈'], 'rule'); // 새 메모가 들어가 근거가 바뀜
  assert.equal(by['업무_개요'], 'pregen');
  assert.equal(by['진행_중'], 'pregen');
  assert.equal(r.method, 'pregen');
  assert.equal(r.counts.rule, 1); // 최근_이슈만(이력 부족 항목은 세지 않음)
});

test('사전 생성 결과가 하나도 없는 새 유니버스는 전부 규칙 기반이고 그렇게 표시된다', () => {
  let doc = createUniverse({ name: '새 업무', level: '업무', owner: '가상팀' }, ctx).doc;
  doc = addNode(doc, { core_type: 'person', label: '가', emp_no: 'V-9001' }, ctx).doc;
  doc = addNode(doc, { core_type: 'person', label: '나', emp_no: 'V-9002' }, ctx).doc;
  const v = buildView(doc);
  const people = v.nodes.filter((n) => n.core_type === 'person').map((n) => n.gid);
  const d = buildHandoverDraft(v, { target: `${doc.universe.id}/${doc.universe.root_node_id}`, from: people[0], to: people[1] }).draft;
  const r = refineDraft(d, { provider: pregen, exists: existsIn(v) });
  assert.equal(r.method, 'rule');
  assert.equal(r.counts.provider, 0);
});

test('R-04 ③: 실패 흉내·Claude API(P2)·사내 LLM(P2)을 고르면 규칙 기반으로 전환하고 원인을 남긴다', () => {
  const { view, draft } = handoverDraftOf(HANDOVER_SCENARIOS[0]);
  for (const [name, re] of [['fail', /실패/], ['claude_api', /P2/], ['internal', /P2/]]) {
    const r = refineDraft(draft, { provider: createProvider(name), exists: existsIn(view) });
    assert.equal(r.method, 'rule', name);
    assert.match(r.fallback.reason, re, name);
    const { req } = explainRequestOf(EXPLAIN_SCENARIOS[1]);
    const e = explainInsight(req, { provider: createProvider(name), exists: existsIn(view) });
    assert.equal(e.method, 'rule');
    assert.deepEqual(e.sentences, req.rule);
  }
});

test('근거 범위 검증(검토 3-11): 공급자가 항목 근거 밖의 노드를 근거로 달면 그 항목은 규칙 기반', () => {
  const { view, draft } = handoverDraftOf(HANDOVER_SCENARIOS[0]);
  const sneaky = { name: 'fake', method: 'llm', refine: () => ({ items: [{ key: '업무_개요', sentences: [{ text: '보고는 서하늘이 한다.', evidence_ids: ['U-A1/N-012'] }] }] }) };
  const r = refineDraft(draft, { provider: sneaky, exists: existsIn(view) });
  const item = r.items.find((i) => i.key === '업무_개요');
  assert.equal(item.method, 'rule');
  assert.equal(item.replaced, true);
});

test('설정(12.4 wu:v1:settings): 공급자만 저장하고, 없거나 깨졌으면 기본값(사전 생성)', async () => {
  const { loadSettings, saveSettings } = await import('../app/src/store/local.js');
  const m = new Map();
  const storage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  const d = { provider: DEFAULT_PROVIDER };
  assert.deepEqual(loadSettings(storage, d), { provider: 'pregen' });
  assert.equal(saveSettings(storage, { provider: 'fail', key: 'secret-like' }), true);
  assert.deepEqual(JSON.parse(m.get('wu:v1:settings')), { provider: 'fail' }); // 그 밖의 값(키 등)은 저장하지 않음
  assert.deepEqual(loadSettings(storage, d), { provider: 'fail' });
  m.set('wu:v1:settings', '{깨짐');
  assert.deepEqual(loadSettings(storage, d), { provider: 'pregen' });
  assert.deepEqual(loadSettings(null, d), { provider: 'pregen' });
  assert.equal(saveSettings(null, d), false);
});

test('검토3 LLM-1: 보내는 사람을 바꾸면 사전 생성 초안을 쓰지 않는다(다른 사람 이름이 든 문장 방지)', () => {
  const v = viewOf('U-C');
  for (const [from, to] of [['U-C/N-203', 'U-C/N-201'], ['U-C/N-202', 'U-C/N-205']]) {
    const d = buildHandoverDraft(v, { target: 'U-C/N-101', from, to }).draft;
    const r = refineDraft(d, { provider: pregen, exists: existsIn(v) });
    assert.equal(r.counts.provider, 0, `${from}>${to}`);
    const contact = r.items.find((i) => i.key === '관계자_연락처');
    assert.equal(contact.method, 'rule');
  }
});

test('검토3 LLM-4 보강: 사전 생성 파일에 깨진 줄이 있어도 나머지는 쓰고 시작이 멈추지 않는다', () => {
  const broken = { items: [null, { task: 'handover' }, ...PREGEN.items] };
  const p = createProvider('pregen', { pregen: broken });
  const { view, draft } = handoverDraftOf(HANDOVER_SCENARIOS[0]);
  assert.equal(refineDraft(draft, { provider: p, exists: existsIn(view) }).method, 'pregen');
  assert.equal(refineDraft(draft, { provider: createProvider('pregen', { pregen: null }), exists: existsIn(view) }).method, 'rule');
});

test('검토3 LLM-3: 저장된 공급자 이름이 목록에 없으면 기본값', async () => {
  const { loadSettings } = await import('../app/src/store/local.js');
  const m = new Map([['wu:v1:settings', '{"provider":"gpt"}']]);
  const storage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: () => {}, removeItem: () => {} };
  const names = PROVIDERS.map((p) => p.name);
  assert.deepEqual(loadSettings(storage, { provider: DEFAULT_PROVIDER }, names), { provider: 'pregen' });
  m.set('wu:v1:settings', '[1,2]');
  assert.deepEqual(loadSettings(storage, { provider: DEFAULT_PROVIDER }, names), { provider: 'pregen' });
});


test('T-10 역할 (c): 통합 화면의 업무 후보 이유가 모두 사전 생성으로 조회되고, 근거 밖 문장은 없다(R-15 ①②)', () => {
  for (const id of CANDIDATE_VIEWS) {
    const { view, reqs } = candidateRequestsOf(id);
    assert.ok(reqs.length > 0, id);
    for (const req of reqs) {
      const r = explainInsight(req, { provider: pregen, exists: existsIn(view) });
      assert.equal(r.method, 'pregen', `${id} ${req.target}`);
      const none = explainInsight(req, { provider: null, exists: existsIn(view) });
      assert.equal(none.method, 'rule'); // 키 없음 → 규칙 기반 이유
    }
  }
});
