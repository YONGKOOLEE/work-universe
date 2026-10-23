// 인수인계 초안 화면(R-03·R-04, T-07). 입력: 대상(유니버스 꼭지 또는 업무), 보내는 사람, 받는 사람.
// 결과: 10개 항목(CR-6), 항목별 근거 링크, 생성 방식 표시, "초안" 상태. 확정은 사람이 한다.

import { buildHandoverDraft, scopeWorks } from '../rules/handover.js';
import { similarExperts, similarSentences, workLoad } from '../rules/insight.js';
import { todayLocal } from './time.js';
import { METHOD_LABELS, isLive, refineDraft, refineDraftAsync, syncProvider } from '../llm/connector.js';
import { el } from './dom.js';
import { downloadWithNotice, draftDoc, printHtml } from './doc-output.js';
import { evidenceChips } from './evidence.js';
import { josa, messageFor } from './messages.js';
import { LABEL_MAX, SUBTYPE_ROLE } from '../model/schema.js';
import { choosePeople, fillHintOf, findPresetTarget, needsPersonHelp, pickNewPerson, recall, remember } from './draft-hints.js';
import { LIVE_HINT_PREGEN, LIVE_HINT_RULE, PREGEN_CHIP_TITLE, PREGEN_NOTE, liveHintFor } from './ai-notes.js';

// 같은 지도에서 초안을 다시 만들 때 마지막으로 고른 보내는·받는 사람을 기억한다(FU-17). 메모리만: 저장소에는 쓰지 않고, 페이지를 다시 열면 사라진다
const lastPeople = new Map();
// 마지막으로 초안을 만든 대상(유니버스 ID별). 기록이 바뀌어 창이 다시 그려질 때(rerun) 같은 대상으로 다시 만들기 위해서만 쓴다
const lastTarget = new Map();
/** 기억한 보내는·받는 사람·대상을 모두 잊는다(단위 테스트용) */
export const forgetLastPeople = () => { lastPeople.clear(); lastTarget.clear(); pendingPerson = null; };

// 「＋ 사람 추가」 → 「넣기」 직후(FU-36): main이 사람 노드를 만들고 초안 창을 다시 그린다. 새 창이 그 사람을 받는 사람으로 골라 두고,
// 사람이 앞서 고른 대상·보내는 사람도 되살린다. 메모리만(저장소에는 쓰지 않음), 한 번 쓰면 비운다
let pendingPerson = null; // {key, label, target, from}

/** 받는 사람 후보가 없을 때의 안내(FU-7). 「＋ 사람 추가」는 노드 추가 창을 유형 「사람」으로 열도록 문서에 알리기만 한다(main.js가 받음) */
export const ADD_PERSON_HELP = '후임이 목록에 없으면 사람으로 먼저 넣으세요. 연결하지 않아도 받는 사람으로 고를 수 있습니다(「수행」으로 이으면 현재 담당으로 보입니다).';

// 키가 없고 사전 생성·규칙 기반 문장일 때의 한 줄(LIVE_HINT_*)은 초안 맨 아래에 보인다(3회차: 결과를 다 읽은 뒤 말한다).
// 사전 생성 안내·칩 설명(PREGEN_NOTE, PREGEN_CHIP_TITLE)도 ai-notes.js 한 곳의 글이고, 이전 이름 그대로 여기서도 내보낸다
export { LIVE_HINT_PREGEN, LIVE_HINT_RULE, PREGEN_CHIP_TITLE, PREGEN_NOTE };

/** 「다음에 해 볼 것」 한 줄(3회차): 초안을 본 뒤 갈 곳. 이벤트 이름은 main.js와의 약속이다(wu:open-insight {kind:'risk'}, wu:overview) */
export const DRAFT_NEXT_LABEL = '다음에 해 볼 것:';
export const DRAFT_NEXT_RISK = '혼자만 아는 일 보기';
export const DRAFT_NEXT_OVERVIEW = '← 지도 전체 보기';
/** 기록이 바뀌어 초안을 자동으로 다시 만들었을 때 결과 위 한 줄(rerun 옵션) */
export const RERUN_NOTE = '기록이 바뀌어 초안을 다시 만들었습니다';
/** 키가 있어도 자동으로 다시 만든 초안은 Claude를 부르지 않는다(과금) — 그때 「생성 중…」 자리에 남기는 안내 */
export const LIVE_RERUN_NOTE = '자동으로 다시 만든 초안은 Claude를 부르지 않은 문장입니다. 「초안 만들기」를 누르면 Claude가 새로 씁니다';

/** 응답으로 문장이 바뀌었을 때 「생성 중…」 자리에 남기는 안내 */
export const LIVE_REPLACED_NOTE = '문장이 Claude API 문장으로 바뀌었습니다 — 확인 후 확정하세요';

const DRAFT_FIELDS = { target: '대상', from: '보내는 사람', to: '받는 사람' };

function draftError(err) {
  if (err.same_person) return '보내는 사람과 받는 사람이 같습니다.';
  if (err.code === 'E-REQUIRED') return `${DRAFT_FIELDS[err.field]}${josa(DRAFT_FIELDS[err.field], '을/를')} 고르세요.`;
  if (err.field === 'target') return '대상은 꼭지(업무 지도의 중심 노드)나 업무만 고를 수 있습니다.';
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
  if (t && t.core_type === 'root' && !others) return `${reason}. 업무 지도 전체를 대상으로 하면 이 지도 안에 견줄 다른 업무가 없습니다. 업무 하나를 대상으로 고르거나, 여러 팀을 묶은 지도에서 만들면 비슷한 일을 해 본 사람을 찾습니다`;
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
 * @param {{preset?:{target?:string,from:string,to:string}, onDraft?:()=>void, view:object, target?:string, provider?:object, onFocus:(gid)=>void, onClose:()=>void, onConfirm?:(input:object)=>object, readOnly?:boolean}} o
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
  // 따라 하기(FU-2): 예시 대상(이름 또는 gid)이 있으면 먼저 고른다. 대상을 먼저 정해야 아래 현재 담당 표시가 그 대상 기준이 된다
  const presetTarget = findPresetTarget(targets, o.preset && o.preset.target);
  if (presetTarget) target.value = presetTarget.gid;
  const universeKey = view.universe_id;
  // 방금 「＋ 사람 추가」로 넣은 사람이 있으면(FU-36) 앞서 고른 대상을 되살린다
  const pend = pendingPerson && pendingPerson.key === universeKey ? pendingPerson : null;
  if (pendingPerson && !pend) pendingPerson = null;
  if (pend && pend.target && targets.some((t) => t.gid === pend.target)) target.value = pend.target;
  // 대상이 업무면 현재 담당자를 알려 주고, 한 명이면 보내는 사람으로 미리 고른다(사람이 바꿀 수 있음)
  const holder = el('p', { class: 'muted small', 'data-testid': 'draft-holder' });
  const showHolder = () => {
    const w = target.value ? workLoad(view, target.value, { asOf: o.asOf || todayLocal() }) : null;
    holder.textContent = !w ? '' : w.current.length ? `현재 담당: ${w.current.map((p) => p.label).join(', ')}` : '현재 담당자 없음';
    if (w && w.current.length === 1 && !from.value && people.some((p) => p.gid === w.current[0].gid)) from.value = w.current[0].gid;
  };
  target.addEventListener('change', showHolder);
  showHolder();
  // 미리 채우는 순서(보내는 사람): 따라 하기 예시(이름) > 현재 담당자 한 명(위 showHolder) > 마지막으로 고른 사람(FU-17). 받는 사람: 예시 > 마지막으로 고른 사람.
  // 예시 이름이 없거나 기억한 사람이 지금 목록에 없으면 건드리지 않는다. 사람이 바꿀 수 있다
  const fromPreset = choosePeople({ people, preset: o.preset, remembered: null });
  // 다시 그려진 창(rerun)에 지금 칸 값(preset)이 넘어왔으면 그것이 우선이고, 일부러 비운 칸을 기억으로 다시 채우지 않는다(R11-7)
  const fromMemory = o.rerun && o.preset ? { from: null, to: null } : choosePeople({ people, preset: null, remembered: recall(lastPeople, universeKey) });
  from.value = fromPreset.from || from.value || fromMemory.from || '';
  to.value = fromPreset.to || fromMemory.to || '';
  if (pend) {
    // 앞서 고른 보내는 사람을 되살리고, 새로 넣은 사람을 받는 사람으로 고른다(같은 사람이면 건드리지 않음). 같은 이름이 이미 있어도 넣기 전에 없던 사람을 고른다
    if (pend.from && people.some((p) => p.gid === pend.from)) from.value = pend.from;
    const added = pickNewPerson(people, pend.label, pend.before);
    if (added && added !== from.value) to.value = added;
    pendingPerson = null;
  }
  // 기록이 바뀌어 다시 그려진 창(rerun): 지금 칸 값(main이 preset·target으로 넘김)이 우선이다(R11-7). 마지막으로 초안을 만든 대상은 대상 칸이 비었을 때만 쓰고,
  // 사람은 위의 미리 채우기(예시·지금 칸 > 마지막으로 고른 사람)가 이미 정했다. 기억이 없거나 목록에 없으면 건드리지 않는다
  if (o.rerun && !pend && !target.value) {
    const lt = lastTarget.get(universeKey);
    if (lt && targets.some((t) => t.gid === lt)) target.value = lt;
    showHolder();
  }
  if (from.value && from.value === to.value) to.value = '';
  // 받는 사람 후보가 없을 때의 안내(FU-7): 후보가 없으면 창을 열 때부터, 그 밖에는 받는 사람 오류가 났을 때 보인다
  // 「＋ 사람 추가」(FU-36): 긴 「노드 추가」 양식 대신 초안 창 안의 작은 칸 두 개(이름 필수·연락처 선택). 「넣기」는 wu:add-node를 label과 함께 보낸다
  // (계약: detail {type:'person', label, attrs?} — label이 있으면 main이 사람 노드를 바로 만들고(연결 없음) 초안 창을 다시 그린다. label이 없으면 기존처럼 노드 추가 창)
  const newName = el('input', { type: 'text', maxlength: String(LABEL_MAX), 'aria-label': '새 사람 이름(필수)', placeholder: '이름(필수)', 'data-testid': 'draft-new-person-name' });
  const newContact = el('input', { type: 'text', maxlength: String(LABEL_MAX), 'aria-label': '새 사람 연락처(선택)', placeholder: '연락처(선택)', 'data-testid': 'draft-new-person-contact' });
  const newMsg = el('p', { class: 'form-message', 'aria-live': 'polite', 'data-testid': 'draft-new-person-msg' });
  const addNew = () => {
    const label = newName.value.trim();
    newMsg.textContent = '';
    newMsg.className = 'form-message';
    if (!label) {
      newMsg.className = 'form-message error';
      newMsg.textContent = '이름을 적으세요.';
      return;
    }
    const contact = newContact.value.trim();
    pendingPerson = { key: universeKey, label, target: target.value, from: from.value, before: people.map((p) => p.gid) };
    newName.value = '';
    newContact.value = '';
    newBox.hidden = true;
    document.dispatchEvent(new CustomEvent('wu:add-node', { detail: { type: 'person', label, attrs: contact ? { 연락처: contact } : undefined } }));
  };
  const onEnter = (e) => { if (e.key === 'Enter') { e.preventDefault(); addNew(); } }; // 안쪽 칸의 Enter가 초안 만들기를 보내지 않게
  newName.addEventListener('keydown', onEnter);
  newContact.addEventListener('keydown', onEnter);
  const newBox = el('div', { class: 'new-person', hidden: true, 'data-testid': 'draft-new-person' },
    el('label', { class: 'field' }, el('span', {}, '이름'), newName),
    el('label', { class: 'field' }, el('span', {}, '연락처'), newContact),
    el('div', { class: 'row' },
      el('button', { type: 'button', class: 'small-btn primary', 'data-testid': 'draft-new-person-add', onclick: addNew }, '넣기'),
      el('button', { type: 'button', class: 'small-btn', 'data-testid': 'draft-new-person-cancel', onclick: () => { newBox.hidden = true; newMsg.textContent = ''; } }, '취소')),
    newMsg);
  const personHelp = el('div', { class: 'muted small', 'data-testid': 'draft-person-help' },
    el('p', {}, ADD_PERSON_HELP),
    o.readOnly ? null : el('button', { type: 'button', class: 'small-btn', 'data-testid': 'draft-add-person', onclick: () => { newBox.hidden = !newBox.hidden; if (!newBox.hidden) newName.focus(); } }, '＋ 사람 추가'),
    o.readOnly ? null : newBox);
  const syncPersonHelp = (errorShown = false) => { personHelp.hidden = !(errorShown || needsPersonHelp(people, from.value)); };
  syncPersonHelp();
  from.addEventListener('change', () => { if (!msg.classList.contains('error')) syncPersonHelp(); });
  const msg = el('div', { class: 'form-message', 'data-testid': 'draft-message', 'aria-live': 'polite' });
  const result = el('div', { 'data-testid': 'draft-result' });
  // 실시간 Claude API(CR-15): 키가 있을 때만 「생성 중…」 표시를 만든다. 키가 없으면 화면에 아무것도 더해지지 않는다
  const live = isLive(o.provider);
  const liveNote = live ? el('p', { class: 'muted small', 'aria-live': 'polite', 'data-testid': 'draft-live' }) : null;
  let liveSeq = 0; // 요청 번호: 새 초안을 만들거나 이 화면을 떠나면(result가 화면에서 빠짐) 이전 응답을 버린다
  // 「생성 중…」 동안은 확정을 잠근다(R10-11): 사용자가 읽지 않은 문장이 응답으로 바뀐 뒤 확정되는 일을 막는다. 읽기 전용이면 원래 잠겨 있으므로 건드리지 않는다
  const lockConfirm = (locked) => {
    const btn = result.querySelector('[data-testid=draft-confirm]');
    if (btn && !o.readOnly) btn.disabled = locked;
  };
  const runLive = (draft, base) => {
    liveSeq += 1;
    const mine = liveSeq;
    const stale = () => mine !== liveSeq || !result.isConnected;
    liveNote.textContent = '생성 중…';
    lockConfirm(true);
    // base: 먼저 그린 결과. 실패·불통과 항목은 그 문장을 그대로 둔다(규칙 기반으로 내려가지 않음)
    refineDraftAsync(draft, { provider: o.provider, exists: view.exists, view, base })
      .then((d) => {
        if (stale()) return;
        liveNote.textContent = '';
        if (d) {
          renderDraft(result, d, view, o.onFocus, o); // 새로 그린 확정 단추는 켜진 상태
          if (d.items.some((i) => i.method === 'llm')) liveNote.textContent = LIVE_REPLACED_NOTE;
        } else lockConfirm(false);
      })
      .catch(() => { if (!stale()) { liveNote.textContent = ''; lockConfirm(false); } });
  };

  const field = (label, input) => el('label', { class: 'field' }, el('span', {}, label), input);
  const form = el(
    'form',
    { class: 'editor', novalidate: true, 'data-testid': 'draft-form' },
    field('대상(업무 지도 또는 업무)', target),
    holder,
    field('보내는 사람', from),
    field('받는 사람', to),
    msg,
    personHelp,
    el('div', { class: 'row' }, el('button', { type: 'submit', class: 'primary' }, '초안 만들기'), el('button', { type: 'button', onclick: o.onClose }, '닫기')),
  );

  // 기록이 바뀌어 초안을 자동으로 다시 만들었다는 한 줄(결과 위). 사람이 「초안 만들기」를 직접 누르면 사라진다
  const rerunNote = el('p', { class: 'muted small', hidden: true, 'data-testid': 'draft-rerun-note', role: 'status' }, RERUN_NOTE);
  // auto: 기록이 바뀌어 창이 다시 그려지며 자동으로 다시 만드는 경우. 사람이 누르지 않았으므로 실시간 호출(과금)은 하지 않는다(R11-7)
  const makeDraft = (auto = false) => {
    rerunNote.hidden = true;
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
      syncPersonHelp(r.error.field === 'to'); // 받는 사람을 고르지 않았거나 보내는 사람과 같을 때 후임 넣는 법을 알린다
      if (live) { liveSeq += 1; liveNote.textContent = ''; }
      return;
    }
    syncPersonHelp();
    const labelOf = (gid) => (people.find((p) => p.gid === gid) || {}).label || '';
    remember(lastPeople, universeKey, from.value, to.value, { from: labelOf(from.value), to: labelOf(to.value) }); // 다시 만들 때 같은 두 사람을 미리 골라 준다(FU-17, gid 먼저·이름은 대체)
    if (target.value) lastTarget.set(universeKey, target.value);
    // 실시간 공급자면 먼저 사전 생성(없으면 규칙 기반) 결과를 그리고, 응답이 오면 교체한다(R-04 ③)
    const first = refineDraft(r.draft, { provider: syncProvider(o.provider), exists: view.exists });
    renderDraft(result, first, view, o.onFocus, o);
    if (o.onDraft) o.onDraft(); // 따라 하기: 결과가 그려졌음을 알린다
    if (live && !auto) runLive(r.draft, first);
    else if (live) { liveSeq += 1; liveNote.textContent = LIVE_RERUN_NOTE; } // 자동으로 다시 만든 초안은 사전 생성·규칙 문장까지만. Claude 호출은 「초안 만들기」를 눌렀을 때만
  };
  form.addEventListener('submit', (evt) => {
    evt.preventDefault();
    makeDraft(false);
  });
  // 기록이 바뀌어 다시 그려진 창(rerun)은 같은 선택으로 바로 초안을 다시 만든다. 대상·보내는·받는 사람 중 하나라도 비면 만들지 않는다(오류 문구도 띄우지 않음)
  if (o.rerun && target.value && from.value && to.value && from.value !== to.value) {
    makeDraft(true);
    if (result.childNodes.length && o.rerunNote !== false) rerunNote.hidden = false;
  }

  return el('div', { class: 'draft' }, el('h2', {}, '인수인계 초안'),
    o.viewDate ? el('p', { class: 'notice', 'data-testid': 'draft-today' }, `초안은 오늘(${o.asOf}) 기준으로 만듭니다. 시간 보기의 기준일(${o.viewDate})과 상관없습니다.`) : null,
    form, rerunNote, liveNote, result);
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
    elsewhere.length ? el('p', { class: 'muted small', 'data-testid': 'confirm-elsewhere' }, `이 화면(「${where}」)에만 저장됩니다. 업무 지도(「${elsewhere.join('」·「')}」)를 단독으로 열면 이 인수인계는 보이지 않습니다. 그 업무 지도에서도 보이게 하려면 그 업무 지도를 열어 업무를 대상으로 확정하세요.`) : null,
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

// 초안 끝 「다음에 해 볼 것」 한 줄. 읽기 전용에서도 보인다(보기만 하는 이동). main.js가 두 이벤트를 받는다(계약, 이름을 바꾸지 말 것)
function draftNext() {
  const go = (label, testid, fire) => el('button', { type: 'button', class: 'link', 'data-testid': testid, onclick: fire }, label);
  return el('p', { class: 'muted small draft-next', 'data-testid': 'draft-next' }, DRAFT_NEXT_LABEL, ' ',
    go(DRAFT_NEXT_RISK, 'draft-next-risk', () => document.dispatchEvent(new CustomEvent('wu:open-insight', { detail: { kind: 'risk' } }))),
    ' · ',
    go(DRAFT_NEXT_OVERVIEW, 'draft-next-overview', () => document.dispatchEvent(new CustomEvent('wu:overview'))));
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
    d.method === 'pregen' ? el('p', { class: 'muted small', 'data-testid': 'draft-method-note' }, PREGEN_NOTE) : null,
    d.method === 'llm' ? el('p', { class: 'muted small', 'data-testid': 'draft-method-note' }, '문장은 Claude API가 실시간으로 이 근거만 보고 썼고, 앱이 근거 ID와 원문 인용(quote)을 검증합니다. 확인되지 않은 항목은 규칙 기반 문장으로 바꿉니다.') : null,
    // 키가 없어 규칙 기반인 것은 고장이 아니라 안내이므로 노란 띠(notice)와 「대체함」 머리말 없이 그 안내만 보인다. 진짜 오류는 지금처럼 원인과 함께 띠로
    d.fallback && d.fallback.keyless
      ? el('p', { class: 'muted small', 'data-testid': 'draft-fallback', 'data-keyless': 'true' }, d.fallback.reason)
      : d.fallback ? el('p', { class: 'notice', 'data-testid': 'draft-fallback' }, `${d.fallback.keep ? '원래 문장을 유지함' : '규칙 기반으로 대체함'}: ${d.fallback.reason}`) : null,
    d.method !== 'rule' && d.counts && d.counts.rule ? el('p', { class: 'muted small', 'data-testid': 'draft-counts' }, `${METHOD_LABELS[d.method]} ${d.counts.provider}개 항목, 나머지 ${d.counts.rule}개는 ${d.method === 'llm' && d.counts.kept ? `호출 전 문장 그대로(사전 생성 ${d.counts.kept}개 포함, 응답에 없거나 검증을 통과하지 못한 항목)` : `규칙 기반(${d.method === 'llm' ? '응답에 없거나 검증을 통과하지 못한 항목' : '사전 생성 결과가 없거나 데이터가 바뀐 항목'})`}`) : null,
    // 사전 생성을 골랐는데 이 조합에 미리 써 둔 문장이 없어 전부 규칙 기반이면 이유를 한 줄로 알린다(재검증 5-4)
    d.method === 'rule' && !d.fallback && o.provider && o.provider.name === 'pregen' ? el('p', { class: 'muted small', 'data-testid': 'draft-rule-reason' }, '이 조합(대상·보내는·받는 사람)에는 미리 써 둔 문장이 없어, 기록을 그대로 모아 만든 초안입니다(규칙 기반). 문장마다 근거가 붙어 있습니다.') : null,
    ...d.items.map((i) =>
      el('section', { class: `draft-item${i.insufficient ? ' insufficient' : ''}`, 'data-testid': `draft-item-${i.key}` },
        el('h4', {}, i.title, i.insufficient ? null : el('span', { class: `method-chip ${i.method || 'rule'}`, 'data-testid': 'item-method', title: i.method === 'pregen' ? PREGEN_CHIP_TITLE : i.method === 'llm' ? 'Claude API가 실시간으로 이 근거만 보고 쓴 문장 — 앱이 근거 ID와 원문 인용(quote)을 검증했습니다' : undefined }, i.method === 'pregen' ? '사전 생성' : i.method === 'llm' ? 'Claude API' : '규칙 기반')),
        i.insufficient && i.empty_reason
          ? el('p', { class: 'muted', 'data-testid': 'not-found' }, `해당 없음 — ${i.empty_reason}`)
          : i.insufficient
          ? el('div', {}, el('p', { class: 'muted', 'data-testid': 'insufficient' }, '이력 부족 — 근거가 되는 기록이 없어 내용을 만들지 않았습니다.'),
            fillHintOf(i.key) ? el('p', { class: 'muted small', 'data-testid': 'draft-fill-hint' }, fillHintOf(i.key)) : null)
          : el('ul', {}, ...i.sentences.map((s) => el('li', {}, el('span', {}, s.text), roleChip(view, i.key, s), el('span', { class: 'evidence-row' }, el('span', { class: 'evidence-label' }, '근거:'), evidenceChips(view, s.evidence_ids, onFocus, { dedupe: false, unknown: true, showText: true }))))),
      ),
    ),
    el('p', { class: 'muted small' }, '축적된 이력으로 만든 초안입니다. 근거를 눌러 확인하고, 담당자가 검토해 확정하세요.'),
    confirmBox(d, view, o),
    draftNext(),
    // 결과를 다 읽은 뒤 맨 아래에 한 줄. 키가 있으면 없고, 키 없음 안내(draft-fallback)가 이미 같은 말을 하면 중복이라 그리지 않는다
    !isLive(o.provider) && (d.method === 'pregen' || d.method === 'rule') && !(d.fallback && d.fallback.keyless)
      ? el('p', { class: 'muted small', 'data-testid': 'draft-live-hint' }, liveHintFor(d.method, d.counts)) : null,
  ].filter(Boolean));
}
