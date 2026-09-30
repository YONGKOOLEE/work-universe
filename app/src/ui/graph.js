// 그래프 라이브러리(Cytoscape.js) 연결. 다른 모듈은 이 파일을 통해서만 라이브러리를 쓴다.

import cytoscape from 'cytoscape';
import { edgeTypeLabel } from '../model/schema.js';

const TYPE_COLORS = {
  root: '#5b4bc4',
  person: '#1f8a70',
  work: '#2f6fb5',
  artifact: '#c27c0e',
  org: '#7a7a7a',
  topic: '#b8456b',
};

function toElements(doc) {
  const nodes = doc.nodes
    .filter((n) => !n.hidden)
    .map((n) => ({ group: 'nodes', data: { id: n.id, label: n.label, core_type: n.core_type } }));
  const visible = new Set(nodes.map((n) => n.data.id));
  const edges = doc.edges
    .filter((e) => !e.hidden && visible.has(e.source) && visible.has(e.target))
    .map((e) => ({
      group: 'edges',
      data: { id: e.id, source: e.source, target: e.target, label: edgeTypeLabel(e.core_type) },
    }));
  return [...nodes, ...edges];
}

export function createGraph(container, { onSelect }) {
  const cy = cytoscape({
    container,
    elements: [],
    wheelSensitivity: 0.3,
    style: [
      {
        selector: 'node',
        style: {
          label: 'data(label)',
          'background-color': (el) => TYPE_COLORS[el.data('core_type')] || '#999',
          color: '#1d1d1f',
          'font-size': 12,
          'text-valign': 'bottom',
          'text-margin-y': 4,
          width: 28,
          height: 28,
        },
      },
      { selector: 'node[core_type = "root"]', style: { width: 40, height: 40, shape: 'round-rectangle' } },
      { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#111' } },
      {
        selector: 'edge',
        style: {
          label: 'data(label)',
          'font-size': 10,
          color: '#555',
          width: 1.5,
          'line-color': '#aaa',
          'target-arrow-color': '#aaa',
          'target-arrow-shape': 'triangle',
          'curve-style': 'bezier',
          'text-background-color': '#fff',
          'text-background-opacity': 1,
        },
      },
    ],
  });

  cy.on('tap', 'node', (evt) => onSelect(evt.target.id()));
  cy.on('tap', (evt) => {
    if (evt.target === cy) onSelect(null);
  });

  return {
    cy,
    render(doc, selectedId) {
      cy.elements().remove();
      cy.add(toElements(doc));
      cy.layout({ name: 'cose', animate: false, randomize: false, padding: 40 }).run();
      if (selectedId) cy.getElementById(selectedId).select();
    },
  };
}
