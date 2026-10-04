// 2026-10-02 두 번째 검토(화면 UI-1·UI-2): 업무 상세의 담당 상태, 반복 비효율 포함 여부
import { test } from 'node:test';
import { allSamples, viewOf } from './helpers.js';
import assert from 'node:assert/strict';
import { SAMPLE_A1 } from '../app/data/sample-a1.js';
import { SAMPLE_CARD } from '../app/data/sample-card.js';
import { SAMPLE_TEAM } from '../app/data/sample-team.js';
import { SAMPLE_EVENT } from '../app/data/sample-event.js';
import { SAMPLE_DEPT } from '../app/data/sample-dept.js';
import { densityGaps, repeatPatternsFor, workLoad } from '../app/src/rules/insight.js';
import { describeNode } from '../app/src/view/describe.js';

const all = allSamples(); // T-13: 부서(U-D1)는 교육팀(U-C)까지 포함
const ASOF = '2026-10-02';

test('업무 상세: 대사 확인은 현재 담당 서하늘, 자료 수집은 마지막 담당 윤바다가 떠난 공백, 2025 행사는 이전 담당자만', () => {
  const v = viewOf('U-D1');
  const a = workLoad(v, 'U-A1/N-001', { asOf: ASOF });
  assert.equal(a.kind, 'covered');
  assert.deepEqual(a.current.map((p) => p.label), ['서하늘']);
  const c = workLoad(v, 'U-A1/N-002', { asOf: ASOF });
  assert.deepEqual([c.kind, c.last_person.label, c.last_end], ['ended', '윤바다', '2026-09-30']);
  const b = workLoad(v, 'U-B/N-101', { asOf: ASOF });
  assert.deepEqual([b.kind, b.last_person.label, b.last_end], ['ended', '윤바다', '2025-12-15']);
  assert.equal(workLoad(v, 'U-B/N-201', { asOf: ASOF }), null); // 사람 노드
});

test('업무 상세의 공백 판정은 밀집·공백 탭의 공백 목록과 같다', () => {
  for (const id of Object.keys(all)) {
    const v = viewOf(id);
    const gaps = new Map(densityGaps(v, { asOf: ASOF }).gaps.map((g) => [g.gid, g.kind]));
    for (const w of v.nodes.filter((n) => n.core_type === 'work' && !n.hidden)) {
      const wl = workLoad(v, w.gid, { asOf: ASOF });
      if (gaps.has(w.gid)) assert.equal(wl.kind, gaps.get(w.gid), `${id} ${w.label}`);
      else if (densityGaps(v, { asOf: ASOF }).status !== 'insufficient') assert.equal(wl.kind, 'covered', `${id} ${w.label}`);
    }
  }
});

test('반복 비효율 포함: 대사 확인(인수인계 반복), 부서 화면의 주제 대사 불일치(주제 반복)', () => {
  assert.deepEqual(repeatPatternsFor(viewOf('U-A1'), 'U-A1/N-001').map((p) => p.kind), ['handover_chain']);
  const d = viewOf('U-D1');
  const topic = d.nodes.find((n) => n.core_type === 'topic' && n.label === '대사 불일치' && !n.hidden);
  assert.ok(repeatPatternsFor(d, topic.gid).some((p) => p.kind === 'topic_repeat'));
  assert.deepEqual(repeatPatternsFor(viewOf('U-A1'), 'U-A1/N-003'), []); // 보고
});

test('상세의 수행 연결에 현재·종료 표시가 붙는다(대사 확인: 서하늘 현재, 한가람·윤바다 종료)', () => {
  const links = describeNode(viewOf('U-A1'), 'U-A1/N-001', { asOf: ASOF }).links.filter((l) => l.relation_type === 'performs');
  const by = Object.fromEntries(links.map((l) => [l.other.label, l.status]));
  assert.deepEqual(by, { 서하늘: '현재', 한가람: '종료', 윤바다: '종료' });
  // 기준일을 주지 않으면 표시하지 않는다(예전 동작)
  assert.ok(describeNode(viewOf('U-A1'), 'U-A1/N-001').links.every((l) => l.status === null));
});
