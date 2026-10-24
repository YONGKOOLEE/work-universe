// 다섯 번째 검토(2026-10-03) 재검증에서 나온 규칙 쪽 사례: 반복 비효율의 상위 업무 묶기(7), 범위 밖 메모 표기(8), 실명·번호 알림 범위(6), 의존 방향(9)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SAMPLE_A1 } from '../app/data/sample-a1.js';
import { SAMPLE_EDU } from '../app/data/sample-edu.js';
import { addEdge, addEvent, addNode, hideNode } from '../app/src/model/commands.js';
import { previewImport } from '../app/src/model/import.js';
import { buildView } from '../app/src/view/view.js';
import { buildHandoverDraft } from '../app/src/rules/handover.js';
import { repeatInefficiency } from '../app/src/rules/insight.js';
import { clone } from './helpers.js';
import { hasLongWord } from '../app/src/view/describe.js';

test('그래프 글자 단위 줄바꿈 판정: 띄어쓰기 없이 10자 이상인 낱말이 있을 때만(띄어쓰기 있는 긴 이름은 낱말 경계에서 끊김)', () => {
  assert.equal(hasLongWord('대형가맹점 A 카드승인 전문 송수신'), false);
  assert.equal(hasLongWord('가상 업무 처리 확인 점검 사항'), false);
  assert.equal(hasLongWord('Samsung Business Process'), false);
  assert.equal(hasLongWord('가'.repeat(100)), true);
  assert.equal(hasLongWord('가상 ' + '나'.repeat(10)), true);
  assert.equal(hasLongWord(''), false);
});

const T0 = { now: '2026-10-03T10:00:00+09:00' };
const topicRepeat = (doc) => repeatInefficiency(buildView(doc)).patterns.find((p) => p.kind === 'topic_repeat');
const memo = (doc, target) => addEvent(doc, { type: 'memo', occurred_at: '2026-10-01', payload: { target_id: target, topic_ids: ['N-030'], category: 'issue' }, note: '불일치' }, T0).doc;

test('재검증 7: 하위 업무에 꼭지 포함 연결이 함께 있어도(연결 순서와 무관하게) 상위 업무로 묶인다', () => {
  // 월말 정산: 「자료 수집」(N-002)은 이미 꼭지 ⊃ N-002 연결이 있다. 여기에 「대사 확인」(N-001) ⊃ N-002를 더한다
  const base = clone(SAMPLE_A1);
  assert.ok(base.edges.some((e) => e.core_type === 'contains' && e.source === 'N-000' && e.target === 'N-002'));
  const nested = addEdge(base, { source: 'N-001', target: 'N-002', core_type: 'contains' }, T0).doc;
  assert.equal(topicRepeat(memo(nested, 'N-002')), undefined, '꼭지 연결이 앞에 있어도 한 곳');
  // 연결 순서를 뒤집어도 같다
  const reversed = { ...nested, edges: [...nested.edges].reverse() };
  assert.equal(topicRepeat(memo(reversed, 'N-002')), undefined, '꼭지 연결이 뒤에 있어도 한 곳');
});

test('재검증 7: 포함 관계가 순환이면 묶지 않고 원래 업무로 센다(멈추지 않고, 이름이 뒤바뀌지 않는다)', () => {
  const base = clone(SAMPLE_A1);
  // 명령은 순환을 막으므로 문서를 직접 고쳐 만든다
  const stamp = base.edges[0].created_at;
  base.edges.push({ id: 'L-901', source: 'N-001', target: 'N-002', core_type: 'contains', hidden: false, created_at: stamp });
  base.edges.push({ id: 'L-902', source: 'N-002', target: 'N-001', core_type: 'contains', hidden: false, created_at: stamp });
  const t = topicRepeat(memo(base, 'N-002'));
  assert.ok(t, '서로 다른 두 업무로 센다');
  assert.deepEqual(t.works.map((w) => w.label).sort(), ['대사 확인', '자료 수집']);
});

test('재검증 8: 범위 밖 업무가 숨김이면 메모 표기에 숨김 표시가 붙는다', () => {
  // 교육팀 「강의실·강사 섭외」(N-102) 초안에 주제를 공유한 「신입 교육 운영」(N-101) 메모가 들어온다. N-101을 숨긴다
  const hidden = hideNode(clone(SAMPLE_EDU), 'N-101', T0).doc;
  const d = buildHandoverDraft(buildView(hidden), { target: 'U-C/N-102', from: 'U-C/N-202', to: 'U-C/N-201' }).draft;
  const issues = d.items.find((i) => i.key === '최근_이슈').sentences.map((s) => s.text);
  assert.ok(issues.length > 0);
  for (const t of issues) assert.ok(t.endsWith('(「신입 교육 운영(숨김 처리된 항목)」 메모)'), t); // CR-18-2
});

test('재검증 6: 실명 알림은 문서 변환 결과만, 번호 알림은 이름·사번 칸도 본다(가상 사번 V-####는 아님)', () => {
  const converted = (label, extra = {}) => {
    const d = clone(SAMPLE_A1);
    d.universe = { ...d.universe, id: 'U-X1', is_sample: false, tags: ['문서 변환'] };
    for (const n of d.nodes) n.attrs = { ...(n.attrs || {}), 원문: '§1' };
    const p = d.nodes.find((n) => n.core_type === 'person');
    p.label = label;
    Object.assign(p, extra);
    return d;
  };
  const codes = (d) => previewImport(d, { existing: [] }).warnings.map((w) => w.code);
  // 샘플의 다른 사람(가상 이름)도 함께 걸리므로, 알림에 실린 이름 목록으로 확인한다
  const named = (d) => (previewImport(d, { existing: [] }).warnings.find((w) => w.code === 'W-REAL-NAME-LIKE') || { labels: [] }).labels;
  assert.ok(named(converted('홍길동')).includes('홍길동'));
  for (const role of ['수강생', '강사', '고객', '정산 담당', '팀장', '실장', '개발자', '협력사']) assert.ok(!named(converted(role)).includes(role), role);
  assert.ok(codes(converted('정산 담당', { emp_no: '20190123' })).includes('W-EMPNO-LIKE'), '사번 칸');
  assert.ok(codes(converted('홍길동 20190123')).includes('W-EMPNO-LIKE'), '이름 안의 번호');
  assert.ok(!codes(converted('정산 담당', { emp_no: 'V-1001' })).includes('W-EMPNO-LIKE'), '가상 사번');
  // 내장 샘플을 그대로 내보낸 JSON(원문 근거 없음)은 실명 알림 대상이 아니다
  assert.ok(!codes(clone(SAMPLE_A1)).includes('W-REAL-NAME-LIKE'));
});

test('재검증 9: rules·model·view·merge는 llm을 import하지 않는다(12.7 의존 방향)', () => {
  for (const f of ['rules/handover.js', 'rules/insight.js', 'rules/explain.js', 'rules/flow.js', 'rules/doc-convert.js', 'merge/merge.js', 'view/view.js', 'view/describe.js', 'view/collapse.js', 'model/commands.js', 'model/import.js']) {
    const src = readFileSync(new URL(`../app/src/${f}`, import.meta.url), 'utf8');
    assert.ok(!/from '\.\.\/llm\//.test(src), f);
  }
});
