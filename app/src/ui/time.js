// 날짜·시각 도우미(검토5 C-5). 화면(ui)이 함께 쓴다. 모두 현지 시간 기준이다(toISOString은 UTC라 한국 새벽에는 전날이 된다).

export const pad = (n) => String(n).padStart(2, '0');

// 오늘 날짜(현지 기준, YYYY-MM-DD). 현재 담당자를 가르는 기준일이다
export function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ISO 8601 날짜·시각 + 현지 시간대(12.1)
export function nowIso() {
  const d = new Date();
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(off) / 60));
  const om = pad(Math.abs(off) % 60);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:${pad(d.getSeconds())}${sign}${oh}:${om}`;
}
