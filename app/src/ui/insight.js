// 인사이트 화면(R-05, T-08·T-11). 탭 둘: 유사 경험자 / 반복 비효율. 모두 규칙으로 계산하고 근거를 함께 보여 준다.
// 해석과 인력 배치는 사람이 한다(R-05 ③): 화면은 참고 정보임을 밝히고 자동 결정을 하지 않는다.

import { repeatInefficiency, similarExperts } from '../rules/insight.js';
import { el } from './dom.js';

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
 * @param {{view:object, kind?:'similar'|'repeat', work?:string, asOf?:string, onFocus:(gid)=>void, onClose:()=>void}} o
 */
export function insightPanel(o) {
  const { view } = o;
  let kind = o.kind || 'similar';
  const body = el('div', { 'data-testid': 'insight-body' });
  const tabs = el('div', { class: 'tabs', role: 'tablist' });

  const tabButton = (key, label, testid) =>
    el('button', { type: 'button', role: 'tab', class: kind === key ? 'tab active' : 'tab', 'data-testid': testid, onclick: () => { kind = key; draw(); } }, label);

  function draw() {
    tabs.replaceChildren(tabButton('similar', '유사 경험자', 'tab-similar'), tabButton('repeat', '반복 비효율', 'tab-repeat'));
    body.replaceChildren(kind === 'similar' ? similarView(o, view) : repeatView(view, o.onFocus));
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
