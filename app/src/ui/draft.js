// 인수인계 초안 화면(R-03·R-04, T-07). 입력: 대상(유니버스 꼭지 또는 업무), 보내는 사람, 받는 사람.
// 결과: 10개 항목(CR-6), 항목별 근거 링크, 생성 방식 표시, "초안" 상태. 확정은 사람이 한다.

import { buildHandoverDraft, scopeWorks } from '../rules/handover.js';
import { similarExperts, similarSentences, workLoad } from '../rules/insight.js';
import { todayLocal } from './insight.js';
import { METHOD_LABELS, refineDraft } from '../llm/connector.js';
import { el } from './dom.js';
import { eventChipLabel } from './chip-label.js';
import { messageFor } from './messages.js';

const DRAFT_FIELDS = { target: '대상', from: '보내는 사람', to: '받는 사람' };

function draftError(err) {
  if (err.same_person) return '보내는 사람과 받는 사람이 같습니다.';
  if (err.code === 'E-REQUIRED') return `${DRAFT_FIELDS[err.field]}을(를) 고르세요.`;
  if (err.field === 'target') return '대상은 유니버스(꼭지)나 업무만 고를 수 있습니다.';
  return messageFor(err);
}

function options(nodes, placeholder, selected) {
  const s = el('select', {});
  s.append(el('option', { value: '' }, placeholder));
  for (const n of nodes) s.append(el('option', { value: n.gid, selected: n.gid === selected }, `${n.label} (${n.universe_name})`));
  return s;
}

// 비교했지만 해당자가 없을 때의 안내. 꼭지(유니버스 전체)가 대상이면 그 유니버스의 업무는 모두 비교 대상 안이라
// 다른 유니버스가 함께 보이는 화면(팀·부서)에서만 찾을 수 있다는 것을 덧붙인다
function scopeHint(view, targetGid, reason) {
  const t = view.getNode(targetGid);
  const others = view.nodes.some((n) => n.core_type === 'work' && !n.hidden && t && n.universe_id !== t.universe_id);
  if (t && t.core_type === 'root' && !others) return `${reason}. 유니버스 전체가 대상이라 비교할 다른 업무가 없습니다. 팀·부서 화면에서 업무를 대상으로 만들면 다른 유니버스와 비교합니다`;
  return reason;
}

// 초안을 글로 옮긴다(복사용)
function draftText(d) {
  const lines = [`[초안] ${d.title}`, `생성 방식: ${METHOD_LABELS[d.method]}`, ''];
  for (const i of d.items) {
    lines.push(`■ ${i.title}`);
    if (i.insufficient) lines.push(i.empty_reason ? `  - 해당 없음: ${i.empty_reason}` : '  - 이력 부족');
    for (const s of i.sentences) lines.push(`  - ${s.text}`);
  }
  lines.push('', '※ 축적된 이력으로 만든 초안입니다. 담당자가 확인하고 확정하세요.');
  return lines.join('\n');
}

/**
 * @param {{view:object, target?:string, provider?:object, onFocus:(gid)=>void, onClose:()=>void}} o
 */
export function draftPanel(o) {
  const { view } = o;
  const visible = view.nodes.filter((n) => !n.hidden);
  const targets = visible.filter((n) => n.core_type === 'root' || n.core_type === 'work');
  const people = visible.filter((n) => n.core_type === 'person');
  const target = options(targets, '대상을 고르세요', o.target);
  target.dataset.testid = 'draft-target';
  const from = options(people, '보내는 사람', '');
  from.dataset.testid = 'draft-from';
  const to = options(people, '받는 사람', '');
  to.dataset.testid = 'draft-to';
  // 대상이 업무면 현재 담당자를 알려 주고, 한 명이면 보내는 사람으로 미리 고른다(사람이 바꿀 수 있음)
  const holder = el('p', { class: 'muted small', 'data-testid': 'draft-holder' });
  const showHolder = () => {
    const w = target.value ? workLoad(view, target.value, { asOf: o.asOf || todayLocal() }) : null;
    holder.textContent = !w ? '' : w.current.length ? `현재 담당: ${w.current.map((p) => p.label).join(', ')}` : '현재 담당자 없음';
    if (w && w.current.length === 1 && !from.value && people.some((p) => p.gid === w.current[0].gid)) from.value = w.current[0].gid;
  };
  target.addEventListener('change', showHolder);
  showHolder();
  const msg = el('div', { class: 'form-message', 'data-testid': 'draft-message', 'aria-live': 'polite' });
  const result = el('div', { 'data-testid': 'draft-result' });

  const field = (label, input) => el('label', { class: 'field' }, el('span', {}, label), input);
  const form = el(
    'form',
    { class: 'editor', novalidate: true, 'data-testid': 'draft-form' },
    field('대상(유니버스 또는 업무)', target),
    holder,
    field('보내는 사람', from),
    field('받는 사람', to),
    msg,
    el('div', { class: 'row' }, el('button', { type: 'submit', class: 'primary' }, '초안 만들기'), el('button', { type: 'button', onclick: o.onClose }, '닫기')),
  );

  form.addEventListener('submit', (evt) => {
    evt.preventDefault();
    msg.replaceChildren();
    msg.className = 'form-message';
    // 유사 경험자(D-08): 초안 범위 업무와 비슷한 다른 업무를 한 사람. 받는 사람(이미 담당)은 뺀다
    const base = { target: target.value, from: from.value, to: to.value };
    let similar;
    let similarNone = null;
    if (target.value && to.value) {
      const found = similarExperts(view, { works: scopeWorks(view, target.value), asOf: o.asOf || todayLocal(), exclude: [to.value] });
      similar = similarSentences(found);
      // 비교했지만 해당자가 없으면 "이력 부족"과 구별해 보여 준다(N-5)
      if (found.status === 'none') similarNone = scopeHint(view, target.value, found.reason);
    }
    const r = buildHandoverDraft(view, { ...base, similar, similarNone });
    if (!r.ok) {
      msg.classList.add('error');
      msg.dataset.code = r.error.code;
      msg.append(draftError(r.error));
      result.replaceChildren();
      return;
    }
    const exists = (gid) => view.lookup(gid).found || view.events.some((e) => e.gid === gid);
    renderDraft(result, refineDraft(r.draft, { provider: o.provider, exists }), view, o.onFocus);
  });

  return el('div', { class: 'draft' }, el('h2', {}, '인수인계 초안'),
    o.viewDate ? el('p', { class: 'notice', 'data-testid': 'draft-today' }, `초안은 오늘(${o.asOf}) 기준으로 만듭니다. 시간 보기의 기준일(${o.viewDate})과 상관없습니다.`) : null,
    form, result);
}

function evidenceChip(view, gid, onFocus) {
  const node = view.lookup(gid);
  if (node.found) {
    const label = node.hidden ? `${node.node.label}(숨김 처리된 노드)` : node.node.label;
    return el('button', { type: 'button', class: 'evidence', title: `근거: ${gid}`, onclick: () => onFocus(node.node.gid) }, label);
  }
  // 이벤트 근거: 날짜와 종류
  const ev = view.events.find((e) => e.gid === gid);
  const label = ev ? eventChipLabel(view, ev) : gid;
  const first = ev && ev.node_gids[0];
  return el('button', { type: 'button', class: 'evidence', title: `근거: ${gid}`, onclick: () => first && onFocus(first) }, label);
}

function renderDraft(box, d, view, onFocus) {
  const copyBtn = el('button', { type: 'button', class: 'small-btn', 'data-testid': 'draft-copy' }, '글로 복사');
  copyBtn.addEventListener('click', async () => {
    const text = draftText(d);
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = '복사했습니다';
    } catch {
      // 클립보드를 쓸 수 없는 환경: 글 상자를 보여 주고 직접 복사하게 한다
      box.append(el('textarea', { rows: 10, readonly: true, class: 'copy-box' }, text));
    }
  });
  // replaceChildren은 null을 "null" 글자로 넣으므로 빈 칸을 걸러 낸다
  box.replaceChildren(...[
    el('div', { class: 'draft-head' },
      el('span', { class: 'badge', 'data-testid': 'draft-status' }, '초안'),
      el('span', { class: 'method', 'data-testid': 'draft-method' }, `생성 방식: ${METHOD_LABELS[d.method]}`),
      copyBtn),
    el('h3', { class: 'draft-title' }, d.title),
    d.fallback ? el('p', { class: 'notice', 'data-testid': 'draft-fallback' }, `규칙 기반으로 대체함: ${d.fallback.reason}`) : null,
    d.method !== 'rule' && d.counts && d.counts.rule ? el('p', { class: 'muted small', 'data-testid': 'draft-counts' }, `${METHOD_LABELS[d.method]} ${d.counts.provider}개 항목, 나머지 ${d.counts.rule}개는 규칙 기반(사전 생성 결과가 없거나 데이터가 바뀐 항목)`) : null,
    ...d.items.map((i) =>
      el('section', { class: `draft-item${i.insufficient ? ' insufficient' : ''}`, 'data-testid': `draft-item-${i.key}` },
        el('h4', {}, i.title, i.insufficient ? null : el('span', { class: `method-chip ${i.method || 'rule'}`, 'data-testid': 'item-method' }, i.method === 'pregen' ? '사전 생성' : i.method === 'llm' ? 'LLM' : '규칙 기반')),
        i.insufficient && i.empty_reason
          ? el('p', { class: 'muted', 'data-testid': 'not-found' }, `해당 없음 — ${i.empty_reason}`)
          : i.insufficient
          ? el('p', { class: 'muted', 'data-testid': 'insufficient' }, '이력 부족 — 근거가 되는 기록이 없어 내용을 만들지 않았습니다.')
          : el('ul', {}, ...i.sentences.map((s) => el('li', {}, el('span', {}, s.text), el('span', { class: 'evidence-list' }, ...s.evidence_ids.map((g) => evidenceChip(view, g, onFocus)))))),
      ),
    ),
    el('p', { class: 'muted small' }, '축적된 이력으로 만든 초안입니다. 근거를 눌러 확인하고, 담당자가 검토해 확정하세요.'),
  ].filter(Boolean));
}
