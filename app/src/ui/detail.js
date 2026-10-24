// 상세 패널 그리기. 내용은 view/describe.js가 만들고, 여기서는 DOM으로 옮기기만 한다.
import { el } from './dom.js';
import { previewContent } from '../rules/starter-steps.js';

// 이력이 많으면(업무당 1년 30~50건, 조력자 의견 2026-10-12) 최근 것만 먼저 보이고 이전 것은 「모두 보기」로 편다
export const HISTORY_SHOW = 10; // 접었을 때 보이는 최근 이력 수
export const HISTORY_COLLAPSE_OVER = 15; // 이 수를 넘을 때만 접는다(조금 넘는 정도는 그냥 보인다)

function historyItem(h) {
  return el('li', h.after ? { class: 'after', title: '기준일 이후의 이력' } : {}, el('time', {}, h.date), el('span', { class: 'chip' }, h.type_label), el('span', { class: 'text' }, h.text));
}

function historyList(items) {
  if (!items.length) return el('p', { class: 'muted', 'data-testid': 'no-history' }, '기록된 이력 없음');
  const collapsible = items.length > HISTORY_COLLAPSE_OVER;
  const wrap = el('div', {});
  let expanded = false;
  const draw = () => {
    const shown = collapsible && !expanded ? items.slice(-HISTORY_SHOW) : items;
    const rest = items.length - shown.length;
    wrap.replaceChildren(
      ...[collapsible
        ? el('p', { class: 'muted small', 'data-testid': 'history-count' },
          expanded ? `이력 ${items.length}건 전체 ` : `이력 ${items.length}건 중 최근 ${shown.length}건 `,
          el('button', { type: 'button', class: 'link', 'data-testid': 'history-toggle', onclick: () => { expanded = !expanded; draw(); } }, expanded ? '최근 것만 보기' : `모두 보기(이전 ${rest}건)`))
        : null,
      el('ol', { class: 'history', 'data-testid': 'history' }, ...shown.map(historyItem))].filter(Boolean),
    ); // replaceChildren(null)은 「null」 글자를 넣는다
  };
  draw();
  return wrap;
}

/**
 * 노드 상세: 속성, 연결된 노드(클릭하면 이동), 이력. onFocus(gid)는 다른 노드로 이동한다.
 * extra가 있으면 속성 아래에 붙인다(층별 보기 조작 등). toolbar는 제목 아래 편집 버튼,
 * linkTools(link)는 연결마다 붙일 버튼(없으면 null)이다(T-06).
 */
export function renderNodeDetail(panel, d, { onFocus, extra = null, toolbar = null, linkTools = () => null }) {
  panel.replaceChildren();
  if (!d.found) {
    panel.append(el('p', { class: 'muted' }, '항목을 찾을 수 없습니다.'));
    return;
  }
  panel.append(el('h2', {}, d.title));
  if (toolbar) panel.append(toolbar);
  if (d.hidden) panel.append(el('p', { class: 'notice', 'data-testid': 'hidden-note' }, d.deleted ? '완전히 삭제된 항목입니다. 내용은 지워졌고, 이 항목을 언급한 이력만 남아 있습니다.' : '숨김 처리된 항목입니다. 내용과 이력은 유지됩니다.'));

  const dl = el('dl', { 'data-testid': 'attrs' });
  for (const r of d.rows) dl.append(el('dt', {}, r.label), el('dd', {}, r.value));
  panel.append(dl);
  if (extra) panel.append(extra);

  panel.append(el('h3', {}, '연결된 항목'));
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
          el('span', { class: 'arrow', title: l.direction === 'out' ? '이 항목에서 나가는 연결' : '이 항목으로 들어오는 연결' }, l.direction === 'out' ? '→' : '←'),
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

  panel.append(el('h3', { tabindex: '-1', id: 'history-heading', 'data-testid': 'history-heading' }, '이력'), historyList(d.history));
}

/** 노드를 고르지 않았을 때: 유니버스 개요와 사용법 한 줄. */
export function renderUniverseSummary(panel, s, shown = null, extras = {}) {
  panel.replaceChildren();
  panel.append(el('h2', {}, s.name));
  const dl = el('dl', { 'data-testid': 'summary' });
  dl.append(el('dt', {}, '단위'), el('dd', {}, s.level), el('dt', {}, '작성 주체'), el('dd', {}, s.owner));
  if (s.description) dl.append(el('dt', {}, '설명'), el('dd', {}, s.description));
  dl.append(
    el('dt', {}, '규모'),
    el('dd', {}, shown !== null && shown < s.node_total
      ? `지금 화면 ${shown}개 · 접힌 것까지 전체 ${s.node_total}개(${s.counts.map((c) => `${c.type_label} ${c.count}`).join(', ')}), 연결 ${s.edge_total}개`
      : `항목 ${s.node_total}개(${s.counts.map((c) => `${c.type_label} ${c.count}`).join(', ')}), 연결 ${s.edge_total}개`),
  );
  if (s.period) dl.append(el('dt', {}, '이력 기간'), el('dd', {}, `${s.period.first} ~ ${s.period.last}`));
  panel.append(dl);
  // 묶은 지도의 위험 요약 한 줄(FU-10): 인사이트 「인수인계 위험」·「밀집·공백」 탭과 같은 계산의 숫자. 문구와 「자세히」 동작은 부르는 쪽이 정한다
  if (extras.riskSummary) {
    const r = extras.riskSummary;
    panel.append(el('p', { class: 'risk-summary', 'data-testid': 'team-risk-summary' }, r.parts.join(' · '), ' ',
      el('button', { type: 'button', class: 'link', 'data-testid': 'btn-team-risk-more', onclick: r.onMore }, '자세히')));
    // 지난 점검 대비(CR-18 D-3): 증감 한 줄과 「이번 점검 저장」. 기준은 이 브라우저 설정에만 있고 문서에는 들어가지 않는다
    if (r.compare) {
      panel.append(el('p', { class: 'risk-summary risk-compare', 'data-testid': 'team-risk-compare', 'data-has-baseline': r.compare.has ? 'true' : 'false' }, r.compare.text, ' ',
        r.compare.canSave ? el('button', { type: 'button', class: 'small-btn', 'data-testid': 'btn-risk-baseline-save', onclick: r.compare.onSave }, '이번 점검 저장') : null));
    }
  }
  if (s.missing.length) panel.append(el('p', { class: 'notice' }, `찾을 수 없는 하위 업무 지도:${s.missing.join(', ')}`));
  // 사번 충돌은 접힌 한 줄로(FU-13): 열자마자 노란 경고가 길게 보이면 무서우므로 「사번 확인 필요 n건」만 먼저 보이고, 펼치면 예전 내용 그대로
  if (s.empno_conflicts.length) {
    panel.append(el('details', { class: 'conflict-fold', 'data-testid': 'empno-conflicts' },
      el('summary', { class: 'notice', 'data-testid': 'empno-conflicts-summary' }, `사번 확인 필요 ${s.empno_conflicts.length}건`),
      ...s.empno_conflicts.map((c) => el('p', { class: 'notice', 'data-testid': 'empno-conflict' }, `확인할 것: 사번 충돌 — ${c.emp_no}가 서로 다른 이름으로 있습니다(${c.nodes.map((n) => `${n.label}·${n.universe_name}`).join(', ')}). 자동으로 합치지 않았으니 같은 사람인지 확인해 주세요.`))));
  }
  if (s.stale_links.length) panel.append(el('p', { class: 'notice', 'data-testid': 'stale-links' }, `사번이 바뀌어 더는 맞지 않는 사번 자동 연결 ${s.stale_links.length}건은 합치지 않았습니다. 다시 확인이 필요합니다.`));
  // 큰 유니버스: 업무별로 나누라는 안내(막지 않는다)
  if (extras.split) {
    panel.append(el('p', { class: 'hint', 'data-testid': 'split-hint' }, `${extras.universeId === 'U-K1' ? '이 샘플은 단계마다 항목을 만든 비교 자료입니다. ' : ''}항목 ${s.node_total}개 — 한 화면에 다 그리면 이름이 작아집니다(월말 정산 점검은 업무 3개·항목 10개). 업무 하나씩 업무 지도로 만들고 「업무 지도 묶기」로 묶으면 위에서는 접혀 보입니다. 지금은 「항목 찾기」나, 항목을 고른 뒤 「주변만 보기」로 좁혀 보세요.`));
  }
  // 「처음 할 일」: 새로 만든 유니버스가 다음에 할 일 3단계(다 하면 사라진다). 새 사람에게 가장 필요한 안내라 일반 안내보다 위에 둔다
  if (extras.starter) {
    panel.append(el('div', { class: 'hint', 'data-testid': 'starter-steps' },
      el('p', {}, el('strong', {}, '처음 할 일')),
      el('ul', { class: 'starter-list' }, ...extras.starter.steps.map((st) => el('li', { class: st.done ? 'done' : '', 'data-done': st.done ? '1' : '0' }, `${st.done ? '✓' : '○'} `, st.work && extras.onSelect && !st.done
        ? el('button', { type: 'button', class: 'starter-go', 'data-testid': 'starter-go', title: '이 업무를 고릅니다', onclick: () => extras.onSelect(st.work.gid) }, st.label)
        : st.label)))));
    // 팀과 함께 쓰는 길(FU-34): 폴더 연결 탭을 여는 함수(extras.onOpenFolder)가 있을 때만 보인다(읽기 전용·되감기·폴더를 못 쓰는 브라우저에서는 부르는 쪽이 넘기지 않는다)
    if (extras.onOpenFolder) {
      panel.append(el('p', { class: 'muted small', 'data-testid': 'starter-team-hint' }, '팀과 함께 쓰려면 → 「가져오기·내보내기」의 ',
        el('button', { type: 'button', class: 'link', 'data-testid': 'btn-starter-folder', onclick: extras.onOpenFolder }, '「폴더 연결」')));
    }
    // CR-16 ③: 「처음 할 일」이 보이는 동안만, 그 아래에 접힌 미리 보기(샘플 초안의 일부, 사전 생성 문장 그대로). 내용·표시 여부는 rules가 정한다
    const pv = extras.preview !== undefined ? extras.preview : previewContent();
    if (pv) {
      panel.append(el('details', { class: 'hint starter-preview', 'data-testid': 'starter-preview' },
        el('summary', {}, pv.summary),
        el('p', { class: 'muted small', 'data-testid': 'starter-preview-head' }, el('span', { class: 'chip' }, pv.chip), ` ${pv.head}`),
        ...pv.items.map((it) => el('div', { class: 'preview-item', 'data-testid': 'starter-preview-item' }, el('strong', {}, it.title), el('p', {}, it.text))),
        el('p', { class: 'muted small', 'data-testid': 'starter-preview-risk' }, pv.risk),
        el('p', { class: 'small', 'data-testid': 'starter-preview-note' }, pv.note)));
    }
  }
  // 꼭지만 있는 빈 유니버스(새로 만든 직후)에는 다음 행동을 안내한다(검토5 U-5)
  const empty = s.node_total <= 1;
  panel.append(el('div', { class: 'hint', 'data-testid': 'hint' },
    empty
      ? el('p', {}, '아직 항목이 없습니다. 아래 「사람·업무·문서 추가」에서 첫 업무를 추가하세요. 업무정의서가 있으면 머리글의 「가져오기·내보내기」로 초벌을 만들 수도 있습니다.')
      : el('p', {}, '그래프에서 항목을 클릭하면 속성, 연결된 항목, 이력이 여기에 보입니다.'),
    empty ? null : el('p', {}, '아래 「인수인계 초안 만들기」와 「인사이트 보기」도 눌러 보세요.'),
    el('p', { class: 'muted small', 'data-testid': 'term-note' }, '업무 지도는 업무를 묶은 한 단위, 항목은 그래프의 동그라미 하나, 지도 중심은 업무 지도의 중심(가운데 큰 동그라미)입니다.')));
}
