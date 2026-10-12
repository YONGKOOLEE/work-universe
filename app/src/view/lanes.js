// 흐름 정렬(시제품, 조력자 의견 2026-10-12: "같은 유형끼리 묶이고 선 방향이 일관되면 좋겠다"). 순수 함수.
// 가로 = 업무의 선후(precedes) 순서, 세로 = 유형 층(위: 조직·사람 → 가운데: 업무 → 아래: 산출물 → 맨 아래: 주제).
// 업무가 많으면 한 줄에 COLS개씩 줄을 바꾸고, 사람·산출물·주제는 자기 업무가 있는 줄 둘레에 놓는다.
// 기본 배치(고리)를 대신하지 않는다: 「흐름 정렬」 버튼으로만 쓰는 선택 배치다.

import { labelBox } from './place.js';

export const LANES = {
  cols: 7, // 업무 한 줄에 놓는 최대 열 수
  colGap: 40, // 이름 상자 사이 가로 여유
  rowGap: 110, // 층 사이 세로 간격(이름이 여러 줄이어도 다음 층과 겹치지 않게)
  blockGap: 90, // 업무 줄 묶음 사이 간격
  stackGap: 64, // 같은 열에 업무가 여럿일 때 세로 간격
};

const LAYER = { root: 0, org: 0, person: 1, work: 2, artifact: 3, topic: 4 }; // root: 묶음 화면에서 하위 유니버스의 꼭지

/**
 * @param {{id:string, core_type:string, label:string, size?:number}[]} nodes
 * @param {{source:string, target:string, core_type?:string}[]} edges
 * @returns {Map<string,{x:number,y:number}>}
 */
export function flowLayout(nodes, edges) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const works = nodes.filter((n) => n.core_type === 'work');
  const root = nodes.find((n) => n.core_type === 'root');
  const out = new Map();

  // 1) 업무 열: precedes 최장 경로(순환이 있어도 끝나도록 반복 횟수를 제한)
  const col = new Map(works.map((w) => [w.id, 0]));
  const pre = edges.filter((e) => e.core_type === 'precedes' && col.has(e.source) && col.has(e.target));
  for (let i = 0; i < works.length; i += 1) {
    let changed = false;
    for (const e of pre) {
      if (col.get(e.target) < col.get(e.source) + 1 && col.get(e.source) + 1 < works.length) {
        col.set(e.target, col.get(e.source) + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  // 선후 관계가 하나도 없는 업무는 이름 순서대로 가로로 늘어놓는다(열이 겹치지 않게)
  const hasPre = new Set(pre.flatMap((e) => [e.source, e.target]));
  let free = 0;
  for (const w of [...works].sort((a, b) => a.label.localeCompare(b.label, 'ko'))) {
    if (!hasPre.has(w.id)) col.set(w.id, free++);
  }

  // 2) 열 번호를 줄로 접는다: (줄 r, 칸 c)
  const slot = new Map();
  const order = [...works].sort((a, b) => col.get(a.id) - col.get(b.id) || a.label.localeCompare(b.label, 'ko'));
  const perCol = new Map();
  order.forEach((w) => {
    const c = col.get(w.id);
    const k = perCol.get(c) || 0;
    perCol.set(c, k + 1);
    slot.set(w.id, { c, k });
  });
  const maxCol = Math.max(0, ...[...slot.values()].map((s) => s.c));
  const rows = Math.max(1, Math.ceil((maxCol + 1) / LANES.cols));
  // 줄마다 같은 열에 쌓인 업무 수(세로로 쌓으면 아래 층을 그만큼 내린다)
  const stackOf = Array.from({ length: rows }, () => 0);
  for (const s2 of slot.values()) {
    const r = Math.floor(s2.c / LANES.cols);
    stackOf[r] = Math.max(stackOf[r], s2.k);
  }
  const blockTop = [];
  let acc = 0;
  for (let r = 0; r < rows; r += 1) {
    blockTop.push(acc);
    acc += 5 * LANES.rowGap + stackOf[r] * LANES.stackGap + LANES.blockGap;
  }
  const layerY = (r, layer) => blockTop[r] + layer * LANES.rowGap + (layer > LAYER.work ? stackOf[r] * LANES.stackGap : 0);
  const widthOf = (n) => labelBox(n.label, n.size || 24).w;
  const colW = LANES.colGap + 130; // 한 칸 폭: 이름 최대 폭 + 여유

  // 업무 좌표와 업무 줄별 가로 위치 기억
  const rowOfWork = new Map();
  const x0 = 0;
  for (const w of works) {
    const s = slot.get(w.id);
    const r = Math.floor(s.c / LANES.cols);
    const c = s.c % LANES.cols;
    rowOfWork.set(w.id, r);
    // 같은 열에 업무가 여럿이면 세로로 조금씩 어긋나게(겹침 방지)
    out.set(w.id, { x: x0 + c * colW, y: layerY(r, LAYER.work) + s.k * LANES.stackGap });
  }

  // 3) 다른 유형: 이웃 업무의 가로 평균, 층 높이, 업무 줄에 맞춰 놓는다
  const neighbors = (id) => {
    const set = [];
    for (const e of edges) {
      if (e.source === id && byId.has(e.target)) set.push(e.target);
      if (e.target === id && byId.has(e.source)) set.push(e.source);
    }
    return set;
  };
  const layerNodes = new Map();
  for (const n of nodes) {
    if (n.core_type === 'work' || n === root) continue;
    const layer = LAYER[n.core_type] ?? 4;
    const ws = neighbors(n.id).filter((m) => rowOfWork.has(m));
    const via = ws.length ? ws : neighbors(n.id).flatMap((m) => neighbors(m).filter((k) => rowOfWork.has(k)));
    const r = via.length ? Math.min(...via.map((m) => rowOfWork.get(m))) : 0;
    const xs = via.filter((m) => rowOfWork.get(m) === r).map((m) => out.get(m).x);
    const x = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : (maxCol / 2) * colW;
    const key = `${r}:${layer}`;
    if (!layerNodes.has(key)) layerNodes.set(key, []);
    layerNodes.get(key).push({ n, x, r, layer });
  }
  // 같은 줄·같은 층에서 이름 상자가 겹치지 않게 가로로 밀어낸다
  for (const items of layerNodes.values()) {
    items.sort((a, b) => a.x - b.x || a.n.label.localeCompare(b.n.label, 'ko'));
    let prevRight = -Infinity;
    for (const it of items) {
      const w = widthOf(it.n);
      let x = it.x;
      if (x - w / 2 < prevRight + LANES.colGap / 2) x = prevRight + LANES.colGap / 2 + w / 2;
      prevRight = x + w / 2;
      out.set(it.n.id, { x, y: layerY(it.r, it.layer) });
    }
  }

  // 4) 꼭지는 맨 위 가운데
  if (root) {
    const xs = [...out.values()].map((p) => p.x);
    const mid = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
    out.set(root.id, { x: mid, y: -LANES.rowGap });
  }
  return out;
}
