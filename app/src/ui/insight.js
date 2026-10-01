// 인사이트 화면(R-05, T-08): 유사 경험자. 업무를 고르면 비슷한 업무를 수행한 사람을 점수순으로, 근거와 함께 보여 준다.
// 해석과 인력 배치는 사람이 한다(R-05 ③): 화면은 참고 정보임을 밝히고 자동 결정을 하지 않는다.

import { similarExperts } from '../rules/insight.js';
import { el } from './dom.js';

// 오늘 날짜(현지 기준). 현재 담당자를 가르는 기준일이다
export function todayLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function chip(view, gid, onFocus) {
  const hit = view.lookup(gid);
  if (!hit.found) return null;
  const label = hit.hidden ? `${hit.node.label}(숨김 처리된 노드)` : hit.node.label;
  return el('button', { type: 'button', class: 'evidence', title: `근거: ${gid}`, onclick: () => onFocus(hit.node.gid) }, label);
}

/**
 * @param {{view:object, work?:string, asOf?:string, onFocus:(gid)=>void, onClose:()=>void}} o
 */
export function insightPanel(o) {
  const { view } = o;
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
    render(out, view, similarExperts(view, { works: [pick.value], asOf: o.asOf || todayLocal() }), o.onFocus);
  };
  pick.addEventListener('change', run);
  run();

  return el('div', { class: 'insight' },
    el('h2', {}, '유사 경험자'),
    el('p', { class: 'muted small' }, '고른 업무와 같은 주제·산출물 유형·낱말을 가진 다른 업무를 수행한 사람입니다. 현재 담당자는 뺍니다.'),
    el('label', { class: 'field' }, el('span', {}, '업무'), pick),
    out,
    el('div', { class: 'row' }, el('button', { type: 'button', onclick: o.onClose }, '닫기')),
  );
}

function render(box, view, r, onFocus) {
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
            el('div', { class: 'evidence-list' }, ...[...new Set(p.evidence_ids)].map((g) => chip(view, g, onFocus)).filter(Boolean)),
          ),
        ),
      ),
      el('p', { class: 'muted small' }, '참고 정보입니다. 누구에게 물어볼지, 어떻게 배치할지는 사람이 정합니다.'),
    );
  }
  box.replaceChildren(...parts);
}
