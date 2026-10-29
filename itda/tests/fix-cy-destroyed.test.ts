// 처음 사용 1 M-6: 파기된 cytoscape 인스턴스에 늦게 불리는 호출(라벨 타이머·창 크기 변경·rAF)이 예외를 내지 않는다
import { describe, expect, it } from 'vitest';
import cytoscape from 'cytoscape';
import { retireCy } from '../src/universe/retireCy';

function make() {
  return cytoscape({ headless: true, elements: [{ data: { id: 'a' } }, { data: { id: 'b' } }, { data: { id: 'e', source: 'a', target: 'b' } }] });
}
// graph.js의 늦은 콜백이 부르는 것들(applyLabels·syncSize·fitTo·창 크기 변경)을 흉내 낸 호출 묶음
function lateCalls(cy: any) {
  cy.nodes().map((n: any) => n.boundingBox({ includeLabels: true, includeMainLabels: true }));
  cy.nodes().boundingBox({ includeNodes: true, includeEdges: false, includeLabels: true });
  cy.fit(undefined, 40);
  cy.resize();
  cy.panBy({ x: 1, y: 1 });
  cy.edges('.hood, .labeled').style({ 'font-size': 10 });
  cy.batch(() => cy.nodes().toggleClass('tiny-label', true));
  cy.width();
  cy.height();
  cy.zoom();
}

describe('파기된 cytoscape(M-6)', () => {
  it('보호 없이 destroy하면 늦은 호출이 isHeadless 예외를 낸다(재현)', () => {
    const cy = make();
    cy.destroy();
    expect(cy.destroyed()).toBe(true);
    expect(() => lateCalls(cy)).toThrow(/isHeadless/);
  });
  it('retireCy로 정리하면 같은 호출이 예외 없이 지나간다', () => {
    const cy = make();
    retireCy(cy);
    expect(cy.destroyed()).toBe(true);
    expect(() => lateCalls(cy)).not.toThrow();
  });
  it('이미 파기된 것을 다시 정리해도 괜찮다', () => {
    const cy = make();
    cy.destroy();
    expect(() => retireCy(cy)).not.toThrow();
    expect(() => lateCalls(cy)).not.toThrow();
  });
});
