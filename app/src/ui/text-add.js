// 글로 추가(CR-19, D-37): 몇 문장짜리 줄글을 붙여 넣으면 항목(사람·업무·산출물·조직·주제)과 연결을 찾아 미리 보여 주고,
// 사용자가 체크·수정한 뒤 「저장」을 누르면 app.applyBatch 한 번으로 넣는다(표로 추가와 같은 전부 아니면 전무, 되감기 한 점).
// 읽는 방식 두 가지: 규칙(키 없이, rules/text-extract.js)과 Claude(키가 있을 때, llm/ai-extract.js — 인용이 글에 있는 행만 남는다).
// 고르기·체크를 바꿀 때마다 rules/text-extract.js의 resolveSelection이 최종 값을 다시 계산한다(저장 명령 proposalToOps와 같은 계산).
import { el } from './dom.js';
import { messageFor } from './messages.js';
import { EDGE_TYPES, NODE_TYPES, allowedRelations } from '../model/schema.js';
import { TEXT_LIMITS, TEXT_NODE_TYPES, TEXT_PATTERN_DOC, defaultSelection, docCandidates, extractFromText, proposalToOps, resolveSelection } from '../rules/text-extract.js';

/** 화면 문구(한 곳). 용어: 「항목」「지도 중심」 */
export const TEXT_ADD = Object.freeze({
  title: '글로 추가',
  intro: '몇 문장짜리 글(회의 메모·인수인계 메모)을 붙여 넣으면 사람·업무·산출물·조직을 찾아 미리 보여 줍니다. 지도에 이미 있는 항목만 처음에 체크되어 있고, 새로 만드는 항목은 이름이 맞는지 보고 직접 체크해야 합니다(「모두 체크」도 있습니다). 고친 뒤 「저장」을 눌러야 들어갑니다.',
  placeholder: '예) 서하늘(V-1003)이 대사 확인을 맡는다. 대사 확인이 끝나면 보고를 한다. 보고에서 월말 정산 보고서를 만든다.',
  inputLabel: '붙여 넣을 글',
  read: '규칙으로 읽기',
  ai: 'Claude로 읽기',
  noKey: '키를 넣으면 Claude가 읽습니다',
  aiBusy: 'Claude가 읽는 중… (최대 60초)', // 글로 추가의 호출 제한 llm/providers.js LLM_EXTRACT_TIMEOUT_MS(60초)와 같은 값
  aiFail: (reason) => `AI 읽기 실패: ${reason} — 규칙으로 읽은 결과를 보여 줍니다`,
  methodRule: '규칙으로 읽었습니다.',
  methodAi: (model) => `Claude가 읽었습니다${model ? `(${model})` : ''}. 글에 있는 구절로 확인된 것만 보입니다.`,
  nodesTitle: (n) => `찾은 항목 ${n}개`,
  edgesTitle: (n) => `찾은 연결 ${n}개`,
  noNodes: '읽을 수 있는 문장이 없었습니다. 아래 「규칙으로 읽는 모양」에 맞게 써 보세요.',
  unreadTitle: (n) => `읽지 못한 문장 ${n}개`,
  unreadNote: '모양에 맞지 않거나 뜻이 애매해(부정·지난 일·예정·날짜·나열 등) 지어내지 않고 건너뛴 문장입니다.',
  checkAll: '모두 체크',
  uncheckAll: '모두 해제',
  newItem: '새로 만듦 — 이름이 맞으면 체크',
  newPerson: '새 사람 — 이름이 맞으면 체크',
  partialTag: ' (일부만 읽음)', // 이름은 읽었지만 모양을 다 읽지 못한 문장
  stale: '글이 바뀌었습니다 — 다시 읽으세요',
  shapesTitle: '규칙으로 읽는 모양',
  attach: ' 새 업무는 지도 중심(가운데 큰 동그라미)에 바로 연결하기',
  save: '저장',
  close: '닫기',
  nothingToSave: '넣을 항목이 없습니다. 항목을 체크하세요.',
  emptyText: '글을 붙여 넣으세요.',
  count: (nNew, nOld, nEdge) => `넣을 항목 ${nNew + nOld}개(새로 만듦 ${nNew}, 있는 항목에 연결 ${nOld})·연결 ${nEdge}개`,
  done: (n, m, skipped) => `항목 ${n}개·연결 ${m}개를 넣었습니다${skipped ? `(이미 있어 건너뛴 연결 ${skipped}개)` : ''}`,
});

const TYPE_LABEL = (t) => NODE_TYPES[t] || t;
const REL_LABEL = (r) => EDGE_TYPES[r] || r;

/** 저장 오류 문구: 표로 추가와 같은 문구 체계 */
function errorText(error, kind, relation) {
  if (error && error.too_many && error.links) return `연결까지 합쳐 한 번에 ${error.links}개 명령까지 저장할 수 있습니다. 글을 나누어 넣으세요.`;
  return messageFor(error, { kind, relation });
}

/**
 * @param {{dialog:HTMLDialogElement, app:object, getView:()=>object, aiReady:()=>boolean, readAi:(text:string)=>(Promise<object|null>|null), onSaved:(result:object)=>void}} o
 *   readAi: Claude로 읽기(connector.extractTextAsync를 감싼 것). null을 돌려주면 키가 없는 것
 * @returns {()=>void} 대화상자를 여는 함수
 */
export function textAddDialog(o) {
  const st = { open: false, proposal: null, sel: defaultSelection({ nodes: [], edges: [] }), method: '', model: '', fallback: '', dropped: 0, busy: false, run: 0, message: '', done: '', errors: new Map(), attach: true, readText: '', stale: false };
  let input;
  let readBtn;
  let aiBtn;
  let busyLine;
  let methodLine;
  let previewBox;
  let countLine;
  let messageLine;
  let staleLine;
  let saveBtn;
  let doneLine;

  const resolved = () => resolveSelection(st.proposal, st.sel, docCandidates(o.app.doc), o.app.doc.edges || []);
  const nodeSel = (key) => (st.sel.nodes[key] = st.sel.nodes[key] || {});
  const edgeSel = (key) => (st.sel.edges[key] = st.sel.edges[key] || {});

  // ── 읽기 ─────────────────────────────────────────────────────────────────
  function setProposal(p, method, model = '', readText = input ? input.value : '') {
    st.proposal = p;
    st.readText = readText; // 이 글을 읽은 결과다. 글 상자가 바뀌면 저장을 막고 다시 읽게 한다(R16-16)
    st.stale = !!input && input.value !== readText;
    st.sel = defaultSelection(p);
    st.method = method;
    st.model = model;
    st.errors = new Map();
    st.message = '';
    st.done = '';
  }

  function readRule() {
    st.run += 1; // 기다리던 Claude 응답은 버린다
    st.busy = false;
    st.fallback = '';
    st.dropped = 0;
    const text = input.value;
    if (!text.trim()) {
      st.proposal = null;
      st.message = TEXT_ADD.emptyText;
      return render();
    }
    setProposal(extractFromText(text, o.getView()), 'rule', '', text);
    render();
  }

  async function readAi() {
    if (st.busy || !o.aiReady()) return;
    const text = input.value;
    if (!text.trim()) {
      st.message = TEXT_ADD.emptyText;
      return render();
    }
    const run = (st.run += 1);
    st.busy = true;
    st.message = '';
    st.fallback = '';
    render();
    let r;
    try {
      r = await o.readAi(text);
    } catch {
      r = null;
    }
    if (run !== st.run || !st.open) return; // 그 사이 다시 읽었거나 창을 닫았다: 응답을 버린다
    st.busy = false;
    if (r && r.ok) {
      setProposal(r.proposal, 'claude_api', r.model, text);
      st.dropped = (r.dropped || []).length;
      st.fallback = '';
    } else {
      // 실패하면 규칙으로 읽은 결과를 대신 보여 준다(R-04 ③)
      const reason = r && r.fallback ? r.fallback.reason : '알 수 없는 오류';
      setProposal(extractFromText(text, o.getView()), 'rule', '', text);
      st.dropped = 0;
      st.fallback = TEXT_ADD.aiFail(reason);
    }
    render();
  }

  // ── 저장 ─────────────────────────────────────────────────────────────────
  function save() {
    if (!st.proposal || o.app.readOnly) return;
    if (st.stale || input.value !== st.readText) {
      st.stale = true;
      return render();
    }
    st.message = '';
    st.errors = new Map();
    const ops = proposalToOps(st.proposal, st.sel, o.app.doc, { attachRoot: st.attach ? 'work' : false });
    if (!ops.length) {
      st.message = TEXT_ADD.nothingToSave;
      return render();
    }
    const r = o.app.applyBatch(ops);
    if (!r.ok) {
      if (r.errors && r.errors.length) {
        for (const e of r.errors) {
          const op = ops.find((x) => x.row === e.row);
          if (!op) continue;
          const isNode = op.op === 'addNode' || (op.op === 'invalid' && st.proposal.nodes.some((n) => n.key === op.key));
          const text = errorText(e.error, isNode ? 'node' : 'edge', isNode ? undefined : op.input && op.input.core_type);
          st.errors.set(op.key, st.errors.has(op.key) ? `${st.errors.get(op.key)} / ${text}` : text);
        }
        st.message = `${r.errors.length}곳에 문제가 있어 아무것도 저장하지 않았습니다. 표시된 행을 고친 뒤 다시 저장하세요.`;
      } else st.message = errorText(r.error, 'node');
      return render();
    }
    const links = (r.edges || []).length + (r.assignments || []).length;
    const skipped = (r.rows || []).filter((x) => x.kind === 'skipped').length;
    st.done = TEXT_ADD.done(r.created.length, links, skipped);
    st.proposal = null;
    st.stale = false;
    st.fallback = '';
    st.method = '';
    st.message = '';
    r.summary = st.done;
    render();
    o.onSaved(r);
  }

  // ── 그리기 ───────────────────────────────────────────────────────────────
  const nodeStatus = (n, f) => {
    if (f.problem) return { state: 'problem', text: f.problem === 'empty' ? '이름을 넣으세요' : '이름이 너무 깁니다(최대 100자)' };
    if (!f.include) {
      if (f.ambiguous) return { state: 'off', text: '같은 이름이 둘 이상 있습니다 — 체크하면 새 항목으로 만듭니다' };
      if (n.hold && !f.match) return { state: 'hold', text: `넣지 않음 · ${n.hold} — 확인한 뒤 체크하세요` };
      if (f.match) return { state: 'off', text: '넣지 않음' };
      // R17: 새로 만드는 항목은 처음에 체크하지 않는다 — 이름이 맞는지 사람이 보고 체크
      return { state: 'new-off', text: f.type === 'person' ? TEXT_ADD.newPerson : TEXT_ADD.newItem };
    }
    if (f.match) return { state: 'match', text: `있는 항목 「${f.match.label}」에 연결` };
    if (f.ambiguous) return { state: 'new', text: '새로 만듦 · 같은 이름이 지도에 둘 이상 있습니다' };
    return { state: 'new', text: `새로 만듦${n.unsure && f.type === 'person' ? ' · 확인 필요(사람인지 확실하지 않음)' : ''}${n.hold ? ` · ${n.hold}` : ''}` };
  };

  const edgeStatus = (f) => {
    if (f.reason === 'pair') return { state: 'pair', text: '이 두 항목의 유형에는 이 관계를 쓸 수 없습니다 — 관계를 다시 고르세요' };
    if (f.reason === 'end_missing') return { state: 'end', text: '끝 항목을 넣지 않아 넣을 수 없습니다' };
    if (f.reason === 'same') return { state: 'same', text: '두 끝이 같은 항목이라 넣을 수 없습니다' };
    if (f.exists) return { state: 'exists', text: '이미 있음' };
    if (!f.wanted) return { state: 'off', text: '넣지 않음' };
    return { state: 'new', text: '새 연결' };
  };

  function onTypeChange(nodeKey, type) {
    nodeSel(nodeKey).type = type;
    // 이 항목에 걸린 연결의 관계가 새 유형에 안 맞으면 그 연결 체크를 푼다(이유는 상태 칸에 보인다)
    const r = resolved();
    for (const e of st.proposal.edges) {
      if ((e.from === nodeKey || e.to === nodeKey) && r.edges[e.key].reason === 'pair') edgeSel(e.key).include = false;
    }
    render();
  }

  function nodeRow(n, i, r) {
    const f = r.nodes[n.key];
    const status = nodeStatus(n, f);
    const err = st.errors.get(n.key);
    const syncLabel = (e) => { nodeSel(n.key).label = e.target.value; };
    const syncEmp = (e) => { nodeSel(n.key).emp_no = e.target.value; };
    const main = el('tr', { class: err || f.problem ? 'row-error' : '', 'data-testid': `text-add-node-${i}` },
      el('td', {}, el('input', { type: 'checkbox', 'data-testid': `text-add-node-check-${i}`, checked: f.include, 'aria-label': `${i + 1}번 항목 넣기`, onchange: (e) => { nodeSel(n.key).include = e.target.checked; render(); } })),
      el('td', {}, el('select', { 'data-col': 'type', 'data-testid': `text-add-node-type-${i}`, 'aria-label': `${i + 1}번 항목 유형`, onchange: (e) => onTypeChange(n.key, e.target.value) },
        ...TEXT_NODE_TYPES.map((t) => el('option', { value: t, selected: t === f.type }, TYPE_LABEL(t))))),
      el('td', {}, el('input', { type: 'text', 'data-col': 'label', 'data-testid': `text-add-node-label-${i}`, value: f.label, maxlength: 100, autocomplete: 'off', 'aria-label': `${i + 1}번 항목 이름`, oninput: syncLabel, onchange: (e) => { syncLabel(e); render(); } })),
      el('td', {}, f.type === 'person'
        ? el('input', { type: 'text', 'data-col': 'emp_no', 'data-testid': `text-add-node-empno-${i}`, value: f.emp_no, placeholder: 'V-0000', maxlength: 100, autocomplete: 'off', 'aria-label': `${i + 1}번 항목 사번`, oninput: syncEmp, onchange: (e) => { syncEmp(e); render(); } })
        : '—'),
      el('td', { class: 'small', 'data-testid': `text-add-node-status-${i}`, 'data-state': status.state }, status.text),
      el('td', { class: 'small muted', 'data-testid': `text-add-node-quote-${i}` }, `「${n.quote}」`));
    const msg = el('tr', { class: 'row-error row-msg-line', hidden: !err }, el('td', { colspan: 6, 'data-testid': `text-add-node-msg-${i}` }, err ? `${i + 1}번 항목: ${err}` : ''));
    return [main, msg];
  }

  function edgeRow(e, j, r) {
    const f = r.edges[e.key];
    const status = edgeStatus(f);
    const err = st.errors.get(e.key);
    const a = r.nodes[f.source];
    const b = r.nodes[f.target];
    const rels = allowedRelations(a.type, b.type);
    const known = rels.some((x) => x.relation === f.type);
    const locked = !!f.reason;
    const main = el('tr', { class: err ? 'row-error' : '', 'data-testid': `text-add-edge-${j}` },
      el('td', {}, el('input', { type: 'checkbox', 'data-testid': `text-add-edge-check-${j}`, checked: f.include, disabled: locked, 'aria-label': `${j + 1}번 연결 넣기`, onchange: (ev) => { edgeSel(e.key).include = ev.target.checked; render(); } })),
      el('td', { 'data-testid': `text-add-edge-from-${j}` }, `${a.label || '(이름 없음)'} (${TYPE_LABEL(a.type)})`),
      el('td', {}, el('select', { 'data-col': 'relation', 'data-testid': `text-add-edge-type-${j}`, 'aria-label': `${j + 1}번 연결 관계`, onchange: (ev) => { if (ev.target.value) { edgeSel(e.key).type = ev.target.value; render(); } } },
        ...(known ? [] : [el('option', { value: '', selected: true }, '관계를 고르세요')]),
        ...rels.map((x) => el('option', { value: x.relation, selected: known && x.relation === f.type }, REL_LABEL(x.relation))))),
      el('td', { 'data-testid': `text-add-edge-to-${j}` }, `${b.label || '(이름 없음)'} (${TYPE_LABEL(b.type)})`),
      el('td', { class: 'small', 'data-testid': `text-add-edge-status-${j}`, 'data-state': status.state }, status.text),
      el('td', { class: 'small muted', 'data-testid': `text-add-edge-quote-${j}` }, `「${e.quote}」`));
    const msg = el('tr', { class: 'row-error row-msg-line', hidden: !err }, el('td', { colspan: 6, 'data-testid': `text-add-edge-msg-${j}` }, err ? `${j + 1}번 연결: ${err}` : ''));
    return [main, msg];
  }

  const head = (cols) => el('thead', {}, el('tr', {}, ...cols.map((c) => el('th', {}, c))));

  function renderPreview() {
    const p = st.busy ? null : st.proposal;
    const parts = [];
    if (p) {
      const r = resolved();
      parts.push(el('p', { class: 'muted small', 'data-testid': 'text-add-method' }, st.method === 'claude_api' ? TEXT_ADD.methodAi(st.model) : TEXT_ADD.methodRule));
      if (st.fallback) parts.push(el('p', { class: 'notice', role: 'status', 'data-testid': 'text-add-fallback' }, st.fallback));
      for (const n of p.notes || []) parts.push(el('p', { class: 'notice', 'data-testid': 'text-add-note' }, n));
      if (p.nodes.length) {
        parts.push(el('div', { class: 'row' },
          el('button', { type: 'button', 'data-testid': 'text-add-check-all', onclick: () => setAll(true) }, TEXT_ADD.checkAll),
          el('button', { type: 'button', 'data-testid': 'text-add-uncheck-all', onclick: () => setAll(false) }, TEXT_ADD.uncheckAll)));
        parts.push(el('h3', {}, TEXT_ADD.nodesTitle(p.nodes.length)));
        parts.push(el('div', { class: 'batch-wrap' }, el('table', { class: 'dg-table batch-grid', 'data-testid': 'text-add-nodes' },
          head(['넣기', '유형', '이름', '사번', '상태', '원문 구절']), el('tbody', {}, ...p.nodes.flatMap((n, i) => nodeRow(n, i, r))))));
      } else parts.push(el('p', { class: 'muted', 'data-testid': 'text-add-empty' }, TEXT_ADD.noNodes));
      if (p.edges.length) {
        parts.push(el('h3', {}, TEXT_ADD.edgesTitle(p.edges.length)));
        parts.push(el('div', { class: 'batch-wrap' }, el('table', { class: 'dg-table batch-grid', 'data-testid': 'text-add-edges' },
          head(['넣기', '앞 항목', '관계', '뒤 항목', '상태', '원문 구절']), el('tbody', {}, ...p.edges.flatMap((e, j) => edgeRow(e, j, r))))));
      }
      if (p.unread && p.unread.length) {
        parts.push(el('div', { 'data-testid': 'text-add-unread' },
          el('h3', {}, TEXT_ADD.unreadTitle(p.unread.length)),
          el('p', { class: 'muted small' }, TEXT_ADD.unreadNote),
          el('ul', { class: 'small' }, ...p.unread.map((s, k) => el('li', { 'data-testid': `text-add-unread-${k}` }, `${s}${(p.partial || []).includes(s) ? TEXT_ADD.partialTag : ''}`)))));
      }
    }
    parts.push(el('details', { class: 'small', 'data-testid': 'text-add-shapes' },
      el('summary', {}, TEXT_ADD.shapesTitle),
      el('ul', {}, ...TEXT_PATTERN_DOC.map((x) => el('li', {}, `${x.shape} — 예: ${x.example}`))),
      el('p', { class: 'muted' }, `글은 ${TEXT_LIMITS.maxChars.toLocaleString()}자까지, 항목은 ${TEXT_LIMITS.maxNodes}개까지 한 번에 넣을 수 있습니다.`)));
    previewBox.replaceChildren(...parts);
  }

  function render() {
    const p = st.proposal;
    const busy = st.busy;
    if (readBtn) readBtn.disabled = busy;
    if (aiBtn) aiBtn.disabled = busy;
    busyLine.textContent = busy ? TEXT_ADD.aiBusy : '';
    renderPreview();
    if (p && !busy) {
      const r = resolved();
      const inc = p.nodes.filter((n) => r.nodes[n.key].include && !r.nodes[n.key].problem);
      const nOld = inc.filter((n) => r.nodes[n.key].match).length;
      const nEdge = p.edges.filter((e) => r.edges[e.key].include).length;
      countLine.textContent = TEXT_ADD.count(inc.length - nOld, nOld, nEdge);
    } else countLine.textContent = '';
    saveBtn.disabled = !p || busy || o.app.readOnly || st.stale;
    staleLine.textContent = p && !busy && st.stale ? TEXT_ADD.stale : '';
    staleLine.hidden = !(p && !busy && st.stale);
    messageLine.textContent = st.message;
    doneLine.textContent = st.done;
    doneLine.hidden = !st.done;
  }

  // 모두 체크 / 모두 해제(R17): 모두 체크해도 확인할 것(hold)·같은 이름이 둘 이상인 항목·이미 있는 연결은 체크하지 않는다
  function setAll(on) {
    if (!st.proposal || st.busy) return;
    const d = defaultSelection(st.proposal, 'all');
    for (const n of st.proposal.nodes) nodeSel(n.key).include = on ? d.nodes[n.key].include : false;
    for (const e of st.proposal.edges) edgeSel(e.key).include = on ? d.edges[e.key].include : false;
    render();
  }

  // 읽은 뒤 글 상자가 바뀌면(R16-16) 저장을 막고 「다시 읽으세요」. 원래 글로 되돌리면 풀린다
  function onInput() {
    st.message = '';
    const stale = !!st.proposal && input.value !== st.readText;
    if (stale !== st.stale) {
      st.stale = stale;
      render();
    }
  }

  function build() {
    input = el('textarea', { id: 'text-add-input', rows: 5, 'data-testid': 'text-add-input', placeholder: TEXT_ADD.placeholder, oninput: onInput });
    readBtn = el('button', { type: 'button', 'data-testid': 'text-add-read', onclick: readRule }, TEXT_ADD.read);
    const ai = o.aiReady();
    aiBtn = ai ? el('button', { type: 'button', 'data-testid': 'text-add-ai', onclick: readAi }, TEXT_ADD.ai) : null;
    busyLine = el('p', { class: 'muted small', role: 'status', 'aria-live': 'polite', 'data-testid': 'text-add-busy' });
    previewBox = el('div', { 'data-testid': 'text-add-preview' });
    countLine = el('p', { class: 'small', 'data-testid': 'text-add-count' });
    messageLine = el('p', { class: 'error-text', role: 'alert', 'data-testid': 'text-add-message' });
    staleLine = el('p', { class: 'notice', role: 'status', 'data-testid': 'text-add-stale', hidden: true });
    saveBtn = el('button', { type: 'button', class: 'primary', 'data-testid': 'text-add-save', onclick: save }, TEXT_ADD.save);
    doneLine = el('p', { class: 'ok-text', role: 'status', 'data-testid': 'text-add-done', hidden: true });
    o.dialog.replaceChildren(
      el('div', { class: 'import-head' },
        el('h2', { id: 'text-add-title' }, TEXT_ADD.title),
        el('button', { type: 'button', 'data-testid': 'text-add-close', onclick: () => { st.open = false; st.run += 1; o.dialog.close(); } }, TEXT_ADD.close)),
      el('p', { class: 'muted small' }, TEXT_ADD.intro),
      el('label', { class: 'field' }, el('span', {}, TEXT_ADD.inputLabel), input),
      el('div', { class: 'row' }, readBtn, aiBtn, ai ? null : el('span', { class: 'muted small', 'data-testid': 'text-add-ai-note' }, TEXT_ADD.noKey)),
      busyLine,
      previewBox,
      countLine,
      el('label', { class: 'check' },
        el('input', { type: 'checkbox', 'data-testid': 'text-add-attach', checked: st.attach, onchange: (e) => { st.attach = e.target.checked; } }),
        TEXT_ADD.attach),
      messageLine,
      staleLine,
      el('div', { class: 'row' }, saveBtn),
      doneLine);
  }

  return () => {
    if (o.app.readOnly) return;
    st.open = true;
    st.run += 1;
    st.proposal = null;
    st.busy = false;
    st.method = '';
    st.fallback = '';
    st.message = '';
    st.done = '';
    st.readText = '';
    st.stale = false;
    st.errors = new Map();
    build();
    render();
    if (typeof o.dialog.addEventListener === 'function' && !o.dialog.dataset.textAddWired) {
      o.dialog.dataset.textAddWired = '1';
      o.dialog.addEventListener('close', () => { st.open = false; st.run += 1; });
    }
    o.dialog.showModal();
    if (typeof input.focus === 'function') input.focus();
  };
}
