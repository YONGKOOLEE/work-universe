// T-12 LLM 연결부(공급자 4종 + 실패 흉내)와 사전 생성 결과(CR-1, R-15, R-04, 12.3)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PREGEN } from '../app/data/pregen.js';
import { SAMPLE_A1 } from '../app/data/sample-a1.js';
import { addEvent, updateNode } from '../app/src/model/commands.js';
import { createUniverse, addNode } from '../app/src/model/commands.js';
import { buildView } from '../app/src/view/view.js';
import { buildHandoverDraft } from '../app/src/rules/handover.js';
import { createProvider, fingerprint, itemEvidence, peopleKey, pregenKey, PROVIDERS, DEFAULT_PROVIDER } from '../app/src/llm/providers.js';
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
  for (const [name, re] of [['fail', /실패/], ['claude_api', /키가 없어 규칙 기반\(사전 생성\)으로 동작합니다 — 설정에서 키를 넣으면 실시간/], ['internal', /다음 단계/]]) {
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

// 검토5 I-6(되돌림): 기준일에 따라 바뀌는 "기록 없는 기간" 경고는 설명 상자가 아니라 표 아래 알림(flow-nodata, ui/insight.js)이 항상 보여 준다.
// 사전 생성 문장에 규칙 경고를 덧붙이면 같은 말이 겹치므로 붙이지 않는다. 규칙 기반 설명에는 경고 문장이 그대로 있다
test('흐름 변화 설명: 사전 생성 문장에는 규칙 경고를 덧붙이지 않고, 규칙 기반 설명에는 "기록 없는 기간" 경고가 있다', async () => {
  const { flowChange } = await import('../app/src/rules/flow.js');
  const { flowExplain } = await import('../app/src/rules/explain.js');
  const view = viewOf('U-O');
  const r = flowChange(view, { unit: 'month', asOf: '2027-06-01' });
  assert.equal(r.no_data_periods, 15, '표 아래 알림이 쓰는 값');
  const req = flowExplain(r, 'U-O');
  const withPregen = explainInsight(req, { provider: pregen, exists: existsIn(view) });
  assert.equal(withPregen.method, 'pregen');
  assert.ok(!withPregen.sentences.some((s) => s.text.includes('개 기간은 기록이 없어 판단하지 않습니다')));
  const ruleOnly = explainInsight(req, { provider: null, exists: existsIn(view) });
  assert.equal(ruleOnly.sentences.filter((s) => s.text.includes('15개 기간은 기록이 없어 판단하지 않습니다')).length, 1);
});

// 낡은 사전 생성 방지(K-9, 12.3, T-20, 코드 검토 2026-10-17 R4): 근거 ID가 같아도 내용(설명·속성)이 바뀌면 규칙 기반으로 돌아간다
const A1_H = HANDOVER_SCENARIOS[0];
const refineEdited = (edit, provider = pregen) => {
  const doc = edit(SAMPLE_A1);
  const v = buildView(doc);
  const draft = buildHandoverDraft(v, { target: A1_H.target, from: A1_H.from, to: A1_H.to, asOf: '2026-10-02' }).draft;
  return { draft, r: refineDraft(draft, { provider, exists: existsIn(v) }) };
};
const methods = (r) => Object.fromEntries(r.items.filter((i) => !i.insufficient).map((i) => [i.key, i.method]));
const editDesc = (doc) => updateNode(doc, 'N-000', { description: '이제 분기마다 하는 업무로 바뀌었다(고친 설명)' }, ctx).doc;
const editAttr = (doc) => {
  const n = doc.nodes.find((x) => x.id === 'N-002');
  return updateNode(doc, 'N-002', { attrs: { ...n.attrs, 주의사항: '고친 주의사항: 오후에 내려받는다' } }, ctx).doc;
};

test('낡음 ① 샘플 그대로면 모든 사전 생성 줄에 지문이 있고 전부 사전 생성이다', () => {
  assert.ok(PREGEN.items.every((it) => /^[0-9a-f]{8}$/.test(it.fp)), '지문 없는 줄');
  assert.equal(fingerprint([{ text: 'a' }]), 'e40c292c'); // FNV-1a 32비트 기준값("a")
  const { r } = refineEdited((d) => d);
  assert.ok(Object.values(methods(r)).every((m) => m === 'pregen'), JSON.stringify(methods(r)));
});

test('낡음 ② 꼭지 설명만 고치면(근거 ID 그대로) 업무_개요만 규칙 기반이 되고 나머지는 사전 생성 유지', () => {
  const { draft, r } = refineEdited(editDesc);
  const ev = (d) => itemEvidence(d.items.find((i) => i.key === '업무_개요'));
  assert.deepEqual(ev(draft), ev(refineEdited((d) => d).draft)); // 근거 ID는 그대로(이 결함의 조건)
  const m = methods(r);
  assert.equal(m['업무_개요'], 'rule');
  for (const [k, v] of Object.entries(m)) if (k !== '업무_개요') assert.equal(v, 'pregen', k);
  const shown = r.items.find((i) => i.key === '업무_개요');
  assert.ok(shown.sentences.some((s) => s.text.includes('분기마다')), '고친 설명이 규칙 기반 문장에 보여야 함');
});

test('낡음 ③ 업무 속성(주의사항)만 고치면 해당 항목만 규칙 기반', () => {
  const { r } = refineEdited(editAttr);
  const m = methods(r);
  assert.equal(m['주의사항'], 'rule');
  assert.ok(Object.entries(m).every(([k, v]) => k === '주의사항' || v === 'pregen'), JSON.stringify(m));
  assert.ok(r.items.find((i) => i.key === '주의사항').sentences.some((s) => s.text.includes('고친 주의사항')));
});

test('낡음 ④ 지문 비교를 끄면 ②가 실패한다(되돌림): 지문을 지금 문장 것으로 맞춰 버린 파일이면 낡은 문장이 사전 생성으로 보인다', () => {
  const { draft } = refineEdited(editDesc);
  const rule = draft.items.find((i) => i.key === '업무_개요');
  const neutralized = { ...PREGEN, items: PREGEN.items.map((it) => (it.task === 'handover' && it.target === A1_H.target && it.item === '업무_개요' ? { ...it, fp: fingerprint(rule.sentences) } : it)) };
  const { r } = refineEdited(editDesc, createProvider('pregen', { pregen: neutralized }));
  assert.equal(methods(r)['업무_개요'], 'pregen'); // 비교가 없던 때의 결함 동작 → 비교가 있어야 ②가 지켜진다
});

test('낡음 ⑤ 인사이트 설명·업무 후보 이유: 지금 규칙 기반 문장과 지문이 다르면 규칙 기반, 같으면 사전 생성, 기준일에만 달라지는 경고는 영향 없음', () => {
  const { view, req } = explainRequestOf(EXPLAIN_SCENARIOS[0]);
  const changed = { ...req, rule: [{ ...req.rule[0], text: `${req.rule[0].text} (고침)` }, ...req.rule.slice(1)] };
  assert.equal(explainInsight(changed, { provider: pregen, exists: existsIn(view) }).method, 'rule');
  assert.equal(explainInsight(req, { provider: pregen, exists: existsIn(view) }).method, 'pregen');
  const flow = explainRequestOf(EXPLAIN_SCENARIOS[6], '2027-06-01');
  assert.equal(explainInsight(flow.req, { provider: pregen, exists: existsIn(flow.view) }).method, 'pregen');
  const { view: cv, reqs } = candidateRequestsOf('U-D1');
  const odd = { ...reqs.find((q) => q.target.includes('U-A1/N-003')), };
  assert.equal(explainInsight({ ...odd, rule: [{ ...odd.rule[0], text: '다른 이유' }] }, { provider: pregen, exists: existsIn(cv) }).method, 'rule');
});

test('낡음 ⑥ pregen-dump --check-fp와 같은 기준: 시나리오의 지금 규칙 기반 지문이 파일의 fp와 모두 같다', () => {
  for (const s of HANDOVER_SCENARIOS) {
    const { draft } = handoverDraftOf(s);
    for (const i of draft.items) {
      if (i.insufficient) continue;
      const line = PREGEN.items.find((it) => it.task === 'handover' && it.target === draft.target && it.item === i.key && it.from === draft.from && it.to === draft.to);
      assert.equal(line.fp, fingerprint(i.sentences), `${s.id} ${i.key}`);
    }
  }
});
