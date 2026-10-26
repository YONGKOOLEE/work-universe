// 항목 카드(CR-22 K)의 순수 계산. 화면(DOM)·저장소를 쓰지 않는다 — Node 단위 시험으로 검증한다.
// 새 판정을 만들지 않는다: 담당 상태는 rules/insight.js의 workLoad·personLoad, 미해결은 rules/issues.js·handover.js, 혼자만 아는 일은 view/risk-summary.js를 그대로 쓴다.
// 이 파일이 하는 일은 (1) 연결을 묶음으로 나누고 줄 세우기, (2) 이력을 최신순으로 거르고 쪽 나누기, (3) 상태 줄·「지금 볼 것」·사람 카드 표의 값 모으기, (4) 유형별 동작 줄 구성이다.

import { MEMO_CATEGORIES, USER_EVENT_TYPES, memoCategoryOf } from '../model/schema.js';
import { currentHoldersText, edgeStatus } from './describe.js';
import { contactOf, openMemosOf } from '../rules/handover.js';
import { OPEN_CATEGORIES, memoTarget, openMemos } from '../rules/issues.js';
import { personLoad, workLoad } from '../rules/insight.js';
import { soloWorksOf } from './risk-summary.js';

// 바꾸기 쉬운 값은 한 곳에(연속 진행 모드 원칙)
export const CARD = {
  LIST_MAX: 5, // 묶음을 펼쳐도 처음 보이는 줄 수(그 위는 「모두 n개」)
  HISTORY_SHOWN: 3, // 카드 첫 화면 「기록」에 보이는 최근 줄 수(나머지는 「기록 모두 보기」). 예전 5
  OPEN_MAX: 0, // 이 줄 수 이하인 묶음은 기본 펼침. 0 = 건수가 있는 묶음은 모두 접어 두고 머리글 한 줄+건수만 보인다(사용자 의견 10-26 저녁: 카드 첫 화면은 요약만). 예전 값 5
  NOW_ISSUES: 2, // 「지금 볼 것」의 미해결 건수
  TEXT_CLIP: 46, // 「지금 볼 것」 줄의 내용 앞부분 글자 수
  LONG_VALUE: 80, // 이 글자 수를 넘는 속성 값은 한 번 더 접는다(절차·주의사항 등)
  HISTORY_PAGE: 20, // 이력 표의 한 쪽 줄 수
};

const clip = (text, max) => {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
};
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byLabel = (a, b) => String(a.other.label).localeCompare(String(b.other.label), 'ko');

// ── 1. 연결 묶음 ──────────────────────────────────────────────────────────

/** 수행 연결의 줄 세우기 값: 지금(0) → 예정(1) → 지난(2). 넘김(오늘까지)은 아직 지금이다 */
const assignRank = (l) => {
  if (l.status_key === 'current' || l.status_key === 'handover') return 0;
  if (l.status_key === 'scheduled') return 1;
  if (l.status_key === 'ended') return 2;
  // 기준일이 없어 상태 표시가 없으면 기간으로: 시작 전이면 예정, 끝이 있으면 지난, 아니면 지금
  return l.period_end ? 2 : 0;
};

/**
 * 담당(수행) 연결 줄 세우기: 지금 → 예정 → 지난. 지난 것은 끝난 날이 최신인 것부터, 지금·예정은 이름순(예정은 시작이 빠른 것부터).
 * 같으면 이름순이라 늘 같은 순서다. 입력을 바꾸지 않는다
 */
export function sortAssignLinks(links) {
  return [...links].sort((a, b) => {
    const ra = assignRank(a);
    const rb = assignRank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 2) return cmp(b.period_end || '', a.period_end || '') || byLabel(a, b);
    if (ra === 1) return cmp(a.period_start || '', b.period_start || '') || byLabel(a, b);
    return byLabel(a, b);
  });
}

const isTopic = (l) => l.other.type_label === '주제';

/**
 * 연결을 카드 묶음으로 나눈다. 비어 있는 묶음은 돌려주지 않는다.
 * - 업무: 담당(수행) · 산출물(산출) · 앞뒤 업무·관련 주제·기타 연결
 * - 그 밖의 유형: 「연결」 하나(관계 순서 그대로)
 * 한 연결은 한 묶음에만 든다. 사람 카드의 지금·지난 담당은 따로 표로 그리므로 여기서는 수행 연결도 「연결」에 둔다.
 * @returns {{key:string,label:string,items:object[],preview:string,parts?:object}[]}
 */
export function groupLinks(coreType, links) {
  if (coreType !== 'work') return links.length ? [{ key: 'links', label: '연결', items: links, preview: previewOf(links) }] : [];
  const assign = sortAssignLinks(links.filter((l) => l.relation_type === 'performs'));
  const outputs = links.filter((l) => l.relation_type === 'produces').sort((a, b) => String(b.other.label).localeCompare(String(a.other.label), 'ko'));
  const rest = links.filter((l) => l.relation_type !== 'performs' && l.relation_type !== 'produces');
  const before = rest.filter((l) => l.relation_type === 'precedes' && l.direction === 'in').sort(byLabel);
  const after = rest.filter((l) => l.relation_type === 'precedes' && l.direction === 'out').sort(byLabel);
  const topics = rest.filter((l) => l.relation_type === 'relates_to' && isTopic(l)).sort(byLabel);
  const used = new Set([...before, ...after, ...topics]);
  const etc = rest.filter((l) => !used.has(l));
  const around = [...before, ...after, ...topics, ...etc];
  const out = [];
  if (assign.length) out.push({ key: 'assign', label: '담당', items: assign, preview: assignPreview(assign) });
  if (outputs.length) out.push({ key: 'outputs', label: '산출물', items: outputs, preview: `최근: ${outputs[0].other.label}` });
  if (around.length) {
    const parts = { before: before.length, after: after.length, topics: topics.length, etc: etc.length };
    out.push({ key: 'around', label: '앞뒤 업무·관련 주제', items: around, preview: aroundPreview(parts), parts });
  }
  return out;
}

function assignPreview(items) {
  const n = (r) => items.filter((l) => assignRank(l) === r).length;
  return [n(0) ? `지금 ${n(0)}` : '', n(1) ? `예정 ${n(1)}` : '', n(2) ? `지난 ${n(2)}` : ''].filter(Boolean).join(' · ');
}

function aroundPreview(p) {
  return [p.before + p.after ? `앞뒤 업무 ${p.before + p.after}` : '', p.topics ? `관련 주제 ${p.topics}` : '', p.etc ? `기타 연결 ${p.etc}` : ''].filter(Boolean).join(' · ');
}

function previewOf(items) {
  const rel = new Map();
  for (const l of items) rel.set(l.relation, (rel.get(l.relation) || 0) + 1);
  return [...rel].map(([k, v]) => `${k} ${v}`).join(' · ');
}

/** 묶음의 기본 펼침 여부: 줄 수가 OPEN_MAX 이하면 펼친다. 사용자가 직접 바꾼 값(override)이 있으면 그것 */
export const groupOpen = (count, override = undefined) => (typeof override === 'boolean' ? override : count <= CARD.OPEN_MAX);

/** 묶음에서 처음 보이는 줄과 남은 수. all이 참이면 모두 */
export function limitItems(items, all = false, max = CARD.LIST_MAX) {
  if (all || items.length <= max) return { shown: items, rest: 0 };
  return { shown: items.slice(0, max), rest: items.length - max };
}

/** 속성 값 한 칸이 길어서 한 번 더 접어야 하는가 */
export const isLongValue = (v) => String(v).length > CARD.LONG_VALUE;

// ── 2. 이력 ──────────────────────────────────────────────────────────────

/** 이력 표의 범주 칩(전체는 거르지 않음) */
export const HISTORY_GROUPS = ['메모', '담당', '인수인계', '수정', '해결'];
export const HISTORY_PERIODS = ['올해', '작년', '전체'];

/** 이력 한 줄의 범주: 해결됨 메모 → 해결, 그 밖의 메모 → 메모, 담당 시작·종료 → 담당, 인수인계 → 인수인계, 나머지(생성·수정·숨김·소속 변경) → 수정 */
export function historyGroupOf(type, category = null) {
  if (type === 'memo') return category === 'resolved' ? '해결' : '메모';
  if (type === 'assign_start' || type === 'assign_end') return '담당';
  if (type === 'handover') return '인수인계';
  return '수정';
}

/**
 * 이력 줄의 상태 글: 아직 닫히지 않은 이슈·진행 중 메모는 「미해결」, 닫힌 것은 「해결됨」, 해결됨 메모는 「해결」, 주의사항 메모는 「기록」. 메모가 아니면 ''.
 * @param {Set<string>} openGids 미해결 메모의 이벤트 전역 ID들(rules/issues.js openMemos)
 */
export function historyStatusOf(row, openGids) {
  if (row.type !== 'memo') return '';
  if (openGids && openGids.has(row.gid)) return '미해결';
  if (OPEN_CATEGORIES.includes(row.category)) return '해결됨';
  return row.category === 'resolved' ? '해결' : '기록';
}

/**
 * describeNode의 history(오래된 순)를 최신이 위인 줄로. 같은 날은 나중에 기록한 것이 위(입력 순서의 역순을 안정 정렬).
 * 줄마다 group(범주)·status(상태)를 더한다. 입력을 바꾸지 않는다
 */
export function historyRows(history, openGids = null) {
  return history
    .map((h, i) => ({ ...h, _i: i }))
    .sort((a, b) => cmp(b.date, a.date) || b._i - a._i)
    .map(({ _i, ...h }) => ({ ...h, group: historyGroupOf(h.type, h.category), status: historyStatusOf(h, openGids) }));
}

/**
 * 이력 표 거르기: 범주(전체면 거르지 않음) · 기간(올해·작년·전체, today의 해 기준) · 찾기 글(내용·범주·날짜에서 부분 일치, 대소문자 무시)
 * @param {{group?:string, period?:string, q?:string}} f
 */
// 지도 전체 기록 표 줄(fields가 있는 줄)의 찾기: 기록 찾기(view/recent-records.js)와 같은 규칙 — 조각마다 따로, 대소문자·공백 무시(R12 RV12C-4)
const matchFields = (fields, q) => { const w = String(q ?? '').replace(/\s+/g, ''); return !w || fields.some((x) => String(x ?? '').toLowerCase().replace(/\s+/g, '').includes(w)); };

export function filterHistory(rows, f = {}, today = '') {
  const group = HISTORY_GROUPS.includes(f.group) ? f.group : '';
  const year = Number(String(today).slice(0, 4)) || 0;
  const want = f.period === '올해' ? String(year) : f.period === '작년' ? String(year - 1) : '';
  const q = String(f.q || '').trim().toLowerCase();
  return rows.filter((r) => (!group || r.group === group) && (!want || String(r.date).startsWith(want))
    && (!q || (Array.isArray(r.fields) ? matchFields(r.fields, q) : `${r.text} ${r.type_label} ${r.status} ${r.date} ${r.target || ''}`.toLowerCase().includes(q))));
}

/**
 * 쪽 나누기: page(1부터)쪽까지 누적해서 보인다(「다음 20」을 누를 때마다 쪽이 하나 늘어난다).
 * @returns {{shown:object[], total:number, shownCount:number, hasMore:boolean, nextCount:number}}
 */
export function pageRows(rows, page = 1, size = CARD.HISTORY_PAGE) {
  const count = Math.min(rows.length, Math.max(1, Math.floor(page) || 1) * size);
  return { shown: rows.slice(0, count), total: rows.length, shownCount: count, hasMore: count < rows.length, nextCount: Math.min(size, rows.length - count) };
}

/**
 * 카드의 이력 묶음에 보일 줄: 최신 max건. 방금 기록한 줄(justAdded)이 그보다 옛 줄이면 그 줄도 따로 보인다(강조·스크롤이 닿게)
 * @returns {{shown:object[], extra:object|null, rest:number}} rest = 보이지 않는 줄 수
 */
export function historyPreview(rows, justAdded = null, max = CARD.HISTORY_SHOWN) {
  const shown = rows.slice(0, max);
  const want = justAdded && justAdded.length ? new Set(justAdded) : null;
  const extra = want && !shown.some((r) => want.has(r.gid)) ? rows.slice(max).find((r) => want.has(r.gid)) || null : null;
  return { shown, extra, rest: rows.length - shown.length - (extra ? 1 : 0) };
}

// ── 3. 상태 줄·지금 볼 것 ─────────────────────────────────────────────────

/** 「미해결 n(이 업무 a · 같은 주제 b)」: 이 업무를 가리키는 메모와 같은 주제를 단 다른 메모를 나눈다 */
export function splitIssues(view, gid, memos) {
  const g = view.canonical(gid);
  const own = memos.filter((ev) => memoTarget(view, ev) === g).length;
  return { total: memos.length, own, topic: memos.length - own };
}
export const issueSplitText = (s) => (s.topic ? `이 업무 ${s.own} · 같은 주제 ${s.topic}` : '');

/** 업무의 「담당 …」 한 줄 글(공백 종류 포함). 업무 상세의 workNote가 쓰던 문장 그대로 */
export function workLoadText(view, gid, w, asOf, past) {
  if (w.work_ended) return '기간이 끝난 업무';
  if (w.work_scheduled) return `시작 전 업무(${w.work_start}부터)`;
  if (w.kind === 'covered') return `${past ? `${asOf} 기준 담당` : '현재 담당'}: ${currentHoldersText(view, gid, asOf, w.current, { past })}`;
  if (w.kind === 'scheduled') return `공백 — 시작 예정 담당자만 있음(${w.next_person.label}, ${w.next_start}부터)`;
  if (w.kind === 'ended') return `공백 — 이전 담당자만 있음(${w.last_person.label}, ${w.last_end}까지). 끝난 업무인지 확인`;
  return '공백 — 담당 기록 없음';
}

const attrOf = (node, key) => {
  const v = node && node.attrs && node.attrs[key];
  return v === undefined || v === null || String(v).trim() === '' ? '' : String(v).trim();
};

/**
 * 마감 값이 날짜(YYYY-MM-DD 또는 M-D)일 때만 남은 날수 글. 글(「월 마감 후 5영업일 이내」 같은)이면 ''. 새 판정이 아니라 화면 글이다.
 * @returns {string} 「3일 남음」「오늘 마감」「2일 지남」 또는 ''
 */
export function deadlineLeft(deadline, today) {
  const m = /^(?:(\d{4})-)?(\d{1,2})-(\d{1,2})$/.exec(String(deadline || '').trim());
  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today || ''));
  if (!m || !t) return '';
  const y = Number(m[1] || t[1]);
  const to = Date.UTC(y, Number(m[2]) - 1, Number(m[3]));
  const days = Math.round((to - Date.UTC(Number(t[1]), Number(t[2]) - 1, Number(t[3]))) / 86400000);
  if (Number.isNaN(days)) return '';
  return days > 0 ? `${days}일 남음` : days === 0 ? '오늘 마감' : `${-days}일 지남`;
}

/** 미해결 메모 한 건을 「지금 볼 것」 줄로 */
const nowIssue = (ev) => ({ gid: ev.gid, date: ev.occurred_at, category: MEMO_CATEGORIES[memoCategoryOf(ev.payload)] || '', text: clip(ev.note || '메모', CARD.TEXT_CLIP), note: ev.note || '' });

/** 미해결 메모를 최신(날짜, 같은 날은 나중 기록)이 위로 */
export function newestFirst(memos) {
  return memos.map((ev, i) => ({ ev, i })).sort((a, b) => cmp(String(b.ev.occurred_at), String(a.ev.occurred_at)) || b.i - a.i).map((x) => x.ev);
}

/** 사용자가 남긴 기록(메모·담당·인수인계·소속 변경) 중 가장 최근 한 줄. 이력이 최신순 rows일 때 */
export function latestRecord(rows) {
  const r = rows.find((x) => USER_EVENT_TYPES.includes(x.type));
  if (!r) return null;
  const typeLabel = r.type === 'memo' && r.category ? MEMO_CATEGORIES[r.category] || r.type_label : r.type_label;
  // 이력 줄 글은 메모 분류를 「[이슈] …」처럼 앞에 달고 있다. 화면이 분류를 따로 보이므로(칩·[ ] 접두어) 글에서는 뗀다 — 꼬리표가 두 번 나오던 결함(R11 FU6-6)
  const tag = `[${typeLabel}] `;
  const text = r.type === 'memo' && String(r.text || '').startsWith(tag) ? String(r.text).slice(tag.length) : r.text;
  return { gid: r.gid, date: r.date, type_label: typeLabel, text: clip(text, CARD.TEXT_CLIP) };
}

/**
 * 카드가 쓰는 값 모음. 업무·사람·그 밖의 유형별로 필요한 것만 채운다.
 * @param {{asOf:string, past?:boolean, rootGid?:string|null, n?:number, history?:object[]}} o history: describeNode의 history(최근 기록 한 줄용)
 */
export function cardData(view, gid, { asOf, past = false, rootGid = null, n = undefined, history = [] } = {}) {
  const node = view.getNode(gid);
  if (!node) return null;
  const all = openMemos(view);
  const openGids = new Set(all.map((ev) => ev.gid));
  const rows = historyRows(history, openGids);
  const data = { coreType: node.core_type, asOf, past, openGids, rows, latest: latestRecord(rows), contact: contactOf(node) || '', deadline: attrOf(node, '마감') };
  if (node.core_type === 'work') {
    const w = workLoad(view, gid, { asOf });
    const memos = rootGid && view.canonical(gid) === view.canonical(rootGid) ? all : openMemosOf(view, node.gid);
    data.issues = splitIssues(view, gid, memos);
    data.now = newestFirst(memos).slice(0, CARD.NOW_ISSUES).map(nowIssue);
    data.load = w;
    if (w) {
      data.owners = w.current.map((p) => ({ gid: p.gid, label: p.label, contact: contactOf(view.getNode(p.gid)) || '' }));
      data.holdersText = w.kind === 'covered' ? currentHoldersText(view, gid, asOf, w.current, { past }) : '';
      data.loadText = workLoadText(view, gid, w, asOf, past);
      data.gap = !w.work_ended && !w.work_scheduled && w.kind !== 'covered';
    }
  } else if (node.core_type === 'person') {
    Object.assign(data, personData(view, node, { asOf, n, memos: all }));
  }
  return data;
}

// ── 4. 사람 카드 ──────────────────────────────────────────────────────────

/**
 * 사람 카드의 값: 소속·사번·연락처, 지금 맡은 업무 수, 혼자만 아는 일 수(지금 맡은 것 중), 업무 표(위험·미해결 많은 것 먼저), 지난 업무.
 * 업무 표의 「미해결」은 그 업무를 가리키는 메모의 수(memoTarget이 그 업무인 것)다.
 */
export function personData(view, node, { asOf, n, memos = null }) {
  const load = personLoad(view, node.gid, { asOf, n });
  const works = load ? load.works : [];
  const solo = new Set(soloWorksOf(view, node.gid, asOf).map((w) => w.gid));
  const open = new Map();
  for (const ev of memos || openMemos(view)) {
    const t = memoTarget(view, ev);
    if (t) open.set(t, (open.get(t) || 0) + 1);
  }
  const rows = works.map((w) => {
    const wn = view.getNode(w.gid);
    return { gid: w.gid, label: w.label, open: open.get(w.gid) || 0, solo: solo.has(w.gid), deadline: attrOf(wn, '마감') };
  }).sort((a, b) => Number(b.solo) - Number(a.solo) || b.open - a.open || String(a.label).localeCompare(String(b.label), 'ko'));
  const nowGids = new Set(works.map((w) => w.gid));
  const past = new Map();
  for (const e of view.edges) {
    if (e.hidden || e.core_type !== 'performs' || e.source !== view.canonical(node.gid) || nowGids.has(e.target)) continue;
    const w = view.getNode(e.target);
    if (!w || w.core_type !== 'work' || w.hidden) continue;
    const st = edgeStatus(view, e, asOf);
    if (st === 'current') continue;
    const end = (e.period && e.period.end) || '';
    const prev = past.get(w.gid);
    if (!prev || cmp(prev.end, end) < 0) past.set(w.gid, { gid: w.gid, label: w.label, end, scheduled: st === 'scheduled' });
  }
  const pastRows = [...past.values()].sort((a, b) => cmp(b.end, a.end) || String(a.label).localeCompare(String(b.label), 'ko'));
  return {
    count: rows.length, dense: load ? load.dense : false, denseN: load ? load.n : 0, personRows: rows, pastRows,
    solo: rows.filter((r) => r.solo).length, hasAssignments: !!load && view.edges.some((e) => !e.hidden && e.core_type === 'performs' && e.source === view.canonical(node.gid)),
  };
}

// ── 5. 동작 줄 ────────────────────────────────────────────────────────────

/**
 * 유형별 동작 줄 구성. 쓸 수 없는 단추는 흐리게가 아니라 뺀다(설계 원칙 3).
 * primary는 고정 줄에 늘 보이는 단추, more는 「⋯」 메뉴 안. 키: record(기록 남기기) assign(담당 넘기기) draft(인수인계 초안) personDraft(이 사람 일 인수인계 초안)
 * edit edge collab history similar insight nbhd hide delete download print
 * @param {{coreType:string, own:boolean, readOnly:boolean, hidden?:boolean, handoverDoc?:boolean, canDelete?:boolean}} f
 */
export function actionPlan(f) {
  if (f.hidden) return { primary: [], more: [] };
  const editable = f.own && !f.readOnly;
  const t = f.coreType;
  const primary = [];
  const more = [];
  if (t === 'artifact' && f.handoverDoc) primary.push('download', 'print');
  if (editable) primary.push('record');
  if (t === 'work') {
    if (editable) primary.push('assign');
    primary.push('draft');
  }
  // 「이 사람 일 인수인계 초안」은 다른 지도의 사람에도 있다(초안은 읽기 전용이 아니면 그 사람이 맡은 업무가 있는 지도로 열린다)
  if (t === 'person' && !f.readOnly) primary.push('personDraft');
  if (editable) {
    more.push('edit', 'edge');
    if (t === 'work') more.push('collab');
  }
  more.push('history');
  if (t === 'work') more.push('similar');
  more.push('insight', 'nbhd');
  if (editable && t !== 'root') {
    more.push('hide');
    if (f.canDelete) more.push('delete');
  }
  return { primary, more };
}
