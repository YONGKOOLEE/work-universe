import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_A1 } from '../app/data/sample-a1.js';
import { SAMPLE_CARD } from '../app/data/sample-card.js';
import { SAMPLE_TEAM } from '../app/data/sample-team.js';
import { addRef, hideRef, updateNode } from '../app/src/model/commands.js';
import { validateDocument } from '../app/src/model/validate.js';
import { buildView } from '../app/src/view/view.js';
import { exposureOf, projectView } from '../app/src/view/collapse.js';

const all = { 'U-A1': SAMPLE_A1, 'U-K1': SAMPLE_CARD, 'U-T1': SAMPLE_TEAM };
const resolve = (id) => all[id] || null;
const ctx = { now: '2026-10-01T22:00:00+09:00' };
const teamView = () => buildView(SAMPLE_TEAM, resolve);
const labels = (p, u) => p.nodes.filter((n) => !u || n.universe_id === u).map((n) => n.label).sort();

test('팀 유니버스 샘플은 검증을 통과한다(주제 동일성 연결, 참조 이벤트)', () => {
  assert.deepEqual(validateDocument(SAMPLE_TEAM).errors, []);
});

test('계산용 전체 뷰는 하위 노드를 모두 가진다(대사 주제는 하나로 합쳐짐)', () => {
  const v = teamView();
  assert.equal(v.nodes.length, 1 + SAMPLE_A1.nodes.length + SAMPLE_CARD.nodes.length - 1);
  assert.equal(v.canonical('U-K1/N-314'), 'U-A1/N-030');
});

test('접힌 화면: 꼭지·담당자·최상위 업무·공유 주제만 보인다', () => {
  const p = projectView(teamView());
  assert.deepEqual(labels(p, 'U-A1'), ['대사 불일치', '대사 확인', '보고', '서하늘', '월말 정산 점검', '윤바다', '자료 수집', '한가람']);
  assert.deepEqual(labels(p, 'U-K1'), [
    'A사 결제 담당', '거래 조회', '대형가맹점 A 카드승인 전문 송수신', '망취소', '승인', '승인취소', '운영 담당',
    '장애 시 재처리', '정산 담당', '카드사/VAN 연동 담당',
  ]);
  assert.equal(p.nodes.length, 1 + 8 + 10);
  for (const hiddenLabel of ['요청 검증', '타임아웃', '전문 명세서', '가상 카드사·VAN', '보안 담당', '2026-06 인수인계서']) {
    assert.ok(!p.nodes.some((n) => n.label === hiddenLabel), hiddenLabel);
  }
  // 공유 주제는 A1 쪽 대표 노드로 보이므로 K1에서 가려진 수에 들어가지 않는다
  assert.equal(p.collapsed.get('U-K1').hidden_count, SAMPLE_CARD.nodes.length - 10 - 1);
});

test('요약 연결: 처리 단계를 수행한 역할은 그 단계를 포함한 업무로 올라가 이어진다', () => {
  const p = projectView(teamView());
  const e = p.edges.find((x) => x.source === 'U-K1/N-501' && x.core_type === 'performs');
  assert.equal(e.target, 'U-K1/N-101'); // A사 결제 담당 → (승인요청 수신 →) 승인
  assert.equal(e.summarized, true);
  const ops = p.edges.filter((x) => x.source === 'U-K1/N-503' && x.core_type === 'performs').map((x) => x.target).sort();
  assert.deepEqual(ops, ['U-K1/N-103', 'U-K1/N-105']); // 운영 담당: 재처리 + (정합성 조치 →) 망취소
});

test('공유 주제가 두 업무 유니버스를 잇는다', () => {
  const p = projectView(teamView());
  const into = p.edges.filter((e) => e.target === 'U-A1/N-030' && e.core_type === 'relates_to').map((e) => e.source).sort();
  assert.deepEqual(into, ['U-A1/N-001', 'U-K1/N-104', 'U-K1/N-105', 'U-K1/N-505']); // 정산 담당도 대사 주제와 관련
});

test('팀 꼭지 → 업무 꼭지 참조 연결이 보이고, 모든 연결의 끝점은 보이는 노드다', () => {
  const p = projectView(teamView());
  const ids = new Set(p.nodes.map((n) => n.gid));
  for (const e of p.edges) assert.ok(ids.has(e.source) && ids.has(e.target), e.gid);
  assert.equal(p.edges.filter((e) => e.synthetic).length, 2);
});

test('펼치면 그 유니버스의 모든 노드가 보이고 다른 유니버스는 접힌 채로 남는다', () => {
  const p = projectView(teamView(), { expanded: new Set(['U-K1']) });
  assert.equal(labels(p, 'U-K1').length, SAMPLE_CARD.nodes.length - 1);
  assert.equal(labels(p, 'U-A1').length, 8);
  assert.ok(!p.collapsed.has('U-K1'));
});

test('업무 유니버스를 단독으로 열면 접는 것 없이 모두 보인다', () => {
  const p = projectView(buildView(SAMPLE_CARD));
  assert.equal(p.nodes.length, SAMPLE_CARD.nodes.length);
  assert.equal(p.collapsed.size, 0);
});

test('드러내기 직접 지정: 기본 규칙보다 우선한다', () => {
  const k1 = updateNode(SAMPLE_CARD, 'N-304', { exposed: true }, ctx).doc; // 타임아웃 주제를 드러냄
  const k2 = updateNode(k1, 'N-504', { exposed: true }, ctx).doc; // 보안 담당을 드러냄
  const k3 = updateNode(k2, 'N-105', { exposed: false }, ctx).doc; // 장애 시 재처리 업무를 숨김
  const v = buildView(SAMPLE_TEAM, (id) => (id === 'U-K1' ? k3 : resolve(id)));
  assert.deepEqual(exposureOf(v, 'U-K1/N-304'), { exposed: true, explicit: true, reason: '직접 드러냄' });
  const p = projectView(v);
  assert.ok(p.nodes.some((n) => n.label === '타임아웃'));
  assert.ok(p.nodes.some((n) => n.label === '보안 담당'));
  assert.ok(!p.nodes.some((n) => n.label === '장애 시 재처리'));
  assert.equal(updateNode(SAMPLE_CARD, 'N-304', { exposed: 'yes' }, ctx).error.code, 'E-SCHEMA');
});

test('기본 규칙의 이유가 나온다', () => {
  const v = teamView();
  assert.equal(exposureOf(v, 'U-K1/N-202').reason, '하위 업무');
  assert.equal(exposureOf(v, 'U-K1/N-504').reason, '담당 업무 없음');
  assert.equal(exposureOf(v, 'U-K1/N-314').reason, '다른 유니버스와 공유한 주제');
  assert.equal(exposureOf(v, 'U-K1/N-601').reason, '세부 정보');
});

test('참조 추가: 원본 불변, 이벤트 기록, 중복·자기 자신·순환·없는 유니버스는 거부', () => {
  const empty = { ...SAMPLE_TEAM, refs: [], events: [] };
  const r = addRef(empty, 'U-A1', ctx, resolve);
  assert.equal(r.ok, true);
  assert.deepEqual(r.event.payload, { target_kind: 'ref', target_id: 'U-A1' });
  assert.equal(validateDocument(r.doc).ok, true);
  assert.equal(addRef(r.doc, 'U-A1', ctx, resolve).error.code, 'E-DUP');
  assert.equal(addRef(r.doc, 'U-T1', ctx, resolve).error.code, 'E-CYCLE');
  assert.equal(addRef(r.doc, 'U-없음', ctx, resolve).error.code, 'E-SCHEMA');
  // 업무 유니버스가 팀을 참조하려 하면(팀 → 업무 → 팀) 순환
  assert.equal(addRef(SAMPLE_A1, 'U-T1', ctx, resolve).error.code, 'E-CYCLE');
});

test('참조 해제: 기록은 남고 화면·계산에서 빠지며, 다시 추가할 수 있다', () => {
  const r = hideRef(SAMPLE_TEAM, 'U-K1', ctx);
  assert.equal(r.ok, true);
  assert.equal(r.doc.refs.length, 2);
  assert.equal(r.doc.refs.find((x) => x.child_universe_id === 'U-K1').hidden, true);
  assert.equal(r.event.type, 'hidden');
  assert.deepEqual(validateDocument(r.doc).errors, []);
  const v = buildView(r.doc, resolve);
  assert.ok(!v.nodes.some((n) => n.universe_id === 'U-K1'));
  assert.equal(hideRef(r.doc, 'U-K1', ctx).error.code, 'E-SCHEMA');
  const again = addRef(r.doc, 'U-K1', ctx, resolve);
  assert.equal(again.ok, true);
  assert.deepEqual(validateDocument(again.doc).errors, []);
});

test('주제 동일성 연결은 사람 확인만 허용한다', () => {
  const d = JSON.parse(JSON.stringify(SAMPLE_TEAM));
  d.identity_links[0].method = 'emp_no_auto';
  assert.deepEqual(validateDocument(d).errors.map((e) => e.code), ['E-SCHEMA']);
});
