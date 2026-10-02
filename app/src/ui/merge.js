// 통합 확인 목록(R-11 ②③④, T-10). 사람이 "같음/다름"을 정해야 동일성 연결이 생긴다. 확인하지 않은 항목이 있어도
// 통합 유니버스는 그대로 탐색할 수 있다(R-11 ④). 원래 유니버스는 바뀌지 않는다(R-11 ⑤).
import { METHOD_LABELS, explainInsight } from '../llm/connector.js';
import { eventChipLabel } from './chip-label.js';
import { el } from './dom.js';

function chips(view, ids, onFocus) {
  return el('span', { class: 'evidence-list' }, ...[...new Set(ids)].map((g) => {
    const hit = view.lookup(g);
    if (hit.found) return el('button', { type: 'button', class: 'evidence', title: `근거: ${g}`, onclick: () => onFocus(hit.node.gid) }, `${hit.node.label}`);
    const ev = view.events.find((e) => e.gid === g);
    return ev ? el('button', { type: 'button', class: 'evidence', title: `근거: ${g}`, onclick: () => ev.node_gids[0] && onFocus(ev.node_gids[0]) }, eventChipLabel(view, ev)) : null;
  }).filter(Boolean));
}

/** 업무 후보 이유(역할 c): 사전 생성이 있으면 그 문장, 없으면 규칙 기반 문장 */
export function candidateReason(view, item, provider) {
  const exists = (g) => view.lookup(g).found || view.events.some((e) => e.gid === g);
  return explainInsight({ task: 'work_candidate_reason', target: `work_candidate|${[item.a, item.b].sort().join('|')}`, evidence_ids: item.evidence_ids, rule: [{ text: item.reason, evidence_ids: item.evidence_ids }] }, { provider, exists });
}

/**
 * @param {{view:object, plan:object, links:object[], provider:object|null, readOnly:boolean, onDecide:(item, status)=>void, onApplyAuto:()=>void, onFocus:(gid)=>void, onClose:()=>void}} o
 */
export function mergePanel(o) {
  const { view, plan } = o;
  const decideButtons = (item, sameLabel, diffLabel) => (o.readOnly || !item.b ? null : el('div', { class: 'row' },
    el('button', { type: 'button', class: 'primary small-btn', 'data-testid': 'merge-same', onclick: () => o.onDecide(item, 'confirmed') }, sameLabel),
    el('button', { type: 'button', class: 'small-btn', 'data-testid': 'merge-diff', onclick: () => o.onDecide(item, 'rejected') }, diffLabel)));

  const personList = plan.persons.length
    ? el('ul', { class: 'patterns', 'data-testid': 'merge-persons' }, ...plan.persons.map((p) => el('li', { 'data-type': p.type },
      el('div', { class: 'who' }, el('strong', {}, p.title), el('span', { class: 'chip' }, p.type === 'conflict' ? '사번 충돌' : '사번 없음')),
      el('div', { class: 'muted small' }, p.reason),
      chips(view, p.evidence_ids, o.onFocus),
      decideButtons(p, '같은 사람', '다른 사람'))))
    : el('p', { class: 'muted small' }, '확인할 사람이 없습니다.');

  const workList = plan.works.length
    ? el('ul', { class: 'patterns', 'data-testid': 'merge-works' }, ...plan.works.map((w) => {
      const r = candidateReason(view, w, o.provider);
      return el('li', { 'data-type': 'work' },
        el('div', { class: 'who' }, el('strong', {}, w.title), el('span', { class: 'chip' }, `${w.score}점`)),
        el('div', { class: 'small' }, ...r.sentences.map((s) => el('div', {}, s.text)), el('span', { class: `method-chip ${r.method}` }, METHOD_LABELS[r.method])),
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
    plan.hidden_candidates ? el('p', { class: 'muted small' }, `점수가 낮은 후보 ${plan.hidden_candidates}건은 목록에서 뺐습니다.`) : null,
    workList,
    el('h3', {}, `판정 기록 ${decided.length}건`),
    history,
    el('p', { class: 'muted small' }, '같다고 확인하면 그래프에서 한 노드로 보입니다. 다르다고 판정한 쌍은 다시 묻지 않습니다.'),
    el('div', { class: 'row' }, el('button', { type: 'button', onclick: o.onClose }, '닫기')),
  );
}
