// D8-3·D8-4(2026-10-17 "추천 진행"): 양식 「주의사항」이 주의사항 범주 메모도 인정, 단추 승격 기준 상수
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLES } from '../app/data/index.js';
import { buildView } from '../app/src/view/view.js';
import { workFormMissing } from '../app/src/rules/form.js';
import { buildHandoverDraft } from '../app/src/rules/handover.js';
import { addEvent, addNode, addEdge, createUniverse } from '../app/src/model/commands.js';
import { EXPLORE } from '../app/src/ui/explore.js';

const ctx = { now: '2026-10-17T10:00:00+09:00' };
const viewOf = (doc) => buildView(doc, () => null);
const gidOf = (v, label) => v.nodes.find((n) => n.label === label).gid;

function setup(category) {
  let d = createUniverse({ name: '양식 시험', level: '팀', owner: '가상팀' }, ctx).doc;
  for (const x of [{ core_type: 'person', label: '가상갑', attrs: { emp_no: 'V-0001' } }, { core_type: 'person', label: '가상을', attrs: { emp_no: 'V-0002' } }, { core_type: 'work', label: '업무 하나', description: '설명' }]) d = addNode(d, x, ctx).doc;
  let v = viewOf(d);
  const [a, b, w] = ['가상갑', '가상을', '업무 하나'].map((l) => gidOf(v, l));
  d = addEvent(d, { type: 'memo', occurred_at: '2026-09-01', payload: { target_id: w, category }, note: '월말에는 마감 전 이중 확인' }, ctx).doc;
  v = viewOf(d);
  return { v, a, b, w };
}

const cautionItem = (v, a, b, w) => buildHandoverDraft(v, { target: w, from: a, to: b }).draft.items.find((i) => i.key === '주의사항');

test('D8-4: 주의사항 범주 메모가 있으면 양식도 「주의사항」을 빈 것으로 세지 않는다 — 초안과 같은 판정', () => {
  const { v, a, b, w } = setup('caution');
  const item = cautionItem(v, a, b, w);
  assert.ok(!item.insufficient && item.sentences.length > 0);
  assert.ok(!workFormMissing(v, w).includes('주의사항'));
});

test('D8-4: 다른 범주 메모는 인정하지 않는다(초안도 주의사항 항목이 비어 있음)', () => {
  const { v, a, b, w } = setup('in_progress');
  const item = cautionItem(v, a, b, w);
  assert.ok(item.insufficient || item.sentences.length === 0);
  assert.ok(workFormMissing(v, w).includes('주의사항'));
});

test('D8-4: 내장 샘플 모두에서 초안의 주의사항 항목이 있는 업무는 양식도 주의사항을 빈 것으로 세지 않는다', () => {
  for (const s of SAMPLES) {
    const v = viewOf(s.doc || s);
    const person = v.nodes.find((n) => n.core_type === 'person');
    if (!person) continue;
    for (const n of v.nodes.filter((x) => x.core_type === 'work' && !x.hidden)) {
      const r = buildHandoverDraft(v, { target: n.gid, from: person.gid, to: person.gid });
      if (!r.ok) continue;
      const it = r.draft.items.find((i) => i.key === '주의사항');
      if (it && !it.insufficient && it.sentences.length) assert.ok(!workFormMissing(v, n.gid).includes('주의사항'), n.label);
    }
  }
});

test('D8-3: 주변만 보기 승격 기준은 한 곳(EXPLORE)에 있고 월말 정산(10)·행사(9)는 넘지 않고 교육(18)은 넘는다', () => {
  assert.equal(EXPLORE.NBHD_PROMOTE_ABOVE, 15);
  assert.ok(10 <= EXPLORE.NBHD_PROMOTE_ABOVE && 9 <= EXPLORE.NBHD_PROMOTE_ABOVE && 18 > EXPLORE.NBHD_PROMOTE_ABOVE);
});
