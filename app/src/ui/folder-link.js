// 폴더 연결 조정기(CR-14 C, R-27, D-32): 브라우저 저장소가 원본, 폴더는 거울.
// 저장할 때마다 내 유니버스를 폴더에 내보내고(1초 디바운스), 폴더의 동료 파일은 읽기 전용으로 읽어 「팀 지도로 묶기」에 잇는다.
// 폴더 접근은 api(store/folder.js)로만 하고, 목록 판정은 view/folder-plan.js의 순수 함수로 한다.

import * as folderApi from '../store/folder.js';
import { myFileName, planFolder } from '../view/folder-plan.js';
import { parseImportText } from '../model/import.js';

export const MIRROR_DELAY_MS = 1000; // 같은 유니버스에 대한 연속 저장은 마지막 한 번만 내보낸다
export const GROUP_NAME = '폴더 팀 지도';
export const GROUP_LEVEL = '팀';

export const FOLDER_TEXT = {
  unsupported: '이 브라우저에서는 폴더 연결을 쓸 수 없습니다(Chrome·Edge에서 됩니다). 내보내기·가져오기로 파일을 주고받으세요.',
  intro: '고른 폴더에 저장할 때마다 이 유니버스 파일이 생기고, 같은 폴더의 동료 파일을 읽어 팀 지도로 묶습니다. 남의 파일은 고치지 않습니다.',
  changed: '폴더에 바뀐 파일이 있습니다 — 새로 고침',
  mirrorFailed: '폴더에 저장하지 못했습니다. 브라우저 저장은 끝났습니다. 「폴더 연결」 탭에서 다시 시도하세요.',
};

const errText = (e) => {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return '폴더 접근을 허락하지 않았습니다.';
  if (n === 'NotFoundError') return '연결한 폴더를 찾을 수 없습니다. 연결을 끊고 다시 고르세요.';
  return `폴더 작업에 실패했습니다(${n || '알 수 없음'}).`;
};

/**
 * @param {{app:object, getAuthor?:()=>string|undefined, canMirror?:()=>boolean, api?:object, setTimer?:Function, clearTimer?:Function}} o
 */
export function createFolderLink(o) {
  const api = o.api || folderApi;
  const setTimer = o.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer || ((t) => clearTimeout(t));
  const subs = new Set();
  const st = {
    supported: api.folderSupported(),
    handle: null, name: '', needsPermission: false,
    plan: [], notes: [], texts: new Map(), selected: new Map(),
    changed: false, warning: '', message: '', busy: false, loaded: false, lastSaved: null,
  };
  let stopObserve = null;
  const timers = new Map(); // 유니버스 ID → 기다리는 저장 {timer, name, text}

  const notify = () => subs.forEach((f) => { try { f(); } catch { /* 화면 갱신 실패가 저장을 막지 않게 */ } });
  const authorName = () => (o.getAuthor && o.getAuthor()) || '';
  const fileFor = (id) => myFileName({ authorName: authorName(), universeId: id });
  const connected = () => !!st.handle && !st.needsPermission;

  function stopWatching() {
    if (stopObserve) { try { stopObserve(); } catch { /* 무시 */ } }
    stopObserve = null;
  }

  function watch() {
    stopWatching();
    if (!connected()) return;
    stopObserve = api.observeFolder(st.handle, (names) => {
      const mine = fileFor(o.app.doc.universe.id);
      // 내 파일과 임시 파일(.crswap 등)의 변화는 무시한다. 남의 .json이 바뀐 때만 알린다
      if (names.some((n) => /\.json$/i.test(n) && n !== mine)) {
        st.changed = true;
        notify();
      }
    });
  }

  async function reload() {
    if (!connected()) return { ok: false };
    const r = await api.listJson(st.handle);
    if (!r.ok) {
      st.message = errText(r.error);
      st.plan = [];
      st.notes = [];
      return r;
    }
    const me = o.app.doc.universe.id;
    st.texts = new Map(r.files.map((f) => [f.name, f.text]));
    st.plan = planFolder(r.files, { myFiles: new Set([fileFor(me)]), existingIds: new Set(o.app.universes().map((u) => u.id)), currentId: me })
      .map((p, i) => ({ ...p, size: r.files[i].size, lastModified: r.files[i].lastModified }));
    for (const p of st.plan) if (!st.selected.has(p.name)) st.selected.set(p.name, p.ok && !p.mine && !p.current);
    st.notes = r.notes;
    st.changed = false;
    st.loaded = true;
    st.message = '';
    return r;
  }

  async function adopt(handle, { write }) {
    st.handle = handle;
    st.name = handle.name || '';
    st.needsPermission = false;
    st.message = '';
    st.warning = '';
    watch();
    if (write) await saveNow();
    await reload();
  }

  const self = {
    get state() { return st; },
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    myFile: () => fileFor(o.app.doc.universe.id),
    connected,

    /** 시작할 때: 기억한 폴더를 되살린다(허락이 남아 있으면 바로, 아니면 「폴더 다시 허락」) */
    async init() {
      if (!st.supported) return;
      const r = await api.restoreFolder();
      if (!r.ok || !r.handle) { st.loaded = true; return notify(); }
      st.handle = r.handle;
      st.name = r.handle.name || '';
      st.needsPermission = !!r.needsPermission;
      if (!st.needsPermission) { watch(); await reload(); }
      st.loaded = true;
      notify();
    },

    /** 점검·시험용: 가짜 손잡이를 연결된 상태로 둔다(처음 쓰기 없음) */
    async useHandle(handle) {
      st.supported = true;
      await adopt(handle, { write: false });
      notify();
    },

    /** 「폴더 연결」(사용자 단추 안에서만): 폴더를 고르고 내 파일을 바로 쓴다 */
    async connect(picker) {
      const r = await api.pickFolder(picker);
      if (!r.ok) {
        st.message = r.cancelled ? '' : errText(r.error);
        notify();
        return r;
      }
      await api.rememberFolder(r.handle); // 못 기억해도 이번 세션은 쓴다
      await adopt(r.handle, { write: true });
      notify();
      return { ok: true };
    },

    /** 「폴더 다시 허락」(사용자 단추 안에서만) */
    async reauthorize() {
      const r = await api.askPermission(st.handle);
      if (!r.ok) {
        st.message = errText(r.error);
        notify();
        return r;
      }
      await adopt(st.handle, { write: false });
      notify();
      return { ok: true };
    },

    /** 「연결 끊기」: 기억한 손잡이를 지운다. 폴더의 파일은 그대로 둔다 */
    async disconnect() {
      stopWatching();
      for (const t of timers.values()) clearTimer(t.timer);
      timers.clear();
      await api.forgetFolder();
      Object.assign(st, { handle: null, name: '', needsPermission: false, plan: [], notes: [], texts: new Map(), changed: false, warning: '', message: '', lastSaved: null });
      notify();
    },

    /** 「새로 고침」 */
    async refresh() {
      st.busy = true;
      notify();
      await reload();
      st.busy = false;
      notify();
    },

    setSelected(name, on) { st.selected.set(name, !!on); },

    /** 「지금 저장」: 디바운스 없이 지금 유니버스를 폴더에 쓴다 */
    async saveNow() {
      await saveNow();
      await reload();
      notify();
      return { ok: !st.warning };
    },

    /** 저장 성공 뒤에 부른다. 폴더가 연결돼 있고 허락이 있고 거울 저장이 허용될 때만, 1초 안 연속 호출은 마지막 한 번만 쓴다 */
    mirror() {
      if (!connected() || (o.canMirror && !o.canMirror())) return false;
      const id = o.app.doc.universe.id;
      const prev = timers.get(id);
      if (prev) clearTimer(prev.timer);
      const job = { name: fileFor(id), text: o.app.exportJson(), timer: null };
      job.timer = setTimer(async () => {
        timers.delete(id);
        await write(job);
        await reload();
        notify();
      }, MIRROR_DELAY_MS);
      timers.set(id, job);
      return true;
    },

    /**
     * 「팀 지도로 묶기」: 체크한 동료 파일을 가져오고(같은 ID는 덮어씀) 지금 유니버스와 묶어 새 상위 유니버스를 만든다.
     * 같은 이름의 묶음이 이미 있어도 그 묶음에 더하는 앱 명령이 없어 새로 만들고 이름 뒤에 번호를 붙인다.
     * @returns {Promise<{ok:true, id:string} | {ok:false, message:string}>}
     */
    async bundle({ confirm }) {
      const app = o.app;
      const me = app.doc.universe.id;
      const peers = st.plan.filter((p) => p.ok && !p.mine && !p.current && st.selected.get(p.name));
      if (!peers.length) return { ok: false, message: '묶을 동료 파일을 체크하세요.' };
      const over = peers.filter((p) => p.exists).length;
      const ask = `동료 파일 ${peers.length}개로 이 브라우저의 사본을 바꿉니다${over ? `(같은 ID ${over}개는 덮어씁니다. 그 유니버스에 이 브라우저에서 고친 내용은 사라집니다)` : ''}. 그다음 지금 유니버스와 묶어 「${GROUP_NAME}」을 만듭니다. 계속할까요?`;
      if (confirm && !confirm(ask)) return { ok: false, message: '' };
      const ids = [];
      for (const p of peers) {
        const parsed = parseImportText(st.texts.get(p.name));
        if (!parsed.ok) return { ok: false, message: `「${p.name}」을 읽지 못했습니다. 새로 고침 뒤 다시 하세요.` };
        const r = app.importUniverse(parsed.doc, { overwrite: true });
        if (!r.ok) return { ok: false, message: `「${p.name}」을 가져오지 못했습니다${ids.length ? `(앞의 ${ids.length}개는 이미 가져왔습니다)` : ''}.` };
        ids.push(r.doc.universe.id);
      }
      let name = GROUP_NAME;
      for (let n = 2; app.findSameUniverse(name, GROUP_LEVEL); n += 1) name = `${GROUP_NAME} ${n}`;
      const g = app.groupUniverses({ name, level: GROUP_LEVEL, owner: authorName() || '폴더 팀', childIds: [...new Set([me, ...ids])] });
      if (!g.ok) return { ok: false, message: `묶지 못했습니다${ids.length ? `(동료 파일 ${ids.length}개는 이미 가져왔습니다)` : ''}.` };
      return { ok: true, id: g.doc.universe.id, name, count: ids.length };
    },
  };

  async function write(job) {
    const r = await api.writeMine(st.handle, job.name, job.text);
    if (r.ok) {
      st.warning = '';
      st.lastSaved = job.name;
    } else {
      st.warning = FOLDER_TEXT.mirrorFailed;
    }
    return r;
  }

  async function saveNow() {
    if (!connected()) return;
    const id = o.app.doc.universe.id;
    const pending = timers.get(id);
    if (pending) { clearTimer(pending.timer); timers.delete(id); }
    await write({ name: fileFor(id), text: o.app.exportJson() });
  }

  return self;
}
