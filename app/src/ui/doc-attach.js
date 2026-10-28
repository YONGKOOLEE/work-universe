// 문서로 더하기(CR-23): 지금 연 업무 지도의 업무 하나에 문서(회의록·매뉴얼·메모)를 붙여 넣으면
// 문서 항목 1개 + 할 일 표의 업무(담당 역할 포함) + 미결·유의 절의 메모를 찾아 미리 보여 주고, 체크한 것만 app.applyBatch 한 번으로 더한다(전부 아니면 전무, 되감기 한 점).
// 읽는 방식 두 가지: 규칙(키 없이, rules/doc-attach.js)과 Claude(키가 있을 때).
//   Claude(convertAi, 현재): 문서 읽기(llm/connector.convertDocumentAsync) 결과를 규칙 결과 대신 보인다(rules/doc-attach.js keptToAttachPlan). 「규칙으로 읽은 결과 보기」로 되돌릴 수 있다.
//   Claude(readAi, 이전 방식·convertAi가 없을 때만): 규칙 결과에 글로 추가의 Claude 읽기가 더 찾은 항목을 보탠다(llm/ai-doc-attach.js).
import { el } from './dom.js';
import { messageFor } from './messages.js';
import { MEMO_CATEGORIES, NODE_TYPES, EDGE_TYPES } from '../model/schema.js';
import { defaultSelection, docCandidates, resolveSelection } from '../rules/text-extract.js';
import { DOC_ATTACH_AI_LINK, attachNotice, buildAttachOps, defaultDocSelection, dedupeAiProposal, keptToAttachPlan, readDocumentRule, resolveDocSelection } from '../rules/doc-attach.js';
import { AI_REVIEW } from '../llm/connector.js';
import { busyText, reviewBox, reviewSummary } from './ai-read.js';

/** 화면 문구(한 곳). 용어: 「항목」「지도」 */
export const DOC_ATTACH = Object.freeze({
  title: '문서로 더하기',
  intro: '지금 연 지도의 업무 하나에 회의록·매뉴얼·메모 같은 문서를 붙여 지도를 키웁니다. 문서는 산출물 1개로 더하고, 「과제 담당 기한」 표의 할 일은 그 업무 아래 업무로, 담당은 역할로, 「미결」「유의」 절의 문장은 그 업무의 메모로 읽습니다. 원문에 있는 것만 읽고 확신이 없는 줄은 만들지 않습니다.',
  step1: '① 어느 업무에 붙일까요?',
  step2: '② 문서를 넣으세요',
  inputLabel: '문서 글',
  placeholder: '문서의 글을 붙여 넣으세요(PDF·한글·워드는 글을 복사해서). 첫 줄은 문서 제목, 「1. 개요」 같은 줄은 절 제목으로 읽습니다.',
  file: '파일 열기(.md, .txt)',
  fileBad: 'PDF·한글·워드 파일은 글을 복사해 붙여 넣어 주세요',
  fileBig: (mb) => `파일이 너무 큽니다(${mb}MB). 읽지 않았습니다`,
  fileFail: '파일을 읽지 못했습니다.',
  read: '읽어 보기',
  ai: 'Claude로 읽기',
  noKey: '「설정」에서 키를 넣으면 Claude가 읽습니다',
  aiBusy: 'Claude가 읽는 중… (덩어리마다 최대 60초)',
  methodClaude: (model) => `Claude가 문서 전체를 읽은 결과입니다(규칙 결과 대신${model ? `·${model}` : ''}). 원문 구절이 확인된 것만 보입니다. 문서 항목·날짜는 규칙으로 읽었습니다.`,
  showRule: '규칙으로 읽은 결과 보기',
  showClaude: 'Claude가 읽은 결과 다시 보기',
  claudeSummary: (d, t, m, k) => `문서 ${d}개 · 할 일 업무 ${t}개 · 메모 ${m}건 · Claude 항목 ${k}개`,
  noTaskClaude: 'Claude가 읽은 할 일 업무가 없습니다.',
  noMemoClaude: 'Claude가 읽은 메모가 없습니다.',
  claudeEmpty: 'Claude가 문서에서 더 읽은 항목이 없었습니다.',
  heldEdgesTitle: (n) => `더하지 않은 연결 ${n}개`,
  heldEdgesNote: '할 일 업무나 담당과 이어지는 연결입니다. 지도에 아직 없는 업무를 가리켜 이번에는 더하지 않았습니다 — 업무를 더한 뒤 「수정」에서 이으세요.',
  aiClaudeTitle: 'Claude가 읽은 그 밖의 항목·연결',
  aiClaudeNote: '문서에 나온 산출물·주제·사람과 그 연결입니다. 이름이 맞는 것만 체크하세요(처음에는 체크되어 있지 않습니다).',
  holdTask: (why) => `처음엔 체크 안 함 · ${why}`,
  aiFail: (reason) => `Claude 읽기 실패: ${reason} — 규칙으로 읽은 결과를 보여 줍니다`,
  methodRule: '규칙으로 읽었습니다. 원문에 있는 것만 읽고, 확신이 없는 줄은 만들지 않았습니다.',
  methodAi: (model, chunks) => `규칙으로 읽은 결과에 Claude가 더 찾은 것을 보탰습니다${model ? `(${model}` : ''}${model && chunks > 1 ? `, ${chunks}덩어리` : ''}${model ? ')' : ''}. Claude가 읽은 것은 글에 있는 구절로 확인된 것만 보입니다.`,
  step3: '③ 미리 보기 — 넣을 것을 체크하세요',
  summary: (d, t, m, u) => `문서 ${d}개 · 할 일 업무 ${t}개 · 메모 ${m}건 · 읽지 못한 줄 ${u}개`,
  docTitle: '문서(산출물)',
  taskTitle: (n) => `할 일 업무 ${n}개`,
  memoTitle: (n) => `메모 ${n}건`,
  unreadTitle: (n) => `읽지 못한 줄 ${n}개`,
  unreadNote: '모양이 확실하지 않아 지어내지 않고 건너뛴 줄입니다.',
  skippedSections: (titles) => `만들지 않은 절: ${titles.join(' · ')}`,
  noTable: '「과제 담당 기한」 머리줄이 있는 표를 찾지 못해 할 일 업무는 만들지 않았습니다.',
  tableUnread: '할 일 표의 머리줄은 찾았지만 행을 하나도 읽지 못했습니다 — 아래 「읽지 못한 줄」을 확인하세요(줄 끝이 날짜이고 담당이 팀·역할 이름이어야 읽습니다).',
  unreadMore: (n) => `외 ${n}줄`,
  noKeyReason: '키가 없습니다 — 「설정」에서 키를 넣으세요',
  badText: '글자가 깨졌습니다 — 파일을 UTF-8로 저장하거나 글을 복사해 붙여 넣어 주세요',
  uncertain: '확인 필요 — 과제 이름이 길어 문장일 수 있어 처음에는 체크하지 않았습니다',
  ownerAmbiguous: '(같은 이름 사람이 둘 이상 — 잇지 않음)',
  noMemo: '「미결」「유의」「추적」 같은 제목의 절이 없어 메모는 만들지 않았습니다.',
  aiTitle: 'Claude가 더 찾은 항목·연결',
  aiNote: '규칙이 읽지 못한 문장에서 Claude가 따온 것입니다. 이름이 맞는 것만 체크하세요(처음에는 체크되어 있지 않습니다).',
  newItem: '새로 만듦',
  mapItem: '지도에 있는 항목에 잇기',
  exists: '이미 있음',
  past: '기한 지남',
  pastTip: '기한이 문서 날짜나 오늘보다 지나 처음에는 체크하지 않았습니다',
  blocked: (why) => `넣을 수 없음 · ${why}`,
  roleNew: '(새 역할)',
  roleMap: '(지도에 있음)',
  checkAll: '모두 체크',
  uncheckAll: '모두 해제',
  stale: '대상이나 글이 바뀌었습니다 — 다시 읽어 주세요',
  save: '지도에 더하기',
  saveQ: '체크한 것을 지도에 더할까요?',
  close: '닫기',
  empty: '문서 글을 붙여 넣으세요.',
  tooLong: (max) => `글이 너무 깁니다(${max.toLocaleString()}자 이하)`,
  noTarget: '대상 업무를 고르세요. 이 지도에 업무가 없으면 먼저 업무를 하나 만드세요.',
  nothing: '더할 것이 없습니다. 항목을 체크하세요.',
  noWorks: '이 지도에는 업무가 없습니다 — 「사람·업무·문서 추가」에서 업무를 먼저 만드세요.',
});

const MEMO_LABEL = { issue: MEMO_CATEGORIES.issue, caution: MEMO_CATEGORIES.caution };
const FILE_BAD = /\.(pdf|hwp|hwpx|docx?|pptx?|xlsx?)$/i;
const FILE_MAX_BYTES = 2 * 1024 * 1024;
const UNREAD_SHOW = 50; // 화면에 보이는 읽지 못한 줄 수(넘으면 「외 n줄」)
const BAD_CHARS_MIN = 2; // 파일 글에 깨진 글자(U+FFFD)가 이만큼 이상이면 글 칸에 넣지 않는다

/** 대상으로 고를 수 있는 업무(이 지도의 보이는 업무) */
export const worksOf = (doc) => (doc.nodes || []).filter((n) => n.core_type === 'work' && !n.hidden && !n.deleted).map((n) => ({ id: n.id, label: n.label }));

function errorText(error, kind, relation) {
  if (error && error.too_many && error.links) return `명령 ${error.links}개까지 한 번에 더할 수 있습니다. 항목을 줄이세요.`;
  if (error && error.too_many) return `한 번에 ${error.too_many}행까지 더할 수 있습니다. 항목을 줄이세요.`;
  return messageFor(error, { kind, relation });
}

/**
 * @param {{dialog:HTMLDialogElement, app:object, getView:()=>object, aiReady:()=>boolean, readAi:(text:string)=>(Promise<object|null>|null),
 *   today:()=>string, example?:{title:string, targetLabel:string, text:(today:string)=>string}, onSaved:(result:object, ctx:{targetId:string, notice:string})=>void}} o
 *   readAi: Claude로 읽기(llm/ai-doc-attach.js readDocumentAi를 감싼 것). null을 돌려주면 키가 없는 것
 * @returns {(targetId?:string)=>void} 대화상자를 여는 함수(대상 업무 id를 주면 미리 골라진다)
 */
export function docAttachDialog(o) {
  const st = { open: false, aiNotes: [], targetId: '', plan: null, sel: null, ai: null, method: '', model: '', chunks: 0, fallback: '', busy: false, run: 0, kc: null, rulePlan: null, view: '', stage: 'read', review: AI_REVIEW.on, reviewInfo: null, message: '', details: [], done: '', readText: '', readTarget: '', stale: false };
  let input;
  let select;
  let fileName;
  let fileInput;
  let readBtn;
  let aiBtn;
  let busyLine;
  let reviewEl;
  let previewBox;
  let countLine;
  let messageLine;
  let staleLine;
  let saveBtn;
  let doneLine;

  const text = () => (input ? input.value : '');
  const updateStale = () => { st.stale = !!st.plan && (text() !== st.readText || st.targetId !== st.readTarget); };

  // ── 읽기 ─────────────────────────────────────────────────────────────────
  function setPlan(plan, method, ai = null, model = '', chunks = 0, snap = null, notes = []) {
    st.plan = plan;
    st.aiNotes = [...new Set(notes)];
    st.sel = defaultDocSelection(plan);
    st.ai = ai ? { proposal: ai, sel: defaultSelection(ai, 'none') } : null;
    st.method = method;
    st.model = model;
    st.chunks = chunks;
    // 읽기를 시작할 때의 글·대상으로 기록한다: Claude가 읽는 동안 바뀌었으면 응답이 와도 저장이 잠긴다(RV-B-2)
    st.readText = snap ? snap.text : text();
    st.readTarget = snap ? snap.target : st.targetId;
    st.message = '';
    st.details = [];
    st.done = '';
    st.reviewInfo = null;
    updateStale();
  }

  function ruleRead() {
    const r = readDocumentRule(text(), { doc: o.app.doc, targetId: st.targetId, today: o.today() });
    if (!r.ok) {
      st.plan = null;
      st.message = r.reason === 'empty' ? DOC_ATTACH.empty : r.reason === 'too_long' ? DOC_ATTACH.tooLong(r.max) : DOC_ATTACH.noTarget;
      return null;
    }
    return r.plan;
  }

  function readRule() {
    st.run += 1; // 기다리던 Claude 응답은 버린다
    st.busy = false;
    st.fallback = '';
    st.kc = null;
    st.rulePlan = null;
    st.view = '';
    const plan = ruleRead();
    if (plan) setPlan(plan, 'rule');
    render();
  }

  /** 지도의 보이는 항목(유형·이름): Claude에게 「이미 있는 이름」으로 알려 같은 것을 새로 만들지 않게 한다(상한은 보내는 쪽 AI_CONVERT_MAX_EXISTING) */
  const existingItems = () => (o.app.doc.nodes || []).filter((n) => n.core_type !== 'root' && !n.hidden && !n.deleted).map((n) => ({ type: n.core_type, label: n.label }));

  // 읽은 결과 보기: Claude 결과(st.kc)와 규칙 결과(st.rulePlan)를 오간다(체크는 새로 시작). 글·대상이 바뀐 뒤에도 읽을 때의 것으로 두어 저장이 잠기게 한다
  function showClaude() {
    const c = st.kc;
    if (!c) return;
    setPlan(c.plan, 'claude_doc', c.proposal, c.model, 0, { text: st.readText, target: st.readTarget }, []);
    st.reviewInfo = c.review;
    st.view = 'claude';
    st.fallback = c.proposal || c.plan.tasks.length || c.plan.memos.length ? '' : DOC_ATTACH.claudeEmpty;
    render();
  }

  function showRule() {
    if (!st.rulePlan) return;
    setPlan(st.rulePlan, 'rule', null, '', 0, { text: st.readText, target: st.readTarget });
    st.view = 'rule';
    st.fallback = '';
    render();
  }

  // Claude로 읽기(문서 읽기): 문서 전체를 한 번에 보내고(검토가 켜져 있으면 두 번째 호출로 빠진 것을 더함) 그 결과를 규칙 결과 대신 보인다. 실패하면 규칙 결과
  async function readClaude() {
    if (st.busy || !o.aiReady()) return;
    const plan = ruleRead();
    if (!plan) return render();
    const snap = { text: text(), target: st.targetId };
    const run = (st.run += 1);
    const review = st.review;
    st.busy = true;
    st.stage = 'read';
    st.message = '';
    st.fallback = '';
    render();
    let r;
    let threw = false;
    try {
      r = await o.convertAi(snap.text, {
        context: { target: plan.targetLabel, existing: existingItems() },
        review,
        onStage: (stage) => { if (run === st.run && st.open) { st.stage = stage; busyLine.textContent = busyText(stage, review); } },
      });
    } catch {
      r = null;
      threw = true;
    }
    if (run !== st.run || !st.open) return; // 그 사이 다시 읽었거나 창을 닫았다: 응답을 버린다
    st.busy = false;
    if (r && r.ok && r.kept) {
      const c = keptToAttachPlan(r.kept, plan, o.app.doc, { review: r.review });
      st.kc = { ...c, model: r.model };
      st.rulePlan = plan;
      st.readText = snap.text;
      st.readTarget = snap.target;
      showClaude();
      return;
    }
    st.kc = null;
    st.rulePlan = null;
    st.view = '';
    setPlan(plan, 'rule', null, '', 0, snap);
    st.fallback = DOC_ATTACH.aiFail(r && r.fallback ? r.fallback.reason : threw ? '알 수 없는 오류' : r === null || r === undefined ? DOC_ATTACH.noKeyReason : '알 수 없는 오류');
    render();
  }

  async function readAi() {
    if (st.busy || !o.aiReady()) return;
    const plan = ruleRead();
    if (!plan) return render();
    const snap = { text: text(), target: st.targetId };
    const run = (st.run += 1);
    st.busy = true;
    st.message = '';
    st.fallback = '';
    render();
    let r;
    let threw = false;
    try {
      r = await o.readAi(snap.text);
    } catch {
      r = null;
      threw = true;
    }
    if (run !== st.run || !st.open) return; // 그 사이 다시 읽었거나 창을 닫았다: 응답을 버린다
    st.busy = false;
    if (r && r.ok) {
      const deduped = dedupeAiProposal(r.proposal, plan);
      setPlan(plan, 'claude_api', deduped.nodes.length || deduped.edges.length ? deduped : null, r.model, r.chunks, snap, r.proposal.notes || []);
      if (!st.ai) st.fallback = 'Claude가 규칙 결과 밖에서 더 찾은 항목이 없었습니다.';
    } else {
      setPlan(plan, 'rule', null, '', 0, snap);
      // 키가 없어 null이 온 것(threw 아님)과 호출이 실패한 것을 구분한다(RV-B-13)
      st.fallback = DOC_ATTACH.aiFail(r && r.fallback ? r.fallback.reason : threw ? '알 수 없는 오류' : r === null || r === undefined ? DOC_ATTACH.noKeyReason : '알 수 없는 오류');
    }
    render();
  }

  // ── 파일 ─────────────────────────────────────────────────────────────────
  async function onFile(e) {
    const f = e.target.files && e.target.files[0];
    if (!f || st.busy) return;
    if (FILE_BAD.test(f.name)) {
      st.message = DOC_ATTACH.fileBad;
      e.target.value = '';
      fileName.textContent = '';
      return render();
    }
    if (f.size > FILE_MAX_BYTES) {
      st.message = DOC_ATTACH.fileBig(Math.round(f.size / 1048576));
      e.target.value = '';
      return render();
    }
    try {
      const body = await f.text();
      if ((body.match(/\uFFFD/g) || []).length >= BAD_CHARS_MIN) {
        st.message = DOC_ATTACH.badText; // UTF-8이 아닌 파일(옛 한글 인코딩 등) — 깨진 글을 지도에 넣지 않는다
        e.target.value = '';
        fileName.textContent = '';
        return render();
      }
      input.value = body;
      fileName.textContent = `고른 파일: ${f.name}`;
      st.message = '';
    } catch {
      st.message = DOC_ATTACH.fileFail;
    }
    onInput();
    return render();
  }

  // ── 저장 ─────────────────────────────────────────────────────────────────
  const sel = () => resolveDocSelection(st.plan, st.sel);
  const aiResolved = () => (st.ai ? resolveSelection(st.ai.proposal, st.ai.sel, docCandidates(o.app.doc), o.app.doc.edges || []) : null);
  const opsNow = () => buildAttachOps(st.plan, sel(), st.ai ? { proposal: st.ai.proposal, selection: st.ai.sel } : null, o.app.doc, { targetId: st.plan.targetId });

  function save() {
    if (!st.plan || o.app.readOnly) return;
    updateStale();
    if (st.stale) return render();
    st.message = '';
    st.details = [];
    const { ops } = opsNow();
    if (!ops.some((x) => x.op !== 'addSubtype')) {
      st.message = DOC_ATTACH.nothing;
      return render();
    }
    const r = o.app.applyBatch(ops, { source: 'system' }); // 사람이 직접 쓴 기록이 아니라 문서에서 읽어 온 것(문서 가져오기와 같은 출처)
    if (!r.ok) {
      if (r.errors && r.errors.length) {
        for (const e of r.errors) {
          const op = ops.find((x) => x.row === e.row);
          const what = op && op.input ? (op.input.label || op.input.note || op.key || '') : '';
          const kind = op && op.op === 'addNode' ? 'node' : op && op.op === 'addMemo' ? 'event' : 'edge';
          st.details.push(`${String(what).slice(0, 40)}: ${errorText(e.error, kind, op && op.input && op.input.core_type)}`);
        }
        st.message = `${r.errors.length}곳에 문제가 있어 아무것도 더하지 않았습니다.`;
      } else st.message = errorText(r.error, 'node');
      return render();
    }
    const memoEvents = r.memos || [];
    const notice = attachNotice(r.created, memoEvents.length, { issues: memoEvents.filter((e) => e.payload && e.payload.category === 'issue').length, assigns: (r.assignments || []).length });
    st.done = notice;
    const targetId = st.plan.targetId;
    st.plan = null;
    st.ai = null;
    st.kc = null;
    st.rulePlan = null;
    st.stale = false;
    st.method = '';
    st.fallback = '';
    st.message = '';
    r.summary = notice;
    render();
    o.onSaved(r, { targetId, notice });
    // 끝나면 창을 닫아 대상 업무 카드와 알림이 보이게 한다(알림 문구는 화면 위쪽 알림 줄에 남는다)
    st.open = false;
    st.run += 1;
    if (typeof o.dialog.close === 'function' && o.dialog.open !== false) o.dialog.close();
  }

  // ── 그리기 ───────────────────────────────────────────────────────────────
  const taskStatus = (t) => {
    if (t.blocked) return { state: 'blocked', text: DOC_ATTACH.blocked(t.blocked) };
    const parts = [];
    if (t.match) parts.push(t.exists ? `${DOC_ATTACH.exists} — 지도의 「${t.match.label}」이 이 업무 아래에 이어져 있음` : `${DOC_ATTACH.mapItem}(「${t.match.label}」)`);
    else parts.push(DOC_ATTACH.newItem);
    if (t.past) parts.push(DOC_ATTACH.past);
    if (t.uncertain) parts.push(DOC_ATTACH.uncertain);
    if (t.hold) parts.push(DOC_ATTACH.holdTask(t.hold));
    return { state: t.past ? 'past' : t.uncertain ? 'uncertain' : t.hold ? 'hold' : t.exists ? 'exists' : t.match ? 'match' : 'new', text: parts.join(' · ') };
  };

  function check(id, label, checked, onchange, disabled = false) {
    return el('input', { type: 'checkbox', 'data-testid': id, checked, disabled, 'aria-label': label, onchange: (e) => onchange(e.target.checked) });
  }

  function renderPlan(parts) {
    const p = st.plan;
    const r = sel();
    const mark = (cb) => (v) => { cb(v); render(); };
    // 문서
    parts.push(el('h3', {}, DOC_ATTACH.docTitle));
    const docState = p.doc.match ? (p.doc.exists ? `${DOC_ATTACH.exists} — 「${p.doc.match.label}」이 이 업무에 이어져 있음` : `${DOC_ATTACH.mapItem}(「${p.doc.match.label}」)`) : DOC_ATTACH.newItem;
    parts.push(el('div', { class: 'batch-wrap' }, el('table', { class: 'dg-table batch-grid', 'data-testid': 'doc-attach-doc' },
      el('thead', {}, el('tr', {}, el('th', {}, '넣기'), el('th', {}, '이름'), el('th', {}, '상태'), el('th', {}, '설명(원문에서 가져옴)'))),
      el('tbody', {}, el('tr', {},
        el('td', {}, check('doc-attach-doc-check', '문서 항목 넣기', r.doc, mark((v) => { st.sel.doc = v; }))),
        el('td', { 'data-testid': 'doc-attach-doc-label' }, p.doc.label),
        el('td', { class: 'small', 'data-testid': 'doc-attach-doc-status' }, docState),
        el('td', { class: 'small muted', 'data-testid': 'doc-attach-doc-desc' }, (p.doc.description || '(설명 없음)').split('\n').join(' ｜ '))))))); // 줄바꿈은 구분 막대로 한 줄에
    parts.push(el('p', { class: 'muted small' }, `「${p.targetLabel}」 → 「${p.doc.label}」는 「참조」로 잇습니다.`));
    // 할 일
    parts.push(el('h3', {}, DOC_ATTACH.taskTitle(p.tasks.length)));
    if (p.tasks.length) {
      parts.push(el('div', { class: 'batch-wrap' }, el('table', { class: 'dg-table batch-grid', 'data-testid': 'doc-attach-tasks' },
        el('thead', {}, el('tr', {}, el('th', {}, '넣기'), el('th', {}, '할 일(업무 이름)'), el('th', {}, '담당(역할)'), el('th', {}, '마감'), el('th', {}, '상태'), el('th', {}, '원문 줄'))),
        el('tbody', {}, ...p.tasks.map((t, i) => {
          const s = taskStatus(t);
          return el('tr', { 'data-testid': `doc-attach-task-${i}`, 'data-state': s.state },
            el('td', {}, check(`doc-attach-task-check-${i}`, `${i + 1}번 할 일 넣기`, r.tasks[t.key], mark((v) => { st.sel.tasks[t.key] = v; }), !!t.blocked)),
            el('td', { 'data-testid': `doc-attach-task-label-${i}` }, t.label),
            el('td', { class: 'small', 'data-testid': `doc-attach-task-owners-${i}` }, t.owners.length ? t.owners.map((x) => `${x.label}${x.ambiguous ? DOC_ATTACH.ownerAmbiguous : x.match ? DOC_ATTACH.roleMap : DOC_ATTACH.roleNew}`).join(', ') : '—'),
            el('td', { class: 'small nw', 'data-testid': `doc-attach-task-due-${i}` }, t.due ? t.due.text : '—'),
            el('td', { class: 'small', 'data-testid': `doc-attach-task-status-${i}`, title: t.past ? DOC_ATTACH.pastTip : '' }, s.text),
            el('td', { class: 'small muted' }, `「${t.quote}」`));
        })))));
    } else if (p.source === 'claude') parts.push(el('p', { class: 'muted small', 'data-testid': 'doc-attach-no-table' }, DOC_ATTACH.noTaskClaude));
    else if (p.sections.tables.length) parts.push(el('p', { class: 'notice', 'data-testid': 'doc-attach-table-unread' }, DOC_ATTACH.tableUnread));
    else parts.push(el('p', { class: 'muted small', 'data-testid': 'doc-attach-no-table' }, DOC_ATTACH.noTable));
    // 메모
    parts.push(el('h3', {}, DOC_ATTACH.memoTitle(p.memos.length)));
    if (p.memos.length) {
      parts.push(el('div', { class: 'batch-wrap' }, el('table', { class: 'dg-table batch-grid', 'data-testid': 'doc-attach-memos' },
        el('thead', {}, el('tr', {}, el('th', {}, '넣기'), el('th', {}, '분류'), el('th', {}, '날짜'), el('th', {}, '메모 글'), el('th', {}, '상태'))),
        el('tbody', {}, ...p.memos.map((m, i) => el('tr', { 'data-testid': `doc-attach-memo-${i}`, 'data-category': m.category },
          el('td', {}, check(`doc-attach-memo-check-${i}`, `${i + 1}번 메모 넣기`, r.memos[m.key], mark((v) => { st.sel.memos[m.key] = v; }))),
          el('td', { class: 'small nw', 'data-testid': `doc-attach-memo-cat-${i}` }, MEMO_LABEL[m.category] || m.category),
          el('td', { class: 'small nw' }, m.date),
          el('td', { class: 'small', 'data-testid': `doc-attach-memo-text-${i}` }, m.text),
          el('td', { class: 'small nw' }, m.exists ? `${DOC_ATTACH.exists} — 같은 메모가 이 업무에 있음` : `새 메모${m.forLabel ? ` · 대상: 「${m.forLabel}」` : ''}`)))))));
      parts.push(el('p', { class: 'muted small' }, '메모는 「이슈」(미결 절)와 「주의사항」(유의·추적 절)만 씁니다. 「해결됨」「진행 중」은 쓰지 않습니다.'));
    } else parts.push(el('p', { class: 'muted small', 'data-testid': 'doc-attach-no-memo' }, p.source === 'claude' ? DOC_ATTACH.noMemoClaude : DOC_ATTACH.noMemo));
    // 더하지 않은 연결(Claude 읽기: 업무·담당과 이어지는 그 밖의 연결)
    if (p.heldEdges && p.heldEdges.length) {
      parts.push(el('div', { 'data-testid': 'doc-attach-held-edges' },
        el('h3', {}, DOC_ATTACH.heldEdgesTitle(p.heldEdges.length)),
        el('p', { class: 'muted small' }, DOC_ATTACH.heldEdgesNote),
        el('ul', { class: 'small' }, ...p.heldEdges.slice(0, UNREAD_SHOW).map((x, k) => el('li', { 'data-testid': `doc-attach-held-edge-${k}` }, `${x.text}(${EDGE_TYPES[x.relation] || x.relation})`, x.quote ? el('span', { class: 'muted' }, ` — 「${x.quote}」`) : null)))));
    }
    // 읽지 못한 줄·만들지 않은 절
    if (p.unread.length) {
      parts.push(el('div', { 'data-testid': 'doc-attach-unread' },
        el('h3', {}, DOC_ATTACH.unreadTitle(p.unread.length)),
        el('p', { class: 'muted small' }, DOC_ATTACH.unreadNote),
        el('ul', { class: 'small' }, ...p.unread.slice(0, UNREAD_SHOW).map((u, k) => el('li', { 'data-testid': `doc-attach-unread-${k}` }, `「${u.text}」`, el('span', { class: 'muted' }, ` — ${u.why}`)))),
        p.unread.length > UNREAD_SHOW ? el('p', { class: 'muted small', 'data-testid': 'doc-attach-unread-more' }, DOC_ATTACH.unreadMore(p.unread.length - UNREAD_SHOW)) : null));
    }
    if (p.sections.skipped.length) parts.push(el('p', { class: 'muted small', 'data-testid': 'doc-attach-skipped' }, DOC_ATTACH.skippedSections(p.sections.skipped)));
    for (const n of p.notes) parts.push(el('p', { class: 'notice', 'data-testid': 'doc-attach-note' }, n));
  }

  function renderAi(parts) {
    const ai = st.ai;
    const r = aiResolved();
    const p = ai.proposal;
    const mark = (cb) => (v) => { cb(v); render(); };
    const claudeDoc = st.method === 'claude_doc';
    parts.push(el('h3', {}, claudeDoc ? DOC_ATTACH.aiClaudeTitle : DOC_ATTACH.aiTitle));
    parts.push(el('p', { class: 'muted small' }, claudeDoc ? DOC_ATTACH.aiClaudeNote : DOC_ATTACH.aiNote));
    // 새 주제·사람·조직·산출물은 문서 항목에 잇는다(문서 항목이 없고 만들지도 않으면 대상 업무에)
    const docLinked = sel().doc || !!st.plan.doc.match;
    const linkNote = (type) => {
      const rel = (type === 'topic' ? DOC_ATTACH_AI_LINK.topic : DOC_ATTACH_AI_LINK.other) === 'relates_to' ? '관련으로' : '참조로';
      const label = st.plan.doc.label;
      return `${docLinked ? `문서 「${label.length > 20 ? `${label.slice(0, 19)}…` : label}」` : '대상 업무'}에 ${rel} 잇습니다`;
    };
    const nodeSel = (key) => (ai.sel.nodes[key] = ai.sel.nodes[key] || {});
    const edgeSel = (key) => (ai.sel.edges[key] = ai.sel.edges[key] || {});
    if (p.nodes.length) {
      parts.push(el('div', { class: 'batch-wrap' }, el('table', { class: 'dg-table batch-grid', 'data-testid': 'doc-attach-ai-nodes' },
        el('thead', {}, el('tr', {}, el('th', {}, '넣기'), el('th', {}, '유형'), el('th', {}, '이름'), el('th', {}, '상태'), el('th', {}, '원문 구절'))),
        el('tbody', {}, ...p.nodes.map((n, i) => {
          const f = r.nodes[n.key];
          return el('tr', { 'data-testid': `doc-attach-ai-node-${i}` },
            el('td', {}, f.fixed ? el('span', { class: 'muted' }, '—') : check(`doc-attach-ai-node-check-${i}`, `${i + 1}번 Claude 항목 넣기`, f.include, mark((v) => { nodeSel(n.key).include = v; if (!v) for (const e of p.edges) if (e.from === n.key || e.to === n.key) edgeSel(e.key).include = false; }))),
            el('td', { class: 'small' }, NODE_TYPES[f.type] || f.type),
            el('td', {}, f.label),
            el('td', { class: 'small' }, f.fixed ? DOC_ATTACH.mapItem : n.hold ? (f.include ? `확인 필요 · ${n.hold}${f.type === 'work' ? '' : ` · ${linkNote(f.type)}`}` : `처음엔 체크 안 함 · ${n.hold}`) : f.type === 'work' ? `${DOC_ATTACH.newItem} · 대상 업무 아래에 잇습니다` : f.include ? `${DOC_ATTACH.newItem} · ${linkNote(f.type)}` : DOC_ATTACH.newItem),
            el('td', { class: 'small muted' }, `「${n.quote}」`));
        })))));
    }
    if (p.edges.length) {
      parts.push(el('div', { class: 'batch-wrap' }, el('table', { class: 'dg-table batch-grid', 'data-testid': 'doc-attach-ai-edges' },
        el('thead', {}, el('tr', {}, el('th', {}, '넣기'), el('th', {}, '앞 항목'), el('th', {}, '관계'), el('th', {}, '뒤 항목'), el('th', {}, '상태'), el('th', {}, '원문 구절'))),
        el('tbody', {}, ...p.edges.map((e, j) => {
          const f = r.edges[e.key];
          const a = r.nodes[f.source];
          const b = r.nodes[f.target];
          const locked = f.reason === 'pair' || f.reason === 'same' || f.exists;
          const status = f.exists ? '이미 있음' : f.reason === 'pair' ? '유형에 맞지 않는 관계' : f.reason === 'same' ? '두 끝이 같음' : f.reason === 'end_missing' ? '끝 항목을 체크하면 넣을 수 있음' : typeof e.hold === 'string' ? `처음엔 체크 안 함 · ${e.hold}` : '새 연결';
          return el('tr', { 'data-testid': `doc-attach-ai-edge-${j}` },
            el('td', {}, check(`doc-attach-ai-edge-check-${j}`, `${j + 1}번 Claude 연결 넣기`, f.include, mark((v) => { edgeSel(e.key).include = v; if (v) for (const x of [a, b]) if (!x.include && !x.problem && !x.ambiguous) nodeSel(x.key).include = true; }), locked)),
            el('td', { class: 'small' }, a.label),
            el('td', { class: 'small' }, EDGE_TYPES[f.type] || f.type),
            el('td', { class: 'small' }, b.label),
            el('td', { class: 'small' }, status),
            el('td', { class: 'small muted' }, `「${e.quote}」`));
        })))));
    }
  }

  function renderPreview() {
    const parts = [];
    if (st.plan && !st.busy) {
      const p = st.plan;
      parts.push(el('h3', { 'data-testid': 'doc-attach-step3' }, DOC_ATTACH.step3));
      const claudeDoc = st.method === 'claude_doc';
      parts.push(el('p', { class: 'small', 'data-testid': 'doc-attach-summary' }, claudeDoc ? DOC_ATTACH.claudeSummary(1, p.tasks.length, p.memos.length, st.ai ? st.ai.proposal.nodes.length : 0) : DOC_ATTACH.summary(1, p.tasks.length, p.memos.length, p.unread.length)));
      parts.push(el('p', { class: 'muted small', 'data-testid': 'doc-attach-method' }, claudeDoc ? DOC_ATTACH.methodClaude(st.model) : st.method === 'claude_api' ? DOC_ATTACH.methodAi(st.model, st.chunks) : DOC_ATTACH.methodRule,
        // 되돌리기: Claude 결과 ↔ 규칙 결과(체크는 새로 시작)
        claudeDoc && st.rulePlan ? el('button', { type: 'button', class: 'link', 'data-testid': 'doc-attach-show-rule', onclick: showRule }, ` ${DOC_ATTACH.showRule}`) : null,
        !claudeDoc && st.kc ? el('button', { type: 'button', class: 'link', 'data-testid': 'doc-attach-show-claude', onclick: showClaude }, ` ${DOC_ATTACH.showClaude}`) : null));
      if (claudeDoc) { const rv = reviewSummary(st.reviewInfo, 'doc-attach-review', { open: true }); if (rv) parts.push(rv); }
      if (st.fallback) parts.push(el('p', { class: 'notice', role: 'status', 'data-testid': 'doc-attach-fallback' }, st.fallback));
      st.aiNotes.forEach((n, i) => parts.push(el('p', { class: 'notice', 'data-testid': `doc-attach-ai-note-${i}` }, n))); // Claude 덩어리 안내(상한·일부 실패)와 확인 안내
      parts.push(el('div', { class: 'row' },
        el('button', { type: 'button', 'data-testid': 'doc-attach-check-all', onclick: () => setAll(true) }, DOC_ATTACH.checkAll),
        el('button', { type: 'button', 'data-testid': 'doc-attach-uncheck-all', onclick: () => setAll(false) }, DOC_ATTACH.uncheckAll)));
      renderPlan(parts);
      if (st.ai) renderAi(parts);
    }
    previewBox.replaceChildren(...parts);
  }

  function setAll(on) {
    if (!st.plan || st.busy) return;
    st.sel = { doc: on ? !st.plan.doc.exists : false, tasks: {}, memos: {} };
    for (const t of st.plan.tasks) st.sel.tasks[t.key] = on && !t.blocked && !t.exists;
    for (const m of st.plan.memos) st.sel.memos[m.key] = on && !m.exists;
    render();
  }

  function render() {
    updateStale();
    const busy = st.busy;
    if (readBtn) readBtn.disabled = busy;
    if (aiBtn) aiBtn.disabled = busy;
    if (select) select.disabled = busy; // 읽는 동안 대상·글·파일은 바꾸지 못한다(RV-B-2)
    if (input) input.disabled = busy;
    if (fileInput) fileInput.disabled = busy;
    if (reviewEl) reviewEl.box.disabled = busy;
    busyLine.textContent = busy ? (o.convertAi ? busyText(st.stage, st.review) : DOC_ATTACH.aiBusy) : '';
    renderPreview();
    if (st.plan && !busy) {
      const { counts } = opsNow();
      const extra = counts.aiNodes || counts.aiEdges ? ` · Claude 항목 ${counts.aiNodes}개·연결 ${counts.aiEdges}개${counts.aiLinks ? `·문서에 잇는 연결 ${counts.aiLinks}개` : ''}` : '';
      countLine.textContent = `더할 것: 문서 ${counts.doc}개 · 할 일 업무 ${counts.tasks}개 · 역할 ${counts.roles}개 · 메모 ${counts.memos}건${extra}`;
    } else countLine.textContent = '';
    saveBtn.disabled = !st.plan || busy || o.app.readOnly || st.stale;
    staleLine.textContent = st.plan && !busy && st.stale ? DOC_ATTACH.stale : '';
    staleLine.hidden = !(st.plan && !busy && st.stale);
    messageLine.replaceChildren(st.message, ...st.details.map((d) => el('div', { class: 'small', 'data-testid': 'doc-attach-detail' }, d)));
    doneLine.textContent = st.done;
    doneLine.hidden = !st.done;
  }

  function onInput() {
    st.message = '';
    st.details = [];
    const was = st.stale;
    updateStale();
    if (was !== st.stale) render();
  }

  // 예시 문서 넣기: 글 칸을 예시로 채운다(가져오기 창의 예시 단추처럼 이미 있는 글은 덮어쓴다). 대상이 아직 없으면 「대사 확인」 업무를 고른다
  function fillExample() {
    if (st.busy || !o.example) return;
    input.value = o.example.text(o.today());
    fileName.textContent = '';
    if (!st.targetId) {
      const hit = worksOf(o.app.doc).filter((w) => w.label === o.example.targetLabel);
      if (hit.length === 1) { st.targetId = hit[0].id; select.value = hit[0].id; }
    }
    onInput();
    render();
  }

  function build(works) {
    input = el('textarea', { id: 'doc-attach-input', rows: 8, 'data-testid': 'doc-attach-input', placeholder: DOC_ATTACH.placeholder, oninput: onInput });
    select = el('select', { id: 'doc-attach-target', 'data-testid': 'doc-attach-target', 'aria-label': '붙일 업무', onchange: (e) => { st.targetId = e.target.value; onInput(); } },
      ...(st.targetId ? [] : [el('option', { value: '', selected: true }, '업무를 고르세요')]),
      ...works.map((w) => el('option', { value: w.id, selected: w.id === st.targetId }, w.label)));
    fileName = el('span', { class: 'muted small', 'data-testid': 'doc-attach-file-name' });
    readBtn = el('button', { type: 'button', 'data-testid': 'doc-attach-read', onclick: readRule }, DOC_ATTACH.read);
    aiBtn = o.aiReady() ? el('button', { type: 'button', 'data-testid': 'doc-attach-ai', onclick: o.convertAi ? readClaude : readAi }, DOC_ATTACH.ai) : null;
    reviewEl = aiBtn && o.convertAi ? reviewBox('doc-attach-review-check', st.review, (v) => { st.review = v; }) : null;
    busyLine = el('p', { class: 'muted small', role: 'status', 'aria-live': 'polite', 'data-testid': 'doc-attach-busy' });
    previewBox = el('div', { 'data-testid': 'doc-attach-preview' });
    countLine = el('p', { class: 'small', 'data-testid': 'doc-attach-count' });
    messageLine = el('div', { class: 'error-text', role: 'alert', 'data-testid': 'doc-attach-message' });
    staleLine = el('p', { class: 'notice', role: 'status', 'data-testid': 'doc-attach-stale', hidden: true });
    saveBtn = el('button', { type: 'button', class: 'primary', 'data-testid': 'doc-attach-save', onclick: save }, DOC_ATTACH.save);
    doneLine = el('p', { class: 'ok-text', role: 'status', 'data-testid': 'doc-attach-done', hidden: true });
    o.dialog.replaceChildren(
      el('div', { class: 'import-head' },
        el('h2', { id: 'doc-attach-title' }, DOC_ATTACH.title),
        el('button', { type: 'button', 'data-testid': 'doc-attach-close', onclick: () => { st.open = false; st.run += 1; o.dialog.close(); } }, DOC_ATTACH.close)),
      el('p', { class: 'muted small', 'data-testid': 'doc-attach-intro' }, DOC_ATTACH.intro),
      el('label', { class: 'field' }, el('span', {}, DOC_ATTACH.step1), select),
      el('label', { class: 'field' }, el('span', {}, DOC_ATTACH.step2), input),
      el('div', { class: 'row' },
        el('label', { class: 'file-pick' }, `${DOC_ATTACH.file} `, (fileInput = el('input', { type: 'file', accept: '.md,.txt,.markdown,.pdf,.hwp,.hwpx,.docx,text/plain,text/markdown', 'data-testid': 'doc-attach-file', onchange: onFile }))),
        fileName),
      ...(o.example ? [el('div', { class: 'row' }, el('button', { type: 'button', 'data-testid': 'doc-attach-example', onclick: fillExample }, `예시 문서 넣기: ${o.example.title}`))] : []),
      el('div', { class: 'row' }, readBtn, aiBtn, aiBtn ? null : el('span', { class: 'muted small', 'data-testid': 'doc-attach-ai-note' }, DOC_ATTACH.noKey)),
      ...(reviewEl ? [reviewEl] : []),
      busyLine,
      previewBox,
      countLine,
      messageLine,
      staleLine,
      el('div', { class: 'row decide-row' }, el('span', { class: 'decide-q', 'data-testid': 'doc-attach-save-q' }, DOC_ATTACH.saveQ), saveBtn),
      doneLine);
  }

  return (targetId = '') => {
    if (o.app.readOnly) return;
    const works = worksOf(o.app.doc);
    st.open = true;
    st.run += 1;
    st.plan = null;
    st.ai = null;
    st.kc = null;
    st.rulePlan = null;
    st.view = '';
    st.busy = false;
    st.method = '';
    st.fallback = '';
    st.message = '';
    st.details = [];
    st.done = '';
    st.readText = '';
    st.stale = false;
    st.targetId = works.some((w) => w.id === targetId) ? targetId : (works.length === 1 ? works[0].id : ''); // 기본값: 고른 카드의 업무, 없으면 업무가 하나일 때 그것
    build(works);
    if (!works.length) {
      st.message = DOC_ATTACH.noWorks;
      readBtn.disabled = true;
      if (aiBtn) aiBtn.disabled = true;
    }
    render();
    if (typeof o.dialog.addEventListener === 'function' && !o.dialog.dataset.docAttachWired) {
      o.dialog.dataset.docAttachWired = '1';
      o.dialog.addEventListener('close', () => { st.open = false; st.run += 1; });
    }
    o.dialog.showModal();
    if (typeof input.focus === 'function') input.focus();
  };
}
