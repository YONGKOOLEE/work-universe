// AI 비서 날짜·시각 도우미 — 순수 함수. 브라우저 기능을 쓰지 않는다.
// 날짜는 'YYYY-MM-DD', 시각은 'YYYY-MM-DD HH:MM:SS'(사용자 PC의 현지 시각 기준 글자). 계산은 UTC로 해서 여름 시간제·시간대와 무관하게 같은 값을 낸다.
// 입력 Date(now)는 현지 시각 부품(getFullYear 등)으로만 읽는다 → 시험은 new Date(2026, 9, 30, 10, 0)처럼 현지 시각으로 만든다.

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad = (n: number) => String(n).padStart(2, '0');

/** 달력에 실제로 있는 날짜인가(2026-02-30은 거짓) */
export function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y, m);
}
export const isLeapYear = (y: number) => y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
export function daysInMonth(y: number, m: number): number {
  return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

/** Date → 현지 날짜 글자 */
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Date → 현지 시각 글자 'YYYY-MM-DD HH:MM:SS' */
export const stamp = (d: Date) => `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
/** Date → 'HH:MM' */
export const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

const DAY_MS = 86400000;
const utcOf = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const isoOf = (ms: number) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

export const addDays = (iso: string, n: number) => isoOf(utcOf(iso) + n * DAY_MS);
/** b - a (일) */
export const diffDays = (a: string, b: string) => Math.round((utcOf(b) - utcOf(a)) / DAY_MS);
/** 월요일=0 … 일요일=6 (파이썬 weekday와 같다) */
export const weekday = (iso: string) => (new Date(utcOf(iso)).getUTCDay() + 6) % 7;
export const WEEKDAY_KO = '월화수목금토일';

export function monthRange(y: number, m: number): [string, string] {
  return [`${y}-${pad(m)}-01`, `${y}-${pad(m)}-${pad(daysInMonth(y, m))}`];
}

/** 시각 글자 + 분 */
export function addMinutes(stampStr: string, minutes: number): string {
  const [d, t] = stampStr.split(' ');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi, s] = (t ?? '00:00:00').split(':').map(Number);
  const ms = Date.UTC(y, mo - 1, da, h, mi, s || 0) + minutes * 60000;
  const x = new Date(ms);
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())} ${pad(x.getUTCHours())}:${pad(x.getUTCMinutes())}:${pad(x.getUTCSeconds())}`;
}

/** 매년 반복되는 날짜(YYYY-MM-DD 또는 MM-DD)의 base 이후(같은 날 포함) 다음 도래일. 2/29는 평년에 2/28. 해석할 수 없으면 null
 *  (원본은 화면마다 2/29 처리가 달랐다 — 서버·알림은 윤년에 29일, 브리핑·검색은 늘 28일. 윤년에 29일을 쓰는 쪽으로 하나로 통일) */
export function nextOccurrence(dateStr: string, base: string): string | null {
  const m = /(\d{2})-(\d{2})$/.exec(String(dateStr ?? ''));
  if (!m) return null;
  const mo = Number(m[1]);
  const d = Number(m[2]);
  const by = Number(base.slice(0, 4));
  for (const y of [by, by + 1]) {
    const dd = mo === 2 && d === 29 && !isLeapYear(y) ? 28 : d;
    if (mo < 1 || mo > 12 || dd < 1 || dd > daysInMonth(y, mo)) return null;
    const cand = `${y}-${pad(mo)}-${pad(dd)}`;
    if (cand >= base) return cand;
  }
  return null;
}

/** 'M월 D일' (해석할 수 없으면 입력 그대로) */
export function mdLabel(iso: string | undefined | null): string {
  if (!iso || !isValidDate(iso)) return iso || '';
  return `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일`;
}

/** 파이썬 round()처럼 .5는 짝수 쪽으로(골든 비교에서 읽는 시간 값이 같아야 한다) */
export function pyRound(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}
/** 파이썬 len()처럼 글자(코드 포인트) 수 */
export const len = (s: string) => Array.from(s).length;
