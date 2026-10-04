// 여섯 번째 전체 검토(docs/review-2026-10-05.md) 수정분: 날짜 연도 범위, 묶은 화면 확정의 사람 ID, 깨진 가져오기, 위층 판정, 숨긴 노드 연결, 통합 중복·사번 정규화
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allSamples, clone, mkDoc, mkEdge, mkNode, viewOf } from './helpers.js';
import { createApp } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import { SAMPLES } from '../app/data/index.js';
import { buildHandoverDraft } from '../app/src/rules/handover.js';
import { buildView } from '../app/src/view/view.js';
import { projectView } from '../app/src/view/collapse.js';
import { describeNode, describeUniverse } from '../app/src/view/describe.js';
import { mergePlan } from '../app/src/merge/merge.js';
import { addEvent, addEdge } from '../app/src/model/commands.js';
import { isDate } from '../app/src/model/checks.js';
import { validateDocument } from '../app/src/model/validate.js';
import { previewImport } from '../app/src/model/import.js';
import { periodKey, timeMonths } from '../app/src/rules/flow.js';

const NOW = '2026-10-05T10:00:00+09:00';
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i], get length() { return m.size; } };
}
const open = (storage, id) => createApp({ store: createStore(storage), samples: SAMPLES, currentId: id, now: () => NOW });

// ── C-1 날짜 연도 범위 ──
test('C-1 날짜: 연도 오타(0202·1026·2201)는 거부하고 1900~2200은 받는다', () => {
  for (const bad of ['0202-06-01', '1026-06-01', '1899-12-31', '2201-01-01', '2026-02-30', '26-06-01']) assert.equal(isDate(bad), false, bad);
  for (const ok of ['1900-01-01', '2026-06-01', '2200-12-31']) assert.equal(isDate(ok), true, ok);
});

test('C-1 날짜: 연도 오타 이력은 명령이 거부하고, 연결 기간 시작도 거부한다. 문서 검증도 오류로 본다', () => {
  const doc = clone(allSamples()['U-A1']);
  const r = addEvent(doc, { type: 'memo', occurred_at: '0202-06-01', payload: { target_id: 'N-001' }, note: '오타' }, { now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.error.field, 'occurred_at');
  const e = addEdge(doc, { source: 'N-011', target: 'N-001', core_type: 'performs', period: { start: '0202-01-01' } }, { now: NOW });
  assert.equal(e.ok, false);
  const bad = clone(doc);
  bad.events.push({ id: 'E-BAD', type: 'memo', occurred_at: '1026-06-01', recorded_at: NOW, source: 'user', payload: { target_id: 'N-001' }, note: 'x' });
  assert.equal(validateDocument(bad).ok, false);
});

test('C-1 시간 막대: 이미 저장된 연도 오타 날짜가 있어도 달 목록이 터지지 않고 정상 범위만 쓴다. 기간 키는 네 자리 연도', () => {
  const doc = clone(allSamples()['U-A1']);
  doc.events.push({ id: 'E-BAD', type: 'memo', occurred_at: '0202-06-01', recorded_at: NOW, source: 'user', payload: { target_id: 'N-001' }, note: 'x' });
  const months = timeMonths(buildView(doc), '2026-10-05');
  assert.ok(months.length > 1 && months.length < 60, String(months.length));
  assert.ok(months.every((m) => /^\d{4}-\d{2}$/.test(m) && m >= '1900'));
  assert.equal(periodKey('0202-06-01', 'month'), '0202-06');
});

// ── C-2 묶은 화면에서 확정: 대상 유니버스에 맞는 사람 ID ──
test('C-2 부서 화면에서 확정: 합쳐진 사람의 대표가 다른 유니버스에 있어도 대상 유니버스에는 그 유니버스의 사람 ID로 저장한다', () => {
  const storage = memoryStorage();
  const app = open(storage, 'U-D1');
  const v = app.view;
  const rep = v.getNode('U-B/N-202'); // 윤바다: 대표는 U-A1, 원본이 U-B에도 있다
  assert.ok(rep.merged_from.includes('U-B/N-202') && rep.universe_id !== 'U-B');
  const work = 'U-B/N-101';
  const to = 'U-B/N-201';
  const draft = buildHandoverDraft(v, { target: work, from: 'U-B/N-202', to, asOf: '2026-10-05' }).draft;
  assert.equal(draft.from, rep.gid);
  const r = app.confirmHandover({ draft, text: '본문', date: '2026-10-05' });
  assert.equal(r.ok, true);
  const ub = open(storage, 'U-B');
  const ev = ub.doc.events.filter((e) => e.type === 'handover').pop();
  assert.equal(ev.payload.from_person_id, 'N-202');
  assert.equal(ev.payload.to_person_id, 'N-201');
  assert.equal(validateDocument(ub.doc).ok, true);
  // 단독으로 열어도 사람 이름이 나오고, 그 사람의 이력에 들어 있다
  const hist = describeNode(ub.view, 'U-B/N-202', { asOf: '2026-10-05' }).history;
  assert.ok(hist.some((h) => h.gid === `U-B/${ev.id}` && h.text.includes('윤바다') && !h.text.includes('U-A1/')));
});

// ── C-12 확정 이름 겹침 ──
test('C-12 확정: 공백만 다른 같은 이름의 산출물이 있어도 거부하지 않고 (2)를 붙인다', () => {
  const app = open(memoryStorage(), 'U-A1');
  const first = app.addNode({ core_type: 'artifact', label: '2026-10-05  대사 확인  인수인계서' });
  assert.equal(first.ok, true);
  const draft = buildHandoverDraft(app.view, { target: 'U-A1/N-001', from: 'U-A1/N-012', to: 'U-A1/N-011', asOf: '2026-10-05' }).draft;
  const r = app.confirmHandover({ draft, text: '본문', date: '2026-10-05' });
  assert.equal(r.ok, true);
  assert.equal(app.doc.nodes.find((n) => `U-A1/${n.id}` === r.artifact).label, '2026-10-05 대사 확인 인수인계서 (2)');
});

// ── C-3 깨진 JSON 가져오기 ──
const shell = (u, extra = {}) => ({ schema_version: '1.0', universe: { id: 'U-X', name: 'x', level: '팀', owner: 'o', root_node_id: 'N-0', ...u }, nodes: [{ id: 'N-0', core_type: 'root', label: 'x' }], edges: [], events: [], refs: [], identity_links: [], ...extra });
test('C-3 가져오기: 구조가 깨진 JSON은 예외 없이 오류 목록으로 돌려준다(universe·edges 없음, subtypes 이상)', () => {
  const cases = [
    { schema_version: '1.0', nodes: [], edges: [], events: [] },
    { schema_version: '1.0', universe: { id: 'U-X', name: 'x', level: '팀', owner: 'o', root_node_id: 'N-0' }, nodes: [{ id: 'N-0', core_type: 'root', label: 'x' }] },
    shell({ subtypes: [null] }, { nodes: [{ id: 'N-0', core_type: 'root', label: 'x' }, { id: 'N-1', core_type: 'work', label: 'w', subtype: '정기' }] }),
    shell({ subtypes: {} }, { nodes: [{ id: 'N-0', core_type: 'root', label: 'x' }, { id: 'N-1', core_type: 'work', label: 'w', subtype: '정기' }] }),
  ];
  for (const doc of cases) {
    let r;
    assert.doesNotThrow(() => { r = previewImport(doc, { existing: [] }); assert.doesNotThrow(() => validateDocument(doc)); });
    assert.equal(r.ok, false);
    assert.ok(r.errors.length > 0);
  }
  assert.equal(previewImport(shell({}), { existing: [] }).ok, true); // 정상 문서는 그대로
});

// ── C-4 위층이 아래층 판정을 다시 묻지 않음, C-9, C-10 ──
const mk = (id, name, nodes, refs = [], links = []) => ({
  schema_version: '1.0',
  universe: { id, name, level: '팀', owner: 'o', root_node_id: 'N-000', subtypes: [], created_at: NOW },
  nodes: [{ id: 'N-000', core_type: 'root', label: name, hidden: false }, ...nodes],
  edges: [], events: [], refs: refs.map((c) => ({ child_universe_id: c })), identity_links: links,
});
const person = (id, label, emp_no) => ({ id, core_type: 'person', label, ...(emp_no ? { emp_no } : {}), hidden: false });
const viewWith = (top, all) => buildView(top, (x) => all[x] || null);

test('C-4 통합: 팀에서 "다른 사람"으로 판정한 쌍은 부서 확인 목록이 다시 묻지 않는다', () => {
  const a = mk('U-XA', '업무가', [person('N-1', '한빛', 'V-7001')]);
  const b = mk('U-XB', '업무나', [person('N-1', '한빛나', 'V-7001')]);
  const team = mk('U-XT', '팀', [], ['U-XA', 'U-XB'], [{ id: 'I-1', a: 'U-XA/N-1', b: 'U-XB/N-1', kind: 'person', method: 'human', status: 'rejected', decided_by: '사용자', decided_at: NOW }]);
  const dept = mk('U-XD', '부서', [], ['U-XT']);
  const all = { 'U-XA': a, 'U-XB': b, 'U-XT': team, 'U-XD': dept };
  assert.equal(mergePlan(viewWith(team, all), team.identity_links).persons.length, 0);
  assert.equal(mergePlan(viewWith(dept, all), dept.identity_links).persons.length, 0);
  // 판정이 없으면 부서에서 묻는다(대조)
  const undecided = { ...all, 'U-XT': { ...team, identity_links: [] } };
  assert.equal(mergePlan(viewWith(dept, undecided), []).persons.length, 1);
});

test('C-9 통합: 사번 없는 같은 이름 두 사람은 확인 항목 1건(혼자 항목을 또 만들지 않는다)', () => {
  const a = mk('U-YA', '업무가', [person('N-1', '임가온')]);
  const b = mk('U-YB', '업무나', [person('N-1', '임가온')]);
  const team = mk('U-YT', '팀', [], ['U-YA', 'U-YB']);
  const plan = mergePlan(viewWith(team, { 'U-YA': a, 'U-YB': b }), []);
  assert.equal(plan.persons.length, 1);
  assert.deepEqual([plan.persons[0].a, plan.persons[0].b].sort(), ['U-YA/N-1', 'U-YB/N-1']);
  // 같은 이름이 없는 사번 없는 사람은 여전히 혼자 항목 1건
  const c = mk('U-YC', '업무다', [person('N-1', '도하윤')]);
  const team2 = mk('U-YT2', '팀', [], ['U-YA', 'U-YC']);
  assert.equal(mergePlan(viewWith(team2, { 'U-YA': a, 'U-YC': c }), []).persons.length, 2);
});

test('C-10 통합: 사번 표기의 공백·대소문자 차이(V-7001 / V -7001 / v-7001)를 같은 사번으로 본다', () => {
  const a = mk('U-ZA', '가', [person('N-1', '한빛', 'V-7001')]);
  const b = mk('U-ZB', '나', [person('N-1', '한빛', 'V -7001')]);
  const c = mk('U-ZC', '다', [person('N-1', '한빛', 'v-7001')]);
  const team = mk('U-ZT', '팀', [], ['U-ZA', 'U-ZB', 'U-ZC']);
  const plan = mergePlan(viewWith(team, { 'U-ZA': a, 'U-ZB': b, 'U-ZC': c }), []);
  assert.equal(plan.auto.length, 3); // 세 쌍 모두 같은 사번·이름
});

// ── C-5 숨긴 노드의 연결 ──
test('C-5 층별 보기: 숨긴 업무에 붙은 수행 연결은 요약 연결로도 그려지지 않는다(상세·개요 연결 수와 같은 말)', () => {
  const doc = mkDoc('U-H', [mkNode('N-1', 'person', '가람'), mkNode('N-2', 'work', '경계', { hidden: true })],
    [mkEdge('N-000', 'N-2', 'contains'), mkEdge('N-1', 'N-2', 'performs')]);
  const v = buildView(doc);
  assert.equal(v.visible().edges.length, 0);
  assert.equal(projectView(v).edges.length, 0);
  assert.equal(describeUniverse(v).edge_total, 0);
  // 숨기지 않으면 그대로 보인다(대조)
  const doc2 = clone(doc);
  doc2.nodes.find((n) => n.id === 'N-2').hidden = false;
  assert.ok(projectView(buildView(doc2)).edges.length >= 2);
});

// ── 변환기 C-6·C-7·C-8 ──
import { convertDocument } from '../app/src/rules/doc-convert.js';
import { updateNode } from '../app/src/model/commands.js';
const convCtx = { now: NOW, random: (() => { let s = 1; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })() };
const withOwner = (d) => ({ ...d, universe: { ...d.universe, owner: d.universe.owner || '가상팀' } });

test('C-7 변환: 100자를 넘는 이름은 …로 자르고 알리며 전체 이름을 설명에 남긴다', () => {
  const long = `${'가상 '.repeat(40)}업무`; // 122자
  const r = convertDocument(`# 가상 문서\n## 1. 범위\n- ${long}\n- 짧은 업무`, convCtx);
  const w = r.doc.nodes.find((n) => n.core_type === 'work' && n.label.endsWith('…'));
  assert.ok(w, '잘린 업무 노드');
  assert.equal(w.label.length, 100);
  assert.equal(w.description, long);
  assert.ok(r.report.notes.some((n) => n.code === 'C-TRUNCATED' && n.where === '이름'));
  assert.equal(validateDocument(withOwner(r.doc)).ok, true);
});

test('C-6 변환: 개요의 긴 업무 속성(주의사항)은 2000자로 잘라 알리고, 가져온 뒤 그 노드를 고칠 수 있다', () => {
  const r = convertDocument(`# 가상 문서\n## 1. 개요\n- 주의사항: ${'매우 긴 주의 '.repeat(400)}\n## 2. 범위\n- 가상 업무`, convCtx);
  const w = r.doc.nodes.find((n) => n.core_type === 'work');
  assert.ok(String(w.attrs.주의사항).length <= 2000);
  assert.ok(r.report.notes.some((n) => n.code === 'C-TRUNCATED' && n.where === '주의사항'));
  const u = updateNode(withOwner(r.doc), w.id, { description: '설명만 고침' }, convCtx);
  assert.equal(u.ok, true);
});

test('C-8 변환: 「사용시스템」(띄어쓰기 없음)도 약속한 속성 「사용 시스템」으로 저장되어 초안에 나온다', () => {
  for (const key of ['사용 시스템', '사용시스템']) {
    const r = convertDocument(`# 가상 문서\n## 1. 개요\n- ${key}: 가상 정산 시스템\n- 주기: 매월\n## 2. 범위\n- 가상 업무\n## 3. 이해관계자\n- 가람 담당\n- 나래 담당`, convCtx);
    const w = r.doc.nodes.find((n) => n.core_type === 'work');
    assert.equal(w.attrs['사용 시스템'], '가상 정산 시스템', key);
    assert.equal(w.attrs['사용시스템'], undefined, key);
    const d = withOwner(r.doc);
    const v = buildView(d);
    const U = d.universe.id;
    const [p1, p2] = d.nodes.filter((n) => n.core_type === 'person');
    const draft = buildHandoverDraft(v, { target: `${U}/${w.id}`, from: `${U}/${p1.id}`, to: `${U}/${p2.id}` }).draft;
    const text = draft.items.flatMap((i) => i.sentences.map((s) => s.text)).join('\n');
    assert.ok(text.includes('가상 정산 시스템'), key);
  }
});

// ── C-13 깨진 저장소, C-15 같은 날 끝난 담당 ──
import { workLoad } from '../app/src/rules/insight.js';

test('C-13 저장소: 유니버스 문서에 null 요소가 있거나 목록에 null이 섞여도 시작 화면이 멈추지 않고, 읽기 전용으로 잘못 열리지 않는다', () => {
  const storage = memoryStorage();
  open(storage, 'U-A1'); // 샘플 설치
  const broken = JSON.parse(storage.getItem('wu:v1:u:U-A1'));
  broken.nodes.push(null);
  storage.setItem('wu:v1:u:U-A1', JSON.stringify(broken));
  const idx = JSON.parse(storage.getItem('wu:v1:index'));
  storage.setItem('wu:v1:index', JSON.stringify([null, { nope: 1 }, ...idx]));
  let app;
  assert.doesNotThrow(() => { app = open(storage, 'U-A1'); app.universes(); });
  assert.deepEqual(app.warnings, []);
  assert.equal(app.readOnly, false);
  assert.ok(app.doc.nodes.every((n) => n && n.id)); // 깨진 문서는 샘플로 다시 설치됐다
  assert.ok(app.universes().length >= SAMPLES.length);
});

test('C-15 업무 상세: 같은 날 끝난 이전 담당자가 둘이면 연결 저장 순서와 상관없이 같은 사람(이름 순)이 마지막 담당자', () => {
  const mkWork = (order) => {
    const edges = order.map((p) => mkEdge(p, 'N-3', 'performs', { period: { start: '2026-01-01', end: '2026-06-30' } }));
    return mkDoc('U-L', [mkNode('N-1', 'person', '나래'), mkNode('N-2', 'person', '가람'), mkNode('N-3', 'work', '대사')], [mkEdge('N-000', 'N-3', 'contains'), ...edges]);
  };
  const a = workLoad(buildView(mkWork(['N-1', 'N-2'])), 'U-L/N-3', { asOf: '2026-10-05' });
  const b = workLoad(buildView(mkWork(['N-2', 'N-1'])), 'U-L/N-3', { asOf: '2026-10-05' });
  assert.equal(a.last_person.label, '가람');
  assert.deepEqual(a.last_person, b.last_person);
});

// ── U-14 조사 ──
import { josa, messageFor } from '../app/src/ui/messages.js';

test('U-14 조사: 받침에 맞춰 을/를·은/는·이/가를 고르고, 따옴표·괄호는 건너뛰며, 한글이 아니면 둘 다 적는다', () => {
  assert.equal(josa('작성 주체', '을/를'), '를');
  assert.equal(josa('이름', '을/를'), '을');
  assert.equal(josa('사람', '이/가'), '이');
  assert.equal(josa('업무', '이/가'), '가');
  assert.equal(josa('「대사 확인」', '은/는'), '은');
  assert.equal(josa('「대사」', '은/는'), '는');
  assert.equal(josa('「소속」', '은/는'), '은');
  assert.equal(josa('VAN', '을/를'), '을(를)');
  assert.equal(josa('', '을/를'), '을(를)');
  assert.equal(messageFor({ code: 'E-REQUIRED', field: 'owner' }), '작성 주체를 입력하거나 고르세요.');
  assert.equal(messageFor({ code: 'E-REQUIRED', field: 'name' }), '이름을 입력하세요(1~100자).');
  assert.equal(messageFor({ code: 'E-REQUIRED', field: 'person_id' }), '사람을 입력하거나 고르세요.');
  assert.equal(messageFor({ code: 'E-REQUIRED', field: 'note' }), '메모 내용을 입력하세요.');
});
