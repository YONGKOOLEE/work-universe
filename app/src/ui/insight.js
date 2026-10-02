// 인사이트 화면(R-05, T-08·T-11). 탭 셋: 유사 경험자 / 반복 비효율 / 밀집·공백. 모두 규칙으로 계산하고 근거를 함께 보여 준다.
// 해석과 인력 배치는 사람이 한다(R-05 ③): 화면은 참고 정보임을 밝히고 자동 결정을 하지 않는다.

import { DENSE_DEFAULT_N, denseLimit, densityGaps, repeatInefficiency, similarExperts } from '../rules/insight.js';
import { el } from './dom.js';

// 밀집 기준 N. 화면에서 바꾸면 이 세션 동안 유지되고 사람 상세의 "밀집 기준에 해당" 판정도 같은 값을 쓴다(저장하지 않음)
let denseN = DENSE_DEFAULT_N;
export const currentDenseN = () => denseN;

// 오늘 날짜(현지 기준). 현재 담당자를 가르는 기준일이다
export function todayLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function chip(view, gid, onFocus) {
  const hit = view.lookup(gid);
  if (hit.found) {
    const label = hit.hidden ? `${hit.node.label}(숨김 처리된 노드)` : hit.node.label;
    return el('button', { type: 'button', class: 'evidence', title: `근거: ${gid}`, onclick: () => onFocus(hit.node.gid) }, label);
  }
  const ev = view.events.find((e) => e.gid === gid);
  if (!ev) return null;
  return el('button', { type: 'button', class: 'evidence', title: `근거: ${gid}`, onclick: () => ev.node_gids[0] && onFocus(ev.node_gids[0]) }, `${ev.occurred_at} 이력`);
}

const chips = (view, ids, onFocus) => el('div', { class: 'evidence-list' }, ...[...new Set(ids)].map((g) => chip(view, g, onFocus)).filter(Boolean));

/**
 * @param {{view:object, kind?:'similar'|'repeat'|'density', work?:string, asOf?:string, onFocus:(gid)=>void, onClose:()=>void}} o
 */
export function insightPanel(o) {
  const { view } = o;
  let kind = o.kind || 'similar';
  const body = el('div', { 'data-testid': 'insight-body' });
  const tabs = el('div', { class: 'tabs', role: 'tablist' });

  const tabButton = (key, label, testid) =>
    el('button', { type: 'button', role: 'tab', class: kind === key ? 'tab active' : 'tab', 'data-testid': testid, onclick: () => { kind = key; draw(); } }, label);

  function draw() {
    tabs.replaceChildren(tabButton('similar', '유사 경험자', 'tab-similar'), tabButton('repeat', '반복 비효율', 'tab-repeat'), tabButton('density', '밀집·공백', 'tab-density'));
    body.replaceChildren(kind === 'similar' ? similarView(o, view) : kind === 'repeat' ? repeatView(view, o.onFocus) : densityView(o, view));
  }
  draw();

  return el('div', { class: 'insight' },
    el('h2', {}, '인사이트'),
    tabs,
    body,
    el('p', { class: 'muted small', 'data-testid': 'insight-note' }, '참고 정보입니다. 해석과 인력 배치는 사람이 정합니다.'),
    el('div', { class: 'row' }, el('button', { type: 'button', onclick: o.onClose }, '닫기')),
  );
}

// ── 유사 경험자 ──
function similarView(o, view) {
  const works = view.nodes.filter((n) => n.core_type === 'work' && !n.hidden);
  const pick = el('select', { 'data-testid': 'insight-work' });
  pick.append(el('option', { value: '' }, '업무를 고르세요'));
  for (const w of works) pick.append(el('option', { value: w.gid, selected: w.gid === o.work }, `${w.label} (${w.universe_name})`));
  const out = el('div', { 'data-testid': 'insight-result' });
  const run = () => {
    if (!pick.value) {
      out.replaceChildren(el('p', { class: 'muted' }, '업무를 고르면 비슷한 업무를 수행한 사람을 찾아 줍니다.'));
      return;
    }
    renderSimilar(out, view, similarExperts(view, { works: [pick.value], asOf: o.asOf || todayLocal() }), o.onFocus);
  };
  pick.addEventListener('change', run);
  run();
  return el('div', {},
    el('p', { class: 'muted small' }, '고른 업무와 같은 주제·산출물 유형·낱말을 가진 다른 업무를 수행한 사람입니다. 현재 담당자는 뺍니다.'),
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
            el('div', { class: 'who' }, el('strong', {}, p.label), p.emp_no ? el('span', { class: 'muted small' }, ` ${p.emp_no}`) : null, el('span', { class: 'chip' }, `${p.score}점`)),
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
function repeatView(view, onFocus) {
  const r = repeatInefficiency(view);
  const parts = [el('p', { class: 'muted small' }, '담당자가 바뀔 때마다 같은 설명을 처음부터 반복하거나, 같은 문제가 여러 업무에서 되풀이되는 패턴입니다.')];
  if (r.status === 'insufficient') {
    parts.push(el('p', { class: 'notice', 'data-testid': 'repeat-insufficient' }, `데이터 부족 — ${r.reason}${r.last_input ? ` (마지막 입력 ${r.last_input})` : ''}.`));
  } else if (r.status === 'none') {
    parts.push(el('p', { class: 'muted', 'data-testid': 'repeat-none' }, `${r.reason}${r.last_input ? ` (마지막 입력 ${r.last_input})` : ''}.`));
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
  return el('div', { 'data-testid': 'repeat-body' }, ...parts.filter(Boolean));
}

// ── 밀집·공백 ──
function densityView(o, view) {
  const asOf = o.asOf || todayLocal();
  const nInput = el('input', { type: 'number', min: '1', step: '1', value: String(denseN), 'data-testid': 'dense-n' });
  const out = el('div', { 'data-testid': 'density-result' });
  const run = () => {
    if (nInput.value !== '') denseN = denseLimit(nInput.value);
    renderDensity(out, view, densityGaps(view, { asOf, n: denseN }), o.onFocus);
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
    box.replaceChildren(el('p', { class: 'notice', 'data-testid': 'density-insufficient' }, `데이터 부족 — ${r.reason}${r.last_input ? ` (마지막 입력 ${r.last_input})` : ''}.`));
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
