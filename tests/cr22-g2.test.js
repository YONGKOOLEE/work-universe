// CR-22 G2 공간별 그래프 강조 단위 검증(view/space-marks.js, 순수 함수) + 지도 중심 간격 계산. 가상 데이터만 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkDoc, mkEdge, mkNode } from './helpers.js';
import { buildView } from '../app/src/view/view.js';
import { SPACE_MARK, spaceMarks, issueWorks, soloWorks, currentOwnerNodes } from '../app/src/view/space-marks.js';
import { soloRows } from '../app/src/view/workspace.js';
import { LOD, pushOutOfBox, rootLabelSize, separateCircles, separateLabeled } from '../app/src/view/graphlod.js';

const ASOF = '2026-10-02';
const memoEv = (id, at, payload, note) => ({ id, type: 'memo', occurred_at: at, recorded_at: '2026-09-01T09:00:00+09:00', source: 'manual', payload, note });
const person = (id, l) => mkNode(id, 'person', l);
const work = (id, l) => mkNode(id, 'work', l);
function fixture() {
  const nodes = [person('N-P1', '가상갑'), person('N-P2', '가상을'), person('N-P3', '가상병'), work('N-W1', '혼자 하는 일'), work('N-W2', '둘이 하는 일'), work('N-W3', '담당 끝난 일'), work('N-W4', '미해결 있는 일')];
  const edges = [
    mkEdge('N-P1', 'N-W1', 'performs'),
    mkEdge('N-P1', 'N-W2', 'performs'), mkEdge('N-P2', 'N-W2', 'performs'),
    mkEdge('N-P3', 'N-W3', 'performs', { period: { start: '2026-01-01', end: '2026-06-30' } }),
    mkEdge('N-P2', 'N-W4', 'performs'), mkEdge('N-P3', 'N-W4', 'performs'),
  ];
  const events = [
    memoEv('E-1', '2026-09-20', { category: 'issue', target_id: 'N-W4' }, '미해결'),
    memoEv('E-2', '2026-09-21', { category: 'issue', target_id: 'N-W2' }, '곧 해결'),
    memoEv('E-3', '2026-09-25', { category: 'resolved', target_id: 'N-W2', resolves_id: 'E-2' }, '해결'),
    memoEv('E-4', '2026-09-26', { category: 'info', target_id: 'N-W1' }, '정보'),
  ];
  return buildView(mkDoc('U-G2', nodes, edges, events), () => null);
}
const g = (id) => `U-G2/${id}`;
// 기존 계산(매주 점검 공간 목록)과 같은 업무여야 한다
const soloRowsGids = (v) => soloRows(v, { asOf: ASOF, max: 99 }).rows.map((r) => r.work_gid).sort();

test('CR-22 G2 기록: 미해결(이슈·진행 중)이 남은 업무만, 해결된 것·정보 메모는 제외', () => {
  const v = fixture();
  assert.deepEqual([...issueWorks(v)], [g('N-W4')]);
  const r = spaceMarks('record', v, { asOf: ASOF });
  assert.equal(r.cls, 'mk-issue');
  assert.deepEqual(r.gids, [g('N-W4')]);
  assert.equal(r.marks[0].label, '노랑 테두리 = 미해결이 있는 업무');
});

test('CR-22 G2 매주 점검: 혼자만 아는 일(담당 한 명)만, 빨강 겹테두리', () => {
  const v = fixture();
  const solo = soloWorks(v, ASOF);
  assert.ok(solo.has(g('N-W1')) && !solo.has(g('N-W2')) && !solo.has(g('N-W4')), '둘 이상이 맡은 일은 제외');
  assert.deepEqual([...solo].sort(), soloRowsGids(v));
  const r = spaceMarks('check', v, { asOf: ASOF });
  assert.equal(r.cls, 'mk-solo');
  assert.equal(r.marks[0].ring, true);
  assert.ok(r.marks[0].label.includes('혼자만 아는 일'));
});

test('CR-22 G2 인수인계: 지금 담당이 있는 업무와 담당자. 끝난 담당은 제외, 기준일을 옮기면 달라진다', () => {
  const v = fixture();
  const now = [...currentOwnerNodes(v, ASOF)];
  assert.ok(now.includes(g('N-W1')) && now.includes(g('N-P1')) && now.includes(g('N-W4')));
  assert.ok(!now.includes(g('N-W3')), '끝난 담당 업무는 지금 담당 없음');
  const past = [...currentOwnerNodes(v, '2026-03-01')];
  assert.ok(past.includes(g('N-W3')), '기준일이 담당 기간 안이면 포함');
  assert.equal(spaceMarks('handover', v, { asOf: ASOF }).cls, 'mk-current');
});

test('CR-22 G2 지도 보기·지도 관리: 강조 없음(빈 범례)', () => {
  const v = fixture();
  for (const s of ['map', 'edit', 'nope']) assert.deepEqual(spaceMarks(s, v, { asOf: ASOF }), { cls: null, gids: [], hidden: 0, marks: [] });
});

test('CR-22 G2 접힌 팀 안: 그려진 항목만 강조하고 범례에 (접힌 팀 안 n개 포함), note=false면 붙이지 않음', () => {
  const v = fixture();
  const shown = new Set([g('N-W1'), g('N-P1')]);
  const r = spaceMarks('record', v, { asOf: ASOF, shown });
  assert.deepEqual(r.gids, []);
  assert.equal(r.hidden, 1);
  assert.equal(r.marks[0].label, '노랑 테두리 = 미해결이 있는 업무(접힌 팀 안 1개 포함)');
  assert.equal(spaceMarks('record', v, { asOf: ASOF, shown, note: false }).marks[0].label, '노랑 테두리 = 미해결이 있는 업무');
  assert.equal(spaceMarks('record', v, { asOf: ASOF, shown: new Set([g('N-W4')]) }).hidden, 0);
});

test('CR-22 G2 강조는 색만으로 말하지 않는다: 공간마다 클래스·범례 key가 다르고 매주 점검은 겹테두리', () => {
  const keys = Object.values(SPACE_MARK).map((m) => m.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(new Set(Object.values(SPACE_MARK).map((m) => m.cls)).size, 3);
  assert.equal(SPACE_MARK.check.ring, true); // 이중 테두리 = 무늬
  assert.notEqual(SPACE_MARK.record.color, SPACE_MARK.check.color);
});

test('CR-22 G2 지도 중심 이름 상자: 가운데 세로로 붙은 4개도 원+이름 상자끼리 겹치지 않고 간격 이상 벌어진다', () => {
  const names = ['가상 운영부', '월말 정산 점검\n＋4', '가상교육팀', '가상행사팀'];
  const items = names.map((label, i) => ({ id: `r${i}`, x: 0, y: i * 40, r: 27, ...rootLabelSize(label) }));
  const out = separateLabeled(items, LOD.ROOT_GAP_PX);
  const box = (i) => { const p = out.get(i.id); return { x1: p.x - Math.max(i.r, i.w / 2), x2: p.x + Math.max(i.r, i.w / 2), y1: p.y - i.r, y2: p.y + i.r + i.h }; };
  for (let a = 0; a < items.length; a += 1) {
    for (let b = a + 1; b < items.length; b += 1) {
      const A = box(items[a]); const B = box(items[b]);
      const sepX = Math.max(A.x1 - B.x2, B.x1 - A.x2);
      const sepY = Math.max(A.y1 - B.y2, B.y1 - A.y2);
      assert.ok(Math.max(sepX, sepY) >= LOD.ROOT_GAP_PX - 1e-6, `${a}-${b}`);
    }
  }
  assert.ok(rootLabelSize('가상정산팀\n＋12').h > rootLabelSize('가상정산팀').h, '「＋n」 줄만큼 이름이 높다');
  const far = separateLabeled([{ id: 'a', x: 0, y: 0, r: 27, w: 80, h: 25 }, { id: 'b', x: 500, y: 0, r: 27, w: 80, h: 25 }], 24);
  assert.deepEqual(far.get('a'), { x: 0, y: 0 }); // 이미 떨어져 있으면 움직이지 않는다
});

test('CR-22 G2 지도 중심 이름 상자 안의 항목은 가장 가까운 바깥으로 밀리고, 밖의 항목은 그대로', () => {
  const box = { x1: 0, y1: 0, x2: 100, y2: 30 };
  const out = pushOutOfBox(new Map([['in', { x: 50, y: 28 }], ['far', { x: 300, y: 300 }], ['edge', { x: 3, y: 15 }]]), box, { in: 10, far: 10, edge: 10 }, 2);
  assert.deepEqual(out.get('far'), { x: 300, y: 300 });
  assert.deepEqual(out.get('in'), { x: 50, y: 42 }); // 아래로(겹침 가장 작음)
  assert.deepEqual(out.get('edge'), { x: -12, y: 15 }); // 왼쪽으로
});

test('CR-22 G2 지도 중심 간격: 가까운 원들도 간격 이상으로 벌어진다', () => {
  const out = separateCircles([{ id: 'a', x: 0, y: 0, r: 27 }, { id: 'b', x: 0, y: 40, r: 27 }, { id: 'c', x: 0, y: 80, r: 27 }], 34);
  const ids = ['a', 'b', 'c'];
  for (let i = 0; i < 3; i += 1) {
    for (let j = i + 1; j < 3; j += 1) {
      const d = Math.hypot(out.get(ids[i]).x - out.get(ids[j]).x, out.get(ids[i]).y - out.get(ids[j]).y);
      assert.ok(d >= 27 + 27 + 34 - 1e-6, `${ids[i]}-${ids[j]} ${d}`);
    }
  }
});
