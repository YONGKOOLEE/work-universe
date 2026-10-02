// 흐름 변화(D-08, R-05 "시간에 따른 흐름 변화", R-14). 순수 함수이며 view만 입력으로 받는다(12.7 rules).
// 기간(월·분기)별로 이력 수와, 그 기간 말에 담당 중인 업무·인원을 센다.
// 데이터 부족(02-design 5.5): 이력 시점 범위가 한 기간 이하이면 결론 없이 부족만 알리고,
// 마지막 입력 이후 기간은 0건으로 단정하지 않고 "입력 없음"으로 표시한다.

import { periodStatus } from '../view/describe.js';

const pad = (n) => String(n).padStart(2, '0');
const COUNTED = ['assign_start', 'assign_end', 'handover', 'affiliation_change', 'memo'];

/** 날짜(YYYY-MM-DD)가 속한 기간 키. month: 2026-06, quarter: 2026-Q2 */
export function periodKey(date, unit) {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  return unit === 'quarter' ? `${y}-Q${Math.ceil(m / 3)}` : `${y}-${pad(m)}`;
}

/** 기간 키의 첫날·마지막 날 */
export function periodRange(key, unit) {
  const y = Number(key.slice(0, 4));
  const firstMonth = unit === 'quarter' ? (Number(key.slice(6)) - 1) * 3 + 1 : Number(key.slice(5, 7));
  const lastMonth = unit === 'quarter' ? firstMonth + 2 : firstMonth;
  const lastDay = new Date(Date.UTC(y, lastMonth, 0)).getUTCDate();
  return { start: `${y}-${pad(firstMonth)}-01`, end: `${y}-${pad(lastMonth)}-${pad(lastDay)}` };
}

/** 기간 키를 하나 뒤로 */
function nextKey(key, unit) {
  const { end } = periodRange(key, unit);
  const d = new Date(`${end}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return periodKey(d.toISOString().slice(0, 10), unit);
}

/** 기준일(at)에 담당 중인 업무와 사람(숨긴 것·업무 기간이 끝난 것 제외) */
export function activeAt(view, at) {
  const works = new Set();
  const people = new Set();
  for (const e of view.edges) {
    if (e.hidden || e.core_type !== 'performs' || periodStatus(e.period, at) !== 'current') continue;
    const w = view.getNode(e.target);
    const p = view.getNode(e.source);
    if (!w || w.hidden || w.core_type !== 'work' || periodStatus(w.period, at) === 'ended') continue;
    if (!p || p.hidden || p.core_type !== 'person') continue;
    works.add(w.gid);
    people.add(p.gid);
  }
  return { works, people };
}

/**
 * @param {object} view buildView 결과
 * @param {{unit?:'month'|'quarter', asOf:string}} opts asOf: 오늘(기간 목록의 끝)
 * @returns {{status:'ok'|'insufficient', reason:string, unit:string, first_input:string|null, last_input:string|null,
 *   no_data_periods:number, periods:object[]}}
 */
export function flowChange(view, { unit = 'month', asOf }) {
  const events = view.events.filter((e) => e.occurred_at && e.occurred_at <= asOf);
  const first = events.length ? events[0].occurred_at : null;
  const last = events.length ? events[events.length - 1].occurred_at : null;
  const base = { unit, first_input: first, last_input: last, no_data_periods: 0, periods: [] };
  if (!events.length) return { ...base, status: 'insufficient', reason: '이력이 없어 흐름을 볼 수 없습니다' };
  if (periodKey(first, unit) === periodKey(last, unit)) {
    return { ...base, status: 'insufficient', reason: `이력이 한 ${unit === 'quarter' ? '분기' : '달'} 안에만 있어 변화를 볼 수 없습니다` };
  }

  const lastKey = periodKey(last, unit);
  const endKey = periodKey(asOf, unit);
  const periods = [];
  let afterLast = false;
  for (let key = periodKey(first, unit); ; key = nextKey(key, unit)) {
    const range = periodRange(key, unit);
    const at = range.end < asOf ? range.end : asOf;
    const inPeriod = events.filter((e) => e.occurred_at >= range.start && e.occurred_at <= range.end);
    const counts = { total: inPeriod.length, other: 0 };
    for (const t of COUNTED) counts[t] = 0;
    for (const e of inPeriod) {
      if (COUNTED.includes(e.type)) counts[e.type] += 1;
      else counts.other += 1;
    }
    const active = activeAt(view, at);
    periods.push({
      key,
      start: range.start,
      end: range.end,
      at,
      // 마지막 입력이 있는 기간 다음부터는 입력이 없다 → 0건이라고 단정하지 않는다
      no_data: afterLast,
      counts,
      active_works: active.works.size,
      active_people: active.people.size,
      evidence_ids: inPeriod.map((e) => e.gid),
    });
    if (key === lastKey) afterLast = true;
    if (key === endKey) break;
  }
  const noData = periods.filter((p) => p.no_data).length;
  return { ...base, status: 'ok', reason: '', no_data_periods: noData, periods };
}

/** 시간 슬라이더의 범위: 가장 이른 이력·담당 기간 시작부터 오늘까지의 달 목록(YYYY-MM) */
export function timeMonths(view, today) {
  const dates = [
    ...view.events.map((e) => e.occurred_at),
    ...view.edges.filter((e) => !e.hidden && e.period?.start).map((e) => e.period.start),
  ].filter((d) => d && d <= today);
  if (!dates.length) return [periodKey(today, 'month')];
  const months = [];
  const end = periodKey(today, 'month');
  for (let k = periodKey(dates.reduce((a, b) => (a < b ? a : b)), 'month'); ; k = nextKey(k, 'month')) {
    months.push(k);
    if (k === end) break;
  }
  return months;
}

/** 슬라이더에서 고른 달의 기준일: 그 달 마지막 날, 이번 달이면 오늘 */
export function monthAsOf(key, today) {
  const { end } = periodRange(key, 'month');
  return end < today ? end : today;
}
