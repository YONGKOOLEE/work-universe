// 일상 사용(CR-18-8, D-1·D-2·D-3·D-4): 다시 열기와 매주 점검에 쓰는 순수 계산. DOM·저장소를 쓰지 않는다(rules).
// 기록은 모두 이 브라우저 설정(wu:v1:settings)에만 두고, 문서·내보내기·백업에는 넣지 않는다.
// 승인 문서와 갈릴 수 있는 동작은 아래 상수 한 곳에서 바꾼다("답이 없으면" 값).

import { isCurrentEdge, periodStatus } from '../view/describe.js';
import { SUBTYPE_ROLE } from '../model/schema.js';

/** D-2: true면 따라 하기를 한 번 끝내거나 건너뛴 시나리오는 시작 화면 카드로 다시 들어가도 자동으로 뜨지 않는다. false면 예전대로 항상 뜬다 */
export const TOUR_ONCE = true;
/** D-2: 자동으로 뜨지 않았을 때 상태 줄에 보이는 안내 */
export const TOUR_ONCE_NOTE = '따라 하기는 머리글 「?」 → 「따라 하기 다시 보기」에서 다시 볼 수 있습니다';
/** D-3: 지도별 점검 기준을 설정에 남기는 최대 지도 수(넘으면 저장 시각이 오래된 것부터 버린다) */
export const BASELINE_MAX = 30;
/** M1(일상 사용 2회차): 지도마다 남기는 점검 기준 수 — 최근 이 개수까지. 같은 날 다시 저장하면 그날 것을 바꾸고, 날이 바뀌면 새로 더한다(넘으면 오래된 것을 버린다). 비교는 오늘보다 앞선 날의 가장 최근 기준과 한다 */
export const BASELINE_KEEP = 2;
/** M6: 점검 기준에 함께 남기는 업무별 지금 담당 이름의 최대 업무 수(넘으면 이름순 앞에서부터) */
export const BASELINE_OWNERS_MAX = 100;
/** M6: 업무 하나의 담당 이름 글(여러 명이면 ', '로 이음) 최대 길이(깨진 설정값 방어) */
const OWNER_TEXT_MAX = 300;
/** D-1: 지도 이름·id 최대 길이(깨진 설정값 방어) */
const ID_MAX = 100;
/** FU5-1: 점검 기준에 함께 남기는 목록당 항목 이름 최대 수(넘으면 앞에서부터 이만큼만 저장하고 names.cut에 잘렸음을 표시) */
export const BASELINE_NAMES_MAX = 30;
/** FU5-1: 항목 이름 하나의 최대 길이(깨진 설정값 방어) */
const NAME_MAX = 100;
const NAME_KEYS = ['solo', 'dense', 'gaps'];

const isStamp = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));
const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const countOrNull = (v) => (Number.isInteger(v) && v >= 0 && v <= 1e6 ? v : null);

/**
 * 점검 기준에 붙는 항목 이름 목록(FU5-1): { solo:string[], dense:string[], gaps:string[], cut:{solo?:true,...} }.
 * 문자열만, 앞뒤 공백을 뗀 뒤 비지 않고 NAME_MAX 이하, 중복 없이 앞에서부터 BASELINE_NAMES_MAX개. 넘쳐서 잘렸으면 cut에 표시.
 * 목록이 하나도 없으면(예전 기준) undefined. 목록이 없는 키는 그 목록만 빠진다(그 목록은 숫자만 비교)
 */
export function cleanBaselineNames(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out = {};
  const cut = {};
  for (const k of NAME_KEYS) {
    if (!Array.isArray(v[k])) continue;
    // 글자가 아닌 값이 섞인 목록은 깨진 것으로 보고 그 목록만 버린다(빈 목록으로 남으면 지금 목록 전부가 「늘어남」으로 틀리게 나온다)
    if (v[k].some((x) => typeof x !== 'string')) continue;
    const seen = new Set();
    for (const x of v[k]) {
      if (typeof x !== 'string') continue;
      const t = x.trim();
      if (t && t.length <= NAME_MAX) seen.add(t);
    }
    const all = [...seen];
    out[k] = all.slice(0, BASELINE_NAMES_MAX);
    if (all.length > BASELINE_NAMES_MAX || v.cut?.[k] === true) cut[k] = true;
  }
  if (!Object.keys(out).length) return undefined;
  if (Object.keys(cut).length) out.cut = cut;
  return out;
}

// ── 설정값 다듬기(깨진 값은 없는 것으로) ─────────────────────────────────────

/** 마지막으로 연 지도 id: 문자열이고 비지 않고 상한 이하일 때만. 아니면 '' */
export function cleanLastOpenedId(v) {
  return typeof v === 'string' && v.length > 0 && v.length <= ID_MAX ? v : '';
}

/** 따라 하기를 끝낸·건너뛴 시나리오: { 시나리오: 시각 }. 키는 영문 소문자, 값은 날짜로 읽히는 문자열만. 없으면 undefined */
export function cleanTourDone(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out = {};
  for (const [k, t] of Object.entries(v)) if (/^[a-z]{1,20}$/.test(k) && isStamp(t)) out[k] = t;
  return Object.keys(out).length ? out : undefined;
}

/**
 * 업무별 지금 담당 이름(M6): { 업무이름: '담당 이름(여럿이면 ", "로 이음, 담당 없음은 빈 글)' }. 키는 비지 않고 NAME_MAX 이하,
 * 값은 글이고 OWNER_TEXT_MAX 이하인 것만. 이름순 앞에서부터 BASELINE_OWNERS_MAX개. 하나도 없으면(예전 기준) undefined
 */
export function cleanOwners(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const rows = [];
  for (const [k, t] of Object.entries(v)) {
    const key = typeof k === 'string' ? k.trim() : '';
    if (!key || key.length > NAME_MAX || typeof t !== 'string' || t.length > OWNER_TEXT_MAX) continue;
    rows.push([key, t.trim()]);
  }
  if (!rows.length) return undefined;
  rows.sort((a, b) => a[0].localeCompare(b[0], 'ko'));
  return Object.fromEntries(rows.slice(0, BASELINE_OWNERS_MAX));
}

/** 기준 한 건 다듬기. at이 날짜로 읽히지 않으면 null */
function cleanOneBaseline(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b) || !isStamp(b.at)) return null;
  const row = { solo: countOrNull(b.solo), dense: countOrNull(b.dense), gaps: countOrNull(b.gaps), at: b.at };
  if (isDay(b.asOf)) row.asOf = b.asOf;
  const names = cleanBaselineNames(b.names);
  if (names) row.names = names;
  const owners = cleanOwners(b.owners);
  if (owners) row.owners = owners;
  return row;
}

/** 저장한 날(기준의 at 앞 10자) */
export const baselineDay = (row) => String(row.at).slice(0, 10);

/**
 * 한 지도의 점검 기준 목록(M1): 예전 형식(기준 한 건 = 객체)도, 새 형식(오래된 것 → 최근 것 배열)도 읽는다.
 * 같은 날은 늦게 저장한 것 하나만, 날짜순으로 BASELINE_KEEP개까지 남긴다. 읽을 수 없으면 []
 * @returns {object[]} 저장 시각이 이른 것부터
 */
export function baselineList(entry) {
  const items = (Array.isArray(entry) ? entry.slice(0, 20) : [entry]).map(cleanOneBaseline).filter(Boolean);
  items.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const byDay = new Map();
  for (const r of items) byDay.set(baselineDay(r), r); // 같은 날은 뒤(늦은 시각)가 이긴다
  const list = [...byDay.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return list.slice(-BASELINE_KEEP);
}

/** 설정에 두는 모양: 한 건이면 예전과 같은 객체, 둘 이상이면 배열(오래된 것 → 최근 것) */
const toEntry = (list) => (list.length === 1 ? list[0] : list);

/** 가장 최근에 저장한 기준 한 건(없으면 null) */
export function latestBaseline(entry) {
  const list = baselineList(entry);
  return list.length ? list[list.length - 1] : null;
}

/**
 * 비교에 쓸 기준(M1): 오늘보다 앞선 날 저장한 것 중 가장 최근 것. 없는데 오늘 저장한 것이 있으면 savedToday(비교 대신 안내 글).
 * @param {string} today YYYY-MM-DD
 * @returns {{base: object|null, savedToday: boolean}}
 */
export function pickBaseline(entry, today) {
  const list = baselineList(entry);
  const before = list.filter((r) => baselineDay(r) < today);
  const base = before.length ? before[before.length - 1] : null;
  return { base, savedToday: !base && list.some((r) => baselineDay(r) === today) };
}

/**
 * 새 기준을 더한다(M1): 같은 날 것이 있으면 그것을 바꾸고(replaced), 아니면 새로 더한다. 최근 BASELINE_KEEP개만 남는다.
 * @returns {{entry: object|object[], replaced: boolean}}
 */
export function saveBaseline(entry, row) {
  const next = cleanOneBaseline(row);
  if (!next) return { entry: toEntry(baselineList(entry)), replaced: false };
  const list = baselineList(entry);
  const replaced = list.some((r) => baselineDay(r) === baselineDay(next));
  const merged = [...list.filter((r) => baselineDay(r) !== baselineDay(next)), next].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  return { entry: toEntry(merged.slice(-BASELINE_KEEP)), replaced };
}

/**
 * 지도별 점검 기준: { 지도id: 기준 | [기준, 기준] }. 기준 = {solo, dense, gaps, at, asOf?, names?, owners?}
 * (names: 항목 이름 목록, owners: 업무별 지금 담당 이름 — 예전 기준에는 없음). 숫자는 정수 또는 null(그때 못 셌음), at은 저장 시각, asOf는 기준일(없을 수 있음).
 * 한 지도에 BASELINE_KEEP개까지(M1, 배열은 오래된 것 → 최근 것), 예전 형식(객체 하나)도 그대로 읽는다. 지도 수가 BASELINE_MAX개를 넘으면 가장 최근 저장 시각이 늦은 지도부터 남긴다. 없으면 undefined
 */
export function cleanRiskBaselines(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const rows = [];
  for (const [id, b] of Object.entries(v)) {
    if (!id || id.length > ID_MAX) continue;
    const list = baselineList(b);
    if (list.length) rows.push([id, toEntry(list), list[list.length - 1].at]);
  }
  rows.sort((a, b) => Date.parse(b[2]) - Date.parse(a[2]));
  const out = Object.fromEntries(rows.slice(0, BASELINE_MAX).map(([id, e]) => [id, e]));
  return rows.length ? out : undefined;
}

// ── D-1: 시작 화면 「내 업무 지도」 ─────────────────────────────────────────

/** 문서의 마지막 수정일(YYYY-MM-DD). 사람이 한 변경(source 'user' 이벤트)의 가장 늦은 기록 시각. 없으면 null */
export function lastModifiedDate(doc) {
  const times = ((doc && doc.events) || []).filter((e) => e && e.source === 'user' && typeof e.recorded_at === 'string' && !Number.isNaN(Date.parse(e.recorded_at))).map((e) => e.recorded_at);
  if (!times.length) return null;
  const last = times.reduce((a, b) => (Date.parse(b) > Date.parse(a) ? b : a));
  return last.slice(0, 10);
}

/**
 * 묶은 지도의 마지막 수정일(M4): 자기 문서와, 묶고 있는 하위 지도(숨기지 않은 참조, 아래로 maxDepth단계까지)의 마지막 수정일 중 가장 늦은 날.
 * 하위 지도 문서는 loadDoc(id)로 읽는다(없거나 읽다 예외가 나면 그 지도는 건너뛴다). 한 지도는 한 번만 본다. 수정한 적이 없으면 null
 * @param {object|null} doc
 * @param {(id:string)=>object|null} [loadDoc]
 */
export function lastModifiedDeep(doc, loadDoc, maxDepth = 5) {
  const seen = new Set();
  let best = null;
  const visit = (d, depth) => {
    if (!d || !d.universe || seen.has(d.universe.id)) return;
    seen.add(d.universe.id);
    const m = lastModifiedDate(d);
    if (m && (!best || m > best)) best = m;
    if (depth >= maxDepth || typeof loadDoc !== 'function') return;
    for (const r of d.refs || []) {
      if (!r || r.hidden || typeof r.child_universe_id !== 'string') continue;
      let child = null;
      try { child = loadDoc(r.child_universe_id); } catch { child = null; }
      visit(child, depth + 1);
    }
  };
  visit(doc, 0);
  return best;
}

/** 샘플인데 사용자가 고친 것(사람이 한 변경이 하나라도 있음) */
export function isEditedSample(doc) {
  return !!(doc && doc.universe && doc.universe.is_sample && ((doc.events) || []).some((e) => e && e.source === 'user'));
}

/**
 * 시작 화면 「내 업무 지도」에 보일 목록. 내가 만든 지도 + 고친 샘플 + 마지막으로 연 지도(고치지 않은 샘플이어도).
 * 마지막 수정일이 늦은 것이 먼저, 수정일이 없는 것은 뒤(최근에 연 지도는 그 안에서 먼저), 같으면 이름순.
 * @param {{id:string,name:string,is_sample?:boolean}[]} universes
 * @param {Record<string,{modified:string|null, edited:boolean}>} info 지도 id → 마지막 수정일·샘플 수정 여부
 * @param {string} lastOpenedId
 * @param {Record<string,object>} [baselines] 지도 id → 저장한 점검 기준(FU5-4, 한 건 또는 최근 둘의 배열 — M1). 점검을 저장한 지도는 마지막으로 연 지도가 바뀌어도 남고(샘플이면 'checked-sample'), checked(마지막 점검 날짜)가 붙는다
 * @returns {{id:string, name:string, modified:string|null, checked:string|null, kind:'mine'|'edited-sample'|'recent-sample'|'checked-sample'}[]} (universes 항목의 나머지 필드를 그대로 가진다)
 */
export function startMaps(universes, info, lastOpenedId = '', baselines = null) {
  const rows = [];
  for (const u of universes || []) {
    const i = (info && info[u.id]) || { modified: null, edited: false };
    let kind = null;
    if (!u.is_sample) kind = 'mine';
    else if (i.edited) kind = 'edited-sample';
    else if (u.id === lastOpenedId) kind = 'recent-sample';
    const b = baselines && Object.prototype.hasOwnProperty.call(baselines, u.id) ? latestBaseline(baselines[u.id]) : null; // 기준이 둘이면 가장 최근 것(M1)
    const checked = b && isStamp(b.at) ? b.at.slice(0, 10) : null;
    if (!kind && checked) kind = 'checked-sample';
    if (kind) rows.push({ ...u, modified: i.modified || null, checked, kind });
  }
  const rank = (r) => (r.modified ? 0 : r.id === lastOpenedId || r.checked ? 1 : 2);
  rows.sort((a, b) => rank(a) - rank(b)
    || (a.modified && b.modified && a.modified !== b.modified ? (a.modified < b.modified ? 1 : -1) : 0)
    || String(a.name).localeCompare(String(b.name), 'ko') || (a.id < b.id ? -1 : 1));
  return rows;
}

/** 「지난번 지도 이어서 보기」 대상. 마지막으로 연 지도가 지금도 있을 때만 {id, name}, 없어졌거나 기록이 없으면 null */
export function resumeTarget(universes, lastOpenedId) {
  if (!lastOpenedId) return null;
  const u = (universes || []).find((x) => x.id === lastOpenedId);
  return u ? { id: u.id, name: u.name } : null;
}

export const resumeLabel = (name) => `지난번 지도 이어서 보기: ${name}`;
export const modifiedLabel = (modified) => (modified ? `마지막 수정 ${modified}` : '수정한 적 없음');
export const MAP_KIND_LABEL = { 'edited-sample': '고친 샘플', 'recent-sample': '최근 연 샘플' };
/** FU5-4: 점검을 저장한 지도에 붙는 표시 */
export const checkedLabel = (checked) => `점검 저장한 지도 · 마지막 점검 ${checked}`;

// ── D-2: 따라 하기는 한 번만 ────────────────────────────────────────────────

/** 시작 화면 카드로 들어왔을 때 따라 하기를 자동으로 띄울지. 「?」로 고른 것(forced)은 언제나 띄운다 */
export function shouldAutoStartTour({ tourOnce = TOUR_ONCE, done = null, scenario, forced = false }) {
  if (forced || !tourOnce) return true;
  return !(done && typeof done === 'object' && done[scenario]);
}

// ── D-3: 지난 점검 대비 ─────────────────────────────────────────────────────

const ROWS = [
  { key: 'solo', label: '혼자만 아는 일' },
  { key: 'dense', label: '일 몰린 사람' },
  { key: 'gaps', label: '담당자 빈 일' }, // 위험 요약(view/risk-summary.js)과 같은 이름(R15-6)
];
const MINUS = '−';

/** 증감 한 항목의 글: +1 / −1 / 변화 없음 / 비교 못 함(어느 쪽이든 못 센 숫자) */
export function deltaText(now, before) {
  if (now === null || now === undefined || before === null || before === undefined) return '비교 못 함';
  const d = now - before;
  return d === 0 ? '변화 없음' : d > 0 ? `+${d}` : `${MINUS}${-d}`;
}

const uniqNames = (arr) => (Array.isArray(arr) ? [...new Set(arr.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean))] : null);

/** 점검 입력(view/risk-summary.js inspectionInput 결과)에서 세 목록의 항목 이름을 뽑는다. 숫자를 못 센 목록(null)은 뺀다 */
export function namesFromInspection(d) {
  const out = {};
  if (d && d.solo !== null && d.solo !== undefined && Array.isArray(d.soloItems)) out.solo = d.soloItems.map((x) => x.work);
  if (d && d.dense !== null && d.dense !== undefined && Array.isArray(d.denseItems)) out.dense = d.denseItems.map((x) => x.person);
  if (d && d.gaps !== null && d.gaps !== undefined && Array.isArray(d.gapItems)) out.gaps = d.gapItems.map((x) => x.work);
  return out;
}

/**
 * 저장한 이름 목록과 지금 이름 목록을 비교해 무엇이 늘고 줄었는지 낸다(FU5-1).
 * 저장한 쪽 목록이 30개에서 잘렸으면 「늘어남」은 가릴 수 없어(뒤에 있던 것이 새로 보임) addedUnknown으로 표시하고 줄어든 것만 낸다.
 * 어느 쪽이든 그 목록의 이름이 없으면(예전 기준·못 센 목록) 그 목록은 건너뛴다. 하나도 비교할 수 없으면 null
 * @returns {{key:string,label:string,added:string[],removed:string[],addedUnknown:boolean}[]|null} 바뀐 목록만
 */
export function nameChanges(nowNames, baseNames) {
  if (!nowNames || !baseNames) return null;
  const out = [];
  let comparable = false;
  for (const { key, label } of ROWS) {
    const now = uniqNames(nowNames[key]);
    const base = uniqNames(baseNames[key]);
    if (!now || !base) continue;
    comparable = true;
    const cut = !!(baseNames.cut && baseNames.cut[key]);
    const added = cut ? [] : now.filter((x) => !base.includes(x));
    const removed = base.filter((x) => !now.includes(x));
    if (added.length || removed.length || cut) out.push({ key, label, added, removed, addedUnknown: cut });
  }
  return comparable ? out : null;
}

/** 이름 목록 한 줄 글: 「가, 나, 다」 (많으면 앞 NAMES_SHOW개 + 「외 n개」) */
export const NAMES_SHOW = 8;
export const namesText = (list) => `${list.slice(0, NAMES_SHOW).map((x) => `「${x}」`).join(', ')}${list.length > NAMES_SHOW ? ` 외 ${list.length - NAMES_SHOW}개` : ''}`;
export const NAMES_CUT_NOTE = `저장한 이름이 ${BASELINE_NAMES_MAX}개를 넘어 늘어난 것은 가릴 수 없습니다`;

/** M1: 오늘 저장한 점검뿐이라 비교할 앞선 기준이 없을 때의 비교 줄 */
export const TODAY_SAVED_TEXT = '오늘 저장한 점검 — 다음 점검 날부터 비교합니다';

const KO = (a, b) => String(a).localeCompare(String(b), 'ko');

/**
 * 업무별 지금 담당 이름(M6): 기준일에 진행 중인 업무마다 담당 중인 사람 이름. 같은 이름의 업무가 둘 이상이면 어느 쪽인지 가릴 수 없어 뺀다.
 * 지금 담당 판정은 인사이트와 같은 공용 함수(view/describe.js isCurrentEdge — 기간이 기준일에 진행 중이고, 기준일에 다른 사람이 담당을 시작하면
 * 그날 끝나는 사람은 뺀다)를 쓴다. 숨기지 않은 사람만(역할 노드 제외). 담당이 없으면 빈 글.
 * @returns {Record<string,string>} 업무 이름 → 이름(여럿이면 가나다순 ', ')
 */
export function currentOwnersByWork(view, asOf) {
  const out = new Map();
  const dup = new Set();
  for (const w of (view && view.nodes) || []) {
    if (w.core_type !== 'work' || w.hidden || periodStatus(w.period, asOf) !== 'current') continue;
    const label = String(w.label || '').trim();
    if (!label || label.length > NAME_MAX) continue;
    if (out.has(label)) { dup.add(label); continue; }
    const names = new Set();
    for (const e of view.edges) {
      if (e.hidden || e.core_type !== 'performs' || e.target !== w.gid || !isCurrentEdge(view, e, asOf)) continue;
      const p = view.getNode(e.source);
      if (!p || p.hidden || p.core_type !== 'person' || p.subtype === SUBTYPE_ROLE) continue;
      names.add(p.label);
    }
    out.set(label, [...names].sort(KO).join(', '));
  }
  for (const l of dup) out.delete(l);
  return Object.fromEntries([...out].sort((a, b) => KO(a[0], b[0])));
}

/** M6: 담당이 바뀐 업무. 양쪽 목록에 모두 있는 업무만 견준다(한쪽에 없으면 그 사이 생겼거나 끝난 업무). 어느 쪽이든 목록이 없으면(예전 기준) null */
export function ownerChanges(nowOwners, baseOwners) {
  const isObj = (o) => o && typeof o === 'object' && !Array.isArray(o);
  if (!isObj(nowOwners) || !isObj(baseOwners)) return null;
  const out = [];
  for (const work of Object.keys(baseOwners).sort(KO)) {
    if (!Object.prototype.hasOwnProperty.call(nowOwners, work) || typeof nowOwners[work] !== 'string' || typeof baseOwners[work] !== 'string') continue;
    if (nowOwners[work] !== baseOwners[work]) out.push({ work, before: baseOwners[work], after: nowOwners[work] });
  }
  return out;
}

/** M6: 담당이 바뀐 업무 한 줄 글 — 「담당이 바뀐 업무: 「장소 섭외」 도하람 → 윤바다 · 「…」 …」(많으면 앞 OWNERS_SHOW개 + 「외 n개」). 없으면 '' */
export const OWNERS_SHOW = 5;
export const OWNERS_NONE = '담당 없음';
export function ownerChangesText(list) {
  if (!list || !list.length) return '';
  const one = (c) => `「${c.work}」 ${c.before || OWNERS_NONE} → ${c.after || OWNERS_NONE}`;
  return `담당이 바뀐 업무: ${list.slice(0, OWNERS_SHOW).map(one).join(' · ')}${list.length > OWNERS_SHOW ? ` 외 ${list.length - OWNERS_SHOW}개` : ''}`;
}

/**
 * 지금 숫자와 저장해 둔 기준을 비교한다.
 * @param {{solo:number|null,dense:number|null,gaps:number|null}} now
 * @param {{solo:number|null,dense:number|null,gaps:number|null,at:string,names?:object,owners?:object}|null|undefined} baseline
 * @param {{solo?:string[],dense?:string[],gaps?:string[],owners?:Record<string,string>}} [nowNames] 지금 세 목록의 항목 이름과 업무별 담당 이름(없으면 이름 비교 안 함)
 * @param {{savedToday?:boolean}} [opts] savedToday: 비교할 앞선 기준이 없고 오늘 저장한 점검만 있음(M1) — 비교 줄이 안내 글이 된다
 * @returns {{has:boolean, rows:{key:string,label:string,now:number|null,before:number|null,delta:number|null,text:string}[], text:string, same:boolean, savedDate:string|null, changes:ReturnType<typeof nameChanges>, ownerChanges:ReturnType<typeof ownerChanges>, savedToday:boolean}}
 *   changes: 이름이 바뀐 목록(없으면 null = 이름 비교 못 함/예전 기준, 빈 배열 = 이름도 그대로)
 *   ownerChanges: 담당이 바뀐 업무(null = 비교 못 함/예전 기준, 빈 배열 = 그대로)
 */
export function compareRisk(now, baseline, nowNames = null, opts = {}) {
  if (!baseline) {
    const savedToday = !!(opts && opts.savedToday);
    return { has: false, rows: [], same: false, savedDate: null, changes: null, ownerChanges: null, savedToday, text: savedToday ? TODAY_SAVED_TEXT : '아직 저장한 점검 없음 — 「이번 점검 저장」을 누르면 다음에 비교합니다' };
  }
  const rows = ROWS.map(({ key, label }) => {
    const n = now ? now[key] : null;
    const b = baseline[key];
    const ok = n !== null && n !== undefined && b !== null && b !== undefined;
    return { key, label, now: n ?? null, before: b ?? null, delta: ok ? n - b : null, text: deltaText(n, b) };
  });
  const same = rows.every((r) => r.delta === 0);
  const savedDate = typeof baseline.at === 'string' ? baseline.at.slice(0, 10) : null;
  const body = same ? '변화 없음' : rows.map((r) => `${r.label} ${r.text}`).join(' · ');
  return { has: true, rows, same, savedDate, savedToday: false, changes: nameChanges(nowNames, baseline.names), ownerChanges: ownerChanges(nowNames && nowNames.owners, baseline.owners), text: `지난 점검(${savedDate || '?'}) 대비: ${body}` };
}

/** 이름이 바뀐 목록을 「늘어남: …」「줄어듦: …」 줄로(점검 요약 글·화면 공용). 바뀐 것이 없으면 [] */
export function changeLines(changes, indent = '') {
  const lines = [];
  for (const c of changes || []) {
    lines.push(`${indent}${c.label}`);
    if (c.added.length) lines.push(`${indent}  늘어남: ${namesText(c.added)}`);
    if (c.removed.length) lines.push(`${indent}  줄어듦: ${namesText(c.removed)}`);
    if (c.addedUnknown) lines.push(`${indent}  (${NAMES_CUT_NOTE})`);
  }
  return lines;
}

/**
 * FU5-2·M1: 「이번 점검 저장」 직후 알림 한 줄. replaced면 같은 날 저장해 둔 것을 바꾼 경우.
 * 비교는 저장한 날이 아니라 다음 점검 날부터 한다(오늘보다 앞선 날의 가장 최근 기준과 견준다)
 */
export const baselineSavedNote = (at, { replaced = false } = {}) => {
  const day = typeof at === 'string' ? at.slice(0, 10) : '?';
  return replaced
    ? `오늘 저장한 점검을 이번 점검으로 바꿨습니다(${day}) — 다음 점검 날부터 이 숫자와 비교합니다`
    : `이번 점검을 저장했습니다(${day}) — 다음 점검 날부터 이 숫자와 비교합니다`;
};

/** 저장할 기준 한 건. names(세 목록의 항목 이름)는 목록당 BASELINE_NAMES_MAX개까지, owners(업무별 지금 담당 이름, M6)는 BASELINE_OWNERS_MAX개까지 함께 남긴다 */
export function makeBaseline(now, { at, asOf, names, owners }) {
  const row = { solo: countOrNull(now && now.solo), dense: countOrNull(now && now.dense), gaps: countOrNull(now && now.gaps), at };
  if (isDay(asOf)) row.asOf = asOf;
  const n = cleanBaselineNames(names);
  if (n) row.names = n;
  const o = cleanOwners(owners);
  if (o) row.owners = o;
  return row;
}

// ── D-4: 점검 요약 한 장 글 ─────────────────────────────────────────────────

/** 점검 요약에 넣을 상위 항목 수 */
export const SUMMARY_TOP = 5;
export const SUMMARY_FAKE_NOTE = '이 앱의 이름과 데이터는 모두 가상입니다. 참고 정보이며 해석과 인력 배치는 사람이 정합니다.';

const countLine = (n, name, unit) => (n === null || n === undefined ? `${name}: 기록이 부족해 셀 수 없음` : `${name}: ${n}${unit}`);
// all: 파일·복사·인쇄에는 빠짐없이 넣는다(R13 FU8-26: 「외 n건」으로 잘려 나머지를 알 수 없었음). 아니면 상위 SUMMARY_TOP개 + 「외 n건」
const top = (list, fmt, all = false) => {
  const shown = (all ? list : list.slice(0, SUMMARY_TOP)).map(fmt);
  const more = !all && list.length > SUMMARY_TOP ? [`  외 ${list.length - SUMMARY_TOP}건`] : [];
  return [...shown, ...more];
};

/**
 * 점검 요약 글. 입력은 view/risk-summary.js의 inspectionInput 결과와 compareRisk 결과.
 * @param {{mapName:string, asOf:string, solo:number|null, dense:number|null, gaps:number|null, soloItems:{work:string,person:string,level:string}[], denseItems:{person:string,count:number}[], gapItems:{work:string}[]}} d
 * @param {ReturnType<typeof compareRisk>|null} cmp
 */
export function inspectionSummaryText(d, cmp, { all = false } = {}) {
  const lines = [
    `점검 요약 — ${d.mapName}`,
    `기준일: ${d.asOf}`,
    '',
    countLine(d.solo, '혼자만 아는 일', '개'),
    ...(d.solo ? top(d.soloItems, (x) => `  - 「${x.work}」 (${x.person}${x.level === 'high' ? ', 높음' : ', 주의'})`, all) : []),
    countLine(d.dense, '일 몰린 사람', '명'),
    ...(d.dense ? top(d.denseItems, (x) => `  - ${x.person} (${x.count}개 담당)`, all) : []),
    countLine(d.gaps, '담당자 빈 일', '개'),
    ...(d.gaps ? top(d.gapItems, (x) => `  - 「${x.work}」`, all) : []),
    '',
  ];
  if (cmp && cmp.has) {
    lines.push(cmp.text, ...(cmp.same ? [] : cmp.rows.map((r) => `  - ${r.label}: ${r.before === null ? '?' : r.before} → ${r.now === null ? '?' : r.now} (${r.text})`)));
    const hasChanges = !!(cmp.changes && cmp.changes.length);
    const hasOwners = !!(cmp.ownerChanges && cmp.ownerChanges.length);
    if (hasChanges || hasOwners) lines.push('바뀐 것:', ...(hasChanges ? changeLines(cmp.changes, '  ') : []), ...(hasOwners ? [`  ${ownerChangesText(cmp.ownerChanges)}`] : []));
    lines.push('');
  } else if (cmp && cmp.savedToday) {
    lines.push(`지난 점검 대비: ${TODAY_SAVED_TEXT}`, '');
  } else {
    lines.push('지난 점검 대비: 아직 저장한 점검 없음', '');
  }
  lines.push(SUMMARY_FAKE_NOTE);
  return lines.join('\n');
}

/** 점검 요약 내려받기 파일 이름: 점검요약-지도이름-기준일.txt (파일 이름에 못 쓰는 글자는 _) */
export function summaryFileName(mapName, asOf) {
  const safe = String(mapName || '지도').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 40) || '지도';
  return `점검요약-${safe}-${asOf}.txt`;
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 인쇄용 HTML(그 글만 인쇄되는 한 쪽짜리 문서) */
export function summaryPrintHtml(text, title = '점검 요약') {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>`
    + '<style>body{font:13pt/1.6 "Malgun Gothic",sans-serif;margin:24px;color:#000;background:#fff}pre{white-space:pre-wrap;font:inherit;margin:0}</style>'
    + `</head><body><pre>${escapeHtml(text)}</pre></body></html>`;
}

// ── T4: 「이번 주 기록」 날짜 ────────────────────────────────────────────────

/** 「이번 주 기록」 날짜 칸의 가장 이른 날짜(이력 추가 양식과 같은 범위의 아래쪽) */
export const WEEKLY_DATE_MIN = '1900-01-01';
export const WEEKLY_DATE_MESSAGES = {
  empty: '날짜를 넣으세요.',
  invalid: '날짜를 읽을 수 없습니다. 달력에서 고르거나 YYYY-MM-DD로 넣으세요.',
  future: '오늘보다 뒤 날짜는 기록할 수 없습니다. 오늘이나 지난 날짜를 고르세요.',
};

/**
 * 「이번 주 기록」 날짜를 검사한다: 없음('empty')·형식이나 달력에 없는 날('invalid')·오늘 뒤('future')면 그 코드, 괜찮으면 null.
 * (주말에 한 주를 몰아 넣을 때 요일별 날짜를 고를 수 있게 한 칸이다. 미래 날짜 이력은 「오늘」 기준 판정에서 빠지므로 거부한다)
 * @param {string} date YYYY-MM-DD
 * @param {string} today YYYY-MM-DD
 */
export function weeklyDateError(date, today) {
  const d = typeof date === 'string' ? date.trim() : '';
  if (!d) return 'empty';
  if (!isDay(d) || Number.isNaN(Date.parse(d)) || d < WEEKLY_DATE_MIN) return 'invalid';
  const back = new Date(`${d}T00:00:00Z`);
  if (Number.isNaN(back.getTime()) || back.toISOString().slice(0, 10) !== d) return 'invalid'; // 2026-02-30처럼 달력에 없는 날
  return d > today ? 'future' : null;
}
