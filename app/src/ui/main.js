// 화면 진입점. 빌드하면 모듈 없는 단일 스크립트(IIFE)가 된다(P-1).

import { createApp } from '../app/app.js';
import { createStore, openStorage } from '../store/local.js';
import { SAMPLES } from '../../data/index.js';
import { NODE_TYPES } from '../model/schema.js';
import { describeNode, describeUniverse, eventText } from '../view/describe.js';
import { exposureOf, projectView } from '../view/collapse.js';
import { parseGid, toGid } from '../view/view.js';
import { el } from './dom.js';
import { createGraph, legendItems } from './graph.js';
import { renderNodeDetail, renderUniverseSummary } from './detail.js';
import { edgeEditForm, edgeForm, eventForm, nodeForm } from './editor.js';
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
  let editing = null; // 편집 중인 양식: {kind:'node'|'edge'|'event'|'edge-edit', edgeId?}
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

  // ── 자료 편집(R-02, T-06) ───────────────────────────────────────────
  const currentId = () => app.doc.universe.id;
  const isOwn = (gid) => !!gid && parseGid(gid).universe_id === currentId();
  const localNode = (gid) => app.doc.nodes.find((n) => n.id === parseGid(gid).local_id);
  // 양식에서 고를 수 있는 이 유니버스의 노드(숨김 제외)
  const ownNodes = () => view.nodes.filter((n) => n.universe_id === currentId() && !n.hidden);

  function afterSave(result, nextSelected = selected) {
    if (!result.ok) return result;
    editing = null;
    selected = nextSelected;
    refresh();
    return result;
  }

  function toolbar(gid) {
    const node = view.getNode(gid);
    if (!node || node.hidden) return null;
    if (!isOwn(gid)) {
      return el('p', { class: 'muted small' }, '다른 유니버스의 노드입니다. 고치려면 ',
        el('button', { type: 'button', class: 'link', onclick: () => openUniverse(node.universe_id) }, `「${node.universe_name}」 열기`), '.');
    }
    if (app.readOnly) return null;
    const btn = (label, kind, testid) => el('button', { type: 'button', 'data-testid': testid, onclick: () => { editing = { kind }; renderPanel(); } }, label);
    return el('div', { class: 'row toolbar' },
      btn('수정', 'node', 'btn-edit'),
      btn('연결 추가', 'edge', 'btn-edge'),
      btn('이력 추가', 'event', 'btn-event'),
      node.core_type === 'root' ? null : el('button', { type: 'button', class: 'danger', 'data-testid': 'btn-hide', onclick: () => hideSelected(node) }, '숨기기'),
    );
  }

  function hideSelected(node) {
    if (!window.confirm(`「${node.label}」을(를) 숨깁니다. 그래프에서 사라지지만 이력과 근거로서의 내용은 남습니다.`)) return;
    const r = app.hideNode(node.id);
    if (!r.ok) return window.alert(messageFor(r.error));
    afterSave(r, null);
  }

  function linkTools(link) {
    if (app.readOnly || link.synthetic || !isOwn(link.edge_gid)) return null;
    const edgeId = parseGid(link.edge_gid).local_id;
    const title = `${link.relation} ${link.other.label}`;
    return el('div', { class: 'row link-tools' },
      el('button', { type: 'button', class: 'small-btn', onclick: () => { editing = { kind: 'edge-edit', edgeId, title }; renderPanel(); } }, '수정'),
      el('button', { type: 'button', class: 'small-btn danger', onclick: () => {
        if (!window.confirm(`연결 「${title}」을(를) 숨깁니다. 기록은 남습니다.`)) return;
        const r = app.hideEdge(edgeId);
        if (!r.ok) return window.alert(messageFor(r.error, { kind: 'edge' }));
        afterSave(r);
      } }, '숨기기'),
    );
  }

  function editorFor(gid) {
    const node = localNode(gid);
    const cancel = () => { editing = null; renderPanel(); };
    const focusLocal = (id) => { editing = null; focus(toGid(currentId(), id)); };
    switch (editing.kind) {
      case 'node':
        return nodeForm({ mode: 'edit', node, subtypes: app.doc.universe.subtypes || [], onCancel: cancel, onFocusLocal: focusLocal,
          onSubmit: (values) => afterSave(app.updateNode(currentId(), node.id, values)) });
      case 'edge':
        return edgeForm({ node, candidates: ownNodes().filter((n) => n.id !== node.id), onCancel: cancel,
          onSubmit: (values) => afterSave(app.addEdge(values)) });
      case 'edge-edit': {
        const edge = app.doc.edges.find((e) => e.id === editing.edgeId);
        return edgeEditForm({ edge, title: editing.title, onCancel: cancel, onSubmit: (values) => afterSave(app.updateEdge(edge.id, values)) });
      }
      case 'event': {
        const handovers = view.events
          .filter((e) => e.universe_id === currentId() && e.type === 'handover')
          .map((e) => ({ id: e.id, occurred_at: e.occurred_at, text: eventText(view, e) }));
        return eventForm({ node, nodes: ownNodes(), handovers, onCancel: cancel, onSubmit: (values) => afterSave(app.addEvent(values)) });
      }
      default:
        return null;
    }
  }

  function renderPanel() {
    const panel = $('detail');
    if (!selected) return renderUniverseSummary(panel, describeUniverse(view));
    if (editing && isOwn(selected) && localNode(selected)) {
      panel.replaceChildren(el('h2', {}, localNode(selected).label), editorFor(selected));
      return;
    }
    return renderNodeDetail(panel, describeNode(view, selected), {
      onFocus: focus,
      extra: layerControls(selected),
      toolbar: toolbar(selected),
      linkTools,
    });
  }

  function select(gid) {
    if (gid !== selected) editing = null;
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

  // 노드 추가(R-02 ①): 저장하면 바로 그래프에 나타나고 선택된다
  function renderAddForm(doneText) {
    const slot = $('add-slot');
    if (app.readOnly) {
      slot.replaceChildren(el('p', { class: 'muted small' }, '읽기 전용이라 추가할 수 없습니다.'));
      $('reset').disabled = true;
      return;
    }
    slot.replaceChildren(
      doneText ? el('p', { class: 'ok-text', 'data-testid': 'add-done' }, doneText) : null,
      nodeForm({
        mode: 'add',
        subtypes: app.doc.universe.subtypes || [],
        onFocusLocal: (id) => focus(toGid(currentId(), id)),
        onSubmit: (values) => {
          const r = app.addNode(values);
          if (!r.ok) return r;
          afterSave(r, toGid(currentId(), r.node.id));
          renderAddForm(`추가했습니다: ${r.node.label}${r.warnings.map((w) => ` ${messageFor(w)}`).join('')}`);
          return r;
        },
      }),
    );
  }
  renderAddForm();

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
