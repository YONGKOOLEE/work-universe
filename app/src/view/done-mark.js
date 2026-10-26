// 「~done=」 일회용 표지(R11 RV11S-1): 주소 끝의 ~done=group|import만 믿으면 다른 사람이 보낸 주소·즐겨찾기로도 「묶었습니다」 알림이 뜬다.
// 가져오기·묶기를 한 탭이 sessionStorage에 표지(지도 id + 종류 + 시각)를 남기고, 다시 열린 화면이 주소의 ~done과 같은 표지가 있을 때만 알림을 띄운 뒤 지운다.
// 이 파일은 표지 글을 만들고 맞춰 보는 순수 부분이다(저장소 접근은 ui/main.js가 try/catch로 한다 — 쓸 수 없으면 알림을 생략).

export const DONE_KEY = 'wu.done-mark';
export const DONE_KINDS = ['group', 'import'];
/** 표지가 유효한 시간(밀리초): 열린 직후에 쓰이는 일회용이라 짧다 */
export const DONE_MAX_AGE_MS = 5 * 60 * 1000;
/** 자동으로 이은 사람 수의 상한(만들 때와 읽을 때 같이 쓴다 — 조작된 표지가 알림 글에 엄청난 숫자를 넣지 못하게, R12 RV12S-2) */
export const DONE_AUTO_MAX = 100000;
const cleanAuto = (v) => (Number.isFinite(v) && v > 0 ? Math.min(Math.floor(v), DONE_AUTO_MAX) : 0);

/** 표지 글(JSON). 종류를 모르면 null */
export function makeDoneMark(kind, mapId, nowMs = Date.now(), auto = 0) {
  if (!DONE_KINDS.includes(kind) || !mapId) return null;
  const n = cleanAuto(auto);
  return JSON.stringify({ kind, map: String(mapId), at: nowMs, ...(n ? { auto: n } : {}) }); // auto: 묶을 때 사번이 같아 자동으로 이은 사람 수(R11 RV11C-12)
}

/** 표지에 실린 자동으로 이은 사람 수(없거나 깨졌으면 0) */
export function doneMarkAuto(raw) {
  try {
    const m = JSON.parse(raw);
    return m ? cleanAuto(m.auto) : 0;
  } catch {
    return 0;
  }
}

/**
 * 저장돼 있던 표지가 지금 열린 지도·주소의 종류와 맞는가. 깨졌거나, 종류·지도가 다르거나, 오래됐거나, 미래 시각이면 false.
 * @param {string|null} raw sessionStorage에서 읽은 글
 */
export function doneMarkMatches(raw, kind, mapId, nowMs = Date.now()) {
  if (!raw || !DONE_KINDS.includes(kind) || !mapId) return false;
  let m;
  try {
    m = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!m || typeof m !== 'object' || m.kind !== kind || m.map !== String(mapId)) return false;
  const age = nowMs - Number(m.at);
  return Number.isFinite(age) && age >= 0 && age <= DONE_MAX_AGE_MS;
}
