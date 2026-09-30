// 화면 진입점. 빌드하면 모듈 없는 단일 스크립트(IIFE)가 된다(P-1).

import { createApp } from '../app/app.js';
import { createStore, openStorage } from '../store/local.js';
import { SAMPLES } from '../../data/index.js';
import { NODE_TYPES } from '../model/schema.js';
import { describeNode, describeUniverse } from '../view/describe.js';
import { exposureOf, projectView } from '../view/collapse.js';
import { parseGid, toGid } from '../view/view.js';
import { el } from './dom.js';
import { createGraph, legendItems } from './graph.js';
import { renderNodeDetail, renderUniverseSummary } from './detail.js';
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

// 다른 유니버스로 이동: 주소 끝의 #유니버스ID를 바꾸고 다시 연다(file://에서도 동작)
function openUniverse(id) {
  location.hash = id;
  location.reload();
}

function start() {
  const storage = openStorage(() => window.localStorage);
  const app = createApp({
    store: storage ? createStore(storage) : null,
    samples: SAMPLES,
    currentId: decodeURIComponent(location.hash.slice(1)),
    now: nowIso,
  });

  const $ = (id) => document.getElementById(id);
  let selected = null; // 선택한 노드의 전역 ID
  const expanded = new Set(); // 펼친 하위 유니버스
  let view = app.view;
  let display = projectView(view, { expanded });

  // 경고 배너(W-STORAGE 등)
  const banner = $('banner');
  if (app.warnings.length) {
    banner.textContent = app.warnings.map(messageFor).join(' ');
    banner.dataset.code = app.warnings.map((w) => w.code).join(' ');
    banner.hidden = false;
  }

  const picker = $('universe-picker');
  for (const u of app.universes()) {
    picker.append(el('option', { value: u.id, selected: u.id === app.doc.universe.id }, `${u.name} (${u.level})`));
  }
  picker.addEventListener('change', () => openUniverse(picker.value));

  const graph = createGraph($('graph'), { onSelect: select, onToggle: toggle });

  function renderLegend() {
    $('legend').replaceChildren(
      ...[
      ...legendItems(display).map((i) => el('li', {}, el('span', { class: 'dot', style: `background:${i.color}` }), i.label)),
      display.collapsed.size
        ? el('li', { class: 'legend-note' }, el('span', { class: 'dot collapsed' }), '이중 테두리 + 숫자: 접힌 하위 유니버스(더블클릭하면 펼침) · 점선: 요약 연결')
        : null,
      ].flat().filter(Boolean),
    );
  }

  // 층별 보기 조작(CR-4 시제품): 하위 유니버스 꼭지면 펼치기·이동·빼기, 그 밖의 노드면 위로 드러내기
  function layerControls(gid) {
    const node = view.getNode(gid);
    if (!node) return null;
    const box = el('div', { class: 'layer', 'data-testid': 'layer' });
    const isChildRoot = node.core_type === 'root' && node.universe_id !== app.doc.universe.id;
    if (isChildRoot) {
      const info = display.collapsed.get(node.universe_id);
      box.append(
        el('p', { class: 'muted small' }, info ? `접혀 있음: 세부 노드 ${info.hidden_count}개가 가려져 있습니다.` : '펼쳐져 있음'),
        el('div', { class: 'row' },
          el('button', { type: 'button', 'data-testid': 'toggle', onclick: () => toggle(node.universe_id) }, info ? '펼치기' : '접기'),
          el('button', { type: 'button', onclick: () => openUniverse(node.universe_id) }, '이 유니버스 열기'),
          app.doc.refs.some((r) => r.child_universe_id === node.universe_id && !r.hidden)
            ? el('button', { type: 'button', disabled: app.readOnly, onclick: () => removeChild(node.universe_id, node.label) }, '묶음에서 빼기')
            : null,
        ),
      );
      return box;
    }
    if (node.core_type === 'root') return null;
    const exp = exposureOf(view, gid);
    const { universe_id: uid, local_id: lid } = parseGid(gid);
    const cb = el('input', { type: 'checkbox', checked: exp.exposed, disabled: app.readOnly, 'data-testid': 'exposed' });
    cb.addEventListener('change', () => {
      const r = app.updateNode(uid, lid, { exposed: cb.checked });
      if (!r.ok) return window.alert(messageFor(r.error));
      refresh();
    });
    box.append(
      el('label', { class: 'check' }, cb, ' 위층(상위 유니버스)에 드러내기'),
      el('div', { class: 'muted small' }, `${exp.explicit ? '직접 지정' : '기본 규칙'}: ${exp.reason}`),
    );
    return box;
  }

  function renderPanel() {
    const panel = $('detail');
    if (!selected) return renderUniverseSummary(panel, describeUniverse(view));
    return renderNodeDetail(panel, describeNode(view, selected), { onFocus: focus, extra: layerControls(selected) });
  }

  function select(gid) {
    selected = gid;
    graph.highlight(gid);
    renderPanel();
  }

  // 상세 패널의 연결된 노드를 눌렀을 때: 그래프에서도 그 노드로 이동한다(접혀 있어 안 보이면 이동만 생략)
  function focus(gid) {
    select(view.canonical(gid));
    const node = graph.cy.getElementById(view.canonical(gid));
    if (!node.empty()) graph.cy.animate({ center: { eles: node } }, { duration: 200 });
  }

  function refresh() {
    view = app.view;
    display = projectView(view, { expanded });
    graph.render(display, selected);
    renderLegend();
    renderPanel();
  }

  function toggle(universeId) {
    if (universeId === app.doc.universe.id) return;
    if (expanded.has(universeId)) expanded.delete(universeId);
    else expanded.add(universeId);
    refresh();
    graph.relayout();
  }

  function removeChild(childId, label) {
    if (!window.confirm(`「${label}」을(를) 이 묶음에서 뺍니다. 원래 유니버스는 그대로 남습니다.`)) return;
    const r = app.removeChild(childId);
    if (!r.ok) return window.alert(messageFor(r.error));
    expanded.delete(childId);
    selected = null;
    refresh();
    graph.relayout();
  }

  $('fit').addEventListener('click', () => graph.fit());
  $('relayout').addEventListener('click', () => graph.relayout());

  // 유니버스 묶기(R-11 ①, CR-4 시제품): 사용자가 하위 유니버스와 이름·단위를 고른다
  const dialog = $('group-dialog');
  $('group-open').addEventListener('click', () => {
    const list = $('group-children');
    list.replaceChildren(
      ...app.universes().map((u) =>
        el('label', { class: 'check' }, el('input', { type: 'checkbox', value: u.id }), ` ${u.name} (${u.level})`),
      ),
    );
    $('group-message').textContent = '';
    dialog.showModal();
  });
  $('group-cancel').addEventListener('click', () => dialog.close());
  $('group-form').addEventListener('submit', (evt) => {
    evt.preventDefault();
    const childIds = [...$('group-children').querySelectorAll('input:checked')].map((i) => i.value);
    const r = app.groupUniverses({ name: $('group-name').value, level: $('group-level').value, owner: $('group-owner').value, childIds });
    if (!r.ok) {
      $('group-message').textContent =
        r.error.field === 'child_universe_ids' ? '유니버스를 2개 이상 고르세요.' : messageFor(r.error);
      return;
    }
    openUniverse(r.doc.universe.id);
  });
  if (app.readOnly) $('group-open').disabled = true;

  // 노드 추가 양식(T-06에서 자료 편집 화면으로 대체된다)
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
        const gid = toGid(app.doc.universe.id, result.error.existing_id);
        msg.append(' ', el('button', { type: 'button', class: 'link', onclick: () => focus(gid) }, '기존 노드 보기'));
      }
      return;
    }
    msg.className = 'ok';
    msg.dataset.code = result.warnings.map((w) => w.code).join(' ') || 'OK';
    msg.append(`저장했습니다: ${result.node.label}`, ...result.warnings.map((w) => ` ${messageFor(w)}`));
    form.reset();
    syncEmp();
    selected = toGid(app.doc.universe.id, result.node.id);
    refresh();
  });

  $('reset').addEventListener('click', () => {
    if (!window.confirm('모든 가상 데이터를 초기 샘플로 되돌립니다. 추가한 노드와 직접 묶은 유니버스는 사라집니다.')) return;
    app.resetAll();
    openUniverse(app.doc.universe.id);
  });

  refresh();

  // 개발 점검 도구(tools/browser-check.mjs)가 그래프 좌표와 상태를 읽기 위한 연결점
  window.__wu = {
    cy: graph.cy,
    select,
    toggle,
    get doc() {
      return app.doc;
    },
    get view() {
      return view;
    },
    get display() {
      return display;
    },
    get selected() {
      return selected;
    },
    readOnly: app.readOnly,
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
