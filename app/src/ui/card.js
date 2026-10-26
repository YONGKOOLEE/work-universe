// 항목 카드 그리기(CR-22 K). 값은 view/card.js(cardData·groupLinks·historyRows 등)가 만들고, 여기서는 DOM으로 옮기기만 한다.
// 모양: 이름+유형 칩 → 상태 줄 → 고정 동작 줄 하나 → 「지금 볼 것」 → 「기록」 최근 3줄만 펼침 + 나머지 묶음(내용·담당·산출물·앞뒤 업무·알림·관리)은 머리글 한 줄+건수로 접어 둠(사용자 의견 10-26 저녁).
// 단추의 동작(편집 상태 바꾸기·저장)은 main.js가 만들어 넘기는 요소·함수가 한다 — 이 파일은 저장소·편집 상태를 모른다.
import { el } from './dom.js';
import { deadlineLeft, groupLinks, groupOpen, historyPreview, isLongValue, issueSplitText, limitItems } from '../view/card.js';

/** 알림 한 개의 짧은 이름(알림 묶음 머리 미리보기와 상태 줄 칩) */
export const ALERT_LABEL = { 'work-load': '담당 공백', 'person-load': '일 몰림', 'person-solo-works': '혼자만 아는 일', 'repeat-note': '반복 비효율', 'risk-note': '혼자만 아는 일' };

// 접는 묶음 하나. o: {key, title, count?, preview?, dflt(기본 펼침 여부), force?(늘 펼침), state, id?, summaryAttrs?, cls?}
function group(o, ...body) {
  const attrs = { class: `card-group${o.cls ? ` ${o.cls}` : ''}`, 'data-testid': `card-group-${o.key}`, 'data-group': o.key };
  const open = !!o.force || o.state.isOpen(o.key, o.dflt); // 기본값(dflt)은 줄 수로 정해지고, 사용자가 바꾼 값이 있으면 그것
  if (open) attrs.open = true;
  const d = el('details', attrs,
    el('summary', o.summaryAttrs || {}, el('b', { class: 'cg-title' }, o.title), o.count !== undefined && o.count !== null ? el('span', { class: 'cg-count' }, String(o.count)) : null, o.preview ? el('span', { class: 'cg-preview' }, o.preview) : null),
    el('div', { class: 'cg-body' }, ...body));
  // 사용자가 기본값과 다르게 바꾼 것만 기억한다(기본값은 줄 수에 따라 다시 정해진다)
  d.addEventListener('toggle', () => { if (!o.force) o.state.setOpen(o.key, d.open, o.dflt); });
  return d;
}

// 모두 n개 단추를 가진 목록 영역. draw(all)이 줄 요소 배열과 총 개수를 돌려준다
function limitedList(key, state, items, drawItem, wrapTag = 'ul', wrapAttrs = {}) {
  const wrap = el('div', { class: 'cg-list', 'data-list': key });
  const draw = () => {
    const { shown, rest } = limitItems(items, state.isAll(key));
    wrap.replaceChildren(...[
      el(wrapTag, wrapAttrs, ...shown.map(drawItem)),
      rest ? el('button', { type: 'button', class: 'link cg-more', 'data-testid': 'group-all', 'data-group': key, onclick: () => { state.setAll(key); draw(); } }, `모두 ${items.length}개`) : null,
    ].filter(Boolean)); // replaceChildren(null)은 「null」 글자를 넣는다
  };
  draw();
  return wrap;
}

// 연결 한 줄(예전 상세의 줄 모양 그대로: 관계 칩·방향·이름·유형·상태·기간·메모·연결 수정/숨기기)
function linkItem(l, o) {
  return el('li', {},
    el('span', { class: 'chip' }, l.relation),
    el('span', { class: 'arrow', title: l.direction === 'out' ? '이 항목에서 나가는 연결' : '이 항목으로 들어오는 연결' }, l.direction === 'out' ? '→' : '←'),
    el('button', { type: 'button', class: 'link', onclick: () => o.onFocus(l.other.gid) }, l.other.label),
    el('span', { class: 'muted small' }, ` ${l.other.type_label}`),
    l.status ? el('span', { class: `chip status-${l.status_key === 'current' ? 'current' : 'other'}`, title: l.status_key === 'handover' ? '이 날 다른 사람이 담당을 이어받았습니다. 인사이트·초안을 셀 때는 이 날까지 담당으로 봅니다' : null, 'data-testid': 'link-status' }, l.status) : null,
    l.period ? el('div', { class: 'muted small' }, l.period) : null,
    l.note ? el('div', { class: 'muted small' }, l.note) : null,
    o.linkTools(l),
  );
}

// 이력 한 줄(예전 모양 그대로 + 최신이 위)
function historyItem(h, justAdded) {
  const attrs = { ...(h.after ? { class: 'after', title: '기준일 이후의 이력' } : {}), 'data-ev-gid': h.gid, ...(justAdded && justAdded.includes(h.gid) ? { 'data-just-added': '1' } : {}) };
  // 종류 칩과 같은 글이면 한쪽만(R12 FU7-14: 「생성 / 생성」 반복)
  return el('li', attrs, el('time', {}, h.date), el('span', { class: 'chip' }, h.type_label), h.text === h.type_label ? null : el('span', { class: 'text' }, h.text));
}

// 속성 표(예전 「속성」 dl). 긴 값(절차·주의사항 등)은 한 번 더 접는다
function attrsList(rows) {
  const dl = el('dl', { 'data-testid': 'attrs' });
  for (const r of rows) {
    dl.append(el('dt', {}, r.label), el('dd', {}, isLongValue(r.value)
      ? el('details', { class: 'long-value', 'data-testid': 'long-value' }, el('summary', {}, `${String(r.value).slice(0, 24).replace(/\s+/g, ' ')}…`), el('p', {}, r.value))
      : r.value));
  }
  return dl;
}

// 위 띠 아래의 이름 줄: 이름(h2는 이름만) + 유형 칩
function titleRow(d) {
  const kind = (d.rows.find((r) => r.label === '유형') || {}).value || '';
  return el('div', { class: 'card-title' }, el('h2', {}, d.title), kind ? el('span', { class: 'chip type-chip', 'data-testid': 'card-type' }, kind) : null);
}

const issueButton = (c, o) => {
  const s = c.issues;
  if (!s.total) return el('span', { class: 'muted', 'data-testid': 'issue-count', 'data-count': '0' }, '미해결 0건');
  const split = issueSplitText(s);
  return el('span', { class: 'st-warn', 'data-testid': 'issue-count', 'data-count': String(s.total) },
    el('button', { type: 'button', class: 'link', 'data-testid': 'btn-issues', onclick: o.onOpenIssues }, `미해결 ${s.total}건`),
    split ? el('span', { class: 'muted small', 'data-testid': 'issue-split' }, ` (${split})`) : null);
};

// 업무 상태 줄: 담당(이름은 눌러 사람 카드로)·미해결·경고 칩·마감
function workState(c, o) {
  const items = [];
  const label = c.past ? `${c.asOf} 기준 담당` : '담당';
  if (c.load && c.owners && c.owners.length) {
    const shown = c.owners.map((p) => p.label).join(', ');
    const tail = c.holdersText && c.holdersText.startsWith(shown) ? c.holdersText.slice(shown.length).trim() : '';
    items.push(el('span', { class: 'st-owner', 'data-testid': 'card-owner', title: c.holdersText }, `${label} `,
      ...c.owners.flatMap((p, i) => [i ? ', ' : null, el('button', { type: 'button', class: 'link', 'data-testid': 'owner-link', onclick: () => o.onFocus(p.gid) }, p.label), p.contact ? el('span', { class: 'muted small', 'data-testid': 'owner-contact' }, `(${p.contact})`) : null]),
      tail ? el('span', { class: 'muted small' }, ` ${tail}`) : null));
  } else if (c.load) {
    items.push(el('span', { class: c.gap ? 'chip warn' : 'muted', 'data-testid': 'card-owner', title: c.loadText }, c.gap ? `⚠ ${c.loadText.split(' — ')[0] === '공백' ? '담당 공백' : c.loadText}` : c.loadText));
  }
  if (c.issues) items.push(issueButton(c, o));
  for (const a of o.alertChips) items.push(el('button', { type: 'button', class: 'chip warn chip-btn', 'data-testid': 'state-chip', 'data-note': a.testid, title: `${a.text} — 눌러서 「알림」을 엽니다`, onclick: () => o.onShowAlerts() }, `⚠ ${a.label}`));
  if (c.deadline) items.push(el('span', { class: 'st-deadline', 'data-testid': 'card-deadline' }, `마감 ${c.deadline}`));
  return items;
}

// 사람 상태 줄: 소속·사번·연락처 · 지금 맡은 업무 n · 혼자만 아는 일 n(지금 맡은 것 중)
function personState(c, d, o = {}) {
  const row = (label) => (d.rows.find((r) => r.label === label) || {}).value || '';
  const who = [row('소속(기준일)'), row('사번'), c.contact].filter(Boolean).join(' · ');
  const items = [];
  if (who) items.push(el('span', { class: 'muted', 'data-testid': 'card-who' }, who));
  // 연락처가 비면 비었다고 알린다(R11 FU6-8: 위험 목록에서 사람을 열었는데 연락할 길이 없는 것이 안 보이던 곳). 고칠 수 있는 지도면 어디서 넣는지 한 줄
  if (!c.contact) {
    items.push(el('span', { class: 'chip warn', 'data-testid': 'card-no-contact' }, '연락처 없음'));
    if (o.editable) items.push(el('span', { class: 'muted small', 'data-testid': 'card-no-contact-hint' }, '「⋯」 → 「수정」에서 연락처를 넣을 수 있습니다'));
  }
  if (c.hasAssignments) {
    items.push(el('span', { 'data-testid': 'card-person-count' }, `${c.past ? `${c.asOf} 기준 ` : '지금 '}맡은 업무 `, el('b', {}, String(c.count))));
    if (c.solo) items.push(el('span', { class: 'st-warn', 'data-testid': 'card-person-solo' }, el('b', {}, `혼자만 아는 일 ${c.solo}`), el('span', { class: 'muted small' }, ' (지금 맡은 것 중)')));
  }
  return items;
}

// 산출물·주제·조직 상태 줄: 위치·만든 업무·쓰는 업무 수 / 관련 업무 수 / 소속 사람 수
function otherState(d, o) {
  const t = d.core_type;
  const attr = (k) => (d.rows.find((r) => r.label === k) || {}).value || '';
  const workLinks = d.links.filter((l) => l.other.type_label === '업무');
  const items = [];
  if (t === 'artifact') {
    const made = d.links.find((l) => l.relation_type === 'produces' && l.direction === 'in');
    if (attr('위치')) items.push(el('span', { class: 'muted', 'data-testid': 'card-where' }, `위치 ${attr('위치')}`));
    if (made) items.push(el('span', {}, '만든 업무 ', el('button', { type: 'button', class: 'link', onclick: () => o.onFocus(made.other.gid) }, made.other.label)));
    const uses = workLinks.filter((l) => l !== made).length;
    if (uses) items.push(el('span', { class: 'muted' }, `쓰는 업무 ${uses}`));
  } else if (t === 'topic') {
    items.push(el('span', {}, `관련 업무 ${workLinks.length}`));
  } else if (t === 'org') {
    items.push(el('span', {}, `소속 사람 ${d.links.filter((l) => l.other.type_label === '사람').length}`));
  }
  return items;
}

// 눌렀을 때 도착한 자리를 잠깐 강조(CSS goal-flash). 화면 밖으로 가려진 자리면 스크롤
function arrive(node, ms = 1800) {
  if (!node) return;
  if (typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'center' });
  node.classList.add('goal-flash');
  setTimeout(() => { if (node.classList && node.classList.remove) node.classList.remove('goal-flash'); }, ms);
}

// 알림 한 개를 「지금 볼 것」 줄로 쓸 때의 말: [무엇이 있다, 눌러서 무엇을 하나]. 판정은 알림 쪽 계산 그대로이고 여기는 글만이다
const ALERT_NOW = {
  'work-load': ['담당 공백', '어디가 비었나 보기'],
  'person-load': ['일이 몰려 있음', '맡은 업무 보기'],
  'person-solo-works': ['혼자만 아는 일', '어떤 일인지 보기'],
  'repeat-note': ['반복 비효율', '무엇이 반복되나 보기'],
  'risk-note': ['인수인계 기록 없음', '인수인계서 만들기'],
};

// 「지금 볼 것」 한 줄: 무엇이 있는지 + 누르면 무엇을 하는지(동사). 누르면 그 자리로 간다
function nowLine(testid, head, verb, onclick, extra = {}) {
  return el('div', { class: 'now-item now-go', 'data-testid': testid, ...extra },
    el('button', { type: 'button', class: 'link now-btn', onclick }, el('span', {}, head), el('span', { class: 'now-verb' }, ` — ${verb} →`)));
}

// 「지금 볼 것」: 줄마다 동사로 쓰고 누르면 그 자리로 간다. 미해결(+ 해결 단추), 마감, 알림, 최근 기록 1건
// 무엇이 나오는지는 예전 계산 그대로다(새 판정 없음) — 바뀐 것은 글과 이동뿐
function nowBlock(c, o) {
  const rows = [];
  // 미해결 머리 줄은 아래에 다 보이지 않을 때만(줄마다 이미 누를 수 있다 — 메인 화면 확인 10-26 저녁: 같은 말이 두 번)
  if (c.issues && c.issues.total > (c.now || []).length) {
    const first = (c.now || [])[0];
    rows.push(nowLine('now-issues-head', `미해결 ${c.issues.total}건`, '모두 보기', () => (first ? o.seeRecord(first.gid) : o.seeRecord(null))));
  }
  for (const it of c.now || []) {
    rows.push(el('div', { class: 'now-item', 'data-testid': 'now-issue', 'data-gid': it.gid },
      el('span', { class: 'chip warn' }, it.category), el('span', { class: 'muted small' }, it.date),
      el('button', { type: 'button', class: 'link now-text', title: `${it.note} — 누르면 기록의 그 줄로 갑니다`, onclick: () => o.seeRecord(it.gid) }, it.text),
      o.canResolve ? el('button', { type: 'button', class: 'small-btn', 'data-testid': 'now-resolve', title: '이 일이 끝났나요? 누르면 이 메모 한 건을 해결로 표시합니다(원래 메모는 그대로 남고 「해결됨」 메모가 이력에 더해집니다)', onclick: () => o.onResolve(it.gid) }, '해결') : null));
  }
  // 마감은 카드 맨 위 상태 줄에도 있다 — 남은 날수를 셀 수 있을 때만 여기 한 줄 더(날짜가 아닌 글이면 겹치기만 한다)
  const left = c.deadline && !c.past ? deadlineLeft(c.deadline, c.asOf) : '';
  if (left) {
    rows.push(el('div', { class: 'now-item', 'data-testid': 'now-deadline' }, el('span', {}, `마감 ${c.deadline}`), el('span', { class: 'now-left' }, ` · ${left}`)));
  }
  for (const a of o.alertRows) {
    const [head, verb] = ALERT_NOW[a.testid] || [a.label, '보기'];
    rows.push(nowLine('now-alert', head, verb, a.testid === 'risk-note' && o.onDraft ? () => o.onDraft() : () => o.onShowAlert(a.testid), { 'data-note': a.testid }));
  }
  if (c.latest) {
    rows.push(el('div', { class: 'now-item now-go', 'data-testid': 'now-recent' },
      el('span', { class: 'chip' }, '최근 기록'), el('span', { class: 'muted small' }, c.latest.date),
      el('button', { type: 'button', class: 'link now-text', title: '누르면 기록의 그 줄로 갑니다', onclick: () => o.seeRecord(c.latest.gid) }, `${c.latest.type_label !== '메모' ? `[${c.latest.type_label}] ` : ''}${c.latest.text}`)));
  }
  if (!rows.length) return null;
  return el('section', { class: 'card-now', 'data-testid': 'card-now' }, el('h3', {}, '지금 볼 것'),
    el('p', { class: 'muted small now-hint', 'data-testid': 'now-hint' }, '누르면 그 자리로 갑니다'), ...rows);
}

// 사람 카드 「최근 기록」(위쪽 「지금 볼 것」 자리)
function recentBlock(c) {
  if (!c.latest) return null;
  return el('section', { class: 'card-now', 'data-testid': 'card-now' }, el('h3', {}, '최근 기록'),
    el('div', { class: 'now-item', 'data-testid': 'now-recent' }, el('span', { class: 'chip' }, c.latest.type_label), el('span', { class: 'muted small' }, c.latest.date), el('span', { class: 'now-text' }, c.latest.text)));
}

// 사람 카드 「지금 맡은 업무」 표
function personWorks(c, o) {
  const state = o.state;
  const wrap = el('div', { class: 'cg-list', 'data-list': 'person-works' });
  const draw = () => {
    const { shown, rest } = limitItems(c.personRows, state.isAll('person-works'));
    wrap.replaceChildren(...[
      el('table', { class: 'works-table', 'data-testid': 'person-works' },
        el('thead', {}, el('tr', {}, el('th', {}, '업무'), el('th', {}, '미해결'), el('th', {}, '위험'), el('th', {}, '마감'))),
        el('tbody', {}, ...shown.map((r) => el('tr', { 'data-testid': 'person-work-row', 'data-gid': r.gid },
          el('td', {}, el('button', { type: 'button', class: 'link', onclick: () => o.onFocus(r.gid) }, r.label)),
          el('td', { class: r.open ? 'num warn' : 'num muted' }, r.open ? String(r.open) : '-'),
          el('td', {}, r.solo ? el('span', { class: 'chip warn', title: '이 사람 한 명만 해 본 업무입니다(인수인계 위험 탭 ①과 같은 계산)' }, '혼자만 아는 일') : null),
          el('td', { class: 'muted small' }, r.deadline))))),
      rest ? el('button', { type: 'button', class: 'link cg-more', 'data-testid': 'group-all', 'data-group': 'person-works', onclick: () => { state.setAll('person-works'); draw(); } }, `모두 ${c.personRows.length}개`) : null,
    ].filter(Boolean));
  };
  draw();
  return wrap;
}

/**
 * 항목 카드를 panel에 그린다(root가 아닌 항목).
 * @param {object} d describeNode 결과(found)
 * @param {object} c cardData 결과
 * @param {object} o main.js가 넘기는 것:
 *   onFocus(gid), linkTools(link), justAdded(gid[]|null), state{isOpen,setOpen,isAll,setAll},
 *   actions{primary:Element[], more:Element[]}, forms:Element[](처음엔 숨김, 「담당 넘기기」·「협업자 추가」 단추가 연다),
 *   notes{alerts:{testid,label,el}[], workLoad, personLoad, form, backup}, layer(관리 묶음에 넣을 요소), canResolve, onResolve(gid), onOpenIssues(), onHistoryAll(button)
 */
export function renderCard(panel, d, c, o) {
  const type = d.core_type;
  const alerts = o.notes.alerts || [];
  const alertChips = alerts.filter((a) => a.chip).map((a) => ({ testid: a.testid, label: a.label, text: a.el.textContent }));
  let alertsGroup = null;
  let historyGroup = null;
  const showAlerts = () => {
    if (!alertsGroup) return;
    alertsGroup.open = true;
    if (typeof alertsGroup.scrollIntoView === 'function') alertsGroup.scrollIntoView({ block: 'nearest' });
  };
  // 「지금 볼 것」 줄: 알림 묶음을 펼치고 그 알림 글로 간다
  const showAlert = (testid) => {
    const a = alerts.find((x) => x.testid === testid);
    if (!alertsGroup || !a) return;
    alertsGroup.open = true;
    arrive(a.el);
  };
  // 「지금 볼 것」 줄: 기록 묶음을 펼치고 그 기록 줄(gid)로 간다. 줄이 처음 3건 밖이면 상세를 다시 그려 보이게 하고(o.onShowRecord), 이 항목의 기록이 아니면(같은 주제의 다른 업무 메모) 미해결 목록으로
  const seeRecord = (gid) => {
    const rowsAll = c ? c.rows : [];
    const li = gid ? [...root.querySelectorAll('li')].find((x) => x.getAttribute('data-ev-gid') === gid) : null;
    if (li && historyGroup) {
      historyGroup.open = true;
      return arrive(li);
    }
    if (gid && o.onShowRecord && rowsAll.some((r) => r.gid === gid)) return o.onShowRecord(gid);
    if (historyGroup && !gid) {
      historyGroup.open = true;
      return arrive(historyGroup);
    }
    return o.onOpenIssues();
  };
  const ctx = { ...o, alertChips, alertRows: alerts.map((a) => ({ testid: a.testid, label: a.label })), onShowAlerts: showAlerts, onShowAlert: showAlert, seeRecord };

  const root = el('div', { class: 'item-card', 'data-testid': 'item-card', 'data-type': type });
  // 머리: 이름 + 유형 칩, 상태 줄
  root.append(titleRow(d));
  if (d.hidden) root.append(el('p', { class: 'notice', 'data-testid': 'hidden-note' }, d.deleted ? '완전히 삭제된 항목입니다. 내용은 지워졌고, 이 항목을 언급한 이력만 남아 있습니다.' : '숨김 처리된 항목입니다. 내용과 이력은 유지됩니다.'));
  const stateItems = !c ? [] : type === 'work' ? workState(c, ctx) : type === 'person' ? personState(c, d, ctx) : otherState(d, ctx);
  if (stateItems.length) root.append(el('div', { class: 'card-state', 'data-testid': 'card-state' }, ...stateItems));

  // 고정 동작 줄 하나(+ 숨겨 둔 양식 칸)
  const { primary, more } = o.actions;
  if (primary.length || more.length) {
    const actions = el('div', { class: 'row toolbar card-actions', 'data-testid': 'card-actions' }, ...primary);
    if (more.length) {
      actions.append(el('details', { class: 'more-tools', 'data-testid': 'more-tools' },
        el('summary', { title: '수정·연결 추가·협업자 추가·기록(이력)으로·주변만 보기·인사이트·숨기기 같은 나머지', 'aria-label': '더 보기' }, '⋯'),
        el('div', { class: 'menu toolbar-more' }, ...more)));
    }
    root.append(actions);
  }
  if (o.forms.length) root.append(el('div', { class: 'card-forms', 'data-testid': 'card-forms', hidden: true }, ...o.forms));
  if (o.afterActions && o.afterActions.length) root.append(...o.afterActions);

  const sections = [];
  const now = c && type === 'work' ? nowBlock(c, ctx) : type === 'person' && c ? recentBlock(c) : null;
  if (now) sections.push(now);

  // 내용
  const contentExtra = [o.notes.form].filter(Boolean);
  const contentGroup = group({ key: 'content', title: '내용', count: `${d.rows.length}칸`, preview: contentPreview(d), dflt: false, state: o.state }, attrsList(d.rows), ...contentExtra);

  // 사람 전용 묶음
  const personGroups = [];
  if (type === 'person' && c && c.hasAssignments) {
    personGroups.push(group({ key: 'person-works', title: '지금 맡은 업무', count: c.count, preview: c.personRows.some((r) => r.solo || r.open) ? '위험·미해결 많은 것 먼저' : '', dflt: false, state: o.state },
      o.notes.personLoad || null, c.personRows.length ? personWorks(c, ctx) : el('p', { class: 'muted small' }, '지금 맡은 업무 없음')));
    if (c.pastRows.length) {
      personGroups.push(group({ key: 'person-past', title: '지난 업무', count: c.pastRows.length, preview: `${c.pastRows[0].label}${c.pastRows.length > 1 ? ' 외' : ''}`, dflt: false, state: o.state },
        limitedList('person-past', o.state, c.pastRows, (r) => el('li', {}, el('button', { type: 'button', class: 'link', onclick: () => o.onFocus(r.gid) }, r.label), el('span', { class: 'muted small' }, r.scheduled ? ' 시작 예정' : r.end ? ` ~ ${r.end}` : '')), 'ul', { class: 'links' })));
    }
  }

  // 연결 묶음. 예전 `links` 목록의 시험 이름을 그대로 쓰도록 묶음 전체를 data-testid=links 상자로 감싼다
  const linkGroups = groupLinks(type, d.links).map((g) => {
    const dflt = groupOpen(g.items.length);
    const first = g.key === 'assign' && o.notes.workLoad ? o.notes.workLoad : null;
    return group({ key: g.key, title: g.key === 'links' ? '연결된 항목' : g.label, count: g.items.length, preview: g.preview, dflt: type === 'person' ? false : dflt, state: o.state },
      first, limitedList(g.key, o.state, g.items, (l) => linkItem(l, ctx), 'ul', { class: 'links' }));
  });
  const linksBox = d.no_links
    ? el('p', { class: 'muted', 'data-testid': 'no-links' }, '연결 없음')
    : el('div', { class: 'card-links', 'data-testid': 'links' }, ...linkGroups);
  // 담당 줄(업무의 현재 담당 한 줄)이 담당 묶음이 없을 때도 보이게: 담당 연결이 하나도 없으면 연결 상자 앞에 둔다
  const workLoadLoose = type === 'work' && o.notes.workLoad && !d.links.some((l) => l.relation_type === 'performs') ? o.notes.workLoad : null;

  // 기록(이력): 최신이 위, 5개 + 「모두 보기 →」
  const rows = c ? c.rows : [];
  const prev = historyPreview(rows, o.justAdded);
  const historyBody = !rows.length
    ? [el('p', { class: 'muted', 'data-testid': 'no-history' }, '기록된 이력 없음')]
    : [el('ol', { class: 'history', 'data-testid': 'history' }, ...prev.shown.map((h) => historyItem(h, o.justAdded))),
      // 방금 기록한 줄이 최신 5건보다 옛 날짜면 따로 한 줄(강조·스크롤이 닿게)
      prev.extra ? el('p', { class: 'muted small history-gap' }, '방금 기록한 줄(옛 날짜)') : null,
      prev.extra ? el('ol', { class: 'history history-extra', 'data-testid': 'history-extra' }, historyItem(prev.extra, o.justAdded)) : null,
    el('p', { class: 'muted small history-foot', 'data-testid': 'history-count' }, `최신이 위 · ${rows.length}건`, ' ',
      prev.rest > 0 || prev.extra ? el('button', { type: 'button', class: 'link', 'data-testid': 'history-all', onclick: (e) => o.onHistoryAll(e.currentTarget) }, '기록 모두 보기 →') : null)];
  const hasJust = o.justAdded && rows.some((r) => o.justAdded.includes(r.gid));
  historyGroup = group({ key: 'history', title: '기록(이력)', count: rows.length, preview: rows.length ? '최신이 위' : '', dflt: true, force: hasJust, state: o.state,
    summaryAttrs: { id: 'history-heading', tabindex: '-1', 'data-testid': 'history-heading' } }, ...historyBody);

  // 알림 · 관리
  alertsGroup = alerts.length
    ? group({ key: 'alerts', title: '알림', count: `${alerts.length}개`, preview: alerts.map((a) => a.label).join(' · '), dflt: groupOpen(alerts.length), state: o.state }, ...alerts.map((a) => a.el))
    : null;
  const manageGroup = o.layer ? group({ key: 'manage', title: '관리', preview: '다른 지도에서도 보이기 등', dflt: false, state: o.state }, o.layer) : null;

  // 순서: 업무·그 밖 = 내용 → 연결 → 기록 → 알림 → 관리 / 사람 = 맡은 업무·지난 업무·누가 대신·알림 → 연결 → 기록 → 내용
  if (type === 'person') {
    sections.push(...personGroups, o.notes.backup, alertsGroup, linksBox, historyGroup, contentGroup, manageGroup);
  } else {
    sections.push(contentGroup, workLoadLoose, linksBox, historyGroup, alertsGroup, manageGroup);
  }
  root.append(...sections.filter(Boolean));
  panel.append(root);
}

function contentPreview(d) {
  const skip = new Set(['유형', '출처']);
  return d.rows.filter((r) => !skip.has(r.label) && !isLongValue(r.value)).slice(0, 2).map((r) => `${r.label} ${String(r.value).slice(0, 14)}`).join(' · ');
}
