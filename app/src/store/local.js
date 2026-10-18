// 브라우저 저장소(12.4 키). DOM에 의존하지 않도록 storage 객체를 주입받는다.

import { DOC_COLLECTIONS, LABEL_MAX } from '../model/schema.js';

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

/** 설정(12.4 wu:v1:settings): 공급자 선택. 저장소가 없거나 값이 깨졌으면 기본값. 키는 저장하지 않는다(Claude API는 P2) */
export function loadSettings(storage, defaults, allowed = null) {
  if (!storage) return { ...defaults };
  try {
    const v = JSON.parse(storage.getItem(SETTINGS_KEY) || 'null');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ...defaults };
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
    return out;
  } catch {
    return { ...defaults };
  }
}

/** 설정을 저장한다. 실패하면 false(화면에서는 이번 세션 동안만 유지) */
export function saveSettings(storage, settings) {
  if (!storage) return false;
  try {
    const out = { provider: settings.provider };
    const author = cleanAuthorName(settings.authorName);
    if (author) out.authorName = author;
    if (settings.lastExportAt) out.lastExportAt = settings.lastExportAt;
    if (settings.backupDismissedAt) out.backupDismissedAt = settings.backupDismissedAt;
    if (settings.moreTools === true) out.moreTools = true;
    storage.setItem(SETTINGS_KEY, JSON.stringify(out));
    return true;
  } catch {
    return false;
  }
}

