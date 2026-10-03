// 상세 패널 그리기. 내용은 view/describe.js가 만들고, 여기서는 DOM으로 옮기기만 한다.
import { el } from './dom.js';

function historyList(items) {
  if (!items.length) return el('p', { class: 'muted', 'data-testid': 'no-history' }, '기록된 이력 없음');
  return el(
    'ol',
    { class: 'history', 'data-testid': 'history' },
    ...items.map((h) => el('li', h.after ? { class: 'after', title: '기준일 이후의 이력' } : {}, el('time', {}, h.date), el('span', { class: 'chip' }, h.type_label), el('span', { class: 'text' }, h.text))),
  );
}

/**
 * 노드 상세: 속성, 연결된 노드(클릭하면 이동), 이력. onFocus(gid)는 다른 노드로 이동한다.
 * extra가 있으면 속성 아래에 붙인다(층별 보기 조작 등). toolbar는 제목 아래 편집 버튼,
 * linkTools(link)는 연결마다 붙일 버튼(없으면 null)이다(T-06).
 */
export function renderNodeDetail(panel, d, { onFocus, extra = null, toolbar = null, linkTools = () => null }) {
  panel.replaceChildren();
  if (!d.found) {
    panel.append(el('p', { class: 'muted' }, '노드를 찾을 수 없습니다.'));
    return;
  }
  panel.append(el('h2', {}, d.title));
  if (toolbar) panel.append(toolbar);
  if (d.hidden) panel.append(el('p', { class: 'notice', 'data-testid': 'hidden-note' }, '숨김 처리된 노드입니다. 내용과 이력은 유지됩니다.'));

  const dl = el('dl', { 'data-testid': 'attrs' });
  for (const r of d.rows) dl.append(el('dt', {}, r.label), el('dd', {}, r.value));
  panel.append(dl);
  if (extra) panel.append(extra);

  panel.append(el('h3', {}, '연결된 노드'));
  if (d.no_links) {
    panel.append(el('p', { class: 'muted', 'data-testid': 'no-links' }, '연결 없음'));
  } else {
    const ul = el('ul', { class: 'links', 'data-testid': 'links' });
    for (const l of d.links) {
      ul.append(
        el(
          'li',
          {},
          el('span', { class: 'chip' }, l.relation),
          el('span', { class: 'arrow', title: l.direction === 'out' ? '이 노드에서 나가는 연결' : '이 노드로 들어오는 연결' }, l.direction === 'out' ? '→' : '←'),
          el('button', { type: 'button', class: 'link', onclick: () => onFocus(l.other.gid) }, l.other.label),
          el('span', { class: 'muted small' }, ` ${l.other.type_label}`),
          l.status ? el('span', { class: `chip status-${l.status_key === 'current' ? 'current' : 'other'}`, 'data-testid': 'link-status' }, l.status) : null,
          l.period ? el('div', { class: 'muted small' }, l.period) : null,
          l.note ? el('div', { class: 'muted small' }, l.note) : null,
          linkTools(l),
        ),
      );
    }
    panel.append(ul);
  }

  panel.append(el('h3', {}, '이력'), historyList(d.history));
}

/** 노드를 고르지 않았을 때: 유니버스 개요와 사용법 한 줄. */
export function renderUniverseSummary(panel, s, shown = null) {
  panel.replaceChildren();
  panel.append(el('h2', {}, s.name));
  const dl = el('dl', { 'data-testid': 'summary' });
  dl.append(el('dt', {}, '단위'), el('dd', {}, s.level), el('dt', {}, '작성 주체'), el('dd', {}, s.owner));
  if (s.description) dl.append(el('dt', {}, '설명'), el('dd', {}, s.description));
  dl.append(
    el('dt', {}, '구성'),
    el('dd', {}, shown !== null && shown < s.node_total
      ? `지금 화면 ${shown}개 · 접힌 것까지 전체 ${s.node_total}개(${s.counts.map((c) => `${c.type_label} ${c.count}`).join(', ')}), 연결 ${s.edge_total}개`
      : `노드 ${s.node_total}개(${s.counts.map((c) => `${c.type_label} ${c.count}`).join(', ')}), 연결 ${s.edge_total}개`),
  );
  if (s.period) dl.append(el('dt', {}, '이력 기간'), el('dd', {}, `${s.period.first} ~ ${s.period.last}`));
  panel.append(dl);
  if (s.missing.length) panel.append(el('p', { class: 'notice' }, `찾을 수 없는 하위 유니버스: ${s.missing.join(', ')}`));
  for (const c of s.empno_conflicts) {
    panel.append(el('p', { class: 'notice', 'data-testid': 'empno-conflict' }, `사번 충돌: ${c.emp_no}가 서로 다른 이름으로 있습니다(${c.nodes.map((n) => `${n.label}·${n.universe_name}`).join(', ')}). 자동으로 합치지 않습니다. 확인이 필요합니다.`));
  }
  if (s.stale_links.length) panel.append(el('p', { class: 'notice', 'data-testid': 'stale-links' }, `사번이 바뀌어 더는 맞지 않는 사번 자동 연결 ${s.stale_links.length}건은 합치지 않았습니다. 다시 확인이 필요합니다.`));
  // 꼭지만 있는 빈 유니버스(새로 만든 직후)에는 다음 행동을 안내한다(검토5 U-5)
  const empty = s.node_total <= 1;
  panel.append(el('div', { class: 'hint', 'data-testid': 'hint' },
    empty
      ? el('p', {}, '아직 노드가 없습니다. 아래 「노드 추가」에서 첫 업무를 추가하세요. 업무정의서가 있으면 머리글의 「가져오기·내보내기」로 초벌을 만들 수도 있습니다.')
      : el('p', {}, '그래프에서 노드를 클릭하면 속성, 연결된 노드, 이력이 여기에 보입니다.'),
    empty ? null : el('p', {}, '아래 「인수인계 초안 만들기」와 「인사이트 보기」도 눌러 보세요.')));
}
