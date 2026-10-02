// 화면 진입점. 빌드하면 모듈 없는 단일 스크립트(IIFE)가 된다(P-1).

import { createApp } from '../app/app.js';
import { createStore, loadSettings, openStorage, saveSettings } from '../store/local.js';
import { PREGEN } from '../../data/pregen.js';
import { DEFAULT_PROVIDER, PROVIDERS, createProvider } from '../llm/providers.js';
import { settingsPanel } from './settings.js';
import { mergePanel } from './merge.js';
import { SAMPLES, SAMPLE_GUIDE } from '../../data/index.js';
import { startScreen } from './start.js';
import { NODE_TYPES } from '../model/schema.js';
import { describeNode, describeUniverse, eventText } from '../view/describe.js';
import { exposureOf, projectView } from '../view/collapse.js';
import { parseGid, toGid } from '../view/view.js';
import { el } from './dom.js';
import { createGraph, legendItems } from './graph.js';
import { renderNodeDetail, renderUniverseSummary } from './detail.js';
import { edgeEditForm, edgeForm, eventForm, nodeForm } from './editor.js';
import { draftPanel } from './draft.js';
import { currentDenseN, insightPanel, todayLocal } from './insight.js';
import { personLoad, repeatPatternsFor, workLoad } from '../rules/insight.js';
import { monthAsOf, timeMonths } from '../rules/flow.js';
import { periodStatus } from '../view/describe.js';
import { messageFor } from './messages.js';
import { exportFileName, importDialog } from './import.js';
import { convertDocument } from '../rules/doc-convert.js';
import { convertDocumentWith } from '../llm/connector.js';
import { DOC_EXAMPLE } from '../../data/doc-example.js';

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

// 새 유니버스(R-12): 이름·단위·작성 주체가 필수. 같은 이름·단위가 있으면 확인한다. 시작 화면과 본 화면이 함께 쓴다
function wireCreateDialog(app, $) {
  const dialog = $('create-dialog');
  const open = () => {
    $('create-form').reset();
    $('create-message').textContent = '';
    dialog.showModal();
  };
  $('create-open').addEventListener('click', open);
  $('create-cancel').addEventListener('click', () => dialog.close());
  $('create-form').addEventListener('submit', (evt) => {
    evt.preventDefault();
    const input = { name: $('create-name').value, level: $('create-level').value, owner: $('create-owner').value, description: $('create-description').value };
    const same = input.name.trim() && input.level.trim() ? app.findSameUniverse(input.name, input.level) : null;
    if (same && !window.confirm(`같은 이름·단위의 유니버스「${same.name}」(${same.level})가 이미 있습니다. 그래도 새로 만들까요?`)) return;
    const r = app.createUniverse(input);
    if (!r.ok) {
      $('create-message').textContent = messageFor(r.error);
      $('create-message').dataset.code = r.error.code;
      return;
    }
    openUniverse(r.doc.universe.id);
  });
  if (app.readOnly) $('create-open').disabled = true;
  return open;
}

// 가져오기(T-17): 문서 초벌 변환(CR-5 ②)·JSON 파일 → 미리 보기 → 가져오기. 시작 화면과 본 화면이 함께 쓴다
function wireImportDialog(app, $, getProvider, methodLabel, onExport = null) {
  const open = importDialog({
    onExport,
    dialog: $('import-dialog'),
    app,
    convert: (text) => convertDocumentWith(text, { provider: getProvider(), ruleConvert: (t) => convertDocument(t, { now: nowIso() }) }),
    methodLabel,
    example: DOC_EXAMPLE,
    onImported: openUniverse,
  });
  $('import-open').addEventListener('click', open);
  return open;
}

// 내보내기(D-06): 현재 유니버스를 JSON 파일로 내려받는다(file://에서도 동작하는 a[download])
function exportCurrent(app) {
  const url = URL.createObjectURL(new Blob([app.exportJson()], { type: 'application/json' }));
  const a = el('a', { href: url, download: exportFileName(app.doc.universe) });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 시작 화면으로: 주소의 #유니버스ID를 지우고 다시 연다
function goStart() {
  history.replaceState(null, '', location.pathname + location.search);
  location.reload();
}

// 주소의 #유니버스ID. 깨진 인코딩(#%E0 등)이면 빈 값으로 보고 시작 화면을 연다
function hashId() {
  try {
    return decodeURIComponent(location.hash.slice(1));
  } catch {
    return '';
  }
}

function start() {
  const storage = openStorage(() => window.localStorage);
  const app = createApp({
    store: storage ? createStore(storage) : null,
    samples: SAMPLES,
    currentId: hashId(),
    now: nowIso,
  });

  const $ = (id) => document.getElementById(id);

  // 생성 방식(R-15): 설정에서 고른 공급자. 기본은 사전 생성(12.4)
  const settings = loadSettings(storage, { provider: DEFAULT_PROVIDER }, PROVIDERS.map((p) => p.name));
  let provider = createProvider(settings.provider, { pregen: PREGEN });
  const providerLabel = () => (PROVIDERS.find((p) => p.name === settings.provider) || PROVIDERS[0]).label;
  const openImport = wireImportDialog(app, $, () => provider, providerLabel, location.hash.slice(1) ? () => exportCurrent(app) : null);

  // 주소에 유니버스가 없으면(더블클릭으로 처음 열었을 때) 시작 화면을 보여 준다(R-08)
  if (!location.hash.slice(1)) {
    document.body.classList.add('start-mode');
    const openCreate = wireCreateDialog(app, $);
    $('start-screen').replaceChildren(startScreen({
      universes: app.universes(),
      guide: SAMPLE_GUIDE,
      warnings: app.warnings.map((w) => messageFor(w)),
      readOnly: app.readOnly,
      onOpen: openUniverse,
      onCreate: openCreate,
      onImport: openImport,
    }));
    window.__wu = { start: true, readOnly: app.readOnly };
    return;
  }
  let selected = null; // 선택한 노드의 전역 ID
  let editing = null; // 편집 중인 양식: {kind:'node'|'edge'|'event'|'edge-edit', edgeId?}
  let drafting = null; // 인수인계 초안 화면: {target}
  let insight = null; // 인사이트 화면: {work, kind}
  let viewDate = null; // 시간 슬라이더로 고른 기준일(YYYY-MM-DD). null이면 오늘
  let settingsOpen = false;
  let merging = false; // 통합 확인 목록(T-10)
  const asOf = () => viewDate || todayLocal();
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

  $('home').addEventListener('click', goStart);
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

  function draftButton(gid) {
    const node = view.getNode(gid);
    if (!node || !['root', 'work'].includes(node.core_type)) return null;
    return el('button', { type: 'button', class: 'primary', 'data-testid': 'btn-draft', onclick: () => openDraft(node.gid) }, '인수인계 초안 만들기');
  }

  function openDraft(targetGid) {
    settingsOpen = false;
    merging = false;
    editing = null;
    insight = null;
    drafting = { target: targetGid };
    renderPanel();
  }

  function openInsight(workGid, kind = 'similar') {
    settingsOpen = false;
    merging = false;
    editing = null;
    drafting = null;
    insight = { work: workGid, kind };
    renderPanel();
  }

  // 업무 노드에만 보이는 "유사 경험자" 버튼
  function insightButton(gid) {
    const node = view.getNode(gid);
    if (!node || node.core_type !== 'work') return null;
    return el('button', { type: 'button', 'data-testid': 'btn-similar', onclick: () => openInsight(node.gid) }, '유사 경험자');
  }

  // 사람 노드: 지금 맡은 업무 수와 밀집 기준 해당 여부. 누르면 인사이트의 밀집·공백 탭이 열린다
  function loadNote(gid) {
    const load = personLoad(view, gid, { asOf: asOf(), n: currentDenseN() });
    // 담당 기록이 한 번도 없는 사람(조직관리의 사람 등)에게는 표시하지 않는다
    if (!load || !view.edges.some((e) => !e.hidden && e.core_type === 'performs' && e.source === view.canonical(gid))) return null;
    const when = viewDate ? `${viewDate} 기준` : '지금';
    const text = load.count === 0 ? `${when} 맡은 업무 없음` : `${when} 맡은 업무 ${load.count}개 — ${load.dense ? `밀집 기준(${load.n}개 이상)에 해당` : `밀집 기준(${load.n}개 이상) 아래`}`;
    return el('p', { class: load.dense ? 'notice' : 'muted small', 'data-testid': 'person-load' }, text, ' ',
      el('button', { type: 'button', class: 'link', 'data-testid': 'btn-person-density', onclick: () => openInsight('', 'density') }, '밀집·공백 보기'));
  }

  // 업무 노드: 현재 담당 또는 공백 종류. 누르면 밀집·공백 탭
  function workNote(gid) {
    const w = workLoad(view, gid, { asOf: asOf() });
    if (!w) return null;
    const text = w.work_ended ? '기간이 끝난 업무'
      : w.work_scheduled ? `시작 전 업무(${w.work_start}부터)`
      : w.kind === 'covered' ? `${viewDate ? `${viewDate} 기준 담당` : '현재 담당'}: ${w.current.map((p) => p.label).join(', ')}`
      : w.kind === 'scheduled' ? `공백 — 시작 예정 담당자만 있음(${w.next_person.label}, ${w.next_start}부터)`
      : w.kind === 'ended' ? `공백 — 이전 담당자만 있음(${w.last_person.label}, ${w.last_end}까지). 끝난 업무인지 확인`
      : '공백 — 담당 기록 없음';
    const gap = !w.work_ended && !w.work_scheduled && w.kind !== 'covered';
    return el('p', { class: gap ? 'notice' : 'muted small', 'data-testid': 'work-load' }, text, ' ',
      el('button', { type: 'button', class: 'link', 'data-testid': 'btn-work-density', onclick: () => openInsight('', 'density') }, '밀집·공백 보기'));
  }

  // 업무·주제 노드가 반복 비효율 패턴에 들어 있으면 한 줄
  function repeatNote(gid) {
    const node = view.getNode(gid);
    if (!node || node.hidden || !['work', 'topic'].includes(node.core_type)) return null;
    const hits = repeatPatternsFor(view, gid, viewDate);
    if (!hits.length) return null;
    const kinds = [...new Set(hits.map((p) => (p.kind === 'handover_chain' ? '인수인계 반복' : '주제 반복')))].join('·');
    return el('p', { class: 'notice', 'data-testid': 'repeat-note' }, `반복 비효율 패턴 ${hits.length}건에 포함(${kinds}) `,
      el('button', { type: 'button', class: 'link', 'data-testid': 'btn-repeat-note', onclick: () => openInsight('', 'repeat') }, '반복 비효율 보기'));
  }

  // 하위 유니버스를 묶은 유니버스의 개요: 통합 확인 목록으로 가는 버튼(대기 건수)
  function mergeButton() {
    const plan = app.mergePlan();
    if (!plan) return null;
    return el('p', { class: plan.counts.pending ? 'notice' : 'muted small', 'data-testid': 'merge-hint' },
      plan.counts.pending ? `통합 확인 대기 ${plan.counts.pending}건(사람 ${plan.counts.persons}, 업무 후보 ${plan.counts.works}) ` : '통합 확인할 항목이 없습니다. ',
      el('button', { type: 'button', class: 'link', 'data-testid': 'btn-merge', onclick: () => { merging = true; insight = null; drafting = null; editing = null; settingsOpen = false; renderPanel(); } }, '통합 확인 목록'));
  }

  function toolbar(gid) {
    const node = view.getNode(gid);
    if (!node || node.hidden) return null;
    if (!isOwn(gid)) {
      const draft = draftButton(gid);
      const sim = insightButton(gid);
      return el('div', {}, draft || sim ? el('div', { class: 'row toolbar' }, draft, sim) : null,
        el('p', { class: 'muted small' }, '다른 유니버스의 노드입니다. 고치려면 ',
          el('button', { type: 'button', class: 'link', onclick: () => openUniverse(node.universe_id) }, `「${node.universe_name}」 열기`), '.'));
    }
    if (app.readOnly) {
      const draft = draftButton(gid);
      const sim = insightButton(gid);
      return draft || sim ? el('div', { class: 'row toolbar' }, draft, sim) : null;
    }
    const btn = (label, kind, testid) => el('button', { type: 'button', 'data-testid': testid, onclick: () => { editing = { kind }; renderPanel(); } }, label);
    return el('div', { class: 'row toolbar' },
      btn('수정', 'node', 'btn-edit'),
      btn('연결 추가', 'edge', 'btn-edge'),
      btn('이력 추가', 'event', 'btn-event'),
      node.core_type === 'root' ? null : el('button', { type: 'button', class: 'danger', 'data-testid': 'btn-hide', onclick: () => hideSelected(node) }, '숨기기'),
      draftButton(gid),
      insightButton(gid),
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
        return nodeForm({ mode: 'edit', node, subtypes: app.doc.universe.subtypes || [], onAddSubtype: (t, nm) => app.addSubtype(t, nm), onCancel: cancel, onFocusLocal: focusLocal,
          onSubmit: (values) => afterSave(app.updateNode(currentId(), node.id, values)) });
      case 'edge':
        return edgeForm({ node, subtypes: app.doc.universe.subtypes || [], onAddSubtype: (t, nm) => app.addSubtype(t, nm), candidates: ownNodes().filter((n) => n.id !== node.id), onCancel: cancel,
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

  // 그래프에 없는 노드(접힌 하위 유니버스 안)면 그 유니버스와 위쪽 유니버스를 펼친다. 펼쳤으면 true
  function reveal(gid) {
    const g = view.canonical(gid);
    if (!graph.cy.getElementById(g).empty()) return false;
    const node = view.getNode(g);
    if (!node || node.hidden) return false;
    const parentOf = new Map(view.ref_links.map((l) => [l.child, l.parent]));
    let changed = false;
    for (let u = node.universe_id; u && u !== app.doc.universe.id; u = parentOf.get(u)) {
      if (!expanded.has(u)) {
        expanded.add(u);
        changed = true;
      }
    }
    if (!changed) return false;
    display = projectView(view, { expanded });
    graph.render(display, selected);
    renderLegend();
    applyTime();
    graph.relayout();
    return true;
  }

  // 초안의 근거를 누르면 패널은 그대로 두고 그래프에서 그 노드를 보여 준다(접혀 있으면 펼친다)
  function showInGraph(gid) {
    const g = view.canonical(gid);
    reveal(g);
    graph.highlight(g);
    const node = graph.cy.getElementById(g);
    if (!node.empty()) graph.cy.animate({ center: { eles: node } }, { duration: 200 });
  }

  function renderPanel() {
    const panel = $('detail');
    if (settingsOpen) {
      panel.replaceChildren(settingsPanel({
        current: settings.provider,
        persisted: !!storage,
        onChange: (name) => {
          settings.provider = name;
          provider = createProvider(name, { pregen: PREGEN });
          saveSettings(storage, settings);
          renderSettingsButton();
        },
        onClose: () => { settingsOpen = false; renderPanel(); },
      }));
      return;
    }
    if (merging) {
      const plan = app.mergePlan();
      if (plan) {
        panel.replaceChildren(mergePanel({
          view, plan, links: app.doc.identity_links || [], provider, readOnly: app.readOnly,
          onDecide: (item, status) => {
            const r = app.decideIdentity({ a: item.a, b: item.b, kind: item.kind, status, reason: item.reason, score: item.score });
            if (!r.ok) return window.alert(messageFor(r.error));
            refresh();
          },
          onApplyAuto: () => {
            const r = app.applyAutoLinks();
            if (!r.ok) return window.alert(messageFor(r.error));
            refresh();
          },
          onFocus: showInGraph,
          onClose: () => { merging = false; renderPanel(); graph.highlight(selected); },
        }));
        return;
      }
      merging = false;
    }
    if (insight) {
      panel.replaceChildren(insightPanel({ view, provider, work: insight.work, kind: insight.kind, asOf: asOf(), today: todayLocal(), onTime: setViewDate, onKind: (k) => { insight.kind = k; }, onWork: (w) => { insight.work = w; }, onFocus: showInGraph, onClose: () => { insight = null; renderPanel(); graph.highlight(selected); } }));
      return;
    }
    if (drafting) {
      panel.replaceChildren(draftPanel({ view, provider, target: drafting.target, asOf: todayLocal(), viewDate, onFocus: showInGraph, onClose: () => { drafting = null; renderPanel(); graph.highlight(selected); } }));
      return;
    }
    if (!selected) {
      renderUniverseSummary(panel, describeUniverse(view), display.nodes.length);
      const rootGid = toGid(currentId(), app.doc.universe.root_node_id);
      panel.append(...[el('div', { class: 'row' },
        el('button', { type: 'button', class: 'primary', 'data-testid': 'btn-draft-universe', onclick: () => openDraft(rootGid) }, '인수인계 초안 만들기'),
        el('button', { type: 'button', 'data-testid': 'btn-insight-universe', onclick: () => openInsight('', 'repeat') }, '인사이트 보기')),
        mergeButton(),
        el('p', { class: 'muted small', 'data-testid': 'insight-hint' }, '인사이트(반복 비효율 탭부터 열림): 유사 경험자 · 반복 비효율 · 밀집·공백(일이 몰린 사람, 담당자 없는 업무) · 흐름 변화')].filter(Boolean)); // append(null)은 "null" 글자를 넣으므로 거른다
      return;
    }
    if (editing && isOwn(selected) && localNode(selected)) {
      panel.replaceChildren(el('h2', {}, localNode(selected).label), editorFor(selected));
      return;
    }
    const notes = [loadNote(selected), workNote(selected), repeatNote(selected)].filter(Boolean);
    const tools = toolbar(selected);
    return renderNodeDetail(panel, describeNode(view, selected, { asOf: asOf(), past: !!viewDate }), {
      onFocus: focus,
      extra: layerControls(selected),
      toolbar: notes.length || tools ? el('div', {}, ...notes, tools) : null,
      linkTools,
    });
  }

  function select(gid) {
    if (gid !== selected) editing = null;
    settingsOpen = false;
    merging = false;
    drafting = null;
    insight = null;
    selected = gid;
    graph.highlight(gid);
    renderPanel();
  }

  // 상세 패널의 연결된 노드를 눌렀을 때: 그래프에서도 그 노드로 이동한다(접혀 있으면 펼친다)
  function focus(gid) {
    reveal(gid);
    select(view.canonical(gid));
    const node = graph.cy.getElementById(view.canonical(gid));
    if (!node.empty()) graph.cy.animate({ center: { eles: node } }, { duration: 200 });
  }

  // ── 시간 슬라이더(02-design 탐색 화면, R-14) ──
  // 고른 달의 마지막 날(이번 달이면 오늘)을 기준일로, 그때 유효하지 않은 담당·소속 연결과
  // 기간 밖의 노드, 그때 맡은 일이 없는 사람을 흐리게 한다. 상세·인사이트·초안도 같은 기준일을 쓴다.
  function timeOffIds() {
    if (!viewDate) return [];
    const D = viewDate;
    const off = [];
    const shown = new Set(display.nodes.map((n) => n.gid));
    for (const e of display.edges) {
      // 여러 연결을 하나로 모은 것(count > 1)은 기간이 하나가 아니라 흐리지 않는다
      if (e.synthetic || e.count > 1 || !['performs', 'belongs_to'].includes(e.core_type)) continue;
      if (periodStatus(e.period, D) !== 'current') off.push(e.gid);
    }
    for (const n of display.nodes) {
      if (n.period && periodStatus(n.period, D) !== 'current') { off.push(n.gid); continue; }
      if (n.core_type !== 'person') continue;
      const mine = view.edges.filter((e) => !e.hidden && e.core_type === 'performs' && e.source === n.gid);
      if (mine.length && !mine.some((e) => periodStatus(e.period, D) === 'current')) off.push(n.gid);
    }
    return off.filter((id) => shown.has(id) || display.edges.some((e) => e.gid === id));
  }

  function applyTime() {
    renderTimebar();
    graph.setTimeOff(timeOffIds());
  }

  function setViewDate(date) {
    const today = todayLocal();
    viewDate = date && date < today ? date : null;
    applyTime();
    // 초안(오늘 기준)과 편집 양식은 기준일과 무관하니 입력을 지우지 않도록 다시 그리지 않는다(검토3 UI-3)
    if (drafting || editing || settingsOpen || merging) return;
    renderPanel();
  }

  // 막대 요소는 한 번만 만들고 값만 바꾼다. 다시 만들면 끌던 슬라이더가 DOM에서 빠져 끌기·화살표 키가 끊긴다(검토3 UI-1)
  let tb = null;
  let tbMonths = [];
  function renderTimebar() {
    const bar = $('timebar');
    const today = todayLocal();
    tbMonths = timeMonths(view, today);
    if (!tb) {
      const range = el('input', { type: 'range', min: '0', step: '1', 'data-testid': 'time-range', 'aria-label': '기준 달' });
      range.addEventListener('input', () => {
        const i = Number(range.value);
        setViewDate(i === tbMonths.length - 1 ? null : monthAsOf(tbMonths[i], todayLocal()));
      });
      tb = {
        range,
        first: el('span', { class: 'muted small' }),
        last: el('span', { class: 'muted small' }),
        when: el('span', { class: 'when', 'data-testid': 'time-when' }),
        today: el('button', { type: 'button', class: 'small-btn', 'data-testid': 'time-today', onclick: () => setViewDate(null) }, '오늘로'),
        note: el('span', { class: 'small' }, '흐린 연결·사람·조직은 이 날짜에 유효하지 않음. 상세·인사이트도 이 날짜 기준(초안은 오늘 기준)'),
      };
      bar.replaceChildren(el('span', {}, '시간 보기'), tb.first, tb.range, tb.last, tb.when, tb.today, tb.note);
    }
    const current = viewDate ? tbMonths.indexOf(viewDate.slice(0, 7)) : tbMonths.length - 1;
    tb.range.max = String(tbMonths.length - 1);
    const want = String(current < 0 ? tbMonths.length - 1 : current);
    if (tb.range.value !== want) tb.range.value = want;
    tb.first.textContent = tbMonths[0];
    tb.last.textContent = tbMonths[tbMonths.length - 1];
    tb.when.textContent = viewDate ? `${viewDate} 기준` : `오늘(${today})`;
    tb.today.hidden = !viewDate;
    tb.note.hidden = !viewDate;
    bar.classList.toggle('past', !!viewDate);
    graph.cy.resize(); // 막대 높이가 바뀌면 그래프 영역도 바뀐다
  }

  function refresh() {
    view = app.view;
    display = projectView(view, { expanded });
    // 시간 막대를 먼저 그려 그래프 영역 높이가 정해진 뒤 배치·맞춤을 한다(아래쪽 노드가 잘리지 않게)
    renderTimebar();
    graph.render(display, selected);
    renderLegend();
    graph.setTimeOff(timeOffIds());
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
  // 생성 방식 버튼: 지금 방식을 이름에 보인다(R-15 "생성 방식 표시")
  function renderSettingsButton() {
    $('settings-open').textContent = `생성 방식: ${providerLabel().replace(/\s*\(.*\)$/, '')}`;
  }
  renderSettingsButton();
  $('settings-open').addEventListener('click', () => {
    settingsOpen = true;
    merging = false;
    insight = null;
    drafting = null;
    editing = null;
    renderPanel();
  });

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

  wireCreateDialog(app, $);

  // 노드 추가(R-02 ①): 저장하면 바로 그래프에 나타나고 선택된다
  function renderAddForm(doneText) {
    const slot = $('add-slot');
    if (app.readOnly) {
      slot.replaceChildren(el('p', { class: 'muted small' }, '읽기 전용이라 추가할 수 없습니다.'));
      // 문서만 읽기 전용(버전 불일치)이면 초기화로 복구할 수 있게 둔다. 저장소 자체를 못 쓸 때만 막는다
      $('reset').disabled = !app.canReset;
      return;
    }
    slot.replaceChildren(
      ...(doneText ? [el('p', { class: 'ok-text', 'data-testid': 'add-done' }, doneText)] : []),
      nodeForm({
        mode: 'add',
        subtypes: app.doc.universe.subtypes || [],
        onAddSubtype: (t, nm) => app.addSubtype(t, nm),
        onFocusLocal: (id) => focus(toGid(currentId(), id)),
        onSubmit: (values) => {
          const { attach_root: attachRoot, ...input } = values;
          const r = app.addNode(input);
          if (!r.ok) return r;
          // 꼭지에 바로 연결(포함). 꼭지 → 꼭지 외 모든 노드는 항상 허용되는 조합이다
          if (attachRoot) app.addEdge({ source: app.doc.universe.root_node_id, target: r.node.id, core_type: 'contains' });
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
    const r = app.resetAll();
    if (r && !r.ok) return window.alert(messageFor(r.error));
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
