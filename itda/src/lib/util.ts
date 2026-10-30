export const DAY = 86400000;

export function isoDaysFrom(base: Date, days: number) {
  const d = new Date(base.getTime() + days * DAY);
  return d.toISOString();
}
export function dateOnly(iso: string) {
  return iso.slice(0, 10);
}
/** '2024-11-26' → '2024. 11. 26.' / '2023-06' → '2023. 6.' */
const NB = '\u00a0';
/** ISO 일시는 사용자 현지 날짜로, 'YYYY-MM-DD'·'YYYY-MM'은 그대로 */
export function localDay(iso: string) {
  if (!iso.includes('T')) return iso.slice(0, 10);
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function today() {
  return localDay(new Date().toISOString());
}
export function fmtDate(s: string | null | undefined) {
  if (!s) return '—';
  const p = localDay(s).split('-');
  if (p.length === 2) return `${p[0]}.${NB}${Number(p[1])}.`;
  if (p.length === 3) return `${p[0]}.${NB}${Number(p[1])}.${NB}${Number(p[2])}.`;
  return s;
}
export function fmtDateTime(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${NB}${d.getMonth() + 1}.${NB}${d.getDate()}. ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function daysBetween(aIso: string, bIso: string) {
  return Math.round((new Date(localDay(bIso)).getTime() - new Date(localDay(aIso)).getTime()) / DAY);
}
export function relDays(iso: string, now = new Date()) {
  const d = daysBetween(iso, now.toISOString());
  if (d === 0) return '오늘';
  if (d === 1) return '어제';
  if (d > 0) return `${d}일 전`;
  return `${-d}일 후`;
}
export function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}
/** 'HO-003'처럼 접두어+번호 형식의 다음 ID (삭제된 번호와 겹치지 않도록 최댓값 기준) */
export function nextId(prefix: string, ids: string[]) {
  const max = ids.reduce((m, id) => {
    // 무작위 ID(uid)가 '36E38'처럼 지수 표기로 읽혀 최댓값이 망가지면 같은 번호가 반복된다(합쳐 불러오기 ID 중복) — 숫자로만 된 ID만 센다
    const rest = id.startsWith(prefix + '-') ? id.slice(prefix.length + 1) : '';
    const n = /^\d+$/.test(rest) ? Number(rest) : NaN;
    return Number.isSafeInteger(n) && n > m ? n : m;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}
export function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}
export function cx(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(' ');
}
/** 비교용 날짜 키 ('2023-06' → '2023-06-00') */
export function dateKey(s: string) {
  return s.length === 7 ? s + '-00' : s.slice(0, 10);
}
