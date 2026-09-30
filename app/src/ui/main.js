// 화면 진입점. 빌드하면 모듈 없는 단일 스크립트(IIFE)가 된다(P-1).

import { createApp } from '../app/app.js';
import { createStore, openStorage } from '../store/local.js';
import { SAMPLE_T01 } from '../../data/sample-t01.js';
import { NODE_TYPES, edgeTypeLabel, nodeTypeLabel } from '../model/schema.js';
import { createGraph } from './graph.js';
import { messageFor } from './messages.js';

// ISO 8601 날짜·시각 + 현지 시간대(12.1)
function nowIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(off) / 60));
  const om = pad(Math.abs(off) % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:${pad(d.getSeconds())}${sign}${oh}:${om}`;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

function start() {
  const storage = openStorage(() => window.localStorage);
  const app = createApp({ store: storage ? createStore(storage) : null, sample: SAMPLE_T01, now: nowIso });

  const $ = (id) => document.getElementById(id);
  let selectedId = null;

  // 경고 배너(W-STORAGE 등)
  const banner = $('banner');
  if (app.warnings.length) {
    banner.textContent = app.warnings.map(messageFor).join(' ');
    banner.dataset.code = app.warnings.map((w) => w.code).join(' ');
    banner.hidden = false;
  }

  $('universe-title').textContent = `${app.doc.universe.name} (${app.doc.universe.level})`;

  const graph = createGraph($('graph'), { onSelect: select });

  function select(id) {
    selectedId = id;
    renderDetail();
  }

  function renderDetail() {
    const panel = $('detail');
    panel.replaceChildren();
    const doc = app.doc;
    const node = selectedId && doc.nodes.find((n) => n.id === selectedId);
    if (!node) {
      panel.append(el('p', { class: 'muted' }, '노드를 클릭하면 상세가 보입니다.'));
      return;
    }
    panel.append(el('h2', {}, node.label));
    const dl = el('dl');
    const row = (k, v) => dl.append(el('dt', {}, k), el('dd', {}, v));
    row('유형', nodeTypeLabel(node.core_type) + (node.subtype ? ` > ${node.subtype}` : ''));
    row('ID', `${doc.universe.id}/${node.id}`);
    if (node.emp_no) row('사번', node.emp_no);
    if (node.description) row('설명', node.description);
    for (const [k, v] of Object.entries(node.attrs || {})) row(k, String(v));
    panel.append(dl);

    panel.append(el('h3', {}, '연결된 노드'));
    const links = doc.edges.filter((e) => !e.hidden && (e.source === node.id || e.target === node.id));
    if (!links.length) {
      panel.append(el('p', { class: 'muted', 'data-testid': 'no-links' }, '연결 없음'));
      return;
    }
    const ul = el('ul', { 'data-testid': 'links' });
    for (const e of links) {
      const otherId = e.source === node.id ? e.target : e.source;
      const other = doc.nodes.find((n) => n.id === otherId);
      const dir = e.source === node.id ? '→' : '←';
      const btn = el('button', { type: 'button', class: 'link', onclick: () => focusNode(otherId) }, other ? other.label : otherId);
      ul.append(el('li', {}, `${edgeTypeLabel(e.core_type)} ${dir} `, btn));
    }
    panel.append(ul);
  }

  function focusNode(id) {
    graph.cy.$(':selected').unselect();
    graph.cy.getElementById(id).select();
    select(id);
  }

  // 노드 추가 양식
  const form = $('add-form');
  const typeSel = $('add-type');
  for (const [key, name] of Object.entries(NODE_TYPES)) {
    if (key !== 'root') typeSel.append(el('option', { value: key }, name));
  }
  const empRow = $('add-empno-row');
  const syncEmp = () => {
    empRow.hidden = typeSel.value !== 'person';
  };
  typeSel.addEventListener('change', syncEmp);
  syncEmp();

  if (app.readOnly) {
    for (const input of form.elements) input.disabled = true;
    $('reset').disabled = true;
  }

  form.addEventListener('submit', (evt) => {
    evt.preventDefault();
    const msg = $('add-message');
    msg.replaceChildren();
    msg.className = '';
    const result = app.addNode({
      core_type: typeSel.value,
      label: $('add-label').value,
      emp_no: $('add-empno').value,
    });
    if (!result.ok) {
      msg.className = 'error';
      msg.dataset.code = result.error.code;
      msg.append(messageFor(result.error));
      if (result.error.existing_id) {
        const id = result.error.existing_id;
        msg.append(' ', el('button', { type: 'button', class: 'link', onclick: () => focusNode(id) }, '기존 노드 보기'));
      }
      return;
    }
    msg.className = 'ok';
    msg.dataset.code = result.warnings.map((w) => w.code).join(' ') || 'OK';
    msg.append(`저장했습니다: ${result.node.label}`, ...result.warnings.map((w) => ` ${messageFor(w)}`));
    form.reset();
    syncEmp();
    selectedId = result.node.id;
    graph.render(app.doc, selectedId);
    renderDetail();
  });

  $('reset').addEventListener('click', () => {
    if (!window.confirm('가상 데이터를 초기 샘플로 되돌립니다. 추가한 노드는 사라집니다.')) return;
    app.resetToSample();
    selectedId = null;
    graph.render(app.doc, null);
    renderDetail();
  });

  graph.render(app.doc, null);
  renderDetail();

  // 개발 점검 도구(tools/browser-check.mjs)가 그래프 좌표를 읽기 위한 읽기 전용 연결점
  window.__wu = { cy: graph.cy, get doc() { return app.doc; }, readOnly: app.readOnly };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
