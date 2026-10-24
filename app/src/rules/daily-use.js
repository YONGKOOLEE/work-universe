// 일상 사용(CR-18-8, D-1·D-2·D-3·D-4): 다시 열기와 매주 점검에 쓰는 순수 계산. DOM·저장소를 쓰지 않는다(rules).
// 기록은 모두 이 브라우저 설정(wu:v1:settings)에만 두고, 문서·내보내기·백업에는 넣지 않는다.
// 승인 문서와 갈릴 수 있는 동작은 아래 상수 한 곳에서 바꾼다("답이 없으면" 값).

/** D-2: true면 따라 하기를 한 번 끝내거나 건너뛴 시나리오는 시작 화면 카드로 다시 들어가도 자동으로 뜨지 않는다. false면 예전대로 항상 뜬다 */
export const TOUR_ONCE = true;
/** D-2: 자동으로 뜨지 않았을 때 상태 줄에 보이는 안내 */
export const TOUR_ONCE_NOTE = '따라 하기는 머리글 「?」 → 「따라 하기 다시 보기」에서 다시 볼 수 있습니다';
/** D-3: 지도별 점검 기준을 설정에 남기는 최대 지도 수(넘으면 저장 시각이 오래된 것부터 버린다) */
export const BASELINE_MAX = 30;
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
 * 지도별 점검 기준: { 지도id: {solo, dense, gaps, at, asOf, names?} }(names: 항목 이름 목록, 예전 기준에는 없음). 숫자는 정수 또는 null(그때 못 셌음), at은 저장 시각, asOf는 기준일(없을 수 있음).
 * BASELINE_MAX개를 넘으면 at이 늦은 것부터 남긴다. 없으면 undefined
 */
export function cleanRiskBaselines(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const rows = [];
  for (const [id, b] of Object.entries(v)) {
    if (!id || id.length > ID_MAX || !b || typeof b !== 'object' || !isStamp(b.at)) continue;
    const row = { solo: countOrNull(b.solo), dense: countOrNull(b.dense), gaps: countOrNull(b.gaps), at: b.at };
    if (isDay(b.asOf)) row.asOf = b.asOf;
    const names = cleanBaselineNames(b.names);
    if (names) row.names = names;
    rows.push([id, row]);
  }
  rows.sort((a, b) => Date.parse(b[1].at) - Date.parse(a[1].at));
  const out = Object.fromEntries(rows.slice(0, BASELINE_MAX));
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
 * @param {Record<string,{at:string}>} [baselines] 지도 id → 저장한 점검 기준(FU5-4). 점검을 저장한 지도는 마지막으로 연 지도가 바뀌어도 남고(샘플이면 'checked-sample'), checked(마지막 점검 날짜)가 붙는다
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
    const b = baselines && Object.prototype.hasOwnProperty.call(baselines, u.id) ? baselines[u.id] : null;
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

/**
 * 지금 숫자와 저장해 둔 기준을 비교한다.
 * @param {{solo:number|null,dense:number|null,gaps:number|null}} now
 * @param {{solo:number|null,dense:number|null,gaps:number|null,at:string,names?:object}|null|undefined} baseline
 * @param {{solo?:string[],dense?:string[],gaps?:string[]}} [nowNames] 지금 세 목록의 항목 이름(없으면 이름 비교 안 함)
 * @returns {{has:boolean, rows:{key:string,label:string,now:number|null,before:number|null,delta:number|null,text:string}[], text:string, same:boolean, savedDate:string|null, changes:ReturnType<typeof nameChanges>}}
 *   changes: 이름이 바뀐 목록(없으면 null = 이름 비교 못 함/예전 기준, 빈 배열 = 이름도 그대로)
 */
export function compareRisk(now, baseline, nowNames = null) {
  if (!baseline) {
    return { has: false, rows: [], same: false, savedDate: null, changes: null, text: '아직 저장한 점검 없음 — 「이번 점검 저장」을 누르면 다음에 비교합니다' };
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
  return { has: true, rows, same, savedDate, changes: nameChanges(nowNames, baseline.names), text: `지난 점검(${savedDate || '?'}) 대비: ${body}` };
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

/** FU5-2: 「이번 점검 저장」 직후 알림 한 줄 */
export const baselineSavedNote = (at) => `이번 점검을 저장했습니다(${typeof at === 'string' ? at.slice(0, 10) : '?'}) — 다음에 열면 이 숫자와 비교합니다`;

/** 저장할 기준 한 건(설정 riskBaseline[지도id]). names(세 목록의 항목 이름)를 주면 목록당 BASELINE_NAMES_MAX개까지 함께 남긴다 */
export function makeBaseline(now, { at, asOf, names }) {
  const row = { solo: countOrNull(now && now.solo), dense: countOrNull(now && now.dense), gaps: countOrNull(now && now.gaps), at };
  if (isDay(asOf)) row.asOf = asOf;
  const n = cleanBaselineNames(names);
  if (n) row.names = n;
  return row;
}

// ── D-4: 점검 요약 한 장 글 ─────────────────────────────────────────────────

/** 점검 요약에 넣을 상위 항목 수 */
export const SUMMARY_TOP = 5;
export const SUMMARY_FAKE_NOTE = '이 앱의 이름과 데이터는 모두 가상입니다. 참고 정보이며 해석과 인력 배치는 사람이 정합니다.';

const countLine = (n, name, unit) => (n === null || n === undefined ? `${name}: 기록이 부족해 셀 수 없음` : `${name}: ${n}${unit}`);
const top = (list, fmt) => {
  const shown = list.slice(0, SUMMARY_TOP).map(fmt);
  const more = list.length > SUMMARY_TOP ? [`  외 ${list.length - SUMMARY_TOP}건`] : [];
  return [...shown, ...more];
};

/**
 * 점검 요약 글. 입력은 view/risk-summary.js의 inspectionInput 결과와 compareRisk 결과.
 * @param {{mapName:string, asOf:string, solo:number|null, dense:number|null, gaps:number|null, soloItems:{work:string,person:string,level:string}[], denseItems:{person:string,count:number}[], gapItems:{work:string}[]}} d
 * @param {ReturnType<typeof compareRisk>|null} cmp
 */
export function inspectionSummaryText(d, cmp) {
  const lines = [
    `점검 요약 — ${d.mapName}`,
    `기준일: ${d.asOf}`,
    '',
    countLine(d.solo, '혼자만 아는 일', '개'),
    ...(d.solo ? top(d.soloItems, (x) => `  - 「${x.work}」 (${x.person}${x.level === 'high' ? ', 높음' : ', 주의'})`) : []),
    countLine(d.dense, '일 몰린 사람', '명'),
    ...(d.dense ? top(d.denseItems, (x) => `  - ${x.person} (${x.count}개 담당)`) : []),
    countLine(d.gaps, '담당자 빈 일', '개'),
    ...(d.gaps ? top(d.gapItems, (x) => `  - 「${x.work}」`) : []),
    '',
  ];
  if (cmp && cmp.has) {
    lines.push(cmp.text, ...(cmp.same ? [] : cmp.rows.map((r) => `  - ${r.label}: ${r.before === null ? '?' : r.before} → ${r.now === null ? '?' : r.now} (${r.text})`)));
    if (cmp.changes && cmp.changes.length) lines.push('바뀐 것:', ...changeLines(cmp.changes, '  '));
    lines.push('');
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
