// 새 노드 자리 계산(T-19, CR-10 부록 B-1 B-P4, 결정 T19-13). 순수 함수: 그래프 라이브러리를 쓰지 않는다.
// 노드 하나의 점유 상자 = 동그라미(size) + 그 아래 이름(최대 폭 PLACE.maxText, 줄바꿈). 이미 놓인 상자들과 겹치지 않는 가장 가까운 빈자리를 고른다.
// 보던 모양이 흐트러지지 않게 기존 노드는 옮기지 않는다(graph.js render).

export const PLACE = {
  charPx: 15, // 한글 한 글자 폭 추정(글자 크기 14px, 영문·숫자는 절반이지만 넉넉하게 같은 값)
  maxText: 120, // 이름 줄바꿈 폭(graph.js text-max-width와 같음)
  lineH: 19,
  textGap: 6, // 동그라미와 이름 사이(text-margin-y)
  gap: 14, // 상자 사이 여유
  ring: 70, // 첫 고리 반지름
  ringStep: 50,
  rings: 14,
  angles: 12,
};

/** 이름과 동그라미 크기로 점유 상자의 크기를 추정한다 */
export function labelBox(label, size = 24) {
  const text = String(label ?? '');
  const textW = Math.min(PLACE.maxText, Math.max(0, [...text].length * PLACE.charPx));
  const lines = textW === 0 ? 0 : Math.max(1, Math.ceil([...text].length * PLACE.charPx / PLACE.maxText));
  return { w: Math.max(size, textW), h: size + (lines ? PLACE.textGap + lines * PLACE.lineH : 0), size };
}

const rectAt = (x, y, b) => ({ x1: x - b.w / 2, x2: x + b.w / 2, y1: y - b.size / 2, y2: y - b.size / 2 + b.h });
const overlaps = (a, r, gap) => a.x1 < r.x2 + gap && a.x2 > r.x1 - gap && a.y1 < r.y2 + gap && a.y2 > r.y1 - gap;
const free = (rect, taken) => !taken.some((r) => overlaps(rect, r, PLACE.gap));

/**
 * @param {{x1:number,y1:number,x2:number,y2:number}[]} existing 이미 놓인 노드의 상자(이름 포함, 화면 좌표계의 모델 좌표)
 * @param {{id:string, label:string, size:number, anchor?:{x:number,y:number}|null}[]} items 새 노드들(행 순서)
 * @returns {Map<string,{x:number,y:number}>} 새 노드 id → 가운데 좌표
 */
export function placeNewNodes(existing, items) {
  const taken = [...existing];
  const out = new Map();
  const all = taken.length ? taken : [{ x1: 0, y1: 0, x2: 0, y2: 0 }];
  const right = Math.max(...all.map((r) => r.x2));
  const top = Math.min(...all.map((r) => r.y1));
  let columnSlot = 0;
  for (const it of items) {
    const b = labelBox(it.label, it.size);
    let spot = null;
    if (it.anchor) {
      // 이웃 둘레의 고리를 안쪽부터, 오른쪽 아래(30°)에서 시작해 한 바퀴씩 훑는다
      search: for (let k = 0; k < PLACE.rings; k += 1) {
        const radius = PLACE.ring + k * PLACE.ringStep;
        for (let a = 0; a < PLACE.angles; a += 1) {
          const theta = (Math.PI / 6) + (a * 2 * Math.PI) / PLACE.angles;
          const x = it.anchor.x + radius * Math.cos(theta);
          const y = it.anchor.y + radius * Math.sin(theta);
          if (free(rectAt(x, y, b), taken)) {
            spot = { x, y };
            break search;
          }
        }
      }
    }
    if (!spot) {
      // 이웃이 없거나 둘레가 가득 찼으면 그래프 오른쪽 바깥의 세로 줄에 차례로
      for (;;) {
        const x = right + 80 + b.w / 2;
        const y = top + 40 + columnSlot * (b.h + PLACE.gap * 2);
        columnSlot += 1;
        if (free(rectAt(x, y, b), taken)) {
          spot = { x, y };
          break;
        }
      }
    }
    taken.push(rectAt(spot.x, spot.y, b));
    out.set(it.id, spot);
  }
  return out;
}
