// 네 번째 검토(2026-10-03, N-3: T-17·결정 반영분, 하위 에이전트 3범주)에서 재현된 결함의 회귀 테스트
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertDocument, parseDocument } from '../app/src/rules/doc-convert.js';
import { validateDocument } from '../app/src/model/validate.js';
import { createApp } from '../app/src/app/app.js';
import { createStore } from '../app/src/store/local.js';
import { SAMPLES } from '../app/data/index.js';
import { SAMPLE_A1 } from '../app/data/sample-a1.js';
import { buildView } from '../app/src/view/view.js';
import { projectView } from '../app/src/view/collapse.js';
import { updateNode } from '../app/src/model/commands.js';
import { allowedRelations } from '../app/src/model/schema.js';
import { messageFor } from '../app/src/ui/messages.js';
import { scopeHint } from '../app/src/ui/draft.js';
import { clone } from './helpers.js';

const ctx = { now: '2026-10-03T10:00:00+09:00', random: () => 0.5 };
const conv = (t) => convertDocument(t, ctx).doc;
const withOwner = (d) => ({ ...d, universe: { ...d.universe, owner: '가상' } });
const valid = (d) => validateDocument(withOwner(d));
const labels = (d, type) => d.nodes.filter((n) => n.core_type === type).map((n) => n.label);

// ── 변환기 ──
test('같은 제목의 절이 둘이면 주제 하나로 합치고 설명을 잇는다(연결 중복 없음)', () => {
  const d = conv('# 업무\n## 1. 범위\n- 정산\n## 2. 처리\n### 2.1 예외\n- 정산 실패 시 재시도\n## 3. 점검\n### 3.1 예외\n- 정산 누락 시 보고\n## 4. 이해관계자\n- 예외 담당');
  assert.equal(valid(d).ok, true);
  const t = d.nodes.find((n) => n.label === '예외');
  assert.equal(t.attrs.원문, '§2.1, §3.1');
  assert.match(t.description, /재시도[\s\S]*누락/);
  assert.equal(d.edges.filter((e) => e.target === t.id && e.core_type === 'relates_to').length, 2); // 정산 → 예외, 예외 담당 → 예외 각 1번
});

test('첫 칸이 빈 표 행(병합 셀)은 앞 행에 붙이고, 앞 행이 없으면 건너뛴다(이름 없는 노드 없음)', () => {
  const d = conv('# 업무\n## 1. 범위\n| 업무 | 설명 |\n|---|---|\n| 정산 | 월말 |\n|  | 추가 설명 |\n## 2. 이해관계자\n| 역할 | 하는 일 |\n|---|---|\n|  | 정산 |\n');
  assert.equal(valid(d).ok, true);
  assert.equal(d.nodes.find((n) => n.label === '정산').description, '월말 추가 설명');
  assert.deepEqual(labels(d, 'person'), []);
});

test('워드 번호 목록의 탭("1)\\t…", "①\\t…")은 표가 아니라 목록', () => {
  const d = conv('가상 정산 업무\n\n1.\t개요\n업무명: 가상 정산\n2.\t업무 범위\n1)\t카드 승인 정산\n2)\t매입 대사\n3.\t산출물\n①\t정산표\n');
  assert.deepEqual(labels(d, 'work'), ['카드 승인 정산', '매입 대사']);
  assert.deepEqual(labels(d, 'artifact'), ['정산표']);
});

test('목록이 제목으로 잘못 읽히지 않는다: ■ 아래 1., 범위 아래 가., 로마 숫자 제목 아래 번호', () => {
  assert.deepEqual(labels(conv('가상 정산 업무\n■ 업무 범위\n1. 카드 승인 정산\n2. 매입 대사\n■ 이해관계자\n가. 정산 담당: 매입 대사\n'), 'work'), ['카드 승인 정산', '매입 대사']);
  assert.deepEqual(labels(conv('가상 정산 업무\n1. 업무 범위\n가. 카드 승인 정산\n나. 매입 대사\n2. 기타\n내용'), 'work'), ['카드 승인 정산', '매입 대사']);
  const roman = conv('가상 업무\nⅠ. 개요\n1. 목적\n정산을 한다\nⅡ. 업무 범위\n1. 카드 승인 정산\n2. 매입 대사\n');
  assert.deepEqual(labels(roman, 'work'), ['카드 승인 정산', '매입 대사']);
  assert.equal(roman.nodes[0].description, '정산을 한다');
});

test('[가정]·[미확인] 표시: 괄호 안 쉼표·콜론에서 자르지 않고, 이름에서 뺀 표시는 attrs.표시에 남긴다', () => {
  const a = conv('# 업무\n## 1. 개요\n- 범위: 승인 정산, 매입 대사 [미확인: 카드사, VAN]');
  assert.deepEqual(labels(a, 'work'), ['승인 정산', '매입 대사']);
  assert.equal(a.nodes.find((n) => n.label === '매입 대사').attrs.표시, '[미확인: 카드사, VAN]');
  const b = conv('# 가상 정산 [가정: 이름 미정]\n## 1. 범위\n- 정산\n## 2. 이해관계자\n- 정산 담당 [미확인: 인원]\n## 3. 산출물\n- 정산표 [가정: 월 1회]');
  assert.equal(valid(b).ok, true);
  assert.deepEqual([b.nodes[0].label, b.nodes[0].attrs.표시, b.nodes[0].attrs.상태], ['가상 정산', '[가정: 이름 미정]', '가정']);
  assert.equal(b.nodes.find((n) => n.label === '정산 담당').attrs.표시, '[미확인: 인원]');
  assert.equal(b.nodes.find((n) => n.label === '정산표').attrs.표시, '[가정: 월 1회]');
  const c = conv('# [미확인]\n## 1. 범위\n- 정산');
  assert.equal(c.universe.name, '이름 없는 문서');
  assert.equal(valid(c).ok, true);
});

test('일반 글에 | 줄이 하나 있어도 제목 규칙을 쓴다, "개요 및 범위"의 키: 값은 업무가 아니다, 제목의 괄호는 머리 메모로', () => {
  assert.deepEqual(labels(conv('가상 정산\n1. 개요\n업무명: 가상 정산\n2. 업무 범위\n- 카드 승인 정산\n- 매입 대사\n3. 참고\n| 비고 |'), 'work'), ['카드 승인 정산', '매입 대사']);
  assert.deepEqual(labels(conv('# 업무\n## 1. 개요 및 범위\n- 업무명: 가상 정산\n- 범위: 승인 정산, 매입 대사'), 'work'), ['승인 정산', '매입 대사']);
  assert.match(conv('# 업무\n## 1. 예외(장애) 처리\n- 재시도한다').nodes.find((n) => n.label === '예외 처리').description, /^\(장애\)\n- 재시도한다$/);
});

test('긴 공백이 든 제목·빈 줄이 많은 글도 빠르게 끝난다(백트래킹 없음)', () => {
  const t0 = Date.now();
  parseDocument(`# a${' '.repeat(8000)}b\n`);
  parseDocument('\n'.repeat(100000) + '끝');
  assert.ok(Date.now() - t0 < 500, `${Date.now() - t0}ms`);
});

// ── 가져오기 ──
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const open = (storage, id) => createApp({ store: createStore(storage), samples: SAMPLES, currentId: id, now: () => ctx.now });

test('가져오기: 다른 유니버스를 거쳐 돌아오는 순환 참조는 거부(E-CYCLE)', () => {
  const app = open(memoryStorage());
  const d = clone(SAMPLE_A1);
  d.refs = [{ child_universe_id: 'U-T1', added_at: ctx.now }]; // U-T1은 U-A1을 참조한다
  const p = app.previewImport(d);
  assert.equal(p.ok, false);
  assert.ok(p.errors.some((e) => e.code === 'E-CYCLE'));
  assert.equal(app.importUniverse(d, { overwrite: true }).ok, false);
});

test("가져오기: ID에 '/'나 공백이 있으면 형식 오류", () => {
  const d = clone(SAMPLE_A1);
  d.universe.id = 'X/1';
  assert.ok(validateDocument(d).errors.some((e) => e.path === 'universe.id' && e.bad_id));
  const n = clone(SAMPLE_A1);
  n.nodes[1].id = 'N 001';
  assert.ok(validateDocument(n).errors.some((e) => e.path === 'nodes[1].id'));
});

test('가져오기: 예전 판 샘플 백업은 지금 판의 "고친 샘플"로 남고, 샘플이 아닌 ID의 샘플 표시는 지운다', () => {
  const storage = memoryStorage();
  const app = open(storage);
  const old = clone(SAMPLE_A1);
  old.universe.created_at = '2026-01-01T00:00:00+09:00';
  old.universe.description = '백업 판';
  const p = app.previewImport(old);
  assert.ok(p.warnings.some((w) => w.code === 'W-SAMPLE-OVERWRITE'));
  assert.equal(app.importUniverse(old, { overwrite: true }).ok, true);
  const again = open(storage, 'U-A1');
  assert.equal(again.doc.universe.description, '백업 판', '다시 열어도 샘플로 바뀌지 않는다');
  assert.deepEqual(again.warnings, []);
  const fake = clone(SAMPLE_A1);
  fake.universe.id = 'U-COPY1';
  fake.universe.name = '월말 정산 사본';
  assert.ok(app.previewImport(fake).warnings.some((w) => w.code === 'W-SAMPLE-FLAG'));
  assert.equal(app.importUniverse(fake).doc.universe.is_sample, false);
  assert.ok(open(storage).universes().find((u) => u.id === 'U-COPY1').is_sample === false);
});

// ── 층별 보기·초안·안내 ──
test('합쳐진 노드: 원본 하나에 「위층에 드러내기」를 끄면 다른 원본의 기본 규칙이 있어도 숨는다', () => {
  const resolve = (id) => SAMPLES.find((s) => s.universe.id === id);
  const a1 = updateNode(resolve('U-A1'), 'N-011', { exposed: false }, { now: ctx.now }).doc;
  const res2 = (id) => (id === 'U-A1' ? a1 : resolve(id));
  const v = buildView(resolve('U-D1'), res2);
  const yoon = v.nodes.find((n) => n.label === '윤바다');
  assert.ok(yoon.merged_from.length > 0);
  assert.ok(!projectView(v).nodes.some((n) => n.gid === yoon.gid));
  // 지정이 없으면 예전처럼 기본 규칙(담당자)으로 보인다
  assert.ok(projectView(buildView(resolve('U-D1'), resolve)).nodes.some((n) => n.label === '윤바다'));
});

test('초안 안내: 꼭지 범위가 화면의 업무를 모두 덮으면(부서·팀 꼭지 포함) 이유에 안내를 붙인다', () => {
  const resolve = (id) => SAMPLES.find((s) => s.universe.id === id);
  for (const id of ['U-A1', 'U-D1', 'U-T1']) {
    const v = buildView(resolve(id), resolve);
    assert.match(scopeHint(v, `${id}/${resolve(id).universe.root_node_id}`, '없음'), /화면 안에 비교할 다른 업무가 없습니다/, id);
  }
  const v = buildView(resolve('U-D1'), resolve);
  assert.equal(scopeHint(v, 'U-A1/N-001', '없음'), '없음');
});

test('연결 오류 안내: 어느 방향이든 되는 관계는 "어느 방향이든"', () => {
  const t = messageFor({ code: 'E-PAIR' }, { kind: 'edge', relation: 'performs', source: { label: '주제', core_type: 'topic' }, target: { label: '문서', core_type: 'artifact' }, suggestions: allowedRelations('topic', 'artifact') });
  assert.match(t, /「참조」\(어느 방향이든\)/);
  assert.match(t, /「관련」\(문서 → 주제\)/);
});
