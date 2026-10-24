import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLES } from '../app/data/index.js';
import { SAMPLE_A1 } from '../app/data/sample-a1.js';
import { ANSWERS_V1 } from '../app/data/answers-v1.js';
import { validateDocument } from '../app/src/model/validate.js';
import { buildView, parseGid } from '../app/src/view/view.js';
import { scanVirtualData } from '../tools/virtual-data-check.mjs';
import { clone, viewOf } from './helpers.js';

const view = buildView(SAMPLE_A1);

test('내장 샘플은 모두 검증을 통과한다(불러오기 성공)', () => {
  for (const doc of SAMPLES) {
    const r = validateDocument(doc);
    assert.deepEqual(r.errors, [], doc.universe.id);
    // 사번 없는 사람은 외부 기관 역할(변환 사례의 A사 결제 담당)과 설계 4절의 예외 사례(U-C 임가온, T-13)만 허용한다
    for (const w of r.warnings) {
      assert.equal(w.code, 'W-NO-EMPNO', doc.universe.id);
      const n = doc.nodes.find((x) => x.id === w.target_id);
      assert.ok(n.subtype === '역할' || (doc.universe.id === 'U-C' && n.label === '임가온'), `${doc.universe.id} ${n.label}`);
    }
  }
});

test('사례 1: 설계 4절의 노드가 모두 있다', () => {
  const labels = (type) => SAMPLE_A1.nodes.filter((n) => n.core_type === type).map((n) => n.label).sort();
  assert.deepEqual(labels('person'), ['서하늘', '윤바다', '한가람']);
  assert.deepEqual(labels('work'), ['대사 확인', '보고', '자료 수집']);
  assert.deepEqual(labels('artifact'), ['2026-06 인수인계서', '점검표 양식']);
  assert.deepEqual(labels('topic'), ['대사 불일치']);
  assert.deepEqual(SAMPLE_A1.nodes.filter((n) => n.core_type === 'person').map((n) => n.emp_no).sort(), ['V-1001', 'V-1002', 'V-1003']);
});

test('사례 1: 설계 4절의 이벤트 4건이 모두 있다', () => {
  const find = (fn) => SAMPLE_A1.events.find(fn);
  // 2025-03 한가람 담당 시작
  assert.ok(find((e) => e.type === 'assign_start' && e.occurred_at.startsWith('2025-03') && e.payload.person_id === 'N-010'));
  // 2026-01 소속 변경(조직개편)
  assert.ok(find((e) => e.type === 'affiliation_change' && e.occurred_at.startsWith('2026-01') && e.payload.person_id === 'N-010'));
  // 2026-06 인수인계(한가람 → 윤바다, 근거: 2026-06 인수인계서)
  const h = find((e) => e.type === 'handover' && e.occurred_at.startsWith('2026-06'));
  assert.deepEqual([h.payload.from_person_id, h.payload.to_person_id, h.payload.artifact_id], ['N-010', 'N-011', 'N-020']);
  // 2026-09 메모
  assert.equal(find((e) => e.type === 'memo' && e.occurred_at.startsWith('2026-09')).note, '대사 불일치 3건 재발');
});

test('담당 이력이 이어지고 겹치지 않는다: 한가람 → 윤바다 → 서하늘(현재)', () => {
  const performs = SAMPLE_A1.edges.filter((e) => e.core_type === 'performs' && e.target === 'N-001')
    .sort((a, b) => a.period.start.localeCompare(b.period.start));
  assert.deepEqual(performs.map((e) => e.source), ['N-010', 'N-011', 'N-012']);
  assert.equal(performs[2].period.end, undefined); // 서하늘이 현재 담당
  for (let i = 0; i < 2; i += 1) assert.ok(performs[i].period.end < performs[i + 1].period.start);
});

test('이벤트 시점이 순서대로이고 소속 변경 뒤에도 업무 이력이 이어진다(R-14)', () => {
  const ev = view.index.eventsByNode.get('U-A1/N-001');
  assert.deepEqual(ev.map((e) => e.occurred_at), [...ev.map((e) => e.occurred_at)].sort());
  const dates = view.events.map((e) => e.occurred_at);
  assert.ok(dates.includes('2026-01-01') && dates.some((d) => d > '2026-01-01'));
});

test('반복 비효율 조건: 같은 업무의 인수인계 2회 이상, 마지막 것이 이전 인수인계서를 참조하지 않는다', () => {
  const handovers = SAMPLE_A1.events.filter((e) => e.type === 'handover' && e.payload.work_id === 'N-001');
  assert.equal(handovers.length, 2);
  const last = handovers.at(-1);
  assert.equal(last.payload.previous_handover_id, undefined);
  assert.equal(last.payload.artifact_id, undefined);
});

test('정답 표의 근거 ID는 모두 데이터에 있다(근거 ID 유효율 100%)', () => {
  const ids = [];
  for (const d of ANSWERS_V1.handover_drafts) {
    ids.push(d.target, d.from, d.to);
    for (const item of Object.values(d.items)) ids.push(...item.evidence);
  }
  for (const r of ANSWERS_V1.repeat_inefficiency) ids.push(r.work, ...r.evidence);
  assert.ok(ids.length > 10);
  // 유사 경험자 정답은 자기 화면(view)의 데이터에서 찾는다(CR-17 B: SE-3의 업무는 행사팀 소속이라 월말 정산 단독 화면에 없다)
  for (const s of ANSWERS_V1.similar_experts) assert.ok(viewOf(s.view).lookup(s.work).found, `근거 ID가 데이터에 없음: ${s.work}`);

  const eventGids = new Set(view.events.map((e) => e.gid));
  for (const gid of ids) {
    const { local_id } = parseGid(gid);
    const ok = local_id.startsWith('E-') ? eventGids.has(gid) : view.lookup(gid).found;
    assert.ok(ok, `근거 ID가 데이터에 없음: ${gid}`);
  }
});

test('정답 표: 초안 11개 항목(CR-6, CR-17 E)이 모두 있고, 확정 대기 항목에는 결정 작업이 적혀 있다', () => {
  const items = ANSWERS_V1.handover_drafts[0].items;
  assert.deepEqual(Object.keys(items), ['업무_개요', '받는_범위', '세부_업무_절차', '일정_마감', '주의사항', '진행_중', '산출물_문서', '관계자_연락처', '최근_이슈', '이전_인수인계', '유사_경험자']);
  for (const item of Object.values(items)) if (item.status === 'pending') assert.ok(item.decide_in);
});

// 검토5 I-1(CR-9-j 후보): 같은 두 사람 사이의 과거 인수인계도 「이전 인수인계」에 들어간다. E-007(2026-09-30 구두)은
// 초안을 만드는 날(asOf)이 그날이 아니면 과거 기록이므로 근거에 포함된다
test('정답 표: 이전 인수인계에 과거 구두 인수인계(E-007)와 문서 인수인계(E-002)가 모두 들어간다', () => {
  const item = ANSWERS_V1.handover_drafts[0].items['이전_인수인계'];
  assert.ok(item.evidence.includes('U-A1/E-007'));
  assert.ok(item.evidence.includes('U-A1/E-002'));
});

test('R-06 형식 점검: 내장 샘플에 위반이 없다', () => {
  for (const doc of SAMPLES) assert.deepEqual(scanVirtualData(doc), [], doc.universe.id);
});

test('R-06 형식 점검: 위반을 실제로 잡아낸다', () => {
  const d = clone(SAMPLE_A1);
  d.nodes[4].emp_no = '2019123456'; // 실제 사번 형식 같은 값
  d.nodes[1].description = '문의 hong@example.com 또는 02-123-4567';
  d.events[0].note = 'https://intranet.example/x';
  d.universe.is_sample = false;
  const rules = scanVirtualData(d).map((p) => p.rule).sort();
  assert.deepEqual(rules, ['URL', '사번 형식(V-####)', '샘플 유니버스는 is_sample=true', '이메일 주소', '전화번호'].sort());
});
