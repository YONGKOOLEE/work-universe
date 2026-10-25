// CR-16(2026-10-23): ① 시작 화면 「왜」 덩어리 상수 ② 용어 「업무 지도」 ③ 빈 출발 미리 보기(starterPreview)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PREGEN } from '../app/data/pregen.js';
import { SAMPLES, SAMPLE_GUIDE } from '../app/data/index.js';
import { addAssignment, addEvent, addNode, createUniverse, updateNode } from '../app/src/model/commands.js';
import { applyStarter } from '../app/src/model/starter.js';
import { PREVIEW_ITEMS, PREVIEW_SOURCE, PREVIEW_TEXT, previewContent, starterPreview, starterSteps } from '../app/src/rules/starter-steps.js';
import { TOUR_IDS, emptyState, scenarioOf } from '../app/src/rules/tour-steps.js';
import { PREVIEW_CAPTION, WHY_LINE, WHY_TITLE } from '../app/src/ui/start.js';
import { buildView } from '../app/src/view/view.js';

const ctx = { now: '2026-10-23T10:00:00+09:00' };
const fresh = () => createUniverse({ name: '미리 보기 시험', level: '업무', owner: '가상팀' }, ctx).doc;
const FULL = { 절차: '① a', 주기: '매월', 마감: '5일', 주의사항: '주의', '관련 문서': '문서' };
const viewOf = (d) => buildView(d, () => null);
const pregenItem = (key) => PREGEN.items.find((it) => it.task === PREVIEW_SOURCE.task && it.target === PREVIEW_SOURCE.target && it.item === key);
/** 「…」 안의 단추 이름은 빼고 남은 글 */

// 처음 할 일을 모두 끝낸 문서
function allDone() {
  let d = applyStarter(fresh(), { work: '월말 점검', person: '김가상', artifact: '점검표' }, ctx).doc;
  const wid = d.nodes.find((n) => n.core_type === 'work').id;
  const pid = d.nodes.find((n) => n.core_type === 'person').id;
  d = addEvent(d, { type: 'memo', occurred_at: '2026-10-23', payload: { target_id: wid, category: 'caution' }, note: '주의' }, ctx).doc;
  d = updateNode(d, wid, { description: '설명', attrs: FULL }, ctx).doc;
  d = addNode(d, { core_type: 'work', label: '둘째 업무', description: '설명', attrs: FULL }, ctx).doc;
  const w2 = d.nodes.find((n) => n.label === '둘째 업무').id;
  d = addAssignment(d, { type: 'assign_start', occurred_at: '2026-10-23', payload: { person_id: pid, work_id: w2 } }, ctx).doc;
  return d;
}

// ── ③ 미리 보기 ──
test('starterPreview: 새 유니버스(처음 할 일 남음) → 항목 3개 + 「샘플」 표시 + 월말 정산 안내', () => {
  const d = applyStarter(fresh(), { work: '월말 점검' }, ctx).doc;
  assert.ok(starterSteps(d, viewOf(d)), '전제: 처음 할 일이 남아 있다');
  const p = starterPreview(d);
  assert.ok(p);
  assert.equal(p.items.length, 3);
  assert.deepEqual(p.items.map((i) => i.key), ['업무_개요', '세부_업무_절차', '주의사항']);
  assert.equal(p.chip, '샘플');
  assert.ok(p.head.includes('월말 정산 점검') && p.head.includes('미리 쓴 문장') && p.head.includes('가상 데이터'));
  assert.ok(p.risk.includes('높음') && p.risk.includes('인수인계 기록이 없는'));
  assert.ok(p.note.includes('인수인계 초안 만들기') && p.note.includes('지금 지도에서 만들려면'));
  assert.equal(p.summary, '기록이 이렇게 쌓이면 →');
  assert.deepEqual(starterPreview(d, viewOf(d)), p); // view를 넘겨도 같다
});

test('starterPreview: 문장은 사전 생성(pregen.js) 문장과 글자 그대로 같다(새 문장 없음)', () => {
  const p = previewContent();
  const overview = pregenItem('업무_개요');
  const steps = pregenItem('세부_업무_절차');
  const cautions = pregenItem('주의사항');
  assert.ok(overview && steps && cautions, '사전 생성에 세 항목이 있다');
  assert.equal(p.items[0].text, overview.sentences.map((s) => s.text).join(' '));
  assert.equal(p.items[1].text, steps.sentences[0].text); // 세부 업무 절차는 첫 문장만
  assert.ok(steps.sentences.length > 1 && !p.items[1].text.includes(steps.sentences[1].text));
  assert.equal(p.items[2].text, cautions.sentences.map((s) => s.text).join(' '));
  for (const spec of PREVIEW_ITEMS) assert.ok(p.items.some((i) => i.key === spec.key));
  // 고정 문구 말고는 PREGEN에 없는 글자를 만들어 내지 않는다: 항목 글은 전부 pregen 문장의 이어붙임
  const all = PREGEN.items.flatMap((it) => it.sentences.map((s) => s.text));
  for (const i of p.items) assert.ok(all.some((s) => i.text.includes(s)), i.key);
});

test('starterPreview: 처음 할 일을 다 하면 사라진다', () => {
  const d = allDone();
  assert.equal(starterSteps(d, viewOf(d)), null);
  assert.equal(starterPreview(d), null);
});

test('starterPreview: 샘플(월말 정산 포함)·묶은 유니버스·업무 없는 유니버스에서는 안 보인다', () => {
  for (const s of SAMPLES) assert.equal(starterPreview(s), null, s.universe.id);
  assert.equal(starterPreview(fresh()), null); // 업무 0개
  const grouped = { ...applyStarter(fresh(), { work: '업무' }, ctx).doc, refs: [{ child_universe_id: 'U-A1', added_at: ctx.now }] };
  assert.equal(starterPreview(grouped), null);
});

test('previewContent: 사전 생성 항목이 없으면(낡음) 그 항목만 빼고 지어내지 않는다', () => {
  const saved = PREGEN.items.slice();
  try {
    PREGEN.items.splice(0, PREGEN.items.length, ...saved.filter((it) => !(it.target === PREVIEW_SOURCE.target && it.item === '주의사항')));
    const p = previewContent();
    assert.deepEqual(p.items.map((i) => i.key), ['업무_개요', '세부_업무_절차']);
  } finally {
    PREGEN.items.splice(0, PREGEN.items.length, ...saved);
  }
  assert.equal(previewContent().items.length, 3);
  assert.ok(PREVIEW_TEXT.head.includes('「월말 정산 점검」'));
});

// ── ② 용어 「업무 지도」 ──
test('따라 하기 문구(tour-steps)에 「유니버스」가 없다(「」 안 단추 이름 제외)', () => {
  for (const id of TOUR_IDS) {
    const sc = scenarioOf(id);
    const texts = [sc.title, sc.story];
    for (const st of sc.steps) {
      texts.push(st.task);
      if (st.sub) for (const s of [emptyState(sc.universeId), { ...emptyState(sc.universeId), selected: `${sc.universeId}/N-001`, saved: true }]) texts.push(st.sub(s));
    }
    for (const t of texts.filter(Boolean)) assert.ok(!t.includes('유니버스'), `${id}: ${t}`);
  }
});

test('「처음 할 일」 문구와 샘플 카드 문구에 「유니버스」가 없다', () => {
  const d = applyStarter(fresh(), { work: '월말 점검' }, ctx).doc;
  for (const st of starterSteps(d, viewOf(d)).steps) assert.ok(!st.label.includes('유니버스'), st.label);
  for (const [id, g] of Object.entries(SAMPLE_GUIDE)) {
    assert.ok(!g.tagline.includes('유니버스'), `${id} tagline`);
    assert.ok(!g.try.includes('유니버스'), `${id} try`);
  }
});

// ── ① 「왜」 덩어리 ──
// CR-22 S(2026-10-26): 「왜」 세 칸(WHY_STEPS)은 화면 미리 보기 도식으로 바뀌었다. 제목·한 줄·AI 문장은 그대로 쉬운 말로 확인한다
test('WHY 제목·한 줄: 제목은 그대로, 한 줄에 AI가 하는 일(FU-4)이 있고 쉬운 말', () => {
  assert.equal(WHY_TITLE, '담당자가 바뀌어도 끊기지 않는 업무 지도');
  assert.ok(WHY_LINE.startsWith(WHY_TITLE) && WHY_LINE.includes('AI가 기록만 보고 쓰고, 앱이 근거를 검사합니다'));
  assert.ok(!/유니버스|노드|꼭지/.test(`${WHY_LINE} ${PREVIEW_CAPTION}`));
});
