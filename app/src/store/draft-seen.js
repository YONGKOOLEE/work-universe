// 대상별 「마지막으로 초안을 만든 시각」(CR-18 D-13). 이 브라우저의 localStorage에만 둔다(키 wu:v1:draft-seen).
// 문서·내보내기·백업·되감기 이력에는 들어가지 않는다(store/local.js의 설정·응답 캐시와 같은 원칙). DOM에 의존하지 않도록 storage를 주입받는다.
// 저장소가 없거나 깨졌거나 쓰기에 실패하면 조용히 「없음」으로 본다(표시만 없고 초안은 그대로 만들어진다).

const KEY = 'wu:v1:draft-seen';
/** 기억할 대상 수의 상한. 넘으면 시각이 오래된 것부터 버린다 */
export const DRAFT_SEEN_MAX = 50;

const stampOk = (s) => typeof s === 'string' && !Number.isNaN(Date.parse(s));

function readAll(storage) {
  try {
    const v = JSON.parse((storage && storage.getItem(KEY)) || 'null');
    const at = v && typeof v === 'object' && v.at && typeof v.at === 'object' && !Array.isArray(v.at) ? v.at : {};
    return Object.fromEntries(Object.entries(at).filter(([k, t]) => typeof k === 'string' && stampOk(t)));
  } catch {
    return {};
  }
}

/** 대상(전역 참조) 하나의 마지막 초안 시각(ISO). 없으면 null */
export function readDraftSeen(storage, targetGid) {
  return readAll(storage)[targetGid] || null;
}

/** 대상의 마지막 초안 시각을 남긴다. 성공하면 true, 저장소가 없거나 실패하면 false */
export function writeDraftSeen(storage, targetGid, iso) {
  if (!storage || !targetGid || !stampOk(iso)) return false;
  try {
    const all = { ...readAll(storage), [targetGid]: iso };
    const keep = Object.entries(all).sort((a, b) => Date.parse(b[1]) - Date.parse(a[1])).slice(0, DRAFT_SEEN_MAX);
    storage.setItem(KEY, JSON.stringify({ v: 1, at: Object.fromEntries(keep) }));
    return true;
  } catch {
    return false;
  }
}
