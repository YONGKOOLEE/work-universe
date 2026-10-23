// 다섯 번째 검토(2026-10-03, docs/review-2026-10-03.md) — 가상 데이터 안전망 V-2·V-7
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { SAMPLES, SAMPLE_GUIDE } from '../app/data/index.js';
import { SAMPLE_A1 } from '../app/data/sample-a1.js';
import { ANSWERS_V1 } from '../app/data/answers-v1.js';
import { PREGEN } from '../app/data/pregen.js';
import { scanVirtualData } from '../tools/virtual-data-check.mjs';
import { clone } from './helpers.js';

const labels = new Set(SAMPLES.flatMap((d) => d.nodes.map((n) => n.label)));
const universeNames = new Set(SAMPLES.map((d) => d.universe.name));

test('V-2: 작성 주체(universe.owner)도 "가상"으로 시작해야 하고, 형식 점검이 이를 잡는다', () => {
  for (const d of SAMPLES) assert.ok(d.universe.owner.startsWith('가상'), `${d.universe.id} owner=${d.universe.owner}`);
  const bad = clone(SAMPLE_A1);
  bad.universe.owner = '시스템분석팀';
  assert.ok(scanVirtualData(bad).some((p) => p.path === 'universe.owner'));
});

test('V-7: 사전 생성 문장 속 「라벨」·사번·날짜는 모두 데이터에 있다(이름·날짜를 바꾸면 낡은 문장을 잡는다)', () => {
  const empNos = new Set(SAMPLES.flatMap((d) => d.nodes.map((n) => n.emp_no).filter(Boolean)));
  const dates = new Set(SAMPLES.flatMap((d) => [
    ...d.events.map((e) => e.occurred_at),
    ...d.edges.flatMap((e) => (e.period ? [e.period.start, e.period.end] : [])),
  ].filter(Boolean)));
  let checked = 0;
  for (const it of PREGEN.items) {
    const where = `${it.target} ${it.item || ''}`;
    for (const s of it.sentences) {
      for (const m of s.text.matchAll(/「([^」]+)」/g)) { checked += 1; assert.ok(labels.has(m[1]), `${where}: 「${m[1]}」 노드 라벨 없음`); }
      for (const m of s.text.matchAll(/V-\d{4}/g)) { checked += 1; assert.ok(empNos.has(m[0]), `${where}: 사번 ${m[0]} 없음`); }
      for (const m of s.text.matchAll(/\d{4}-\d{2}-\d{2}/g)) { checked += 1; assert.ok(dates.has(m[0]), `${where}: 날짜 ${m[0]} 없음`); }
    }
  }
  assert.ok(checked > 30, `대조한 항목 ${checked}개`);
});

test('V-7: 시작 화면 카드 문구의 「이름」은 실제 노드·유니버스 이름이거나 화면 버튼 이름이다', () => {
  const buttons = new Set(['인수인계 초안 만들기', '인사이트 보기', '새 업무 지도 만들기', '가져오기·내보내기', '문서·파일 가져오기', '사람·업무·문서 추가']);
  for (const [id, g] of Object.entries(SAMPLE_GUIDE)) {
    assert.ok(SAMPLES.some((d) => d.universe.id === id), id);
    for (const m of `${g.tagline || ''} ${g.try || ''}`.matchAll(/「([^」]+)」/g)) {
      assert.ok(labels.has(m[1]) || universeNames.has(m[1]) || buttons.has(m[1]), `${id}: 「${m[1]}」 없음`);
    }
  }
});

test('V-7: 정답 표가 가리키는 데이터 파일이 있고, 사전 생성의 데이터 판과 같다', () => {
  for (const f of ANSWERS_V1.data) assert.ok(existsSync(new URL(`../${f}`, import.meta.url)), f);
  assert.equal(PREGEN.data_version, ANSWERS_V1.version);
});
