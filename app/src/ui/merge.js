// 통합 확인 목록(R-11 ②③④, T-10). 사람이 "같음/다름"을 정해야 동일성 연결이 생긴다. 확인하지 않은 항목이 있어도
// 통합 유니버스는 그대로 탐색할 수 있다(R-11 ④). 원래 유니버스는 바뀌지 않는다(R-11 ⑤).
// AI 연관 찾기(CR-15 C, T-38): 키가 있을 때만 「AI로 연관 찾기」가 보이고, 찾은 쌍은 「AI 후보」 표시로 업무 후보에 끼워 넣는다. 확정은 여전히 사람.
import { METHOD_LABELS, explainInsight, findCandidatesAsync, isLive, syncProvider } from '../llm/connector.js';
import { AI_CANDIDATE_LABEL, collectWorks, decidedSets, withAiCandidates } from '../llm/ai-candidates.js';
import { pairKey } from '../model/schema.js';
import { el } from './dom.js';
import { evidenceChips as chips } from './evidence.js';

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
      result.counts.decided ? ` · 사람이 이미 판정한 쌍 ${result.counts.decided}개는 넣지 않았습니다` : ''),
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
      el('div', { class: 'row' }, el('button', { type: 'button', class: 'small-btn', 'data-testid': 'btn-ai-candidates', disabled: st.busy, title: 'Claude API로 하위 유니버스의 업무 글을 비교해 뜻이 같은 업무 쌍을 찾습니다. 키가 있을 때만 보입니다. 확정은 사람이 합니다', onclick: press }, 'AI로 연관 찾기')),
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
  const decideButtons = (item, sameLabel, diffLabel) => (o.readOnly || !item.b ? null : el('div', { class: 'row' },
    el('button', { type: 'button', class: 'small-btn', 'data-testid': 'merge-same', onclick: () => o.onDecide(decisionItem(item), 'confirmed') }, sameLabel),
    el('button', { type: 'button', class: 'small-btn', 'data-testid': 'merge-diff', onclick: () => o.onDecide(decisionItem(item), 'rejected') }, diffLabel)));

  const personList = plan.persons.length
    ? el('ul', { class: 'patterns', 'data-testid': 'merge-persons' }, ...plan.persons.map((p) => el('li', { 'data-type': p.type },
      el('div', { class: 'who' }, el('strong', {}, p.title), el('span', { class: 'chip' }, p.type === 'conflict' ? '사번 충돌' : '사번 없음')),
      el('div', { class: 'muted small' }, p.reason),
      chips(view, p.evidence_ids, o.onFocus),
      // 같은 사람이 있는지 비교할 상대가 없는 "사번 없음" 카드는 누를 것이 없으므로 고치는 길을 적는다(여섯 번째 검토 U-12)
      p.b ? null : el('div', { class: 'muted small', 'data-testid': 'merge-howto' }, `고치는 방법: 「${(view.rawNode(p.a) || {}).universe_name || '그 사람이 있는'}」 유니버스를 열어 그 사람을 고르고 「수정」에서 사번을 넣으세요. 다음에 이 목록을 열 때 같은 사번이면 자동으로 잇습니다.`),
      decideButtons(p, '같은 사람', '다른 사람'))))
    : el('p', { class: 'muted small' }, '확인할 사람이 없습니다.');

  const workList = plan.works.length
    ? el('ul', { class: 'patterns', 'data-testid': 'merge-works' }, ...plan.works.map((w) => {
      // AI 후보(규칙 후보에 없는 쌍)는 점수가 없고 이유가 AI의 것이다: 칩 「AI 후보」 + 이유·인용. 규칙 후보와 겹친 쌍은 기존 내용 그대로 + 칩 + 덧붙임
      const aiOnly = w.source === 'ai';
      const r = aiOnly ? null : candidateReason(view, w, o.provider);
      return el('li', { 'data-type': 'work', 'data-source': aiOnly ? 'ai' : null },
        el('div', { class: 'who' }, el('strong', {}, w.title), aiOnly ? null : el('span', { class: 'chip' }, `${w.score}점`),
          w.ai ? el('span', { class: 'chip', 'data-testid': 'candidate-ai-chip', title: 'Claude API가 찾은 후보입니다. 두 업무의 글에서 인용이 확인된 쌍만 보입니다. 같은 업무인지는 사람이 정합니다' }, AI_CANDIDATE_LABEL) : null),
        r ? el('div', { class: 'small' }, ...r.sentences.map((s) => el('div', {}, s.text)), el('span', { class: `method-chip ${r.method}`, title: METHOD_LABELS[r.method] }, METHOD_LABELS[r.method].replace(/\(.*\)$/, ''))) : null,
        w.ai ? aiBlock(view, w) : null,
        chips(view, w.evidence_ids, o.onFocus),
        decideButtons(w, '같은 업무', '다른 업무'));
    }))
    : el('p', { class: 'muted small' }, '확인할 업무 후보가 없습니다.');

  const decided = (o.links || []).filter((l) => l.status !== 'pending');
  const raw = (g) => { const n = view.rawNode(g); return n ? `${n.label}(${n.universe_name})` : g; };
  const history = decided.length
    ? el('ul', { class: 'small', 'data-testid': 'merge-decided' }, ...decided.map((l) => el('li', {},
      `${raw(l.a)} · ${raw(l.b)} — ${l.status === 'confirmed' ? '같음' : '다름'}${l.method === 'emp_no_auto' ? '(사번 자동)' : ''}${l.decided_at ? ` · ${l.decided_at.slice(0, 10)}` : ''}`)))
    : el('p', { class: 'muted small' }, '아직 없습니다.');

  return el('div', { class: 'insight', 'data-testid': 'merge-panel' },
    el('h2', {}, '통합 확인'),
    el('p', { class: 'muted small' }, '같은 사번·이름의 사람은 자동으로 하나로 이었습니다. 아래는 사람이 확인할 항목입니다. 확인하지 않아도 이 유니버스는 그대로 볼 수 있고, 원래 유니버스는 바뀌지 않습니다.'),
    plan.auto.length && !o.readOnly ? el('p', { class: 'notice', 'data-testid': 'merge-auto' }, `사번·이름이 같은 사람 ${plan.auto.length}명을 아직 잇지 않았습니다. `,
      el('button', { type: 'button', class: 'link', onclick: o.onApplyAuto }, '사번 자동 연결 적용')) : null,
    el('h3', {}, `사람 확인 ${plan.persons.length}건`),
    personList,
    el('h3', {}, `업무 후보 ${plan.works.length}건`),
    ...aiHead,
    plan.works.length ? el('p', { class: 'muted small' }, '서로 다른 유니버스에서 같은 일로 보이는 업무 쌍입니다. 점수는 겹친 수(주제 3, 산출물 유형 2, 이름 낱말 1)를 더한 것으로, 높을수록 비슷합니다.') : null,
    plan.hidden_candidates ? el('p', { class: 'muted small' }, `점수가 낮은 후보 ${plan.hidden_candidates}건은 목록에서 뺐습니다.`) : null,
    workList,
    el('h3', {}, `판정 기록 ${decided.length}건`),
    history,
    el('p', { class: 'muted small' }, '같다고 확인하면 그래프에서 한 노드로 보입니다. 다르다고 판정한 쌍은 다시 묻지 않습니다.'),
    el('div', { class: 'row' }, el('button', { type: 'button', onclick: o.onClose }, '닫기')),
  );
}
