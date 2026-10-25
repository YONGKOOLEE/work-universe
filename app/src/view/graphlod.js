// 그래프 가독성(CR-22 G): 이름 단계 표시(겹치면 우선순위 낮은 것부터 숨김)·휠 배율·유형 모양·색 대비 계산.
// 브라우저 기능(DOM, 저장소)·라이브러리를 쓰지 않는 순수 함수. ui/graph.js가 화면에 적용한다.

// 바꾸기 쉬운 값은 한 곳에(ui/explore.js의 EXPLORE.LOD로 다시 내보낸다)
export const LOD = {
  BASE_PX: 14, // 이름 글자 크기(배율 1일 때). 배율이 1보다 작아지면 화면 크기를 MIN_PX 아래로 내리지 않게 역보정한다
  MIN_PX: 11, // 보통 이름이 화면에서 갖는 최소 크기(px)
  BIG_BASE_PX: 16, // 지도 중심·고른 항목·이웃 이름의 글자 크기(배율 1일 때)
  BIG_MIN_PX: 14, // 그 이름들의 화면 최소 크기(px)
  EDGE_LABEL_PX: 11, // 연결 이름(관계 글자)의 화면 크기(px)
  LABEL_PAD_PX: 2, // 이름끼리 겹침을 볼 때 상자에 더하는 여백(px)
  EMPH_MAX_NEIGHBORS: 20, // 고른 항목의 이웃이 이 수를 넘으면 이웃 이름은 키우지 않는다(그 항목만)
  HUB_DEGREE: 4, // 연결이 이 수 이상인 업무는 「연결 많은 업무」(이름 우선순위가 한 칸 높음)
  WHEEL_STEP: 1.15, // 마우스 휠 한 칸(|deltaY| >= WHEEL_NOTCH_DELTA)의 배율
  WHEEL_NOTCH_DELTA: 50, // 이 값 이상이면 한 칸으로 본다(마우스). 그보다 작으면 터치패드처럼 연속 배율
  WHEEL_SMOOTH: 0.01, // 연속 배율: exp(-deltaY × 이 값)
  BUTTON_STEP: 1.3, // ＋·－ 단추 한 번의 배율
  CONTAINS_OPACITY: 0.12, // 지도 중심 → 항목 「포함」 선의 투명도
  CENTER_GAP_PX: 14, // 지도 중심 둘레에 비워 두는 여유(배치 단위)
  ROOT_GAP_PX: 24, // 묶은 지도에서 지도 중심(큰 원 + 아래 이름 상자)끼리 비워 두는 간격(CR-22 G2: 원끼리만 재던 34에서 이름 상자까지 재는 방식으로)
  ROOT_GAP_SCREEN_PX: 12, // 실제 이름 상자로 다시 벌릴 때 화면에서 비워 두는 간격(px)
  ROOT_LABEL_PX: 16, // 지도 중심 이름 글자 크기 추정(굵게 16px)
  ROOT_LABEL_WRAP_EM: 8.6, // 이름이 줄바꿈되는 폭(em, ui/graph.js의 text-max-width와 같게)
  ROOT_LABEL_SCALE: 1.25, // 축소된 화면에서 이름이 모델 좌표로 더 커지는 것을 넉넉히 반영
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * 이름의 화면 글자 크기(px). 보통 이름: 배율 1이면 BASE_PX, 줄이면 같이 작아지다가 MIN_PX에서 멈춘다(역보정).
 * 크게 보일 이름(big): BIG_BASE_PX → BIG_MIN_PX.
 */
export function labelScreenPx(zoom, big = false, c = LOD) {
  const z = zoom > 0 ? zoom : 1;
  return big ? clamp(c.BIG_BASE_PX * z, c.BIG_MIN_PX, c.BIG_BASE_PX) : clamp(c.BASE_PX * z, c.MIN_PX, c.BASE_PX);
}

/** 화면 글자 크기를 그래프 좌표의 글자 크기로(라이브러리 글자 크기는 확대 배율이 곱해진다) */
export const labelModelPx = (screenPx, zoom) => screenPx / (zoom > 0 ? zoom : 1);

/**
 * 이름 우선순위(작을수록 먼저 보임). 지도 중심 > 고른 항목·이웃 > 연결 많은 업무 > 업무 > 사람·조직 > 산출물·주제·기타.
 * focus: 고르거나 올린 항목 자신(지도 중심과 같은 0순위), near: 그 이웃, marked: 공간 강조·찾은 항목(0순위).
 */
export function labelPriority({ type, focus = false, near = false, degree = 0, marked = false }, c = LOD) {
  if (type === 'root' || focus || marked) return 0; // marked: 공간 강조·찾은 항목(FU6-8 — 강조된 것은 이름이 숨지 않게 0순위)
  if (near) return 1;
  if (type === 'work') return degree >= c.HUB_DEGREE ? 2 : 3;
  if (type === 'person' || type === 'org') return 4;
  return 5;
}

const overlaps = (a, b, pad) => a.x1 < b.x2 + pad && b.x1 < a.x2 + pad && a.y1 < b.y2 + pad && b.y1 < a.y2 + pad;

/**
 * 이름 단계 표시: 우선순위가 높은 이름부터 놓고, 이미 놓인 이름 상자와 겹치면 숨긴다.
 * items: {id, rank, degree?, force?, box:{x1,y1,x2,y2}|null}. box가 없는(이름이 없는) 항목은 늘 통과. * force인 항목(지도 중심: 「꼭지 이름은 늘 보임」 C10-6)은 겹쳐도 숨기지 않고, 먼저 놓여 다른 이름을 밀어낸다.
 * 같은 순위에서는 연결 많은 것 → id 순. 확대하면 상자 사이가 벌어져 숨었던 이름이 나온다.
 * @returns {Set<string>} 보일 항목 id
 */
export function chooseVisibleLabels(items, pad = LOD.LABEL_PAD_PX) {
  const order = [...items].sort((a, b) => Number(!!b.force) - Number(!!a.force) || a.rank - b.rank || (b.degree || 0) - (a.degree || 0) || String(a.id).localeCompare(String(b.id)));
  const shown = new Set();
  const placed = [];
  for (const it of order) {
    if (!it.box) { shown.add(it.id); continue; }
    if (it.force) { placed.push(it.box); shown.add(it.id); continue; }
    if (placed.some((p) => overlaps(p, it.box, pad))) continue;
    placed.push(it.box);
    shown.add(it.id);
  }
  return shown;
}

/**
 * 마우스 휠 한 번의 배율 곱. |deltaY| >= WHEEL_NOTCH_DELTA(마우스 한 칸)이면 WHEEL_STEP(위로 확대, 아래로 축소),
 * 더 작으면(터치패드) exp(-deltaY × WHEEL_SMOOTH). deltaMode 1(줄)·2(쪽)은 픽셀로 바꿔서 본다. 한 번에 [1/1.5, 1.5]를 넘지 않는다.
 */
export function wheelZoomFactor(deltaY, deltaMode = 0, c = LOD) {
  const dy = (Number(deltaY) || 0) * (deltaMode === 1 ? 40 : deltaMode === 2 ? 400 : 1);
  if (dy === 0) return 1;
  const f = Math.abs(dy) >= c.WHEEL_NOTCH_DELTA ? (dy < 0 ? c.WHEEL_STEP : 1 / c.WHEEL_STEP) : Math.exp(-dy * c.WHEEL_SMOOTH);
  return clamp(f, 1 / c.WHEEL_STEP, c.WHEEL_STEP); // 부드러운 갈래도 한 번에 한 칸(WHEEL_STEP)을 넘지 않는다(R11 RV11C-7: 49에서 ×1.63으로 튀던 것)
}

/** 배율을 factor만큼 곱하되 [min, max] 안으로 */
export const nextZoom = (zoom, factor, min, max) => clamp(zoom * factor, min, max);

/**
 * 지도 중심 둘레 비우기: center에서 항목마다 필요한 거리(radii[id] + 중심 반지름 + gap)보다 가까운 항목을 같은 방향으로 밀어낸다.
 * 중심 위치에 정확히 겹친 항목은 순서대로 다른 각도로 보낸다. positions는 바꾸지 않고 새 Map을 돌려준다.
 */
export function pushOutOfCenter(positions, center, centerRadius, radii = {}, gap = LOD.CENTER_GAP_PX) {
  const out = new Map();
  let k = 0;
  for (const [id, p] of positions) {
    const need = centerRadius + (radii[id] || 0) + gap;
    let dx = p.x - center.x;
    let dy = p.y - center.y;
    let d = Math.hypot(dx, dy);
    if (d >= need) { out.set(id, { ...p }); continue; }
    if (d < 1e-6) { const a = (k++ * 2.399963) % (2 * Math.PI); dx = Math.cos(a); dy = Math.sin(a); d = 1; }
    out.set(id, { x: center.x + (dx / d) * need, y: center.y + (dy / d) * need });
  }
  return out;
}

/**
 * 원끼리 겹치면 서로 반씩 밀어 벌린다(지도 중심이 여럿인 묶은 지도). items: {id, x, y, r}. 간격 gap 이상으로, 최대 40번 되풀이.
 * 같은 자리의 두 원은 순서대로 다른 방향으로 간다. 입력은 바꾸지 않고 id → {x, y}를 돌려준다.
 */
export function separateCircles(items, gap = LOD.CENTER_GAP_PX) {
  const p = items.map((i) => ({ ...i }));
  for (let round = 0; round < 40; round += 1) {
    let moved = false;
    for (let i = 0; i < p.length; i += 1) {
      for (let j = i + 1; j < p.length; j += 1) {
        const need = p[i].r + p[j].r + gap;
        let dx = p[j].x - p[i].x;
        let dy = p[j].y - p[i].y;
        let d = Math.hypot(dx, dy);
        if (d >= need - 1e-9) continue;
        if (d < 1e-6) { const a = ((i + j + 1) * 2.399963) % (2 * Math.PI); dx = Math.cos(a); dy = Math.sin(a); d = 1; }
        const push = (need - d) / 2 + 0.01;
        p[i].x -= (dx / d) * push; p[i].y -= (dy / d) * push;
        p[j].x += (dx / d) * push; p[j].y += (dy / d) * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return new Map(p.map((i) => [i.id, { x: i.x, y: i.y }]));
}

/**
 * 지도 중심 이름 상자 비우기(CR-22 G2): 이름 상자(box = {x1,y1,x2,y2}, 원 아래)에 들어온 항목을 겹침이 가장 작은 쪽(위·아래·왼·오른)으로 밀어낸다.
 * 항목의 반지름(radii[id])과 gap만큼 상자를 부풀려 본다. positions는 바꾸지 않고 새 Map을 돌려준다.
 */
export function pushOutOfBox(positions, box, radii = {}, gap = 4) {
  const out = new Map();
  const pushed = []; // 이미 밀려 나온 항목: 같은 자리에 겹쳐 놓이지 않게 같은 방향으로 더 민다
  for (const [id, p] of positions) {
    const m = (radii[id] || 0) + gap;
    const left = p.x - (box.x1 - m);
    const right = box.x2 + m - p.x;
    const up = p.y - (box.y1 - m);
    const down = box.y2 + m - p.y;
    if (left <= 0 || right <= 0 || up <= 0 || down <= 0) { out.set(id, { ...p }); continue; }
    const least = Math.min(left, right, up, down);
    const dir = least === left ? [-1, 0] : least === right ? [1, 0] : least === up ? [0, -1] : [0, 1];
    let q = { x: dir[0] === 0 ? p.x : dir[0] < 0 ? box.x1 - m : box.x2 + m, y: dir[1] === 0 ? p.y : dir[1] < 0 ? box.y1 - m : box.y2 + m };
    for (let k = 0; k < 8; k += 1) {
      const hit = pushed.find((o) => Math.hypot(o.x - q.x, o.y - q.y) < (radii[id] || 0) + o.r + gap);
      if (!hit) break;
      q = { x: q.x + dir[0] * ((radii[id] || 0) + hit.r + gap), y: q.y + dir[1] * ((radii[id] || 0) + hit.r + gap) };
    }
    pushed.push({ x: q.x, y: q.y, r: radii[id] || 0 });
    out.set(id, q);
  }
  return out;
}

/**
 * 지도 중심의 이름 상자 크기 추정(모델 좌표). 이름은 원 아래에 붙고(굵게 16px 안팎, 8.6em에서 줄바꿈), 접힌 팀은 「＋n」 줄이 더해진다.
 * 이름 글자 크기는 배율을 거슬러 화면 14px 밑으로 내려가지 않으므로 축소된 화면에서 모델 좌표의 이름은 더 커진다: ROOT_LABEL_SCALE로 넉넉히 잡는다.
 * @returns {{w:number, h:number}} w: 이름 폭, h: 원 아래 이름의 높이
 */
export function rootLabelSize(label, c = LOD) {
  const lines = String(label ?? '').split('\n');
  const wrapW = c.ROOT_LABEL_WRAP_EM * c.ROOT_LABEL_PX;
  let w = 0;
  let n = 0;
  for (const line of lines) {
    const lw = [...line].length * c.ROOT_LABEL_PX * 0.95;
    w = Math.max(w, Math.min(lw, wrapW));
    n += Math.max(1, Math.ceil(lw / wrapW));
  }
  return { w: w * c.ROOT_LABEL_SCALE, h: (n * c.ROOT_LABEL_PX * 1.25 + 6) * c.ROOT_LABEL_SCALE };
}

/**
 * 이름 상자까지 겹치지 않게 지도 중심들을 벌린다(CR-22 G2: 팀을 펼친 뒤 지도 중심들이 가운데 세로로 붙어 이름이 맞닿던 것).
 * items: {id, x, y, r, w, h}(w·h: rootLabelSize). 상자 = 원과 그 아래 이름을 감싼 사각형. 겹친 쌍은 겹침이 작은 축으로 반씩 민다. 최대 80번 되풀이.
 * 입력은 바꾸지 않고 id → {x, y}를 돌려준다.
 */
export function separateLabeled(items, gap = LOD.ROOT_GAP_PX) {
  const p = items.map((i) => ({ ...i }));
  const box = (i) => ({ x1: i.x - Math.max(i.r, i.w / 2), x2: i.x + Math.max(i.r, i.w / 2), y1: i.y - i.r, y2: i.y + i.r + i.h });
  for (let round = 0; round < 80; round += 1) {
    let moved = false;
    for (let i = 0; i < p.length; i += 1) {
      for (let j = i + 1; j < p.length; j += 1) {
        const a = box(p[i]);
        const b = box(p[j]);
        const ox = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) + gap; // 가로로 겹친(또는 gap보다 가까운) 양
        const oy = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) + gap;
        if (ox <= 0 || oy <= 0) continue;
        if (ox <= oy) {
          const s = p[i].x === p[j].x ? ((i + j) % 2 ? 1 : -1) : Math.sign(p[j].x - p[i].x);
          p[i].x -= (s * ox) / 2; p[j].x += (s * ox) / 2;
        } else {
          const s = p[i].y === p[j].y ? ((i + j) % 2 ? 1 : -1) : Math.sign(p[j].y - p[i].y);
          p[i].y -= (s * oy) / 2; p[j].y += (s * oy) / 2;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  return new Map(p.map((i) => [i.id, { x: i.x, y: i.y }]));
}

/** 배치 범위(한 변). 창 크기와 상관없이 항목 수로만 정한다(창 크기마다 모양이 바뀌지 않게) */
export const layoutSpan = (nodeCount) => Math.round(Math.max(480, Math.sqrt(Math.max(1, nodeCount)) * 110));

// ── 색 대비(WCAG 상대 휘도) ──
const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (hex) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
export function contrastRatio(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// 그래프 배경과 연결선 색. 연결선은 배경과 대비 3:1 이상(이전 #3d5536은 2.25:1이라 어두운 배경에서 안 보임)
export const GRAPH_COLORS = { BG: '#0f1510', EDGE: '#527a49' };

/** 유형별 모양(Cytoscape shape). 색에만 기대지 않게 한다. 모르는 유형은 원 */
export const TYPE_SHAPES = {
  root: 'ellipse',
  person: 'ellipse',
  work: 'round-rectangle',
  artifact: 'rectangle',
  topic: 'diamond',
  org: 'hexagon',
};
export const shapeOf = (type) => TYPE_SHAPES[type] || 'ellipse';
