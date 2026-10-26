// 상세 패널 그리기. 내용은 view/describe.js가 만들고, 여기서는 DOM으로 옮기기만 한다.
import { el } from './dom.js';
import { previewContent } from '../rules/starter-steps.js';
import { NAMES_CUT_NOTE, namesText, ownerChangesText } from '../rules/daily-use.js';
import { historyFocus } from '../view/recent-records.js';
import { cleanWorkspace, workspaceOf } from '../view/workspace.js';
import { renderCard } from './card.js';

// 이력이 많으면(업무당 1년 30~50건, 조력자 의견 2026-10-12) 최근 것만 먼저 보이고 이전 것은 「모두 보기」로 편다
export const HISTORY_SHOW = 10; // 접었을 때 보이는 최근 이력 수
export const HISTORY_COLLAPSE_OVER = 15; // 이 수를 넘을 때만 접는다(조금 넘는 정도는 그냥 보인다)

// justAdded: 방금 기록한 이벤트 전역 ID들(CR-21 B-1). 그 줄에 data-just-added를 달아 강조한다
function historyItem(h, justAdded) {
  const attrs = { ...(h.after ? { class: 'after', title: '기준일 이후의 이력' } : {}), 'data-ev-gid': h.gid, ...(justAdded && justAdded.includes(h.gid) ? { 'data-just-added': '1' } : {}) };
  // 종류 칩과 같은 글이면 한쪽만(R12 FU7-14: 「생성 / 생성」 반복)
  return el('li', attrs, el('time', {}, h.date), el('span', { class: 'chip' }, h.type_label), h.text === h.type_label ? null : el('span', { class: 'text' }, h.text));
}

function historyList(items, justAdded = null) {
  if (!items.length) return el('p', { class: 'muted', 'data-testid': 'no-history' }, '기록된 이력 없음');
  const collapsible = items.length > HISTORY_COLLAPSE_OVER;
  const wrap = el('div', {});
  // 방금 기록한 줄이 접힌 쪽(옛 날짜로 기록)이면 처음부터 펼쳐 보인다
  let expanded = historyFocus(items, justAdded, { show: HISTORY_SHOW, collapseOver: HISTORY_COLLAPSE_OVER }).foldedAway;
  const draw = () => {
    const shown = collapsible && !expanded ? items.slice(-HISTORY_SHOW) : items;
    const rest = items.length - shown.length;
    wrap.replaceChildren(
      ...[collapsible
        ? el('p', { class: 'muted small', 'data-testid': 'history-count' },
          expanded ? `이력 ${items.length}건 전체 ` : `이력 ${items.length}건 중 최근 ${shown.length}건 `,
          el('button', { type: 'button', class: 'link', 'data-testid': 'history-toggle', onclick: () => { expanded = !expanded; draw(); } }, expanded ? '최근 것만 보기' : `모두 보기(이전 ${rest}건)`))
        : null,
      el('ol', { class: 'history', 'data-testid': 'history' }, ...shown.map((h) => historyItem(h, justAdded)))].filter(Boolean),
    ); // replaceChildren(null)은 「null」 글자를 넣는다
  };
  draw();
  return wrap;
}

/**
 * 노드 상세: card가 있으면 항목 카드(ui/card.js), 없으면(지도 중심) 속성, 연결된 노드(클릭하면 이동), 이력. onFocus(gid)는 다른 노드로 이동한다.
 * extra가 있으면 속성 아래에 붙인다(층별 보기 조작 등). toolbar는 제목 아래 편집 버튼,
 * linkTools(link)는 연결마다 붙일 버튼(없으면 null)이다(T-06). justAdded는 방금 기록한 이력 줄(이벤트 전역 ID들)의 강조(CR-21 B-1).
 */
export function renderNodeDetail(panel, d, { onFocus, extra = null, toolbar = null, linkTools = () => null, justAdded = null, card = null }) {
  panel.replaceChildren();
  if (!d.found) {
    panel.append(el('p', { class: 'muted' }, '항목을 찾을 수 없습니다.'));
    return;
  }
  // 새 항목 카드(CR-22 K): 지도 중심(root)을 뺀 항목. card에 main.js가 만든 값·요소가 들어 있다. 지도 중심은 아래 예전 모양 그대로
  if (card) {
    renderCard(panel, d, card.data, { onFocus, linkTools, justAdded, ...card });
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
          l.status ? el('span', { class: `chip status-${l.status_key === 'current' ? 'current' : 'other'}`, title: l.status_key === 'handover' ? '이 날 다른 사람이 담당을 이어받았습니다. 인사이트·초안을 셀 때는 이 날까지 담당으로 봅니다' : null, 'data-testid': 'link-status' }, l.status) : null,
          l.period ? el('div', { class: 'muted small' }, l.period) : null,
          l.note ? el('div', { class: 'muted small' }, l.note) : null,
          linkTools(l),
        ),
      );
    }
    panel.append(ul);
  }

  panel.append(el('h3', { tabindex: '-1', id: 'history-heading', 'data-testid': 'history-heading' }, '이력'), historyList(d.history, justAdded));
}

/**
 * 노드를 고르지 않았을 때: 고른 작업 공간(extras.space, 기본 지도 보기)의 첫 화면(CR-22 W).
 * 공간마다 보이는 조각이 다르다 — 지도 보기: 지도 요약·처음 할 일·안내 / 기록·인수인계·매주 점검·지도 관리: 부르는 쪽(main.js)이 만들어 넘긴
 * extras.record·handover·check·edit(배열, null은 걸러짐). 묶은 지도의 위험 요약(riskSummary)은 「매주 점검」 맨 앞, 사번 충돌·바뀐 연결 안내는 「지도 관리」 맨 뒤.
 * 어느 공간이든 비어 있는 조각은 그리지 않는다.
 */
export function renderUniverseSummary(panel, s, shown = null, extras = {}) {
  panel.replaceChildren();
  const space = cleanWorkspace(extras.space);
  const ws = workspaceOf(space);
  if (space !== 'map') {
    panel.append(el('h2', { tabindex: '-1', 'data-testid': 'ws-title' }, ws.label), el('p', { class: 'muted small goal-desc', 'data-testid': 'ws-desc' }, ws.desc));
    // 내용 상자. 예전 점검이 쓰던 goal-sec-* 이름을 그대로 쓴다(record·handover·check·edit)
    const body = (key, list) => {
      const kids = list.filter(Boolean);
      return kids.length ? el('section', { class: 'goal-sec', 'data-testid': `goal-sec-${key}` }, ...kids) : null;
    };
    let box;
    if (space === 'check') box = body('check', [...riskParts(extras), ...(extras.check || [])]);
    else if (space === 'edit') box = body('edit', [...(extras.edit || []), ...fixParts(s)]);
    else box = body(space, extras[space] || []);
    if (box) panel.append(box);
    return;
  }

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

  if (s.missing.length) panel.append(el('p', { class: 'notice' }, `찾을 수 없는 하위 업무 지도:${s.missing.join(', ')}`));
  // 큰 유니버스: 업무별로 나누라는 안내(막지 않는다)
  if (extras.split) {
    panel.append(el('p', { class: 'hint', 'data-testid': 'split-hint' }, `${extras.universeId === 'U-K1' ? '이 샘플은 단계마다 항목을 만든 비교 자료입니다. ' : ''}항목 ${s.node_total}개 — 한 화면에 다 그리면 이름이 작아집니다(월말 정산 점검은 업무 3개·항목 10개). 업무 하나씩 업무 지도로 만들고 「지도 관리」의 「업무 지도 묶기」로 묶으면 위에서는 접혀 보입니다. 지금은 「항목 찾기」나, 항목을 고른 뒤 「주변만 보기」로 좁혀 보세요.`));
  }
  // 「처음 할 일」: 새로 만든 유니버스가 다음에 할 일 3단계(다 하면 사라진다). 새 사람에게 가장 필요한 안내라 맨 위에 둔다. 줄을 누르면 그 일을 하는 작업 공간으로 간다
  if (extras.starter) {
    panel.append(el('div', { class: 'hint', 'data-testid': 'starter-steps' },
      el('p', {}, el('strong', {}, '처음 할 일')),
      el('ul', { class: 'starter-list' }, ...extras.starter.steps.map((st) => el('li', { class: st.done ? 'done' : '', 'data-done': st.done ? '1' : '0' }, `${st.done ? '✓' : '○'} `, st.space && extras.onGoStep && !st.done
        ? el('button', { type: 'button', class: 'starter-go', 'data-testid': 'starter-go', 'data-space': st.space, title: `「${workspaceOf(st.space).label}」 공간으로 갑니다`, onclick: () => extras.onGoStep(st) }, st.label)
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
  // 「지도 보기」 안내 한 줄: 하려는 일은 왼쪽 메뉴에서 고른다
  panel.append(el('p', { class: 'muted small goal-desc', 'data-testid': 'ws-desc' }, MAP_INTRO));
  // 일반 안내는 맨 아래 접힌 「처음이면 읽어 보세요」로(CR-21 C-3). 꼭지만 있는 빈 유니버스(새로 만든 직후)는 다음 행동을 알려야 하므로 펼쳐 둔다(검토5 U-5)
  const empty = s.node_total <= 1;
  panel.append(el('details', { class: 'overview-help', 'data-testid': 'overview-help', open: empty },
    el('summary', {}, '처음이면 읽어 보세요'),
    el('div', { class: 'hint', 'data-testid': 'hint' },
      empty
        ? el('p', {}, '아직 항목이 없습니다. 아래 「사람·업무·문서 추가」에서 첫 업무를 추가하세요. 업무정의서가 있으면 「지도 관리」 공간의 「가져오기·내보내기」로 밑그림을 만들 수도 있습니다.')
        : el('p', {}, '그래프에서 항목을 클릭하면 내용, 연결된 항목, 기록이 여기에 보입니다.'),
      empty ? null : el('p', {}, '왼쪽 메뉴에서 하려는 일을 고르세요. 「인수인계」의 「인수인계 초안 만들기」와 「매주 점검」의 「인사이트 보기」도 눌러 보세요.'),
      el('p', { class: 'muted small', 'data-testid': 'term-note' }, '업무 지도는 업무와 담당자·문서가 이어진 지도 한 장, 항목은 그 지도의 도형 하나, 지도 중심(연두색 큰 원)은 그 업무 지도 전체입니다.'))));
}

/** 「지도 보기」 안내 한 줄(CR-22 W). 공간 이름은 왼쪽 메뉴와 같다 */
export const MAP_INTRO = '그래프를 둘러보고 항목을 누르면 내용·연결·기록이 여기에 보입니다. 하려는 일은 왼쪽 메뉴에서 고르세요 — 기록 · 인수인계 · 매주 점검 · 지도 관리.';

// 「매주 점검」 앞부분: 묶은 지도의 위험 요약 한 줄(FU-10). 인사이트 「인수인계 위험」·「밀집·공백」 탭과 같은 계산의 숫자. 문구와 「자세히」 동작은 부르는 쪽이 정한다
function riskParts(extras) {
  const risk = [];
  if (!extras.riskSummary) return risk;
  const r = extras.riskSummary;
  risk.push(el('p', { class: 'risk-summary', 'data-testid': 'team-risk-summary' }, r.parts.join(' · '), ' ',
    el('button', { type: 'button', class: 'link', 'data-testid': 'btn-team-risk-more', onclick: r.onMore }, '자세히')));
  // 일 몰린 사람 이름(R13 FU8-19): 숫자만 있어 누구부터 볼지 알 수 없었다. 이름을 누르면 그 사람 카드(상위 몇 명만, 나머지는 「자세히」)
  if (r.dense && r.dense.rows.length) {
    const names = r.dense.rows.flatMap((p, i) => [i ? ', ' : null, el('button', { type: 'button', class: 'link', 'data-testid': 'team-risk-dense-person', 'data-gid': p.gid, title: `${p.label}의 카드를 엽니다`, onclick: () => r.dense.onPick(p.gid) }, `${p.label}(${p.count}개)`)]).filter(Boolean);
    risk.push(el('p', { class: 'risk-summary risk-dense', 'data-testid': 'team-risk-dense' }, '일 몰린 사람: ', ...names,
      r.dense.total > r.dense.rows.length ? el('span', { class: 'muted small' }, ` 외 ${r.dense.total - r.dense.rows.length}명 — 「자세히」에서 모두 봅니다`) : null));
  }
  // 지난 점검 대비(CR-18 D-3): 증감 한 줄과 「이번 점검 저장」. 기준은 이 브라우저 설정에만 있고 문서에는 들어가지 않는다
  if (r.compare) {
    risk.push(el('p', { class: 'risk-summary risk-compare', 'data-testid': 'team-risk-compare', 'data-has-baseline': r.compare.has ? 'true' : 'false' }, r.compare.text, ' ',
      r.compare.canSave ? el('button', { type: 'button', class: 'small-btn', 'data-testid': 'btn-risk-baseline-save', onclick: r.compare.onSave }, '이번 점검 저장') : null,
      // 「점검 요약 보기」(일상 사용 2회차 M2): 점검 요약(복사·내려받기·인쇄)이 인사이트 안에 있어 못 찾던 것 — 인사이트를 열어 그 줄로 간다
      r.compare.onSummary ? el('button', { type: 'button', class: 'small-btn', 'data-testid': 'btn-risk-summary-open', title: '인사이트를 열어 위쪽의 점검 요약 줄(복사·내려받기·인쇄)로 갑니다', onclick: r.compare.onSummary }, '점검 요약 보기') : null));
    // 무엇이 바뀌었는지(FU5-1): 저장해 둔 이름 목록이 있고 이름이 바뀐 것이 있을 때만 접힌 상자. 예전 기준(이름 없음)은 숫자만
    if (r.compare.changes || r.compare.ownerChanges) {
      risk.push(el('details', { class: 'risk-changes', 'data-testid': 'team-risk-changes' },
        el('summary', {}, '바뀐 것 보기'),
        // 담당이 바뀐 업무(M6): 저장한 기준의 업무별 담당 이름과 지금 담당이 다른 업무
        r.compare.ownerChanges ? el('div', { class: 'risk-change', 'data-testid': 'risk-change-owners' }, el('p', { class: 'small', 'data-testid': 'risk-change-owner' }, ownerChangesText(r.compare.ownerChanges))) : null,
        ...(r.compare.changes || []).map((c) => el('div', { class: 'risk-change', 'data-testid': 'risk-change', 'data-key': c.key },
          el('strong', {}, c.label),
          c.added.length ? el('p', { class: 'small', 'data-testid': 'risk-change-added' }, `늘어남: ${namesText(c.added)}`) : null,
          c.removed.length ? el('p', { class: 'small', 'data-testid': 'risk-change-removed' }, `줄어듦: ${namesText(c.removed)}`) : null,
          c.addedUnknown ? el('p', { class: 'muted small' }, NAMES_CUT_NOTE) : null))));
    }
    // 저장 직후 알림(FU5-2)
    if (r.compare.savedNote) risk.push(el('p', { class: 'notice', role: 'status', 'data-testid': 'risk-baseline-saved' }, r.compare.savedNote));
  }
  return risk;
}

// 「지도 관리」 뒷부분: 사번 충돌은 접힌 한 줄로(FU-13): 열자마자 노란 경고가 길게 보이면 무서우므로 「사번 확인 필요 n건」만 먼저 보이고, 펼치면 예전 내용 그대로
function fixParts(s) {
  const fixes = [];
  if (s.empno_conflicts.length) {
    fixes.push(el('details', { class: 'conflict-fold', 'data-testid': 'empno-conflicts' },
      el('summary', { class: 'notice', 'data-testid': 'empno-conflicts-summary' }, `사번 확인 필요 ${s.empno_conflicts.length}건`),
      ...s.empno_conflicts.map((c) => el('p', { class: 'notice', 'data-testid': 'empno-conflict' }, `확인할 것: 사번 충돌 — ${c.emp_no}가 서로 다른 이름으로 있습니다(${c.nodes.map((n) => `${n.label}·${n.universe_name}`).join(', ')}). 자동으로 합치지 않았으니 같은 사람인지 확인해 주세요.`))));
  }
  if (s.stale_links.length) fixes.push(el('p', { class: 'notice', 'data-testid': 'stale-links' }, `사번이 바뀌어 더는 맞지 않는 사번 자동 연결 ${s.stale_links.length}건은 합치지 않았습니다. 「통합 확인 목록」에서 같은 사람인지 다시 골라 주세요.`));
  return fixes;
}
