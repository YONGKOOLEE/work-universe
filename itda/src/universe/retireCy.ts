// 지도 그래프(cytoscape)를 정리한다. 브라우저 기능을 쓰지 않는다(vitest로 검증).
// 유니버스 엔진(app/src/ui/graph.js)의 라벨 타이머·rAF·창 크기 변경 콜백은 인스턴스가 파기돼도 남아 있다가 늦게 불린다.
// 파기된 cytoscape는 렌더러가 null이라 그때 boundingBox 등이 「Cannot read properties of null (reading 'isHeadless')」를 낸다.
// 엔진 코드는 바꾸지 않으므로, 파기한 인스턴스를 「아무것도 하지 않는」 상태로 막아 둔다.

/** 파기하고, 파기 뒤 늦게 불리는 호출이 던지지 않게 막는다 */
export function retireCy(cy: any): void {
  try {
    if (!cy.destroyed()) cy.destroy();
  } catch {
    /* 이미 정리됨 */
  }
  // 요소 경계 계산은 cy.headless()로 렌더러를 확인한다 — 파기 뒤에는 「화면 없음」으로 답해 화면 계산을 건너뛰게 한다
  cy.headless = () => true;
  // 나머지 핵심 호출(맞춤·크기·이동·배치·애니메이션·일괄)은 던지지 않게 감싼다
  for (const k of ['fit', 'resize', 'panBy', 'pan', 'zoom', 'center', 'viewport', 'layout', 'animate', 'batch', 'width', 'height', 'extent', 'renderedExtent', 'forceRender', 'notify']) {
    const orig = typeof cy[k] === 'function' ? cy[k].bind(cy) : null;
    if (!orig) continue;
    cy[k] = (...a: unknown[]) => {
      try {
        return orig(...a);
      } catch {
        return k === 'width' || k === 'height' || k === 'zoom' ? 0 : cy;
      }
    };
  }
}
