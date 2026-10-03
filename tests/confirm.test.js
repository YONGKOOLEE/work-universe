// 인수인계 초안 확정(R-03 ③, CR-8 사용자 결정 2026-10-03 "추천하는 걸로 구현")
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import { SAMPLES } from '../app/data/index.js';
import { buildHandoverDraft } from '../app/src/rules/handover.js';
import { repeatInefficiency } from '../app/src/rules/insight.js';
import { validateDocument } from '../app/src/model/validate.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const NOW = '2026-10-03T15:00:00+09:00';
const open = (storage, id) => createApp({ store: createStore(storage), samples: SAMPLES, currentId: id, now: () => NOW });
const draftOf = (app, target, from, to) => buildHandoverDraft(app.view, { target, from, to }).draft;
const TEXT = '[확정] 서하늘 → 윤바다 인수인계 초안: 대사 확인\n■ 업무 개요\n  - …';

test('업무 대상 확정: 인수인계서·산출 연결·인수인계 이력(바로 앞 인수인계를 가리킴)이 그 유니버스에 저장된다', () => {
  const storage = memoryStorage();
  const app = open(storage, 'U-A1');
  const d = draftOf(app, 'U-A1/N-001', 'U-A1/N-012', 'U-A1/N-011');
  const r = app.confirmHandover({ draft: d, text: TEXT, date: '2026-10-03' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.works, ['U-A1/N-001']);
  const doc = open(storage, 'U-A1').doc; // 다시 열어도 남아 있다
  assert.equal(validateDocument(doc).ok, true);
  const art = doc.nodes.find((n) => `U-A1/${n.id}` === r.artifact);
  assert.deepEqual([art.label, art.subtype, art.description], ['2026-10-03 대사 확인 인수인계서', '인수인계서', TEXT]);
  assert.deepEqual([art.attrs.확정자, art.attrs['확정 시각'], art.attrs['보내는 사람'], art.attrs['받는 사람']], ['사용자(이 브라우저)', NOW, '서하늘', '윤바다']);
  assert.ok(doc.edges.some((e) => e.source === 'N-001' && e.target === art.id && e.core_type === 'produces'));
  const ev = doc.events.filter((e) => e.type === 'handover').pop();
  assert.deepEqual(ev.payload, { work_id: 'N-001', from_person_id: 'N-012', to_person_id: 'N-011', artifact_id: art.id, previous_handover_id: 'E-007' });
  assert.equal([ev.occurred_at, ev.source].join(), '2026-10-03,user');
});

test('확정한 인수인계는 다음 초안의 「이전 인수인계」 근거가 되고, 반복 비효율에서 "이어받음"으로 본다', () => {
  const app = open(memoryStorage(), 'U-A1');
  const r = app.confirmHandover({ draft: draftOf(app, 'U-A1/N-001', 'U-A1/N-012', 'U-A1/N-011'), text: TEXT, date: '2026-10-03' });
  const next = draftOf(app, 'U-A1/N-001', 'U-A1/N-011', 'U-A1/N-010');
  const prev = next.items.find((i) => i.key === '이전_인수인계');
  assert.ok(prev.sentences.some((s) => s.text.includes('서하늘 → 윤바다') && s.text.includes('2026-10-03 대사 확인 인수인계서') && s.evidence_ids.includes(r.artifact)));
  const chain = repeatInefficiency(app.view).patterns.find((p) => p.kind === 'handover_chain');
  assert.deepEqual([chain.total, chain.missed, chain.steps[2].referenced], [3, 1, true]);
});

test('꼭지 대상 확정: 범위 업무 중 보내는 사람이 맡았던 업무만 이력으로 남긴다. 없으면 이유와 함께 거부', () => {
  const app = open(memoryStorage(), 'U-A1');
  const r = app.confirmHandover({ draft: draftOf(app, 'U-A1/N-000', 'U-A1/N-011', 'U-A1/N-012'), text: TEXT, date: '2026-10-03' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.works, ['U-A1/N-001']); // 윤바다는 대사 확인만 맡았다
  assert.equal(app.doc.nodes.find((n) => `U-A1/${n.id}` === r.artifact).label, '2026-10-03 월말 정산 점검 인수인계서');
  // 아무 업무도 맡지 않은 사람(V-1001 한가람은 대사 확인을 맡았으므로, 새 사람을 만든다)
  const p = app.addNode({ core_type: 'person', label: '가상 신입', emp_no: 'V-1099' });
  const no = app.confirmHandover({ draft: draftOf(app, 'U-A1/N-000', `U-A1/${p.node.id}`, 'U-A1/N-012'), text: TEXT, date: '2026-10-03' });
  assert.deepEqual(no.error, { code: 'E-CONFIRM', reason: 'no_work' });
});

test('같은 날 같은 사람 사이의 같은 업무 인수인계를 두 번 확정하지 않는다, 읽기 전용이면 막는다', () => {
  const app = open(memoryStorage(), 'U-A1');
  const d = draftOf(app, 'U-A1/N-001', 'U-A1/N-012', 'U-A1/N-011');
  assert.equal(app.confirmHandover({ draft: d, text: TEXT, date: '2026-10-03' }).ok, true);
  const nodes = app.doc.nodes.length;
  assert.deepEqual(app.confirmHandover({ draft: d, text: TEXT, date: '2026-10-03' }).error, { code: 'E-CONFIRM', reason: 'duplicate' });
  assert.equal(app.doc.nodes.length, nodes);
  // 다른 날이면 새로 확정(이름은 날짜로 구별)
  assert.equal(app.confirmHandover({ draft: d, text: TEXT, date: '2026-10-04' }).ok, true);
  const ro = createApp({ store: null, samples: SAMPLES, currentId: 'U-A1', now: () => NOW });
  assert.equal(ro.confirmHandover({ draft: draftOf(ro, 'U-A1/N-001', 'U-A1/N-012', 'U-A1/N-011'), text: TEXT, date: '2026-10-03' }).error.code, 'W-STORAGE');
});

test('팀 화면에서 하위 유니버스 업무를 확정하면 그 업무의 유니버스에 저장된다(원본 유니버스)', () => {
  const storage = memoryStorage();
  const app = open(storage, 'U-T1');
  const r = app.confirmHandover({ draft: draftOf(app, 'U-A1/N-001', 'U-A1/N-012', 'U-A1/N-011'), text: TEXT, date: '2026-10-03' });
  assert.equal(r.ok, true);
  assert.ok(r.artifact.startsWith('U-A1/'));
  const a1 = open(storage, 'U-A1').doc;
  assert.ok(a1.nodes.some((n) => `U-A1/${n.id}` === r.artifact));
  assert.equal(validateDocument(a1).ok, true);
  assert.equal(open(storage, 'U-T1').doc.nodes.length, SAMPLES.find((s) => s.universe.id === 'U-T1').nodes.length, '팀 문서는 그대로');
});

test('본문이 2000자를 넘으면 나머지를 「본문(이어서 N)」 속성으로 나눠 잃지 않는다', () => {
  const app = open(memoryStorage(), 'U-A1');
  const long = '가'.repeat(4500);
  const r = app.confirmHandover({ draft: draftOf(app, 'U-A1/N-001', 'U-A1/N-012', 'U-A1/N-011'), text: long, date: '2026-10-03' });
  const art = app.doc.nodes.find((n) => `U-A1/${n.id}` === r.artifact);
  assert.equal(art.description.length, 2000);
  assert.equal(art.description + art.attrs['본문(이어서 1)'] + art.attrs['본문(이어서 2)'], long);
});
