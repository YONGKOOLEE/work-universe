// T-20 표준 양식 점검(R-16, D-16): 빈 권장 항목을 알리기만 하고 막지 않는다. 내장 샘플은 예외 목록을 뺀 모두가 양식을 따른다
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLES } from '../app/data/index.js';
import { buildView } from '../app/src/view/view.js';
import { STANDARD_FORM, formReport, workFormMissing } from '../app/src/rules/form.js';
import { addNode, createUniverse } from '../app/src/model/commands.js';

const ctx = { now: '2026-10-12T10:00:00+09:00' };
const viewOf = (doc) => buildView(doc, () => null);
const gidOf = (v, label) => v.nodes.find((n) => n.label === label).gid;

function docWith(workInput, extra = []) {
  let d = createUniverse({ name: '양식 시험', level: '팀', owner: '가상팀' }, ctx).doc;
  d = addNode(d, { core_type: 'work', ...workInput }, ctx).doc;
  for (const x of extra) d = addNode(d, x, ctx).doc;
  return d;
}

test('권장 항목: 설명·절차·주기·마감·주의사항·관련 문서·담당(조력자 의견 2026-10-12)', () => {
  assert.deepEqual(STANDARD_FORM.workAttrs, ['절차', '주기', '마감', '주의사항']);
  const d = docWith({ label: '빈 업무' });
  const v = viewOf(d);
  assert.deepEqual(workFormMissing(v, gidOf(v, '빈 업무')), ['설명', '절차', '주기', '마감', '주의사항', '관련 문서', '담당']);
});

test('모두 채운 업무에는 빈 항목이 없다(관련 문서는 속성으로도 채운 것으로 본다)', () => {
  const d = docWith({
    label: '채운 업무',
    description: '설명',
    attrs: { 절차: '① a', 주기: '매월', 마감: '5일', 주의사항: '주의', '관련 문서': '가상 문서' },
  });
  const v = viewOf(d);
  // 담당 연결이 없으므로 '담당'만 비어 있다
  assert.deepEqual(workFormMissing(v, gidOf(v, '채운 업무')), ['담당']);
});

test('담당: 사람 → 업무 수행 연결이 한 번이라도 있으면 채운 것(끝난 담당도), 산출 연결한 산출물은 관련 문서', () => {
  const sample = SAMPLES.find((s) => s.universe.id === 'U-A1');
  const v = buildView(sample, () => null);
  assert.deepEqual(workFormMissing(v, gidOf(v, '보고')), []);
  assert.deepEqual(workFormMissing(v, gidOf(v, '자료 수집')), []); // 점검표 양식(산출물)이 관련 문서
});

test('업무가 아닌 노드·숨긴 노드는 점검하지 않는다', () => {
  const sample = SAMPLES.find((s) => s.universe.id === 'U-A1');
  const v = buildView(sample, () => null);
  assert.equal(workFormMissing(v, gidOf(v, '한가람')), null);
});

// 예외 목록(02 5.6.2, R-16 ③): 카드승인 샘플(U-K1)은 처리 단계를 노드로 쪼갠 비교 자료로 남긴다(사용자 결정 추천안, 2026-10-12).
// 교육팀 「신규 교육 과정」은 R-13 ②의 "이력 부족" 시연을 위해 일부러 비웠다.
const EXCEPT_UNIVERSES = ['U-K1'];
const EXCEPT_WORKS = new Set(['신규 교육 과정']);

test('R-16 ③: 내장 샘플은 예외 목록을 뺀 모든 업무가 표준 양식을 따른다', () => {
  const by = Object.fromEntries(SAMPLES.map((d) => [d.universe.id, d]));
  const problems = [];
  for (const d of SAMPLES) {
    const v = buildView(d, (id) => by[id] || null);
    // 묶음 유니버스(팀·부서)에는 하위 유니버스의 업무가 들어 있으므로 업무의 출처(gid 앞부분)로 예외를 가른다
    for (const w of formReport(v).works) if (!EXCEPT_WORKS.has(w.label) && !EXCEPT_UNIVERSES.some((u) => w.gid.startsWith(u + '/'))) problems.push(`${d.universe.id} ${w.label}: ${w.missing.join(',')}`);
  }
  assert.deepEqual(problems, []);
});

test('예외 목록의 샘플은 실제로 양식을 따르지 않는다(예외가 낡았는지 알림)', () => {
  const k1 = SAMPLES.find((d) => d.universe.id === 'U-K1');
  assert.ok(formReport(buildView(k1, () => null)).incomplete > 0);
  const edu = SAMPLES.find((d) => d.universe.id === 'U-C');
  const r = formReport(buildView(edu, () => null));
  assert.deepEqual(r.works.map((w) => w.label), ['신규 교육 과정']);
});
