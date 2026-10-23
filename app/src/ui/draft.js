// 인수인계 초안 화면(R-03·R-04, T-07). 입력: 대상(유니버스 꼭지 또는 업무), 보내는 사람, 받는 사람.
// 결과: 10개 항목(CR-6), 항목별 근거 링크, 생성 방식 표시, "초안" 상태. 확정은 사람이 한다.

import { buildHandoverDraft, scopeWorks } from '../rules/handover.js';
import { similarExperts, similarSentences, workLoad } from '../rules/insight.js';
import { todayLocal } from './time.js';
import { METHOD_LABELS, refineDraft } from '../llm/connector.js';
import { el } from './dom.js';
import { downloadWithNotice, draftDoc, printHtml } from './doc-output.js';
import { evidenceChips } from './evidence.js';
import { josa, messageFor } from './messages.js';
import { SUBTYPE_ROLE } from '../model/schema.js';

const DRAFT_FIELDS = { target: '대상', from: '보내는 사람', to: '받는 사람' };

function draftError(err) {
  if (err.same_person) return '보내는 사람과 받는 사람이 같습니다.';
  if (err.code === 'E-REQUIRED') return `${DRAFT_FIELDS[err.field]}${josa(DRAFT_FIELDS[err.field], '을/를')} 고르세요.`;
  if (err.field === 'target') return '대상은 꼭지(유니버스의 중심 노드)나 업무만 고를 수 있습니다.';
  return messageFor(err);
}

// withUniverse: 유니버스가 둘 이상 보일 때만 이름 뒤에 유니버스 이름을 붙인다(하나뿐이면 "월말 정산 점검 (월말 정산 점검)"처럼 겹쳐 보인다, 여섯 번째 검토 U-14)
function options(nodes, placeholder, selected, withUniverse = true) {
  const s = el('select', {});
  s.append(el('option', { value: '' }, placeholder));
  for (const n of nodes) s.append(el('option', { value: n.gid, selected: n.gid === selected }, withUniverse ? `${n.label} (${n.universe_name})` : n.label));
  return s;
}

// 비교했지만 해당자가 없을 때의 안내. 꼭지(유니버스 전체)가 대상이면 그 유니버스의 업무는 모두 비교 대상 안이라
// 다른 유니버스가 함께 보이는 화면(팀·부서)에서만 찾을 수 있다는 것을 덧붙인다
export function scopeHint(view, targetGid, reason) {
  const t = view.getNode(targetGid);
  const inScope = new Set(scopeWorks(view, targetGid).map((g) => view.canonical(g)));
  const others = view.nodes.some((n) => n.core_type === 'work' && !n.hidden && !inScope.has(n.gid));
  if (t && t.core_type === 'root' && !others) return `${reason}. 유니버스 전체가 대상이라 화면 안에 비교할 다른 업무가 없습니다. 업무 하나를 대상으로 하거나, 더 큰 묶음(팀·부서) 화면에서 만들면 다른 업무와 비교합니다`;
  return reason;
}

// 초안을 글로 옮긴다(복사용). confirmed면 확정본 머리·끝 문장
function draftText(d, confirmed = false) {
  const lines = [`[${confirmed ? '확정' : '초안'}] ${d.title}`, `생성 방식: ${METHOD_LABELS[d.method]}`, ''];
  for (const i of d.items) {
    lines.push(`■ ${i.title}`);
    if (i.insufficient) lines.push(i.empty_reason ? `  - 해당 없음: ${i.empty_reason}` : '  - 이력 부족');
    for (const s of i.sentences) lines.push(`  - ${s.text}`);
  }
  lines.push('', confirmed ? '※ 축적된 이력으로 만든 초안을 담당자가 확인하고 확정한 인수인계서입니다.' : '※ 축적된 이력으로 만든 초안입니다. 담당자가 확인하고 확정하세요.');
  return lines.join('\n');
}

/**
 * @param {{preset?:{from:string,to:string}, onDraft?:()=>void, view:object, target?:string, provider?:object, onFocus:(gid)=>void, onClose:()=>void, onConfirm?:(input:object)=>object, readOnly?:boolean}} o
 *   onConfirm: 확정(R-03 ③, CR-8). {draft, text, date}를 받아 저장하고 결과({ok, error})를 돌려준다
 */
export function draftPanel(o) {
  const { view } = o;
  const visible = view.nodes.filter((n) => !n.hidden);
  const targets = visible.filter((n) => n.core_type === 'root' || n.core_type === 'work');
  const people = visible.filter((n) => n.core_type === 'person');
  const multi = new Set(visible.map((n) => n.universe_id)).size > 1;
  const target = options(targets, '대상을 고르세요', o.target, multi);
  target.dataset.testid = 'draft-target';
  const from = options(people, '보내는 사람', '', multi);
  from.dataset.testid = 'draft-from';
  const to = options(people, '받는 사람', '', multi);
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
  // 따라 하기(CR-13 A): 예시 보내는·받는 사람을 이름으로 미리 골라 둔다(사람이 바꿀 수 있음). 이름이 없으면 건드리지 않는다
  if (o.preset) {
    const byLabel = (label) => people.find((p) => p.label === label);
    const f = byLabel(o.preset.from);
    const t = byLabel(o.preset.to);
    if (f) from.value = f.gid;
    if (t) to.value = t.gid;
  }
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
      // 받는 사람(이미 담당)과 보내는 사람(「문의」로 이미 나옴)은 뺀다(검토5 I-4, D3-31)
      const found = similarExperts(view, { works: scopeWorks(view, target.value), asOf: o.asOf || todayLocal(), exclude: [to.value, from.value].filter(Boolean) });
      similar = similarSentences(found);
      // 비교했지만 해당자가 없으면 "이력 부족"과 구별해 보여 준다(N-5)
      if (found.status === 'none') similarNone = scopeHint(view, target.value, found.reason);
    }
    const r = buildHandoverDraft(view, { ...base, asOf: o.asOf || todayLocal(), similar, similarNone });
    if (!r.ok) {
      msg.classList.add('error');
      msg.dataset.code = r.error.code;
      msg.append(draftError(r.error));
      result.replaceChildren();
      return;
    }
    renderDraft(result, refineDraft(r.draft, { provider: o.provider, exists: view.exists }), view, o.onFocus, o);
    if (o.onDraft) o.onDraft(); // 따라 하기: 결과가 그려졌음을 알린다
  });

  return el('div', { class: 'draft' }, el('h2', {}, '인수인계 초안'),
    o.viewDate ? el('p', { class: 'notice', 'data-testid': 'draft-today' }, `초안은 오늘(${o.asOf}) 기준으로 만듭니다. 시간 보기의 기준일(${o.viewDate})과 상관없습니다.`) : null,
    form, result);
}

function confirmError(err) {
  if (err.reason === 'no_work') return '보내는 사람이 맡았던(수행 연결) 업무가 이 범위에 없어 인수인계 이력을 남길 수 없습니다. 업무 하나를 대상으로 초안을 만들어 확정하세요.';
  if (err.reason === 'duplicate') return '같은 날 같은 사람 사이의 인수인계를 이미 확정했습니다. 다시 확정하지 않았습니다.';
  return messageFor(err);
}

// 확정 영역: 사람이 내용을 확인한 뒤 누른다. 확정하면 인수인계서와 인수인계 이력이 저장된다(R-03 ③, CR-8)
function confirmBox(d, view, o) {
  if (!o.onConfirm) return null;
  const date = o.asOf || todayLocal();
  const t = view.getNode(d.target);
  const where = t ? t.universe_name : '';
  // 꼭지 대상이고 범위 업무가 다른 유니버스(묶은 하위)에 있으면, 이력은 이 화면의 유니버스에만 남는다(D3-30 나, 검토5 I-3)
  const elsewhere = t && t.core_type === 'root'
    ? [...new Set(scopeWorks(view, d.target).map((g) => view.getNode(g)).filter((w) => w && w.universe_id !== t.universe_id).map((w) => w.universe_name))]
    : [];
  const msg = el('p', { class: 'form-message', 'data-testid': 'confirm-message', 'aria-live': 'polite' });
  const btn = el('button', { type: 'button', class: 'primary', 'data-testid': 'draft-confirm', disabled: !!o.readOnly }, '확정해 인수인계서로 저장');
  btn.addEventListener('click', () => {
    if (!window.confirm(`이 초안을 확정합니다.\n「${where}」에 인수인계서(산출물)와 ${date} 인수인계 이력이 저장됩니다. 저장한 뒤에는 이력으로 남습니다(숨기기만 가능).`)) return;
    const r = o.onConfirm({ draft: d, text: draftText(d, true), date });
    if (r && !r.ok) {
      msg.className = 'form-message error';
      msg.dataset.code = r.error.code;
      msg.textContent = confirmError(r.error);
    }
  });
  return el('div', { class: 'confirm-box', 'data-testid': 'confirm-box' },
    el('p', { class: 'muted small' }, `내용을 확인했으면 확정하세요. 「${where}」에 인수인계서와 인수인계 이력(${date})이 남고, 다음 인수인계 초안의 「이전 인수인계」 근거가 됩니다.`),
    elsewhere.length ? el('p', { class: 'muted small', 'data-testid': 'confirm-elsewhere' }, `이 화면(「${where}」)에만 저장됩니다. 업무 유니버스(「${elsewhere.join('」·「')}」)를 단독으로 열면 이 인수인계는 보이지 않습니다. 그 유니버스에서도 보이게 하려면 그 유니버스를 열어 업무를 대상으로 확정하세요.`) : null,
    o.readOnly ? el('p', { class: 'muted small' }, '읽기 전용이라 확정할 수 없습니다.') : null,
    btn, msg);
}

// 「관계자」「유사 경험자」 문장의 근거에 역할 이름으로 만든 노드(실제 사람이 아님)가 있으면 밝힌다 — 인사이트 화면과 같은 표시(검토9 P-2)
const ROLE_ITEMS = new Set(['관계자_연락처', '유사_경험자']);
function roleChip(view, itemKey, sentence) {
  if (!ROLE_ITEMS.has(itemKey)) return null;
  const hasRole = sentence.evidence_ids.some((g) => {
    const n = view.getNode(g);
    return n && n.core_type === 'person' && n.subtype === SUBTYPE_ROLE;
  });
  return hasRole ? el('span', { class: 'chip', 'data-testid': 'role-chip', title: '원문에 사람 이름이 없어 역할 이름으로 만든 노드입니다. 실제 담당자는 연결되어 있지 않습니다.' }, '역할 · 담당자 미연결') : null;
}

function renderDraft(box, d, view, onFocus, o = {}) {
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
  const docOf = () => draftDoc(view, d, o.asOf || todayLocal());
  const downBtn = el('button', { type: 'button', class: 'small-btn', 'data-testid': 'draft-download' }, '내려받기');
  downBtn.addEventListener('click', () => { const x = docOf(); downloadWithNotice(downBtn, x.name, x.html); });
  const printBtn = el('button', { type: 'button', class: 'small-btn', 'data-testid': 'draft-print' }, '인쇄');
  printBtn.addEventListener('click', () => printHtml(docOf().html));
  // replaceChildren은 null을 "null" 글자로 넣으므로 빈 칸을 걸러 낸다
  box.replaceChildren(...[
    el('div', { class: 'draft-head' },
      el('span', { class: 'badge', 'data-testid': 'draft-status' }, '초안'),
      // 머리줄이 좁아 괄호 설명은 title로 옮긴다(검토5 U-12). 긴 이름은 머리글 「설정」과 실행 안내에 있다
      el('span', { class: 'method', 'data-testid': 'draft-method', title: METHOD_LABELS[d.method] }, `생성 방식: ${METHOD_LABELS[d.method].replace(/\(.*\)$/, '')}`),
      copyBtn, downBtn, printBtn),
    el('h3', { class: 'draft-title' }, d.title),
    d.method === 'pregen' ? el('p', { class: 'muted small', 'data-testid': 'draft-method-note' }, '문장은 개발 중 Claude가 이 근거만 보고 썼고, 앱이 근거를 검증합니다. 근거가 맞지 않거나 미리 쓴 문장이 없으면 규칙 기반으로 만듭니다.') : null,
    d.fallback ? el('p', { class: 'notice', 'data-testid': 'draft-fallback' }, `규칙 기반으로 대체함: ${d.fallback.reason}`) : null,
    d.method !== 'rule' && d.counts && d.counts.rule ? el('p', { class: 'muted small', 'data-testid': 'draft-counts' }, `${METHOD_LABELS[d.method]} ${d.counts.provider}개 항목, 나머지 ${d.counts.rule}개는 규칙 기반(사전 생성 결과가 없거나 데이터가 바뀐 항목)`) : null,
    // 사전 생성을 골랐는데 이 조합에 미리 써 둔 문장이 없어 전부 규칙 기반이면 이유를 한 줄로 알린다(재검증 5-4)
    d.method === 'rule' && !d.fallback && o.provider && o.provider.name === 'pregen' ? el('p', { class: 'muted small', 'data-testid': 'draft-rule-reason' }, '이 대상·사람 조합은 미리 써 둔 문장이 없어 규칙 기반으로 만들었습니다(기록을 그대로 옮겨 적은 문장).') : null,
    ...d.items.map((i) =>
      el('section', { class: `draft-item${i.insufficient ? ' insufficient' : ''}`, 'data-testid': `draft-item-${i.key}` },
        el('h4', {}, i.title, i.insufficient ? null : el('span', { class: `method-chip ${i.method || 'rule'}`, 'data-testid': 'item-method', title: i.method === 'pregen' ? '개발 중 Claude가 이 근거만 보고 쓴 문장 — 앱이 열 때마다 근거 ID를 검증하고, 맞지 않으면 규칙 기반 문장으로 바꿉니다' : undefined }, i.method === 'pregen' ? '사전 생성' : i.method === 'llm' ? 'LLM' : '규칙 기반')),
        i.insufficient && i.empty_reason
          ? el('p', { class: 'muted', 'data-testid': 'not-found' }, `해당 없음 — ${i.empty_reason}`)
          : i.insufficient
          ? el('p', { class: 'muted', 'data-testid': 'insufficient' }, '이력 부족 — 근거가 되는 기록이 없어 내용을 만들지 않았습니다.')
          : el('ul', {}, ...i.sentences.map((s) => el('li', {}, el('span', {}, s.text), roleChip(view, i.key, s), el('span', { class: 'evidence-row' }, el('span', { class: 'evidence-label' }, '근거:'), evidenceChips(view, s.evidence_ids, onFocus, { dedupe: false, unknown: true }))))),
      ),
    ),
    el('p', { class: 'muted small' }, '축적된 이력으로 만든 초안입니다. 근거를 눌러 확인하고, 담당자가 검토해 확정하세요.'),
    confirmBox(d, view, o),
  ].filter(Boolean));
}
