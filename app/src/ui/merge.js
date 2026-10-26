// 통합 확인 목록(R-11 ②③④, T-10). 사람이 "같음/다름"을 정해야 동일성 연결이 생긴다. 확인하지 않은 항목이 있어도
// 통합 유니버스는 그대로 탐색할 수 있다(R-11 ④). 원래 유니버스는 바뀌지 않는다(R-11 ⑤).
// AI 연관 찾기(CR-15 C, T-38): 키가 있을 때만 「AI로 연관 찾기」가 보이고, 찾은 쌍은 「AI 후보」 표시로 업무 후보에 끼워 넣는다. 확정은 여전히 사람.
import { METHOD_LABELS, explainInsight, findCandidatesAsync, isLive, syncProvider } from '../llm/connector.js';
import { AI_CANDIDATE_LABEL, collectWorks, decidedSets, withAiCandidates } from '../llm/ai-candidates.js';
import { pairKey } from '../model/schema.js';
import { josa } from '../model/josa.js';
import { cardData, personData } from '../view/card.js';
import { isTopicOnlyCandidate } from '../merge/merge.js';
import { el } from './dom.js';
import { evidenceChips as chips } from './evidence.js';

// 접힌 「주제만 겹친 후보」 묶음의 펼침 상태(R12 FU7-5): 판정하면 패널을 다시 그리므로 지도(묶음)마다 여기에 둔다. 닫으면 지운다
const topicOnlyOpen = new Set();
export const TOPIC_ONLY_CHIP = '주제 하나만 겹침';
export const SAMPLE_ANSWER_CHIP = '샘플에 미리 넣은 답'; // FU9-19: 이 브라우저에서 사람이 고른 것이 아니라 샘플 데이터에 처음부터 들어 있던 답

export const AI_CANDIDATES_WAIT = 'AI가 업무를 비교하는 중… (최대 60초)';

/**
 * 업무 후보 이유(역할 c): 사전 생성이 있으면 그 문장, 없으면 규칙 기반 문장.
 * 이 화면은 후보 이유를 실시간으로 다듬지 않는다(AI는 「AI로 연관 찾기」 쌍만) — 키가 있어도 동기 공급자(사전 생성)로 같은 문장을 그린다(B1)
 */
export function candidateReason(view, item, provider) {
  const exists = view.exists;
  return explainInsight({ task: 'work_candidate_reason', target: `work_candidate|${[item.a, item.b].sort().join('|')}`, evidence_ids: item.evidence_ids, rule: [{ text: item.reason, evidence_ids: item.evidence_ids }] }, { provider: syncProvider(provider), exists });
}

// ── AI 연관 찾기 상태 ──
// 상태는 공급자(=키·모델) 하나, 묶음 유니버스 하나마다 둔다. 판정을 누르면 패널이 다시 그려지지만 결과는 남는다.
// 응답이 올 때 그 패널이 화면에서 사라졌거나(다른 화면으로 감) 요청 번호가 바뀌었으면(닫기 단추) 응답을 버린다.
const aiStates = new WeakMap();
function aiStateOf(provider, universeId) {
  let st = aiStates.get(provider);
  if (!st || st.universe !== universeId) {
    st = { universe: universeId, busy: false, run: 0, result: null, error: '', root: null, paint: null };
    aiStates.set(provider, st);
  }
  return st;
}

/** 「AI로 연관 찾기」를 쓸 수 있는가: 키가 있어 실시간 공급자가 만들어졌고 판정을 할 수 있는 화면일 때만 */
const aiAvailable = (o) => !o.readOnly && isLive(o.provider) && typeof o.provider.candidates === 'function';

/**
 * 판정할 때 넘기는 후보: AI 후보는 확정 기록(identity_links.reason)에 「AI 후보」가 남게 이유 앞에 표시를 붙인다.
 * 점수가 없는 AI 후보(source 'ai')는 score를 넘기지 않는다
 */
export function decisionItem(item) {
  if (!item.ai) return item;
  if (item.source === 'ai') {
    const { score, ...rest } = item;
    return rest; // reason은 이미 「AI 후보: …」
  }
  return { ...item, reason: `${AI_CANDIDATE_LABEL}와 겹침 · ${item.reason}` };
}

/** 결과 요약: 「AI 후보 n개(확인되지 않아 뺀 쌍 m개)」와 뺀 쌍 목록 */
function aiSummary(result, plan) {
  if (!result) return [];
  const n = plan.works.filter((w) => w.ai).length;
  const invalid = result.dropped.filter((d) => d.kind === 'invalid');
  return [
    el('p', { class: 'small', 'data-testid': 'ai-candidates-summary' },
      `AI 후보 ${n}개(확인되지 않아 뺀 쌍 ${result.counts.dropped}개)`,
      result.counts.decided ? ` · 사람이 이미 답을 고른 쌍 ${result.counts.decided}개는 넣지 않았습니다` : ''),
    invalid.length
      ? el('details', { class: 'ai-dropped', 'data-testid': 'ai-candidates-dropped' },
        el('summary', {}, `원문 인용·업무가 확인되지 않아 뺀 쌍 ${invalid.length}개`),
        el('ul', {}, ...invalid.slice(0, 30).map((d) => el('li', { class: 'small' }, `${d.title ? `${d.title} — ` : ''}${d.reason}`)), invalid.length > 30 ? el('li', { class: 'small' }, `외 ${invalid.length - 30}개`) : null))
      : null,
  ].filter(Boolean);
}

/** AI 후보 표시(이유·두 업무의 인용). 기존 후보와 겹친 쌍은 기존 내용 아래에 덧붙는다 */
function aiBlock(view, w) {
  const label = (gid) => { const n = view.getNode(gid); return n ? `${n.label}(${n.universe_name})` : gid; };
  return el('div', { class: 'small', 'data-testid': 'candidate-ai' },
    el('div', {}, w.source === 'ai' ? '' : 'AI도 같은 쌍으로 봄: ', w.ai.reason, ' ',
      el('span', { class: 'method-chip llm', title: METHOD_LABELS.llm }, 'Claude API'),
      el('span', { class: 'muted' }, w.ai.confidence === 'high' ? ' · 확신 높음' : ' · 확신 보통')),
    ...w.ai.quotes.map((x) => el('div', { class: 'muted', 'data-testid': 'candidate-ai-quote' }, `「${x.quote}」 — ${label(x.gid)}`)));
}

/**
 * @param {{view:object, plan:object, links:object[], provider:object|null, readOnly:boolean, onDecide:(item, status)=>void, onApplyAuto:()=>void, onFocus:(gid)=>void, onClose:()=>void}} o
 */
export function mergePanel(o) {
  if (!aiAvailable(o)) return renderMerge(o, o.plan, []); // 키가 없으면 지금과 같은 화면
  const st = aiStateOf(o.provider, o.view.universe_id);
  // 이전 패널이 이미 화면에서 빠져 있으면 목록을 벗어났다가 다시 연 것이다 → 보관 결과·진행 중 요청을 버린다(B3).
  // 판정 등으로 다시 그릴 때는 caller가 새 패널을 만든 뒤에 옛 패널을 바꾸므로, 이 시점에 옛 패널이 아직 화면에 있다
  if (st.root && !st.root.isConnected) { st.run += 1; st.busy = false; st.result = null; st.error = ''; }
  const root = el('div', { class: 'insight', 'data-testid': 'merge-panel' });
  st.root = root;
  const q = (id) => root.querySelector(`[data-testid=${id}]`);
  // 닫으면 요청 번호를 올리고 결과를 지운다(늦게 온 응답 버림, 다음에 열면 처음 상태)
  const opts = { ...o, onClose: () => { st.run += 1; st.busy = false; st.result = null; st.error = ''; o.onClose(); } };

  const press = async () => {
    if (st.busy) return;
    const works = collectWorks(o.view);
    const decided = decidedSets(o.view, o.links);
    const run = (st.run += 1);
    st.busy = true;
    st.error = '';
    const btn = q('btn-ai-candidates');
    const live = q('ai-candidates-live');
    if (btn) btn.disabled = true;
    if (live) live.textContent = AI_CANDIDATES_WAIT;
    let r;
    try {
      r = await findCandidatesAsync(works, { provider: o.provider, ...decided });
    } catch {
      r = null;
    }
    if (aiStates.get(o.provider) !== st || run !== st.run) return; // 닫기 단추로 닫았거나 다른 요청이 시작됐다: 응답을 버린다
    st.busy = false;
    if (!st.root || !st.root.isConnected) { st.result = null; return; } // 그 사이 화면에서 사라졌다: 응답을 버린다
    if (r && r.ok) {
      st.result = r;
      st.error = '';
    } else {
      st.result = null;
      st.error = r && r.fallback ? r.fallback.reason : '알 수 없는 오류';
    }
    st.paint(true);
  };

  const paint = (refocus = false) => {
    // 지금 문서 기준으로 다시 거른다: 그 사이 사람이 판정한 쌍은 넣지 않는다
    const now = decidedSets(o.view, o.links);
    const skip = (a, b) => a === b || now.rejected.has(pairKey(a, b)) || now.confirmed.has(pairKey(a, b));
    const plan = st.result ? withAiCandidates(o.plan, st.result.pairs, { canon: now.canon, skip }) : o.plan;
    const head = [
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'small-btn', 'data-testid': 'btn-ai-candidates', disabled: st.busy, title: 'Claude API로 묶인 업무 지도들의 업무 글을 비교해 뜻이 같은 업무 쌍을 찾습니다. 키가 있을 때만 보입니다. 확정은 사람이 합니다', onclick: press }, 'AI로 연관 찾기')),
      el('p', { class: 'muted small', 'data-testid': 'ai-candidates-live', 'aria-live': 'polite' }, st.busy ? AI_CANDIDATES_WAIT : ''),
      st.error ? el('p', { class: 'notice', 'data-testid': 'ai-candidates-fallback' }, `AI 연관 찾기 실패: ${st.error} — 기존 후보만 보여 줍니다`) : null,
      ...aiSummary(st.result, plan),
    ].filter(Boolean);
    root.replaceChildren(...renderMerge(opts, plan, head).childNodes);
    if (refocus) {
      const b = q('btn-ai-candidates');
      if (b && typeof b.focus === 'function') b.focus();
    }
  };
  st.paint = paint;
  paint();
  return root;
}

/** 패널 본문. aiHead: 「업무 후보」 제목 바로 아래에 둘 AI 요소(없으면 빈 배열 — 지금과 같은 화면) */
function renderMerge(o, plan, aiHead) {
  const { view } = o;
  // 판정은 묻는 말 + 답 단추 둘(사용자 2026-10-26 저녁 "판정 단추가 무엇인지 못 찾겠음" — 단추만 있으면 무엇을 고르는지 안 보임)
  // 「같은 …」은 그래프에서 한 항목으로 합쳐지므로 누르면 그 자리에서 한 번 더 묻는다(R13 FU8-25). 「다른 …」은 바로 정한다 — 둘 다 아래 「지금까지 고른 답」의 「다시 묻기」로 되돌릴 수 있다
  const decideButtons = (item, sameLabel, diffLabel) => {
    if (o.readOnly || !item.b) return null;
    const row = el('div', { class: 'row decide-row' });
    const draw = () => row.replaceChildren(
      el('span', { class: 'decide-q', 'data-testid': 'merge-decide-q' }, `이 둘이 ${sameLabel}인가요?`),
      el('button', { type: 'button', class: 'small-btn', 'data-testid': 'merge-same', onclick: ask }, sameLabel),
      el('button', { type: 'button', class: 'small-btn', 'data-testid': 'merge-diff', onclick: () => o.onDecide(decisionItem(item), 'rejected') }, diffLabel));
    function ask() {
      const no = el('button', { type: 'button', class: 'small-btn', 'data-testid': 'merge-same-no', onclick: () => { draw(); const b = row.querySelector('[data-testid=merge-same]'); if (b && b.focus) b.focus(); } }, '아니요');
      row.replaceChildren(
        el('span', { class: 'decide-q', role: 'alert', 'data-testid': 'merge-confirm-q' }, `${sameLabel}${josa(sameLabel, '으로/로')} 이으면 그래프에서 한 항목으로 보입니다. 이을까요?`),
        el('button', { type: 'button', class: 'small-btn', 'data-testid': 'merge-same-yes', onclick: () => o.onDecide(decisionItem(item), 'confirmed') }, '이어요'),
        no);
      if (no.focus) no.focus();
    }
    draw();
    return row;
  };

  // 후보 한 줄에 두 쪽을 가를 근거를 보인다(R13 FU8-24): 어느 지도에 있는지, 사람이면 지금 맡은 업무(최대 3), 업무면 지금 담당. 기존 카드 계산을 읽기만 한다(판정과 무관)
  const SIDE_WORKS_MAX = 3;
  const sideText = (gid) => {
    const n = view.rawNode(gid);
    if (!n) return '';
    const parts = [`「${n.label}」`, `지도 「${n.universe_name}」`];
    try {
      if (o.asOf) {
        if (n.core_type === 'person') {
          const rows = personData(view, view.getNode(gid) || n, { asOf: o.asOf }).personRows;
          parts.push(rows.length ? `지금 맡은 업무: ${rows.slice(0, SIDE_WORKS_MAX).map((r) => r.label).join(', ')}${rows.length > SIDE_WORKS_MAX ? ` 외 ${rows.length - SIDE_WORKS_MAX}건` : ''}` : '지금 맡은 업무 없음');
        } else if (n.core_type === 'work') {
          const c = cardData(view, gid, { asOf: o.asOf });
          if (c && c.loadText) parts.push(c.loadText);
        }
      }
    } catch { /* 근거 줄은 보조 정보다: 계산이 안 되면 지도 이름까지만 */ }
    return parts.join(' · ');
  };
  const sideLines = (item) => (item.b ? el('div', { class: 'merge-sides small', 'data-testid': 'merge-sides' }, ...[item.a, item.b].map((g) => el('div', { class: 'muted', 'data-testid': 'merge-side' }, sideText(g)))) : null);

  // 「사번 없음」 줄의 「사번 넣기」(CR-22 F): 그 사람이 있는 하위 지도가 이 브라우저 저장소에 있고 쓸 수 있을 때만(o.canEmpNo). 아니면 아래 안내
  const empNoRow = (p) => {
    const input = el('input', { type: 'text', maxlength: 100, autocomplete: 'off', placeholder: 'V-0000', 'aria-label': `${p.title.replace('사번 없음: ', '')} 사번`, 'data-testid': 'merge-empno' });
    const msg = el('span', { class: 'error-text', role: 'alert', 'data-testid': 'merge-empno-msg' });
    const submit = () => {
      msg.textContent = '';
      if (!input.value.trim()) { msg.textContent = '사번을 넣으세요.'; return; }
      const r = o.onEmpNo(p, input.value.trim());
      if (r && !r.ok) msg.textContent = r.text || '사번을 넣지 못했습니다.';
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    return el('div', { class: 'row decide-row', 'data-testid': 'merge-empno-row' }, el('label', { class: 'small' }, el('span', { class: 'decide-q' }, '이 사람의 사번을 넣을까요?'), ' ', input), el('button', { type: 'button', class: 'small-btn', 'data-testid': 'merge-empno-add', onclick: submit }, '사번 넣기'), msg);
  };
  const personList = plan.persons.length
    ? el('ul', { class: 'patterns', 'data-testid': 'merge-persons' }, ...plan.persons.map((p) => el('li', { 'data-type': p.type },
      el('div', { class: 'who' }, el('strong', {}, p.title), el('span', { class: 'chip' }, p.type === 'conflict' ? '사번 충돌' : p.type === 'stale' ? '사번 바뀜' : '사번 없음')),
      el('div', { class: 'muted small' }, p.reason),
      sideLines(p),
      chips(view, p.evidence_ids, o.onFocus),
      // 같은 사람이 있는지 비교할 상대가 없는 "사번 없음" 카드는 누를 것이 없으므로 고치는 길을 적는다(여섯 번째 검토 U-12)
      p.type === 'no_empno' && o.canEmpNo && o.canEmpNo(p) ? empNoRow(p) : null,
      p.b ? null : el('div', { class: 'muted small', 'data-testid': 'merge-howto' }, `고치는 방법: 「${(view.rawNode(p.a) || {}).universe_name || '그 사람이 있는'}」 업무 지도를 열어 그 사람을 고르고 「수정」에서 사번을 넣으세요. 다음에 이 목록을 열 때 같은 사번이면 자동으로 잇습니다.`),
      decideButtons(p, '같은 사람', '다른 사람'))))
    : el('p', { class: 'muted small' }, '확인할 사람이 없습니다.');

  // 업무 후보 한 줄. AI 후보(규칙 후보에 없는 쌍)는 점수가 없고 이유가 AI의 것이다: 칩 「AI 후보」 + 이유·인용. 규칙 후보와 겹친 쌍은 기존 내용 그대로 + 칩 + 덧붙임
  const workItem = (w, topicOnlyRow = false) => {
    const aiOnly = w.source === 'ai';
    const r = aiOnly ? null : candidateReason(view, w, o.provider);
    return el('li', { 'data-type': 'work', 'data-source': aiOnly ? 'ai' : null },
      el('div', { class: 'who' }, el('strong', {}, w.title), aiOnly ? null : topicOnlyRow ? el('span', { class: 'chip', 'data-testid': 'topic-only-chip', title: `점수 ${w.score}점은 주제 하나가 겹쳐서 나온 값입니다` }, TOPIC_ONLY_CHIP) : el('span', { class: 'chip' }, `${w.score}점`),
        w.ai ? el('span', { class: 'chip', 'data-testid': 'candidate-ai-chip', title: 'Claude API가 찾은 후보입니다. 두 업무의 글에서 인용이 확인된 쌍만 보입니다. 같은 업무인지는 사람이 정합니다' }, AI_CANDIDATE_LABEL) : null),
      r ? el('div', { class: 'small' }, ...r.sentences.map((s) => el('div', {}, s.text)), el('span', { class: `method-chip ${r.method}`, title: METHOD_LABELS[r.method] }, METHOD_LABELS[r.method].replace(/\(.*\)$/, ''))) : null,
      w.ai ? aiBlock(view, w) : null,
      sideLines(w),
      chips(view, w.evidence_ids, o.onFocus),
      decideButtons(w, '같은 업무', '다른 업무'));
  };
  // 겹친 근거가 주제 하나뿐인 후보(Q1)는 목록 아래 접힌 묶음으로 내린다. 지우지 않고 판정 단추도 그대로다. AI도 같은 쌍으로 본 후보는 위에 둔다
  const topicOnly = plan.works.filter((w) => !w.ai && isTopicOnlyCandidate(w));
  const mainWorks = plan.works.filter((w) => !topicOnly.includes(w));
  const workList = plan.works.length
    ? [
      mainWorks.length
        ? el('ul', { class: 'patterns', 'data-testid': 'merge-works' }, ...mainWorks.map(workItem))
        : el('p', { class: 'muted small', 'data-testid': 'merge-works-none' }, '주제 말고도 겹친 후보는 없습니다. 아래 접힌 묶음에서 주제만 겹친 후보를 볼 수 있습니다.'),
      topicOnly.length
        ? el('details', { class: 'topic-only-candidates', 'data-testid': 'merge-works-topic-only', open: topicOnlyOpen.has(view.universe_id), ontoggle: (e) => { if (e.target.open) topicOnlyOpen.add(view.universe_id); else topicOnlyOpen.delete(view.universe_id); } },
          el('summary', {}, `주제만 겹친 후보 ${topicOnly.length}건`),
          el('p', { class: 'muted small' }, '주제 하나만 겹친 쌍은 점수와 상관없이 같은 업무일 가능성이 낮아 아래로 내렸습니다. 답은 위와 같은 방법으로 고릅니다.'),
          el('ul', { class: 'patterns', 'data-testid': 'merge-works-topic-list' }, ...topicOnly.map((w) => workItem(w, true))))
        : null,
    ].filter(Boolean)
    : [el('p', { class: 'muted small' }, '확인할 업무 후보가 없습니다.')];

  const decided = (o.links || []).filter((l) => l.status !== 'pending');
  const raw = (g) => { const n = view.rawNode(g); return n ? `${n.label}(${n.universe_name})` : g; };
  // RV13-1: 「다시 묻기」로 답을 지운(pending) 쌍 중 위 후보 목록에 없는 것은 여기서 다시 고른다(후보 규칙은 그대로라 같은 지도 업무끼리 등은 후보에 오르지 않는다)
  const listed = new Set([...plan.works, ...plan.persons].filter((x) => x.b).map((x) => pairKey(x.a, x.b)));
  const reasks = o.readOnly ? [] : (o.links || []).filter((l) => l.status === 'pending' && l.method === 'human' && !listed.has(pairKey(l.a, l.b)));
  const reaskRows = reasks.length
    ? el('div', { 'data-testid': 'merge-reask-box' },
      el('h3', {}, `다시 물어볼 답 ${reasks.length}건`),
      el('p', { class: 'muted small' }, '「다시 묻기」로 지운 답입니다. 위 후보 목록에 오르지 않아 여기서 다시 고릅니다.'),
      el('ul', { class: 'patterns', 'data-testid': 'merge-reasks' }, ...reasks.map((l) => {
        const person = l.kind === 'person';
        const item = { a: l.a, b: l.b, kind: l.kind, reason: l.reason, score: l.score };
        return el('li', { 'data-type': person ? 'person' : 'work', 'data-testid': 'merge-reask-row' },
          el('div', { class: 'who' }, el('strong', {}, `${raw(l.a)} ↔ ${raw(l.b)}`), el('span', { class: 'chip' }, '다시 묻는 중')),
          l.reason ? el('div', { class: 'muted small' }, l.reason) : null,
          sideLines(item),
          decideButtons(item, person ? '같은 사람' : '같은 업무', person ? '다른 사람' : '다른 업무'));
      })))
    : null;
  const history = decided.length
    ? el('ul', { class: 'small', 'data-testid': 'merge-decided' }, ...decided.map((l) => el('li', {},
      `${raw(l.a)} · ${raw(l.b)} — ${l.status === 'confirmed' ? '같음' : '다름'}${l.method === 'emp_no_auto' ? '(사번 자동)' : ''}${l.decided_at ? ` · ${l.decided_at.slice(0, 10)}` : ''}`,
      o.isSampleAnswer && o.isSampleAnswer(l) ? el('span', { class: 'chip', style: 'margin-left:6px', 'data-testid': 'merge-sample-answer', title: '이 브라우저에서 고른 답이 아니라, 샘플 데이터에 처음부터 들어 있던 답입니다' }, SAMPLE_ANSWER_CHIP) : null,
      // 잘못 고른 답은 「다시 묻기」로 아직 답하지 않은 상태로 되돌린다(R13 FU8-25). 사번이 같아 자동으로 이은 것은 되돌리지 않는다(다음 묶기에서 다시 이어짐)
      !o.readOnly && o.onReask && l.method === 'human'
        ? el('span', {}, ' ', el('button', { type: 'button', class: 'link', 'data-testid': 'merge-reask', title: '이 답을 지우고 다시 묻습니다', onclick: () => o.onReask(l) }, '다시 묻기'))
        : null)))
    : el('p', { class: 'muted small' }, '아직 없습니다.');

  return el('div', { class: 'insight', 'data-testid': 'merge-panel' },
    el('div', { class: 'row panel-head' }, el('h2', {}, '통합 확인'), el('button', { type: 'button', 'data-testid': 'merge-close', onclick: () => { topicOnlyOpen.delete(view.universe_id); o.onClose(); } }, '닫기')),
    // 처음 쓰는 사람용 한 줄(사용자 10-26 저녁 쉬운 말): 이름은 두고 무엇을 하는 곳인지
    el('p', { class: 'panel-what', 'data-testid': 'merge-what' }, '같은 사람·같은 업무가 여러 지도에 따로 들어갔는지 맞춰 보는 곳입니다.'),
    el('p', { class: 'muted small' }, '사번과 이름이 같은 사람은 이미 하나로 이었습니다. 아래는 사람이 답해야 하는 것입니다. 답하지 않아도 이 업무 지도는 그대로 볼 수 있고, 여기서 고른 답은 원래 업무 지도를 바꾸지 않습니다(「사번 넣기」만 그 사람이 있는 원래 지도에 사번을 넣습니다).'),
    plan.auto.length && !o.readOnly ? el('p', { class: 'notice', 'data-testid': 'merge-auto' }, `사번·이름이 같은 사람 ${plan.auto.length}명을 아직 잇지 않았습니다. 지금 하나로 이을까요? `,
      el('button', { type: 'button', class: 'link', onclick: o.onApplyAuto }, '하나로 잇기')) : null,
    el('h3', {}, `사람 확인 ${plan.persons.length}건`),
    personList,
    el('h3', {}, `업무 후보 ${plan.works.length}건`),
    ...aiHead,
    plan.works.length ? el('p', { class: 'muted small' }, '서로 다른 업무 지도에서 같은 일로 보이는 업무 쌍입니다. 점수는 겹친 수(주제 3, 산출물 유형 2, 이름 낱말 1)를 더한 것으로, 높을수록 비슷합니다.') : null,
    plan.hidden_candidates ? el('p', { class: 'muted small' }, `점수가 낮은 후보 ${plan.hidden_candidates}건은 목록에서 뺐습니다.`) : null,
    ...workList,
    reaskRows,
    el('h3', {}, `지금까지 고른 답 ${decided.length}건`),
    history,
    el('p', { class: 'muted small' }, '「같은 사람」·「같은 업무」를 고르면 그래프에서 한 항목으로 보입니다. 「다른 사람」·「다른 업무」를 고른 둘은 다시 묻지 않습니다.'),
  );
}
