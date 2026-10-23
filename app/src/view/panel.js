// 오른쪽 설명 패널 폭 조절(끌기 손잡이). DOM·저장소를 쓰지 않는 순수 함수와 상수만 둔다.

/** 패널 폭 범위(px). 최대 = min(창 폭 × MAX_RATIO, 창 폭 − GRAPH_MIN) */
export const PANEL = { MIN: 300, MAX_RATIO: 0.75, GRAPH_MIN: 320, DEFAULT: 380, KEY_STEP: 20 };

/** 창 폭에서 허용하는 패널 최대 폭. 창이 너무 좁아 최대가 최소보다 작으면 최소를 돌려준다 */
export function maxPanelWidth(innerWidth) {
  const iw = Number(innerWidth);
  if (!Number.isFinite(iw)) return PANEL.DEFAULT;
  return Math.max(PANEL.MIN, Math.floor(Math.min(iw * PANEL.MAX_RATIO, iw - PANEL.GRAPH_MIN)));
}

/** 폭을 [MIN, 최대]로 자른 정수 px. 숫자가 아니면(NaN·문자열 등) 기본 폭을 자른 값 */
export function clampPanelWidth(w, innerWidth) {
  const n = typeof w === 'number' && Number.isFinite(w) ? Math.round(w) : PANEL.DEFAULT;
  return Math.min(Math.max(n, PANEL.MIN), maxPanelWidth(innerWidth));
}
