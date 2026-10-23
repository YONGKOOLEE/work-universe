// 아홉 번째 검토(2026-10-23) 규칙 문장·사전 생성·가상 데이터·변환기 묶음: R-1 R-2 R-4 R-6 E-1 ① D-1 R9-1(가) C-1 C-2 S-3
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_A1 } from '../app/data/sample-a1.js';
import { SAMPLE_DEPT } from '../app/data/sample-dept.js';
import { SAMPLE_TEAM } from '../app/data/sample-team.js';
import { SAMPLES } from '../app/data/index.js';
import { buildView } from '../app/src/view/view.js';
import { eventText } from '../app/src/view/describe.js';
import { buildHandoverDraft } from '../app/src/rules/handover.js';
import { repeatInefficiency, similarExperts, similarSentences } from '../app/src/rules/insight.js';
import { ripple, rippleExplain } from '../app/src/rules/insight-risk.js';
import { openMemos } from '../app/src/rules/issues.js';
import { josa } from '../app/src/model/josa.js';
import { editPoints, rewind } from '../app/src/model/rewind.js';
import { validateDocument } from '../app/src/model/validate.js';
import { CONVERT_RULES, convertDocument } from '../app/src/rules/doc-convert.js';
import { IMPORT_FILE_MAX_BYTES, NOT_A_DEFINITION_NOTICE, fileTooBig, looksNotDefinition } from '../app/src/ui/import.js';
import { IMPORT_MAX_CHARS } from '../app/src/model/import.js';
import { clone, mkDoc, mkEdge, mkNode, viewOf } from './helpers.js';

const steps = (d) => d.items.find((i) => i.key === '세부_업무_절차').sentences.map((s) => s.text);
const orderLines = (d) => steps(d).filter((t) => t.startsWith('진행 순서'));

// ── R-1 진행 순서: 이어진 묶음마다 따로 ──
function twoChains() {
  const works = ['가', '나', '다', '라'].map((l, i) => mkNode(`W${i + 1}`, 'work', `업무${l}`));
  return mkDoc('U-R1', [...works, mkNode('P1', 'person', '보내는', { emp_no: 'V-9001' }), mkNode('P2', 'person', '받는', { emp_no: 'V-9002' })],
    [...works.map((w) => mkEdge('N-000', w.id, 'contains')), mkEdge('W1', 'W2', 'precedes'), mkEdge('W3', 'W4', 'precedes')]);
}
const draftOf = (doc) => buildHandoverDraft(buildView(doc), { target: `${doc.universe.id}/N-000`, from: `${doc.universe.id}/P1`, to: `${doc.universe.id}/P2` }).draft;

test('R-1: 서로 이어지지 않은 선후행 사슬 둘은 「진행 순서 ①」「진행 순서 ②」 두 문장으로 나뉘고 근거도 각자 것이다', () => {
  const d = draftOf(twoChains());
  const lines = orderLines(d);
  assert.deepEqual(lines, ['진행 순서 ①: 업무가 → 업무나', '진행 순서 ②: 업무다 → 업무라']);
  const ev = d.items.find((i) => i.key === '세부_업무_절차').sentences.slice(0, 2).map((s) => s.evidence_ids);
  assert.deepEqual(ev, [['U-R1/W1', 'U-R1/W2'], ['U-R1/W3', 'U-R1/W4']]);
  assert.ok(!steps(d).some((t) => t.includes('업무나 → 업무다')), '무관한 두 사슬을 한 줄로 잇지 않는다');
});

test('R-1: 한 사슬이면 「진행 순서: …」 한 문장 그대로(월말 정산·교육팀·카드승인), 순환이면 문장 없음', () => {
  const a1 = buildHandoverDraft(buildView(SAMPLE_A1), { target: 'U-A1/N-000', from: 'U-A1/N-011', to: 'U-A1/N-012' }).draft;
  assert.deepEqual(orderLines(a1), ['진행 순서: 자료 수집 → 대사 확인 → 보고']);
  const c = buildHandoverDraft(viewOf('U-C'), { target: 'U-C/N-101', from: 'U-C/N-202', to: 'U-C/N-201' }).draft;
  assert.deepEqual(orderLines(c), ['진행 순서: 강의실·강사 섭외 → 만족도 조사']);
  const cyc = twoChains();
  cyc.edges.push(mkEdge('W2', 'W1', 'precedes'));
  assert.deepEqual(orderLines(draftOf(cyc)), []);
});

test('R-1: 부서 샘플(U-D1)의 꼭지 초안은 무관한 사슬을 한 줄로 섞지 않는다', () => {
  const v = viewOf('U-D1');
  const d = buildHandoverDraft(v, { target: 'U-D1/N-000', from: 'U-A1/N-011', to: 'U-A1/N-012' }).draft;
  const lines = orderLines(d);
  assert.ok(lines.length >= 2, `묶음 ${lines.length}`);
  assert.ok(lines.every((t, i) => t.startsWith(`진행 순서 ${'①②③④⑤⑥⑦⑧⑨⑩'[i]}: `)));
  // 한 문장이 13개 업무 교차 같은 긴 사슬이 아니다: 모든 업무가 한 줄에 들어가지 않는다
  const total = lines.reduce((s, t) => s + t.split(' → ').length, 0);
  assert.ok(Math.max(...lines.map((t) => t.split(' → ').length)) < total);
});

// ── R-2 조사 ──
test('R-2: josa — 받침 있으면 이/을/은, 없으면 가/를/는, 한글이 아니면 둘 다 적는다, 끝의 」·공백은 건너뛴다', () => {
  assert.equal(josa('서하늘', '이/가'), '이'); // 늘: ㄹ 받침
  assert.equal(josa('윤바다', '이/가'), '가');
  assert.equal(josa('「대사 불일치」', '이/가'), '가');
  assert.equal(josa('대사 확인 ', '이/가'), '이');
  assert.equal(josa('ABC', '이/가'), '이(가)');
  assert.equal(josa('', '이/가'), '이(가)');
  assert.equal(josa(null, '을/를'), '을(를)');
});

test('R-2: 반복 비효율·파급 영향 문장에 「이(가)」가 남지 않고 받침에 맞는다', () => {
  const rep = repeatInefficiency(viewOf('U-D1')).patterns.find((p) => p.kind === 'topic_repeat');
  assert.ok(rep.summary.startsWith('주제 「대사 불일치」가 '), rep.summary); // 치: 받침 없음
  const text = rippleExplain(ripple(viewOf('U-A1'), { asOf: '2026-10-02' }), 'U-A1').rule.map((s) => s.text).join('\n');
  assert.ok(text.includes('서하늘이 혼자'), text);
  // 받침 없는 이름
  const doc = mkDoc('U-R2', [mkNode('W1', 'work', '가'), mkNode('W2', 'work', '나'), mkNode('P1', 'person', '윤바다', { emp_no: 'V-9003' })],
    [mkEdge('N-000', 'W1', 'contains'), mkEdge('N-000', 'W2', 'contains'), mkEdge('W1', 'W2', 'precedes'), mkEdge('P1', 'W1', 'performs', { period: { start: '2026-01-01' } })]);
  const t2 = rippleExplain(ripple(buildView(doc), { asOf: '2026-10-02' }), 'U-R2').rule.map((s) => s.text).join('\n');
  assert.ok(t2.includes('윤바다가 혼자'), t2);
  for (const s of [rep.summary, text, t2]) assert.ok(!s.includes('이(가)'), s);
});

// ── R-4 유사 경험자 ──
test('R-4: 유사 경험자 문장은 「…」 수행(기간) 순서다', () => {
  const r = similarExperts(viewOf('U-D1'), { works: ['U-A1/N-001'], asOf: '2026-10-02' });
  const t = similarSentences(r).find((s) => s.text.startsWith('윤바다')).text;
  assert.match(t, /「2025 행사」 수행\(2025-05-01 ~ 2025-12-15\)\./);
  assert.ok(!/\d 수행/.test(t), '기간 바로 뒤에 「수행」이 붙지 않는다');
});

// ── R-6 소속 변경 ──
test('R-6: 소속 변경 이벤트 — 양쪽 조직이 다 없으면 괄호 없음, 한쪽만 없으면 그쪽만 「미기재」, 둘 다 있으면 이름', () => {
  const doc = clone(SAMPLE_A1);
  doc.nodes.push({ ...mkNode('N-901', 'org', '가상운영팀') }, { ...mkNode('N-902', 'org', '가상정산팀') });
  const ev = doc.events.find((e) => e.id === 'E-001');
  const text = () => eventText(buildView(doc), buildView(doc).events.find((e) => e.id === 'E-001'));
  assert.equal(text(), '한가람 소속 변경: 조직개편: 가상운영팀 → 가상정산팀 (조직 노드는 U-O에 있음)');
  ev.payload.to_org_id = 'N-902';
  assert.ok(text().startsWith('한가람 소속 변경 (미기재 → 가상정산팀): 조직개편'), text());
  ev.payload.from_org_id = 'N-901';
  assert.ok(text().startsWith('한가람 소속 변경 (가상운영팀 → 가상정산팀): 조직개편'), text());
});

// ── E-1 ① 반복 비효율 요약 단서 ──
test('E-1 ①: 반복 비효율 요약 — 이름만 같은 주제가 섞였을 때만 「이름이 같은 주제 N개 포함, 연결 확인 전」', () => {
  const mixed = repeatInefficiency(viewOf('U-D1')).patterns.find((p) => p.kind === 'topic_repeat');
  assert.match(mixed.summary, /반복됩니다\(이름이 같은 주제 2개 포함, 연결 확인 전\): /);
  // 한 주제 노드만 쓰는 경우에는 단서가 없다: 월말 정산 안의 「자료 수집」에 같은 주제 이슈 메모
  const doc = clone(SAMPLE_A1);
  doc.events.push({ id: 'E-901', type: 'memo', occurred_at: '2026-10-01', recorded_at: '2026-10-01T10:00:00+09:00', source: 'user', payload: { target_id: 'N-002', topic_ids: ['N-030'], category: 'issue' }, note: '불일치' });
  const one = repeatInefficiency(buildView(doc)).patterns.find((p) => p.kind === 'topic_repeat');
  assert.ok(one && !one.summary.includes('이름이 같은 주제'), one && one.summary);
});

// ── D-1 가상 데이터 ──
test('D-1(a): 월말 정산 E-012는 해결 메모 E-020(resolves_id)이 닫아 미해결 이슈에서 빠진다', () => {
  const v = viewOf('U-A1');
  const open = openMemos(v).map((e) => e.id);
  assert.ok(!open.includes('E-012'));
  const r = SAMPLE_A1.events.find((e) => e.id === 'E-020');
  assert.equal(r.payload.category, 'resolved');
  assert.equal(r.payload.resolves_id, 'E-012');
});

test('D-1(b): 팀·부서 꼭지 노드의 설명은 유니버스 설명과 같은 글이다', () => {
  for (const d of [SAMPLE_TEAM, SAMPLE_DEPT]) {
    const root = d.nodes.find((n) => n.id === d.universe.root_node_id);
    assert.equal(root.description, d.universe.description, d.universe.id);
  }
});

// ── R9-1(가) 편집 되감기 시연용 수정 이력 ──
test('R9-1(가): 월말 정산 샘플에는 되감기 시점이 셋 이상이고 시각은 서로 다른 분이다', () => {
  const pts = editPoints(SAMPLE_A1);
  assert.ok(pts.length >= 3, `시점 ${pts.length}`);
  assert.equal(new Set(pts.map((p) => p.at.slice(0, 16))).size, pts.length);
  for (const p of pts) assert.ok(Date.parse(p.at) < Date.parse(SAMPLE_A1.universe.created_at), p.at); // 수정 이력은 이 판의 표시(STAMP)보다 앞선 과거
  assert.ok(Date.parse(SAMPLE_A1.universe.created_at) <= Date.now());
  // 이력 배열이 시간순이어야 되감기가 맞게 자른다
  const times = SAMPLE_A1.events.map((e) => Date.parse(e.recorded_at));
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
});

test('R9-1(가): before·after가 지금 노드와 맞고, 어느 시점으로 되감아도 검증을 통과하며 옛 값이 나온다', () => {
  const upd = SAMPLE_A1.events.filter((e) => e.type === 'updated');
  assert.equal(upd.length, 2);
  for (const e of upd) {
    const n = SAMPLE_A1.nodes.find((x) => x.id === e.payload.target_id);
    for (const [k, v] of Object.entries(e.payload.after)) assert.deepEqual(n[k], v, `${n.id}.${k}`);
    assert.equal(n.updated_at, e.recorded_at, `${n.id}.updated_at은 그 노드의 마지막 이력 시각`);
    for (const [k, v] of Object.entries(e.payload.before)) assert.notDeepEqual(n[k], v, `${n.id}.${k} before는 옛 값`);
  }
  const pts = editPoints(SAMPLE_A1);
  for (const p of pts) {
    const r = rewind(SAMPLE_A1, p.at);
    assert.equal(r.ok, true);
    assert.deepEqual(validateDocument(r.doc).errors, [], p.at);
  }
  const first = rewind(SAMPLE_A1, pts[0].at).doc;
  assert.equal(first.nodes.find((n) => n.id === 'N-001').attrs.마감, '월 마감 후 5영업일 이내');
  assert.equal(first.nodes.find((n) => n.id === 'N-003').description, '점검 결과를 보고한다');
  const mid = rewind(SAMPLE_A1, pts[1].at).doc;
  assert.equal(mid.nodes.find((n) => n.id === 'N-001').attrs.마감, '월 마감 후 3영업일 이내');
  assert.equal(mid.nodes.find((n) => n.id === 'N-003').description, '점검 결과를 보고한다');
  const last = rewind(SAMPLE_A1, pts.at(-1).at);
  assert.deepEqual(last.diff, { added: [], changed: [], hidden: [] });
});

test('내장 샘플의 기록 시각(수정 이력 포함)은 미래가 아니다', () => {
  for (const d of SAMPLES) for (const t of [d.universe.created_at, ...d.nodes.flatMap((n) => [n.created_at, n.updated_at]), ...d.events.map((e) => e.recorded_at)].filter(Boolean)) {
    assert.ok(Date.parse(t) <= Date.now(), `${d.universe.id} ${t}`);
  }
});

// ── 변환기 C-1·C-2 ──
const ctx = { now: '2026-10-03T10:00:00+09:00', random: () => 0.5 };
test('C-1: 제목도 범위도 없는 글은 업무 이름을 40자로 자르고 전체를 설명에 둔다', () => {
  const text = '안녕하세요 이번 달 정산 관련해서 확인 부탁드립니다 감사합니다 그리고 다음주 회의에 대해서도 말씀 드립니다 잘 부탁드려요';
  const r = convertDocument(text, ctx);
  assert.equal(r.ok, true);
  const w = r.doc.nodes.find((n) => n.core_type === 'work');
  assert.equal(w.label.length, CONVERT_RULES.workLabelMax);
  assert.ok(w.label.endsWith('…'));
  assert.ok(text.startsWith(w.label.slice(0, -1)));
  assert.equal(w.description, text);
  assert.deepEqual(validateDocument({ ...r.doc, universe: { ...r.doc.universe, owner: '가상팀' } }).errors, []);
  // 짧은 이름은 그대로, 설명 없음
  const s = convertDocument('짧은 글 하나', ctx).doc.nodes.find((n) => n.core_type === 'work');
  assert.equal(s.label, '짧은 글 하나');
  assert.equal(s.description, undefined);
});

test('C-1: 제목도 범위도 못 찾은 변환(C-NO-STRUCTURE + C-NO-SCOPE)만 「업무정의서가 아님」 판정이 선다', () => {
  assert.equal(looksNotDefinition(convertDocument('안녕하세요 확인 부탁드립니다', ctx).report), true);
  assert.equal(looksNotDefinition(convertDocument('# 월말 정산\n## 1. 개요\n- 목적: 매월 말 정산을 점검한다\n', ctx).report), false); // 제목은 있음
  assert.equal(looksNotDefinition({ notes: [{ code: 'C-NO-SCOPE' }] }), false);
  assert.equal(looksNotDefinition({ notes: [{ code: 'C-NO-STRUCTURE' }] }), false);
  assert.equal(looksNotDefinition(null), false);
  assert.match(NOT_A_DEFINITION_NOTICE, /^제목·범위를 찾지 못했습니다\. 업무정의서가 아니거나 모양이 다른 글입니다 — 「예시 문서 넣기」/);
});

// ── S-3 파일 크기 선검사 ──
test('S-3: 글자 수 상한 × 3바이트를 넘는 파일은 읽지 않는다', () => {
  assert.equal(IMPORT_FILE_MAX_BYTES, IMPORT_MAX_CHARS * 3);
  assert.equal(fileTooBig(IMPORT_FILE_MAX_BYTES), false);
  assert.equal(fileTooBig(IMPORT_FILE_MAX_BYTES + 1), true);
  assert.equal(fileTooBig(300 * 1024 * 1024), true);
  assert.equal(fileTooBig(1024), false);
  assert.equal(fileTooBig(undefined), false);
  assert.equal(fileTooBig(NaN), false);
});
