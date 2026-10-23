// 폴더 연결(CR-14 C, R-27, D-32): 브라우저 저장소가 원본, 폴더는 거울.
// 브라우저 기능(폴더 접근 API·IndexedDB)을 쓰는 store 계층이다. 전역은 함수 안에서만 참조하고, 손잡이는 인자로 받아 가짜 손잡이로 시험할 수 있다.
// 모든 함수는 실패를 예외로 던지지 않고 {ok:false, error:{name, message}}로 돌려준다.

export const FOLDER_MAX_BYTES = 1000000; // 이보다 큰 파일은 읽지 않는다
const DB_NAME = 'wu-v1-folder';
const STORE = 'h';
const KEY = 'dir';
const MODE = { mode: 'readwrite' };

const fail = (e) => ({ ok: false, error: { name: (e && e.name) || 'Error', message: String((e && e.message) || e || '') } });

/** 이 브라우저에서 폴더 고르기 기능이 있는가(Chrome·Edge) */
export function folderSupported() {
  return typeof globalThis.showDirectoryPicker === 'function';
}

// ── 손잡이 기억(IndexedDB). 없거나 실패하면 조용히 기억하지 않는다 ──
function openDb() {
  return new Promise((resolve) => {
    try {
      const idb = globalThis.indexedDB;
      if (!idb) return resolve(null);
      const req = idb.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function withStore(mode, run) {
  return openDb().then((db) => {
    if (!db) return { ok: false, error: { name: 'NoIndexedDB', message: 'IndexedDB를 쓸 수 없습니다' } };
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, mode);
        const req = run(tx.objectStore(STORE));
        tx.oncomplete = () => { db.close(); resolve({ ok: true, value: req ? req.result : undefined }); };
        tx.onerror = () => { db.close(); resolve(fail(tx.error)); };
        tx.onabort = () => { db.close(); resolve(fail(tx.error)); };
      } catch (e) {
        try { db.close(); } catch { /* 무시 */ }
        resolve(fail(e));
      }
    });
  });
}

export const rememberFolder = (handle) => withStore('readwrite', (s) => s.put(handle, KEY));
export const forgetFolder = () => withStore('readwrite', (s) => s.delete(KEY));
/** @returns {Promise<{ok:true, handle:object|null} | {ok:false, error:object}>} */
export async function recallFolder() {
  const r = await withStore('readonly', (s) => s.get(KEY));
  return r.ok ? { ok: true, handle: r.value || null } : r;
}

// ── 고르기·허락 ──
/** 폴더 고르기 창을 연다. 사용자가 취소하면 {ok:false, cancelled:true} */
export async function pickFolder(picker = globalThis.showDirectoryPicker) {
  if (typeof picker !== 'function') return { ok: false, error: { name: 'Unsupported', message: '이 브라우저에서는 폴더를 고를 수 없습니다' } };
  try {
    const handle = await picker.call(globalThis, MODE);
    if (!handle) return { ok: false, error: { name: 'NoHandle', message: '폴더를 받지 못했습니다' } };
    return { ok: true, handle };
  } catch (e) {
    if (e && e.name === 'AbortError') return { ok: false, cancelled: true, error: fail(e).error };
    return fail(e);
  }
}

/**
 * 기억한 폴더를 되살린다. 허락이 남아 있으면 {ok:true, handle}, 다시 물어야 하면 {ok:true, needsPermission:true, handle}.
 * handle을 주면 IndexedDB 대신 그것을 쓴다(시험용).
 * 기억한 폴더가 없으면 {ok:true, handle:null}.
 */
export async function restoreFolder({ handle } = {}) {
  try {
    let h = handle;
    if (!h) {
      const r = await recallFolder();
      if (!r.ok) return { ok: true, handle: null }; // 기억 못 하는 환경: 그냥 연결 안 됨
      h = r.handle;
    }
    if (!h) return { ok: true, handle: null };
    if (typeof h.queryPermission !== 'function') return { ok: true, handle: h };
    const state = await h.queryPermission(MODE);
    if (state === 'granted') return { ok: true, handle: h };
    return { ok: true, handle: h, needsPermission: true };
  } catch (e) {
    return fail(e);
  }
}

/** 허락을 다시 묻는다. 사용자가 누른 단추 안에서만 부른다 */
export async function askPermission(handle) {
  try {
    if (!handle) return { ok: false, error: { name: 'NoHandle', message: '연결한 폴더가 없습니다' } };
    if (typeof handle.requestPermission !== 'function') return { ok: true, handle };
    const state = await handle.requestPermission(MODE);
    if (state === 'granted') return { ok: true, handle };
    return { ok: false, denied: true, error: { name: 'NotAllowedError', message: '폴더 쓰기를 허락하지 않았습니다' } };
  } catch (e) {
    return fail(e);
  }
}

// ── 읽고 쓰기 ──
/** 내 파일 하나를 폴더에 쓴다(없으면 만들고 있으면 바꾼다). 다른 파일은 건드리지 않는다 */
export async function writeMine(handle, fileName, text) {
  try {
    if (!handle || typeof fileName !== 'string' || !fileName || /[\\/]/.test(fileName) || fileName === '.' || fileName === '..') {
      return { ok: false, error: { name: 'BadName', message: '파일 이름이 올바르지 않습니다' } };
    }
    const fh = await handle.getFileHandle(fileName, { create: true });
    const w = await fh.createWritable();
    try {
      await w.write(text);
    } catch (e) {
      try { if (typeof w.abort === 'function') await w.abort(); } catch { /* 무시 */ }
      throw e;
    }
    await w.close();
    return { ok: true, name: fileName };
  } catch (e) {
    return fail(e);
  }
}

/**
 * 폴더 안 .json 파일을 읽는다(하위 폴더 제외). 1MB를 넘거나 읽다 실패한 파일은 건너뛰고 notes에 이유를 남긴다.
 * @returns {Promise<{ok:true, files:{name:string,size:number,lastModified:number,text:string}[], notes:{name:string, reason:string}[]} | {ok:false, error:object}>}
 */
export async function listJson(handle) {
  try {
    if (!handle || typeof handle.values !== 'function') return { ok: false, error: { name: 'NoHandle', message: '연결한 폴더가 없습니다' } };
    const files = [];
    const notes = [];
    for await (const entry of handle.values()) {
      if (!entry || entry.kind !== 'file' || typeof entry.name !== 'string' || !/\.json$/i.test(entry.name)) continue;
      try {
        const file = await entry.getFile();
        if (file.size > FOLDER_MAX_BYTES) {
          notes.push({ name: entry.name, reason: 'too_big' });
          continue;
        }
        files.push({ name: entry.name, size: file.size, lastModified: file.lastModified, text: await file.text() });
      } catch (e) {
        notes.push({ name: entry.name, reason: 'read_failed', error: fail(e).error });
      }
    }
    files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return { ok: true, files, notes };
  } catch (e) {
    return fail(e);
  }
}

/**
 * 폴더 변화를 알려 주는 기능이 있으면 구독한다. onChange(바뀐 파일 이름 배열)
 * @returns {(() => void)|null} 해제 함수. 기능이 없거나 구독이 실패하면 null
 */
export function observeFolder(handle, onChange, Observer = globalThis.FileSystemObserver) {
  if (typeof Observer !== 'function' || !handle) return null;
  try {
    const obs = new Observer((records) => {
      try {
        const names = (Array.isArray(records) ? records : []).map((r) => {
          const parts = r && r.relativePathComponents;
          if (Array.isArray(parts) && parts.length) return parts.join('/');
          return (r && r.changedHandle && r.changedHandle.name) || '';
        });
        onChange(names);
      } catch {
        // 알림 처리 실패는 무시
      }
    });
    const started = obs.observe(handle, { recursive: false });
    if (started && typeof started.catch === 'function') started.catch(() => {});
    return () => {
      try { obs.disconnect(); } catch { /* 무시 */ }
    };
  } catch {
    return null;
  }
}
