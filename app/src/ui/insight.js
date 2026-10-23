// 인사이트 화면(R-05, T-08·T-11). 탭 다섯(왼쪽부터): 인수인계 위험 / 유사 경험자 / 반복 비효율 / 밀집·공백 / 흐름 변화. 모두 규칙으로 계산하고 근거를 함께 보여 준다.
// 해석과 인력 배치는 사람이 한다(R-05 ③): 화면은 참고 정보임을 밝히고 자동 결정을 하지 않는다.

import { DENSE_DEFAULT_N, denseLimit, densityGaps, repeatInefficiency, similarExperts } from '../rules/insight.js';
import { flowChange } from '../rules/flow.js';
import { RISK, concentrationExplain, handoverReadiness, knowledgeConcentration, readinessExplain, ripple, rippleExplain } from '../rules/insight-risk.js';
import { densityExplain, flowExplain, repeatExplain, similarExplain } from '../rules/explain.js';
import { METHOD_LABELS, afterQuiet, explainInsight, explainInsightAsync, isLive, syncProvider } from '../llm/connector.js';
import { el } from './dom.js';
import { evidenceChips } from './evidence.js';
import { todayLocal } from './time.js';
import { SUBTYPE_ROLE } from '../model/schema.js';
import { KEYLESS_REASON } from '../llm/providers.js';
import { EXPLAIN_SAME_AS_BELOW, PREGEN_CHIP_TITLE } from './ai-notes.js';

// 밀집 기준 N. 화면에서 바꾸면 이 세션 동안 유지되고 사람 상세의 "밀집 기준에 해당" 판정도 같은 값을 쓴다(저장하지 않음)
let denseN = DENSE_DEFAULT_N;
export const currentDenseN = () => denseN;

// 근거 칩 묶음(인사이트는 div.evidence-list). 칩을 누르면 그 묶음 아래에 근거 글 한 줄이 보인다(FU-29, evidence.js의 showText — 글은 view로 만든 기본 함수)
const chips = (view, ids, onFocus) => evidenceChips(view, ids, onFocus, { tag: 'div', showText: true });

// 인사이트 설명(역할 b): 공급자 결과(사전 생성)가 있으면 그 문장, 없으면 규칙 기반 문장. 문장마다 근거 버튼
// same: 아래 카드가 이미 보여 주는 문장(Set). 규칙 기반 설명이 이 문장들과 같으면 같은 글을 두 번 보이지 않는다(반복 비효율 탭, 3회차)
function explainBox(view, req, o, same = null) {
  if (!req) return null;
  // 실시간 공급자(CR-15)면 먼저 사전 생성(없으면 규칙 기반) 설명을 그리고, 응답이 오면 같은 상자 안을 교체한다
  const live = isLive(o.provider);
  const r = explainInsight(req, { provider: syncProvider(o.provider), exists: view.exists });
  const box = el('div', { class: 'explain', 'data-testid': 'insight-explain', 'data-method': r.method });
  const note = live ? el('span', { class: 'muted small', 'aria-live': 'polite', 'data-testid': 'explain-live' }, ' 생성 중…') : null;
  fillExplain(box, view, r, o, note, same);
  if (live) {
    // 디바운스(R10-3): 시간 막대를 끌면 상자가 계속 다시 그려지므로 바로 부르지 않는다. 조용해진 뒤에도 상자가 화면에 남아 있을 때만 부른다(그 사이 다시 그려져 빠졌으면 부르지 않음)
    afterQuiet(() => box.isConnected, () => {
      explainInsightAsync(req, { provider: o.provider, exists: view.exists, view, base: r }) // base: 먼저 그린 문장(실패하면 그대로 둔다)
        .then((r2) => {
          if (!box.isConnected) return; // 다른 화면·탭·업무로 옮겨 갔으면 응답을 버린다
          note.textContent = '';
          if (r2) {
            box.dataset.method = r2.method;
            fillExplain(box, view, r2, o, note, same);
          }
        })
        .catch(() => { if (box.isConnected) note.textContent = ''; });
    });
  }
  return box;
}

function fillExplain(box, view, r, o, note, same = null) {
  // 규칙 기반 문장이 아래 카드와 글자까지 같으면 문장을 다시 쓰지 않는다. 사전 생성·실시간 문장은 카드와 다른 글이라 그대로 보인다
  const dup = !!same && r.method === 'rule' && r.sentences.length > 0 && r.sentences.every((s) => same.has(s.text));
  box.dataset.dup = dup ? 'true' : 'false';
  box.replaceChildren(...[
    el('h4', {}, '설명', el('span', { class: `method-chip ${r.method}`, title: r.method === 'pregen' ? PREGEN_CHIP_TITLE : r.method === 'llm' ? 'Claude API가 실시간으로 이 근거만 보고 쓴 문장 — 앱이 근거 ID와 원문 인용(quote)을 검증했습니다' : METHOD_LABELS[r.method] }, METHOD_LABELS[r.method].replace(/\(.*\)$/, '')), note),
    // 근거가 많으면 접어 둔다(표를 밀어내지 않게)
    dup ? el('p', { class: 'muted small', 'data-testid': 'explain-same-note' }, EXPLAIN_SAME_AS_BELOW) : el('ul', {}, ...r.sentences.map((s) => el('li', {}, s.text, ' ', s.evidence_ids.length > 4
      ? el('details', { class: 'evidence-fold' }, el('summary', { class: 'muted small' }, `근거 ${s.evidence_ids.length}건`), chips(view, s.evidence_ids, o.onFocus))
      : chips(view, s.evidence_ids, o.onFocus)))),
    // 키 없음 안내는 상자마다 되풀이하지 않는다 — 인사이트 맨 위에 한 번만(insightPanel의 insight-keyless)
    r.fallback && !r.fallback.keyless ? el('p', { class: 'muted small', 'data-testid': 'explain-fallback' }, `${r.fallback.keep ? '원래 문장을 유지함' : '규칙 기반으로 대체함'}: ${r.fallback.reason}`) : null,
  ].filter(Boolean));
}

/**
 * @param {{view:object, kind?:'similar'|'repeat'|'density'|'flow'|'risk', today?:string, onTime?:(date)=>void, work?:string, asOf?:string, onFocus:(gid)=>void, onClose:()=>void}} o
 */
export function insightPanel(o) {
  const { view } = o;
  let kind = o.kind || 'similar';
  const past = o.asOf && o.today && o.asOf < o.today;
  // 사전 생성 설명은 오늘 데이터 기준으로 쓴 문장이라 지난 날짜에는 쓰지 않는다(검토3 RULES-6)
  if (past) o = { ...o, provider: null };
  const asofNote = el('p', { class: 'notice', 'data-testid': 'insight-asof' });
  // 키 없이 Claude API를 골랐으면 설명 상자마다 되풀이하지 않고 여기 한 번만 알린다(고장이 아니라 안내라 노란 띠를 쓰지 않음). 지난 날짜 보기는 공급자를 쓰지 않으므로(위) 보이지 않는다
  const keylessNote = o.provider && o.provider.keyless ? el('p', { class: 'muted small', 'data-testid': 'insight-keyless' }, KEYLESS_REASON) : null;
  const body = el('div', { 'data-testid': 'insight-body' });
  const tabs = el('div', { class: 'tabs', role: 'tablist' });

  const tabButton = (key, label, testid) =>
    el('button', { type: 'button', role: 'tab', class: kind === key ? 'tab active' : 'tab', 'data-testid': testid, onclick: () => { kind = key; if (o.onKind) o.onKind(key); draw(); } }, label);

  function draw() {
    // 탭 순서(R9-2): 인수인계 위험을 첫 자리에(핵심 인사이트). 열릴 때 기본으로 보이는 탭은 호출하는 쪽의 kind가 정한다
    tabs.replaceChildren(tabButton('risk', '인수인계 위험', 'tab-risk'), tabButton('similar', '유사 경험자', 'tab-similar'), tabButton('repeat', '반복 비효율', 'tab-repeat'), tabButton('density', '밀집·공백', 'tab-density'), tabButton('flow', '흐름 변화', 'tab-flow'));
    asofNote.hidden = !past;
    asofNote.textContent = kind === 'flow'
      ? `표는 전체 기간이고, 강조한 줄이 기준일(${o.asOf})입니다. 오늘 기준은 그래프 아래 「오늘로」.`
      : `${o.asOf} 기준으로 계산합니다(시간 보기). 오늘 기준은 그래프 아래 「오늘로」.`;
    body.replaceChildren(kind === 'similar' ? similarView(o, view) : kind === 'repeat' ? repeatView(view, o) : kind === 'density' ? densityView(o, view) : kind === 'risk' ? riskView(o, view) : flowView(o, view));
  }
  draw();

  return el('div', { class: 'insight' },
    el('h2', {}, '인사이트'),
    asofNote,
    keylessNote,
    tabs,
    body,
    el('p', { class: 'muted small', 'data-testid': 'insight-note' }, '참고 정보입니다. 해석과 인력 배치는 사람이 정합니다.'),
    el('div', { class: 'row' }, el('button', { type: 'button', 'data-testid': 'insight-close', onclick: o.onClose }, '닫기')),
  );
}

// ── 유사 경험자 ──
function similarView(o, view) {
  const works = view.nodes.filter((n) => n.core_type === 'work' && !n.hidden);
  const pick = el('select', { 'data-testid': 'insight-work' });
  pick.append(el('option', { value: '' }, '업무를 고르세요'));
  const multi = new Set(works.map((w) => w.universe_id)).size > 1; // 유니버스가 하나면 이름 접미사를 붙이지 않는다(U-14)
  for (const w of works) pick.append(el('option', { value: w.gid, selected: w.gid === o.work }, multi ? `${w.label} (${w.universe_name})` : w.label));
  const out = el('div', { 'data-testid': 'insight-result' });
  const run = () => {
    if (!pick.value) {
      out.replaceChildren(el('p', { class: 'muted' }, '업무를 고르면 비슷한 업무를 수행한 사람을 찾아 줍니다.'));
      return;
    }
    const r = similarExperts(view, { works: [pick.value], asOf: o.asOf || todayLocal() });
    renderSimilar(out, view, r, o.onFocus);
    const box = explainBox(view, similarExplain(r, pick.value), o);
    if (box) out.prepend(box);
  };
  pick.addEventListener('change', () => { if (o.onWork) o.onWork(pick.value); run(); });
  run();
  return el('div', {},
    el('p', { class: 'muted small' }, '고른 업무와 같은 주제·산출물 유형·낱말을 가진 다른 업무를 수행한 사람입니다. 현재 담당자는 뺍니다. 주제나 산출물 유형이 하나는 겹쳐야 후보가 됩니다. 점수는 겹친 수(주제 3, 산출물 유형 2, 이름 낱말 1)를 더한 것으로, 높을수록 비슷합니다.'),
    el('label', { class: 'field' }, el('span', {}, '업무'), pick),
    out);
}

function renderSimilar(box, view, r, onFocus) {
  const parts = [];
  if (r.excluded.length) parts.push(el('p', { class: 'muted small', 'data-testid': 'insight-excluded' }, `현재 담당자라 뺀 사람: ${r.excluded.map((x) => x.label).join(', ')}`));
  if (r.status === 'insufficient') {
    parts.push(el('p', { class: 'notice', 'data-testid': 'insight-insufficient' }, `데이터 부족 — ${r.reason}. 업무에 주제나 산출물을 연결하면 찾을 수 있습니다.`));
  } else if (r.status === 'none') {
    parts.push(el('p', { class: 'muted', 'data-testid': 'insight-none' }, `${r.reason}. 같은 주제를 가진 다른 업무가 아직 없습니다.`));
  } else {
    parts.push(
      el('ol', { class: 'experts', 'data-testid': 'insight-people' },
        ...r.people.map((p) =>
          el('li', {},
            el('div', { class: 'who' }, el('strong', {}, p.label), p.emp_no ? el('span', { class: 'muted small' }, ` ${p.emp_no}`) : null,
              // 원문에 사람 이름이 없어 역할 이름으로 만든 노드는 실제 사람이 아님을 밝힌다(여섯 번째 검토 U-18)
              (view.getNode(p.gid) || {}).subtype === SUBTYPE_ROLE ? el('span', { class: 'chip', 'data-testid': 'role-chip', title: '원문에 사람 이름이 없어 역할 이름으로 만든 노드입니다. 실제 담당자는 연결되어 있지 않습니다.' }, '역할 · 담당자 미연결') : null,
              el('span', { class: 'chip' }, `${p.score}점`)),
            ...p.works.map((w) =>
              el('div', { class: 'why' },
                el('div', {}, `「${w.label}」`, el('span', { class: 'muted small' }, ` ${w.universe_name}${w.period ? ` · ${w.period}` : ''}${w.current ? ' · 현재도 담당' : ''}`)),
                el('div', { class: 'muted small' }, w.reasons.join(' · ')),
              ),
            ),
            chips(view, p.evidence_ids, onFocus),
          ),
        ),
      ),
    );
  }
  box.replaceChildren(...parts.filter(Boolean));
}

// ── 반복 비효율 ──
function repeatView(view, o) {
  const onFocus = o.onFocus;
  const r = repeatInefficiency(view, { asOf: o.asOf || todayLocal() }); // 밀집·흐름과 같이 오늘 기준: 미래 날짜 이력은 세지 않는다(검토5 I-2)
  const parts = [el('p', { class: 'muted small' }, '담당자가 바뀔 때마다 같은 설명을 처음부터 반복하거나, 같은 문제가 여러 업무에서 되풀이되는 패턴입니다.')];
  if (r.status === 'insufficient') {
    parts.push(el('p', { class: 'notice', 'data-testid': 'repeat-insufficient' }, `데이터 부족 — ${r.reason}${r.last_input ? ` (마지막 입력 ${r.last_input})` : ' (입력된 업무 이력 없음)'}.`));
  } else if (r.status === 'none') {
    parts.push(el('p', { class: 'muted', 'data-testid': 'repeat-none' }, `${r.reason}${r.last_input ? ` (마지막 입력 ${r.last_input})` : ' (입력된 업무 이력 없음)'}.`));
  } else {
    parts.push(
      el('ul', { class: 'patterns', 'data-testid': 'repeat-patterns' },
        ...r.patterns.map((p) =>
          el('li', { 'data-kind': p.kind },
            el('div', { class: 'who' }, el('span', { class: 'chip' }, p.kind === 'handover_chain' ? '인수인계 반복' : '주제 반복')),
            el('div', {}, p.summary),
            p.steps ? el('ol', { class: 'steps' }, ...p.steps.map((s) => el('li', { class: s.referenced === false ? 'missed' : '' }, s.text))) : null,
            chips(view, p.evidence_ids, onFocus),
          ),
        ),
      ),
    );
  }
  parts.splice(1, 0, explainBox(view, repeatExplain(r, view.universe_id), o, new Set(r.status === 'ok' ? r.patterns.map((p) => p.summary) : [])));
  return el('div', { 'data-testid': 'repeat-body' }, ...parts.filter(Boolean));
}

// ── 밀집·공백 ──
function densityView(o, view) {
  const asOf = o.asOf || todayLocal();
  const nInput = el('input', { type: 'number', min: '1', step: '1', value: String(denseN), 'data-testid': 'dense-n' });
  const out = el('div', { 'data-testid': 'density-result' });
  const run = () => {
    if (nInput.value !== '') denseN = denseLimit(nInput.value);
    const r = densityGaps(view, { asOf, n: denseN });
    renderDensity(out, view, r, o.onFocus);
    const box = explainBox(view, densityExplain(r, view.universe_id), o);
    if (box) out.prepend(box);
  };
  nInput.addEventListener('input', run);
  run();
  return el('div', { 'data-testid': 'density-body' },
    el('p', { class: 'muted small' }, `기준일 ${asOf}에 담당자가 없는 업무(공백)와 한 사람이 여러 업무를 맡은 경우(밀집)입니다. 기간이 끝난 업무는 세지 않습니다.`),
    el('label', { class: 'dg-n' }, el('span', {}, '밀집 기준: 한 사람이'), nInput, el('span', {}, '개 이상 맡음')),
    out);
}

const gapText = (g) => {
  const base = g.kind === 'scheduled' ? `시작 예정 담당자만 있음(${g.next_person.label}, ${g.next_start}부터)` : g.kind === 'ended' ? `이전 담당자만 있음(${g.last_person.label}, ${g.last_end}까지) — 끝난 업무인지 확인` : '담당 기록 없음';
  return g.children ? `${base}. 하위 업무 ${g.children}개 중 ${g.children_covered}개에 담당자 있음` : base;
};

function renderDensity(box, view, r, onFocus) {
  if (r.status === 'insufficient') {
    box.replaceChildren(el('p', { class: 'notice', 'data-testid': 'density-insufficient' }, `데이터 부족 — ${r.reason}${r.last_input ? ` (마지막 입력 ${r.last_input})` : ' (입력된 업무 이력 없음)'}.`));
    return;
  }
  const parts = [
    el('table', { class: 'dg-table', 'data-testid': 'density-groups' },
      el('thead', {}, el('tr', {}, el('th', {}, '조직(유니버스)'), el('th', {}, '업무'), el('th', { title: '기준일에 업무를 맡고 있는 사람 수' }, '인원'), el('th', {}, '공백'), el('th', {}, '밀집'))),
      el('tbody', {}, ...r.groups.map((g) => el('tr', {},
        el('td', {}, g.name),
        ...(g.insufficient
          ? [el('td', { colspan: '4', class: 'muted' }, '데이터 부족(담당자 연결 없음)')]
          : [el('td', {}, String(g.works)), el('td', {}, String(g.people)), el('td', {}, String(g.gaps)), el('td', {}, String(g.dense))]))))),
  ];
  if (r.ended_works) parts.push(el('p', { class: 'muted small', 'data-testid': 'density-ended' }, `기간이 끝난 업무 ${r.ended_works}개는 세지 않았습니다.`));
  if (r.status === 'none') parts.push(el('p', { class: 'muted', 'data-testid': 'density-none' }, `${r.reason}.`));
  if (r.gaps.length) {
    parts.push(el('h3', {}, `공백 ${r.gaps.length}건`),
      el('ul', { class: 'patterns', 'data-testid': 'density-gaps' },
        ...r.gaps.map((g) => el('li', { 'data-kind': g.kind },
          el('div', {}, el('strong', {}, `「${g.label}」`), el('span', { class: 'muted small' }, ` ${g.universe_name}`)),
          el('div', { class: 'muted small' }, gapText(g)),
          chips(view, g.evidence_ids, onFocus)))));
  }
  if (r.dense.length) {
    parts.push(el('h3', {}, `밀집 ${r.dense.length}명 (${r.n}개 이상)`),
      el('ul', { class: 'patterns', 'data-testid': 'density-dense' },
        ...r.dense.map((p) => el('li', {},
          el('div', { class: 'who' }, el('strong', {}, p.label), p.emp_no ? el('span', { class: 'muted small' }, ` ${p.emp_no}`) : null, el('span', { class: 'chip' }, `${p.count}개`)),
          el('div', { class: 'muted small' }, p.works.map((w) => `「${w.label}」`).join(', ')),
          chips(view, p.evidence_ids, onFocus)))));
  }
  box.replaceChildren(...parts.filter(Boolean));
}

// ── 흐름 변화 ──
let flowUnit = 'month';
function flowView(o, view) {
  const today = o.today || todayLocal();
  const unit = el('select', { 'data-testid': 'flow-unit' }, el('option', { value: 'month', selected: flowUnit === 'month' }, '월'), el('option', { value: 'quarter', selected: flowUnit === 'quarter' }, '분기'));
  const out = el('div', { 'data-testid': 'flow-result' });
  const run = () => {
    flowUnit = unit.value;
    const r = flowChange(view, { unit: flowUnit, asOf: today });
    renderFlow(out, view, r, o);
    const box = explainBox(view, flowExplain(r, view.universe_id), o);
    if (box) out.prepend(box);
  };
  unit.addEventListener('change', run);
  run();
  return el('div', { 'data-testid': 'flow-body' },
    el('p', { class: 'muted small' }, '기간마다 기록된 이력 수와, 그 기간 말에 담당 중인 업무·사람 수입니다. 기간(예: 2026-06)을 누르면 그래프가 그 시점으로 바뀝니다.'),
    el('label', { class: 'dg-n' }, el('span', {}, '기간 단위'), unit),
    out);
}

function renderFlow(box, view, r, o) {
  if (r.status === 'insufficient') {
    box.replaceChildren(el('p', { class: 'notice', 'data-testid': 'flow-insufficient' }, `데이터 부족 — ${r.reason}${r.last_input ? ` (마지막 입력 ${r.last_input})` : ' (입력된 업무 이력 없음)'}.`));
    return;
  }
  const cur = o.asOf ? r.periods.find((p) => p.start <= o.asOf && o.asOf <= p.end) : null;
  // 담당(수행) 연결이 없는 유니버스(조직관리 등)는 업무·인원을 세지 않는다 → 0이 아니라 해당 없음
  const noPerforms = !view.edges.some((e) => !e.hidden && e.core_type === 'performs');
  const na = (v) => (noPerforms ? '—' : String(v));
  const row = (p) => {
    const c = p.counts;
    const cells = p.no_data
      ? [el('td', { colspan: '6', class: 'nodata' }, `입력 없음 — 데이터 부족(마지막 입력 ${r.last_input})`)]
      : [String(c.total), String(c.assign_start + c.assign_end), String(c.handover), String(c.affiliation_change), na(p.active_works), na(p.active_people)].map((v) => el('td', {}, v));
    const evidence = p.evidence_ids.length
      ? el('details', {}, el('summary', { class: 'muted small' }, `근거 ${p.evidence_ids.length}`), chips(view, p.evidence_ids, o.onFocus))
      : null;
    // 기간 이름이 곧 「그 시점 보기」 버튼이다(표 오른쪽 끝이 잘려도 들어갈 수 있게, 검토3 UI-4)
    const goto = o.onTime ? el('button', { type: 'button', class: 'link', title: '그래프를 이 기간 말 시점으로', 'data-testid': `flow-goto-${p.key}`, onclick: () => o.onTime(p.at) }, p.key) : p.key;
    return el('tr', { class: cur === p ? 'current-row' : '', 'data-key': p.key },
      el('td', {}, goto, evidence),
      ...cells);
  };
  const parts = [];
  if (r.no_data_periods) {
    parts.push(el('p', { class: 'notice', 'data-testid': 'flow-nodata' }, `마지막 입력(${r.last_input}) 이후 ${r.no_data_periods}개 기간은 입력이 없어 변화를 판단하지 않습니다(데이터 부족).`));
  }
  parts.push(el('table', { class: 'dg-table flow-table', 'data-testid': 'flow-table' },
    el('thead', {}, el('tr', {},
      el('th', {}, '기간'), el('th', { title: '이 기간에 기록된 이력 전체' }, '이력'), el('th', { title: '담당 시작·종료' }, '담당'),
      el('th', { title: '인수인계 이력 수' }, '인수', el('br'), '인계'), el('th', { title: '소속 변경(조직개편 등)' }, '소속'), el('th', { title: '기간 말에 담당자가 있는 업무 수' }, '업무'), el('th', { title: '기간 말에 업무를 맡은 사람 수' }, '인원'))),
    el('tbody', {}, ...r.periods.map(row))));
  if (noPerforms) parts.push(el('p', { class: 'muted small', 'data-testid': 'flow-na' }, '이 유니버스에는 업무 담당(수행) 기록이 없어 업무·인원은 세지 않습니다(—).'));
  box.replaceChildren(...parts);
}

// ── 인수인계 위험(CR-14 B, R-26) ──
const LEVEL_TEXT = { high: '높음', caution: '주의' };

// 인수인계 위험 행의 근거 칩: 6개를 넘으면 「근거 n건」으로 접는다. 경로 글은 단계가 많으면 가운데를 줄인다(재검증 D4: 300단계 사슬)
// 지금 담당이 없는 업무에 붙이는 작은 표시(FU-32). 시작 예정 담당자만 있는 업무는 끝난 업무가 아니므로 그 사실을 알린다
function noCurrentMark(gap) {
  if (!gap) return null;
  const text = gap.kind === 'scheduled' ? `지금 담당 없음 — 시작 예정(${gap.next_person.label}, ${gap.next_start}부터)` : '지금 담당 없음 — 끝난 업무인지 확인';
  return el('span', { class: 'muted small', 'data-testid': 'risk-no-current', 'data-kind': gap.kind }, text);
}

const RISK_FOLD_AT = 6;
function riskChips(view, ids, onFocus) {
  return ids.length > RISK_FOLD_AT
    ? el('details', { class: 'evidence-fold' }, el('summary', { class: 'muted small' }, `근거 ${ids.length}건`), chips(view, ids, onFocus))
    : chips(view, ids, onFocus);
}
function shortPath(text) {
  const parts = String(text).split(/(?= →)/);
  return parts.length <= 6 ? text : `${parts.slice(0, 3).join('')} → … ${parts.length - 5}단계 …${parts.slice(-2).join('')}`;
}

function riskView(o, view) {
  const asOf = o.asOf || todayLocal();
  const uid = view.universe_id;
  const section = (testid, title, hint, content, explain) =>
    el('section', { class: 'risk-section', 'data-testid': testid }, el('h3', {}, title), el('p', { class: 'muted small' }, hint), explain, content);
  const insuff = (testid, r) => el('p', { class: 'notice', 'data-testid': testid }, `데이터 부족 — ${r.reason}.`);

  // ① 지식 집중 위험
  const c = knowledgeConcentration(view, { asOf });
  // 지금 담당(현재 수행 연결)이 없는 업무(FU-32): 「밀집·공백」 탭이 공백으로 세는 업무와 같다 — 같은 함수(densityGaps)의 gaps를 그대로 쓴다(새 규칙 없음, 밀집 기준 N은 공백 판정과 무관)
  const noCurrent = new Map(densityGaps(view, { asOf, n: denseN }).gaps.map((g) => [g.gid, g]));
  let cBody;
  if (c.insufficient) cBody = insuff('risk-concentration-insufficient', c);
  else {
    const k = c.counts;
    const parts = [el('p', { class: 'muted small', 'data-testid': 'risk-concentration-counts' },
      `업무 ${k.works}개 중 혼자 해 본 업무 ${k.one}개(높음 ${k.high}, 주의 ${k.caution}), 둘 이상이 해 본 업무 ${k.many}개${k.unknown ? `, 해 본 사람 기록이 없는 업무 ${k.unknown}개` : ''}${k.role_only ? `, 역할 이름만 있는 업무 ${k.role_only}개(사람 미확인)` : ''}.`)];
    if (c.status === 'none') parts.push(el('p', { class: 'muted', 'data-testid': 'risk-concentration-none' }, `${c.reason}.`));
    else {
      parts.push(el('ul', { class: 'patterns', 'data-testid': 'risk-concentration-list' },
        ...c.items.map((x) => el('li', { 'data-level': x.level },
          el('div', { class: 'who' }, el('strong', {}, `「${x.work.label}」`), el('span', { class: 'chip' }, LEVEL_TEXT[x.level]), el('span', { class: 'muted small' }, ` ${x.work.universe_name}`), noCurrentMark(noCurrent.get(x.work.gid))),
          el('div', { class: 'muted small' }, x.level === 'high' ? `${x.person.label}만 해 봤고 인수인계 기록이 0건입니다.` : `${x.person.label}만 해 봤습니다. 인수인계 이력 ${x.handover_events}건, 인수인계서 ${x.handover_docs}건이 있습니다.`),
          riskChips(view, x.evidence, o.onFocus)))));
    }
    cBody = el('div', {}, ...parts);
  }
  const cBox = explainBox(view, concentrationExplain(c, uid), o);

  // ② 인수인계 준비도
  const r = handoverReadiness(view, { asOf });
  let rBody;
  if (r.insufficient) rBody = insuff('risk-readiness-insufficient', r);
  else {
    rBody = el('ul', { class: 'patterns', 'data-testid': 'risk-readiness-list' },
      ...r.items.map((x) => el('li', { 'data-score': String(x.score) },
        // 빠진 항목은 기본 접어 두고(FU-31) 요약 한 줄만 보인다. 다 갖췄으면 접을 것이 없다
        x.missing.length
          ? el('details', { class: 'readiness-fold', 'data-testid': 'risk-readiness-fold' },
            el('summary', {}, el('strong', {}, `「${x.work.label}」`), ` ${x.score}/${x.total} — 빠진 것 ${x.missing.length}개`, el('span', { class: 'muted small' }, ` ${x.work.universe_name}`)),
            el('ul', { class: 'steps' }, ...x.missing.map((m) => el('li', {}, `${m.label} — ${m.detail}`, ' ', chips(view, m.evidence, o.onFocus)))))
          : el('div', { class: 'who' }, el('strong', {}, `「${x.work.label}」`), el('span', { class: 'chip' }, `${x.score}/${x.total}`), el('span', { class: 'muted small' }, ` ${x.work.universe_name}`)),
        x.missing.length ? null : el('div', { class: 'muted small' }, '6항목을 모두 갖췄습니다.'))));
  }
  const rBox = explainBox(view, readinessExplain(r, uid), o);

  // ③ 파급 영향
  const p = ripple(view, { asOf });
  let pBody;
  if (p.insufficient) pBody = insuff('risk-ripple-insufficient', p);
  else if (p.status === 'none') pBody = el('p', { class: 'muted', 'data-testid': 'risk-ripple-none' }, `${p.reason}.`);
  else {
    pBody = el('div', {},
      el('h4', {}, `길목 업무 상위 ${p.works.length}개`),
      el('ol', { class: 'patterns', 'data-testid': 'risk-ripple-works' },
        ...p.works.map((x) => el('li', {},
          el('div', { class: 'who' }, el('strong', {}, `「${x.work.label}」`), el('span', { class: 'chip' }, `${x.count}개 업무에 닿음`)),
          el('div', { class: 'muted small' }, `경로 예: ${shortPath(x.path.text)}`),
          riskChips(view, x.evidence, o.onFocus)))),
      el('h4', {}, '혼자 맡은 사람이 빠지면 함께 막히는 업무'),
      p.people.length
        ? el('ol', { class: 'patterns', 'data-testid': 'risk-ripple-people' },
          ...p.people.map((x) => el('li', {},
            el('div', { class: 'who' }, el('strong', {}, x.person.label), el('span', { class: 'chip' }, `${x.count}개 업무`)),
            el('div', { class: 'muted small' }, `혼자 맡은 업무 ${x.sole_works}개에서 이어지는 다른 업무 수입니다(겹치는 업무는 한 번만, 자기 업무는 뺌).`),
            riskChips(view, x.evidence, o.onFocus))))
        : el('p', { class: 'muted', 'data-testid': 'risk-ripple-nopeople' }, '기준일에 혼자 맡은 업무에서 이어지는 업무가 없습니다.'));
  }
  const pBox = explainBox(view, rippleExplain(p, uid), o);

  return el('div', { 'data-testid': 'risk-body' },
    el('p', { class: 'muted small' }, `기준일 ${asOf}에 한 사람에게 일이 몰려 있거나 인수인계 준비가 덜 된 곳, 한 업무가 막힐 때 영향이 퍼지는 곳을 기록에서 셉니다. 기록에 없는 것은 세지 않으므로, 입력이 모자란 곳은 위험이 낮게 보일 수 있습니다.`),
    section('risk-concentration', '① 한 사람에게 몰린 지식', '업무를 해 본 사람(과거·현재, 역할 이름 제외)이 한 명뿐이고 인수인계 기록이 없으면 「높음」, 기록이 있으면 「주의」입니다.', cBody, cBox),
    section('risk-readiness', `② 인수인계 준비도 (6항목 중 몇 개)`, `표준 양식 권장 항목 · 미해결 이슈 없음 · 산출물 연결 · 현재 담당자 · 인수인계 이력 또는 인수인계서 · 최근 ${RISK.RECENT_DAYS}일 이내 이력. 낮은 순입니다.`, rBody, rBox),
    section('risk-ripple', '③ 막히면 퍼지는 영향', '선후행(앞 → 뒤)과 산출 → 참조(이 업무의 산출물을 다른 업무가 참조)를 따라 이어서 닿는 업무 수입니다.', pBody, pBox));
}
