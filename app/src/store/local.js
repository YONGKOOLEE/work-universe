// 브라우저 저장소(12.4 키). DOM에 의존하지 않도록 storage 객체를 주입받는다.

import { DOC_COLLECTIONS, LABEL_MAX } from '../model/schema.js';
import { cleanLastOpenedId, cleanRiskBaselines, cleanTourDone } from '../rules/daily-use.js';
import { isWorkspace } from '../view/workspace.js';

const INDEX_KEY = 'wu:v1:index';
const SETTINGS_KEY = 'wu:v1:settings';
const universeKey = (id) => `wu:v1:u:${id}`;

// 저장소를 쓸 수 있으면 Storage 객체를, 아니면 null을 돌려준다.
// 쿠키·사이트 데이터 차단 시 window.localStorage 접근 자체가 예외를 던지므로 getter도 감싼다.
export function openStorage(getStorage) {
  try {
    const s = getStorage();
    if (!s) return null;
    const probe = 'wu:v1:probe';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function createStore(storage) {
  // 저장된 값이 깨져 있으면(직접 고침, 저장 중 중단 등) 없는 것으로 본다. 샘플이면 앱이 다시 넣는다
  function parse(raw, fallback) {
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  // 목록이 깨졌거나 비었으면 저장소의 유니버스 키를 훑어 다시 만든다(localStorage의 key·length가 있을 때)
  function readIndex() {
    const parsed = parse(storage.getItem(INDEX_KEY), null);
    // 항목이 null이거나 id가 없으면 버린다(직접 고친 저장소가 "저장소를 쓸 수 없음"으로 잘못 읽히지 않게, 여섯 번째 검토 C-13)
    const list = Array.isArray(parsed) ? parsed.filter((e) => e && typeof e.id === 'string') : parsed;
    if (Array.isArray(list) && list.length) return list;
    if (typeof storage.key !== 'function' || typeof storage.length !== 'number') return Array.isArray(list) ? list : [];
    const rebuilt = [];
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i);
      if (!k || !k.startsWith('wu:v1:u:')) continue;
      const doc = parse(storage.getItem(k), null);
      if (doc && doc.universe) rebuilt.push({ id: doc.universe.id, name: doc.universe.name });
    }
    return rebuilt;
  }

  return {
    loadUniverse(id) {
      const doc = parse(storage.getItem(universeKey(id)), null);
      // 컬렉션이 배열이고 요소가 모두 객체여야 한다(null 요소가 있으면 화면 전체가 멈추므로 없는 것으로 본다, C-13)
      const ok = doc && doc.universe && typeof doc.universe === 'object' && DOC_COLLECTIONS.every((k) => Array.isArray(doc[k]) && doc[k].every((x) => x && typeof x === 'object'));
      return ok ? doc : null;
    },

    // 본문을 쓴 뒤 목록 쓰기가 실패하면 본문을 이전 값으로 되돌린다(보이지 않는 키가 남지 않게). 예외는 그대로 던진다
    saveUniverse(doc) {
      const { id, name } = doc.universe;
      const index = readIndex().filter((e) => e.id !== id);
      index.push({ id, name });
      const before = storage.getItem(universeKey(id));
      storage.setItem(universeKey(id), JSON.stringify(doc));
      try {
        storage.setItem(INDEX_KEY, JSON.stringify(index));
      } catch (err) {
        try {
          if (before === null) storage.removeItem(universeKey(id));
          else storage.setItem(universeKey(id), before);
        } catch {
          // 되돌리기도 실패하면 남은 키는 초기화(purgeExcept)가 지운다
        }
        throw err;
      }
    },

    /** 유니버스 키 중 keep에 없는 것을 모두 지운다(초기화용). key·length가 없는 저장소에서는 아무것도 안 함 */
    purgeExcept(keep) {
      if (typeof storage.key !== 'function' || typeof storage.length !== 'number') return;
      const doomed = [];
      for (let i = 0; i < storage.length; i += 1) {
        const k = storage.key(i);
        if (k && k.startsWith('wu:v1:u:') && !keep.has(k.slice('wu:v1:u:'.length))) doomed.push(k);
      }
      for (const k of doomed) storage.removeItem(k);
    },

    removeUniverse(id) {
      storage.removeItem(universeKey(id));
      storage.setItem(INDEX_KEY, JSON.stringify(readIndex().filter((e) => e.id !== id)));
    },

    listUniverses: readIndex,
  };
}

/** 작성자 이름(R-22, D-24): 앞뒤 공백을 없애고 이름 상한(LABEL_MAX)까지만. 문자열이 아니거나 비면 ''(= 기본 기록 주체) */
export function cleanAuthorName(v) {
  return typeof v === 'string' ? v.trim().slice(0, LABEL_MAX).trim() : '';
}

/** 오른쪽 패널 폭 설정값: 200~4000 사이 정수만 받는다 */
function validPanelWidth(v) {
  return Number.isInteger(v) && v >= 200 && v <= 4000;
}

// 실시간 Claude API(CR-15, 12.4): 키·모델은 이 브라우저 설정에만 둔다. 내보내기·내용 포함 HTML·폴더 파일·되감기 이력에는 들어가지 않는다
export const API_KEY_MAX = 200;
export const LLM_MODEL_MAX = 100;
/** 키/모델 입력값: 문자열이고 앞뒤 공백을 뗀 뒤 비지 않고 상한 이하일 때만 받는다. 넘으면 잘라 쓰지 않고 버린다(잘린 키는 틀린 키) */
const cleanLimited = (v, max) => {
  if (typeof v !== 'string') return '';
  const t = v.trim();
  return t && t.length <= max ? t : '';
};
export const cleanApiKey = (v) => cleanLimited(v, API_KEY_MAX);
export const cleanLlmModel = (v) => cleanLimited(v, LLM_MODEL_MAX);

/** 일상 사용 기록(CR-18-8): 마지막으로 연 지도, 따라 하기를 끝낸 시나리오, 지도별 점검 기준. 이 브라우저 설정에만 두며 문서·내보내기·백업에는 들어가지 않는다 */
function applyDailyUse(out, v) {
  const last = cleanLastOpenedId(v.lastOpenedId);
  if (last) out.lastOpenedId = last;
  const done = cleanTourDone(v.tourDone);
  if (done) out.tourDone = done;
  const base = cleanRiskBaselines(v.riskBaseline);
  if (base) out.riskBaseline = base;
}

// loadSettings가 돌려주는 객체에 "읽은 시점의 저장 모양"을 붙인다(saveSettings가 이 탭이 바꾼 칸만 알아내는 기준)
const remember = (obj) => { lastSeen.set(obj, pickSettings(obj)); return obj; };

/** 설정(12.4 wu:v1:settings): 공급자 선택·작성자 이름 등. 저장소가 없거나 값이 깨졌으면 기본값. apiKey·llmModel은 실시간 Claude API용(CR-15) */
export function loadSettings(storage, defaults, allowed = null) {
  if (!storage) return { ...defaults };
  try {
    const v = JSON.parse(storage.getItem(SETTINGS_KEY) || 'null');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return remember({ ...defaults });
    // 모르는 공급자 이름은 기본값으로 바로잡는다(표시와 저장값이 어긋나지 않게, 검토3 LLM-3)
    const provider = typeof v.provider === 'string' && (!allowed || allowed.includes(v.provider)) ? v.provider : defaults.provider;
    // 마지막 내보내기·백업 권유를 닫은 시각(12.4, D-23). 날짜로 읽을 수 없으면 없는 것으로 본다
    const stamp = (s) => (typeof s === 'string' && !Number.isNaN(Date.parse(s)) ? s : undefined);
    const out = { ...defaults, provider };
    const author = cleanAuthorName(v.authorName);
    if (author) out.authorName = author;
    if (stamp(v.lastExportAt)) out.lastExportAt = v.lastExportAt;
    if (stamp(v.backupDismissedAt)) out.backupDismissedAt = v.backupDismissedAt;
    // 「도구 더 보기」 펼침(CR-13 A): true일 때만 펼침. 깨진 값은 접힘(기본)
    if (v.moreTools === true) out.moreTools = true;
    if (validPanelWidth(v.panelWidth)) out.panelWidth = v.panelWidth;
    if (isWorkspace(v.workspace)) out.workspace = v.workspace; // 작업 공간(CR-22 W): 모르는 값은 버려 기본(지도 보기)이 된다
    if (cleanApiKey(v.apiKey)) out.apiKey = cleanApiKey(v.apiKey);
    if (cleanLlmModel(v.llmModel)) out.llmModel = cleanLlmModel(v.llmModel);
    applyDailyUse(out, v);
    return remember(out);
  } catch {
    return { ...defaults };
  }
}

// 설정 한 키의 직렬화 길이 상한(RV10S-14): 점검 기준(지도마다 둘 × 지도 30 × 담당 100)이 쌓이면 최악 100만 자까지 커진다. 넘으면 오래된 점검 기준부터 버린다
export const SETTINGS_MAX_CHARS = 200000;

/** 저장할 모양으로 고른다(알 수 없는 칸·깨진 값은 뺀다). loadSettings가 읽은 값과 저장소에서 다시 읽은 값에도 같이 쓴다 */
function pickSettings(settings) {
  const out = { provider: settings.provider };
  const author = cleanAuthorName(settings.authorName);
  if (author) out.authorName = author;
  if (settings.lastExportAt) out.lastExportAt = settings.lastExportAt;
  if (settings.backupDismissedAt) out.backupDismissedAt = settings.backupDismissedAt;
  if (settings.moreTools === true) out.moreTools = true;
  if (validPanelWidth(settings.panelWidth)) out.panelWidth = settings.panelWidth;
  if (isWorkspace(settings.workspace)) out.workspace = settings.workspace;
  if (cleanApiKey(settings.apiKey)) out.apiKey = cleanApiKey(settings.apiKey);
  if (cleanLlmModel(settings.llmModel)) out.llmModel = cleanLlmModel(settings.llmModel);
  applyDailyUse(out, settings);
  return out;
}

// 여러 탭(RV10S-1): loadSettings가 돌려준 객체마다 "읽었을 때/마지막으로 저장했을 때의 저장 모양"을 기억해 둔다.
// 저장할 때 이 탭이 바꾼 칸만 쓰고, 안 바꾼 칸은 저장 직전 저장소의 값을 따른다(다른 탭이 지운 키가 되살아나지 않게)
const lastSeen = new WeakMap();
const MAP_FIELDS = ['riskBaseline', 'tourDone']; // 지도·시나리오별 칸은 항목 단위로 합친다
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function mergeField(mine, seen, theirs) {
  return same(mine, seen) ? theirs : mine;
}

function mergeSettings(mine, seen, theirs) {
  const out = {};
  for (const k of new Set([...Object.keys(mine), ...Object.keys(seen), ...Object.keys(theirs)])) {
    if (MAP_FIELDS.includes(k)) {
      const m = mine[k] || {};
      const s0 = seen[k] || {};
      const t = theirs[k] || {};
      const sub = {};
      for (const id of new Set([...Object.keys(m), ...Object.keys(s0), ...Object.keys(t)])) {
        const v = mergeField(m[id], s0[id], t[id]);
        if (v !== undefined) sub[id] = v;
      }
      if (Object.keys(sub).length) out[k] = sub;
    } else {
      const v = mergeField(mine[k], seen[k], theirs[k]);
      if (v !== undefined) out[k] = v;
    }
  }
  return out;
}

/** 점검 기준 한 지도 항목(기준 하나 또는 배열)에서 가장 늦은 저장 시각(ms). 읽을 수 없으면 0 */
function latestAt(entry) {
  const rows = Array.isArray(entry) ? entry : [entry];
  return Math.max(0, ...rows.map((r) => (r && typeof r.at === 'string' && Date.parse(r.at)) || 0));
}

/** 직렬화 길이가 상한을 넘으면 가장 오래 전에 점검한 지도의 기준부터 버린다 */
function capSize(out) {
  if (JSON.stringify(out).length <= SETTINGS_MAX_CHARS || !out.riskBaseline) return out;
  const ids = Object.keys(out.riskBaseline).sort((a, b) => latestAt(out.riskBaseline[a]) - latestAt(out.riskBaseline[b]));
  const rest = { ...out.riskBaseline };
  const trimmed = { ...out, riskBaseline: rest };
  for (const id of ids) {
    delete rest[id];
    if (!Object.keys(rest).length) delete trimmed.riskBaseline;
    if (JSON.stringify(trimmed).length <= SETTINGS_MAX_CHARS) break;
  }
  return trimmed;
}

/** 설정을 저장한다. 실패하면 false(화면에서는 이번 세션 동안만 유지). loadSettings로 읽은 객체면 다른 탭이 저장한 칸을 지우지 않는다 */
export function saveSettings(storage, settings) {
  if (!storage) return false;
  try {
    let out = pickSettings(settings);
    const seen = lastSeen.get(settings);
    if (seen) {
      let theirs = null;
      try {
        const raw = JSON.parse(storage.getItem(SETTINGS_KEY) || 'null');
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) theirs = pickSettings(raw);
      } catch {
        theirs = null; // 저장소 값이 깨졌으면 이 탭의 값으로 다시 쓴다
      }
      if (theirs) out = mergeSettings(out, seen, theirs);
      if (out.provider === undefined) out.provider = settings.provider;
    }
    out = capSize(out);
    storage.setItem(SETTINGS_KEY, JSON.stringify(out));
    // 다음 저장의 기준은 이 탭의 지금 값이다(합친 결과로 두면 다른 탭이 지운 칸을 이 탭이 "바꾼" 것으로 보아 되살린다)
    if (seen) lastSeen.set(settings, pickSettings(settings));
    return true;
  } catch {
    return false;
  }
}

// ── 다른 탭 변경 감지(RV10S-1) ──────────────────────────────────────────────
export const OTHER_TAB_NOTE = '다른 탭에서 이 지도가 바뀌었습니다 — 이 탭에서 저장하면 그 내용을 덮어씁니다. 새로 고침하면 최신 내용을 봅니다.';

/** window의 storage 이벤트가 "같은 저장소의 이 지도 문서가 다른 탭에서 바뀜(또는 저장소 전체 비움)"인가 */
export function otherTabChangedUniverse(event, storage, universeId) {
  if (!event || !storage || event.storageArea !== storage) return false;
  return event.key === null || event.key === universeKey(universeId);
}

/** 점검 기준 저장 단추를 켜도 되는가(D-3): 저장소가 있고, 읽기 전용(내용 포함 HTML 보기 등)이 아니고, 편집 되감기 중이 아닐 때만 */
export function baselineSaveAllowed({ storage, readOnly, rewinding }) {
  return !!storage && !readOnly && !rewinding;
}


// ── 실시간 응답 캐시(CR-15, 12.4 wu:v1:llm-cache) ─────────────────────────
const LLM_CACHE_KEY = 'wu:v1:llm-cache';
export const LLM_CACHE_MAX = 200;

/**
 * 응답 캐시: 조회 키 → 검증을 통과한 문장. 최대 max건, 넘으면 오래된 것부터 버린다.
 * storage가 없거나 쓰기가 실패하면 이 세션 메모리에서만 유지한다. 키 지우기 때 clear()로 함께 지운다.
 * 읽기는 처음 쓸 때 한 번(키가 없는 브라우저는 저장소를 건드리지 않는다)
 */
export function createLlmCache(storage, { max = LLM_CACHE_MAX } = {}) {
  let map = null;
  const load = () => {
    if (map) return map;
    map = new Map();
    try {
      const v = JSON.parse((storage && storage.getItem(LLM_CACHE_KEY)) || 'null');
      const list = v && Array.isArray(v.entries) ? v.entries : [];
      for (const e of list) if (Array.isArray(e) && typeof e[0] === 'string' && e[1] && typeof e[1] === 'object') map.set(e[0], e[1]);
    } catch {
      map = new Map();
    }
    while (map.size > max) map.delete(map.keys().next().value);
    return map;
  };
  const persist = () => {
    if (!storage) return;
    try {
      storage.setItem(LLM_CACHE_KEY, JSON.stringify({ v: 1, entries: [...map] }));
    } catch {
      // 저장소가 가득 찼거나 막혔으면 이 세션 메모리에서만 유지
    }
  };
  return {
    get(key) {
      return load().get(key) || null;
    },
    set(key, value) {
      const m = load();
      m.delete(key); // 다시 쓰면 가장 새것으로
      m.set(key, value);
      while (m.size > max) m.delete(m.keys().next().value);
      persist();
    },
    clear() {
      map = new Map();
      try {
        if (storage) storage.removeItem(LLM_CACHE_KEY);
      } catch {
        // 지우지 못해도 메모리는 비었다
      }
    },
    get size() {
      return load().size;
    },
  };
}
