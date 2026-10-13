// 백업 권유 판단(R-21 ②, D-23). 순수 함수 — DOM·저장소를 쓰지 않는다.
// 기준값은 이 파일 한 곳에만 둔다.

export const BACKUP_DAYS = 7; // 마지막 내보내기 뒤 이 일수가 지나고 바뀐 것이 있으면 권유
export const BACKUP_CHANGES = 30; // 마지막 내보내기 뒤 사용자 변경이 이 건수를 넘으면(초과) 권유

const DAY_MS = 24 * 60 * 60 * 1000;
const ms = (s) => (typeof s === 'string' ? Date.parse(s) : NaN);

/** 사용자 변경(source 'user' 이벤트)의 기록 시각 목록. 사람이 한 일만 센다(샘플 설치·자동 연결 등은 제외) */
export function userChangeTimes(doc) {
  return ((doc && doc.events) || []).filter((e) => e && e.source === 'user').map((e) => e.recorded_at);
}

/**
 * 내보내기를 권할지 판단한다.
 * - 변경 수 = 기준 시각 뒤에 기록된 사용자 변경. 기준 시각 = 마지막 내보내기와 「닫기」를 누른 시각 중 늦은 것(닫으면 거기서부터 다시 센다).
 * - 변경이 BACKUP_CHANGES건을 넘으면 권유. 내보낸 적이 있고 변경이 1건 이상이며 BACKUP_DAYS일 이상 지났어도 권유.
 * - 내보낸 적이 없으면 변경 수로만 판단한다(C12-3). 변경이 없으면 며칠이 지나도 권유하지 않는다(C12-2).
 * @param {{lastExportAt?:string|null, dismissedAt?:string|null, changeTimes:string[], now:string}} o
 * @returns {{suggest:boolean, changes:number, reason:'count'|'days'|null, days:number|null}} days는 마지막 내보내기 뒤 지난 일수(내보낸 적 없으면 null)
 */
export function backupAdvice({ lastExportAt = null, dismissedAt = null, changeTimes = [], now }) {
  const exportMs = ms(lastExportAt);
  const base = Math.max(Number.isNaN(exportMs) ? -Infinity : exportMs, ms(dismissedAt) || -Infinity);
  const nowMs = ms(now);
  const changes = changeTimes.filter((t) => base === -Infinity || ms(t) > base).length;
  const daysSince = Number.isNaN(exportMs) || Number.isNaN(nowMs) ? null : Math.floor((nowMs - exportMs) / DAY_MS);
  if (changes > BACKUP_CHANGES) return { suggest: true, changes, reason: 'count', days: daysSince };
  const sinceBase = Number.isNaN(exportMs) || Number.isNaN(nowMs) ? 0 : nowMs - base;
  if (changes >= 1 && !Number.isNaN(exportMs) && sinceBase >= BACKUP_DAYS * DAY_MS) return { suggest: true, changes, reason: 'days', days: daysSince };
  return { suggest: false, changes, reason: null, days: daysSince };
}
