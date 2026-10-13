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

const TOPIC_SUB_COST = 120; // 주제 띠에서 한 칸 아래로 내리는 벌점(가로 이동 120과 같은 값)
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
  const widthOf = (n) => labelBox(n.label, n.size || 24).w;
  const colW = LANES.colGap + 130; // 한 칸 폭: 이름 최대 폭 + 여유
  const rowOfWork = new Map();
  const xOfWork = new Map();
  for (const w of works) {
    const s = slot.get(w.id);
    rowOfWork.set(w.id, Math.floor(s.c / LANES.cols));
    xOfWork.set(w.id, (s.c % LANES.cols) * colW);
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
  const topicRows = Array.from({ length: rows }, () => []); // 줄별: 업무가 직접 있는 주제
  for (const n of nodes) {
    if (n.core_type === 'work' || n === root) continue;
    const direct = neighbors(n.id).filter((m) => rowOfWork.has(m));
    // 주제는 관련 업무가 직접 있으면 업무 바로 아래 「주제 띠」에 둔다. 업무가 없는 주제만 맨 아래 줄(R7-1)
    const inBand = n.core_type === 'topic' && direct.length > 0;
    const layer = LAYER[n.core_type] ?? 4;
    const via = direct.length ? direct : neighbors(n.id).flatMap((m) => neighbors(m).filter((k) => rowOfWork.has(k)));
    const r = via.length ? Math.min(...via.map((m) => rowOfWork.get(m))) : 0;
    const xs = via.filter((m) => rowOfWork.get(m) === r).map((m) => xOfWork.get(m));
    const x = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : (maxCol / 2) * colW;
    if (inBand) {
      topicRows[r].push({ n, x, r });
      continue;
    }
    const key = `${r}:${layer}`;
    if (!layerNodes.has(key)) layerNodes.set(key, []);
    layerNodes.get(key).push({ n, x, r, layer });
  }
  // 주제 띠: 가로 위치는 관련 업무의 평균 그대로 두고, 이름이 겹치면 아래 칸으로 엇갈려 쌓는다(가로로 밀어 선이 길어지지 않게)
  const bandOf = new Map(); // 주제 id → {x, r, sub}
  const bandRows = Array.from({ length: rows }, () => 0); // 줄별 띠 칸 수
  let topicStep = 0;
  for (const t of topicRows.flat()) topicStep = Math.max(topicStep, labelBox(t.n.label, t.n.size || 24).h);
  topicStep += 14;
  topicRows.forEach((items, r) => {
    items.sort((a, b) => a.x - b.x || a.n.label.localeCompare(b.n.label, 'ko'));
    const taken = []; // 칸별로 이미 놓은 이름 상자의 가로 구간
    const fits = (sub, x, w) => !(taken[sub] || []).some((t) => x - w / 2 < t.r + LANES.colGap / 2 && x + w / 2 > t.l - LANES.colGap / 2);
    for (const it of items) {
      // 같은 업무에 주제가 많으면 아래로만 쌓지 않고, 가로 이동량 + 칸 수 벌점이 가장 작은 자리를 고른다
      const w = widthOf(it.n);
      let best = null;
      for (let sub = 0; sub < 6; sub += 1) {
        for (let d = 0; d <= 1200; d += 20) {
          for (const x of d ? [it.x + d, it.x - d] : [it.x]) {
            const cost = d + sub * TOPIC_SUB_COST;
            if (fits(sub, x, w) && (!best || cost < best.cost)) best = { x, sub, cost };
          }
        }
      }
      if (!best) best = { x: it.x, sub: taken.length, cost: 0 };
      (taken[best.sub] = taken[best.sub] || []).push({ l: best.x - w / 2, r: best.x + w / 2 });
      bandOf.set(it.n.id, { x: best.x, r, sub: best.sub });
    }
    bandRows[r] = taken.length;
  });
  // 줄 높이: 주제 띠가 있으면 산출물·맨 아래 줄을 띠 높이만큼 내린다
  const bandH = (r) => (bandRows[r] ? LANES.rowGap * 0.6 + bandRows[r] * topicStep : 0);
  const blockTop = [];
  let acc = 0;
  for (let r = 0; r < rows; r += 1) {
    blockTop.push(acc);
    acc += 5 * LANES.rowGap + stackOf[r] * LANES.stackGap + bandH(r) + LANES.blockGap;
  }
  const layerY = (r, layer) => blockTop[r] + layer * LANES.rowGap + (layer > LAYER.work ? stackOf[r] * LANES.stackGap + bandH(r) : 0);
  // 업무 좌표(같은 열에 업무가 여럿이면 세로로 조금씩 어긋나게)
  for (const w of works) {
    const sl = slot.get(w.id);
    out.set(w.id, { x: xOfWork.get(w.id), y: layerY(rowOfWork.get(w.id), LAYER.work) + sl.k * LANES.stackGap });
  }
  // 주제 띠 좌표: 업무 줄 바로 아래(산출물 층보다 위)
  for (const [id, b] of bandOf) {
    out.set(id, { x: b.x, y: blockTop[b.r] + LAYER.work * LANES.rowGap + stackOf[b.r] * LANES.stackGap + LANES.rowGap * 0.8 + b.sub * topicStep });
  }
  // 같은 줄·같은 층에서 이름 상자가 겹치지 않게 가로로 밀어낸다. avoid가 있으면 그 가로 위치의 세로선(꼭지 → 업무 「포함」 선)도 피한다
  const placeRow = (items, avoid) => {
    items.sort((a, b) => a.x - b.x || a.n.label.localeCompare(b.n.label, 'ko'));
    let prevRight = -Infinity;
    for (const it of items) {
      const w = widthOf(it.n);
      const minX = prevRight + LANES.colGap / 2 + w / 2;
      let x = Math.max(it.x, minX);
      if (avoid) {
        const blocked = (cx) => avoid.some((lx) => lx > cx - w / 2 - 10 && lx < cx + w / 2 + 10);
        let best = null;
        for (let d = 0; d <= 480 && best === null; d += 20) {
          for (const cand of [it.x + d, it.x - d]) if (cand >= minX && !blocked(cand)) { best = cand; break; }
        }
        if (best !== null) x = best;
      }
      prevRight = x + w / 2;
      out.set(it.n.id, { x, y: layerY(it.r, it.layer) });
    }
  };
  for (const items of layerNodes.values()) placeRow(items, null);

  // 4) 꼭지는 맨 위 가운데. 사람 층이 꼭지 → 업무 선 위에 겹치지 않게 첫 줄 사람을 선 사이로 옮긴다
  if (root) {
    const xs = [...out.values()].map((p) => p.x);
    const mid = xs.length ? (Math.min(...xs) + Math.max(...xs)) / 2 : 0;
    const rootPos = { x: mid, y: -LANES.rowGap };
    out.set(root.id, rootPos);
    const people = layerNodes.get(`0:${LAYER.person}`);
    if (people) {
      const y = layerY(0, LAYER.person);
      const lineXs = [];
      for (const e of edges) {
        const other = e.source === root.id ? e.target : e.target === root.id ? e.source : null;
        const o = other && rowOfWork.has(other) ? out.get(other) : null;
        if (o && o.y > y) lineXs.push(rootPos.x + (o.x - rootPos.x) * ((y - rootPos.y) / (o.y - rootPos.y)));
      }
      placeRow(people, lineXs);
    }
  }
  return out;
}
